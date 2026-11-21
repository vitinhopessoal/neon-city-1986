import * as THREE from 'three';
import { damp } from '../utils/math.js';

/**
 * Câmera de primeira pessoa na altura dos olhos.
 * Usa a MESMA posição física do jogador (sem segundo personagem) e aplica
 * um balanço sutil sincronizado com a fase da passada do animador.
 */
export class FirstPersonCamera {
  constructor(config, eyeHeight) {
    this.cfg = config;
    this.eyeHeight = eyeHeight;
    this.roll = 0;
    this.landDip = 0;
    this.smoothY = null;
  }

  computePose(player, yaw, pitch, dt, outPos) {
    const c = this.cfg;
    const vp = player.visualPosition;
    const bob = player.animator.getBob();
    const ground = player.controller.grounded ? 1 - bob.air : 0;
    const amp = (c.bobWalk + (c.bobRun - c.bobWalk) * bob.run) * bob.move * ground;
    const bobY = (Math.abs(Math.cos(bob.phase)) - 0.6) * amp * 2;
    const bobX = Math.sin(bob.phase) * (0.012 + c.swayRun * bob.run) * bob.move * ground;
    this.landDip = damp(this.landDip, bob.land * 0.14, 20, dt);

    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    // Um pouco à frente do centro do corpo para não ver o próprio rosto/ombros.
    const ahead = c.forwardOffset + Math.max(0, pitch) * 0.08;
    const y = vp.y + this.eyeHeight + bobY - this.landDip;
    if (this.smoothY === null) this.smoothY = y;
    this.smoothY = damp(this.smoothY, y, 30, dt);
    outPos.set(
      vp.x + fx * ahead + rx * bobX,
      this.smoothY,
      vp.z + fz * ahead + rz * bobX,
    );
    this.roll = damp(this.roll, Math.sin(bob.phase) * 0.006 * bob.run * bob.move, 10, dt);
    return 0;
  }
}
