import test from 'node:test';
import assert from 'node:assert/strict';
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics.js';
import { SPECS } from '../../src/vehicles/VehicleFactory.js';
import { attachNeonPowertrain } from '../../src/vehicles/mechanics/NeonPowertrain.js';
import { DRIVETRAINS, drivetrainFor } from '../../src/vehicles/mechanics/drivetrains.js';
import { computeHandling } from '../../src/vehicles/customization/VehiclePerformance.js';
import { UPGRADES, defaultConfig, sanitizeConfig } from '../../src/vehicles/customization/CustomizationCatalog.js';

const CARS = Object.keys(SPECS).filter((t) => !SPECS[t].bike && SPECS[t].family !== 'boat' && Array.isArray(SPECS[t].handling?.gears));

/** Carro sobre asfalto plano, sem obstáculos, dirigido pelo jogador. */
function car(type = 'sports', { mode = 'automatic', powertrain = true, driver = 'player', handling = null, surface = 'asphalt' } = {}) {
  const spec = structuredClone(SPECS[type]);
  if (handling) Object.assign(spec.handling, handling);
  const v = { spec, type, id: `t_${type}`, driver, engineOn: true, root: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } },
    controls: { throttle: 0, brake: 0, steer: 0, handbrake: false }, damage: { performance: 1 },
    wheels: [1, -1, 1, -1].map((side, i) => ({ local: { x: side * spec.track / 2, z: (i < 2 ? 1 : -1) * spec.wheelBase / 2 } })) };
  v.physics = new VehiclePhysics(v, { resolveOBB() { return 0; }, getGroundHeight() { return 0; } }, { getSurface: () => surface, waterDepth: () => 0 });
  v.physics.syncFromRoot(); v.physics.wake();
  if (powertrain) {
    const r = attachNeonPowertrain(v, { factoryHandling: SPECS[type].handling, drivetrain: drivetrainFor(type), mode });
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  return v;
}
const run = (v, s, fps = 120) => { for (let i = 0; i < Math.round(s * fps); i++) v.physics.update(1 / fps); };
const setSpeed = (v, mps) => { v.physics.vz = v.physics.vLong = mps; };
const events = (v) => { const e = v.physics.powertrainEvents.slice(); v.physics.powertrainEvents.length = 0; return e; };
const time0to100 = (v, limit = 30) => { v.controls.throttle = 1; for (let t = 0; t < limit; t += 0.05) { run(v, 0.05); if (v.physics.vLong * 3.6 >= 100) return t + 0.05; } return Infinity; };

test('todos os carros jogáveis têm tração, peso e câmbio próprios e aceitam o módulo', () => {
  assert.equal(CARS.length, 12);
  for (const t of CARS) {
    assert.ok(DRIVETRAINS[t], `sem tabela de tração: ${t}`);
    const v = car(t);
    v.controls.throttle = 1; run(v, 3);
    assert.equal(v.physics.powertrainError, null, t);
    assert.ok(v.physics.vLong > 5, t);
    assert.ok(Number.isFinite(v.physics.rpm) && v.physics.rpm > 0, t);
  }
  const layouts = new Set(CARS.map((t) => drivetrainFor(t).layout));
  assert.deepEqual([...layouts].sort(), ['AWD', 'FWD', 'RWD']);
});

test('motor: curva de torque, limitador corta a força e o giro nunca passa do corte', () => {
  const v = car('sports', { mode: 'manual' });
  const p = v.physics.powertrain.profile;
  const peak = Math.max(...p.engine.torqueCurve.map((x) => x[1]));
  assert.ok(p.engine.torqueCurve[0][1] < peak && p.engine.torqueCurve.at(-1)[1] < peak, 'curva com pico no meio da faixa');
  v.controls.throttle = 1; run(v, 4);
  const ev = events(v);
  assert.ok(ev.some((e) => e.type === 'rev_limiter'), 'em 1ª, segurando o pedal, o limitador atua');
  assert.ok(v.physics.rpm <= p.engine.redlineRpm + 1e-6);
  assert.ok(v.physics.vLong * 3.6 < SPECS.sports.handling.gears[1] * 3.6 + 3, 'a 1ª não passa do fim da faixa');
});

test('freio-motor pela marcha: 2ª segura mais que 5ª e não há freio-motor duplicado', () => {
  const lift = (gear) => {
    const v = car('sports', { mode: 'manual' });
    setSpeed(v, 20); v.controls.selectGear = gear; v.controls.throttle = 0.01; run(v, 0.6);
    delete v.controls.selectGear; v.controls.throttle = 0;
    const v0 = v.physics.vLong; run(v, 1); return v0 - v.physics.vLong;
  };
  const d2 = lift(2), d5 = lift(5);
  assert.ok(d2 > d5 * 1.3, `2ª ${d2.toFixed(2)} vs 5ª ${d5.toFixed(2)} m/s perdidos em 1 s`);
  const arcade = car('sports', { powertrain: false }); setSpeed(arcade, 20); run(arcade, 1);
  assert.ok(d2 < (20 - arcade.physics.vLong) * 3, 'freio-motor da marcha curta continua plausível');
});

test('troca: corte de força, troca perfeita encurta o corte, cedo/tarde informam', () => {
  const v = car('sports', { mode: 'manual' });
  v.controls.throttle = 1; run(v, 0.4);
  const fr = v.physics.powertrain;
  // Troca cedo (giro baixo).
  v.controls.gearUp = true; run(v, 1 / 120); v.controls.gearUp = false;
  let ev = events(v);
  assert.equal(ev.find((e) => e.type === 'shift_quality')?.quality, 'early');
  assert.equal(v.physics.powertrainFrame.driveForceN, 0, 'sem força durante a troca');
  run(v, 0.6);
  // Troca no ponto ideal: corte menor.
  const ideal = fr.upshiftRpms[1];
  while (v.physics.rpm < ideal - 50) run(v, 1 / 120);
  v.controls.gearUp = true; run(v, 1 / 120); v.controls.gearUp = false;
  ev = events(v);
  assert.equal(ev.find((e) => e.type === 'shift_quality')?.quality, 'perfect');
  let cut = 0; while (fr.snapshot().shiftRemainingS > 0) { run(v, 1 / 120); cut += 1 / 120; }
  assert.ok(cut < drivetrainFor('sports').shiftSeconds * 0.7, `corte da troca perfeita ${cut.toFixed(3)} s`);
});

test('manual: parado, Z engata neutro e depois ré; em neutro o acelerador só sobe o giro', () => {
  const v = car('palm_compact', { mode: 'manual' });
  v.controls.gearDown = true; run(v, 0.05); v.controls.gearDown = false; run(v, 0.5);
  assert.equal(v.physics.gear, 'N');
  v.controls.throttle = 1; run(v, 1);
  assert.ok(Math.abs(v.physics.vLong) < 0.05, 'neutro não traciona');
  assert.ok(v.physics.rpm > v.physics.powertrain.profile.engine.idleRpm * 2, 'motor sobe de giro em neutro');
  v.controls.throttle = 0; run(v, 0.5);
  v.controls.gearDown = true; run(v, 0.05); v.controls.gearDown = false; run(v, 0.5);
  assert.equal(v.physics.gear, 'R');
  // Em R, o S (acelerador para trás no teclado) dá ré; o W volta para a 1ª.
  v.controls.throttle = -1; run(v, 1.5);
  assert.ok(v.physics.vLong < -0.5, 'em ré, S empurra para trás');
  v.controls.throttle = 0; v.controls.brake = 1; run(v, 1.5); v.controls.brake = 0;
  v.controls.throttle = 1; run(v, 1.5);
  assert.equal(v.physics.gear, 1);
  assert.ok(v.physics.vLong > 0.5);
  // Em movimento, N/R são recusados.
  const m = car('palm_compact', { mode: 'manual' }); setSpeed(m, 12); run(m, 0.2);
  m.controls.selectGear = 0; run(m, 0.1); delete m.controls.selectGear;
  assert.ok(events(m).some((e) => e.type === 'shift_rejected'));
});

test('ré pelo S no automático freia antes de inverter e respeita a velocidade de ré', () => {
  const v = car('sedan'); setSpeed(v, 10);
  v.controls.throttle = -1; run(v, 3);
  assert.ok(v.physics.vLong < 1);
  run(v, 6);
  assert.equal(v.physics.gear, 'R');
  assert.ok(v.physics.vLong < -2 && v.physics.vLong > -(SPECS.sedan.handling.reverseSpeed + 0.5));
});

test('largada: freio de mão + acelerador parado prepara o giro sem andar; soltar avalia a largada', () => {
  const v = car('sports');
  v.controls.handbrake = true; v.controls.throttle = 1; run(v, 1);
  assert.ok(Math.abs(v.physics.vLong) < 0.05);
  assert.equal(v.physics.powertrainFrame.staged, true);
  assert.ok(v.physics.rpm > 3000);
  events(v);
  v.controls.handbrake = false; run(v, 0.5);
  const launch = events(v).find((e) => e.type === 'launch');
  assert.ok(launch, 'evento de largada');
  assert.ok(['good', 'bog_risk', 'wheelspin_risk'].includes(launch.quality));
  assert.ok(v.physics.vLong > 2);
  // Soltar o acelerador antes do freio de mão (estacionar) não conta como largada.
  const p = car('sports'); p.controls.handbrake = true; p.controls.throttle = 1; run(p, 0.6);
  p.controls.throttle = 0; run(p, 0.1); events(p); p.controls.handbrake = false; run(p, 0.3);
  assert.ok(!events(p).some((e) => e.type === 'launch'));
});

test('nitro: acelera mais, consome a reserva, para vazio e recarrega em alta velocidade', () => {
  const a = car('ocean_coupe'), b = car('ocean_coupe');
  // Acima de ~90 km/h o motor (e não o pneu) é o limite: é ali que o nitro rende.
  for (const v of [a, b]) { setSpeed(v, 28); v.controls.throttle = 1; }
  b.controls.nitrous = true;
  run(a, 2); run(b, 2);
  assert.ok(b.physics.vLong > a.physics.vLong + 0.8, `com nitro ${b.physics.vLong.toFixed(1)} vs ${a.physics.vLong.toFixed(1)} m/s`);
  const tank = b.physics.powertrainFrame.nitrousFraction;
  assert.ok(tank < 0.75 && tank > 0.4, `reserva ${tank}`);
  run(b, 6);
  assert.equal(b.physics.powertrainFrame.nitrousFraction, 0);
  assert.equal(b.physics.powertrainFrame.nitrousActive, false);
  b.controls.nitrous = false; run(b, 4);
  assert.ok(b.physics.powertrainFrame.nitrousFraction > 0.02, 'recarga dirigindo rápido');
  // Kit da oficina altera o ganho e a duração (lido do manuseio vivo).
  const kit = UPGRADES.nitro.levels[2].nitro;
  const k = car('ocean_coupe', { handling: { nitroBoost: kit.boost, nitroDrain: kit.drain } });
  assert.equal(k.physics.powertrain.profile.nitrous.torqueBoostFraction, 0.7);
  assert.equal(k.physics.powertrain.profile.nitrous.drainPerSecond, 0.13);
});

test('turbo: pressão sobe com atraso, aumenta o torque e alivia ao soltar', () => {
  const v = car('azure_gtr', { mode: 'manual' });
  setSpeed(v, 14); v.controls.selectGear = 2; run(v, 0.4); delete v.controls.selectGear;
  v.controls.throttle = 1; run(v, 0.12);
  const early = v.physics.powertrainFrame.boost;
  run(v, 1.2);
  const late = v.physics.powertrainFrame.boost;
  assert.ok(early < late * 0.6 && late > 0.6, `pressão ${early.toFixed(2)} → ${late.toFixed(2)}`);
  events(v); v.controls.throttle = 0; run(v, 0.3);
  assert.ok(events(v).some((e) => e.type === 'blowoff'));
  assert.ok(!car('sports').physics.powertrain.profile.turbo, 'aspirados sem turbo');
});

test('calor: limitador e nitro aquecem, superaquecido perde força, depois esfria', () => {
  const v = car('palm_compact', { mode: 'manual' });
  v.controls.throttle = 1;
  let t = 0; while (!v.physics.powertrainFrame?.overheated && t < 40) { run(v, 0.25); t += 0.25; }
  assert.ok(v.physics.powertrainFrame.overheated, 'segurar no limitador superaquece');
  assert.ok(events(v).some((e) => e.type === 'overheat'));
  const hot = v.physics.powertrain.core.snapshot();
  assert.ok(hot.temperature >= 1);
  v.controls.throttle = 0; v.controls.brake = 1; run(v, 15);
  assert.equal(v.physics.powertrainFrame.overheated, false);
});

test('tração: transferência de carga, controle de tração e diferenças FWD/RWD/AWD', () => {
  const v = car('sports'); v.controls.throttle = 1; run(v, 0.5);
  const st = SPECS.sports.handling.mass * 9.81 * drivetrainFor('sports').frontWeight;
  assert.ok(v.physics.axleLoad.front < st - 200, 'acelerar alivia a dianteira');
  // Automático: controle de tração completo; manual: escorrega pouco ('sport').
  const auto = car('neon_phantom'), man = car('neon_phantom', { mode: 'manual' });
  let sa = 0, sm = 0;
  for (const [x, rec] of [[auto, (s) => { sa = Math.max(sa, s); }], [man, (s) => { sm = Math.max(sm, s); }]]) {
    x.controls.throttle = 1;
    for (let i = 0; i < 240; i++) { x.physics.update(1 / 120); rec(x.physics.wheelspin); }
  }
  assert.ok(sa < 0.3, `automático patina ${sa.toFixed(2)} m/s`);
  assert.ok(sm > 0.8 && sm < 4, `manual patina ${sm.toFixed(2)} m/s`);
  // Sem assistência, a traseira do RWD patina e a do FWD não recebe força.
  const raw = car('neon_phantom'); raw.physics.powertrain.options.tractionControl = false;
  raw.controls.throttle = 1; let sr = 0;
  for (let i = 0; i < 180; i++) { raw.physics.update(1 / 120); sr = Math.max(sr, raw.physics.spinR); }
  assert.ok(sr > 3, `RWD sem assistência patina ${sr.toFixed(1)} m/s`);
  const fwd = car('palm_compact'); fwd.physics.powertrain.options.tractionControl = false;
  fwd.controls.throttle = 1; run(fwd, 1);
  assert.equal(fwd.physics.spinR, 0);
  // AWD (turbo) sai mais forte que o RWD de potência parecida.
  assert.ok(time0to100(car('azure_gtr')) < time0to100(car('midnight_vortex')));
});

test('freios: ABS no limite de aderência (sem travar), freio de mão trava as traseiras', () => {
  for (const t of ['sports', 'sedan', 'palm_compact']) {
    const v = car(t); setSpeed(v, 100 / 3.6); v.controls.brake = 1;
    const z0 = v.physics.z; let lock = false, abs = false;
    for (let i = 0; i < 1200 && v.physics.vLong > 0.05; i++) { v.physics.update(1 / 120); lock ||= v.physics.brakeLock.front; abs ||= v.physics.absActive; }
    const d = v.physics.z - z0, mu = SPECS[t].handling.grip;
    const ideal = (100 / 3.6) ** 2 / (2 * mu * 9.81);
    assert.equal(lock, false, t);
    assert.ok(d > ideal * 0.85 && d < ideal * 1.45, `${t}: ${d.toFixed(1)} m (ideal μg ${ideal.toFixed(1)} m)`);
  }
  const h = car('sports'); setSpeed(h, 20); h.controls.handbrake = true; h.controls.steer = 1; run(h, 0.6);
  assert.equal(h.physics.brakeLock.rear, true);
  assert.ok(Math.abs(h.physics.yawRate) > 0.4, 'freio de mão + direção faz a traseira escorregar');
});

test('direção sensível à velocidade (modelo existente, aplicado uma vez)', () => {
  const slow = car('sports'), fast = car('sports');
  setSpeed(fast, 40); slow.controls.steer = fast.controls.steer = 1;
  run(slow, 1); run(fast, 1);
  assert.ok(Math.abs(slow.physics.steerAngle) > Math.abs(fast.physics.steerAngle) * 1.5);
});

test('melhorias da oficina: motor e transmissão aceleram mais, kit de nitro e motos', () => {
  const stock = car('sedan');
  const h = computeHandling('sedan', { ...defaultConfig({}), engine: 3, trans: 2 }).handling;
  const tuned = car('sedan', { handling: h });
  assert.ok(time0to100(tuned) < time0to100(stock) - 0.4);
  // Câmbio encurtado: mais força na mesma velocidade e marcha.
  const a = car('sedan', { mode: 'manual' }), b = car('sedan', { mode: 'manual', handling: computeHandling('sedan', { ...defaultConfig({}), trans: 2 }).handling });
  for (const v of [a, b]) { setSpeed(v, 16); v.controls.selectGear = 2; v.controls.throttle = 1; run(v, 0.5); }
  assert.ok(b.physics.powertrainFrame.driveForceN > a.physics.powertrainFrame.driveForceN);
  // Kit de nitro salvo/sanitizado; moto não aceita kit.
  assert.equal(sanitizeConfig({ nitro: 2 }, { type: 'sedan' }).nitro, 2);
  assert.equal(sanitizeConfig({ nitro: 2 }, { type: 'palm_rider_125' }).nitro, 0);
  assert.equal(computeHandling('sedan', { ...defaultConfig({}), nitro: 1 }).handling.nitroBoost, 0.5);
});

test('trânsito e polícia continuam no modelo arcade; passo fixo independe do FPS', () => {
  const ai = car('sedan', { driver: 'ai' }), plain = car('sedan', { powertrain: false, driver: 'ai' });
  for (const v of [ai, plain]) { v.controls.throttle = 1; run(v, 5); }
  assert.equal(ai.physics.vLong, plain.physics.vLong);
  assert.equal(ai.physics.powertrainActive, false);
  const runs = [30, 60, 144].map((fps) => { const v = car('sports', { mode: 'manual' }); v.controls.throttle = 1; run(v, 3, fps); return v.physics; });
  for (const p of runs.slice(1)) {
    assert.ok(Math.abs(p.z - runs[0].z) < 0.3 && Math.abs(p.vLong - runs[0].vLong) < 0.15 && p.gear === runs[0].gear);
  }
});
