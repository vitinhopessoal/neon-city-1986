import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { MOTO_DEFS, MOTO_SPECS, motoTrafficWeights } from '../../src/vehicles/models/NeonMoto.js';
import { SPECS } from '../../src/vehicles/VehicleFactory.js';
import { isCompatible, PARTS } from '../../src/vehicles/customization/CustomizationCatalog.js';
import { MotorcyclePhysics } from '../../src/vehicles/MotorcyclePhysics.js';

/** Lê o JSON de um GLB (chunk 0). */
function readGlb(file) {
  const b = readFileSync(file);
  assert.equal(b.readUInt32LE(0), 0x46546c67, `${file}: assinatura glTF`);
  assert.equal(b.readUInt32LE(4), 2, 'glTF 2.0');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}
const triangles = (j) => j.meshes.reduce((s, m) => s + m.primitives.reduce((t, p) => t + (p.indices !== undefined ? j.accessors[p.indices].count : j.accessors[p.attributes.POSITION].count) / 3, 0), 0);
const TRI = { basica: [6000, 12000], custom: [10000, 18000], esportiva: [12000, 22000] };

test('especificações: seis motos (2 básicas, 2 customs, 2 esportivas) com ergonomia coerente', () => {
  assert.equal(MOTO_DEFS.length, 6);
  const cats = MOTO_DEFS.reduce((o, d) => ((o[d.category] = (o[d.category] || 0) + 1), o), {});
  assert.deepEqual(cats, { basica: 2, custom: 2, esportiva: 2 });
  for (const d of MOTO_DEFS) {
    const D = d.dims, R = d.rider, H = d.handling;
    assert.ok(D.length > 1.9 && D.length < 2.7, `${d.name}: comprimento`);
    assert.ok(D.wheelBase / D.length > 0.6 && D.wheelBase / D.length < 0.75, `${d.name}: entre-eixos`);
    assert.ok(Math.abs(R.hipY - D.seatY - 0.1) < 0.06, `${d.name}: quadril sobre o banco`);
    assert.ok(R.pegY < R.hipY - 0.3, `${d.name}: pedaleiras abaixo do quadril`);
    assert.ok(R.gripZ > R.hipZ + 0.3, `${d.name}: manoplas à frente do quadril`);
    assert.ok(H.leanMax > 0.3 && H.leanMax <= 0.8, `${d.name}: inclinação máxima`);
    assert.ok(H.reverseSpeed <= 1.5, `${d.name}: ré só empurrando`);
    if (d.category === 'custom') assert.ok(R.pegZ > R.hipZ + 0.45, `${d.name}: comandos avançados`);
    if (d.category === 'esportiva') assert.ok(R.forward > 0.6 && R.pegZ < R.hipZ + 0.05, `${d.name}: posição esportiva`);
  }
});

test('GLB: hierarquia, pivô do garfo inclinado pelo rake, rodas no eixo, animações, triângulos e LOD', () => {
  for (const d of MOTO_DEFS) {
    const f = `public/models/motorcycles/${d.file}.glb`;
    assert.ok(existsSync(f), `${f} existe`);
    assert.ok(existsSync(`assets-src/motorcycles/${d.file}.blend`), `${d.file}.blend existe`);
    const j = readGlb(f);
    const byName = new Map(j.nodes.map((n, i) => [n.name, { ...n, i }]));
    for (const n of ['MotorcycleRoot', 'Frame', 'Engine', 'FuelTank', 'Seat', 'Exhaust', 'Lights', 'Plate_R', 'FrontFork', 'FrontForkMesh', 'FrontWheel', 'Tire_F', 'Rim_F', 'Swingarm', 'SwingarmMesh', 'RearWheel', 'Tire_R', 'Rim_R', 'Rider_Hip', 'Peg_L', 'Peg_R', 'Grip_L', 'Grip_R']) assert.ok(byName.has(n), `${d.name}: nó ${n}`);
    // FrontFork: rotação em X = −rake (Y local = eixo de direção).
    const q = byName.get('FrontFork').rotation;
    assert.ok(Math.abs(2 * Math.asin(q[0]) + d.dims.rake) < 1e-3 && Math.abs(q[1]) < 1e-6 && Math.abs(q[2]) < 1e-6, `${d.name}: garfo inclinado pelo rake`);
    const hip = byName.get('Rider_Hip').translation;
    assert.ok(Math.abs(hip[1] - d.rider.hipY) < 1e-3 && Math.abs(hip[2] - d.rider.hipZ) < 1e-3, `${d.name}: âncora do quadril`);
    const anims = j.animations.map((a) => a.name);
    for (const a of ['Steer', 'Suspension', 'FrontWheel_Spin', 'RearWheel_Spin']) assert.ok(anims.includes(a), `${d.name}: animação ${a}`);
    const tri = triangles(j);
    const [a, b] = TRI[d.category];
    assert.ok(tri >= a && tri <= b, `${d.name}: ${tri} triângulos na meta ${a}–${b}`);
    const lodF = `public/models/motorcycles/${d.file}_lod1.glb`;
    assert.ok(existsSync(lodF), `${d.name}: LOD existe`);
    const lod = readGlb(lodF);
    assert.ok(lod.nodes.some((n) => n.name === 'LOD1') && triangles(lod) < tri * 0.45, `${d.name}: LOD dizimado`);
  }
});

test('integração: SPECS, assento do piloto, ponto de montagem e trânsito por categoria', () => {
  for (const d of MOTO_DEFS) {
    const s = SPECS[d.type];
    assert.ok(s && s.bike && s.family === 'bike', `${d.name}: em SPECS como moto`);
    assert.equal(s.doors.length, 1, 'um ponto de montagem (lado esquerdo)');
    assert.equal(s.doors[0].side, 1);
    const drv = s.seats.find((x) => x.driver);
    assert.ok(drv.ride && drv.ride.pegY === d.rider.pegY && drv.ride.gripW === d.rider.gripW, `${d.name}: pontos de apoio no assento`);
    assert.equal(drv.recline, -d.rider.forward);
    assert.ok(s.seats.filter((x) => !x.rear).length === 1, 'trânsito usa só o piloto');
  }
  const w = Object.fromEntries(motoTrafficWeights(null));
  const sum = (c) => MOTO_DEFS.filter((d) => d.category === c).reduce((t, d) => t + w[d.type], 0);
  assert.ok(sum('basica') > sum('custom') && sum('custom') > sum('esportiva'), 'básicas > customs > esportivas');
  const rich = Object.fromEntries(motoTrafficWeights('rich'));
  assert.ok(rich.phantom_x1000 > w.phantom_x1000, 'esportivas mais comuns no bairro nobre');
});

test('NEON CUSTOMS: motos só com pintura, luzes e melhorias mecânicas', () => {
  for (const d of MOTO_DEFS) {
    for (const cat of ['wheels', 'tires', 'ride', 'bumper', 'skirts', 'spoiler', 'hood', 'exhaust', 'tint', 'interior']) {
      if (!PARTS[cat]) continue;
      PARTS[cat].options.forEach((o, i) => assert.equal(isCompatible(cat, o.id, d.type), i === 0, `${d.name}: ${cat}/${o.id}`));
    }
    assert.ok(PARTS.lights.options.slice(1).some((o) => isCompatible('lights', o.id, d.type)), 'faróis personalizáveis');
    assert.equal(isCompatible('paint2', null, d.type), false, 'sem faixas secundárias');
  }
  assert.ok(isCompatible('wheels', 'chrome', 'sedan'), 'carros inalterados');
});

/** Física isolada: chão plano, sem obstáculos. */
function rig(type) {
  const spec = MOTO_SPECS[type];
  const v = {
    id: 't', spec, controls: { throttle: 0, brake: 0, steer: 0, handbrake: false }, driver: 'player', engineOn: true, damage: null,
    root: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } },
    wheels: [{ local: { x: 0, z: spec.wheelBase / 2 } }, { local: { x: 0, z: -spec.wheelBase / 2 } }],
  };
  const col = { resolveOBB: () => 0, getGroundHeight: () => 0 };
  const ph = new MotorcyclePhysics(v, col, { getSurface: () => 'asphalt' });
  ph.syncFromRoot();
  ph.wake();
  return { v, ph };
}

test('física: inclina para o lado da curva, respeita o limite, endireita e só dá ré parada', () => {
  for (const d of MOTO_DEFS) {
    const { v, ph } = rig(d.type);
    v.controls.throttle = 1;
    for (let i = 0; i < 180; i++) ph.update(1 / 60);
    const vRun = ph.vLong;
    assert.ok(vRun > 8, `${d.name}: acelera (${vRun.toFixed(1)} m/s em 3 s)`);
    v.controls.steer = 1; // direita
    let peak = 0;
    for (let i = 0; i < 30; i++) { ph.update(1 / 60); peak = Math.max(peak, ph.lean); }
    assert.ok(peak > 0.1 && peak <= d.handling.leanMax + 1e-9, `${d.name}: inclina à direita ${peak.toFixed(2)}`);
    v.controls.steer = -1;
    let low = 0;
    for (let i = 0; i < 60; i++) { ph.update(1 / 60); low = Math.min(low, ph.lean); }
    assert.ok(low < -0.1 && low >= -d.handling.leanMax - 1e-9, `${d.name}: inclina à esquerda ${low.toFixed(2)}`);
    v.controls.steer = 0;
    for (let i = 0; i < 120; i++) ph.update(1 / 60);
    assert.ok(Math.abs(ph.lean) < 0.05, `${d.name}: endireita na reta`);
    // Ré: com throttle −1 parada, nunca passa de reverseSpeed.
    v.controls.throttle = 0; v.controls.brake = 1;
    for (let i = 0; i < 600 && ph.vLong > 0.05; i++) ph.update(1 / 60);
    v.controls.brake = 0; v.controls.throttle = -1;
    let rev = 0;
    for (let i = 0; i < 300; i++) { ph.update(1 / 60); rev = Math.min(rev, ph.vLong); }
    assert.ok(rev < -0.3 && -rev <= d.handling.reverseSpeed * 1.01, `${d.name}: ré ${(-rev).toFixed(2)} m/s`);
    assert.ok(Math.abs(ph.lean) < 0.05, `${d.name}: em pé parada/ré (sem queda)`);
  }
});
