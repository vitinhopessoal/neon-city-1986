import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { buildReference, retargetClip, RIG_JOINTS, RIG_PARENT } from './MixamoRetarget.js';
import { clamp, dampFactor } from '../../utils/math.js';

/**
 * Animações da Mixamo no protagonista (public/models/anims/*.fbx).
 *
 * Dois THREE.AnimationMixer, cada um num esqueleto-sombra invisível com as
 * mesmas 17 articulações do personagem:
 *  - base: o corpo inteiro (parado, andar, correr, de costas, de lado, pulo,
 *    queda, nado...), trocado com crossFadeTo;
 *  - upper: só tronco, cabeça e braços (mirar, atirar, recarregar, facada,
 *    reação a tiro), por cima da base.
 * O PlayerAnimator procedural continua calculando a pose de sempre (veículos,
 * moto, sentar, queda da moto, armas); depois, apply() mistura a pose dos
 * clipes sobre ela com um peso. Assim nada do que existia deixa de funcionar:
 * dirigindo ou sentado o peso vai a zero, e sem os arquivos o jogo segue
 * só com a animação procedural.
 */
const UPPER = ['spine', 'chest', 'neck', 'head', 'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR'];
const ARMS = new Set(['shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR']);
/** Clipes que fazem ciclo; os demais tocam uma vez e param no último quadro. */
const LOOPS = new Set(['idle', 'walk', 'run', 'walk_back', 'strafe_left', 'strafe_right', 'fall', 'swim', 'tread_water',
  'pistol_idle', 'pistol_aim', 'pistol_shoot', 'pistol_walk', 'pistol_run', 'pistol_walk_back', 'pistol_strafe_left', 'pistol_strafe_right',
  'rifle_idle', 'rifle_aim', 'rifle_fire', 'rifle_walk', 'rifle_run', 'rifle_walk_back', 'rifle_strafe_left', 'rifle_strafe_right', 'knife_idle']);
/** Velocidade natural (m/s) dos clipes "In Place" de origem (sem deslocamento para medir). */
const NATURAL_SPEED = { walk: 1.45 };
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _x = new THREE.Vector3(1, 0, 0);

function shadowSkeleton(joints) {
  const root = new THREE.Group();
  const byName = {};
  for (const name of RIG_JOINTS) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.copy(joints[name].position);
    byName[name] = o;
  }
  for (const name of RIG_JOINTS) (RIG_PARENT[name] ? byName[RIG_PARENT[name]] : root).add(byName[name]);
  return { root, joints: byName };
}

/** Articulações do CharacterModel pelo nome do osso. */
export function jointMap(j) {
  return {
    hips: j.hips, spine: j.spine, chest: j.chest, neck: j.neck, head: j.head,
    shoulderL: j.arms.L.shoulder, elbowL: j.arms.L.elbow, wristL: j.arms.L.wrist,
    shoulderR: j.arms.R.shoulder, elbowR: j.arms.R.elbow, wristR: j.arms.R.wrist,
    hipL: j.legs.L.hip, kneeL: j.legs.L.knee, ankleL: j.legs.L.ankle,
    hipR: j.legs.R.hip, kneeR: j.legs.R.knee, ankleR: j.legs.R.ankle,
  };
}

export class PlayerClips {
  constructor(model, { hipsBaseY = 0.95 } = {}) {
    this.joints = jointMap(model.joints);
    this.hipsBaseY = hipsBaseY;
    this.base = this._layer();
    this.upper = this._layer();
    this.clips = new Map();
    this.ready = false;
    this.status = 'idle';
    this.weight = 0;        // peso global (0 = só procedural)
    this.upperWeight = 0;
    this.armsProcedural = 0; // braços voltam ao procedural (recarga de pistola)
    this.state = null;
    this.upperState = null;
    this.events = { jump: false, land: 0, shot: false, stab: false, hit: false };
    this._prevKick = 0;
    this._air = 0;
    this._oneShot = null;
    this._upperOneShot = null;
    this.stats = { loadMs: 0, clips: 0, crossFades: 0 };
  }

  _layer() {
    const s = shadowSkeleton(this.joints);
    return { ...s, mixer: new THREE.AnimationMixer(s.root), actions: new Map(), current: null };
  }

  /** Carrega e converte os clipes (assíncrono; o jogo segue procedural até terminar). */
  async load(baseUrl, { fetchImpl = fetch } = {}) {
    const t0 = performance.now();
    this.status = 'loading';
    try {
      const list = await (await fetchImpl(baseUrl + 'anims.json')).json();
      const loader = new FBXLoader();
      const parsed = await Promise.all(list.clips.map(async (c) => {
        const res = await fetchImpl(baseUrl + c.file);
        if (!res.ok) throw new Error(`${c.file}: HTTP ${res.status}`);
        return { name: c.name, object: loader.parse(await res.arrayBuffer(), baseUrl) };
      }));
      const idle = parsed.find(p => p.name === 'idle');
      if (!idle) throw new Error('anims.json sem o clipe "idle" (pose de referência)');
      this.ref = buildReference(idle.object, idle.object.animations[0], { standHips: this.hipsBaseY });
      for (const p of parsed) this.addClip(retargetClip(p.object, p.object.animations[0], this.ref, p.name, { inPlace: true }));
      this.ready = true;
      this.status = 'ready';
    } catch (err) {
      console.warn('[PlayerClips] animações da Mixamo indisponíveis; mantendo a animação procedural.', err);
      this.status = `erro: ${err.message}`;
    }
    this.stats.loadMs = Math.round(performance.now() - t0);
    return this.ready;
  }

  addClip(clip) {
    this.clips.set(clip.name, clip);
    const loop = LOOPS.has(clip.name);
    const dist = clip.userData?.distance || 0;
    clip.userData.speed = NATURAL_SPEED[clip.name] ?? (dist > 0.05 ? dist / clip.duration : 0);
    for (const layer of [this.base, this.upper]) {
      const a = layer.mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      layer.actions.set(clip.name, a);
    }
    this.stats.clips = this.clips.size;
  }

  has(name) { return this.clips.has(name); }

  /** Troca suave de clipe numa camada (crossFadeTo do clipe atual para o novo). */
  play(layerName, name, { fade = 0.25, timeScale = 1, offset = 0, restart = false } = {}) {
    const layer = this[layerName];
    const next = layer.actions.get(name);
    if (!next) return null;
    const cur = layer.current;
    next.timeScale = timeScale;
    if (cur === next && !restart) return next;
    next.enabled = true;
    next.reset();
    next.time = offset;
    next.setEffectiveWeight(1);
    next.play();
    if (cur && cur !== next) { cur.crossFadeTo(next, fade, false); this.stats.crossFades++; }
    else if (!cur) next.fadeIn(fade);
    layer.current = next;
    return next;
  }

  /**
   * Escolhe os clipes do quadro e avança os mixers.
   * ctx: { mode: 'foot'|'swim'|'climb'|'dead'|'off', speed, fwd, side, strafe, grounded, vy,
   *        walkSpeed, runSpeed, hold, aim, firing, reload (−1 ou 0..1), reloadDur, health }
   */
  update(dt, ctx) {
    if (!this.ready) return;
    const active = ctx.mode !== 'off';
    this.hipsOffsetY = ctx.hipsOffsetY || 0;
    this.weight += ((active ? 1 : 0) - this.weight) * dampFactor(8, dt);
    if (!active) {
      this.upperWeight = 0;
      this.state = null;
      this._oneShot = null;
      this.events.jump = this.events.stab = this.events.shot = this.events.hit = false;
      this.events.land = 0;
      return;
    }
    this._chooseBase(dt, ctx);
    this._chooseUpper(dt, ctx);
    this.base.mixer.update(dt);
    this.upper.mixer.update(dt);
    this.events.jump = this.events.stab = this.events.shot = this.events.hit = false;
    this.events.land = 0;
  }

  _set(ctx) {
    if (ctx.hold === 'pistol') return 'pistol_';
    if (ctx.hold === 'long') return 'rifle_';
    return '';
  }

  _chooseBase(dt, ctx) {
    const ev = this.events;
    let name = null, ts = 1, fade = 0.22, offset = 0, restart = false;
    // Clipe de uma vez em andamento (pulo, aterrissagem, parada) tem prioridade até terminar.
    const os = this._oneShot;
    if (os) {
      os.t += dt;
      const done = os.t >= os.until || (os.cancel && os.cancel(ctx));
      if (!done) return;
      this._oneShot = null;
    }
    if (ctx.mode === 'dead') name = 'dying';
    else if (ctx.mode === 'getup') {
      // Getting Up: do trecho em que ele está de bruços até ficar de pé.
      name = 'getup'; offset = 2.1; ts = 2.0; fade = 0.05;
    } else if (ctx.mode === 'climb') {
      // Trecho do Swimming To Edge em que ele chega e agarra a borda (o começo é nado).
      name = 'swim_to_edge'; offset = 1.55; ts = 1.25; fade = 0.2;
    }
    else if (ctx.mode === 'swim') {
      if (ctx.speed > 0.3) { name = 'swim'; ts = clamp(ctx.speed / Math.max(0.5, this.clips.get('swim')?.userData.speed || 1), 0.6, 2.2); }
      else name = 'tread_water';
    } else {
      // A pé.
      if (!ctx.grounded) this._air += dt; else this._air = 0;
      if (ev.jump && this.has('jump')) { this._startOneShot('jump', { offset: 0.18, until: 0.55, ts: 1.15 }); return; }
      if (ev.land > 0 && this.has('land')) { this._startOneShot('land', { offset: 0.42, until: 0.5, ts: 1.25, fade: 0.08 }); return; }
      if (!ctx.grounded && (ctx.vy < -2 || this._air > 0.45)) { name = 'fall'; fade = 0.3; }
      else {
        const set = this._set(ctx);
        const moving = ctx.speed > 0.35;
        const prev = this.state;
        if (!moving) {
          name = (ctx.hold === 'knife' ? 'knife_idle' : set + 'idle');
          // Fuzil: passo de parada ao soltar depois de andar.
          if (set === 'rifle_' && prev === 'rifle_walk' && this.has('rifle_walk_stop')) {
            this._startOneShot('rifle_walk_stop', { offset: 1.25, until: 1.1, ts: 1.15, fade: 0.2, cancel: c => c.speed > 0.35 });
            return;
          }
        } else {
          const back = ctx.strafe && ctx.fwd < -0.3 && Math.abs(ctx.fwd) >= Math.abs(ctx.side) * 0.8;
          const side = ctx.strafe && !back && Math.abs(ctx.side) > Math.abs(ctx.fwd) * 1.2;
          const run = ctx.speed > (ctx.walkSpeed + ctx.runSpeed) / 2;
          if (back) name = set + 'walk_back';
          else if (side) name = set + (ctx.side > 0 ? 'strafe_left' : 'strafe_right');
          else name = set + (run ? 'run' : 'walk');
          const natural = this.clips.get(name)?.userData.speed || 0;
          if (natural > 0.1) ts = clamp(ctx.speed / natural, 0.55, 2.2);
          fade = 0.18;
        }
      }
    }
    if (name && !this.has(name)) name = name.replace(/^(pistol|rifle)_/, '');
    if (!name || !this.has(name)) return;
    const a = this.play('base', name, { fade, timeScale: ts, offset, restart });
    if (a) this.state = name;
  }

  _startOneShot(name, { offset = 0, until = 1, ts = 1, fade = 0.12, cancel = null } = {}) {
    this.play('base', name, { fade, timeScale: ts, offset, restart: true });
    this.state = name;
    this._oneShot = { name, t: 0, until, cancel };
  }

  _chooseUpper(dt, ctx) {
    const ev = this.events;
    let want = 0, name = null, ts = 1, restart = false;
    const set = this._set(ctx);
    const uo = this._upperOneShot;
    if (uo) {
      uo.t += dt;
      if (uo.t >= uo.until) this._upperOneShot = null;
    }
    if (ctx.mode === 'foot') {
      if (ev.stab && this.has('knife_stab')) { this._upperOneShot = { name: 'knife_stab', t: 0, until: 1.05 }; name = 'knife_stab'; ts = 1.9; restart = true; }
      else if (ev.hit && this.has('hit') && !ctx.hold && !this._upperOneShot) { this._upperOneShot = { name: 'hit', t: 0, until: 0.85 }; name = 'hit'; ts = 1.5; restart = true; }
      if (this._upperOneShot) { want = 1; name = name || null; }
      else if (ctx.reload >= 0 && ctx.hold === 'long' && this.has('rifle_reload')) {
        name = 'rifle_reload'; want = 1;
        ts = this.clips.get('rifle_reload').duration / Math.max(0.5, ctx.reloadDur || 2);
        if (this.upperState !== 'rifle_reload') restart = true;
      } else if (set && (ctx.aim > 0.5 || ctx.firing)) {
        want = 1;
        name = ctx.firing ? set + (set === 'rifle_' ? 'fire' : 'shoot') : set + 'aim';
        if (!this.has(name)) name = set + 'aim';
      }
    }
    // Recarga de pistola: braços na pose procedural (a mão de apoio vai ao carregador).
    this.armsProcedural += ((ctx.mode === 'foot' && ctx.reload >= 0 && ctx.hold === 'pistol' ? 1 : 0) - this.armsProcedural) * dampFactor(10, dt);
    this.upperWeight += (want - this.upperWeight) * dampFactor(want ? 14 : 6, dt);
    if (name && this.has(name)) {
      this.play('upper', name, { fade: restart ? 0.08 : 0.15, timeScale: ts, restart });
      this.upperState = name;
    } else if (!want) this.upperState = null;
  }

  /** Peso total imediatamente (troca sem mistura, ex.: começar a levantar já deitado). */
  snap() {
    this.weight = 1;
  }

  /** Mistura a pose dos clipes sobre a pose procedural já aplicada nas articulações. */
  apply(aimPitch = 0) {
    if (!this.ready) return;
    if (this.weight < 0.001) { this.joints.hips.position.z = 0; return; }
    const w = this.weight, wu = this.upperWeight * w;
    const B = this.base.joints, U = this.upper.joints;
    for (const name of RIG_JOINTS) {
      const j = this.joints[name];
      const wb = ARMS.has(name) ? w * (1 - this.armsProcedural) : w;
      if (wb > 0.001) j.quaternion.slerp(B[name].quaternion, wb);
    }
    if (wu > 0.001) {
      for (const name of UPPER) {
        const wa = ARMS.has(name) ? wu * (1 - this.armsProcedural) : wu;
        if (wa > 0.001) this.joints[name].quaternion.slerp(U[name].quaternion, wa);
      }
      // Mira para cima/baixo: o tronco acompanha a câmera.
      if (Math.abs(aimPitch) > 0.001) {
        _q.setFromAxisAngle(_x, -aimPitch * 0.45 * wu);
        this.joints.chest.quaternion.multiply(_q);
        _q2.setFromAxisAngle(_x, -aimPitch * 0.25 * wu);
        this.joints.spine.quaternion.multiply(_q2);
      }
    }
    const hp = this.joints.hips.position, bp = B.hips.position;
    hp.x += (bp.x - hp.x) * w;
    hp.y += (bp.y + (this.hipsOffsetY || 0) - hp.y) * w;
    hp.z = bp.z * w; // o procedural não usa z
  }
}
