import {ackermann, approach, clamp, curve, RPM_PER_RAD_S, smooth} from './math.mjs';
import {parseProfile} from './profile.mjs';

const failure = (code, message) => ({ok: false, error: {code, message}});
const wheelNames = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];
const shiftThresholds = profile => profile.transmission.forwardRatios.map((ratio, i, ratios) => i === ratios.length - 1 ? Infinity
  : profile.transmission.shiftStrategy === 'torque_crossover'
    ? torqueCrossoverRpm(profile.engine.torqueCurve, ratio, ratios[i + 1], profile.transmission.downshiftRpm + 500, profile.engine.redlineRpm)
    : profile.transmission.upshiftRpm);

// Original authored approximation of the observed wheel-thrust comparison.
// This is not a translation of the decompiled function or its unknown tuning tables.
export function torqueCrossoverRpm(points, currentRatio, nextRatio, minimumRpm, redlineRpm) {
  const fraction = nextRatio / currentRatio;
  for (let rpm = minimumRpm; rpm < redlineRpm; rpm += 50) {
    if (curve(points, rpm * fraction) * fraction > curve(points, rpm)) return rpm;
  }
  return redlineRpm - 100;
}

export function createController(rawProfile) {
  const parsed = parseProfile(rawProfile);
  return parsed.ok ? {ok: true, value: new VehicleController(parsed.value)} : parsed;
}

class VehicleController {
  constructor(profile) {
    this.profile = profile;
    const t = profile.transmission;
    this.upshiftRpms = shiftThresholds(profile);
    this.state = {rpm: profile.engine.idleRpm, gear: 1, pendingGear: null, shiftRemainingS: 0,
      sinceShiftS: t.minimumShiftIntervalSeconds, steerRad: 0, nitrous: 1, nitrousActive: false,
      wasStaged: false, previousGearUp: false, previousGearDown: false, mode: t.mode,
      boost: 0, temperature: 0, overheated: false, lastShiftQuality: null};
  }

  snapshot() {return {...this.state};}

  reset({preserveNitrous = true} = {}) {
    if (typeof preserveNitrous !== 'boolean') return failure('INVALID_RESET', 'preserveNitrous must be boolean');
    const nitrous = preserveNitrous ? this.state.nitrous : 1, mode = this.state.mode;
    // A temperatura do motor é física do carro: não zera ao desligar/reposicionar.
    const temperature = this.state.temperature, overheated = this.state.overheated;
    this.state = {rpm: this.profile.engine.idleRpm, gear: 1, pendingGear: null, shiftRemainingS: 0,
      sinceShiftS: this.profile.transmission.minimumShiftIntervalSeconds, steerRad: 0, nitrous,
      nitrousActive: false, wasStaged: false, previousGearUp: false, previousGearDown: false, mode,
      boost: 0, temperature, overheated, lastShiftQuality: null};
    return {ok: true};
  }

  reconfigure(rawProfile) {
    const parsed = parseProfile(rawProfile);
    if (!parsed.ok) return parsed;
    this.profile = parsed.value;
    this.upshiftRpms = shiftThresholds(this.profile);
    const s = this.state, n = this.profile.transmission.forwardRatios.length;
    s.gear = clamp(s.gear, -1, n);
    if (s.pendingGear !== null && s.pendingGear > n) {s.pendingGear = null; s.shiftRemainingS = 0;}
    s.rpm = clamp(s.rpm, this.profile.engine.idleRpm, this.profile.engine.redlineRpm);
    // Runtime mode, tank, active shift and button edges belong to the running car.
    return {ok: true};
  }

  setTransmissionMode(mode) {
    if (!['automatic', 'manual'].includes(mode)) return failure('INVALID_MODE', 'Use automatic or manual');
    this.state.mode = mode;
    return {ok: true};
  }

  awardNitrous(fraction) {
    if (!(Number.isFinite(fraction) && fraction >= 0)) return failure('INVALID_AWARD', 'Nitrous award must be nonnegative');
    this.state.nitrous = clamp(this.state.nitrous + fraction, 0, 1);
    return {ok: true, value: this.state.nitrous};
  }

  step(rawInput, telemetry, dt) {
    // Reject an incomplete observation before mutating the controller.
    if (!(Number.isFinite(dt) && dt > 0)) return failure('INVALID_DT', 'Use a positive finite step in seconds');
    if (!telemetry || !Number.isFinite(telemetry.forwardSpeedMps)
      || !Array.isArray(telemetry.wheelOmegaRadS) || telemetry.wheelOmegaRadS.length !== 4
      || !telemetry.wheelOmegaRadS.every(Number.isFinite))
      return failure('INVALID_TELEMETRY', 'Provide forwardSpeedMps and four finite wheelOmegaRadS');
    const input = rawInput ?? {};
    for (const key of ['throttle', 'brake', 'steer', 'handbrake'])
      if (input[key] !== undefined && !Number.isFinite(input[key])) return failure('INVALID_INPUT', `${key} must be finite`);
    for (const key of ['gearUp', 'gearDown', 'nitrous', 'raceStarted'])
      if (input[key] !== undefined && typeof input[key] !== 'boolean') return failure('INVALID_INPUT', `${key} must be boolean`);
    if (input.selectGear !== undefined && (!Number.isInteger(input.selectGear) || input.selectGear < -1
      || input.selectGear > this.profile.transmission.forwardRatios.length))
      return failure('INVALID_GEAR', 'Gear is -1 reverse, 0 neutral, or a valid forward gear');

    const p = this.profile, t = p.transmission, s = this.state;
    const throttle = clamp(input.throttle ?? 0, 0, 1), brake = clamp(input.brake ?? 0, 0, 1);
    const handbrake = clamp(input.handbrake ?? 0, 0, 1), speed = Math.abs(telemetry.forwardSpeedMps);
    const raceStarted = input.raceStarted !== false, events = [];
    s.sinceShiftS += dt;
    if (s.shiftRemainingS > 0) {
      s.shiftRemainingS = Math.max(0, s.shiftRemainingS - dt);
      if (!s.shiftRemainingS) {
        s.gear = s.pendingGear; s.pendingGear = null; s.sinceShiftS = 0;
        events.push({type: 'shift_complete', gear: s.gear});
      }
    }
    const frontShare = p.driveLayout === 'FWD' ? 1 : p.driveLayout === 'RWD' ? 0 : p.awdFrontFraction;
    const omega = Math.abs((telemetry.wheelOmegaRadS[0] + telemetry.wheelOmegaRadS[1]) * 0.5 * frontShare
      + (telemetry.wheelOmegaRadS[2] + telemetry.wheelOmegaRadS[3]) * 0.5 * (1 - frontShare));
    const ratioFor = gear => gear === -1 ? -t.reverseRatio : gear === 0 ? 0 : t.forwardRatios[gear - 1];
    const coupledRpmFor = gear => omega * Math.abs(ratioFor(gear)) * t.finalDrive * RPM_PER_RAD_S;
    let rated = false;
    const beginShift = wanted => {
      if (wanted === s.gear || s.shiftRemainingS > 0) return;
      if ((wanted <= 0 || s.gear <= 0) && speed > t.reverseSelectionMaxSpeedMps) {
        events.push({type: 'shift_rejected', reason: 'stop_before_selecting_reverse_or_neutral'}); return;
      }
      if (wanted > 0 && coupledRpmFor(wanted) > p.engine.redlineRpm) {
        events.push({type: 'shift_rejected', reason: 'would_overrev'}); return;
      }
      s.pendingGear = wanted; s.shiftRemainingS = t.shiftSeconds;
      events.push({type: 'shift_start', from: s.gear, to: wanted});
      if (rated && s.gear > 0 && wanted === s.gear + 1) {
        const ideal = this.upshiftRpms[s.gear - 1], window = t.perfectShiftWindowRpm ?? (p.engine.redlineRpm - p.engine.idleRpm) * 0.06;
        const quality = s.rpm < ideal - window ? 'early' : s.rpm > ideal + window ? 'late' : 'perfect';
        if (quality === 'perfect') s.shiftRemainingS = t.shiftSeconds * (t.perfectShiftFactor ?? 1);
        s.lastShiftQuality = quality;
        events.push({type: 'shift_quality', quality, rpm: s.rpm, idealRpm: ideal, gear: wanted});
      }
    };
    const up = input.gearUp === true, down = input.gearDown === true;
    if (input.selectGear !== undefined) beginShift(input.selectGear);
    else if (s.mode === 'manual' && up !== down) {
      rated = true;
      if (up && !s.previousGearUp) beginShift(Math.min(t.forwardRatios.length, s.gear + 1));
      rated = false;
      if (down && !s.previousGearDown) beginShift(Math.max(-1, s.gear - 1));
    } else if (s.mode === 'automatic' && raceStarted && !s.shiftRemainingS && s.gear > 0
      && s.sinceShiftS >= t.minimumShiftIntervalSeconds) {
      if (s.gear < t.forwardRatios.length && s.rpm >= this.upshiftRpms[s.gear - 1]) beginShift(s.gear + 1);
      else if (s.gear > 1 && s.rpm < t.downshiftRpm) beginShift(s.gear - 1);
    }
    s.previousGearUp = up; s.previousGearDown = down;

    let steer = clamp(input.steer ?? 0, -1, 1);
    const abs = Math.abs(steer);
    steer = abs <= p.steering.deadzone ? 0 : Math.sign(steer) * (abs - p.steering.deadzone) / (1 - p.steering.deadzone);
    s.steerRad = approach(s.steerRad, steer * curve(p.steering.angleBySpeed, speed), p.steering.rateRadPerSecond * dt);
    const angles = ackermann(s.steerRad, p.wheelbaseM, p.trackM);

    if (!raceStarted) s.wasStaged = true;
    else if (s.wasStaged) {
      events.push({type: 'launch', rpm: s.rpm, quality: s.rpm < p.launch.minimumGoodRpm ? 'bog_risk'
        : s.rpm > p.launch.maximumGoodRpm ? 'wheelspin_risk' : 'good'});
      s.wasStaged = false;
    }
    const ratio = ratioFor(s.gear), shifting = s.shiftRemainingS > 0;
    const coupled = coupledRpmFor(s.gear);
    let targetRpm;
    if (!raceStarted || ratio === 0 || shifting) targetRpm = p.engine.idleRpm + throttle * (p.engine.redlineRpm - p.engine.idleRpm);
    else targetRpm = Math.max(p.engine.idleRpm, coupled, throttle * p.engine.launchRpm * Math.exp(-speed / 2));
    s.rpm = clamp(smooth(s.rpm, targetRpm, p.engine.rpmResponsePerSecond, dt), p.engine.idleRpm, p.engine.redlineRpm);
    const limiter = coupled >= p.engine.redlineRpm;
    if (limiter) events.push({type: 'rev_limiter'});
    const eligibleNitrous = raceStarted && !shifting && s.gear > 0 && !limiter && !s.overheated && input.nitrous === true
      && throttle >= p.nitrous.minimumThrottle && speed >= p.nitrous.minimumSpeedMps && s.nitrous > 0;
    const used = eligibleNitrous ? Math.min(s.nitrous, p.nitrous.drainPerSecond * dt) : 0;
    const boostFraction = used > 0 ? used / (p.nitrous.drainPerSecond * dt) : 0;
    s.nitrous -= used;
    if (eligibleNitrous !== s.nitrousActive) events.push({type: eligibleNitrous ? 'nitrous_start' : 'nitrous_stop'});
    s.nitrousActive = eligibleNitrous;
    // Turbo (autoral): a pressão sobe com atraso acima da rotação de enchimento e cai ao aliviar o pedal.
    if (p.turbo) {
      const span = p.engine.redlineRpm - p.turbo.spoolRpm;
      const target = raceStarted && !shifting && s.gear !== 0 ? throttle * clamp((s.rpm - p.turbo.spoolRpm) / (span * 0.35), 0, 1) : 0;
      const before = s.boost;
      s.boost = smooth(s.boost, target, target > s.boost ? p.turbo.spoolPerSecond : p.turbo.decayPerSecond, dt);
      if (before > 0.45 && throttle < 0.2 && s.boost < before) events.push({type: 'blowoff', boost: before});
    }
    // Calor (autoral): limitador, nitro e giro alto aquecem; acima de 1 o motor perde força até esfriar.
    if (p.heat) {
      const hot = (limiter ? p.heat.limiterPerSecond : 0) + (s.nitrousActive ? p.heat.nitrousPerSecond : 0)
        + (s.rpm > p.engine.redlineRpm * 0.9 && throttle > 0.5 ? p.heat.highRpmPerSecond : 0);
      s.temperature = clamp(s.temperature + (hot - p.heat.coolPerSecond * (hot ? 0.25 : 1)) * dt, 0, 1.15);
      if (!s.overheated && s.temperature >= 1) { s.overheated = true; events.push({type: 'overheat'}); }
      else if (s.overheated && s.temperature < p.heat.recoverBelow) { s.overheated = false; events.push({type: 'cooled'}); }
    }
    const heatFactor = s.overheated ? 1 - p.heat.derateFraction : 1;
    const turboFactor = p.turbo ? 1 + p.turbo.boostFraction * s.boost : 1;
    const torqueAvailable = curve(p.engine.torqueCurve, s.rpm) * turboFactor * heatFactor;
    const motorTorqueNm = limiter ? 0 : throttle * torqueAvailable * (1 + p.nitrous.torqueBoostFraction * boostFraction);
    const engineBrakingNm = (1 - throttle) * p.engine.engineBrakingNm * clamp(speed / 2, 0, 1);
    const wheelTotalNm = !raceStarted || ratio === 0 || shifting ? 0
      : (motorTorqueNm - engineBrakingNm) * ratio * t.finalDrive * t.efficiency;
    const shares = [frontShare / 2, frontShare / 2, (1 - frontShare) / 2, (1 - frontShare) / 2];
    const wheels = wheelNames.map((name, i) => ({name, driveTorqueNm: wheelTotalNm * shares[i],
      brakeTorqueNm: brake * p.brakes.maximumTorqueNmPerWheel * (i < 2 ? p.brakes.frontFraction * 2 : (1 - p.brakes.frontFraction) * 2)
        + (i >= 2 ? handbrake * p.brakes.handbrakeTorqueNmPerRearWheel : 0),
      steerRad: i === 0 ? angles.frontLeftRad : i === 1 ? angles.frontRightRad : 0,
      gripFraction: i < 2 ? 1 : 1 - handbrake * (1 - p.tires.handbrakeRearGripFraction)}));
    return {ok: true, value: {wheels, events, rpm: s.rpm, gear: s.gear, shifting,
      nitrousFraction: s.nitrous, nitrousActive: eligibleNitrous, speedMps: telemetry.forwardSpeedMps,
      speedKph: telemetry.forwardSpeedMps * 3.6, steerRad: s.steerRad, motorTorqueNm,
      throttle, brake, handbrake, raceStarted, boost: s.boost, temperature: s.temperature,
      overheated: s.overheated, upshiftRpm: s.gear > 0 ? this.upshiftRpms[s.gear - 1] : Infinity, mode: s.mode}};
  }
}
