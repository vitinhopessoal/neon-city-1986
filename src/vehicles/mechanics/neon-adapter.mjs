import {createController} from './controller.mjs';
import {clamp, curve, RPM_PER_RAD_S} from './math.mjs';
import {DEFAULT_DRIVETRAIN, TORQUE_SHAPES, STOCK_NITROUS} from './drivetrains.js';

const fail = message => ({ok: false, error: {code: 'INVALID_NEON_HANDLING', message}});

/** Média da curva relativa na faixa útil de uma marcha (30%…100% da faixa de giro). */
function usableMean(shape) {
  let sum = 0;
  for (let i = 0; i <= 28; i++) sum += curve(shape, 0.3 + (0.7 * i) / 28);
  return sum / 29;
}

// Native Neon H.gears are speed-band endpoints (m/s), NOT gearbox ratios.
// Derived ratios below are total reductions; the split gearbox/final drive is unknown.
function buildProfile(H, base, spec, options) {
  if (!H || !base || !spec || !Array.isArray(H.gears) || H.gears[0] !== 0 || H.gears.length < 2
    || !H.gears.slice(1).every((x, i, a) => Number.isFinite(x) && x > 0 && (!i || x > a[i - 1]))
    || !Array.isArray(base.gears) || !(base.gears[1] > 0) || !(base.engineForce > 0)
    || !(spec.wheelRadius > 0) || !(spec.wheelBase > 0) || !(spec.track > 0)) return fail('Expected Neon handling, immutable factoryHandling and metric dimensions');
  const d = options.drivetrain, radius = spec.wheelRadius, efficiency = 0.9;
  const overall = endpoint => H.redline * radius / (endpoint * RPM_PER_RAD_S);
  const baseOverallFirst = base.redline * radius / (base.gears[1] * RPM_PER_RAD_S);
  const shape = TORQUE_SHAPES[d.torqueShape] || TORQUE_SHAPES.balanced;
  // Calibrate from FACTORY data. Recalibrating from a live ratio would cancel the
  // gearing upgrade. Engine upgrades are applied exactly once (H/base engineForce).
  // Potência de pico igual à do modelo arcade de fábrica (força·(1−(v/vmax)²)·v tem
  // máximo em vmax/√3): o carro mantém o desempenho original, agora com marchas,
  // curva de torque e limite de tração. A força da 1ª marcha nunca fica abaixo da de fábrica.
  const baseSpan = base.redline - base.idleRpm;
  let shapePower = 0;
  for (let i = 0; i <= 50; i++) {
    const fr = i / 50;
    shapePower = Math.max(shapePower, curve(shape, fr) * (base.idleRpm + baseSpan * fr) / RPM_PER_RAD_S);
  }
  const powerTarget = base.engineForce * base.maxSpeed * (2 / (3 * Math.sqrt(3)));
  const byPower = powerTarget / (efficiency * shapePower);
  const byFirstGear = base.engineForce * radius / (baseOverallFirst * efficiency) / usableMean(shape);
  const peakTorque = Math.max(byPower, byFirstGear) * (H.engineForce / base.engineForce);
  const span = H.redline - H.idleRpm;
  const ratios = H.gears.slice(1).map(overall);
  // Freio-motor através da marcha: na marcha do meio equivale ao engineBrake arcade do modelo;
  // marchas curtas seguram mais, neutro e embreagem acionada (troca) não seguram.
  const midRatio = ratios[Math.floor((ratios.length - 1) / 2)];
  const kit = {boost: H.nitroBoost ?? STOCK_NITROUS.boost, drain: H.nitroDrain ?? STOCK_NITROUS.drain};
  const p = {
    id: 'derived-neon-powertrain',
    provenance: 'Authored conversion from Neon speed bands and factory force, not NFS calibration.',
    massKg: H.mass, yawInertiaKgM2: H.mass * (spec.length ** 2 + spec.width ** 2) / 12 * H.inertiaScale,
    wheelbaseM: spec.wheelBase, trackM: spec.track, wheelRadiusM: radius,
    frontWeightFraction: d.frontWeight, centerOfMassHeightM: d.cgHeight,
    driveLayout: d.layout, awdFrontFraction: d.awdFront,
    engine: {idleRpm: H.idleRpm, redlineRpm: H.redline, launchRpm: H.idleRpm + span * 0.4,
      rpmResponsePerSecond: 10, engineBrakingNm: (H.engineBrake ?? 0) * radius / (midRatio * efficiency),
      torqueCurve: shape.map(([f, k]) => [H.idleRpm + span * f, peakTorque * k])},
    transmission: {mode: options.mode, shiftStrategy: 'torque_crossover',
      forwardRatios: ratios, reverseRatio: overall(H.reverseSpeed), finalDrive: 1,
      efficiency, shiftSeconds: d.shiftSeconds, minimumShiftIntervalSeconds: 0.5,
      upshiftRpm: H.redline - span * 0.06, downshiftRpm: H.idleRpm + span * 0.25,
      reverseSelectionMaxSpeedMps: 0.9, perfectShiftFactor: 0.55, perfectShiftWindowRpm: span * 0.07},
    steering: {deadzone: 0.03, rateRadPerSecond: H.steerSpeed,
      angleBySpeed: [[0, H.steerMax], [H.maxSpeed, H.steerMax / (1 + H.maxSpeed * H.steerSpeedFalloff)]]},
    tires: {frictionCoefficient: H.grip, corneringStiffnessNPerRad: 26000, handbrakeRearGripFraction: H.handbrakeGrip},
    brakes: {maximumTorqueNmPerWheel: H.brakeForce * radius / 4, frontFraction: d.brakeBias,
      handbrakeTorqueNmPerRearWheel: H.handbrakeForce * radius / 2},
    aero: {airDensityKgM3: 1.225, dragAreaM2: H.drag * 2 / 1.225, downforceAreaM2: 0,
      rollingResistanceCoefficient: 0},
    nitrous: {torqueBoostFraction: kit.boost, drainPerSecond: kit.drain,
      minimumSpeedMps: 2, minimumThrottle: 0.85},
    launch: {minimumGoodRpm: H.idleRpm + span * 0.3, maximumGoodRpm: H.idleRpm + span * 0.55},
    suspension: {springNPerM: 35000, damperNsPerM: 3800, maximumForceN: H.mass * 9.80665 * 2},
    turbo: d.turbo ? {...d.turbo} : null,
    heat: {limiterPerSecond: 0.11, nitrousPerSecond: 0.09, highRpmPerSecond: 0.012, coolPerSecond: 0.05,
      derateFraction: 0.3, recoverBelow: 0.6},
  };
  if (!p.turbo) delete p.turbo;
  return {ok: true, value: p};
}

export function createNeonAdapter({handling, factoryHandling, spec, drivetrain = null, driveLayout, mode = 'automatic', shiftSeconds, nitrousBoost}) {
  const d = {...DEFAULT_DRIVETRAIN, ...(drivetrain || {})};
  // Compatibilidade com o contrato do pacote: driveLayout/shiftSeconds explícitos têm prioridade.
  if (driveLayout) d.layout = driveLayout;
  if (shiftSeconds) d.shiftSeconds = shiftSeconds;
  const options = {drivetrain: d, mode};
  // Preserve factory calibration even if the caller later edits its own input.
  const base = factoryHandling && JSON.parse(JSON.stringify(factoryHandling));
  if (nitrousBoost !== undefined && handling) handling.nitroBoost ??= nitrousBoost;
  const p = buildProfile(handling, base, spec, options);
  if (!p.ok) return p;
  const core = createController(p.value);
  if (!core.ok) return core;
  return {ok: true, value: new NeonAdapter(handling, base, spec, options, core.value)};
}

class NeonAdapter {
  constructor(handling, base, spec, options, core) {
    this.handling = handling; this.base = base; this.spec = spec; this.options = options; this.core = core;
    this.drivetrain = options.drivetrain;
    this.signature = this.configSignature();
    this.lastFrame = null;
    this.wasEngineOn = false;
    this.stagedS = 0;
    this.stats = {nitrousAwarded: 0, launches: 0, shifts: 0};
  }
  configSignature() {
    const h = this.handling, s = this.spec;
    return [h.mass, h.engineForce, h.idleRpm, h.redline, h.maxSpeed, h.reverseSpeed, h.grip,
      h.steerMax, h.steerSpeed, h.steerSpeedFalloff, h.handbrakeGrip, h.brakeForce, h.handbrakeForce,
      h.drag, h.inertiaScale, h.engineBrake, h.nitroBoost, h.nitroDrain, s.wheelRadius, s.wheelBase, s.track, s.length, s.width,
      ...(Array.isArray(h.gears) ? h.gears : ['invalid-gears'])].join('|');
  }
  refresh() {
    const signature = this.configSignature();
    if (signature === this.signature) return {ok: true};
    const next = buildProfile(this.handling, this.base, this.spec, this.options);
    if (!next.ok) return next;
    const result = this.core.reconfigure(next.value);
    if (result.ok) this.signature = signature;
    return result;
  }
  get profile() {return this.core.profile;}
  /** Redução total engatada (0 em neutro ou durante a troca: motor desacoplado das rodas). */
  get currentRatio() {
    const s = this.core.state, t = this.core.profile.transmission;
    if (s.shiftRemainingS > 0 || s.gear === 0) return 0;
    return (s.gear === -1 ? t.reverseRatio : t.forwardRatios[s.gear - 1]) * t.finalDrive;
  }
  /** Controle de tração: 'full' no automático, 'sport' no manual (options.tractionControl força: 'full'|'sport'|false). */
  get tractionControl() {
    if (this.options.tractionControl !== undefined) return this.options.tractionControl;
    return this.core.state.mode === 'automatic' ? 'full' : 'sport';
  }
  get upshiftRpms() {return this.core.upshiftRpms;}
  snapshot() {return this.core.snapshot();}
  reset(options) {this.lastFrame = null; this.stagedS = 0; return this.core.reset(options);}
  setTransmissionMode(mode) {
    const r = this.core.setTransmissionMode(mode);
    if (r.ok) this.options.mode = mode;
    return r;
  }
  awardNitrous(amount) {return this.core.awardNitrous(amount);}

  /**
   * Um passo físico. Entradas além do contrato do pacote (todas opcionais):
   *  wheelOmegaRadS   rotação das rodas vinda do modelo de tração (patinação eleva o giro)
   *  tractionByPhysics a aderência do piso é aplicada pelo modelo de pneus: não multiplicar aqui
   *  skid             0..1 derrapagem atual (recarga de nitro em drift)
   */
  step({controls, forwardSpeedMps, performance = 1, surfaceGrip = 1, inWater = false, engineOn = true,
    wheelOmegaRadS = null, tractionByPhysics = false, skid = 0}, dt) {
    if (!Number.isFinite(forwardSpeedMps) || !Number.isFinite(performance) || performance < 0
      || !Number.isFinite(surfaceGrip) || surfaceGrip < 0) return fail('Nonfinite speed, performance or surface grip');
    const refreshed = this.refresh(); if (!refreshed.ok) return refreshed;
    if (!engineOn) {
      if (this.wasEngineOn) this.core.reset({preserveNitrous: true});
      this.wasEngineOn = false;
      this.stagedS = 0;
      const snap = this.snapshot();
      this.lastFrame = {driveForceN: 0, extraResistanceN: 0, rpm: 0, gear: 'P', shifting: false,
        nitrousFraction: snap.nitrous, nitrousActive: false, boost: 0, temperature: snap.temperature,
        overheated: snap.overheated, staged: false, mode: snap.mode, events: []};
      return {ok: true, value: this.lastFrame};
    }
    this.wasEngineOn = true;
    const c = controls ?? {}, raw = c.throttle ?? 0;
    if (!Number.isFinite(raw) || !Number.isFinite(c.brake ?? 0)) return fail('Nonfinite pedal input');
    const direction = raw < 0 ? -1 : raw > 0 ? 1 : 0, state = this.snapshot();
    const oppositeMotion = direction && forwardSpeedMps * direction < -0.8;
    let selectGear;
    // Ré pelo S (parado) nos dois modos. No automático, W tira de N/R; no manual, W em neutro só acelera o motor.
    if (!oppositeMotion && direction < 0 && state.gear !== -1) selectGear = -1;
    if (!oppositeMotion && direction > 0 && (state.gear === -1 || (state.gear === 0 && state.mode === 'automatic'))) selectGear = 1;
    // Automático com o giro acima do corte (ex.: carro reposicionado em movimento): pula direto
    // para a marcha em que o motor cabe, em vez de subir uma por vez batendo no limitador.
    if (selectGear === undefined && state.mode === 'automatic' && state.gear > 0 && state.shiftRemainingS === 0) {
      const t = this.core.profile.transmission, red = this.core.profile.engine.redlineRpm;
      const w = Math.abs(forwardSpeedMps) / this.spec.wheelRadius * RPM_PER_RAD_S * t.finalDrive;
      if (w * t.forwardRatios[state.gear - 1] > red * 1.02) {
        let g = state.gear;
        while (g < t.forwardRatios.length && w * t.forwardRatios[g - 1] > this.core.upshiftRpms[g - 1]) g++;
        if (g !== state.gear && w * t.forwardRatios[g - 1] <= red) selectGear = g;
      }
    }
    // Preparação de largada: freio de mão puxado, carro parado e acelerador → motor sobe sem tracionar.
    // O giro sobe em ~2,4 s (embreagem segura, pé fundo): a habilidade é soltar o freio de mão
    // quando o conta-giros está na faixa verde de largada.
    const staged = c.handbrake === true && Math.abs(forwardSpeedMps) < 0.6 && raw > 0.05 && state.gear > 0;
    const wasStagedS = this.stagedS;
    this.stagedS = staged ? this.stagedS + dt : 0;
    const stageRamp = staged ? Math.min(1, this.stagedS / 2.4) : 1;
    const input = {throttle: oppositeMotion ? 0 : Math.abs(clamp(raw, -1, 1)) * stageRamp,
      gearUp: c.gearUp === true, gearDown: c.gearDown === true, nitrous: c.nitrous === true,
      raceStarted: c.raceStarted === false ? false : !staged};
    if (selectGear !== undefined) input.selectGear = selectGear;
    if (c.selectGear !== undefined) input.selectGear = c.selectGear;
    // Neon owns steering, brakes, surfaces, gravity and collisions. Do not apply
    // those controller outputs a second time.
    const omega = Array.isArray(wheelOmegaRadS) && wheelOmegaRadS.length === 4 ? wheelOmegaRadS
      : Array(4).fill(forwardSpeedMps / this.spec.wheelRadius);
    const result = this.core.step(input, {forwardSpeedMps, wheelOmegaRadS: omega}, dt);
    if (!result.ok) return result;
    const frame = result.value;
    // Largada só conta se o jogador preparou de verdade (≥ 0,4 s) e saiu acelerando.
    // O limitador vira um evento só ao entrar nele (não a cada passo), para não afogar a fila do painel.
    const atLimiter = frame.events.some((e) => e.type === 'rev_limiter');
    const events = frame.events.filter((e) => (e.type !== 'launch' || (wasStagedS >= 0.4 && input.throttle > 0.5))
      && (e.type !== 'rev_limiter' || !this.wasLimiter));
    this.wasLimiter = atLimiter;
    for (const e of events) {
      if (e.type === 'launch') this.stats.launches++;
      if (e.type === 'shift_complete') this.stats.shifts++;
    }
    let force = frame.wheels.reduce((sum, wheel) => sum + wheel.driveTorqueNm, 0) / this.spec.wheelRadius;
    if (oppositeMotion) force = 0;
    // Automático: o conversor de torque patina ao aliviar o pedal e segura bem menos que a
    // embreagem do manual (freio-motor ×0,35; perto do valor arcade original em 1ª/2ª).
    if (force < 0 && input.throttle === 0 && state.mode === 'automatic') force *= 0.35;
    force *= clamp(performance, 0, 1) * (inWater ? 0.2 : 1) * (tractionByPhysics ? 1 : 0.7 + 0.3 * surfaceGrip);
    // Recarga de nitro (regra do jogo, não do motor): velocidade alta e drift controlado enchem o tanque.
    if (!frame.nitrousActive && !input.nitrous && frame.gear > 0) {
      const speed = Math.abs(forwardSpeedMps);
      const gain = (speed > 22 ? 0.012 : 0) + (skid > 0.3 && speed > 8 ? 0.04 * skid : 0);
      if (gain > 0 && frame.nitrousFraction < 1) {
        const r = this.core.awardNitrous(gain * dt);
        if (r.ok) this.stats.nitrousAwarded += gain * dt;
      }
    }
    const snap = this.core.snapshot();
    this.lastFrame = {driveForceN: force,
      extraResistanceN: oppositeMotion && !(c.brake > 0) ? Math.abs(raw) * this.handling.brakeForce : 0,
      rpm: frame.rpm, gear: frame.gear === -1 ? 'R' : frame.gear === 0 ? 'N' : frame.gear,
      shifting: frame.shifting, nitrousFraction: snap.nitrous,
      nitrousActive: frame.nitrousActive, boost: frame.boost, temperature: frame.temperature,
      overheated: frame.overheated, upshiftRpm: frame.upshiftRpm, mode: frame.mode, staged,
      motorTorqueNm: frame.motorTorqueNm, events};
    return {ok: true, value: this.lastFrame};
  }
}
