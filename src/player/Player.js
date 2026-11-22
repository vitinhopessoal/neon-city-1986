import * as THREE from 'three';
import { buildCharacter, HEAD_LAYER, BODY_LAYER, ARMS_LAYER } from './CharacterModel.js';
import { PlayerController } from './PlayerController.js';
import { PlayerAnimator } from './PlayerAnimator.js';
import { ProtagonistModel } from './ProtagonistModel.js';
import { damp } from '../utils/math.js';
import { PlayerStatus } from './PlayerStatus.js';

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

    this.controller.onJump = () => this.events.jump?.();
    this.controller.onLand = (impact, airTime) => {
      if (airTime > 0.12 || impact > 3) this.animator.land(impact);
      this.events.land?.(impact, this.surface);
    };
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
    return this.env.getSurface(p.x, p.z);
  }

  /** Troca o mapa ativo sem recriar personagem, animações ou controles. */
  setEnvironment(env) {
    this.env = env;
    this.controller.setEnvironment(env);
  }

  /** Lê o input bruto e atualiza física, animação e modelo. */
  update(dt, input, cameraYaw, enabled) {
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
    this._syncModel();
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
