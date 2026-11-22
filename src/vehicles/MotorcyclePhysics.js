import { VehiclePhysics } from './VehiclePhysics.js';
import { clamp } from '../utils/math.js';

/**
 * Física de motocicleta (NEON MOTORCYCLES): ESTENDE a física automotiva arcade
 * (mesmo passo fixo, mesmo modelo de bicicleta — que é exatamente uma moto —,
 * mesmas colisões, superfícies, água e recuperação). Acrescenta:
 *  - duas rodas no solo (arfagem pelo desnível entre elas; sem rolagem lateral)
 *  - inclinação nas curvas: ângulo de equilíbrio atan(v·ω/g), limitado por
 *    `leanMax` e com taxa `leanRate` (a moto deita antes e endireita na saída)
 *  - equilíbrio arcade: a moto nunca cai sozinha; parada fica em pé (o piloto
 *    apoia o pé) e, sem piloto, descansa no cavalete lateral
 *  - derrapagem traseira possível com freio de mão (o mesmo do carro, só na roda de trás)
 *  - ré só "empurrando com os pés" (reverseSpeed ~1,4 m/s, parada)
 */
const G = 9.81;

export class MotorcyclePhysics extends VehiclePhysics {
  constructor(vehicle, collision, env) {
    super(vehicle, collision, env);
    const s = vehicle.spec;
    // Inércia de guinada de uma moto (massa concentrada ao longo do entre-eixos).
    this.inertia = this.H.mass * (s.wheelBase * s.wheelBase) / 12 * this.H.inertiaScale;
    this.lean = 0;          // rad; + = deitada para a direita (mesmo sinal de root.rotation.z)
    this.leanTarget = 0;
    this._wheelY = [0, 0];
  }

  syncFromRoot() {
    super.syncFromRoot();
    this.lean = this.leanTarget = 0;
  }

  _step(h) {
    super._step(h);
    const H = this.H;
    const v = this.vLong;
    // Estabilidade arcade: a guinada segue a geometria da direção (bicicleta cinemática),
    // limitada pela aderência e pela inclinação máxima (a moto não faz curva mais fechada
    // do que conseguiria deitar); o deslizamento lateral é amortecido. Sem isso uma troca
    // brusca de direção em velocidade fazia a moto rodar. Freio traseiro (Espaço) ainda derrapa.
    const absV = Math.abs(v);
    const hb = this.v.controls.handbrake && absV > 6;
    if (!hb && absV > 0.5) {
      const aMax = G * Math.min(H.grip * 1.05, Math.tan(H.leanMax));
      const wLim = aMax / Math.max(absV, 1);
      const wT = clamp(v * Math.tan(this.steerAngle) / this.L, -wLim, wLim);
      this.yawRate += (wT - this.yawRate) * Math.min(1, 10 * h);
      this.vLat *= Math.exp(-8 * h);
      const s = Math.sin(this.heading), c = Math.cos(this.heading);
      this.vx = v * s + this.vLat * c;
      this.vz = v * c - this.vLat * s;
    }
    const speedK = clamp((Math.abs(v) - 0.8) / 3, 0, 1);
    // Curva à esquerda (ω > 0) → deita para a esquerda (rotação z negativa).
    let target = -Math.atan2(v * this.yawRate, G) * speedK;
    target = clamp(target, -H.leanMax, H.leanMax);
    this.leanTarget = target;
    const rate = (H.leanRate ?? 4) * h;
    this.lean += clamp(target - this.lean, -rate, rate);
  }

  /** Solo sob as duas rodas: altura, arfagem e "salto" ao descer degraus. */
  _ground(h) {
    const s = this.v.spec, col = this.collision;
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    const wy = this._wheelY;
    for (let i = 0; i < 2; i++) {
      const wl = this.v.wheels[i].local;
      const wx = this.x + wl.z * sin;
      const wz = this.z + wl.z * cos;
      wy[i] = col.getGroundHeight(wx, wz, this.y, 0.32);
    }
    const target = (wy[0] + wy[1]) / 2;
    this.groundPitch = Math.atan2(wy[0] - wy[1], s.wheelBase);
    this.groundRoll = 0;
    if (target >= this.y) {
      this.y += (target - this.y) * Math.min(1, h * 30);
      if (target - this.y < 0.004) this.y = target;
      this.vy = 0;
    } else {
      this.vy -= G * h;
      this.y += this.vy * h;
      if (this.y <= target) {
        if (this.vy < -1.5) this.landing = Math.min(1, -this.vy / 6);
        this.y = target;
        this.vy = 0;
      }
    }
    this._wheelGround = wy;
  }
}
