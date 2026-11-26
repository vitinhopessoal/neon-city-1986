import * as THREE from 'three';
import { buildCharacter, HEAD_LAYER, BODY_LAYER, ARMS_LAYER } from './CharacterModel.js';
import { PlayerController } from './PlayerController.js';
import { PlayerAnimator } from './PlayerAnimator.js';
import { ProtagonistModel } from './ProtagonistModel.js';
import { damp } from '../utils/math.js';
import { PlayerStatus } from './PlayerStatus.js';
import { PlayerClips } from './anims/PlayerClips.js';

/**
 * Entidade do protagonista: modelo + controlador físico + animador.
 * Mantém a posição física (controller.position) separada da posição visual
 * (suavizada ao subir degraus), usada pelo modelo e pelas câmeras.
 */
export class Player {
  constructor({ scene, world, config }) {
    this.cfg = config;
    this.world = world;
    this.env = world;
    this.scene = scene;
    // Esqueleto provisório: sempre animado (é ele que o PlayerAnimator move).
    // Também é o personagem de fallback quando o GLB não carrega ou é desativado.
    this.model = buildCharacter();
    scene.add(this.model.root);
    /** Modelo 3D importado (ProtagonistModel) quando carregado. */
    this.visual = null;
    /** 'original' (procedural) ou 'glb' (modelo importado). */
    this.modelMode = 'original';
    this.modelStatus = 'original';
    this.controller = new PlayerController(world.collision, world, config);
    this.animator = new PlayerAnimator(this.model, config);
    this.visualPosition = new THREE.Vector3();
    this.name = 'Leo Navarro';
    this.headHidden = false;
    this.bodyHidden = false;
    this.events = { footstep: null, jump: null, land: null };
    this.status = new PlayerStatus();

    // Animações da Mixamo (public/models/anims), misturadas sobre a pose procedural.
    this.clips = new PlayerClips(this.model, { hipsBaseY: this.animator.hipsBaseY });
    this._clipCtx = { mode: 'off', speed: 0, fwd: 0, side: 0, strafe: false, grounded: true, vy: 0, walkSpeed: config.walkSpeed, runSpeed: config.runSpeed,
      hold: null, aim: 0, firing: false, reload: -1, reloadDur: 2, hipsOffsetY: 0 };
    this._fireT = 0;
    this._prevKick = 0;
    this._prevStab = 0;
    this._lastHealth = null;
    this._swimOffset = 0;
    /** Modo dos clipes imposto por outro sistema (ex.: 'getup' ao levantar da queda da moto). */
    this.clipMode = null;
    /** Subida da água para uma borda (Swimming To Edge + impulso final), ou null. */
    this.climb = null;
    this.controller.onJump = () => { this.clips.events.jump = true; this.events.jump?.(); };
    this.controller.onLand = (impact, airTime) => {
      if (airTime > 0.12 || impact > 3) this.animator.land(impact);
      if (airTime > 0.6 || impact > 7) this.clips.events.land = impact;
      this.events.land?.(impact, this.surface);
    };
    this.controller.onClimb = (target) => this.startClimb(target);
    this.animator.onFootstep = (run, foot) => this.events.footstep?.(this.surface, run, foot, this.controller.wading);
    this._input = { moveX: 0, moveZ: 0, run: false, jump: false };
    this._animState = { speed: 0, grounded: true, vy: 0, turnRate: 0, forwardSign: 1, wading: false, swimming: false };
    this._headPos = new THREE.Vector3();
    /** Pose controlada por outro sistema (veículos): sem física a pé. */
    this.external = null;
  }

  /**
   * Controle externo (entrar, dirigir, sair de veículos). A física a pé fica
   * suspensa; o controlador acompanha a posição para os sistemas do mapa.
   * speed: velocidade de caminhada para a animação; seat: 0..1 pose sentada.
   */
  setExternalPose(position, yaw, speed = 0, seat = 0, recline = 0, steer = 0, duck = 0, roll = 0, pitch = 0) {
    const e = this.external || (this.external = { position: new THREE.Vector3(), yaw: 0, speed: 0, seat: 0, recline: 0, steer: 0, duck: 0, roll: 0, pitch: 0 });
    e.duck = duck;
    // Motos: o corpo inteiro acompanha a inclinação (roll) e a arfagem (pitch) da moto.
    e.roll = roll;
    e.pitch = pitch;
    e.position.copy(position);
    e.yaw = yaw;
    e.speed = speed;
    e.seat = seat;
    e.recline = recline;
    e.steer = steer;
  }

  /** Devolve o controle a pé numa posição segura (teleporte invisível no fim da transição). */
  releaseExternalPose(position, yaw) {
    this.external = null;
    this.controller.teleport(position.x, position.y, position.z, yaw);
    this.visualPosition.copy(this.controller.position);
    this.animator.seatTarget = 0;
    this.animator.seatBlend = 0;
    this._syncModel();
  }

  get inVehicleMode() {
    return !!this.external;
  }

  spawn(point) {
    if (this.climb) { this.climb = null; this.animator.crash = null; this.external = null; }
    this.controller.teleport(point.x, point.y, point.z, point.yaw + Math.PI);
    this.visualPosition.copy(this.controller.position);
    this._syncModel();
  }

  get position() {
    return this.controller.position;
  }

  get surface() {
    const p = this.controller.position;
    if (this.controller.wading) return 'water';
    return this.env.getSurface(p.x, p.z, p.y);
  }

  /** Troca o mapa ativo sem recriar personagem, animações ou controles. */
  setEnvironment(env) {
    this.env = env;
    this.controller.setEnvironment(env);
  }

  /** Carrega as animações da Mixamo (o jogo segue procedural até terminarem). */
  loadAnimations(baseUrl) {
    return this.clips.load(baseUrl);
  }

  /** Lê o input bruto e atualiza física, animação e modelo. */
  update(dt, input, cameraYaw, enabled) {
    if (this.climb) this._updateClimb(dt);
    if (this.external) {
      this._updateExternal(dt);
      return;
    }
    const i = this._input;
    if (enabled) {
      i.moveX = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
      i.moveZ = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
      i.run = input.isDown('run');
      i.jump = input.wasPressed('jump');
    } else {
      i.moveX = i.moveZ = 0;
      i.run = i.jump = false;
    }
    const c = this.controller;
    c.update(dt, i, cameraYaw);

    // Suavização visual de degraus (sem afetar a física).
    const vp = this.visualPosition;
    vp.x = c.position.x;
    vp.z = c.position.z;
    if (c.grounded && c.position.y > vp.y && c.position.y - vp.y < 0.5) vp.y = damp(vp.y, c.position.y, 18, dt);
    else vp.y = c.position.y;

    const s = this._animState;
    s.speed = c.horizontalSpeed;
    s.grounded = c.grounded;
    s.vy = c.velocity.y;
    s.turnRate = c.turnRate;
    s.forwardSign = c.forwardSign;
    s.wading = c.wading;
    s.swimming = c.swimming;
    this.animator.update(dt, s);
    this._updateClips(dt, c.swimming ? 'swim' : 'foot');
    this._syncModel();
  }

  /** Estado do personagem para a escolha dos clipes e mistura sobre a pose procedural. */
  _updateClips(dt, mode) {
    const clips = this.clips;
    if (!clips.ready) return;
    const c = this.controller, W = this.animator.weapon, x = this._clipCtx;
    const health = this.status.health;
    if (this._lastHealth !== null && health < this._lastHealth - 0.5 && health > 0) clips.events.hit = true;
    this._lastHealth = health;
    if (health <= 0 && mode !== 'off' && mode !== 'climb') mode = 'dead';
    // Disparo: o recuo (kick) sobe 1 a cada tiro.
    if (W.kick > this._prevKick + 0.3) this._fireT = 0.35;
    this._prevKick = W.kick;
    this._fireT = Math.max(0, this._fireT - dt);
    if ((W.stab || 0) !== this._prevStab) { clips.events.stab = true; this._prevStab = W.stab || 0; }
    const v = c.velocity, sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    x.mode = mode;
    x.speed = Math.hypot(v.x, v.z);
    x.fwd = v.x * sy + v.z * cy;
    x.side = v.x * cy - v.z * sy; // + = para a esquerda do personagem
    x.strafe = c.facingMode === 'camera';
    x.grounded = c.grounded;
    x.vy = v.y;
    x.hold = W.hold && W.draw > 0.5 ? W.hold : null;
    x.aim = W.aim;
    x.firing = this._fireT > 0;
    x.reload = W.reload;
    x.reloadDur = W.reloadDur || 2;
    // Nadando com braçadas: o corpo deitado sobe até a linha d'água.
    this._swimOffset += ((mode === 'swim' && x.speed > 0.3 ? 0.42 : 0) - this._swimOffset) * Math.min(1, dt * 5);
    x.hipsOffsetY = this._swimOffset;
    clips.update(dt, x);
    clips.apply(W.hold && W.draw > 0.5 ? W.pitch || 0 : 0);
  }

  /**
   * Nadando junto a um píer/cais (Espaço): nada até a borda, segura e sobe.
   * target: ponto no chão da borda. Sem as animações, o controlador sobe direto.
   */
  startClimb(target) {
    if (!this.clips.ready || !this.clips.has('swim_to_edge') || this.climb) return false;
    const c = this.controller;
    const yaw = Math.atan2(target.x - c.position.x, target.z - c.position.z);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // Face da borda: primeiro ponto, a partir do nadador, com chão na altura do topo.
    const col = c.collision;
    const reach = Math.hypot(target.x - c.position.x, target.z - c.position.z);
    let edge = reach;
    for (let d = 0; d <= reach; d += 0.05) {
      if (col.getGroundHeight(c.position.x + fx * d, c.position.z + fz * d, target.y + 0.3, 0.6) >= target.y - 0.3) { edge = d; break; }
    }
    const ex = c.position.x + fx * edge, ez = c.position.z + fz * edge;
    const surface = c._surface ? c._surface(c.position.x, c.position.z) : (this.env.waterLevel ?? target.y);
    this.climb = {
      t: 0, yaw,
      from: c.position.clone(),
      // Agarrado: mãos (~1 m à frente do corpo no clipe) na face da borda; corpo na água.
      hang: new THREE.Vector3(ex - fx * 0.95, Math.min(target.y - 1.5, surface - 1.4), ez - fz * 0.95),
      // Encostado na parede no fim do puxão (quadril na altura do topo).
      wall: new THREE.Vector3(ex - fx * 0.32, target.y - 0.95, ez - fz * 0.32),
      top: new THREE.Vector3(ex + fx * 0.45, target.y, ez + fz * 0.45),
      grab: 1.35, up: 1.0,
    };
    this.setExternalPose(c.position, yaw, 0, 0);
    return true;
  }

  _updateClimb(dt) {
    const k = this.climb, an = this.animator;
    k.t += dt;
    const pos = this._climbPos || (this._climbPos = new THREE.Vector3());
    if (k.t < k.grab) {
      // Nada até a borda e agarra (clipe Swimming To Edge).
      const a = k.t / k.grab, e = a * a * (3 - 2 * a);
      pos.lerpVectors(k.from, k.hang, e);
      this.setExternalPose(pos, k.yaw, 0, 0);
    } else if (k.t < k.grab + k.up) {
      // Impulso em dois tempos: puxa o corpo com os braços na borda, depois sobe o joelho e fica de pé.
      const a = (k.t - k.grab) / k.up;
      const fade = 1 - Math.max(0, (a - 0.8) / 0.2);
      if (a < 0.5) {
        const b = a / 0.5, e = b * b * (3 - 2 * b);
        pos.lerpVectors(k.hang, k.wall, e);
        an.crash = { fly: 0, lie: 0, getup: 0, pull: 1, pullK: e };
      } else {
        const b = (a - 0.5) / 0.5, e = b * b * (3 - 2 * b);
        pos.lerpVectors(k.wall, k.top, e);
        pos.y = k.wall.y + (k.top.y - k.wall.y) * Math.min(1, e * 1.6);
        an.crash = { fly: 0, lie: 0, getup: Math.sin(Math.min(1, 0.35 + b * 0.8) * Math.PI) * fade, pull: Math.max(0, 1 - b * 2.5), pullK: 1, fade };
      }
      this.setExternalPose(pos, k.yaw, 0, 0);
    } else {
      an.crash = null;
      this.climb = null;
      this.releaseExternalPose(k.top, k.yaw);
      this.controller.grounded = true;
      this.events.land?.(2, this.surface);
    }
  }

  _updateExternal(dt) {
    const e = this.external, c = this.controller;
    c.position.copy(e.position);
    c.velocity.set(0, 0, 0);
    c.yaw = e.yaw;
    c.grounded = true;
    c.boundaryHint = null;
    this.visualPosition.copy(e.position);
    const s = this._animState;
    s.speed = e.speed;
    s.grounded = true;
    s.vy = 0;
    s.turnRate = 0;
    s.forwardSign = 1;
    s.wading = false;
    s.swimming = false;
    this.animator.seatTarget = e.seat;
    this.animator.seatRecline = this.visual && this.modelMode === 'glb'
      ? this.visual.seatRecline(e.recline, this.animator.seatHeadroom)
      : e.recline;
    this.animator.seatSteer = e.steer;
    this.animator.seatDuck = e.duck;
    this.animator.update(dt, s);
    // Veículos, sentar e queda da moto ficam na pose procedural; a subida na borda usa o clipe.
    this._updateClips(dt, this.clipMode || (this.climb && this.climb.t < this.climb.grab ? 'climb' : 'off'));
    this._syncModel();
  }

  /** Reaplica só a posição/rumo da pose externa (sem avançar a animação). */
  applyExternalPosition() {
    const e = this.external;
    if (!e) return;
    this.controller.position.copy(e.position);
    this.controller.yaw = e.yaw;
    this.visualPosition.copy(e.position);
    this._syncModel();
  }

  _syncModel() {
    const r = this.model.root;
    r.position.copy(this.visualPosition);
    const e = this.external;
    if (e && (e.roll || e.pitch)) r.rotation.set(e.pitch, this.controller.yaw, e.roll, 'YXZ');
    else r.rotation.set(0, this.controller.yaw, 0);
    if (this.visual && this.modelMode === 'glb') this.visual.sync(this.model, this.animator);
  }

  /**
   * Carrega o protagonista importado (GLB). Em caso de erro mantém o
   * personagem original e registra o motivo em modelStatus.
   */
  async loadProtagonistModel(url, { activate = true } = {}) {
    this.modelStatus = 'loading';
    try {
      const visual = await ProtagonistModel.load(url);
      visual.configureSeat(this.animator.hipsBaseY);
      visual.visible = false;
      this.scene.add(visual.root);
      this.visual = visual;
      this.modelStatus = 'glb';
      if (activate) this.setModelMode('glb');
      return true;
    } catch (err) {
      console.warn('[Player] Protagonista GLB indisponível; usando o personagem original.', err);
      this.modelStatus = `erro: ${err.message}`;
      this.setModelMode('original');
      return false;
    }
  }

  /** Alterna entre o modelo importado e o personagem original (fallback). */
  setModelMode(mode) {
    const glb = mode === 'glb' && !!this.visual;
    this.modelMode = glb ? 'glb' : 'original';
    for (const m of this.model.headMeshes) m.visible = !glb;
    for (const m of this.model.bodyMeshes) m.visible = !glb;
    if (this.visual) this.visual.visible = glb;
    // Alcance dos braços do modelo visível (pose de pilotagem de moto).
    this.animator.armReach = glb ? this.visual.armReach ?? null : null;
    this.animator.shoulderUp = glb ? this.visual.shoulderUp ?? null : null;
    this._syncModel();
    return this.modelMode;
  }

  /** Posição aproximada da cabeça (para ocultar quando a câmera está perto). */
  getHeadPosition(out = this._headPos) {
    return out.copy(this.visualPosition).setY(this.visualPosition.y + 1.68);
  }

  setFacingMode(mode) {
    this._baseFacing = mode;
    this.controller.facingMode = this._aimFacing ? 'camera' : mode;
  }

  /** Mirando/disparando: o corpo acompanha a câmera; ao soltar, volta ao modo da câmera. */
  setAimFacing(on) {
    if (this._aimFacing === on) return;
    this._aimFacing = on;
    this.controller.facingMode = on ? 'camera' : (this._baseFacing || 'movement');
  }

  /**
   * Junta do modelo visível para prender objetos (armas): 'wristR', 'wristL',
   * 'hips', 'chest'. Usa os ossos do GLB quando ativo, senão o original.
   */
  getAttachBone(name) {
    if (this.visual && this.modelMode === 'glb') return this.visual.bone(name);
    const j = this.model.joints;
    if (name === 'wristR') return j.arms.R.wrist;
    if (name === 'wristL') return j.arms.L.wrist;
    return j[name] || j.hips;
  }

  /** Distância do pulso ao centro da palma (a mão do GLB é mais longa). */
  get palmOffset() {
    return this.visual && this.modelMode === 'glb' ? 0.078 : 0.055;
  }

  /** Ajusta camadas visíveis da câmera principal (cabeça/corpo). */
  applyVisibility(camera, hideHead, hideBody, hideArms = hideHead || hideBody) {
    this.armsHidden = hideArms;
    if (hideArms) camera.layers.disable(ARMS_LAYER); else camera.layers.enable(ARMS_LAYER);
    this.headHidden = hideHead;
    this.bodyHidden = hideBody;
    if (hideHead) camera.layers.disable(HEAD_LAYER); else camera.layers.enable(HEAD_LAYER);
    if (hideBody) camera.layers.disable(BODY_LAYER); else camera.layers.enable(BODY_LAYER);
  }
}
