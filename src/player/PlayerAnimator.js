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
     * Pilotagem de moto (PROMPT 15): pontos de apoio relativos à moto
     * ({ hipY, hipZ, pegY, pegZ, pegX, gripY, gripZ, gripW, spread, hang }) ou null.
     * rideState: { steer (rad do garfo), lean (rad da moto), speed (m/s), footDown 0..1 }.
     * rideSwing 0..1: perna direita passando sobre o banco (montar/desmontar).
     */
    this.seatRide = null;
    this.rideState = { steer: 0, lean: 0, speed: 0, footDown: 0 };
    this.rideSwing = 0;
    /** Queda da moto: pesos { fly, lie, getup, fade } preenchidos pelo BikeCrash, ou null. */
    this.crash = null;
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
    this._hipOffX = Math.abs(Lg.hip.position.x);
    this._shoulderX = Math.abs(A.shoulder.position.x) + Math.abs(model.joints.chest.position.x || 0);
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
   * IK planar das pernas até um ponto (dy, dz) relativo ao quadril (pedaleira da moto
   * ou chão). Joelho para cima/à frente; pé paralelo à pedaleira. Retorna [quadril, joelho, tornozelo].
   */
  _legIKTo(dy, dz, out) {
    const L1 = this._thigh, L2 = this._shin;
    const y = dy - this._hipOffY;
    const d = clamp(Math.hypot(y, dz), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.004);
    const phi = Math.atan2(dz, -y);
    const knee = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    const delta = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const thigh = phi + delta;
    const shin = thigh - knee;
    out[0] = thigh;
    out[1] = knee;
    out[2] = (0.15 - shin) / 0.6;
    return out;
  }

  /** Pose sentada na moto: pernas nas pedaleiras, mãos nas manoplas, tronco pelo estilo. */
  _ridePose(sp, rcBase) {
    const R = this.seatRide, S = this.rideState;
    // Inclinação mínima do tronco para as mãos alcançarem as manoplas com o braço do
    // modelo VISÍVEL (o GLB tem braços mais curtos que o esqueleto-guia). Básicas ficam
    // quase eretas, esportivas deitam sobre o tanque, customs reclinam se alcançarem.
    const reach = (this.armReach ?? (this._upperArm + this._foreArm)) * 0.94;
    const pivot = this._spineOff;
    const arm = (this.shoulderUp ?? (this._spineOff + this._shoulderOff)) - pivot;
    const lat = Math.max(0, R.gripW - this._shoulderX);
    const gy0 = R.gripY - R.hipY, gz0 = R.gripZ - R.hipZ;
    let rc = rcBase;
    for (let k = 0; k < 60; k++) {
      const sy = pivot + arm * Math.cos(rc), sz = -arm * Math.sin(rc);
      if (Math.hypot(gy0 - sy, gz0 - sz, lat) <= reach || rc < -1.1) break;
      rc -= 0.02;
    }
    this.rideRecline = rc;
    const ik = this._ikOut || (this._ikOut = [0, 0]);
    const lk = this._legOut || (this._legOut = [0, 0, 0]);
    // Abertura lateral até a pedaleira (o joelho contorna o tanque).
    const legLen = this._thigh + this._shin;
    const pegSpread = Math.asin(clamp((R.pegX - this._hipOffX) / legLen, 0, 0.6));
    const spread = Math.max(R.spread, pegSpread);
    const drop = S.hipDrop || 0; // quadril descido para o lado do pé de apoio (bancos altos, parada)
    this._legIKTo(R.pegY + 0.06 - R.hipY + drop, R.pegZ - R.hipZ, lk);
    sp.hipL = sp.hipR = lk[0];
    sp.kneeL = sp.kneeR = lk[1];
    sp.ankleL = sp.ankleR = lk[2];
    sp.hipSpreadL = sp.hipSpreadR = spread;
    // Parada: pé esquerdo apoiado no chão (equilíbrio), um pouco à frente e para fora.
    const fd = clamp(S.footDown || 0, 0, 1);
    if (fd > 0.001) {
      this._legIKTo(0.06 - R.hipY + drop, 0.12, lk);
      sp.hipL += (lk[0] - sp.hipL) * fd;
      sp.kneeL += (lk[1] - sp.kneeL) * fd;
      sp.ankleL += (lk[2] - sp.ankleL) * fd;
      sp.hipSpreadL += (0.34 - sp.hipSpreadL) * fd;
    }
    // Montar/desmontar: perna direita sobe e passa por cima do banco.
    const sw = this.rideSwing;
    if (sw > 0.001) {
      sp.hipR += (1.75 - sp.hipR) * sw;
      sp.kneeR += (0.5 - sp.kneeR) * sw;
      sp.hipSpreadR += 0.55 * sw;
    }
    // Mãos nas manoplas: o guidão gira no eixo de direção (uma mão avança, a outra recua).
    const gy = R.gripY - R.hipY, gz = R.gripZ - R.hipZ;
    const ds = R.gripW * Math.sin(S.steer || 0);
    const armLen = this._upperArm + this._foreArm;
    const out = Math.asin(clamp((R.gripW - this._shoulderX) / armLen, -0.4, 0.8)) - 0.1;
    this._armIK(gy, gz - ds, rc, ik);
    sp.shoulderL = ik[0];
    sp.elbowL = ik[1];
    this._armIK(gy, gz + ds, rc, ik);
    sp.shoulderR = ik[0];
    sp.elbowR = ik[1];
    sp.armOutL = sp.armOutR = out;
    // Tronco: inclinação pelo estilo (esportiva deitada, básica ereta, custom relaxada);
    // nas curvas o tronco acompanha a moto ("pendura" mais nas esportivas) e a cabeça
    // compensa parte da inclinação, mantendo o olhar no horizonte.
    sp.spinePitch = -rc;
    sp.headPitch = rc * 0.75;
    const lean = S.lean || 0;
    sp.spineRoll = lean * R.hang;
    sp.headRoll = -lean * 0.45;
    sp.spineYaw = -(S.steer || 0) * 0.15;
    sp.headYaw = (S.steer || 0) * 0.25;
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
      if (this.seatRide) {
        this._ridePose(sp, rc);
      } else if (this.seatFloor !== null) {
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
      if (!this.seatRide) {
        sp.hipSpreadL = sp.hipSpreadR = 0.1;
        sp.spinePitch = -rc;
        sp.headPitch = rc * 0.75;
      }
      // Mãos no volante (IK); o esterçamento sobe uma mão e desce a outra.
      const steer = this.seatSteer;
      const g = this.seatGrip || { y: 0.42, z: 0.42 };
      const ik = this._ikOut || (this._ikOut = [0, 0]);
      // Curva à direita: mão esquerda sobe, mão direita desce (e vice-versa).
      if (this.seatRide) {
        // Braços e tronco já resolvidos por _ridePose (manoplas e estilo).
      } else if (this.seatHands === 'lap') {
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
      if (!this.seatRide) {
        sp.spineYaw = -steer * 0.05;
        sp.headYaw = -steer * 0.12;
      }
      for (const k of POSE_KEYS) t[k] = lerp(t[k], sp[k] ?? 0, st);
    }
    // Abaixar a cabeça e o tronco ao passar pela porta (entrada/saída).
    if (this.seatDuck > 0.001) {
      t.spinePitch += 0.5 * this.seatDuck;
      t.headPitch += 0.25 * this.seatDuck;
      t.kneeL += 0.3 * this.seatDuck;
      t.kneeR += 0.3 * this.seatDuck;
    }

    // Queda da moto (BikeCrash): braços e pernas soltos no ar, corpo largado no chão, levantar.
    if (this.crash) this._crashLayer(t, this.crash);

    // --------------------------------------------- aplicação suavizada
    // Os pesos (andar/correr/ar/aterrissar) já são suavizados; aqui só um
    // filtro leve contra descontinuidades, sem "atrasar" a passada (~3 Hz).
    const k = dampFactor(42, dt);
    const p = this.pose;
    for (const key of POSE_KEYS) p[key] += (t[key] - p[key]) * k;
    this._apply(p);
  }

  /**
   * Camada da queda da moto. w = { fly, lie, getup, fade? } (pesos 0..1):
   * fly — braços e pernas se debatendo no ar; lie — largado no chão (um braço
   * acima da cabeça, pernas abertas, cabeça de lado); getup — agachado,
   * apoiando-se para levantar. fade leva de volta à pose normal no fim.
   */
  _crashLayer(t, w) {
    const fade = w.fade ?? 1;
    const tt = this.time;
    const pose = this._crashPose || (this._crashPose = emptyPose());
    for (const k of POSE_KEYS) pose[k] = 0;
    const add = (k, v, wt) => { pose[k] += v * wt; };
    const f = w.fly || 0, l = w.lie || 0, g = w.getup || 0;
    if (f > 0) {
      const a = Math.sin(tt * 11), b = Math.sin(tt * 9 + 1.3), c = Math.sin(tt * 13 + 2.1);
      add('shoulderL', 2.3 + a * 0.55, f); add('shoulderR', 1.9 - c * 0.55, f);
      add('armOutL', 0.75 + b * 0.2, f); add('armOutR', 0.7 - a * 0.2, f);
      add('elbowL', 0.5 + c * 0.35, f); add('elbowR', 0.6 + a * 0.35, f);
      add('hipL', 0.65 + b * 0.45, f); add('hipR', 0.3 - b * 0.45, f);
      add('kneeL', 0.9 + a * 0.4, f); add('kneeR', 1.1 - c * 0.4, f);
      add('hipSpreadL', 0.2, f); add('hipSpreadR', 0.2, f);
      add('spinePitch', 0.25, f); add('headPitch', -0.35, f); add('headRoll', c * 0.15, f);
    }
    if (l > 0) {
      add('shoulderL', 2.7, l); add('shoulderR', 0.35, l);
      add('armOutL', 0.45, l); add('armOutR', 0.35, l);
      add('elbowL', 0.45, l); add('elbowR', 0.25, l);
      add('hipL', 0.12, l); add('hipR', -0.12, l);
      add('kneeL', 0.55, l); add('kneeR', 0.12, l);
      add('hipSpreadL', 0.22, l); add('hipSpreadR', 0.16, l);
      add('headYaw', 0.7, l); add('spineRoll', 0.08, l);
    }
    if (g > 0) {
      add('hipsY', -0.45, g);
      add('hipL', 1.45, g); add('hipR', 1.2, g);
      add('kneeL', 2.0, g); add('kneeR', 1.7, g);
      add('ankleL', 0.5, g); add('ankleR', 0.4, g);
      add('spinePitch', 0.55, g); add('headPitch', -0.25, g);
      add('shoulderL', 0.75, g); add('shoulderR', 0.6, g);
      add('elbowL', 0.5, g); add('elbowR', 0.6, g); add('armOutL', 0.15, g); add('armOutR', 0.15, g);
    }
    const total = Math.min(1, f + l + g) * fade;
    for (const k of POSE_KEYS) t[k] = lerp(t[k], pose[k] / Math.max(1, f + l + g), total);
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
