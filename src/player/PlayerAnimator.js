import { clamp, damp, dampFactor, lerp } from '../utils/math.js';

/**
 * Animação procedural do protagonista.
 * Calcula uma pose-alvo a partir de camadas (idle, locomoção, ar, aterrissagem,
 * curva) e aplica cada articulação com amortecimento — sem estalos.
 *
 * Convenções (frente +Z):
 *  - balanço de quadril/ombro positivo = para frente (rotation.x negativa)
 *  - joelho positivo dobra para trás; cotovelo positivo dobra para frente
 */
const TWO_PI = Math.PI * 2;

const POSE_KEYS = [
  'hipsY', 'hipsX', 'hipsYaw', 'hipsPitch',
  'spinePitch', 'spineYaw', 'spineRoll', 'headPitch', 'headYaw', 'headRoll',
  'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR', 'hipSpreadL', 'hipSpreadR',
  'shoulderL', 'elbowL', 'armOutL', 'shoulderR', 'elbowR', 'armOutR', 'wristL', 'wristR',
];

const AIR_KEYS = [
  'hipL', 'kneeL', 'hipR', 'kneeR', 'ankleL', 'ankleR', 'shoulderL', 'shoulderR',
  'armOutL', 'armOutR', 'elbowL', 'elbowR', 'spinePitch', 'headPitch',
];

function emptyPose() {
  const p = {};
  for (const k of POSE_KEYS) p[k] = 0;
  return p;
}

export class PlayerAnimator {
  constructor(model, config) {
    this.j = model.joints;
    this.cfg = config;
    this.pose = emptyPose();
    this.target = emptyPose();
    this._airPose = emptyPose();
    this._bob = { phase: 0, move: 0, run: 0, land: 0, air: 0 };
    this.phase = 0;
    this.time = 0;
    this.moveBlend = 0;
    this.runBlend = 0;
    this.airBlend = 0;
    this.landCrouch = 0;
    this.turnLean = 0;
    this.turnStep = 0;
    this.idleLook = 0;
    this.direction = 1;
    this.lastStepPhase = 0;
    this.onFootstep = null;
    this.hipsBaseY = model.joints.hips.position.y;
    // Pose sentada (veículos): alvo e mistura suavizada.
    this.seatTarget = 0;
    this.seatBlend = 0;
    this.seatRecline = 0.3;
    this.seatSteer = 0;
    this.seatDuck = 0;
    /** Centro do volante em relação ao quadril sentado ({ y, z }), ou null. */
    this.seatGrip = null;
    /** Altura do assoalho (apoio dos pés) em relação ao quadril sentado, ou null. */
    this.seatFloor = null;
    /** Altura do teto acima do quadril sentado (null = conversível/sem teto). */
    this.seatHeadroom = null;
    /**
     * Camada armada (preenchida pelo WeaponManager): hold 'pistol' | 'long' |
     * null; draw 0..1 (sacar); aim 0..1; pitch (rad, + para cima); kick
     * (recuo, decai); reload 0..1 ou -1 (mão de apoio vai ao carregador).
     */
    this.weapon = { hold: null, draw: 0, aim: 0, pitch: 0, kick: 0, reload: -1 };
    this._seatPose = emptyPose();
    // Proporções do esqueleto para a IK dos braços no volante.
    const A = model.joints.arms.L;
    this._spineOff = model.joints.spine.position.y + model.joints.chest.position.y;
    this._shoulderOff = A.shoulder.position.y;
    this._upperArm = A.elbow.position.length();
    this._foreArm = A.wrist.position.length() + 0.07; // o volante fica na palma, não no pulso
    const Lg = model.joints.legs.L;
    this._hipOffY = Lg.hip.position.y;
    this._thigh = Lg.knee.position.length();
    this._shin = Lg.ankle.position.length();
  }

  /**
   * IK planar das pernas sentado: tornozelo no assoalho, a 92% do alcance
   * (joelho levemente dobrado). Retorna [quadril, joelho, tornozelo].
   */
  _legIK(floorY, out) {
    const L1 = this._thigh, L2 = this._shin;
    const dy = floorY - this._hipOffY;
    const reach = (L1 + L2) * 0.92;
    const dz = Math.sqrt(Math.max(0.01, reach * reach - dy * dy));
    const d = clamp(Math.hypot(dy, dz), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.004);
    const phi = Math.atan2(dz, -dy);
    const knee = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    const delta = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const thigh = phi + delta; // joelho para cima
    const shin = thigh - knee;
    out[0] = thigh;
    out[1] = knee;
    out[2] = (0.35 - shin) / 0.6; // pé no pedal, ponta levemente para cima
    return out;
  }

  /**
   * IK planar de dois ossos (plano sagital do tronco) para levar a mão até o
   * volante. Retorna [ombro, cotovelo] em radianos (convenção do _apply).
   */
  _armIK(gy, gz, rc, out) {
    const sy = this._spineOff + this._shoulderOff * Math.cos(rc);
    const sz = -this._shoulderOff * Math.sin(rc);
    const dy = gy - sy, dz = gz - sz;
    const L1 = this._upperArm, L2 = this._foreArm;
    const d = clamp(Math.hypot(dy, dz), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.004);
    const phi = Math.atan2(dz, -dy); // ângulo a partir de "para baixo", positivo para a frente
    const elbow = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    const delta = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    // O tronco reclinado já gira o braço para a frente: desconta a inclinação.
    out[0] = phi - delta - rc;
    out[1] = elbow;
    return out;
  }

  /** Disparado pelo controlador ao tocar o chão. impact = velocidade vertical (m/s). */
  land(impact) {
    const k = clamp((impact - 2) / 10, 0.15, 1);
    this.landCrouch = Math.max(this.landCrouch, k);
  }

  /**
   * @param {object} s estado do controlador: speed, grounded, vy, turnRate,
   *                   forwardSign (−1 andando de costas), wading
   */
  update(dt, s) {
    this.time += dt;
    const c = this.cfg;
    const speed = s.speed;
    const moveT = clamp(speed / c.walkSpeed, 0, 1);
    const runT = clamp((speed - c.walkSpeed) / (c.runSpeed - c.walkSpeed), 0, 1);
    this.moveBlend = damp(this.moveBlend, moveT, 10, dt);
    this.runBlend = damp(this.runBlend, runT, 6, dt);
    this.airBlend = damp(this.airBlend, s.grounded ? 0 : 1, s.grounded ? 14 : 9, dt);
    this.landCrouch = Math.max(0, this.landCrouch - dt * 3.2);
    this.turnLean = damp(this.turnLean, clamp(s.turnRate * speed * 0.018, -0.22, 0.22), 6, dt);
    this.direction = damp(this.direction, s.forwardSign ?? 1, 8, dt);

    // Fase do passo avança com a distância percorrida.
    const stride = lerp(1.45, 2.5, this.runBlend);
    const turning = clamp(Math.abs(s.turnRate) / 4, 0, 1) * (1 - this.moveBlend);
    this.turnStep = damp(this.turnStep, turning, 8, dt);
    if (s.grounded) {
      this.phase += (speed / stride) * TWO_PI * dt + this.turnStep * dt * 7;
      this._footsteps(s);
    }

    const t = this.target;
    for (const k of POSE_KEYS) t[k] = 0;
    const mv = this.moveBlend, run = this.runBlend;
    const ph = this.phase * Math.sign(this.direction || 1);
    const sn = Math.sin(ph), cs = Math.cos(ph);

    // ---------------------------------------------------------- idle
    const idle = 1 - mv;
    const breath = Math.sin(this.time * 1.7);
    t.spinePitch += breath * 0.012 * idle;
    t.shoulderL += breath * 0.02 * idle;
    t.shoulderR += breath * 0.02 * idle;
    t.armOutL += 0.07 * idle;
    t.armOutR += 0.07 * idle;
    t.elbowL += 0.12 * idle;
    t.elbowR += 0.12 * idle;
    t.hipsX += Math.sin(this.time * 0.55) * 0.012 * idle;
    t.hipsYaw += Math.sin(this.time * 0.55) * 0.03 * idle;
    this.idleLook = Math.sin(this.time * 0.31) * Math.sin(this.time * 0.17);
    t.headYaw += this.idleLook * 0.32 * idle;
    t.headPitch += Math.sin(this.time * 0.43) * 0.04 * idle;

    // ---------------------------------------------------- locomoção
    const legAmp = lerp(0.42, 0.92, run) * mv + this.turnStep * 0.22;
    const kneeAmp = lerp(0.7, 1.7, run) * mv + this.turnStep * 0.4;
    t.hipL += sn * legAmp;
    t.hipR -= sn * legAmp;
    t.kneeL += (0.08 + Math.max(0, cs) * kneeAmp) * Math.min(1, mv + this.turnStep);
    t.kneeR += (0.08 + Math.max(0, -cs) * kneeAmp) * Math.min(1, mv + this.turnStep);
    t.ankleL += (-sn * 0.25 + Math.max(0, cs) * 0.35) * mv;
    t.ankleR += (sn * 0.25 + Math.max(0, -cs) * 0.35) * mv;
    // Pelve gira com a perna que avança; ombros giram ao contrário; cabeça estabiliza.
    t.hipsYaw -= sn * lerp(0.08, 0.12, run) * mv;
    t.spineYaw += sn * lerp(0.17, 0.3, run) * mv;
    t.headYaw -= sn * lerp(0.09, 0.17, run) * mv;
    t.hipsY += (Math.abs(cs) - 0.6) * lerp(0.035, 0.075, run) * mv - 0.03 * run;
    t.hipsX += sn * 0.018 * mv * (1 - run);
    t.spinePitch += lerp(0.04, 0.2, run) * mv;
    t.headPitch -= lerp(0.02, 0.14, run) * mv;
    const armAmp = lerp(0.32, 0.95, run) * mv;
    t.shoulderL -= sn * armAmp;
    t.shoulderR += sn * armAmp;
    t.elbowL += lerp(0.25, 1.35, run) * mv + Math.max(0, -sn) * 0.25 * run;
    t.elbowR += lerp(0.25, 1.35, run) * mv + Math.max(0, sn) * 0.25 * run;
    t.armOutL += lerp(0.06, 0.16, run) * mv;
    t.armOutR += lerp(0.06, 0.16, run) * mv;
    if (s.wading && !s.swimming) {
      t.kneeL += 0.15 * mv; t.kneeR += 0.15 * mv;
      t.armOutL += 0.25 * mv; t.armOutR += 0.25 * mv;
    }
    // Nado (pose procedural de reserva: braçada de peito + pernada).
    this.swimBlend = damp(this.swimBlend || 0, s.swimming ? 1 : 0, 6, dt);
    const swb = this.swimBlend;
    if (swb > 0.001) {
      const sp = this._swimPose || (this._swimPose = {});
      const stroke = this.time * (2.2 + mv * 1.6);
      const a = Math.sin(stroke), b = Math.cos(stroke);
      for (const k of POSE_KEYS) sp[k] = 0;
      sp.spinePitch = 0.35 + 0.35 * mv;
      sp.headPitch = -0.45 - 0.25 * mv;
      sp.shoulderL = sp.shoulderR = 1.25 + 0.45 * a;
      sp.armOutL = sp.armOutR = 0.55 + 0.55 * Math.max(0, b);
      sp.elbowL = sp.elbowR = 0.6 + 0.6 * Math.max(0, -a);
      sp.hipL = 0.35 + 0.35 * a; sp.hipR = 0.35 - 0.35 * a;
      sp.kneeL = 0.5 + 0.45 * Math.max(0, b); sp.kneeR = 0.5 + 0.45 * Math.max(0, -b);
      sp.ankleL = sp.ankleR = -0.4;
      sp.hipsY = 0.04 * Math.sin(stroke * 2);
      for (const k of POSE_KEYS) t[k] = lerp(t[k], sp[k], swb);
    }

    // -------------------------------------------------- curva (lean)
    t.spineRoll += -this.turnLean;
    t.hipsYaw += this.turnLean * 0.5;
    t.headRoll += this.turnLean * 0.4;

    // ------------------------------------------------------- no ar
    const air = this.airBlend;
    if (air > 0.001) {
      const rising = clamp(s.vy / 4, -1, 1);
      const up = clamp(rising, 0, 1), down = clamp(-rising, 0, 1);
      const flail = Math.sin(this.time * 7) * 0.12 * down;
      const a = this._airPose;
      a.hipL = 0.55 * up + 0.25 * down + flail; a.kneeL = 1.0 * up + 0.5 * down;
      a.hipR = -0.15 * up + 0.05 * down - flail; a.kneeR = 0.45 * up + 0.7 * down;
      a.ankleL = 0.3; a.ankleR = 0.2;
      a.shoulderL = 0.45 * up + 0.1 * down; a.shoulderR = 0.25 * up + 0.1 * down;
      a.armOutL = 0.35 * up + 0.85 * down; a.armOutR = 0.35 * up + 0.85 * down;
      a.elbowL = 0.7 * up + 0.35 * down; a.elbowR = 0.9 * up + 0.35 * down;
      a.spinePitch = 0.08 * up - 0.06 * down; a.headPitch = -0.05 * up + 0.12 * down;
      for (const k of AIR_KEYS) t[k] = lerp(t[k], a[k], air);
      t.hipsY = lerp(t.hipsY, 0, air);
    }

    // --------------------------------------------------- aterrissagem
    const lc = this.landCrouch * this.landCrouch * (3 - 2 * this.landCrouch);
    if (lc > 0.001) {
      t.hipsY -= 0.2 * lc;
      t.hipL += 0.55 * lc; t.hipR += 0.55 * lc;
      t.kneeL += 1.05 * lc; t.kneeR += 1.05 * lc;
      t.ankleL -= 0.5 * lc; t.ankleR -= 0.5 * lc;
      t.spinePitch += 0.32 * lc;
      t.headPitch -= 0.2 * lc;
      t.shoulderL += 0.35 * lc; t.shoulderR += 0.35 * lc;
      t.armOutL += 0.2 * lc; t.armOutR += 0.2 * lc;
      t.elbowL += 0.4 * lc; t.elbowR += 0.4 * lc;
    }

    // ------------------------------------------- armado (braços)
    this._weaponLayer(t);

    // ------------------------------------------- sentado (veículos)
    // seatTarget já vem suavizado pela sequência de entrada/saída.
    this.seatBlend = this.seatTarget;
    const st = this.seatBlend;
    if (st > 0.001) {
      const rc = this.seatRecline;
      const sp = this._seatPose;
      for (const k of POSE_KEYS) sp[k] = 0;
      if (this.seatFloor !== null) {
        const lk = this._legOut || (this._legOut = [0, 0, 0]);
        this._legIK(this.seatFloor, lk);
        sp.hipL = sp.hipR = lk[0];
        sp.kneeL = sp.kneeR = lk[1];
        sp.ankleL = sp.ankleR = lk[2];
      } else {
        sp.hipL = sp.hipR = 1.55 - rc * 0.5;
        sp.kneeL = sp.kneeR = 1.25 - rc * 0.35;
        sp.ankleL = sp.ankleR = -0.25;
      }
      sp.hipSpreadL = sp.hipSpreadR = 0.1;
      sp.spinePitch = -rc;
      sp.headPitch = rc * 0.75;
      // Mãos no volante (IK); o esterçamento sobe uma mão e desce a outra.
      const steer = this.seatSteer;
      const g = this.seatGrip || { y: 0.42, z: 0.42 };
      const ik = this._ikOut || (this._ikOut = [0, 0]);
      // Curva à direita: mão esquerda sobe, mão direita desce (e vice-versa).
      if (this.seatHands === 'lap') {
        // Cadeiras e sofás dos interiores: mãos apoiadas sobre as coxas.
        this._armIK(0.1, 0.3, rc, ik);
        sp.shoulderL = sp.shoulderR = ik[0];
        sp.elbowL = sp.elbowR = ik[1];
        sp.armOutL = sp.armOutR = 0.06;
      } else {
      this._armIK(g.y + steer * 0.07, g.z, rc, ik);
      sp.shoulderL = ik[0];
      sp.elbowL = ik[1];
      this._armIK(g.y - steer * 0.07, g.z, rc, ik);
      sp.shoulderR = ik[0];
      sp.elbowR = ik[1];
      // Mãos um pouco para dentro (aro do volante mais estreito que os ombros).
      sp.armOutL = -0.17;
      sp.armOutR = -0.17;
      }
      sp.spineYaw = -steer * 0.05;
      sp.headYaw = -steer * 0.12;
      for (const k of POSE_KEYS) t[k] = lerp(t[k], sp[k], st);
    }
    // Abaixar a cabeça e o tronco ao passar pela porta (entrada/saída).
    if (this.seatDuck > 0.001) {
      t.spinePitch += 0.5 * this.seatDuck;
      t.headPitch += 0.25 * this.seatDuck;
      t.kneeL += 0.3 * this.seatDuck;
      t.kneeR += 0.3 * this.seatDuck;
    }

    // --------------------------------------------- aplicação suavizada
    // Os pesos (andar/correr/ar/aterrissar) já são suavizados; aqui só um
    // filtro leve contra descontinuidades, sem "atrasar" a passada (~3 Hz).
    const k = dampFactor(42, dt);
    const p = this.pose;
    for (const key of POSE_KEYS) p[key] += (t[key] - p[key]) * k;
    this._apply(p);
  }

  /** Sobrepõe os braços com a pose da arma (pronta, mira, recuo, recarga). */
  _weaponLayer(t) {
    const W = this.weapon;
    const w = W.hold ? W.draw : 0;
    if (w < 0.001) return;
    const aim = W.aim, p = clamp(W.pitch, -0.9, 0.9), kick = W.kick;
    const R = (k, v, wt) => { t[k] = lerp(t[k], v, wt); };
    if (W.hold === 'pistol') {
      // Direita: pronta baixa → braço estendido na mira.
      R('shoulderR', lerp(0.5, 1.45 + p, aim) + kick * 0.18, w);
      R('elbowR', lerp(0.8, 0.12, aim) - kick * 0.1, w);
      R('armOutR', lerp(-0.04, -0.3, aim), w);
      R('wristR', lerp(-0.2, 0, aim), w);
      // Esquerda: só apoia quando mira (empunhadura dupla).
      const wl = w * aim;
      R('shoulderL', 1.38 + p + kick * 0.15, wl);
      R('elbowL', 0.5, wl);
      R('armOutL', -0.62, wl);
      R('wristL', 0, wl);
    } else {
      // Arma longa: mão direita na empunhadura, esquerda no guarda-mão.
      R('shoulderR', lerp(0.3, 0.85 + p * 0.9, aim) + kick * 0.2, w);
      R('elbowR', lerp(1.05, 1.8, aim), w);
      R('armOutR', lerp(0.08, 0.22, aim), w);
      R('wristR', 0, w);
      R('shoulderL', lerp(0.85, 1.25 + p, aim) + kick * 0.15, w);
      R('elbowL', lerp(0.85, 0.42, aim), w);
      R('armOutL', lerp(-0.48, -0.42, aim), w);
      R('wristL', 0, w);
      t.spineYaw += 0.12 * aim * w;
    }
    // Recarga: a mão de apoio desce até o carregador / janela de alimentação.
    if (W.reload >= 0) {
      const k = Math.sin(Math.min(1, W.reload) * Math.PI);
      R('shoulderL', 0.75, k * w);
      R('elbowL', 1.35, k * w);
      R('armOutL', -0.35, k * w);
    }
  }

  _footsteps(s) {
    // Contato do calcanhar em fase = PI/2 + n*PI.
    const n = Math.floor((this.phase - Math.PI / 2) / Math.PI);
    if (n !== this.lastStepPhase) {
      this.lastStepPhase = n;
      if (this.moveBlend > 0.35 && this.onFootstep) this.onFootstep(this.runBlend, n % 2 === 0 ? 'L' : 'R');
    }
  }

  _apply(p) {
    const j = this.j;
    j.hips.position.y = this.hipsBaseY + p.hipsY;
    j.hips.position.x = p.hipsX;
    j.hips.rotation.set(p.hipsPitch, p.hipsYaw, 0, 'YXZ');
    j.spine.rotation.set(p.spinePitch, p.spineYaw, p.spineRoll, 'YXZ');
    j.head.rotation.set(p.headPitch, p.headYaw * 0.6, p.headRoll, 'YXZ');
    j.neck.rotation.set(0, p.headYaw * 0.4, 0, 'YXZ');

    const L = j.legs.L, R = j.legs.R;
    L.hip.rotation.set(-p.hipL, 0, p.hipSpreadL + 0.02);
    L.knee.rotation.x = p.kneeL;
    L.ankle.rotation.x = -p.ankleL * 0.6;
    R.hip.rotation.set(-p.hipR, 0, -p.hipSpreadR - 0.02);
    R.knee.rotation.x = p.kneeR;
    R.ankle.rotation.x = -p.ankleR * 0.6;

    const AL = j.arms.L, AR = j.arms.R;
    AL.shoulder.rotation.set(-p.shoulderL, 0, 0.1 + p.armOutL);
    AL.elbow.rotation.x = -p.elbowL;
    AL.wrist.rotation.x = -p.wristL;
    AR.shoulder.rotation.set(-p.shoulderR, 0, -0.1 - p.armOutR);
    AR.elbow.rotation.x = -p.elbowR;
    AR.wrist.rotation.x = -p.wristR;
  }

  /** Valores usados pela câmera em primeira pessoa (balanço sutil). */
  getBob() {
    const b = this._bob;
    b.phase = this.phase;
    b.move = this.moveBlend;
    b.run = this.runBlend;
    b.land = this.landCrouch;
    b.air = this.airBlend;
    return b;
  }
}
