import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WaterSurface, MESH } from '../../src/water/WaterSurface.js';
import { BoatPhysics } from '../../src/boats/BoatPhysics.js';
import { BOATS, SHOP_ORDER, boatRecord } from '../../src/boats/BoatDefinitions.js';
import { CollisionSystem } from '../../src/physics/CollisionSystem.js';
import { ROUTES } from '../../src/maritime/MaritimeTraffic.js';
import { ISLANDS } from '../../src/maritime/MaritimeLocations.js';
import { validateSave } from '../../src/save/SaveSchema.js';

/** Altura de um ponto pela triangulação REAL do PlaneGeometry do oceano (mesma do world/Ocean.js). */
function meshHeight(S, x, z) {
  const geo = new THREE.PlaneGeometry(620, 1100, MESH.nx, MESH.nz);
  geo.rotateX(-Math.PI / 2);
  geo.translate(78 + 310, 0, 0);
  const pos = geo.attributes.position, idx = geo.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), bary = new THREE.Vector3();
  const tri = new THREE.Triangle();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); c.fromBufferAttribute(pos, idx.getX(i + 2));
    const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x), minZ = Math.min(a.z, b.z, c.z), maxZ = Math.max(a.z, b.z, c.z);
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
    tri.set(new THREE.Vector3(a.x, 0, a.z), new THREE.Vector3(b.x, 0, b.z), new THREE.Vector3(c.x, 0, c.z));
    tri.getBarycoord(new THREE.Vector3(x, 0, z), bary);
    if (bary.x < -1e-6 || bary.y < -1e-6 || bary.z < -1e-6) continue;
    return bary.x * S.raw(a.x, a.z) + bary.y * S.raw(b.x, b.z) + bary.z * S.raw(c.x, c.z);
  }
  return S.level;
}

test('água: a altura da física coincide com a superfície desenhada pela malha do oceano', () => {
  const S = new WaterSurface();
  S.time = 12.3;
  let worst = 0;
  for (const [x, z] of [[150, -120], [203.7, -61.2], [312.4, 99.9], [455, -251.3], [120.1, 10.5], [597, 160]]) {
    worst = Math.max(worst, Math.abs(S.height(x, z) - meshHeight(S, x, z)));
  }
  assert.ok(worst < 1e-4, `diferença máxima ${worst}`);
  assert.equal(S.height(5000, 0), S.level, 'mar distante é plano (anel sem ondas)');
  S.amp = 0;
  assert.equal(S.height(300, 0), S.level, 'uWaveAmp = 0 zera as ondas');
});

test('ilhas: relevo único (seco no centro, praia, encosta submersa) e rotas da IA com folga sob a quilha', () => {
  const S = new WaterSurface();
  for (const d of ISLANDS) S.addIsland({ x: d.x, z: d.z, r: d.r, top: d.top });
  for (const d of ISLANDS) {
    assert.ok(S.depth(d.x, d.z) < 0, `${d.name}: centro seco`);
    assert.ok(S.depth(d.x + d.r + 20, d.z) > 2, `${d.name}: águas fundas ao redor`);
  }
  for (const [id, r] of Object.entries(ROUTES)) {
    for (let i = 0; i < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[(i + 1) % r.pts.length];
      for (let t = 0; t <= 1; t += 0.02) {
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        assert.ok(S.depth(x, z) > BOATS[r.type].draft + 0.5, `rota ${id} raspa o fundo em ${x.toFixed(0)},${z.toFixed(0)}`);
      }
    }
  }
});

function boatOn(type, S, col = new CollisionSystem()) {
  const boat = { id: `t_${type}`, spec: BOATS[type] };
  const P = new BoatPhysics(boat, col, S);
  P.place(250, -150, Math.PI / 2);
  return P;
}

test('física: flutua sem afundar nem voar, acelera, freia, faz ré e vira em todos os modelos', () => {
  const S = new WaterSurface();
  for (const type of SHOP_ORDER) {
    const P = boatOn(type, S);
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < 300; i++) { S.time += 1 / 60; P.update(1 / 60); const r = P.y - S.height(P.x, P.z); low = Math.min(low, r); high = Math.max(high, r); }
    assert.ok(low > -P.spec.draft && high < 0.6, `${type}: linha d'água estável (${low.toFixed(2)}..${high.toFixed(2)})`);
    P.input.throttle = 1;
    for (let i = 0; i < 600; i++) { S.time += 1 / 60; P.update(1 / 60); }
    const top = P.forwardSpeed;
    assert.ok(top > P.spec.maxSpeed * 0.75 && top < P.spec.maxSpeed * 1.1, `${type}: velocidade ${top.toFixed(1)} m/s`);
    P.input.throttle = -1;
    for (let i = 0; i < 60; i++) P.update(1 / 60);
    assert.ok(P.forwardSpeed < top - 3, `${type}: freia com a ré`);
    for (let i = 0; i < 400; i++) P.update(1 / 60);
    assert.ok(P.forwardSpeed < -0.5, `${type}: anda de ré`);
    P.place(250, -150, Math.PI / 2); // parado: com o barco de ré o leme inverte (como no mundo real)
    P.input.throttle = 0.7; P.input.steer = 1;
    const h0 = P.heading;
    for (let i = 0; i < 180; i++) P.update(1 / 60);
    assert.ok(P.heading - h0 > 0.4, `${type}: vira para a esquerda com A`);
  }
});

test('física: bate em obstáculo sólido (para, gera impacto) e encalha em terra firme', () => {
  const S = new WaterSurface();
  const col = new CollisionSystem();
  col.addAABB({ id: 'pier', minX: 300, maxX: 304, minZ: -170, maxZ: -130, minY: -3, maxY: 1 });
  const P = boatOn('speedster', S, col);
  let imp = 0;
  P.onImpact = (v) => { imp = Math.max(imp, v); };
  P.input.throttle = 1;
  let maxX = -Infinity;
  for (let i = 0; i < 480; i++) {
    P.update(1 / 60);
    // Quinas reais do casco (o barco pode girar e escorregar na parede depois do impacto).
    const s = Math.sin(P.heading), c = Math.cos(P.heading), hx = P.spec.width / 2, hz = P.spec.length / 2;
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) maxX = Math.max(maxX, P.x + a * hx * c + b * hz * s);
  }
  assert.ok(maxX <= 300.15, `casco não atravessa a parede (quina máx. x ${maxX.toFixed(2)})`);
  assert.ok(imp > 5, `impacto registrado (${imp.toFixed(1)} m/s)`);
  // Terra firme: ilha à frente.
  const S2 = new WaterSurface();
  S2.addIsland({ x: 320, z: -150, r: 20, top: 0.6 });
  const Q = boatOn('jetski', S2);
  Q.input.throttle = 1;
  for (let i = 0; i < 600; i++) Q.update(1 / 60);
  assert.ok(S2.depth(Q.x + Q.spec.length / 2, Q.z) > 0, 'jet ski para na praia sem subir em terra seca');
});

test('save: seção de barcos validada (duplicados, tipos desconhecidos, posição) e opcional para saves antigos', () => {
  const base = {
    saveVersion: 1, gameId: 'g1', savedAt: new Date().toISOString(), label: '', map: 'sunset-beach', location: '', playTime: 10,
    player: { x: 0, y: 0, z: 0, yaw: 0, health: 100, inside: null }, time: { minutes: 600, preset: 'morning' },
    economy: { money: 100, history: [] }, inventory: {}, properties: { owned: [] }, garages: {}, vehicles: { world: [] }, interiors: null, missions: {}, prefs: {},
  };
  const refs = { boats: new Set(Object.keys(BOATS)) };
  const ok = structuredClone(base);
  ok.boats = { owned: [boatRecord('speedster', 'b1'), { ...boatRecord('fisher', 'b2'), location: 'world', x: 180, z: -90, heading: 1 }], aboard: 'b2' };
  const v = validateSave(ok, refs);
  assert.deepEqual(v.errors.filter((e) => /barco/.test(e)), []);
  const dup = structuredClone(ok); dup.boats.owned.push(boatRecord('speedster', 'b1'));
  assert.ok(validateSave(dup, refs).errors.some((e) => /duplicado/.test(e)));
  const pos = structuredClone(ok); delete pos.boats.owned[1].x;
  assert.ok(validateSave(pos, refs).errors.some((e) => /posição de barco/.test(e)));
  const unk = structuredClone(ok); unk.boats.owned.push({ pid: 'x', type: 'submarino', name: 'X', hp: 1, location: 'storage' });
  assert.ok(validateSave(unk, refs).warnings.some((w) => /desconhecido/.test(w)));
  assert.ok(!validateSave(base, refs).errors.some((e) => /barco/.test(e)), 'save sem a seção de barcos continua aceito');
});
