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
 *
 * Mecânica veicular (opcional, por veículo — setPowertrain): motor com curva de
 * torque, câmbio, nitro, turbo e calor (src/vehicles/mechanics) fornecem a força
 * motriz; este arquivo passa então a resolver também a tração: transferência de
 * carga longitudinal, limite de aderência por eixo (FWD/RWD/AWD), patinação com
 * rotação de roda própria, travamento de freio e o círculo de atrito ligando as
 * forças longitudinais às laterais. Sem módulo (trânsito, polícia, motos), o
 * caminho arcade original é usado sem alterações.
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
    this._waterDepth = 0;
    this.waterImmersion = 0;
    // Lâmina d'água que cobre as rodas (m) e velocidade de afundar (m/s).
    this._floatDepth = vehicle.spec.bike ? 0.6 : 0.9;
    this._sinkSpeed = vehicle.spec.bike ? 1.2 : 0.55;
    this.splash = 0;
    this.lastSafe = null;
    this._safeTimer = 0;
    this.landing = 0;
    this.rpm = H.idleRpm;
    this.gear = 0;
    // Optional separated engine/gearbox. Null preserves the original arcade path.
    this.powertrain = null;
    this.powertrainError = null;
    this.powertrainFrame = null;
    /** Eventos do câmbio/largada/nitro acumulados entre quadros (o HUD/áudio esvazia a fila). */
    this.powertrainEvents = [];
    // Estado do modelo de tração (só com o módulo ativo).
    this.cgHeight = 0.5;
    this.spinF = 0; this.spinR = 0;      // velocidade de escorregamento das rodas (m/s; + = patinando)
    this.wheelspin = 0;                  // maior escorregamento atual (m/s)
    this.brakeLock = { front: false, rear: false };
    this.absActive = false;
    this.tcsActive = false;
    this.axleLoad = { front: 0, rear: 0 };
    this.tractionLimited = false;
    this._axPrev = 0;
    this._FyPrev = [0, 0];
    this._wheelOmega = [0, 0, 0, 0];
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
    this.powertrain?.reset({ preserveNitrous: true });
    this.spinF = this.spinR = this.wheelspin = 0;
    this._axPrev = 0; this._FyPrev[0] = this._FyPrev[1] = 0;
  }

  setEnvironment(env, collision) {
    this.env = env;
    this.collision = collision;
  }

  wake() {
    this.awake = true;
    this.sleepTimer = 0;
  }

  /** Opt in explicitly; no vehicle or traffic preset is changed automatically. */
  setPowertrain(module) {
    if (module !== null && (!module || typeof module.step !== 'function' || typeof module.reset !== 'function')) {
      return { ok: false, error: { code: 'INVALID_POWERTRAIN', message: 'Expected step/reset methods or null' } };
    }
    this.powertrain = module;
    this.powertrainError = null;
    this.powertrainFrame = null;
    this.powertrainEvents.length = 0;
    // Centro de gravidade e altura próprios do modelo (diferenças reais entre os carros).
    const d = module?.drivetrain;
    this.a = this.L * (d ? 1 - d.frontWeight : 0.48);
    this.b = this.L - this.a;
    this.cgHeight = d?.cgHeight ?? 0.5;
    this.spinF = this.spinR = this.wheelspin = 0;
    module?.reset({ preserveNitrous: true });
    return { ok: true };
  }

  /** O módulo só dirige quando o carro é do jogador (trânsito e polícia seguem o modelo arcade). */
  get powertrainActive() {
    const d = this.v.driver;
    return !!this.powertrain && d !== 'ai' && d !== 'police';
  }

  /**
   * Tração (autoral): divide a força do motor entre os eixos motrizes, limita cada
   * eixo pela aderência disponível (μ·carga, menos o que a curva já consome) e
   * integra a patinação; freios e freio de mão também respeitam o limite e travam.
   * Devolve a força motriz entregue, a frenagem e os limites laterais por eixo.
   */
  _traction(h, demand, vLong, Fzf, Fzr, mu, c, H) {
    const d = this.powertrain.drivetrain, m = H.mass;
    const absV = Math.abs(vLong);
    const shareF = d.layout === 'FWD' ? 1 : d.layout === 'RWD' ? 0 : d.awdFront;
    const hbGrip = c.handbrake && absV > 6 ? H.handbrakeGrip : 1;
    const capF = mu * Fzf, capR = mu * Fzr * hbGrip;
    // Parte longitudinal ainda disponível depois da força lateral do passo anterior (círculo de atrito).
    const longCap = (cap, fy) => Math.max(cap * 0.3, Math.sqrt(Math.max(0, cap * cap - fy * fy)));
    const lcF = longCap(capF, this._FyPrev[0]), lcR = longCap(capR, this._FyPrev[1]);
    let dF = demand * shareF;
    let dR = demand * (1 - shareF);
    if (c.handbrake) dR *= 0.15; // rodas traseiras travadas: quase nada do motor passa
    // Controle de tração (assistência autoral): 'full' (câmbio automático) corta o excesso
    // antes que a roda patine; 'sport' (manual) deixa escorregar até ~1,5 m/s — marca o
    // asfalto e chia, mas a patinação não dispara; false desliga.
    this.tcsActive = false;
    const tcs = this.powertrain.tractionControl;
    if (tcs && demand > 0) {
      const lim = (dAx, cap, slip) => {
        if (tcs === 'sport' && Math.abs(slip) < 1.5) return dAx;
        const max = tcs === 'sport' ? cap * 0.88 : cap * 0.99; // abaixo do atrito cinético: a roda volta a agarrar
        if (Math.abs(dAx) <= max) return dAx;
        this.tcsActive = true;
        return Math.sign(dAx) * max;
      };
      dF = lim(dF, lcF, this.spinF); dR = lim(dR, lcR, this.spinR);
    }
    // Massa equivalente que a roda motriz precisa girar: inércia das rodas + motor visto
    // através da relação (I·i²/r²). Em marcha curta a patinação cresce e cede devagar.
    const r = this.v.spec.wheelRadius, ratio = this.powertrain.currentRatio ?? 0;
    const axleInertia = 2.4 + 0.18 * ratio * ratio * 0.9;
    const axle = (dAx, cap, key, share) => {
      let slip = this[key], out;
      const mEq = (share > 0 ? 2.4 + (axleInertia - 2.4) * share : 2.4) / (r * r);
      if (Math.abs(slip) > 0.05) {
        // Patinando: o pneu transmite o atrito cinético; a sobra (ou falta) de força gira (ou freia) a roda.
        const tire = Math.sign(slip) * cap * 0.9;
        const next = slip + ((dAx - tire) / mEq) * h;
        if (Math.sign(next) !== Math.sign(slip)) { slip = 0; out = clamp(dAx, -cap, cap); } else { slip = next; out = tire; }
      } else if (Math.abs(dAx) > cap) {
        slip = Math.sign(dAx) * ((Math.abs(dAx) - cap) / mEq) * h;
        out = Math.sign(dAx) * cap * 0.9;
      } else {
        slip = 0;
        out = dAx;
      }
      this[key] = clamp(slip, -12, 25);
      return out;
    };
    let outF = 0, outR = 0;
    if (shareF > 0) outF = axle(dF, lcF, 'spinF', shareF); else this.spinF = 0;
    if (shareF < 1) outR = axle(dR, lcR, 'spinR', 1 - shareF); else this.spinR = 0;
    // Freios: viés por modelo. O pedal tem ABS (assistência autoral): a força de cada eixo
    // fica no limite de aderência restante, sem travar — frear forte ainda consome a
    // aderência lateral (o carro esterça menos). O freio de mão trava as traseiras de verdade.
    const bF = c.brake * H.brakeForce * d.brakeBias;
    const bRfoot = c.brake * H.brakeForce * (1 - d.brakeBias);
    const remF = Math.max(0, lcF - Math.abs(outF)), remR = Math.max(0, lcR - Math.abs(outR));
    const lockF = false;
    const lockR = !!c.handbrake && absV > 1.5;
    const brakeF = absV > 1.5 ? Math.min(bF, remF) : bF;
    const brakeR = lockR ? Math.max(Math.min(bRfoot, remR), remR * 0.85) : (absV > 1.5 ? Math.min(bRfoot, remR) : bRfoot + (c.handbrake ? H.handbrakeForce : 0));
    this.absActive = absV > 1.5 && (bF > remF + 1 || bRfoot > remR + 1);
    // Limites laterais: o que sobra do círculo depois das forças longitudinais deste passo.
    const spinningF = Math.abs(this.spinF) > 1.5, spinningR = Math.abs(this.spinR) > 1.5;
    const latCap = (cap, used, locked, spinning) => Math.max(cap * 0.25, Math.sqrt(Math.max(0, cap * cap - used * used)))
      * (locked ? 0.45 : 1) * (spinning ? 0.8 : 1);
    const latF = latCap(capF, Math.abs(outF) + brakeF, lockF, spinningF);
    const latR = latCap(capR, Math.abs(outR) + brakeR, lockR && !c.handbrake, spinningR);
    this.wheelspin = Math.max(Math.abs(this.spinF), Math.abs(this.spinR));
    this.brakeLock.front = lockF; this.brakeLock.rear = lockR;
    this.tractionLimited = Math.abs(outF + outR) + 1 < Math.abs(dF + dR);
    return { drive: outF + outR, brakeResist: brakeF + brakeR, latF, latR };
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
    // Maior velocidade de batida em objeto quebrável pesado no quadro (queda da moto).
    this.propHit = 0;
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= PHYSICS_STEP && n < 16) {
      this.px = this.x; this.pz = this.z; this.py = this.y; this.pheading = this.heading;
      this._step(PHYSICS_STEP);
      this.acc -= PHYSICS_STEP;
      n++;
    }
    this.alpha = this.acc / PHYSICS_STEP;
    this._safetyNet(dt);
    this._updateDrivetrain(dt);
    // Repouso: veículo sem motorista parado por 1 s deixa de ser simulado.
    if (!this.v.driver && this.speed < 0.05 && Math.abs(this.yawRate) < 0.01 && this.vy === 0) {
      this.sleepTimer += dt;
      if (this.sleepTimer > 1) { this.awake = false; this.px = this.x; this.pz = this.z; this.py = this.y; this.pheading = this.heading; this.alpha = 1; }
    } else this.sleepTimer = 0;
    return n;
  }

  /**
   * Rede de segurança (o personagem a pé já tinha uma): guarda a última pose
   * apoiada em terra seca e, se o veículo despencar para baixo do mundo, volta
   * para ela parado — nunca fica caindo no vazio.
   */
  _safetyNet(dt) {
    this._safeTimer = (this._safeTimer ?? 0) - dt;
    if (this.vy === 0 && !this.inWater && this._safeTimer <= 0) {
      (this.lastSafe ??= {}).x = this.x; this.lastSafe.y = this.y; this.lastSafe.z = this.z; this.lastSafe.heading = this.heading;
      this._safeTimer = 0.5;
    }
    if (this.y > -80 || !this.lastSafe) return;
    const s = this.lastSafe;
    this.x = this.px = s.x; this.z = this.pz = s.z; this.y = this.py = s.y + 0.3;
    this.heading = this.pheading = s.heading;
    this.vx = this.vz = this.vy = this.yawRate = this.vLong = this.vLat = 0;
    this.alpha = 1;
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
      const wd = this.env.waterDepth ? this.env.waterDepth(this.x, this.z, this.y) : 0;
      this.inWater = wd > 0.3;
      this.surface = this.inWater ? 'water' : (this.env.getSurface?.(this.x, this.z, this.y) || 'asphalt');
      this._waterDepth = wd;
    }
    // Quanto do veículo está submerso (0 seco … 1 rodas cobertas / boiando).
    // Com as rodas cobertas não há tração nem direção: o carro (ou a moto) só
    // desliza freado pela água e afunda — não anda como em solo firme.
    const wl = this.env.waterLevel;
    this.waterImmersion = this.inWater && wl != null ? clamp((wl - this.y) / this._floatDepth, 0, 1) : 0;
    const traction = this.inWater ? clamp((1 - this.waterImmersion) * 2, 0, 1) : 1;
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
    let powertrainResistance = 0;
    const thr = c.throttle * (this.inWater ? 0.2 : 1);
    const pt = this.powertrainActive ? this.powertrain : null;
    const mu = H.grip * sp.grip * Math.max(0.05, traction);
    let Fzf = m * G * b / L, Fzr = m * G * a / L;
    let brakeResist = c.brake * H.brakeForce + (c.handbrake ? H.handbrakeForce : 0);
    let latF = Infinity, latR = Infinity;
    if (pt) {
      // Transferência de carga: acelerar alivia a frente e carrega a traseira; frear faz o contrário.
      const dT = m * this._axPrev * this.cgHeight / L;
      Fzf = clamp(Fzf - dT, 0.15 * m * G, 0.85 * m * G);
      Fzr = m * G - Fzf;
      this.axleLoad.front = Fzf; this.axleLoad.rear = Fzr;
      const r = v.spec.wheelRadius, wo = this._wheelOmega;
      wo[0] = wo[1] = (vLong + this.spinF) / r;
      wo[2] = wo[3] = (vLong + this.spinR) / r;
      const result = pt.step({ controls: c, forwardSpeedMps: vLong, performance: perf,
        surfaceGrip: sp.grip, inWater: this.inWater, engineOn: v.engineOn,
        wheelOmegaRadS: wo, tractionByPhysics: true, skid: this.skid }, h);
      this.powertrainError = result.ok ? null : result.error;
      this.powertrainFrame = result.ok ? result.value : null;
      if (result.ok) {
        const fr = result.value;
        powertrainResistance = fr.extraResistanceN;
        this.rpm = fr.rpm;
        this.gear = fr.gear;
        if (fr.events.length) {
          this.powertrainEvents.push(...fr.events);
          if (this.powertrainEvents.length > 60) this.powertrainEvents.splice(0, this.powertrainEvents.length - 60);
        }
        const t = this._traction(h, fr.driveForceN, vLong, Fzf, Fzr, mu, c, H);
        drive = t.drive; brakeResist = t.brakeResist; latF = t.latF; latR = t.latR;
      } else {
        const t = this._traction(h, 0, vLong, Fzf, Fzr, mu, c, H);
        brakeResist = t.brakeResist; latF = t.latF; latR = t.latR;
      }
    } else if (thr !== 0) {
      const dir = Math.sign(thr);
      const vmax = (dir > 0 ? H.maxSpeed : H.reverseSpeed) * (0.75 + 0.25 * perf);
      const along = Math.max(0, dir * vLong);
      const ratio = clamp(1 - (along / vmax) ** 2, 0, 1);
      drive = dir * Math.abs(thr) * H.engineForce * perf * ratio * (dir < 0 ? 0.55 : 1) * (0.7 + 0.3 * sp.grip);
      // Freio de mão trava as rodas traseiras (tração): quase sem força do motor.
      if (c.handbrake) drive *= 0.15;
    }
    // Forças resistivas (opostas ao movimento; nunca invertem o sentido).
    // Com o módulo, o freio-motor vem pela marcha (powertrain) e não é somado aqui.
    let resist = H.drag * vLong * vLong + H.rolling * sp.roll * absV + (!pt && thr === 0 ? H.engineBrake * Math.min(1, absV / 2) : 0);
    resist += brakeResist;
    resist += powertrainResistance;
    if (this.inWater) resist += m * 3;
    drive *= traction;
    // Gravidade ao longo do terreno: nariz para cima puxa para trás; lateral
    // mais alta empurra para o lado mais baixo (pneus resistem pela deriva).
    vLong -= G * Math.sin(this.groundPitch) * h;
    vLat -= G * Math.sin(this.groundRoll) * h * 0.6;
    vLong += (drive / m) * h;
    const dv = (resist / m) * h;
    if (Math.abs(vLong) <= dv) vLong = 0; else vLong -= Math.sign(vLong) * dv;

    // --- Lateral (modelo de bicicleta).
    const hbActive = c.handbrake && absV > 6;
    const muR = mu * (hbActive ? H.handbrakeGrip : 1);
    let Fyf = 0, Fyr = 0;
    if (absV > 0.5) {
      const sgn = vLong >= 0 ? 1 : -1;
      const af = Math.atan2(vLat + a * w, absV) - delta * sgn;
      const ar = Math.atan2(vLat - b * w, absV);
      const capF = Math.min(mu * Fzf, latF), capR = Math.min(muR * Fzr, latR);
      Fyf = clamp(-H.corneringFront * Fzf * af, -capF, capF);
      Fyr = clamp(-H.corneringRear * Fzr * ar, -capR, capR);
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
    const wKin = vLong * Math.tan(delta) / L * traction;
    w = lerp(wKin, w, k);
    vLat *= k + (1 - k) * Math.exp(-12 * h);

    // Arrasto da água: linear + quadrático (bater na água a 70 km/h para em ~1 s).
    const imm = this.waterImmersion;
    if (imm > 0) {
      const lin = Math.exp(-(0.6 + 3 * imm) * h);
      vLong *= lin; vLat *= lin;
      w *= Math.exp(-(1 + 4 * imm) * h);
      const q = 0.12 * imm * h;
      vLong -= Math.sign(vLong) * Math.min(Math.abs(vLong), q * vLong * vLong);
      vLat -= Math.sign(vLat) * Math.min(Math.abs(vLat), q * vLat * vLat);
    }

    // Estabilidade: limita a guinada fora do freio de mão.
    if (!hbActive) {
      const wMax = absV * Math.tan(H.steerMax) / L * (1.2 + (1 - H.stability) * 0.9) + 0.25;
      if (Math.abs(w) > wMax) w = lerp(w, Math.sign(w) * wMax, clamp(H.stability * 10 * h, 0, 1));
      vLat *= Math.exp(-H.stability * 0.8 * h);
    }

    this.aLong = (drive - Math.sign(vLong) * resist) / m;
    if (pt) {
      this._axPrev = clamp(this.aLong, -14, 14);
      this._FyPrev[0] = Fyf; this._FyPrev[1] = Fyr;
    }
    this.aLat = vLong * w;
    this.vLong = vLong;
    this.vLat = vLat;

    // Derrapagem: deriva traseira, freio de mão ou travamento.
    let slide = Math.max(0, Math.abs(this.slipRear) - 0.1) * 3 + (hbActive ? 0.5 : 0) + (c.brake > 0.9 && absV > 14 ? 0.35 : 0);
    // Patinação e rodas travadas (módulo de tração) também marcam o asfalto e chiam.
    if (pt) slide = Math.max(slide, this.wheelspin > 2 ? clamp((this.wheelspin - 2) / 6, 0, 0.85) : 0, this.brakeLock.front || (this.brakeLock.rear && !c.handbrake) ? 0.6 : 0);
    this.skid = absV > 4 && !this.inWater && this.surface !== 'grass' && this.surface !== 'sand' ? clamp(slide, 0, 1) : 0;

    // --- Integração.
    this.heading += w * h;
    this.yawRate = w;
    const s2 = Math.sin(this.heading), c2 = Math.cos(this.heading);
    this.vx = vLong * s2 + vLat * c2;
    this.vz = vLong * c2 - vLat * s2;
    this.x += this.vx * h;
    this.z += this.vz * h;

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
    if (this._sink(h, target)) { this._wheelGround = wy; return; }
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

  /**
   * Água funda (mais funda que as rodas): o fundo não sustenta o veículo até ele
   * chegar lá. Cai livre até a superfície, perde quase toda a velocidade vertical
   * no impacto e afunda devagar (empuxo + arrasto) até o fundo. Devolve true
   * quando a água controlou a altura neste passo.
   */
  _sink(h, target) {
    const wl = this.env.waterLevel;
    if (wl == null || !this.inWater || this._waterDepth <= this._floatDepth || target >= wl - this._floatDepth) return false;
    if (this.y > wl) {
      this.vy -= G * h;
      this.y += this.vy * h;
      if (this.y <= wl) { this.splash = Math.min(1, -this.vy / 8); this.vy *= 0.2; }
    } else {
      this.vy += (-this._sinkSpeed - this.vy) * Math.min(1, h * 2.5);
      this.y += this.vy * h;
    }
    if (this.y <= target) { this.y = target; this.vy = 0; }
    return true;
  }

  /** Marcha automática e rotação estimada (HUD e áudio). */
  _updateDrivetrain(dt) {
    // The injected module already advanced with each PHYSICS_STEP. A display
    // frame must not advance shift timers or nitrous for a second time.
    if (this.powertrainActive) return;
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
