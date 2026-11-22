import { clamp, damp } from '../utils/math.js';

/**
 * Animação visual do veículo (sem afetar a física):
 *  - pose interpolada do passo fixo (posição, rumo, inclinação do terreno)
 *  - suspensão simplificada: molas amortecidas de arfagem, rolagem e altura
 *    (transferência de peso em acelerações, frenagens, curvas e impactos)
 *  - rodas: giro pela velocidade, esterçamento, curso da suspensão por roda,
 *    vibração leve em pisos irregulares; freio de mão trava as traseiras
 *  - volante acompanha o esterçamento; portas e faróis escamoteáveis animados
 *  - luzes: faróis, lanternas, luz de freio e luz de ré
 * Limitação documentada: a suspensão é visual (não altera aderência/colisão).
 */
const DOOR_MAX = 1.05;

export class VehicleAnimation {
  constructor(vehicle) {
    this.v = vehicle;
    this.pose = { x: 0, y: 0, z: 0, heading: 0 };
    this.pitch = 0; this.pitchV = 0;
    this.roll = 0; this.rollV = 0;
    this.heave = 0; this.heaveV = 0;
    this.gPitch = 0; this.gRoll = 0;
    this.time = Math.random() * 10;
    this.braking = false;
    this.reversing = false;
    vehicle.root.rotation.order = 'YXZ';
  }

  /** Impulso visual de impacto (carroceria reage discretamente). */
  jolt(strength, localNx, localNz) {
    const k = clamp(strength / 12, 0, 1);
    this.pitchV -= localNz * k * 1.2;
    this.rollV -= localNx * k * 1.0;
    this.heaveV += k * 0.4;
  }

  update(dt, active) {
    const v = this.v, ph = v.physics, H = v.spec.handling;
    this.time += dt;
    if (ph && (ph.awake || active)) {
      ph.interpolated(this.pose);
      const r = v.root;
      r.position.set(this.pose.x, this.pose.y, this.pose.z);
      this.gPitch = damp(this.gPitch, ph.groundPitch, 14, dt);
      this.gRoll = damp(this.gRoll, ph.groundRoll, 14, dt);
      r.rotation.set(-this.gPitch, this.pose.heading, this.gRoll, 'YXZ');
      v.heading = this.pose.heading;
      v.speed = ph.speed;
    }

    // --- Suspensão (molas amortecidas por eixo).
    const sus = H.suspension;
    const w0 = Math.PI * 2 * sus.freq;
    const z = sus.damping;
    const aLong = ph ? ph.aLong : 0, aLat = ph ? ph.aLat : 0;
    const pitchT = clamp(aLong * H.pitchGain, -0.07, 0.07);
    const rollT = clamp(aLat * H.rollGain, -0.09, 0.09);
    this.pitchV += (w0 * w0 * (pitchT - this.pitch) - 2 * z * w0 * this.pitchV) * dt;
    this.pitch += this.pitchV * dt;
    this.rollV += (w0 * w0 * (rollT - this.roll) - 2 * z * w0 * this.rollV) * dt;
    this.roll += this.rollV * dt;
    if (ph && ph.landing > 0) { this.heaveV -= ph.landing * 1.4; ph.landing = 0; }
    this.heaveV += (w0 * w0 * (0 - this.heave) - 2 * z * w0 * this.heaveV) * dt;
    this.heave += this.heaveV * dt;
    this.pitch = clamp(this.pitch, -0.12, 0.12);
    this.roll = clamp(this.roll, -0.14, 0.14);
    this.heave = clamp(this.heave, -sus.travel, sus.travel);

    // Vibração do piso (paralelepípedo/areia/grama) em movimento.
    const speed = ph ? Math.abs(ph.vLong) : 0;
    const rough = ph && (ph.surface === 'pavers' || ph.surface === 'sand' || ph.surface === 'grass') ? 1 : 0.25;
    const vib = Math.sin(this.time * 47) * Math.sin(this.time * 31) * 0.004 * rough * Math.min(1, speed / 8);

    const body = v.body;
    const dentF = body.userData.dentFront || 0, dentR = body.userData.dentRear || 0;
    body.rotation.set(-this.pitch + (dentF - dentR) * 0.012, 0, this.roll, 'YXZ');
    // rideOffset: altura personalizada (NEON CUSTOMS); 0 = fábrica.
    body.position.y = this.heave + vib + (body.userData.rideOffset || 0);
    body.scale.z = 1 - (dentF + dentR) * 0.012;

    // --- Rodas.
    const steer = ph ? ph.steerAngle : 0;
    const hb = v.controls.handbrake && speed > 0.5;
    const gy = ph?._wheelGround;
    for (let i = 0; i < v.wheels.length; i++) {
      const w = v.wheels[i];
      if (w.steer) w.pivot.rotation.y = steer;
      // Rodas motrizes giram com a patinação calculada pela física (mecânica veicular).
      if (ph && !(hb && !w.front)) w.spin.rotation.x += ((ph.vLong + (ph.powertrainActive ? (w.front ? ph.spinF : ph.spinR) : 0)) * dt) / w.radius;
      // Curso por roda: desnível do solo naquela roda + compressão da carroceria.
      let travel = 0;
      if (gy && ph) travel = clamp(gy[i] - ph.y, -0.12, 0.12);
      const load = (w.front ? -1 : 1) * this.pitch * 0.9 + (w.side > 0 ? -1 : 1) * this.roll * 0.6;
      w.pivot.position.y = w.baseY + travel * 0.6 - load * 0.35 + vib * 0.5;
    }

    // Volante (≈ 2,4 voltas de batente a batente, estilizado).
    if (v.steeringWheel) v.steeringWheel.rotation.y = (steer / H.steerMax) * 2.4;

    // Portas.
    for (const d of v.doors) {
      if (d.open !== d.target) {
        const rate = d.target > d.open ? 3.2 : 3.8;
        d.open = d.target > d.open ? Math.min(d.target, d.open + rate * dt) : Math.max(d.target, d.open - rate * dt);
      }
      const e = d.open * d.open * (3 - 2 * d.open);
      d.pivot.rotation.y = -d.side * e * DOOR_MAX;
    }

    // Faróis escamoteáveis.
    for (const p of v.popups) {
      const target = v.headlightsOn ? p.open : p.closed;
      p.pivot.rotation.x = damp(p.pivot.rotation.x, target, 6, dt);
    }

    // Luzes: freio, ré, faróis e lanternas.
    const c = v.controls;
    const fwd = ph ? ph.vLong : 0;
    this.braking = v.engineOn && (c.brake > 0.05 || (c.handbrake && speed > 1));
    this.reversing = v.engineOn && (c.throttle < 0 || fwd < -0.3);
    const m = v.mats;
    if (m.taillight) m.taillight.emissiveIntensity = this.braking ? 2.8 : v.headlightsOn ? 1.0 : 0.45;
    if (m.reverse) m.reverse.emissiveIntensity = this.reversing ? 2.2 : 0;
    if (m.headlight) m.headlight.emissiveIntensity = v.headlightBroken ? 0.08 : v.headlightsOn ? 3.2 : 0.35;
  }
}
