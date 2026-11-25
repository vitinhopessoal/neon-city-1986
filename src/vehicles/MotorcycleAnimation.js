import { VehicleAnimation } from './VehicleAnimation.js';
import { clamp, damp } from '../utils/math.js';

/**
 * Animação visual da moto (NEON MOTORCYCLES), sobre a VehicleAnimation:
 *  - pose interpolada do passo fixo + arfagem do terreno + INCLINAÇÃO (rolagem
 *    da raiz em torno do contato dos pneus com o solo; o piloto acompanha)
 *  - parada com piloto: quase em pé (pé esquerdo no chão); sem piloto: apoiada
 *    no cavalete lateral; depois de uma queda (v.fallen = ±1): deitada de lado
 *  - garfo gira no eixo de direção (Y local do nó FrontFork, já inclinado pelo rake)
 *  - suspensão: garfo comprime ao frear/aterrissar (roda sobe ao longo do garfo),
 *    balança gira com o desnível e a carga traseira; mola de arfagem do quadro
 *  - rodas giram pela velocidade; freio de mão trava a traseira
 *  - luzes: farol, lanterna e luz de freio (sem luz de ré)
 */
export class MotorcycleAnimation extends VehicleAnimation {
  constructor(vehicle) {
    super(vehicle);
    this.lean = vehicle.root.rotation.z || 0;
    this.forkComp = 0;
    this.rearComp = 0;
    this.steerVis = 0;
    this._swingLen = Math.max(0.3, Math.abs(vehicle.wheels[1].base.z));
  }

  update(dt, active) {
    const v = this.v, ph = v.physics, H = v.spec.handling;
    this.time += dt;
    const r = v.root;
    const speed = ph ? Math.abs(ph.vLong) : 0;
    if (ph && (ph.awake || active)) {
      ph.interpolated(this.pose);
      r.position.set(this.pose.x, this.pose.y, this.pose.z);
      this.gPitch = damp(this.gPitch, ph.groundPitch, 14, dt);
      // Inclinação: física em movimento; parada com piloto quase em pé (pé no chão), sem piloto no cavalete.
      let target = ph.lean;
      if (speed < 1.2) target = v.driver ? -0.06 * clamp(1 - speed, 0, 1) + ph.lean * speed / 1.2 : v.standLean ?? -0.09;
      if (v.fallen && !v.driver) target = v.fallen * 1.32;
      this.lean = damp(this.lean, target, v.driver ? 10 : v.fallen ? 6 : 5, dt);
      r.rotation.set(-this.gPitch, this.pose.heading, this.lean, 'YXZ');
      v.heading = this.pose.heading;
      v.speed = ph.speed;
    }
    v.lean = this.lean;

    // --- Mola de arfagem do quadro (frenagem afunda a frente, aceleração levanta).
    const sus = H.suspension;
    const w0 = Math.PI * 2 * sus.freq, z = sus.damping;
    const aLong = ph ? ph.aLong : 0;
    const pitchT = clamp(aLong * H.pitchGain, -0.06, 0.05);
    this.pitchV += (w0 * w0 * (pitchT - this.pitch) - 2 * z * w0 * this.pitchV) * dt;
    this.pitch += this.pitchV * dt;
    if (ph && ph.landing > 0) { this.heaveV -= ph.landing * 1.4; ph.landing = 0; }
    this.heaveV += (w0 * w0 * (0 - this.heave) - 2 * z * w0 * this.heaveV) * dt;
    this.heave += this.heaveV * dt;
    this.pitch = clamp(this.pitch, -0.08, 0.06);
    this.heave = clamp(this.heave, -sus.travel, sus.travel);
    const rough = ph && (ph.surface === 'pavers' || ph.surface === 'sand' || ph.surface === 'grass') ? 1 : 0.25;
    const vib = Math.sin(this.time * 47) * Math.sin(this.time * 31) * 0.003 * rough * Math.min(1, speed / 8);
    const body = v.body;
    body.rotation.set(-this.pitch * 0.5, 0, 0, 'YXZ');
    body.position.y = this.heave * 0.4 + vib + (body.userData.rideOffset || 0);

    // --- Suspensão das rodas: compressão do garfo (frente afunda) e da balança.
    const gy = ph?._wheelGround;
    const tf = gy && ph ? clamp(gy[0] - ph.y, -0.08, 0.08) : 0;
    const tr = gy && ph ? clamp(gy[1] - ph.y, -0.08, 0.08) : 0;
    const fT = clamp(-this.pitch * 0.9 - this.heave * 0.6 + tf * 0.7, -0.03, sus.travel);
    const rT = clamp(this.pitch * 0.6 - this.heave * 0.6 + tr * 0.7, -0.03, sus.travel);
    this.forkComp = damp(this.forkComp, fT, 18, dt);
    this.rearComp = damp(this.rearComp, rT, 18, dt);
    const [wf, wr] = v.wheels;
    wf.spin.position.copy(wf.base);
    wf.spin.position.y += this.forkComp; // ao longo do garfo (Y local do nó FrontFork)
    if (v.swingarm) v.swingarm.rotation.x = this.rearComp / this._swingLen;

    // --- Direção: o garfo gira no eixo de direção (o físico já reduz o ângulo em velocidade).
    const steer = ph ? ph.steerAngle : 0;
    this.steerVis = damp(this.steerVis, steer, 20, dt);
    if (v.fork) v.fork.rotation.y = this.steerVis;

    // --- Rodas.
    const hb = v.controls.handbrake && speed > 0.5;
    if (ph) {
      wf.spin.rotation.x += (ph.vLong * dt) / wf.radius;
      if (!hb) wr.spin.rotation.x += (ph.vLong * dt) / wr.radius;
    }

    // Ponto de montagem virtual: sem animação de porta.
    for (const d of v.doors) d.open = d.target;

    // --- Luzes.
    const c = v.controls;
    this.braking = v.engineOn && (c.brake > 0.05 || (c.handbrake && speed > 1));
    this.reversing = v.engineOn && (c.throttle < 0 || (ph ? ph.vLong : 0) < -0.3);
    const m = v.mats;
    if (m.taillight) m.taillight.emissiveIntensity = this.braking ? 2.8 : v.headlightsOn ? 1.0 : 0.45;
    if (m.headlight) m.headlight.emissiveIntensity = v.headlightBroken ? 0.08 : v.headlightsOn ? 3.2 : (v.engineOn ? 0.9 : 0.35);
  }
}
