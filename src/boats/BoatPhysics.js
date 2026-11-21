/**
 * Física de embarcação (arcade com flutuação real):
 * - quatro pontos de flutuação (proa, popa, bombordo, boreste) amostram a
 *   MESMA superfície de ondas do shader; a média dá a altura e as diferenças
 *   dão arfagem (pitch) e balanço (roll), com mola-amortecedor e gravidade
 *   quando o casco sai da água (saltos em ondas);
 * - hélice: empuxo só com a popa submersa; arrasto quadrático + linear;
 *   deriva lateral amortecida; giro dependente da velocidade; inclinação
 *   nas curvas e empino da proa ao planar;
 * - fundo raso: encalhe (atrito forte, para o barco) e terreno das ilhas;
 * - colisões com píeres, estacas, rochas, limites e outros barcos (OBB do
 *   CollisionSystem, ignorando a camada de interiores em y=300), com dano.
 * Passo fixo de 1/60 s (estável com quadros longos).
 */
const STEP = 1 / 60;
const G = 9.8;

export class BoatPhysics {
  constructor(boat, collision, water) {
    this.boat = boat;
    this.spec = boat.spec;
    this.collision = collision;
    this.water = water;
    this.x = 0; this.z = 0; this.y = 0; this.heading = 0;
    this.vx = 0; this.vz = 0; this.vy = 0; this.yawRate = 0;
    this.pitch = 0; this.roll = 0; this.pitchVel = 0; this.rollVel = 0;
    this.throttle = 0; this.steer = 0;
    this.input = { throttle: 0, steer: 0, boost: false };
    this.submerged = 1;
    this.airborne = false;
    this.grounded = 0;
    this.depth = 10;
    this.acc = 0;
    this.contacts = [];
    this.lastImpact = 0;
    this.onImpact = null;
    this.sleeping = false;
    this._body = { x: 0, z: 0, rot: 0, hx: this.spec.width / 2, hz: this.spec.length / 2 };
    this.inertia = (this.spec.mass * (this.spec.length ** 2 + this.spec.width ** 2)) / 12;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading); }

  place(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.vx = this.vz = this.vy = this.yawRate = 0;
    this.pitch = this.roll = this.pitchVel = this.rollVel = 0;
    this.throttle = this.steer = 0;
    this.input.throttle = this.input.steer = 0;
    this.y = this.water.height(x, z);
    this.sleeping = false;
  }

  update(dt) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= STEP && n < 6) { this._step(STEP); this.acc -= STEP; n++; }
    if (n === 6) this.acc = 0;
  }

  /** Simulação simplificada (barcos distantes): só segue a onda e o rumo. */
  coarse(dt) {
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.heading += this.yawRate * dt;
    this.y = this.water.height(this.x, this.z);
    this.pitch *= 0.9; this.roll *= 0.9;
  }

  _step(h) {
    const s = this.spec, W = this.water;
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const rx = ch, rz = -sh; // bombordo (+X local) no mundo
    // ------------------------------------------------ flutuação (4 pontos)
    const hl = s.length * 0.4, hw = s.width * 0.4;
    const hBow = W.height(this.x + sh * hl, this.z + ch * hl);
    const hStern = W.height(this.x - sh * hl, this.z - ch * hl);
    const hPort = W.height(this.x + rx * hw, this.z + rz * hw);
    const hStar = W.height(this.x - rx * hw, this.z - rz * hw);
    const hMean = (hBow + hStern + hPort + hStar) / 4;
    const fwd = this.vx * sh + this.vz * ch;
    const lat = this.vx * rx + this.vz * rz;
    const planeK = Math.min(1, Math.max(0, (Math.abs(fwd) - s.maxSpeed * 0.3) / (s.maxSpeed * 0.5)));
    // Ao planar o casco sobe um pouco (menos área molhada).
    const targetY = hMean + planeK * s.draft * 0.35;
    const sub = targetY - this.y + s.draft * 0.5; // quanto do casco está abaixo da linha d'água
    this.submerged = Math.max(0, Math.min(1, sub / s.draft));
    this.airborne = this.y > targetY + 0.25;
    if (this.airborne) {
      this.vy -= G * h;
    } else {
      const k = 38, c = 7.5;
      this.vy += (k * (targetY - this.y) - c * this.vy) * h;
    }
    this.y += this.vy * h;
    if (this.y < targetY - s.draft * 1.4) { this.y = targetY - s.draft * 1.4; if (this.vy < 0) this.vy *= -0.2; }
    // Arfagem/balanço: inclinação da onda + empino ao planar + inclinação na curva.
    const wavePitch = Math.atan2(hBow - hStern, hl * 2);
    const waveRoll = Math.atan2(hPort - hStar, hw * 2);
    const steerBank = -this.steer * s.bank * Math.min(1, Math.abs(fwd) / (s.maxSpeed * 0.6));
    const pitchT = this.airborne ? this.pitch : -wavePitch - planeK * s.planing - this.throttle * 0.02 * Math.min(1, Math.abs(fwd) / 4);
    const rollT = this.airborne ? this.roll : waveRoll * 0.8 + steerBank;
    this.pitchVel += ((pitchT - this.pitch) * 30 - this.pitchVel * 6) * h;
    this.rollVel += ((rollT - this.roll) * 26 - this.rollVel * 5) * h;
    this.pitch += this.pitchVel * h;
    this.roll += this.rollVel * h;

    // ------------------------------------------------ controles
    const inp = this.input;
    const tIn = Math.max(-1, Math.min(1, inp.throttle));
    this.throttle += (tIn - this.throttle) * Math.min(1, h * (tIn === 0 ? 2.5 : 3.5));
    this.steer += (inp.steer - this.steer) * Math.min(1, h * 5);
    // ------------------------------------------------ fundo (encalhe)
    this.depth = W.depth(this.x, this.z);
    const seabed = W.level - this.depth;
    const keel = this.y - s.draft;
    this.grounded = Math.max(0, Math.min(1, (seabed - keel + 0.05) / 0.25));
    if (seabed > keel) { this.y += (seabed - keel) * Math.min(1, h * 12); if (this.vy < 0) this.vy = 0; }
    // ------------------------------------------------ propulsão
    const prop = this.submerged > 0.15 && !this.airborne && this.grounded < 0.9;
    const maxF = s.thrust * (inp.boost ? 1.12 : 1);
    let force = 0;
    // Ré com o barco ainda andando para a frente funciona como freio (hélice invertida em carga).
    const rev = fwd > 1 ? Math.max(s.reverse, 0.65) : s.reverse;
    if (prop) force = this.throttle >= 0 ? this.throttle * maxF : this.throttle * maxF * rev;
    // Limite de velocidade natural: arrasto calibrado para maxSpeed com empuxo total.
    const cd = s.thrust / (s.maxSpeed * s.maxSpeed);
    let aLong = (force - cd * fwd * Math.abs(fwd) - s.mass * 0.05 * fwd) / s.mass;
    let latN = lat * Math.exp(-s.lateral * h * (0.6 + 0.4 * this.submerged));
    // Encalhado: atrito forte com o fundo.
    if (this.grounded > 0) { aLong -= fwd * this.grounded * 6; latN *= Math.exp(-this.grounded * 8 * h); }
    const fwdN = fwd + aLong * h;
    this.vx = sh * fwdN + rx * latN;
    this.vz = ch * fwdN + rz * latN;
    // ------------------------------------------------ giro
    const sp = Math.abs(fwdN);
    const auth = Math.min(1, 0.25 + sp / 6) * (prop ? 1 : 0.3) * (1 - this.grounded * 0.85);
    const dir = fwdN >= -0.3 ? 1 : -1;
    const yawT = this.steer * s.turn * auth * dir * (1 - Math.min(0.35, sp / s.maxSpeed * 0.35));
    this.yawRate += (yawT - this.yawRate) * Math.min(1, h * 2.8);
    this.heading += this.yawRate * h;
    // Curva "carrega" a velocidade para o novo rumo (casco morde a água).
    // ------------------------------------------------ deslocamento + colisão
    const ox = this.x, oz = this.z;
    this.x += this.vx * h;
    this.z += this.vz * h;
    // Terra firme (praia seca da ilha ou da orla) na proa/popa: o casco para como numa parede.
    const dirL = fwdN >= 0 ? 1 : -1;
    const px = this.x + sh * dirL * s.length * 0.5, pz = this.z + ch * dirL * s.length * 0.5;
    if (W.depth(px, pz) < 0.08 && Math.abs(fwdN) > 0.3) {
      const imp = Math.abs(fwdN);
      this.x = ox; this.z = oz;
      this.vx *= -0.15; this.vz *= -0.15;
      this.yawRate *= 0.5;
      if (imp > 1.2) { this.lastImpact = imp; this.onImpact?.(imp * 0.8); }
    }
    this._collide(h);
  }

  _collide(h) {
    const s = this.spec, body = this._body;
    body.x = this.x; body.z = this.z; body.rot = this.heading;
    const feet = this.y - s.draft;
    const n = this.collision.resolveOBB(body, feet, s.draft + s.height, 0.12, this.boat.id, this.contacts, 4);
    if (!n) return;
    this.x = body.x; this.z = body.z;
    let impact = 0;
    const m = s.mass, I = this.inertia;
    for (const ct of this.contacts) {
      const rx = ct.px - this.x, rz = ct.pz - this.z;
      const pvx = this.vx + this.yawRate * rz, pvz = this.vz - this.yawRate * rx;
      const other = ct.collider.tags?.includes('boat') ? this.resolveOther?.(ct.collider.ownerId) : null;
      let rvx = pvx, rvz = pvz;
      if (other) { rvx -= other.vx; rvz -= other.vz; }
      const vn = rvx * ct.nx + rvz * ct.nz;
      if (vn >= 0) continue;
      const cr = rz * ct.nx - rx * ct.nz;
      const m2inv = other ? 1 / other.spec.mass : 0;
      const J = -(1 + 0.25) * vn / (1 / m + m2inv + (cr * cr) / I);
      this.vx += (J * ct.nx) / m; this.vz += (J * ct.nz) / m;
      this.yawRate += ((cr * J) / I) * 0.5;
      if (other) { other.vx -= J * ct.nx * m2inv; other.vz -= J * ct.nz * m2inv; other.sleeping = false; }
      // Atrito tangencial.
      const tx = -ct.nz, tz = ct.nx, vt = rvx * tx + rvz * tz;
      this.vx -= tx * vt * 0.25; this.vz -= tz * vt * 0.25;
      impact = Math.max(impact, -vn);
    }
    if (impact > 1.2) {
      this.lastImpact = impact;
      this.onImpact?.(impact);
    }
  }
}
