import * as THREE from 'three';
import { ThirdPersonCamera } from './ThirdPersonCamera.js';
import { FirstPersonCamera } from './FirstPersonCamera.js';
import { clamp, easeInOutCubic, lerp, damp } from '../utils/math.js';

/**
 * Gerencia a câmera do jogo: terceira pessoa, primeira pessoa e o plano
 * cinematográfico da tela inicial. A troca (tecla V) é uma transição
 * interpolada entre as poses VIVAS dos dois modos, então o jogador continua
 * se movendo normalmente durante os ~0,32 s da troca.
 */
export const CAMERA_MODES = { THIRD: 'third', FIRST: 'first' };

export class CameraManager {
  constructor(camera, collision, config, sensitivity) {
    this.camera = camera;
    this.cfg = config;
    this.sensitivity = sensitivity;
    this.invertY = false;
    this.third = new ThirdPersonCamera(collision, config.thirdPerson);
    this.first = null;
    this.mode = CAMERA_MODES.THIRD;
    this.yaw = 0;
    this.pitch = config.thirdPerson.defaultPitch;
    this.transition = null; // { from, to, t, duration }
    this.intro = null;       // transição do plano cinematográfico
    this.cinematic = { active: true, angle: 0, center: new THREE.Vector3(), radius: 60, height: 9 };
    this.fov = config.fovThirdPerson;
    this.onModeChange = null;

    this._posA = new THREE.Vector3();
    this._posB = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._qA = new THREE.Quaternion();
    this._qB = new THREE.Quaternion();
    this._lookTarget = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._head = new THREE.Vector3();
    this.lastThirdDistance = config.thirdPerson.distance;
    /** Mira (armas): alvo 0/1 e valor suavizado; muda só enquanto mira. */
    this.aimTarget = 0;
    this.aim = 0;
    // Contexto automotivo: câmeras do veículo (VehicleCamera) e peso da
    // transição a pé ↔ carro (0 = a pé, 1 = veículo), controlado pela interação.
    this.vehicleRig = null;
    this.vehicleBlend = 0;
    this._posV = new THREE.Vector3();
    this._posV2 = new THREE.Vector3();
    this._qV = new THREE.Quaternion();
    this._qV2 = new THREE.Quaternion();
  }

  /** true quando as câmeras do veículo estão no comando. */
  get inVehicle() {
    return !!(this.vehicleRig && this.vehicleRig.vehicle && this.vehicleBlend > 0.5);
  }

  /** Colisões usadas pela câmera de terceira pessoa (mudam com o mapa ativo). */
  setCollision(collision) {
    this.third.collision = collision;
    this.third.initialized = false;
  }

  attachPlayer(player, eyeHeight) {
    this.player = player;
    this.first = new FirstPersonCamera(this.cfg.firstPerson, eyeHeight);
  }

  /** Aplica o deslocamento do mouse (radianos via sensibilidade central). */
  applyLook(dx, dy) {
    if (this.cinematic.active || this.intro) return;
    if (this.inVehicle) {
      this.vehicleRig.applyLook(dx, dy * (this.invertY ? -1 : 1), this.sensitivity, this.mode === CAMERA_MODES.FIRST);
      return;
    }
    this.yaw -= dx * this.sensitivity;
    const [a, b] = this._limits(this.mode);
    const before = this.pitch;
    let p = this.pitch + dy * this.sensitivity * (this.invertY ? -1 : 1);
    // Limite rígido do modo atual; se o pitch veio de fora do limite (troca de
    // modo), só permite movimento de volta para dentro (correção suave no update).
    if (p > b) p = Math.max(b, Math.min(p, before));
    if (p < a) p = Math.min(a, Math.max(p, before));
    this.pitch = p;
  }

  _limits(mode) {
    return mode === CAMERA_MODES.FIRST
      ? [this.cfg.firstPerson.pitchMin, this.cfg.firstPerson.pitchMax]
      : [this.cfg.thirdPerson.pitchMin, this.cfg.thirdPerson.pitchMax];
  }

  _clampPitch() {
    // Mantido para compatibilidade: a correção é aplicada suavemente no update.
  }

  _softClampPitch(dt) {
    const [a, b] = this._limits(this.mode);
    const target = clamp(this.pitch, a, b);
    if (target !== this.pitch) this.pitch = damp(this.pitch, target, 12, dt);
  }

  /** Alterna entre primeira e terceira pessoa com transição suave. */
  toggle() {
    if (this.cinematic.active || this.intro) return false;
    const from = this.transition ? this.transition.to : this.mode;
    const to = from === CAMERA_MODES.THIRD ? CAMERA_MODES.FIRST : CAMERA_MODES.THIRD;
    // Se uma transição já estava em andamento, inverte a partir do ponto atual.
    const startT = this.transition ? 1 - this.transition.t : 0;
    this.transition = { from, to, t: startT, duration: this.cfg.transitionDuration };
    this.mode = to;
    this.player.setFacingMode(to === CAMERA_MODES.FIRST ? 'camera' : 'movement');
    if (to === CAMERA_MODES.THIRD) this.third.initialized = false;
    this._clampPitch();
    this.onModeChange?.(to);
    return true;
  }

  setMode(mode) {
    this.mode = mode;
    this.transition = null;
    this.player.setFacingMode(mode === CAMERA_MODES.FIRST ? 'camera' : 'movement');
    this._clampPitch();
    this.onModeChange?.(mode);
  }

  /** Plano cinematográfico em órbita lenta (tela inicial). */
  setCinematic(center, radius = 60, height = 10) {
    this.cinematic.active = true;
    this.cinematic.center.copy(center);
    this.cinematic.radius = radius;
    this.cinematic.height = height;
  }

  /** Sai do plano cinematográfico e voa até a terceira pessoa atrás do jogador. */
  beginIntro(duration = 1.6, onDone = null) {
    this.cinematic.active = false;
    this.mode = CAMERA_MODES.THIRD;
    this.third.initialized = false;
    this.intro = {
      t: 0,
      duration,
      startPos: this.camera.position.clone(),
      startQuat: this.camera.quaternion.clone(),
      startFov: this.camera.fov,
      onDone,
    };
  }

  update(dt) {
    const cam = this.camera;
    const player = this.player;
    const run = player.animator.runBlend;

    if (this.cinematic.active) {
      const c = this.cinematic;
      c.angle += dt * 0.035;
      cam.position.set(
        c.center.x + Math.cos(c.angle) * c.radius,
        c.center.y + c.height + Math.sin(c.angle * 0.7) * 2,
        c.center.z + Math.sin(c.angle) * c.radius,
      );
      this._lookTarget.copy(c.center).setY(c.center.y + 6);
      cam.lookAt(this._lookTarget);
      this._setFov(this.cfg.fovThirdPerson + 4);
      player.applyVisibility(cam, false, false);
      return;
    }

    this._softClampPitch(dt);
    this.aim += (this.aimTarget - this.aim) * Math.min(1, dt * 12);
    if (Math.abs(this.aim - this.aimTarget) < 0.002) this.aim = this.aimTarget;
    this.third.aim = this.aim;
    // Poses vivas de ambos os modos.
    const thirdDist = this.third.computePose(player, this.yaw, this.pitch, dt, this._posA, run);
    this.lastThirdDistance = thirdDist;
    this.first.computePose(player, this.yaw, this.pitch, dt, this._posB);
    this._euler.set(-this.pitch, this.yaw, 0, 'YXZ');
    this._qA.setFromEuler(this._euler);
    this._euler.set(-this.pitch, this.yaw, this.first.roll, 'YXZ');
    this._qB.setFromEuler(this._euler);
    const fovThird = this.cfg.fovThirdPerson + this.cfg.runFovBoost * run - 14 * this.aim;
    const fovFirst = this.cfg.fovFirstPerson + this.cfg.runFovBoost * 0.6 * run - 12 * this.aim;

    // Peso de primeira pessoa (0 = terceira, 1 = primeira).
    let w;
    if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(1, tr.t + dt / tr.duration);
      const e = easeInOutCubic(tr.t);
      w = tr.to === CAMERA_MODES.FIRST ? e : 1 - e;
      if (tr.t >= 1) this.transition = null;
    } else {
      w = this.mode === CAMERA_MODES.FIRST ? 1 : 0;
    }

    this._pos.lerpVectors(this._posA, this._posB, w);
    cam.position.copy(this._pos);
    cam.quaternion.slerpQuaternions(this._qA, this._qB, w);
    let fov = lerp(fovThird, fovFirst, w);

    // Dirigindo (ou entrando/saindo): mistura com as câmeras do veículo.
    const vb = this.vehicleRig && this.vehicleRig.vehicle ? this.vehicleBlend : 0;
    if (vb > 0) {
      const rig = this.vehicleRig;
      const fovA = rig.computeThird(dt, this._posV, this._qV);
      const fovB = rig.computeFirst(dt, this._posV2, this._qV2);
      this._posV.lerp(this._posV2, w);
      this._qV.slerp(this._qV2, w);
      const e = easeInOutCubic(vb);
      cam.position.lerp(this._posV, e);
      cam.quaternion.slerp(this._qV, e);
      fov = lerp(fov, lerp(fovA, fovB, w), e);
    }

    if (this.intro) {
      const it = this.intro;
      it.t = Math.min(1, it.t + dt / it.duration);
      const e = easeInOutCubic(it.t);
      cam.position.lerpVectors(it.startPos, this._pos, e);
      this._qA.copy(cam.quaternion);
      cam.quaternion.slerpQuaternions(it.startQuat, this._qA, e);
      fov = lerp(it.startFov, fov, e);
      if (it.t >= 1) {
        const done = it.onDone;
        this.intro = null;
        done?.();
      }
    }
    this._setFov(fov);

    if (vb > 0.5) {
      // No carro em primeira pessoa: cabeça e braços ocultos (colados à lente,
      // cobririam a visão); volante, painel e para-brisa ficam visíveis.
      const fp = w > 0.5;
      player.applyVisibility(cam, fp, false, fp);
      return;
    }
    // Visibilidade: oculta a cabeça quando a câmera está perto dela
    // (primeira pessoa e câmera comprimida contra paredes).
    const head = player.getHeadPosition(this._head);
    const dHead = cam.position.distanceTo(head);
    const hideHead = dHead < 0.55;
    const dBody = Math.hypot(cam.position.x - player.visualPosition.x, cam.position.z - player.visualPosition.z);
    const hideBody = w < 0.5 && dBody < 0.42 && cam.position.y < player.visualPosition.y + 1.5;
    player.applyVisibility(cam, hideHead, hideBody);
  }

  /** Recuo da arma: sobe a mira (o jogador compensa com o mouse). */
  addRecoil(up, side = 0) {
    this.pitch -= up;
    this.yaw += side;
    this._clampPitch();
  }

  _setFov(f) {
    if (Math.abs(this.camera.fov - f) > 0.01) {
      this.camera.fov = f;
      this.camera.updateProjectionMatrix();
    }
  }

  get modeLabel() {
    return this.mode === CAMERA_MODES.FIRST ? '1ª PESSOA' : '3ª PESSOA';
  }
}
