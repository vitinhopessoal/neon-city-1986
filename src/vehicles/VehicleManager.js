import * as THREE from 'three';
import { VehiclePhysics } from './VehiclePhysics.js';
import { VehicleAnimation } from './VehicleAnimation.js';
import { VehicleDamage } from './VehicleDamage.js';
import { VehicleEffects } from './VehicleEffects.js';
import { VehicleAudio } from './VehicleAudio.js';
import { VehicleCamera } from './VehicleCamera.js';
import { VehicleInteraction, PLAYER_STATES } from './VehicleInteraction.js';
import { PlayerDriver } from './VehicleController.js';
import { VehicleHUD } from '../ui/VehicleHUD.js';
import { SPECS } from './VehicleFactory.js';
import { clamp } from '../utils/math.js';

/**
 * Orquestra o sistema automotivo (independente do cenário):
 *  - liga física, animação e danos aos veículos do mapa ativo (env.vehicles)
 *  - passo fixo da física apenas para veículos acordados (estacionados dormem)
 *  - comandos do jogador → controles abstratos; impactos → danos, som, câmera
 *  - efeitos (marcas de pneu, fumaça), faróis automáticos, áudio, HUD
 *  - recuperação segura (R) de veículos presos
 * Mapas sem veículos (ex.: TEST CITY sem pontos adequados) simplesmente não
 * os recebem; o sistema não presume ruas.
 */
const _v = new THREE.Vector3();

export class VehicleManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.env = null;
    this.effects = new VehicleEffects(game.scene, game.world.lib);
    this.audio = new VehicleAudio(game.audio);
    this.camera = new VehicleCamera(game.world.collision);
    this.hud = new VehicleHUD(game.hud.el);
    this.driver = new PlayerDriver();
    this.interaction = new VehicleInteraction(this);
    this.recoverCooldown = 0;
    this.stats = { physicsSteps: 0, awake: 0 };
    // Um único foco de farol (somente o carro do jogador, à noite).
    this.beam = new THREE.SpotLight(0xfff1d8, 0, 38, 0.5, 0.55, 1.6);
    this.beam.castShadow = false;
    // Sempre presente na cena (intensidade 0 quando desligado): a contagem de
    // luzes não muda, então ligar os faróis não força recompilar shaders.
    this.beamTarget = new THREE.Object3D();
    this.beam.target = this.beamTarget;
    game.scene.add(this.beam, this.beamTarget);
    this._lodTimer = 0;
    game.cameras.vehicleRig = this.camera;
  }

  get playerVehicle() {
    return this.interaction.vehicle;
  }

  get state() {
    return this.interaction.state;
  }

  /** Mapa ativo mudou: troca a lista de veículos e as colisões usadas. */
  onMapActivated(env) {
    if (this.interaction.vehicle) this.interaction.forceExit();
    // Veículos criados para um mapa importado anterior: descartados com ele.
    if (this._spawned && this._spawnedEnv !== env) {
      for (const v of this._spawned) this.game.world.vehicleFactory.dispose(v);
      this._spawned = null;
      this._spawnedEnv = null;
    }
    this.env = env;
    // Mapas sem veículos próprios (importados): pontos do manifesto ou busca segura.
    if (!env.vehicles && env.isImported) env.vehicles = this._spawnForImported(env);
    this.list = env.vehicles || [];
    this.camera.collision = env.collision;
    this._byId = new Map(this.list.map((v) => [v.id, v]));
    for (const v of this.list) {
      if (!v.physics) {
        v.physics = new VehiclePhysics(v, env.collision, env);
        v.physics.syncFromRoot();
        v.animation = new VehicleAnimation(v);
        v.damage = new VehicleDamage(v);
      } else {
        v.physics.setEnvironment(env, env.collision);
      }
      v.physics.resolveOther = (id) => this._byId.get(id)?.physics || null;
    }
    this.effects.clear();
  }

  /**
   * Veículos para mapas importados SEM alterar o mapa: usa manifest.vehicleSpawns
   * quando existir; senão procura, em anéis ao redor do spawn, pontos planos,
   * livres de colisão (com folga), fora da água e longe do jogador.
   */
  _spawnForImported(env) {
    const col = env.collision;
    const sp = env.spawnPoint;
    const defs = [
      { type: 'sports', color: 0xf2eee6, stripe: 0xff5fa8, plate: 'TEST 01' },
      { type: 'sedan', color: 0xd6c29a, plate: 'TEST 02' },
    ];
    const factory = this.game.world.vehicleFactory;
    const group = this._spawnGroup || (this._spawnGroup = new THREE.Group());
    if (!group.parent) this.game.scene.add(group);
    const out = [];
    const used = [];
    const manual = env.manifest?.vehicleSpawns;
    const tryPlace = (spec, x, z, heading) => {
      const s = SPECS[spec.type];
      const dims = { width: s.width, length: s.length, height: s.height };
      if (Math.hypot(x - sp.x, z - sp.z) < 6) return null;
      if (used.some((u) => Math.hypot(u.x - x, u.z - z) < 7)) return null;
      const base = env.groundAt ? env.groundAt(x, z) : col.getGroundHeight(x, z, 0.5, 0.4);
      // Plano: as quatro rodas no mesmo nível (±8 cm).
      const c = Math.cos(heading), si = Math.sin(heading);
      for (const [lx, lz] of [[0.8, 1.3], [-0.8, 1.3], [0.8, -1.3], [-0.8, -1.3]]) {
        const wx = x + lx * c + lz * si, wz = z - lx * si + lz * c;
        const gy = env.groundAt ? env.groundAt(wx, wz) : col.getGroundHeight(wx, wz, base + 0.4, 0.4);
        if (Math.abs(gy - base) > 0.08) return null;
      }
      if (env.waterDepth && env.waterDepth(x, z) > 0.1) return null;
      if (env.boundaryHint && env.boundaryHint(x, z, 3)) return null;
      const body = { x, z, rot: heading, hx: dims.width / 2 + 0.6, hz: dims.length / 2 + 0.8 };
      if (col.resolveOBB(body, base, dims.height, 0.32, null, this._tmpContacts || (this._tmpContacts = []), 1) > 0) return null;
      return base;
    };
    defs.forEach((spec, i) => {
      let placed = null;
      const list = manual ? manual.filter((m) => !m.type || m.type === spec.type) : null;
      if (list?.length) {
        const m = list[i % list.length];
        const y = tryPlace(spec, m.x, m.z, m.heading ?? 0);
        if (y !== null) placed = { x: m.x, y, z: m.z, heading: m.heading ?? 0 };
      }
      for (let r = 8; !placed && r <= 70; r += 4) {
        for (let k = 0; k < 24 && !placed; k++) {
          const a = (k / 24) * Math.PI * 2 + i * 0.4;
          const x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r;
          for (const h of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            const y = tryPlace(spec, x, z, h);
            if (y !== null) { placed = { x, y, z, heading: h }; break; }
          }
        }
      }
      if (!placed) return; // sem área adequada: não cria veículo dentro de construções
      const v = factory.create(spec.type, { id: `${env.id || 'imported'}_veh_${i}`, color: spec.color, stripe: spec.stripe, plate: spec.plate });
      group.add(v.root);
      v.setPose(placed.x, placed.y, placed.z, placed.heading);
      v.attachCollider(col);
      used.push(placed);
      out.push(v);
    });
    this._spawned = out;
    this._spawnedEnv = env;
    return out;
  }

  /**
   * Registra um veículo criado em tempo de execução (trânsito): física,
   * animação e danos iguais aos dos demais; o jogador pode usá-lo quando
   * estiver estacionado.
   */
  addVehicle(v) {
    const env = this.env;
    if (!env) return;
    if (!v.physics) {
      v.physics = new VehiclePhysics(v, env.collision, env);
      v.animation = new VehicleAnimation(v);
      v.damage = new VehicleDamage(v);
    } else v.physics.setEnvironment(env, env.collision);
    v.physics.syncFromRoot();
    v.physics.resolveOther = (id) => this._byId.get(id)?.physics || null;
    if (!this.list.includes(v)) this.list.push(v);
    this._byId.set(v.id, v);
  }

  /** Remove da simulação um veículo do trânsito (não o do jogador). */
  removeVehicle(v) {
    if (v === this.interaction.vehicle) return false;
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    this._byId.delete(v.id);
    return true;
  }

  // ----------------------------------------------- eventos da interação

  onEnterStart(v) {
    this.driver.reset(v);
    if (v.collider) v.collider.cameraBlocker = false; // a câmera não colide com o próprio carro
    this.camera.attach(v);
  }

  startEngine(v) {
    v.engineOn = true;
    v.state = 'driven';
    this.audio.start(v);
    this.hud.show(v);
    this.game.hud.setHelpMode('vehicle');
    this.game.hud.toast(`${v.spec.model.toUpperCase()} · motor ligado`, 1.6);
  }

  stopEngine(v) {
    v.engineOn = false;
    Object.assign(v.controls, { throttle: 0, brake: 0, steer: 0, handbrake: true });
    this.audio.stop();
    this.hud.hide();
    this.game.hud.setHelpMode('foot');
    v.headlightsOn = false;
  }

  onExitDone(v) {
    v.driver = null;
    v.state = 'parked';
    v.controls.handbrake = true;
    v.controls.brake = 1;
    if (v.collider) v.collider.cameraBlocker = true;
    this.camera.detach();
    this.beam.intensity = 0;
    this.beamOn = false;
    for (const s of ['rl', 'rr']) this.effects.endSkid(`${v.id}:${s}`);
  }

  setCameraBlend(b) {
    this.game.cameras.vehicleBlend = b;
  }

  // ------------------------------------------------------------ quadro

  /** Antes do jogador: estados de interação (entrar/sair). */
  preUpdate(dt, input) {
    this.interaction.update(dt, input);
  }

  update(dt, input) {
    const pv = this.interaction.vehicle;
    const driving = this.interaction.state === PLAYER_STATES.DRIVING;
    if (pv) {
      // inputLocked: oficina de personalização (carro parado na baia, sem comandos do jogador).
      if (driving && this.inputLocked) Object.assign(pv.controls, { throttle: 0, brake: 1, steer: 0, handbrake: true });
      else if (driving && this.game.state === 'playing') this.driver.update(dt, input, pv);
      else if (this.interaction.state === PLAYER_STATES.ENTERING_VEHICLE) Object.assign(pv.controls, { throttle: 0, brake: 1, steer: 0, handbrake: true });
      if (driving) this.audio.horn(input.isDown('horn'));
      if (driving && input.wasPressed('horn')) this.game.city?.events.emit('horn', { x: pv.root.position.x, z: pv.root.position.z, source: 'player' });
      if (driving && input.wasPressed('recover')) this.tryRecover(pv);
    }
    if (this.recoverCooldown > 0) this.recoverCooldown -= dt;

    const cam = this.game.camera.position;
    let steps = 0, awake = 0;
    const lamps = this.game.world.environment.preset.lamps ?? 0;
    for (const v of this.list) {
      const ph = v.physics;
      if (!ph) continue;
      if (ph.awake) awake++;
      steps += ph.update(dt);
      const isPlayer = v === pv;
      if (ph.externalImpact > 0) {
        // Atingido por outro veículo: dano e reação visual proporcionais.
        v.damage.applyImpact(ph.externalImpact, 0);
        v.animation.jolt(ph.externalImpact, 0, 0.5);
        ph.externalImpact = 0;
      }
      if (ph.awake || isPlayer) {
        v.syncCollider(ph.x, ph.y, ph.z, ph.heading);
        this._handleImpact(v, isPlayer);
        this._skids(v);
        this._stuck(v, dt);
      }
      // Animação: veículos acordados, o do jogador ou com portas/faróis em movimento.
      const near = cam.distanceToSquared(v.root.position) < 140 * 140;
      if (near && (ph.awake || isPlayer || v.doors.some((d) => d.open !== d.target) || v.popups.length)) v.animation.update(dt, isPlayer);
      v.damage.update(dt);
      // Faróis automáticos apenas no carro em uso (entardecer e noite).
      v.headlightsOn = isPlayer && v.engineOn && lamps >= 0.5;
      if (v.damage.critical && near) {
        _v.set(0, v.spec.height * 0.75, v.spec.length * 0.32).applyMatrix4(v.root.matrixWorld);
        this.effects.emitSmoke(_v.x, _v.y, _v.z, 4 * (1 - v.damage.integrity / 30) + 1.5, dt);
      }
    }
    this.stats.physicsSteps = steps;
    this.stats.awake = awake;
    // O personagem foi posicionado antes da física deste quadro; reposiciona
    // no banco com a pose final da carroceria (sem atraso de um quadro, que
    // a 70 km/h deslocava o motorista ~30 cm para trás).
    if (driving) this.interaction.postPhysics();
    this.effects.update(dt);
    this._beam(pv, lamps);
    this._lod(dt, pv);
    if (pv) this.audio.update(dt, pv);
    this.hud.update(dt);
  }

  _beam(pv, lamps) {
    const q = this.game.quality;
    const on = !!pv && pv.headlightsOn && !pv.headlightBroken && lamps > 1 && q.pointLights;
    if (on) {
      const r = pv.root;
      this.beam.position.set(0, 0.8, pv.spec.length / 2 - 0.2).applyMatrix4(r.matrixWorld);
      this.beamTarget.position.set(0, 0, pv.spec.length / 2 + 14).applyMatrix4(r.matrixWorld);
      this.beamTarget.updateMatrixWorld();
    }
    this.beamOn = on;
    this.beam.intensity = on ? 40 : 0;
  }

  /** LOD simples: interior e volante só perto da câmera (ou no carro do jogador). */
  _lod(dt, pv) {
    this._lodTimer -= dt;
    if (this._lodTimer > 0) return;
    this._lodTimer = 0.25;
    const cam = this.game.camera.position;
    for (const v of this.list) {
      const show = v === pv || cam.distanceToSquared(v.root.position) < 40 * 40;
      if (v.detail && v.detail[0] && v.detail[0].visible !== show) for (const o of v.detail) o.visible = show;
    }
  }

  _handleImpact(v, isPlayer) {
    const ph = v.physics;
    if (ph.impact < 1.2) return;
    const ip = ph.impactPoint;
    // Normal no referencial do carro (frente = +Z local).
    const h = ph.heading, s = Math.sin(h), c = Math.cos(h);
    const lnz = -(ip.nx * s + ip.nz * c); // impacto na frente => normal aponta para trás
    const lnx = -(ip.nx * c - ip.nz * s);
    const dmg = v.damage.applyImpact(ph.impact, lnz);
    v.animation.jolt(ph.impact, lnx, lnz);
    if (isPlayer) {
      if (ph.impact > 10 && this.game.state === 'playing') this.game.player.status?.damage((ph.impact - 10) * 1.5);
      if (ph.impact > 2.5) this.audio.impact(ph.impact);
      this.camera.addShake(clamp((ph.impact - 2) / 20, 0, 0.3));
      if (dmg > 0) this.lastImpact = { speed: ph.impact, damage: dmg, integrity: v.damage.integrity };
    }
  }

  _skids(v) {
    const ph = v.physics;
    for (const id of ['rl', 'rr']) {
      const key = `${v.id}:${id}`;
      if (ph.skid > 0.3) {
        const w = v.wheels.find((ww) => ww.id === id);
        _v.set(w.local.x * 0.94, 0, w.local.z);
        const s = Math.sin(ph.heading), c = Math.cos(ph.heading);
        const x = ph.x + _v.x * c + _v.z * s, z = ph.z - _v.x * s + _v.z * c;
        this.effects.skid(key, x, ph.y, z);
      } else {
        this.effects.endSkid(key);
      }
    }
  }

  /** Detecta veículo preso: acelerando contra obstáculo sem sair do lugar. */
  _stuck(v, dt) {
    const ph = v.physics;
    const pushing = Math.abs(v.controls.throttle) > 0.5;
    if (pushing && ph.speed < 0.4 && (ph.contactTimer > 0 || ph.inWater)) ph.stuckTime += dt;
    else ph.stuckTime = Math.max(0, ph.stuckTime - dt * 2);
  }

  /** Verifica se o veículo realmente precisa de recuperação. */
  needsRecovery(v) {
    const ph = v.physics;
    if (ph.inWater) return 'água';
    if (ph.y < -3) return 'fora do mapa';
    if (ph.stuckTime > 1.5) return 'preso';
    if (Math.abs(ph.groundRoll) > 0.6 || Math.abs(ph.groundPitch) > 0.6) return 'inclinado';
    return null;
  }

  /**
   * Recuperação (R): só quando necessária e com intervalo mínimo. Procura uma
   * posição livre próxima (para trás, laterais ou faixa de rolamento mais
   * próxima), restaura a orientação, zera velocidades e mantém a integridade.
   */
  tryRecover(v) {
    const reason = this.needsRecovery(v);
    if (!reason) { this.game.hud.toast('O veículo não está preso', 1.6); return false; }
    if (this.recoverCooldown > 0) { this.game.hud.toast(`Aguarde ${Math.ceil(this.recoverCooldown)} s para recuperar de novo`, 1.6); return false; }
    const spot = this._findRecoverySpot(v);
    if (!spot) { this.game.hud.toast('Nenhuma posição segura por perto', 1.8); return false; }
    // Saindo da água: de frente para a terra (a caixa de colisão é simétrica a 180°).
    if (reason === 'água') spot.heading += Math.PI;
    const ph = v.physics;
    ph.x = ph.px = spot.x; ph.z = ph.pz = spot.z; ph.heading = ph.pheading = spot.heading;
    ph.y = ph.py = spot.y;
    ph.vx = ph.vz = ph.vy = ph.yawRate = ph.vLong = ph.vLat = 0;
    ph.steerAngle = 0;
    ph.stuckTime = 0;
    ph.acc = 0;
    v.syncCollider(spot.x, spot.y, spot.z, spot.heading);
    v.animation.update(0, true);
    this.effects.endSkid(`${v.id}:rl`); this.effects.endSkid(`${v.id}:rr`);
    this.recoverCooldown = 8;
    this.game.hud.toast(`Veículo recuperado (${reason})`, 1.8);
    return true;
  }

  _placementFree(v, x, z, heading) {
    const env = this.env, col = env.collision;
    if (env.waterDepth && env.waterDepth(x, z) > 0.05) return null;
    const y = col.getGroundHeight(x, z, 0.5, 0.4);
    const body = { x, z, rot: heading, hx: v.spec.width / 2 + 0.25, hz: v.spec.length / 2 + 0.25 };
    const n = col.resolveOBB(body, y, v.spec.height, 0.32, v.id, this._tmpContacts || (this._tmpContacts = []), 1);
    if (n > 0) return null;
    if (env.boundaryHint && env.boundaryHint(x, z, 2.5)) return null;
    return y;
  }

  _findRecoverySpot(v) {
    const ph = v.physics;
    const s = Math.sin(ph.heading), c = Math.cos(ph.heading);
    const tries = [];
    // 1) Perto: para trás (por onde o carro veio) e para os lados.
    for (const back of [3, 5, 7, 0, 9, 12, 16, 20, 25, 30, 40]) {
      for (const side of [0, 2.2, -2.2, 4.4, -4.4]) {
        tries.push([ph.x - s * back + c * side, ph.z - c * back - s * side, ph.heading]);
      }
    }
    // 2) Anéis ao redor (ex.: carro no mar, longe de qualquer rua), mantendo o rumo.
    for (let r = 10; r <= 60; r += 5) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        tries.push([ph.x + Math.cos(a) * r, ph.z + Math.sin(a) * r, ph.heading]);
      }
    }
    // 3) Faixa de rolamento mais próxima do mapa (quando existir), sem limite de distância.
    const lanes = this.env.lanePaths || [];
    let best = null, bestD = Infinity;
    for (const lane of lanes) {
      const pts = lane.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = (pts[i].x - ph.x) ** 2 + (pts[i].z - ph.z) ** 2;
        if (d < bestD) { bestD = d; best = [pts[i].x, pts[i].z, Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z)]; }
      }
    }
    if (best) tries.push(best);
    for (const [x, z, h] of tries) {
      const y = this._placementFree(v, x, z, h);
      if (y !== null) return { x, y, z, heading: h };
    }
    return null;
  }
}
