import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { CAMERA_MODES } from '../camera/CameraManager.js';
import { WeaponInventory } from './WeaponInventory.js';
import { WeaponView } from './WeaponView.js';
import { WeaponEffects } from './WeaponEffects.js';
import { WeaponAudio } from './WeaponAudio.js';
import { WeaponHUD } from './WeaponHUD.js';
import { WeaponWheel } from './WeaponWheel.js';
import { WeaponBallistics } from './WeaponBallistics.js';

/**
 * Sistema de armas (módulo independente). Ordem por quadro (Game.step):
 *   preUpdate(dt, input)  — antes do jogador: entrada, estado, pose dos braços,
 *                           orientação do corpo e mira da câmera;
 *   update(dt, input)     — depois da câmera: disparo, recarga, arma na mão /
 *                           em 1ª pessoa, efeitos, alvos e HUD.
 *
 * Contextos: armas só funcionam a pé. Ao entrar num carro a arma é guardada
 * (inventário, munição e seleção preservados) e volta à mão ao sair.
 * R recarrega a pé com arma sacada; no carro continua sendo "recuperar".
 */
const SLOT_ACTIONS = ['weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5', 'weapon6', 'weapon7', 'weapon8'];
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();

export class WeaponManager {
  constructor(game) {
    this.game = game;
    this.inv = new WeaponInventory();
    if (CONFIG.weapons.grantAll) this.inv.grantAll();
    this.view = new WeaponView(game.scene);
    this.effects = new WeaponEffects(game.scene);
    this.audio = new WeaponAudio(game.audio);
    this.hud = new WeaponHUD(game.hud.el, this.inv);
    // Roleta de armas (segurar TAB) — substitui a lista de cartões da seleção rápida.
    this.wheel = new WeaponWheel(game.hud.el, this.inv, game.renderer);
    this.ballistics = new WeaponBallistics(game);

    this.state = 'holstered'; // holstered | drawing | ready | holstering
    this.drawK = 0;
    this.selected = null;
    this.pendingSelect = null;
    this.aimHeld = false;
    this.aim = 0;
    this.cooldown = 0;
    this.bloom = 0;
    this.kick = 0;
    this.slideK = 0;
    this.slideLocked = false;
    this.boltK = 0;
    this.boltT = -1;
    this.magK = 0;
    this.pumpT = -1;
    this.reload = null;
    this.hipFireT = 0;
    this.emptyLatch = false;
    this.inVehicle = false;
    this.wasDrawnBeforeVehicle = false;
    this.quickOpen = false;
    this.onFoot = true;
    this.range = null;
    this._rangeMap = null;
    this.aimPoint = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this._muzzle = new THREE.Vector3();
    this._palm = new THREE.Vector3();
    this._holster = new THREE.Matrix4();
    this._fpOffset = new THREE.Vector3();
    this._sway = new THREE.Vector2();
    this._bobT = 0;
    this.stats = { shots: 0, hits: 0, targetHits: 0, reloads: 0, lastHit: null };
    this._ra = WeaponBallistics.makeResult();
    this._rb = WeaponBallistics.makeResult();
    this._hitPoint = new THREE.Vector3();
    this._toHit = new THREE.Vector3();
    if (CONFIG.weapons.startWith) this.select(CONFIG.weapons.startWith, { draw: false });
  }

  // ------------------------------------------------------------ consultas
  get def() {
    return this.selected?.def || null;
  }

  get drawn() {
    return this.state === 'ready' || this.state === 'drawing';
  }

  get reserve() {
    return this.def ? this.inv.reserve[this.def.category] : 0;
  }

  get fpActive() {
    const c = this.game.cameras;
    return c.mode === CAMERA_MODES.FIRST && !c.transition;
  }

  // -------------------------------------------------------------- ações
  select(id, { draw = true } = {}) {
    const e = this.inv.get(id);
    if (!e) return false;
    if (this.selected === e) {
      if (!this.drawn && draw) this.draw();
      return true;
    }
    this.hud.flashQuick();
    if (this.drawn || this.state === 'holstering') {
      this.pendingSelect = id;
      this.holster();
      return true;
    }
    this._setSelected(e);
    if (draw) this.draw();
    return true;
  }

  /** Aplica a escolha da roleta: arma → equipa e saca; "Desarmado" → guarda a arma. */
  _applyWheel(item) {
    if (!item) return;
    if (!item.id) { if (this.drawn) this.holster(); return; }
    this.select(item.id, { draw: true });
  }

  _setSelected(e) {
    this.selected = e;
    this.view.setWeapon(e.def);
    this.reload = null;
    this.pumpT = -1;
    this.slideLocked = e.loaded === 0 && e.def.hold === 'pistol' && e.def.category === 'pistol';
    this.bloom = 0;
  }

  draw() {
    if (!this.selected) {
      const first = this.inv.list()[0];
      if (!first) return;
      this._setSelected(first);
    }
    if (this.state === 'ready' || this.state === 'drawing') return;
    this.state = 'drawing';
    this.audio.mech('equip');
  }

  holster() {
    if (this.state === 'holstered' || this.state === 'holstering') return;
    this.state = 'holstering';
    this.reload = null;
    this.audio.mech('holster');
  }

  _forceHolster() {
    this.state = 'holstered';
    this.drawK = 0;
    this.reload = null;
    this.pumpT = -1;
    this.aimHeld = false;
    this.aim = 0;
    this.pendingSelect = null;
  }

  startReload() {
    const d = this.def;
    if (d?.mode === 'melee') return false;
    if (!d || this.state !== 'ready' || this.reload || this.selected.loaded >= d.mag) return false;
    if (this.reserve <= 0) { this.audio.mech('empty'); return false; }
    this.reload = { t: 0, dur: d.reload, perRound: !!d.reloadPerRound, startedEmpty: this.selected.loaded === 0, ev: 0 };
    this.stats.reloads++;
    if (!this.reload.perRound) this.audio.mech('magOut');
    return true;
  }

  // ---------------------------------------------------- antes do jogador
  preUpdate(dt, input) {
    const g = this.game;
    // Sentado, em transição de porta/elevador ou com diálogo aberto num interior: sem mira nem disparo.
    // Nadando (PROMPT 11): sem armas na água.
    const onFoot = g.vehicles.interaction.onFoot && g.state === 'playing' && !g.mapLoading && !g.player.external && !g.interiors?.ui.open && !g.player.controller.swimming;
    this.onFoot = onFoot;
    // Veículos: guarda ao entrar, devolve à mão ao sair.
    if (!g.vehicles.interaction.onFoot) {
      if (!this.inVehicle) {
        this.inVehicle = true;
        this.wasDrawnBeforeVehicle = this.drawn;
        this._forceHolster();
      }
    } else if (this.inVehicle) {
      this.inVehicle = false;
      if (this.wasDrawnBeforeVehicle) this.draw();
    }

    // Roleta de armas: abre segurando TAB (a pé, em jogo); soltar o TAB ou clicar equipa.
    const tabDown = onFoot && g.state === 'playing' && input.isDown('quickSelect');
    if (tabDown && !this.wheel.open) this.wheel.show(this.drawn ? this.def?.id : null);
    let wheelBusy = false;
    if (this.wheel.open) {
      wheelBusy = true;
      if (!onFoot || g.state !== 'playing') this.wheel.hide(); // entrou num carro, menu, prisão...
      else {
        for (let i = 0; i < SLOT_ACTIONS.length; i++) {
          if (!input.wasPressed(SLOT_ACTIONS[i])) continue;
          const list = this.inv.bySlot(i + 1);
          if (list.length) this.wheel.pick(list[(list.findIndex((e) => e === this.selected) + 1) % list.length].def.id);
        }
        if (input.wasPressed('weaponNext')) this.wheel.step(1);
        if (input.wasPressed('weaponPrev')) this.wheel.step(-1);
        if (!tabDown || input.wasPressed('fire')) this._applyWheel(this.wheel.hide());
      }
      g.time.timeScale = this.wheel.timeScale;
    } else if (g.time.timeScale !== 1 && this._wheelSlowed) {
      g.time.timeScale = 1;
    }
    this._wheelSlowed = this.wheel.open;
    if (onFoot && wheelBusy) {
      this.quickOpen = true; // bloqueia disparo/mira neste quadro (inclui o clique que confirmou)
      this.aimHeld = false;
    } else if (onFoot) {
      this.quickOpen = false;
      for (let i = 0; i < SLOT_ACTIONS.length; i++) {
        if (!input.wasPressed(SLOT_ACTIONS[i])) continue;
        const list = this.inv.bySlot(i + 1);
        if (!list.length) continue;
        // Slot com duas armas (carabinas): alterna entre elas.
        const cur = list.findIndex((e) => e === this.selected);
        const next = list[(cur + 1) % list.length];
        this.select(next.def.id);
      }
      if (input.wasPressed('weaponNext') || input.wasPressed('weaponPrev')) {
        const id = this.inv.cycle(this.def?.id, input.wasPressed('weaponNext') ? 1 : -1);
        if (id) this.select(id);
      }
      if (input.wasPressed('holster')) { if (this.drawn) this.holster(); else this.draw(); }
      if (input.wasPressed('reload') && this.drawn) this.startReload();
      this.aimHeld = this.drawn && input.isDown('aim');
    } else {
      this.quickOpen = false;
      this.aimHeld = false;
    }

    // Pose dos braços (camada armada do animador).
    const W = g.player.animator.weapon;
    const d = this.def;
    W.hold = d && this.state !== 'holstered' && onFoot ? d.hold : null;
    W.draw = this.drawK;
    W.aim = Math.max(this.aim, this.hipFireT > 0 ? 0.85 : 0);
    W.pitch = -g.cameras.pitch + (this.fpActive ? 0 : 0.05);
    W.kick = this.kick;
    W.reload = this.reload ? this._reloadPhase() : -1;
    W.reloadDur = d?.reload || 2;
    W.stab = this.stabCount || 0;

    // Corpo acompanha a câmera ao mirar ou logo após atirar.
    g.player.setAimFacing(onFoot && this.drawn && (this.aimHeld || this.hipFireT > 0));
    g.cameras.aimTarget = onFoot && this.aimHeld ? 1 : 0;

    // Mão de apoio (GLB): IK até o guarda-mão / empunhadura da arma.
    const vis = g.player.visual;
    if (vis && g.player.modelMode === 'glb') {
      let wgt = 0;
      if (d && onFoot && this.state !== 'holstered' && this.view.current?.tp.root.visible) {
        wgt = d.hold === 'knife' ? 0 : this.drawK * (d.hold === 'long' ? 1 : Math.max(this.aim, this.hipFireT > 0 ? 0.85 : 0));
        if (this.reload) wgt *= 1 - Math.sin(Math.min(1, this._reloadPhase()) * Math.PI);
      }
      vis.leftHand.weight = wgt;
      if (wgt > 0.01) {
        // Ponto de apoio no modelo (quadro anterior), recuado até o pulso.
        this.view.anchorWorld('support', _v);
        const root = this.view.current.tp.root;
        _v2.set(0, 0.035, -0.035).applyQuaternion(root.quaternion);
        _v.add(_v2);
        vis.leftHand.local.copy(_v).applyMatrix4(_m.copy(vis.root.matrixWorld).invert());
      }
    }
  }

  _reloadPhase() {
    const r = this.reload;
    if (!r) return -1;
    if (r.perRound) return (r.t % r.dur) / r.dur;
    return r.t / r.dur;
  }

  // -------------------------------------------------- depois da câmera
  update(dt, input) {
    const g = this.game;
    const d = this.def;
    this._ensureRange();

    // Sacar / guardar.
    if (this.state === 'drawing') {
      this.drawK = Math.min(1, this.drawK + dt / (d?.hold === 'long' ? 0.55 : 0.35));
      if (this.drawK >= 1) this.state = 'ready';
    } else if (this.state === 'holstering') {
      this.drawK = Math.max(0, this.drawK - dt / (d?.hold === 'long' ? 0.45 : 0.3));
      if (this.drawK <= 0) {
        this.state = 'holstered';
        if (this.pendingSelect) {
          const e = this.inv.get(this.pendingSelect);
          this.pendingSelect = null;
          if (e) { this._setSelected(e); this.draw(); }
        }
      }
    }

    // Suavizações e decaimentos.
    this.aim += ((this.aimHeld ? 1 : 0) - this.aim) * Math.min(1, dt * 12);
    this.cooldown -= dt;
    if (this.cooldown < -1) this.cooldown = -1;
    if (this.hipFireT > 0) this.hipFireT -= dt;
    this.kick *= Math.exp(-dt * 14);
    if (d) this.bloom = Math.max(0, this.bloom - dt * Math.max(0.03, (d.maxBloom ?? 0.05) * 2.2));
    if (!this.slideLocked) this.slideK = Math.max(0, this.slideK - dt * 14);
    if (this.boltT >= 0) {
      this.boltT += dt / 0.09;
      this.boltK = Math.sin(Math.min(1, this.boltT) * Math.PI);
      if (this.boltT >= 1) { this.boltT = -1; this.boltK = 0; }
    }
    this._updatePump(dt);
    this._updateReload(dt);
    if (!input.isDown('fire')) this.emptyLatch = false;

    // Golpe de faca: contato um instante depois do início da facada.
    if (this.stabT > 0) this.stabT -= dt;
    if (this.meleeT > 0) {
      this.meleeT -= dt;
      if (this.meleeT <= 0 && d?.mode === 'melee' && this.onFoot) this._meleeHit(d);
    }

    // Disparo.
    if (d && this.onFoot && this.state === 'ready' && !this.quickOpen) {
      const pressed = input.wasPressed('fire');
      if (d.mode === 'melee') {
        if (pressed && this.cooldown <= 0) this._melee(d);
      } else if (d.mode === 'auto') {
        // Automática: até 2 disparos por quadro mantêm a cadência em 60 fps.
        for (let k = 0; k < 2 && input.isDown('fire') && this.cooldown <= 0 && this.state === 'ready'; k++) this._tryFire(pressed && k === 0);
        if (input.isDown('fire') && this.cooldown > 0) { /* aguardando a cadência */ }
      } else if (pressed) this._tryFire(true);
    }

    this._placeVisuals(dt);
    this.view.animateParts({ slide: this.slideK, mag: this.magK, pump: this.pumpT >= 0 ? Math.sin(Math.min(1, this.pumpT) * Math.PI) : 0, bolt: this.boltK }, dt);
    this.effects.update(dt, (x, z, y) => this.ballistics._groundY(x, z, y + 0.1));
    this.range?.update(dt);

    this.hud.update(dt, {
      visible: this.onFoot && g.state === 'playing',
      drawn: this.drawn,
      def: d,
      loaded: this.selected?.loaded ?? 0,
      reserve: this.reserve,
      reloadK: this.reload ? Math.min(1, this.reload.perRound ? this.selected.loaded / d.mag : this.reload.t / this.reload.dur) : -1,
      spreadPx: this._spreadPx(),
      aim: this.aim,
      quickOpen: this.quickOpen,
      selectedId: d?.id,
    });
  }

  _spreadPx() {
    const d = this.def;
    if (!d) return 0;
    const s = this._currentSpread();
    const cam = this.game.camera;
    return Math.min(60, (s / (cam.fov * Math.PI / 180 / 2)) * (innerHeight / 2));
  }

  _currentSpread() {
    const d = this.def;
    const c = this.game.player.controller;
    const speed = Math.hypot(c.velocity.x, c.velocity.z);
    const base = d.spread + (d.aimSpread - d.spread) * this.aim;
    const move = Math.min(1, speed / 7.4) * d.spread * 0.8;
    const air = c.grounded ? 0 : d.spread * 1.2;
    return base + move + air + this.bloom;
  }

  _updatePump(dt) {
    if (this.pumpT < 0) return;
    const before = this.pumpT;
    this.pumpT += dt / 0.42;
    if (before < 0.08 && this.pumpT >= 0.08) this.audio.mech('pump');
    if (before < 0.5 && this.pumpT >= 0.5) {
      // Cartucho vazio sai por baixo (ejeção inferior).
      this.view.anchorWorld('eject', _v, this.fpActive);
      _v2.set(0.3 + Math.random() * 0.4, -1.2, 0).applyQuaternion(this._weaponQuat());
      this.effects.eject(_v, _v2, true);
      this.audio.casing(true);
    }
    if (this.pumpT >= 1) this.pumpT = -1;
  }

  _updateReload(dt) {
    const r = this.reload;
    if (!r) return;
    const e = this.selected, d = e.def;
    const before = r.t;
    r.t += dt;
    if (r.perRound) {
      // Escopeta: um cartucho por ciclo, até encher ou acabar a reserva.
      const cyc = Math.floor(r.t / r.dur), prevCyc = Math.floor(before / r.dur);
      if ((before % r.dur) < r.dur * 0.5 && (r.t % r.dur) >= r.dur * 0.5) this.audio.mech('shell');
      if (cyc > prevCyc) {
        if (this.inv.reserve[d.category] > 0 && e.loaded < d.mag) { e.loaded++; this.inv.reserve[d.category]--; }
        if (e.loaded >= d.mag || this.inv.reserve[d.category] <= 0) {
          this.reload = null;
          if (r.startedEmpty) this.pumpT = 0;
        }
      }
      this.magK = 0;
      return;
    }
    const k = r.t / r.dur;
    const kb = before / r.dur;
    // Carregador: sai (0.1–0.35), fica fora (0.35–0.45), entra (0.45–0.65).
    this.magK = k < 0.1 ? 0 : k < 0.35 ? (k - 0.1) / 0.25 : k < 0.45 ? 1 : k < 0.65 ? 1 - (k - 0.45) / 0.2 : 0;
    if (kb < 0.55 && k >= 0.55) this.audio.mech('magIn');
    if (kb < 0.78 && k >= 0.78) {
      if (d.category === 'pistol') {
        if (r.startedEmpty) { this.slideLocked = false; this.audio.mech('slide'); }
      } else {
        this.boltT = 0;
        this.audio.mech('bolt');
      }
    }
    if (k >= 1) {
      const take = Math.min(d.mag - e.loaded, this.inv.reserve[d.category]);
      e.loaded += take;
      this.inv.reserve[d.category] -= take;
      this.reload = null;
      this.magK = 0;
      this.slideLocked = false;
    }
  }

  // ---------------------------------------------------------------- tiro
  _tryFire(pressed) {
    const e = this.selected, d = e.def;
    if (this.reload) {
      // Escopeta pode interromper a recarga para atirar.
      if (this.reload.perRound && e.loaded > 0 && pressed) this.reload = null;
      else return;
    }
    if (this.cooldown > 0 || this.pumpT >= 0) return;
    if (e.loaded <= 0) {
      if (!this.emptyLatch) {
        this.emptyLatch = true;
        this.audio.mech('empty');
        if (this.reserve > 0) this.startReload();
      }
      return;
    }
    e.loaded--;
    // Intervalo acumulado (sobra do quadro anterior conta), sem acumular parado.
    if (this.cooldown < -0.05) this.cooldown = 0;
    this.cooldown += 60 / d.rpm;
    this.stats.shots++;
    const g = this.game, cam = g.camera;

    // Raio da mira: câmera → retículo (em 3ª pessoa começa na altura do jogador).
    const dir = cam.getWorldDirection(_v).clone();
    const origin = _v2.copy(cam.position);
    if (!this.fpActive) {
      const chest = _v3.copy(g.player.visualPosition).setY(g.player.visualPosition.y + 1.3);
      const t0 = Math.max(0, chest.sub(cam.position).dot(dir));
      origin.addScaledVector(dir, t0);
    }
    const muzzle = this.view.muzzleWorld(this._muzzle, this.fpActive);
    const spread = this._currentSpread();
    const maxDist = d.range * 1.5;
    let firstImpact = true;
    for (let p = 0; p < d.pellets; p++) {
      const pd = this._spreadDir(dir, spread, p);
      let res = this.ballistics.cast(origin, pd, maxDist, { out: this._ra });
      const hitPoint = this._hitPoint;
      if (res.hit) hitPoint.copy(res.point); else hitPoint.copy(origin).addScaledVector(pd, maxDist);
      // Em 3ª pessoa, confere se algo bloqueia entre a boca do cano e o ponto.
      if (!this.fpActive) {
        const toHit = this._toHit.subVectors(hitPoint, muzzle);
        const len = toHit.length();
        if (len > 0.3) {
          toHit.divideScalar(len);
          const block = this.ballistics.cast(muzzle, toHit, len - 0.05, { out: this._rb });
          if (block.hit) { res = block; hitPoint.copy(block.point); }
        }
      }
      if (res.hit) this._applyHit(res, pd, d, firstImpact);
      if (res.hit) firstImpact = false;
      const tracerChance = d.mode === 'auto' ? 0.5 : d.pellets > 1 ? 0.25 : 0.3;
      if (Math.random() < tracerChance) this.effects.tracer(muzzle, hitPoint);
    }
    // Recuo, clarão, som, cápsula.
    this.bloom = Math.min(d.maxBloom ?? 0.06, this.bloom + d.bloom);
    this.kick = Math.min(1.4, this.kick + 1);
    g.cameras.addRecoil(d.recoil * 0.011 * (this.aim > 0.5 ? 0.7 : 1), (Math.random() - 0.5) * d.recoil * 0.006);
    this.hipFireT = 0.7;
    this.view.flash(d.hold === 'long' ? 1.2 : 1);
    this.effects.muzzle(muzzle, _q.copy(this._weaponQuat()) && _v3.set(0, 0, 1).applyQuaternion(_q), d.pellets > 1 ? 1.6 : d.hold === 'long' ? 1.2 : 0.9);
    this.audio.shot(d.sound, d.category);
    // Evento genérico para a cidade (pedestres e motoristas reagem).
    this.game.city?.events.emit('gunshot', { x: muzzle.x, y: muzzle.y, z: muzzle.z, weapon: d.id });
    if (d.mode === 'pump') {
      if (e.loaded > 0) this.pumpT = 0;
    } else {
      this.view.anchorWorld('eject', _v, this.fpActive);
      const wq = this._weaponQuat();
      _v2.set(-1.4 - Math.random() * 0.8, 1.2 + Math.random() * 0.6, -0.4 + Math.random() * 0.3).applyQuaternion(wq);
      const pv = g.player.controller.velocity;
      _v2.x += pv.x; _v2.z += pv.z;
      this.effects.eject(_v, _v2, false);
      this.audio.casing(false);
      if (d.category === 'pistol') this.slideK = 1;
      else this.boltT = 0;
    }
    if (e.loaded === 0 && d.category === 'pistol') { this.slideLocked = true; this.slideK = 1; }
  }

  /** Facada: animação (contador lido pelo PlayerClips) e contato agendado. */
  _melee(d) {
    this.cooldown = 60 / d.rpm;
    this.stabCount = (this.stabCount || 0) + 1;
    this.meleeT = d.hitDelay ?? 0.3;
    this.stabT = 0.9;
    this.hipFireT = 0.7; // o corpo vira para a mira, como ao atirar
    this.audio.mech('holster');
  }

  _meleeHit(d) {
    const g = this.game, p = g.player;
    const origin = _v2.copy(p.visualPosition).setY(p.visualPosition.y + 1.25);
    // Na direção da mira (câmera) se estiver mirando; senão para onde o corpo olha.
    const dir = _v3;
    if (this.aim > 0.5) { g.camera.getWorldDirection(dir); dir.y = Math.max(-0.5, Math.min(0.5, dir.y)); }
    else dir.set(Math.sin(p.controller.yaw), -0.08, Math.cos(p.controller.yaw));
    dir.normalize();
    this.stats.shots++;
    for (const side of [0, -0.25, 0.25]) {
      const pd = dir.clone().applyAxisAngle(UP, side);
      const res = this.ballistics.cast(origin, pd, d.range, { out: this._ra });
      if (!res.hit) continue;
      this._applyHit(res, pd, d, true);
      if (res.target) g.city?.events.emit('crime', { source: 'player', severity: 2, x: res.point.x, y: res.point.y, z: res.point.z });
      break;
    }
  }

  _spreadDir(dir, spread, i) {
    // Cone uniforme (disco) em torno da direção.
    const r = spread * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2 + i * 2.4;
    const right = _v3.crossVectors(dir, UP);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    return dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  }

  _applyHit(res, dir, d, sound) {
    const dist = res.t;
    const fall = dist <= d.falloff ? 1 : dist >= d.range ? 0.4 : 1 - 0.6 * (dist - d.falloff) / (d.range - d.falloff);
    const damage = d.damage * fall;
    const props = (this.game.mapEnv || this.game.world).destruction;
      if (res.collider?.ownerId) this.game.city?.police?.hitVehicle(res.collider.ownerId, damage);
      const breakable = res.collider?.destructible, intact = breakable && !breakable.broken;
    if (props?.damageCollider(res.collider, { damage, direction: dir, point: res.point, force: Math.min(5, damage * 0.07) })) this.hud.hitMarker(false);
      if (intact && breakable.broken) this.game.city?.events.emit('crime', { source: 'player', severity: 1, x: res.point.x, y: res.point.y, z: res.point.z });
    this.stats.hits++;
    let kill = false;
    if (res.target?.onHit) {
      const r = res.target.onHit({ damage, point: res.point, dir, distance: dist, weapon: d.id });
      kill = !!r?.kill;
      this.stats.targetHits++;
      this.hud.hitMarker(kill);
    }
    this.stats.lastHit = { material: res.material, distance: +dist.toFixed(2), damage: +damage.toFixed(1), target: !!res.target };
    this.effects.impact(res.point, res.normal, res.material, d.pellets > 1 ? 0.6 : 1);
    if (sound) {
      const cam = this.game.camera;
      const toHit = _v3.subVectors(res.point, cam.position);
      const right = _v.set(1, 0, 0).applyQuaternion(cam.quaternion);
      this.audio.impact(res.material, toHit.length(), toHit.normalize().dot(right));
    }
  }

  // --------------------------------------------------------- visual
  /** Orientação mundial atual da arma de 3ª pessoa (ou da câmera em 1ª). */
  _weaponQuat() {
    const c = this.view.current;
    if (!c) return this.game.camera.quaternion;
    return this.fpActive ? c.fp.root.quaternion : c.tp.root.quaternion;
  }

  _placeVisuals(dt) {
    const g = this.game, d = this.def;
    if (!d || this.inVehicle || !this.view.current) { this.view.hide(); return; }
    const player = g.player, cam = g.camera;
    const fp = this.fpActive;

    // Ponto de mira (para orientar a arma em 3ª pessoa).
    cam.getWorldDirection(this.aimDir);
    const res = this.ballistics.cast(cam.position, this.aimDir, 120);
    if (res.hit && res.t > 2) this.aimPoint.copy(res.point); else this.aimPoint.copy(cam.position).addScaledVector(this.aimDir, 60);

    // Palma da mão direita.
    const wrist = player.getAttachBone('wristR');
    wrist.updateWorldMatrix(true, false);
    this._palm.set(0, -player.palmOffset, 0.012).applyMatrix4(wrist.matrixWorld);
    if (d.hold === 'knife') {
      // Faca: segue o punho (a lâmina acompanha a facada da animação).
      // Cabo atravessado no punho fechado: lâmina para a frente da mão.
      wrist.getWorldQuaternion(_q);
      const bone = player.getAttachBone('hips');
      bone.updateWorldMatrix(true, false);
      _e.set(Math.PI / 2 + 0.2, 0, 0, 'XYZ');
      _q2.setFromEuler(_e);
      _m.compose(_v.set(-0.18, -0.04, 0.06), _q2, _v2.set(1, 1, 1));
      this._holster.multiplyMatrices(bone.matrixWorld, _m);
      this.view.placeThird({ visible: !this.fpActive, palm: this._palm, quat: _q, holsterMatrix: this._holster, drawK: this.drawK });
      const st = this.stabT > 0 ? Math.sin((1 - this.stabT / 0.9) * Math.PI) : 0;
      const vm = d.viewmodel;
      this.view.setFPSupport(false);
      this.view.placeFirst({ visible: this.fpActive && this.drawK > 0.02, camera: cam, offset: this._fpOffset.set(vm.hip[0] - st * 0.1, vm.hip[1] + st * 0.06 - (1 - this.drawK) * 0.25, vm.hip[2] - st * 0.22), yawIn: 0.15, kick: 0, roll: st * 0.4 });
      return;
    }

    // Orientação: pronta baixa ↔ mira no ponto do retículo.
    const yaw = player.controller.yaw;
    _e.set(d.hold === 'long' ? 0.32 : 0.6, yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    const aimW = Math.max(this.aim, this.hipFireT > 0 ? 1 : 0);
    if (aimW > 0.001) {
      _m.lookAt(this.aimPoint, this._palm, UP);
      _q2.setFromRotationMatrix(_m);
      _q.slerp(_q2, aimW);
    }
    // Recuo: cano sobe e a arma recua.
    if (this.kick > 0.01) {
      _q2.setFromAxisAngle(_v.set(1, 0, 0), -this.kick * 0.22 * d.recoil);
      _q.multiply(_q2);
      this._palm.addScaledVector(_v.set(0, 0, -1).applyQuaternion(_q), this.kick * 0.025 * d.recoil);
    }

    // Coldre: quadril direito (pistolas/compactas) ou costas (armas longas).
    const long = d.hold === 'long';
    const bone = player.getAttachBone(long ? 'chest' : 'hips');
    bone.updateWorldMatrix(true, false);
    if (long) {
      _e.set(0.0, Math.PI / 2, 0.85, 'ZYX');
      _q2.setFromEuler(_e);
      _m.compose(_v.set(0.02, 0.3, -0.19), _q2, _v2.set(1, 1, 1));
    } else {
      _e.set(Math.PI / 2 - 0.1, 0, 0, 'XYZ');
      _q2.setFromEuler(_e);
      _m.compose(_v.set(-0.19, -0.02, 0.03), _q2, _v2.set(1, 1, 1));
    }
    this._holster.multiplyMatrices(bone.matrixWorld, _m);

    this.view.placeThird({ visible: !fp, palm: this._palm, quat: _q, holsterMatrix: this._holster, drawK: this.drawK });

    // 1ª pessoa: balanço ao andar, inércia do mouse, mira centralizada.
    const c = player.controller;
    const speed = Math.hypot(c.velocity.x, c.velocity.z);
    this._bobT += dt * (2 + speed * 1.6);
    const bob = Math.min(1, speed / 4) * (1 - this.aim * 0.8);
    const vm = d.viewmodel;
    // Na mira, a alça de mira fica exatamente no centro da tela.
    const an = this.view.current.tp.anchors;
    const aimY = -(an.sight.y - an.grip.y) - 0.004;
    const o = this._fpOffset.set(
      vm.hip[0] - vm.hip[0] * this.aim + Math.sin(this._bobT) * 0.012 * bob,
      vm.hip[1] + (aimY - vm.hip[1]) * this.aim + Math.abs(Math.cos(this._bobT)) * 0.01 * bob - (1 - this.drawK) * 0.25,
      vm.hip[2] + (vm.aim[2] - vm.hip[2]) * this.aim + this.kick * 0.045 * d.recoil,
    );
    if (this.reload) o.y -= Math.sin(Math.min(1, this._reloadPhase()) * Math.PI) * 0.06;
    this.view.setFPSupport(this.aim > 0.3 || this.hipFireT > 0);
    this.view.placeFirst({ visible: fp && this.drawK > 0.02, camera: cam, offset: o, yawIn: 0.1 * (1 - this.aim), kick: this.kick * d.recoil, roll: this.reload ? -0.35 * Math.sin(Math.min(1, this._reloadPhase()) * Math.PI) : 0 });
  }

  // ------------------------------------------------------- área de testes
  _ensureRange() {
    // Área de testes: só em desenvolvimento (import dinâmico eliminado do build).
    if (!import.meta.env.DEV || !CONFIG.weapons.targetRange) return;
    const id = this.game.maps?.activeId || CONFIG.map.id;
    if (id === this._rangeMap || this.game.mapLoading) return;
    if (this.range) { this.ballistics.targets.delete(this.range); this.range.dispose(); this.range = null; }
    this._rangeMap = id;
    const spot = CONFIG.weapons.rangeSpots[id];
    if (!spot) return;
    const col = this.game.player.controller.collision;
    const groundY = col ? col.getGroundHeight(spot.x, spot.z, 50, 0) : 0;
    import('./TargetRange.js').then(({ TargetRange }) => {
      if (this._rangeMap !== id || this.range) return;
      this.range = new TargetRange(this.game.scene, { ...spot, groundY });
      this.ballistics.targets.add(this.range);
    });
  }

  dispose() {
    if (this.range) { this.range.dispose(); this.range = null; }
    this.view.dispose();
    this.effects.dispose();
    this.hud.dispose();
  }
}
