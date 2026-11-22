import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createController, torqueCrossoverRpm} from '../../src/vehicles/mechanics/controller.mjs';
import {parseProfile} from '../../src/vehicles/mechanics/profile.mjs';
import {ackermann, frictionCircle, suspensionForce} from '../../src/vehicles/mechanics/math.mjs';

const profile = () => JSON.parse(readFileSync(new URL('./fixtures/compact-example.json', import.meta.url)));
const car = (patch = {}) => {const p = profile(); Object.assign(p.transmission, patch); const r = createController(p); assert.equal(r.ok, true); return r.value;};
const obs = (speed = 0) => ({forwardSpeedMps: speed, wheelOmegaRadS: Array(4).fill(speed / 0.31)});
const tick = (c, input, observation = obs(), n = 1, dt = 1 / 120) => {
  let r; for (let i = 0; i < n; i++) {r = c.step(input, observation, dt); assert.equal(r.ok, true);} return r.value;
};
const drive = frame => frame.wheels.reduce((sum, w) => sum + w.driveTorqueNm, 0);

test('invalid profile and incomplete telemetry refuse before state changes', () => {
  const p = profile(); p.massKg = 0; assert.equal(parseProfile(p).ok, false);
  const c = car(), before = c.snapshot();
  assert.equal(c.step({throttle: 1}, {forwardSpeedMps: 0}, 0.01).ok, false);
  assert.deepEqual(c.snapshot(), before);
  assert.equal(c.step({throttle: NaN}, obs(), 0.01).ok, false);
  assert.deepEqual(c.snapshot(), before);
});

test('configuration is owned; reconfiguration preserves tank and running mode', () => {
  const p = profile(), c = createController(p).value;
  p.engine.torqueCurve[1][1] = 99999;
  assert.notEqual(c.profile.engine.torqueCurve[1][1], 99999);
  c.setTransmissionMode('manual'); tick(c, {throttle: 1, nitrous: true}, obs(10), 60);
  const before = c.snapshot();
  assert.ok(before.nitrous < 1);
  assert.equal(c.reconfigure(profile()).ok, true);
  assert.equal(c.snapshot().nitrous, before.nitrous); assert.equal(c.snapshot().mode, 'manual');
  const bad = profile(); bad.engine.redlineRpm = 1;
  assert.equal(c.reconfigure(bad).ok, false);
  assert.deepEqual(c.snapshot(), before);
});

test('staging raises RPM but applies no wheel torque; GO emits one launch event', () => {
  const c = car(); const staged = tick(c, {throttle: 0.5, raceStarted: false}, obs(), 120);
  assert.equal(drive(staged), 0); assert.ok(staged.rpm > 3000);
  const go = tick(c, {throttle: 0.5, raceStarted: true});
  assert.equal(go.events.filter(e => e.type === 'launch').length, 1); assert.ok(drive(go) > 0);
  assert.equal(tick(c, {throttle: 0.5}).events.filter(e => e.type === 'launch').length, 0);
});

test('shift cuts torque and second gear changes thrust at the same road speed', () => {
  const c = car({mode: 'manual'}), first = tick(c, {throttle: 1}, obs(12), 240);
  const start = tick(c, {throttle: 1, gearUp: true}, obs(12));
  assert.equal(start.shifting, true); assert.equal(drive(start), 0);
  const second = tick(c, {throttle: 1, gearUp: true}, obs(12), 240);
  assert.equal(second.gear, 2); assert.ok(second.rpm < first.rpm); assert.ok(drive(second) < drive(first));
  // Holding the key does not request many gears: transitions are edge-triggered.
  assert.equal(c.snapshot().gear, 2);
});

test('unsafe reversal and downshift are rejected without applying their ratios', () => {
  const c = car({mode: 'manual'});
  const reverse = tick(c, {selectGear: -1}, obs(20));
  assert.ok(reverse.events.some(e => e.type === 'shift_rejected')); assert.equal(reverse.gear, 1);
  tick(c, {selectGear: 2}, obs(12), 40);
  const down = tick(c, {selectGear: 1}, obs(35));
  assert.ok(down.events.some(e => e.reason === 'would_overrev')); assert.equal(down.gear, 2);
});

test('neutral free-revs, reverse produces negative torque, coast brakes the engine', () => {
  const c = car({mode: 'manual'});
  tick(c, {selectGear: 0}, obs(), 40);
  const neutral = tick(c, {throttle: 1}, obs(), 120);
  assert.equal(neutral.gear, 0); assert.equal(drive(neutral), 0); assert.ok(neutral.rpm > 6000);
  tick(c, {selectGear: -1}, obs(), 40);
  assert.ok(drive(tick(c, {throttle: 1}, obs(-2), 60)) < 0);
  const forward = car({mode: 'manual'});
  assert.ok(drive(tick(forward, {throttle: 0}, obs(10), 60)) < 0);
});

test('nitrous requires speed/throttle and uses equal charge for equal simulated time', () => {
  const a = car({mode: 'manual'}), b = car({mode: 'manual'});
  const idle = tick(a, {throttle: 1, nitrous: true}, obs(), 60);
  assert.equal(idle.nitrousFraction, 1);
  const boosted = tick(a, {throttle: 1, nitrous: true}, obs(10), 120);
  const other = tick(b, {throttle: 1, nitrous: true}, obs(10), 60, 1 / 60);
  assert.ok(Math.abs(boosted.nitrousFraction - other.nitrousFraction) < 1e-12);
  assert.ok(boosted.nitrousFraction < 1 && boosted.nitrousActive);
  const before = a.snapshot().nitrous; a.reset(); assert.equal(a.snapshot().nitrous, before);
  a.awardNitrous(100); assert.equal(a.snapshot().nitrous, 1);
});

test('nitrous cannot spend more than its tank; handbrake targets only rear wheels', () => {
  const c = car({mode: 'manual'}), result = tick(c, {throttle: 1, nitrous: true, handbrake: 1}, obs(10), 1200);
  assert.equal(result.nitrousFraction, 0); assert.equal(result.nitrousActive, false);
  assert.equal(result.wheels[0].brakeTorqueNm, 0); assert.ok(result.wheels[2].brakeTorqueNm > 0);
  assert.ok(result.wheels[2].gripFraction < result.wheels[0].gripFraction);
});

test('FWD/RWD/AWD distribute only to the configured axles', () => {
  for (const layout of ['FWD', 'RWD', 'AWD']) {
    const p = profile(); p.driveLayout = layout; const c = createController(p).value;
    const f = tick(c, {throttle: 1}, obs(5), 60), front = f.wheels[0].driveTorqueNm + f.wheels[1].driveTorqueNm;
    const rear = f.wheels[2].driveTorqueNm + f.wheels[3].driveTorqueNm;
    if (layout === 'FWD') {assert.ok(front > 0); assert.equal(rear, 0);}
    if (layout === 'RWD') {assert.equal(front, 0); assert.ok(rear > 0);}
    if (layout === 'AWD') assert.ok(Math.abs(front / (front + rear) - p.awdFrontFraction) < 1e-12);
  }
});

test('combined tire forces obey one friction budget, including diagonal demand', () => {
  const f = frictionCircle(10000, 10000, 5000);
  assert.ok(Math.abs(Math.hypot(f.longitudinalN, f.lateralN) - 5000) < 1e-9);
  assert.equal(f.longitudinalN, f.lateralN);
  assert.deepEqual(frictionCircle(10, -5, 0), {longitudinalN: 0, lateralN: -0, saturation: 0});
});

test('Ackermann inner wheel turns more; steering reduces at high speed', () => {
  const left = ackermann(0.4, 2.6, 1.5), right = ackermann(-0.4, 2.6, 1.5);
  assert.ok(left.frontLeftRad > left.frontRightRad);
  assert.equal(right.frontLeftRad, -left.frontRightRad);
  const a = car({mode: 'manual'}), b = car({mode: 'manual'});
  assert.ok(tick(a, {steer: 1}, obs(0), 120).steerRad > tick(b, {steer: 1}, obs(40), 120).steerRad);
});

test('suspension pushes on compression, damps motion and never pulls an airborne wheel', () => {
  const p = profile().suspension;
  assert.ok(suspensionForce(0.05, 1, true, p) > suspensionForce(0.05, 0, true, p));
  assert.equal(suspensionForce(0.05, 1, false, p), 0);
  assert.equal(suspensionForce(0, -10, true, p), 0);
});

test('torque-crossover selector compares thrust in both ratios, not the largest RPM alone', () => {
  const found = torqueCrossoverRpm([[1000, 100], [4000, 250], [7000, 50]], 3, 2, 2000, 7000);
  assert.ok(found > 4000 && found < 7000);
});
