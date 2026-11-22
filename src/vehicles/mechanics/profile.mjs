const requiredPositive = ['massKg', 'yawInertiaKgM2', 'wheelbaseM', 'trackM', 'wheelRadiusM',
  'engine.idleRpm', 'engine.redlineRpm', 'engine.launchRpm', 'engine.rpmResponsePerSecond',
  'transmission.finalDrive', 'transmission.reverseRatio', 'transmission.shiftSeconds',
  'transmission.minimumShiftIntervalSeconds', 'transmission.upshiftRpm', 'transmission.downshiftRpm',
  'steering.rateRadPerSecond', 'tires.frictionCoefficient', 'tires.corneringStiffnessNPerRad',
  'brakes.maximumTorqueNmPerWheel', 'brakes.handbrakeTorqueNmPerRearWheel', 'aero.airDensityKgM3',
  'suspension.springNPerM', 'suspension.damperNsPerM', 'suspension.maximumForceN'];
const requiredNonnegative = ['centerOfMassHeightM', 'engine.engineBrakingNm',
  'transmission.reverseSelectionMaxSpeedMps', 'aero.dragAreaM2', 'aero.downforceAreaM2',
  'aero.rollingResistanceCoefficient', 'nitrous.torqueBoostFraction', 'nitrous.drainPerSecond',
  'nitrous.minimumSpeedMps', 'launch.minimumGoodRpm', 'launch.maximumGoodRpm'];
const fractions = ['frontWeightFraction', 'awdFrontFraction', 'transmission.efficiency', 'steering.deadzone',
  'tires.handbrakeRearGripFraction', 'brakes.frontFraction', 'nitrous.minimumThrottle'];
const at = (o, key) => key.split('.').reduce((v, part) => v?.[part], o);
const freeze = object => { for (const v of Object.values(object)) if (v && typeof v === 'object') freeze(v); return Object.freeze(object); };

export function parseProfile(input) {
  const issues = [];
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return {ok: false, error: {code: 'INVALID_PROFILE', issues: ['Expected a profile object']}};
  for (const key of requiredPositive) if (!(Number.isFinite(at(input, key)) && at(input, key) > 0)) issues.push(`${key}: expected positive finite number`);
  for (const key of requiredNonnegative) if (!(Number.isFinite(at(input, key)) && at(input, key) >= 0)) issues.push(`${key}: expected nonnegative finite number`);
  for (const key of fractions) if (!(Number.isFinite(at(input, key)) && at(input, key) >= 0 && at(input, key) <= 1)) issues.push(`${key}: expected fraction 0..1`);
  if (!['FWD', 'RWD', 'AWD'].includes(input.driveLayout)) issues.push('driveLayout: FWD, RWD or AWD');
  if (!['automatic', 'manual'].includes(input.transmission?.mode)) issues.push('transmission.mode: automatic or manual');
  if (input.transmission?.shiftStrategy !== undefined && !['torque_crossover', 'rpm_threshold'].includes(input.transmission.shiftStrategy)) issues.push('Invalid transmission.shiftStrategy');
  const ratios = input.transmission?.forwardRatios;
  if (!Array.isArray(ratios) || !ratios.length || !ratios.every(x => Number.isFinite(x) && x > 0)) issues.push('forwardRatios: nonempty positive ratios');
  for (const key of ['engine.torqueCurve', 'steering.angleBySpeed']) {
    const points = at(input, key);
    if (!Array.isArray(points) || points.length < 2 || !points.every((p, i) => Array.isArray(p) && p.length === 2
      && p.every(Number.isFinite) && p[0] >= 0 && p[1] >= 0 && (!i || p[0] > points[i - 1][0]))) issues.push(`${key}: sorted finite [x,y] points`);
  }
  if (!(input.engine?.idleRpm < input.transmission?.downshiftRpm
    && input.transmission.downshiftRpm < input.transmission.upshiftRpm
    && input.transmission.upshiftRpm < input.engine.redlineRpm)) issues.push('RPM thresholds must satisfy idle < downshift < upshift < redline');
  if (!(input.engine?.launchRpm >= input.engine?.idleRpm && input.engine.launchRpm <= input.engine.redlineRpm)) issues.push('launchRpm must be between idle and redline');
  if (!(input.launch?.minimumGoodRpm <= input.launch?.maximumGoodRpm && input.launch.maximumGoodRpm <= input.engine?.redlineRpm)) issues.push('Invalid launch RPM band');
  if (input.steering?.deadzone === 1) issues.push('steering.deadzone must be below one');
  if (input.frontWeightFraction === 0 || input.frontWeightFraction === 1) issues.push('Both axles require positive static load');
  if (input.transmission?.efficiency === 0) issues.push('Transmission efficiency must be positive');
  if (input.nitrous?.torqueBoostFraction > 0 && input.nitrous?.drainPerSecond === 0) issues.push('Nitrous boost requires positive drainPerSecond');
  // Seções opcionais (extensões autorais do Neon City): turbo, calor e troca perfeita.
  const t = input.transmission || {};
  if (t.perfectShiftFactor !== undefined && !(Number.isFinite(t.perfectShiftFactor) && t.perfectShiftFactor > 0 && t.perfectShiftFactor <= 1)) issues.push('transmission.perfectShiftFactor: expected 0 < x <= 1');
  if (t.perfectShiftWindowRpm !== undefined && !(Number.isFinite(t.perfectShiftWindowRpm) && t.perfectShiftWindowRpm > 0)) issues.push('transmission.perfectShiftWindowRpm: expected positive');
  if (input.turbo !== undefined && input.turbo !== null) {
    for (const key of ['boostFraction', 'spoolRpm', 'spoolPerSecond', 'decayPerSecond']) if (!(Number.isFinite(input.turbo[key]) && input.turbo[key] > 0)) issues.push(`turbo.${key}: expected positive finite number`);
    if (!(input.turbo.spoolRpm < input.engine?.redlineRpm)) issues.push('turbo.spoolRpm must be below redline');
  }
  if (input.heat !== undefined && input.heat !== null) {
    for (const key of ['limiterPerSecond', 'nitrousPerSecond', 'highRpmPerSecond', 'coolPerSecond', 'derateFraction', 'recoverBelow']) if (!(Number.isFinite(input.heat[key]) && input.heat[key] >= 0)) issues.push(`heat.${key}: expected nonnegative finite number`);
    if (!(input.heat.derateFraction < 1 && input.heat.recoverBelow < 1)) issues.push('heat.derateFraction and heat.recoverBelow must be below one');
  }
  if (issues.length) return {ok: false, error: {code: 'INVALID_PROFILE', issues}};
  // Own an immutable data copy. Caller edits cannot silently change a running car.
  const normalized = JSON.parse(JSON.stringify(input));
  normalized.transmission.shiftStrategy ??= 'rpm_threshold';
  return {ok: true, value: freeze(normalized)};
}
