import { clamp, lerp, angleDelta } from '../utils/math.js';

/**
 * Física automotiva arcade (passo fixo, 1/120 s) com interpolação visual.
 *
 * Modelo de bicicleta: ângulos de deriva dianteiro/traseiro geram forças
 * laterais lineares limitadas pela aderência (μ·carga); em baixa velocidade o
 * modelo é misturado ao cinemático (sem giro no próprio eixo parado).
 * Forças longitudinais: motor com curva decrescente, freio, freio-motor,
 * freio de mão (só traseiro, reduz aderência traseira), arrasto e rolamento.
 * Correções de estabilidade limitam a taxa de guinada fora de derrapagens.
 * Solo amostrado em cada roda (meio-fio, rampas, areia); colisões via
 * CollisionSystem.resolveOBB com resposta por impulso (linear + angular).
 *
 * Convenções: rumo (heading) igual a root.rotation.y; frente = (sin h, cos h);
 * esquerda = (cos h, −sin h); guinada positiva = curva à esquerda.
 * Entradas: vehicle.controls { throttle −1..1, brake 0..1, steer −1..1
 * (+1 = direita), handbrake } — mesma interface para jogador e IA.
 */
export const PHYSICS_STEP = 1 / 120;
const G = 9.81;
const SURFACE = {
  asphalt: { grip: 1.0, roll: 1.0 },
  concrete: { grip: 0.96, roll: 1.05 },
  pavers: { grip: 0.9, roll: 1.2 },
  grass: { grip: 0.72, roll: 2.2 },
  sand: { grip: 0.58, roll: 4.5 },
  water: { grip: 0.4, roll: 6.0 },
  wood: { grip: 0.85, roll: 1.2 },
};

export class VehiclePhysics {
  constructor(vehicle, collision, env) {
    this.v = vehicle;
    this.collision = collision;
    this.env = env;
    const s = vehicle.spec;
    const H = s.handling;
    this.H = H;
    this.L = s.wheelBase;
    this.a = s.wheelBase * 0.48; // CG um pouco à frente do centro
    this.b = this.L - this.a;
    this.inertia = H.mass * (s.length * s.length + s.width * s.width) / 12 * H.inertiaScale;
    // Estado atual e anterior (para interpolação).
    this.x = 0; this.z = 0; this.y = 0; this.heading = 0;
    this.px = 0; this.pz = 0; this.py = 0; this.pheading = 0;
    this.vx = 0; this.vz = 0; this.vy = 0; this.yawRate = 0;
    this.steerAngle = 0;
    this.vLong = 0; this.vLat = 0;
    this.aLong = 0; this.aLat = 0;
    this.groundPitch = 0; this.groundRoll = 0;
    this.slipFront = 0; this.slipRear = 0;
    this.skid = 0;            // 0..1 intensidade de derrapagem (marcas/som)
    this.surface = 'asphalt';
    this.surfaceTimer = 0;
    this.awake = false;
    this.sleepTimer = 0;
    this.acc = 0;
    this.alpha = 1;
    this.contacts = [];
    this.impact = 0;          // maior velocidade normal de impacto no quadro
    this.impactPoint = { x: 0, z: 0, nx: 0, nz: 0 };
    this.contactTimer = 0;
    this.stuckTime = 0;
    this.inWater = false;
    this.landing = 0;
    this.rpm = H.idleRpm;
    this.gear = 0;
    this._body = { x: 0, z: 0, rot: 0, hx: s.width / 2, hz: s.length / 2 };
    /** Resolve o id de um veículo (colisor com tag 'vehicle') para sua física. */
    this.resolveOther = null;
    /** Impacto recebido de outro veículo (aplicado pelo VehicleManager). */
    this.externalImpact = 0;
    this._wheelY = [0, 0, 0, 0];
    this._propContact = contact => this.env.destruction?.vehicleContact(contact, this) ?? true;
  }

  /** Copia a pose do root (veículo estacionado/teleportado). */
  syncFromRoot() {
    const r = this.v.root;
    this.x = this.px = r.position.x;
    this.z = this.pz = r.position.z;
    this.y = this.py = r.position.y;
    this.heading = this.pheading = r.rotation.y;
    this.vx = this.vz = this.vy = this.yawRate = 0;
    this.vLong = this.vLat = 0;
    this.acc = 0;
  }

  setEnvironment(env, collision) {
    this.env = env;
    this.collision = collision;
  }

  wake() {
    this.awake = true;
    this.sleepTimer = 0;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  /** Velocidade com sinal ao longo da frente do carro (m/s). */
  get forwardSpeed() {
    return this.vLong;
  }

  /** Avança a simulação em passos fixos; retorna o nº de passos executados. */
  update(dt) {
    if (!this.awake) return 0;
    this.impact = 0;
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= PHYSICS_STEP && n < 16) {
      this.px = this.x; this.pz = this.z; this.py = this.y; this.pheading = this.heading;
      this._step(PHYSICS_STEP);
      this.acc -= PHYSICS_STEP;
      n++;
    }
    this.alpha = this.acc / PHYSICS_STEP;
    this._updateDrivetrain(dt);
    // Repouso: veículo sem motorista parado por 1 s deixa de ser simulado.
    if (!this.v.driver && this.speed < 0.05 && Math.abs(this.yawRate) < 0.01 && this.vy === 0) {
      this.sleepTimer += dt;
      if (this.sleepTimer > 1) { this.awake = false; this.px = this.x; this.pz = this.z; this.py = this.y; this.pheading = this.heading; this.alpha = 1; }
    } else this.sleepTimer = 0;
    return n;
  }

  /** Pose interpolada para renderização. */
  interpolated(out) {
    const t = this.alpha;
    out.x = lerp(this.px, this.x, t);
    out.y = lerp(this.py, this.y, t);
    out.z = lerp(this.pz, this.z, t);
    out.heading = this.pheading + angleDelta(this.pheading, this.heading) * t;
    return out;
  }

  _surfaceProps() {
    return SURFACE[this.surface] || SURFACE.asphalt;
  }

  _step(h) {
    const H = this.H, v = this.v, c = v.controls;
    const m = H.mass, a = this.a, b = this.b, L = this.L;
    const perf = v.damage ? v.damage.performance : 1;

    // Superfície (amostrada a cada 0,1 s) e água.
    this.surfaceTimer -= h;
    if (this.surfaceTimer <= 0) {
      this.surfaceTimer = 0.1;
      const wd = this.env.waterDepth ? this.env.waterDepth(this.x, this.z) : 0;
      this.inWater = wd > 0.3;
      this.surface = this.inWater ? 'water' : (this.env.getSurface?.(this.x, this.z) || 'asphalt');
      this._waterDepth = wd;
    }
    const sp = this._surfaceProps();

    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    let vLong = this.vx * sin + this.vz * cos;
    let vLat = this.vx * cos - this.vz * sin;
    let w = this.yawRate;
    const absV = Math.abs(vLong);

    // --- Direção: limite cai com a velocidade; retorno mais rápido que o giro.
    const target = -c.steer * H.steerMax / (1 + absV * H.steerSpeedFalloff);
    const returning = Math.abs(target) < Math.abs(this.steerAngle) || Math.sign(target) !== Math.sign(this.steerAngle);
    const rate = (returning ? H.steerReturn : H.steerSpeed) * h;
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate);
    const delta = this.steerAngle;

    // --- Longitudinal.
    let drive = 0;
    const thr = c.throttle * (this.inWater ? 0.2 : 1);
    if (thr !== 0) {
      const dir = Math.sign(thr);
      const vmax = (dir > 0 ? H.maxSpeed : H.reverseSpeed) * (0.75 + 0.25 * perf);
      const along = Math.max(0, dir * vLong);
      const ratio = clamp(1 - (along / vmax) ** 2, 0, 1);
      drive = dir * Math.abs(thr) * H.engineForce * perf * ratio * (dir < 0 ? 0.55 : 1) * (0.7 + 0.3 * sp.grip);
      // Freio de mão trava as rodas traseiras (tração): quase sem força do motor.
      if (c.handbrake) drive *= 0.15;
    }
    // Forças resistivas (opostas ao movimento; nunca invertem o sentido).
    let resist = H.drag * vLong * vLong + H.rolling * sp.roll * absV + (thr === 0 ? H.engineBrake * Math.min(1, absV / 2) : 0);
    resist += c.brake * H.brakeForce;
    if (c.handbrake) resist += H.handbrakeForce;
    if (this.inWater) resist += m * 3;
    // Gravidade ao longo do terreno: nariz para cima puxa para trás; lateral
    // mais alta empurra para o lado mais baixo (pneus resistem pela deriva).
    vLong -= G * Math.sin(this.groundPitch) * h;
    vLat -= G * Math.sin(this.groundRoll) * h * 0.6;
    vLong += (drive / m) * h;
    const dv = (resist / m) * h;
    if (Math.abs(vLong) <= dv) vLong = 0; else vLong -= Math.sign(vLong) * dv;

    // --- Lateral (modelo de bicicleta).
    const mu = H.grip * sp.grip;
    const hbActive = c.handbrake && absV > 6;
    const muR = mu * (hbActive ? H.handbrakeGrip : 1);
    const Fzf = m * G * b / L, Fzr = m * G * a / L;
    let Fyf = 0, Fyr = 0;
    if (absV > 0.5) {
      const sgn = vLong >= 0 ? 1 : -1;
      const af = Math.atan2(vLat + a * w, absV) - delta * sgn;
      const ar = Math.atan2(vLat - b * w, absV);
      Fyf = clamp(-H.corneringFront * Fzf * af, -mu * Fzf, mu * Fzf);
      Fyr = clamp(-H.corneringRear * Fzr * ar, -muR * Fzr, muR * Fzr);
      this.slipFront = af;
      this.slipRear = ar;
    } else {
      this.slipFront = this.slipRear = 0;
    }
    const cd = Math.cos(delta), sd = Math.sin(delta);
    const aLong = (-Fyf * sd) / m + vLat * w;
    const aLat = (Fyr + Fyf * cd) / m - vLong * w;
    vLong += aLong * h;
    vLat += aLat * h;
    w += ((a * Fyf * cd - b * Fyr) / this.inertia) * h;

    // Baixa velocidade: mistura com o modelo cinemático (sem pivotar parado).
    const k = clamp((absV - 0.5) / 3.5, 0, 1);
    const wKin = vLong * Math.tan(delta) / L;
    w = lerp(wKin, w, k);
    vLat *= k + (1 - k) * Math.exp(-12 * h);

    // Estabilidade: limita a guinada fora do freio de mão.
    if (!hbActive) {
      const wMax = absV * Math.tan(H.steerMax) / L * (1.2 + (1 - H.stability) * 0.9) + 0.25;
      if (Math.abs(w) > wMax) w = lerp(w, Math.sign(w) * wMax, clamp(H.stability * 10 * h, 0, 1));
      vLat *= Math.exp(-H.stability * 0.8 * h);
    }

    this.aLong = (drive - Math.sign(vLong) * resist) / m;
    this.aLat = vLong * w;
    this.vLong = vLong;
    this.vLat = vLat;

    // Derrapagem: deriva traseira, freio de mão ou travamento.
    const slide = Math.max(0, Math.abs(this.slipRear) - 0.1) * 3 + (hbActive ? 0.5 : 0) + (c.brake > 0.9 && absV > 14 ? 0.35 : 0);
    this.skid = absV > 4 && !this.inWater && this.surface !== 'grass' && this.surface !== 'sand' ? clamp(slide, 0, 1) : 0;

    // --- Integração.
    this.heading += w * h;
    this.yawRate = w;
    const s2 = Math.sin(this.heading), c2 = Math.cos(this.heading);
    this.vx = vLong * s2 + vLat * c2;
    this.vz = vLong * c2 - vLat * s2;
    const ox = this.x, oz = this.z;
    this.x += this.vx * h;
    this.z += this.vz * h;

    // Água funda: bloqueia como parede (não afunda o carro).
    if (this._waterDepth > 0.75) {
      this.x = ox; this.z = oz;
      this.vx *= -0.1; this.vz *= -0.1;
    }

    this._collide(h);
    this._ground(h);
  }

  _collide(h) {
    const v = this.v, body = this._body, s = v.spec;
    body.x = this.x; body.z = this.z; body.rot = this.heading;
    const n = this.collision.resolveOBB(body, this.y, s.height * 0.9, 0.32, v.id, this.contacts, 4, this._propContact);
    if (!n) { this.contactTimer = Math.max(0, this.contactTimer - h); return; }
    this.contactTimer = 0.4;
    this.x = body.x; this.z = body.z;
    const m = this.H.mass, I = this.inertia;
    for (const ct of this.contacts) {
      const rx = ct.px - this.x, rz = ct.pz - this.z;
      // Velocidade do ponto de contato (rotação em torno de +Y).
      let pvx = this.vx + this.yawRate * rz, pvz = this.vz - this.yawRate * rx;
      const other = this.resolveOther && ct.collider.tags?.includes('vehicle') ? this.resolveOther(ct.collider.ownerId) : null;
      if (other) { pvx -= other.vx; pvz -= other.vz; }
      const vn = pvx * ct.nx + pvz * ct.nz;
      if (vn >= 0) continue;
      const cr = rz * ct.nx - rx * ct.nz;
      // Carros deformam: pouco ricochete contra obstáculos fixos; um pouco mais entre veículos.
      const e = other ? 0.2 : 0.1;
      const m2inv = other ? 1 / other.H.mass : 0;
      const J = -(1 + e) * vn / (1 / m + m2inv + (cr * cr) / I);
      if (other) {
        // Reação no outro veículo (linear + giro leve); ele acorda e desliza freado.
        other.wake();
        other.vx -= J * ct.nx * m2inv;
        other.vz -= J * ct.nz * m2inv;
        const r2x = ct.px - other.x, r2z = ct.pz - other.z;
        other.yawRate -= ((r2z * ct.nx - r2x * ct.nz) * J) / other.inertia * 0.5;
        other.externalImpact = Math.max(other.externalImpact, -vn);
      }
      this.vx += (J * ct.nx) / m;
      this.vz += (J * ct.nz) / m;
      this.yawRate += (cr * J) / I * 0.6;
      // Atrito tangencial no contato.
      const tx = -ct.nz, tz = ct.nx;
      const vt = pvx * tx + pvz * tz;
      const Jt = clamp(-vt * m * 0.35, -0.4 * J, 0.4 * J);
      this.vx += (Jt * tx) / m;
      this.vz += (Jt * tz) / m;
      if (-vn > this.impact) {
        this.impact = -vn;
        this.impactPoint.x = ct.px; this.impactPoint.z = ct.pz;
        this.impactPoint.nx = ct.nx; this.impactPoint.nz = ct.nz;
      }
    }
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    this.vLong = this.vx * sin + this.vz * cos;
    this.vLat = this.vx * cos - this.vz * sin;
  }

  /** Altura do solo em cada roda: altura, inclinação e "salto" ao descer degraus. */
  _ground(h) {
    const s = this.v.spec, col = this.collision;
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    const wy = this._wheelY;
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const wl = this.v.wheels[i].local;
      const wx = this.x + wl.x * cos + wl.z * sin;
      const wz = this.z - wl.x * sin + wl.z * cos;
      wy[i] = col.getGroundHeight(wx, wz, this.y, 0.36);
      sum += wy[i];
    }
    const target = sum / 4;
    // Rodas: 0 fl, 1 fr, 2 rl, 3 rr.
    this.groundPitch = Math.atan2(((wy[0] + wy[1]) - (wy[2] + wy[3])) / 2, s.wheelBase);
    this.groundRoll = Math.atan2(((wy[0] + wy[2]) - (wy[1] + wy[3])) / 2, s.track);
    if (target >= this.y) {
      // Subida (meio-fio, rampa): acompanha rápido, sem saltos visuais.
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

  /** Marcha automática e rotação estimada (HUD e áudio). */
  _updateDrivetrain(dt) {
    const H = this.H, c = this.v.controls;
    const v = Math.abs(this.vLong);
    const gears = H.gears;
    let g = 1;
    while (g < gears.length - 1 && v > gears[g]) g++;
    const lo = gears[g - 1], hi = gears[g];
    const frac = clamp((v - lo) / Math.max(1, hi - lo), 0, 1);
    let target = H.idleRpm + frac * (H.redline - H.idleRpm) * 0.92;
    if (g > 1) target = Math.max(target, H.idleRpm + (H.redline - H.idleRpm) * 0.38 + frac * (H.redline - H.idleRpm) * 0.54);
    // Acelerando parado (ou patinando): o motor sobe de giro.
    if (Math.abs(c.throttle) > 0.1 && v < 2) target = Math.max(target, H.idleRpm + Math.abs(c.throttle) * (H.redline - H.idleRpm) * 0.45);
    if (!this.v.engineOn) target = 0;
    this.rpm += (target - this.rpm) * Math.min(1, dt * 7);
    if (!this.v.engineOn) this.gear = 'P';
    else if (this.vLong < -0.3 || c.throttle < 0) this.gear = 'R';
    else if (v < 0.3 && c.throttle <= 0) this.gear = 'N';
    else this.gear = g;
  }
}
