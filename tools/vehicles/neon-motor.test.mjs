import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { NEON_DEFS, NEON_SPECS, trafficWeights, TRAFFIC_BASE, neonZoneAt } from '../../src/vehicles/models/NeonMotor.js';
import { SPECS } from '../../src/vehicles/VehicleFactory.js';
import { isCompatible, PARTS } from '../../src/vehicles/customization/CustomizationCatalog.js';
import { computeHandling } from '../../src/vehicles/customization/VehiclePerformance.js';

/** Lê o JSON de um GLB (chunk 0). */
function readGlb(file) {
  const b = readFileSync(file);
  assert.equal(b.readUInt32LE(0), 0x46546c67, `${file}: assinatura glTF`);
  assert.equal(b.readUInt32LE(4), 2, 'glTF 2.0');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}
const CAT = { popular: 0, intermediario: 1, luxo: 2 };

test('especificações: nove modelos distintos, medidas plausíveis e cabeça abaixo do teto', () => {
  assert.equal(NEON_DEFS.length, 9);
  assert.equal(new Set(NEON_DEFS.map((d) => d.type)).size, 9);
  for (const d of NEON_DEFS) {
    const D = d.dims, b = d.body;
    assert.ok(D.length > 3.6 && D.length < 5.6, `${d.name}: comprimento`);
    assert.ok(D.width > 1.6 && D.width < 2.05, `${d.name}: largura`);
    assert.ok(D.wheelBase / D.length > 0.52 && D.wheelBase / D.length < 0.62, `${d.name}: entre-eixos proporcional`);
    assert.ok(D.track < D.width - 0.15, `${d.name}: bitola dentro da carroceria`);
    assert.ok(b.roofY <= D.height + 0.01, `${d.name}: teto até a altura total`);
    const drv = d.seats.find((s) => s.driver);
    // Olhos como na câmera interna (VehicleCamera.computeFirst) + 12 cm até o topo da cabeça.
    const head = drv.hipY + 0.76 * Math.cos(drv.recline) + 0.12;
    if (b.rear !== 'roadster') assert.ok(head < b.roofY - 0.03, `${d.name}: cabeça ${head.toFixed(2)} < teto interno ${(b.roofY - 0.03).toFixed(2)}`);
    const doors = b.doorZ.length * 2;
    assert.equal(doors, d.seats.some((s) => s.rear) && ['bay_city_100', 'coast_wagon', 'metro_executive', 'sunset_touring'].includes(d.type) ? 4 : 2, `${d.name}: número de portas`);
    for (const [z1, z0] of b.doorZ) {
      assert.ok(z1 > z0, 'dobradiça na borda dianteira');
      assert.ok(z1 < D.wheelBase / 2 - D.wheelRadius - 0.05, `${d.name}: porta atrás da caixa de roda dianteira`);
      assert.ok(z0 > -D.wheelBase / 2 + D.wheelRadius + 0.05, `${d.name}: porta à frente da caixa de roda traseira`);
    }
  }
});

test('GLB: hierarquia, pivôs, materiais e animações de cada modelo', () => {
  for (const d of NEON_DEFS) {
    const f = `public/models/vehicles/${d.file}.glb`;
    assert.ok(existsSync(f), `${f} existe`);
    const j = readGlb(f);
    const byName = new Map(j.nodes.map((n, i) => [n.name, { ...n, i }]));
    const need = ['VehicleRoot', 'Body', 'Interior', 'Windows', 'Lights', 'Chassis', 'SteeringWheel', 'Hood', 'Plate_F', 'Plate_R',
      ...['FL', 'FR', 'RL', 'RR'].flatMap((w) => [`Wheel_${w}`, `Tire_${w}`, `Rim_${w}`]), 'Door_FL', 'Door_FR'];
    if (d.body.doorZ.length > 1) need.push('Door_RL', 'Door_RR');
    need.push(['notch', 'mid', 'roadster'].includes(d.body.rear) ? 'Trunk' : 'Tailgate');
    if (d.style.head === 'popup') need.push('Popup_L', 'Popup_R');
    for (const n of need) assert.ok(byName.has(n), `${d.name}: nó ${n}`);
    if (d.body.doorZ.length === 1) assert.ok(!byName.has('Door_RL'), `${d.name}: sem portas traseiras num duas-portas`);
    // Rodas no eixo (glTF = coordenadas do jogo).
    for (const [w, sx, sz] of [['FL', 1, 1], ['FR', -1, 1], ['RL', 1, -1], ['RR', -1, -1]]) {
      const t = byName.get(`Wheel_${w}`).translation;
      assert.ok(Math.abs(t[0] - sx * d.dims.track / 2) < 1e-3 && Math.abs(t[1] - d.dims.wheelRadius) < 1e-3 && Math.abs(t[2] - sz * d.dims.wheelBase / 2) < 1e-3, `${d.name}: roda ${w} no eixo`);
    }
    // Dobradiças das portas na borda dianteira; rotação de repouso nula.
    for (const [nm, k] of [['Door_FL', 0], ['Door_RL', 1]]) {
      const n = byName.get(nm);
      if (!n) continue;
      assert.ok(Math.abs(n.translation[2] - d.body.doorZ[k][0]) < 1e-3, `${d.name}: ${nm} com dobradiça em z ${d.body.doorZ[k][0]}`);
      assert.ok(!n.rotation || Math.abs(n.rotation[3]) > 0.9999, `${d.name}: ${nm} fechada no repouso`);
    }
    const mats = new Set(j.materials.map((m) => m.name));
    for (const m of ['Paint', 'Glass', 'Headlight', 'Taillight', 'Reverse', 'Chrome', 'Rubber', 'Rim', 'Interior', 'Seat', 'Plate']) assert.ok(mats.has(m), `${d.name}: material ${m}`);
    assert.ok(j.animations?.length >= 3, `${d.name}: animações de abertura`);
    assert.ok(!j.images?.length && !j.buffers.some((bf) => bf.uri), `${d.name}: sem dependências externas`);
    // Medida total pela malha da carroceria.
    const body = j.meshes[byName.get('Body').mesh];
    let minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
    for (const p of body.primitives) {
      const a = j.accessors[p.attributes.POSITION];
      minZ = Math.min(minZ, a.min[2]); maxZ = Math.max(maxZ, a.max[2]); maxY = Math.max(maxY, a.max[1]);
    }
    assert.ok(Math.abs((maxZ - minZ) - d.dims.length) / d.dims.length < 0.06, `${d.name}: comprimento da malha ${(maxZ - minZ).toFixed(2)} vs ${d.dims.length}`);
    assert.ok(Math.abs(maxY - d.dims.height) < 0.09, `${d.name}: altura da malha ${maxY.toFixed(2)} vs ${d.dims.height}`);
  }
});

test('balanceamento: populares < intermediários < esportivos (aceleração e velocidade) e nada igual aos superesportivos', () => {
  const by = [[], [], []];
  for (const d of NEON_DEFS) by[CAT[d.category]].push(d.handling);
  const accel = (h) => h.engineForce / h.mass;
  const maxOf = (l, f) => Math.max(...l.map(f)), minOf = (l, f) => Math.min(...l.map(f));
  assert.ok(maxOf(by[0], (h) => h.maxSpeed) < minOf(by[1], (h) => h.maxSpeed), 'velocidade: popular < intermediário');
  assert.ok(maxOf(by[1], (h) => h.maxSpeed) < minOf(by[2], (h) => h.maxSpeed), 'velocidade: intermediário < luxo');
  assert.ok(maxOf(by[0], accel) < minOf(by[2], accel) * 0.6, 'aceleração dos populares bem abaixo dos superesportivos');
  // Mesmo com tudo instalado no NEON CUSTOMS, um popular não alcança um superesportivo de fábrica.
  const full = { engine: 3, trans: 2, brakes: 2, susp: 2, tires: 'grip', armor: 0 };
  for (const p of NEON_DEFS.filter((d) => d.category === 'popular')) {
    const h = computeHandling(p.type, full).handling;
    assert.ok(h.maxSpeed < Math.min(...by[2].map((x) => x.maxSpeed)), `${p.name} preparado continua abaixo dos esportivos`);
  }
  // Coerente com os três carros existentes.
  assert.ok(SPECS.sedan.handling.maxSpeed > maxOf(by[0], (h) => h.maxSpeed), 'PALM SEDAN acima dos populares');
  assert.ok(SPECS.sports.handling.maxSpeed <= maxOf(by[2], (h) => h.maxSpeed), 'NEON GT na faixa dos esportivos');
});

test('integração: SPECS, NEON CUSTOMS por família e pesos do trânsito por zona', () => {
  for (const d of NEON_DEFS) {
    assert.ok(SPECS[d.type]?.neon, `${d.type} registrado em SPECS`);
    assert.deepEqual(SPECS[d.type].doors.map((x) => x.id), d.body.doorZ.length > 1 ? ['driver', 'passenger', 'rearLeft', 'rearRight'] : ['driver', 'passenger']);
    for (const cat of Object.keys(PARTS)) assert.equal(isCompatible(cat, PARTS[cat].options[0].id, d.type), true, `original de ${cat} em ${d.type}`);
  }
  assert.equal(isCompatible('spoiler', 'wing', 'neon_phantom'), true, 'asa alta: esportivos');
  assert.equal(isCompatible('spoiler', 'wing', 'palm_compact'), false, 'asa alta não serve num popular');
  assert.equal(isCompatible('ride', 'high', 'bay_city_100'), true, 'suspensão elevada: família sedã');
  const share = (zone, x, z) => {
    const w = trafficWeights(x, z);
    const tot = w.reduce((s, e) => s + e[1], 0);
    const cat = (c) => w.filter(([t]) => NEON_DEFS.find((d) => d.type === t)?.category === c).reduce((s, e) => s + e[1], 0) / tot;
    return { pop: cat('popular'), mid: cat('intermediario'), lux: cat('luxo') };
  };
  const res = share('residential', -30, 60), rich = share('rich', 10, -250);
  assert.equal(neonZoneAt(-30, 60), 'residential');
  assert.ok(res.pop > res.mid && res.mid > res.lux, 'residencial: populares > intermediários > esportivos');
  assert.ok(res.lux < 0.08, 'esportivos raros nas ruas residenciais');
  assert.ok(rich.lux > res.lux * 1.8, 'esportivos mais comuns no bairro nobre');
  assert.ok(TRAFFIC_BASE.some(([t]) => t === 'sedan') && TRAFFIC_BASE.some(([t]) => t === 'sports'), 'carros originais continuam no trânsito');
});
