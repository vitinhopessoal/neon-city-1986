import test from 'node:test';
import assert from 'node:assert/strict';
import { VehiclePhysics, PHYSICS_STEP } from '../../src/vehicles/VehiclePhysics.js';
import { SPECS } from '../../src/vehicles/VehicleFactory.js';
import { attachNeonPowertrain, detachNeonPowertrain } from '../../src/vehicles/mechanics/NeonPowertrain.js';

function fixture(type = 'sports', options = null) {
  const spec = structuredClone(SPECS[type]);
  const v = {spec, type, id: 'mechanics-fixture', driver: {}, engineOn: true,
    root: {position: {x: 0, y: 0, z: 0}, rotation: {y: 0}},
    controls: {throttle: 1, brake: 0, steer: 0, handbrake: false},
    damage: {performance: 1}, wheels: [1, -1, 1, -1].map((side, i) => ({
      local: {x: side * spec.track / 2, z: (i < 2 ? 1 : -1) * spec.wheelBase / 2},
    }))};
  const collision = {resolveOBB() {return 0;}, getGroundHeight() {return 0;}};
  v.physics = new VehiclePhysics(v, collision, {getSurface: () => 'asphalt', waterDepth: () => 0});
  v.physics.syncFromRoot(); v.physics.wake();
  if (options) {
    const attached = attachNeonPowertrain(v, {factoryHandling: SPECS[type].handling, ...options});
    assert.equal(attached.ok, true, JSON.stringify(attached));
  }
  return v;
}
const run = (v, seconds, fps = 120) => {for (let i = 0; i < Math.round(seconds * fps); i++) v.physics.update(1 / fps);};

test('opt-in is explicit; old arcade path remains the default', () => {
  const v = fixture(); assert.equal(v.physics.powertrain, null);
  run(v, 4); assert.ok(v.physics.vLong > 15);
  const attached = attachNeonPowertrain(v, {factoryHandling: SPECS.sports.handling});
  assert.equal(attached.ok, true); assert.equal(detachNeonPowertrain(v).ok, true);
  assert.equal(v.physics.powertrain, null);
});

test('every actual Neon model accepts derived metric profiles and moves forward', () => {
  // Motos (PROMPT 15, posteriores à base do pacote) e barcos mantêm a física própria.
  for (const type of Object.keys(SPECS).filter((t) => !SPECS[t].bike && SPECS[t].family !== 'boat')) {
    const v = fixture(type, {}); run(v, 2);
    assert.equal(v.physics.powertrainError, null, type);
    assert.ok(v.physics.vLong > 1, type);
    assert.ok(Number.isFinite(v.physics.rpm), type);
  }
});

test('new gearbox affects chassis force and changes gears on the fixed step', () => {
  const a = fixture('sports', {mode: 'manual'}), b = fixture('sports', {mode: 'manual'});
  a.physics.vz = b.physics.vz = 8; a.physics.vLong = b.physics.vLong = 8;
  b.controls.selectGear = 2;
  // Força média do motor ao longo do trecho (a 1ª encosta no limitador em alguns passos).
  const thrust = (v) => { let sum = 0; for (let i = 0; i < 84; i++) { v.physics.update(1 / 120); sum += v.physics.powertrainFrame.driveForceN; } return sum / 84; };
  const fa = thrust(a), fb = thrust(b);
  assert.equal(a.physics.gear, 1); assert.equal(b.physics.gear, 2);
  // Neon City: o modelo de tração limita as duas marchas pela aderência nesta velocidade;
  // a marcha muda a força do motor e o chassi não pode ser mais rápido em 2ª.
  assert.ok(fa > fb, `first gear must have stronger engine thrust at this speed (${fa.toFixed(0)} vs ${fb.toFixed(0)} N)`);
  assert.ok(a.physics.vLong >= b.physics.vLong - 0.05, 'second gear cannot out-accelerate first while both are grip-limited');
  // Acima do limite de aderência a relação aparece no chassi: 3ª empurra mais que 5ª a 20 m/s.
  const c3 = fixture('sports', {mode: 'manual'}), c5 = fixture('sports', {mode: 'manual'});
  for (const [v, g] of [[c3, 3], [c5, 5]]) { v.physics.vz = v.physics.vLong = 20; v.controls.selectGear = g; }
  run(c3, 1); run(c5, 1);
  assert.equal(c3.physics.gear, 3); assert.equal(c5.physics.gear, 5);
  assert.ok(c3.physics.vLong > c5.physics.vLong + 0.3, 'shorter gear must accelerate the chassis harder when grip is not the limit');
  const auto = fixture('sports', {}); run(auto, 12);
  assert.ok(auto.physics.gear > 1); assert.equal(auto.physics.powertrainError, null);
});

test('30, 60 and 144 display FPS preserve the same fixed-step acceleration', () => {
  const cars = [30, 60, 144].map(fps => {const v = fixture('sports', {}); run(v, 6, fps); return v;});
  for (const v of cars.slice(1)) {
    assert.ok(Math.abs(v.physics.z - cars[0].physics.z) < 0.3);
    assert.ok(Math.abs(v.physics.vLong - cars[0].physics.vLong) < 0.15);
    assert.equal(v.physics.gear, cars[0].physics.gear);
  }
});

test('live upgrades refresh ratios without recalibrating away the gearing effect', () => {
  const v = fixture('sports', {mode: 'manual'}), module = v.physics.powertrain;
  const state = {controls: {throttle: 1}, forwardSpeedMps: 8, engineOn: true};
  let original; for (let i = 0; i < 300; i++) original = module.step(state, PHYSICS_STEP);
  assert.equal(original.ok, true);
  v.spec.handling.gears = v.spec.handling.gears.map(x => x * 0.9);
  let changed; for (let i = 0; i < 300; i++) changed = module.step(state, PHYSICS_STEP);
  assert.equal(changed.ok, true);
  assert.notEqual(changed.value.driveForceN, original.value.driveForceN);
  const tank = module.snapshot().nitrous;
  module.reset(); assert.equal(module.snapshot().nitrous, tank);
});

test('reverse requests brake before direction change and engine-off cannot drive', () => {
  const v = fixture('sports', {});
  v.controls.throttle = -1; v.physics.vz = 8; v.physics.vLong = 8;
  run(v, 3); assert.ok(v.physics.vLong < 1);
  run(v, 3); assert.ok(v.physics.vLong < 0); assert.equal(v.physics.gear, 'R');
  v.engineOn = false; run(v, 0.1);
  assert.equal(v.physics.gear, 'P'); assert.equal(v.physics.rpm, 0);
  assert.equal(v.physics.powertrainFrame.driveForceN, 0);
  v.engineOn = true; v.controls.throttle = 0; v.physics.syncFromRoot();
  assert.equal(v.physics.powertrain.snapshot().gear, 1);
});
