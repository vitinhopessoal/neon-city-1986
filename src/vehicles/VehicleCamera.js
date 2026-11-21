import * as THREE from 'three';
import { clamp, damp, dampAngle, dampFactor } from '../utils/math.js';

/**
 * Câmeras automotivas (usadas pelo CameraManager quando o jogador dirige):
 *  - THIRD (perseguição): atrás do carro, segue o rumo com atraso suave,
 *    antecipa curvas, afasta-se discretamente com a velocidade, colide com
 *    obstáculos (sphere-cast) e ajusta o campo de visão de forma moderada.
 *    O mouse orbita temporariamente; sem uso, volta para trás do carro.
 *  - FIRST (interior): nos olhos do motorista, acompanha a carroceria
 *    (arfagem/rolagem suavizadas); o mouse olha ao redor com limites.
 * Tremor de impacto pequeno e curto (sem desconforto).
 */
export class VehicleCamera {
  constructor(collision) {
    this.collision = collision;
    this.vehicle = null;
    this.chaseYaw = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.idleLook = 0;
    this.dist = 6;
    this.pivot = new THREE.Vector3();
    this.shake = 0;
    this.fovBoost = 0;
    this._dir = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._tmp = new THREE.Vector3();
  }

  attach(vehicle) {
    this.vehicle = vehicle;
    this.chaseYaw = vehicle.root.rotation.y;
    this.orbitYaw = this.orbitPitch = 0;
    this.lookYaw = this.lookPitch = 0;
    this.pivot.copy(vehicle.root.position).setY(vehicle.root.position.y + 1.25);
    this.dist = this._baseDistance();
    this.initialized = true;
  }

  detach() {
    this.vehicle = null;
  }

  _baseDistance() {
    const s = this.vehicle.spec;
    return 3.6 + s.length * 0.55;
  }

  applyLook(dx, dy, sens, firstPerson) {
    if (firstPerson) {
      this.lookYaw = clamp(this.lookYaw - dx * sens, -1.75, 1.75);
      this.lookPitch = clamp(this.lookPitch - dy * sens, -0.6, 0.45);
    } else {
      this.orbitYaw -= dx * sens;
      this.orbitPitch = clamp(this.orbitPitch - dy * sens, -0.25, 0.7);
    }
    if (dx !== 0 || dy !== 0) this.idleLook = 0;
  }

  addShake(amount) {
    this.shake = Math.min(0.35, this.shake + amount);
  }

  /** Pose de perseguição. Retorna o campo de visão desejado. */
  computeThird(dt, outPos, outQuat) {
    const v = this.vehicle, ph = v.physics, r = v.root;
    const speed = ph ? Math.abs(ph.vLong) : 0;
    const vk = clamp(speed / 40, 0, 1);
    this.idleLook += dt;
    if (this.idleLook > 1.4) {
      this.orbitYaw = dampAngle(this.orbitYaw, 0, 2.2, dt);
      this.orbitPitch = damp(this.orbitPitch, 0, 2.2, dt);
    }
    // Rumo da câmera: segue o carro com atraso (mais firme em alta velocidade);
    // em ré não gira para a frente do carro.
    let targetYaw = r.rotation.y;
    if (ph && ph.vLong < -1.5) targetYaw = r.rotation.y;
    const steerLead = ph ? -ph.steerAngle * 0.35 * clamp(speed / 12, 0, 1) : 0;
    this.chaseYaw = dampAngle(this.chaseYaw, targetYaw + steerLead, 3.2 + vk * 3, dt);
    const yaw = this.chaseYaw + this.orbitYaw;

    const k = dampFactor(16, dt);
    const tp = this._target.copy(r.position);
    tp.y += 1.2;
    this.pivot.x += (tp.x - this.pivot.x) * k;
    this.pivot.z += (tp.z - this.pivot.z) * k;
    this.pivot.y += (tp.y - this.pivot.y) * dampFactor(8, dt);

    this.dist = damp(this.dist, this._baseDistance() + vk * 1.6, 2.5, dt);
    const pitch = 0.2 + this.orbitPitch - vk * 0.04;
    const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dir = this._dir.set(-fwdX * cp, sp, -fwdZ * cp);
    const desired = this._desired.copy(this.pivot).addScaledVector(dir, this.dist);
    // Colisão (o próprio carro não bloqueia: seu colisor é ignorado pela câmera enquanto dirigido).
    const hit = this.collision.sphereCast(this.pivot, dir, this.dist, 0.25);
    const allowed = Math.max(1.2, hit < this.dist ? hit - 0.15 : this.dist);
    if (this._cur === undefined || allowed < this._cur) this._cur = damp(this._cur ?? allowed, allowed, 25, dt);
    else this._cur = damp(this._cur, allowed, 3, dt);
    outPos.copy(this.pivot).addScaledVector(dir, this._cur);
    const g = this.collision.getGroundHeight(outPos.x, outPos.z, Math.max(outPos.y, this.pivot.y), 0);
    if (outPos.y < g + 0.35) outPos.y = g + 0.35;

    // Olha um pouco à frente do carro (mais longe em velocidade).
    const ahead = 2 + speed * 0.12;
    this._tmp.set(this.pivot.x + Math.sin(this.chaseYaw) * ahead, this.pivot.y + 0.1, this.pivot.z + Math.cos(this.chaseYaw) * ahead);
    if (this.orbitYaw !== 0 || this.orbitPitch !== 0) this._tmp.lerp(this.pivot, clamp(Math.abs(this.orbitYaw) * 2, 0, 1));
    this._m.lookAt(outPos, this._tmp, THREE.Object3D.DEFAULT_UP);
    outQuat.setFromRotationMatrix(this._m);
    this._applyShake(dt, outPos, outQuat);
    this.fovBoost = damp(this.fovBoost, vk * 9, 2, dt);
    return 62 + this.fovBoost;
  }

  /** Pose interior (olhos do motorista). */
  computeFirst(dt, outPos, outQuat) {
    const v = this.vehicle, ph = v.physics;
    const seat = v.seats.find((s) => s.driver);
    // Olhos: quadril + tronco inclinado pelo encosto.
    const up = 0.76 * Math.cos(seat.recline), back = 0.76 * Math.sin(seat.recline);
    this._eye.set(seat.x, seat.hipY + up, seat.z - back + 0.12);
    v.body.updateMatrixWorld();
    outPos.copy(this._eye).applyMatrix4(v.body.matrixWorld);
    this.idleLook += dt;
    const speed = ph ? Math.abs(ph.vLong) : 0;
    if (this.idleLook > 2.5 && speed > 3) {
      this.lookYaw = damp(this.lookYaw, 0, 1.5, dt);
      this.lookPitch = damp(this.lookPitch, 0, 1.5, dt);
    }
    // Orientação: carroceria (inclui arfagem/rolagem) + olhar livre.
    v.body.getWorldQuaternion(this._q);
    this._e.set(this.lookPitch - 0.06, this.lookYaw + Math.PI, 0, 'YXZ');
    outQuat.copy(this._q).multiply(this._tmpQuat(this._e));
    this._applyShake(dt, outPos, outQuat);
    return 70 + clamp(speed / 40, 0, 1) * 6;
  }

  _tmpQuat(e) {
    this._q2 = this._q2 || new THREE.Quaternion();
    return this._q2.setFromEuler(e);
  }

  _applyShake(dt, pos, quat) {
    if (this.shake <= 0.001) return;
    const t = performance.now() * 0.001;
    const s = this.shake;
    pos.x += Math.sin(t * 53) * s * 0.06;
    pos.y += Math.sin(t * 61 + 1.3) * s * 0.05;
    this._e.set(Math.sin(t * 47) * s * 0.01, Math.sin(t * 39) * s * 0.012, 0, 'YXZ');
    quat.multiply(this._tmpQuat(this._e));
    this.shake = Math.max(0, this.shake - dt * 1.4);
  }
}
