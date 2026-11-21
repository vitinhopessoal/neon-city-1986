import * as THREE from 'three';
import { damp, dampFactor } from '../utils/math.js';

/**
 * Câmera de terceira pessoa orbital (sobre o ombro).
 * - Pivô suavizado (horizontal firme, vertical suave para pulos)
 * - Distância aumenta levemente na corrida
 * - Colisão: sphere-cast do pivô até a posição desejada; aproxima rápido
 *   quando há obstáculo e se afasta devagar quando livre
 */
export class ThirdPersonCamera {
  constructor(collision, config) {
    this.collision = collision;
    this.cfg = config;
    this.pivot = new THREE.Vector3();
    this.currentDistance = config.distance;
    this.distanceTarget = config.distance;
    this.initialized = false;
    /** Mira sobre o ombro (0..1), controlada pelo CameraManager. */
    this.aim = 0;
    this._dir = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  reset(player) {
    this.pivot.copy(player.visualPosition).setY(player.visualPosition.y + this.cfg.pivotHeight);
    this.initialized = true;
  }

  /** Calcula a pose desejada. Retorna a distância efetiva (para visibilidade). */
  computePose(player, yaw, pitch, dt, outPos, runBlend) {
    const c = this.cfg;
    const vp = player.visualPosition;
    if (!this.initialized) this.reset(player);
    const kx = dampFactor(c.followSharpnessXZ, dt);
    const ky = dampFactor(player.controller.grounded ? c.followSharpnessY * 1.6 : c.followSharpnessY, dt);
    this.pivot.x += (vp.x - this.pivot.x) * kx;
    this.pivot.z += (vp.z - this.pivot.z) * kx;
    const aim = this.aim;
    const pivotH = c.pivotHeight + ((c.aimPivotHeight ?? c.pivotHeight) - c.pivotHeight) * aim;
    // Nadando (PROMPT 11) o corpo fica ~1,2 m abaixo da superfície: o pivô sobe para não filmar rente à água.
    const swimLift = player.controller.swimming ? 0.85 : 0;
    this.pivot.y += (vp.y + pivotH + swimLift - this.pivot.y) * ky;

    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fwd = this._fwd.set(-Math.sin(yaw) * cp, -sp, -Math.cos(yaw) * cp);
    const right = this._right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const baseDist = c.distance + (c.runDistance - c.distance) * runBlend;
    const wantDist = baseDist + ((c.aimDistance ?? baseDist) - baseDist) * aim;
    this.distanceTarget = damp(this.distanceTarget, wantDist, aim > 0.01 ? 10 : 3, dt);
    const shoulder = c.shoulderOffset + ((c.aimShoulder ?? c.shoulderOffset) - c.shoulderOffset) * aim;

    const desired = this._desired.copy(this.pivot)
      .addScaledVector(right, shoulder)
      .addScaledVector(fwd, -this.distanceTarget);
    const dir = this._dir.subVectors(desired, this.pivot);
    const len = dir.length();
    dir.divideScalar(len);
    const hit = this.collision.sphereCast(this.pivot, dir, len, c.collisionRadius);
    const allowed = Math.max(0.15, hit < len ? hit - 0.08 : len);

    if (allowed < this.currentDistance) this.currentDistance = damp(this.currentDistance, allowed, 30, dt);
    else this.currentDistance = damp(this.currentDistance, allowed, 3.5, dt);
    if (this.currentDistance > allowed) this.currentDistance = Math.min(this.currentDistance, allowed + 0.02);

    outPos.copy(this.pivot).addScaledVector(dir, this.currentDistance);
    // Nunca abaixo do solo nem dentro de superfícies caminháveis (calçadas,
    // plataformas, objetos baixos): considera tudo até a altura do pivô.
    const g = this.collision.getGroundHeight(outPos.x, outPos.z, Math.max(outPos.y, this.pivot.y), 0.0);
    if (outPos.y < g + 0.25) outPos.y = g + 0.25;
    return this.currentDistance;
  }
}
