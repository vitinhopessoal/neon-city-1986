import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TriangleCollisionSystem } from '../../src/physics/TriangleCollisionSystem.js';
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics.js';
import { extractProps, buildProps, classifyProp } from '../../src/maps/ViceProps.js';
import { BikeCrash } from '../../src/vehicles/BikeCrash.js';

const GROUND = 8;

/** Retângulo horizontal de COL (dois triângulos) em y. */
function quad(col, x0, x1, z0, z1, y) {
  col.addTriangle([x0, y, z0, x1, y, z1, x1, y, z0], 1);
  col.addTriangle([x0, y, z0, x0, y, z1, x1, y, z1], 1);
}

/** Caixa de COL como o conversor gera (12 triângulos). */
function colBox(col, min, max) {
  const v = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) v.push([x, y, z]);
  for (const f of [[0, 2, 3], [0, 3, 1], [4, 5, 7], [4, 7, 6], [0, 1, 5], [0, 5, 4], [2, 6, 7], [2, 7, 3], [0, 4, 6], [0, 6, 2], [1, 3, 7], [1, 7, 5]]) {
    col.addTriangle([...v[f[0]], ...v[f[1]], ...v[f[2]]], 5);
  }
}

/** Cena como a do GLB convertido: um grupo por setor e um nó por instância do IPL. */
function sectorScene(placements) {
  const root = new THREE.Group(), sector = new THREE.Group();
  root.add(sector);
  const material = new THREE.MeshBasicMaterial();
  const geometries = new Map();
  for (const { model, size, x, z } of placements) {
    if (!geometries.has(model)) {
      const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
      g.translate(0, size[1] / 2, 0); // origem no pé, como os modelos do jogo
      geometries.set(model, g);
    }
    const mesh = new THREE.Mesh(geometries.get(model), material);
    mesh.position.set(x, GROUND, z);
    mesh.userData = { vcModel: model, collide: false };
    sector.add(mesh);
  }
  return root;
}

function car(col, destruction, z, speed) {
  const v = { id: 'test-car', spec: { width: 1.8, length: 4, height: 1.5, wheelBase: 2.5, handling: { mass: 1300, inertiaScale: 1 } } };
  const physics = new VehiclePhysics(v, col, { destruction });
  physics.x = 0; physics.y = GROUND; physics.z = z; physics.vz = speed;
  return physics;
}

test('small street props are breakable, big trees and buildings stay static', () => {
  assert.equal(classifyProp('lamppost1', { x: 1.7, y: 6.8, z: 0.5 }), 'streetLamp');
  assert.equal(classifyProp('fire_hydrant', { x: 0.6, y: 1.2, z: 0.4 }), 'viceHydrant');
  assert.equal(classifyProp('parkbench1', { x: 1, y: 0.9, z: 2.8 }), 'viceBench');
  assert.equal(classifyProp('telgrphpole02', { x: 2, y: 12.6, z: 2 }), 'pole');
  assert.equal(classifyProp('veg_palmkb2', { x: 2.7, y: 4.1, z: 2.3 }), 'smallTree');
  assert.equal(classifyProp('veg_palmkb13', { x: 5.5, y: 8.8, z: 5.5 }), null, 'palmeira média já é árvore grande');
  assert.equal(classifyProp('veg_palm04', { x: 17, y: 41, z: 17 }), null);
  assert.equal(classifyProp('veg_palmbig14', { x: 16, y: 18, z: 17 }), null);
  assert.equal(classifyProp('od_hotel01', { x: 2, y: 3, z: 2 }), null, 'nome fora da lista nunca quebra');
  assert.equal(classifyProp('lamppost1', { x: 1.7, y: 30, z: 0.5 }), null, 'escala exagerada no IPL fica estática');
});

test('props leave the static scene, get their own COL and break under a fast car only', () => {
  const scene = sectorScene([
    { model: 'lamppost1', size: [0.4, 6.8, 0.4], x: 0, z: 0 },
    { model: 'od_building', size: [10, 12, 10], x: 30, z: 0 },
  ]);
  const instances = extractProps(scene);
  assert.equal(instances.length, 1);
  assert.equal(scene.children[0].children.length, 1, 'só o prédio continua para a fusão estática');
  const col = new TriangleCollisionSystem();
  quad(col, -40, 40, -40, 40, GROUND);
  colBox(col, [-0.2, GROUND, -0.2], [0.2, GROUND + 6.8, 0.2]);   // poste
  colBox(col, [25, GROUND, -5], [35, GROUND + 12, 5]);            // prédio
  const parent = new THREE.Group();
  const { destruction, stats } = buildProps(parent, col, instances);
  try {
    assert.equal(stats.instances, 1);
    assert.equal(stats.vehicleOnly, 0);
    const lamp = [...destruction.records.values()][0];
    // 12 faces da caixa menos as 2 da base (no nível do chão, irrelevantes para as rodas).
    assert.equal(lamp.colliders.length, 10, 'as faces do poste pertencem a ele');
    assert.equal(col.getGroundHeight(0.5, 0.5, GROUND, 0.4), GROUND, 'o chão em volta continua');
    // Devagar: o poste segura o carro como uma parede.
    const slow = car(col, destruction, -2.15, 2);
    slow._collide(1 / 120);
    assert.equal(lamp.broken, false);
    assert.ok(slow.contacts.length > 0);
    // Rápido: derruba o poste, perde um pouco de velocidade e segue.
    const fast = car(col, destruction, -2.15, 15);
    fast._collide(1 / 120);
    assert.equal(lamp.broken, true);
    assert.ok(fast.vz > 12 && fast.vz < 15, `perde só um pouco de velocidade (${fast.vz.toFixed(2)})`);
    for (const c of lamp.colliders) assert.equal(col.colliders.has(c.id), false);
    const hidden = new THREE.Matrix4(); lamp.bindings[0].mesh.getMatrixAt(lamp.bindings[0].index, hidden);
    assert.equal(hidden.elements[0], 0, 'instância escondida');
    // Destroços caem no chão do mapa (y = 8), não em y = 0.
    for (let i = 0; i < 400; i++) destruction.update(1 / 60);
    for (const f of destruction.fragments) assert.ok(f.mesh.position.y > GROUND - 0.01, `destroço apoiado no chão (${f.mesh.position.y.toFixed(2)})`);
    // O prédio nunca quebra.
    const wall = car(col, destruction, -6.9, 25); // frente encostando na fachada (z = -5)
    wall.x = 30;
    wall._collide(1 / 120);
    assert.ok(wall.contacts.some(c => !c.collider.destructible), 'prédio é parede');
    // Longe do jogador e depois do intervalo, o poste volta ao lugar.
    destruction.respawn = { delay: 1, distance: 50 };
    destruction.update(0.1, { x: 0, z: 0 });
    destruction.update(2, { x: 0, z: 0 });
    assert.equal(lamp.broken, true, 'perto do jogador não reaparece');
    destruction._respawnTimer = 0;
    destruction.update(0.1, { x: 500, z: 500 });
    assert.equal(lamp.broken, false);
    assert.ok(lamp.colliders.every(c => col.colliders.has(c.id) && c.solid));
  } finally { destruction.dispose(); }
});

test('a prop without its own COL is hit by vehicles but stays walk-through', () => {
  const scene = sectorScene([{ model: 'new_bushsm', size: [2, 2, 2], x: 0, z: 0 }]);
  const col = new TriangleCollisionSystem();
  quad(col, -20, 20, -20, 20, GROUND);
  const { destruction, stats } = buildProps(new THREE.Group(), col, extractProps(scene));
  try {
    assert.equal(stats.vehicleOnly, 1);
    const pos = { x: 0.9, z: 0 };
    col.resolveCircle(pos, GROUND, 0.4, 1.8, 0.36);
    assert.equal(pos.x, 0.9, 'a pé atravessa o arbusto como antes');
    const slow = car(col, destruction, -2.6, 0.3);
    slow._collide(1 / 120);
    assert.equal(slow.contacts.length, 0, 'nunca vira parede para o carro');
    const fast = car(col, destruction, -2.6, 6);
    fast._collide(1 / 120);
    assert.equal([...destruction.records.values()][0].broken, true);
  } finally { destruction.dispose(); }
});

test('bike crash: the rider flies, never passes through a wall, lies down and gets up', () => {
  const col = new TriangleCollisionSystem();
  quad(col, -50, 50, -50, 50, GROUND);
  colBox(col, [-10, GROUND, 6], [10, GROUND + 8, 7]); // parede à frente
  const crash = new BikeCrash(col, { hip: new THREE.Vector3(0, GROUND + 0.95, 4.5), velocity: { x: 0, z: 20 }, normal: { x: 0, z: -1 }, yaw: 0 });
  const phases = new Set();
  let maxZ = -Infinity, maxY = -Infinity, t = 0;
  while (!crash.done && t < 12) {
    crash.update(1 / 60); t += 1 / 60;
    phases.add(crash.phase);
    maxZ = Math.max(maxZ, crash.hip.z); maxY = Math.max(maxY, crash.hip.y);
    assert.ok(crash.hip.y >= GROUND + 0.16, 'nunca abaixo do chão');
    const root = crash.rootPosition(new THREE.Vector3());
    assert.ok([root.x, root.y, root.z].every(Number.isFinite));
  }
  assert.ok(crash.done, `levantou (${t.toFixed(1)} s)`);
  assert.ok(t < 8, 'a queda não demora demais');
  assert.deepEqual([...phases], ['fly', 'lie', 'getup']);
  assert.ok(maxZ < 6, `não atravessa a parede (z máx ${maxZ.toFixed(2)})`);
  assert.ok(maxY > GROUND + 1.4, 'é arremessado para cima');
  const stand = crash.standPoint();
  assert.equal(stand.y, GROUND);
  assert.ok(Math.abs(crash.pitch) < 1e-6, 'termina em pé');
});

test('bike crash in the open: the rider is thrown forward and slides to a stop', () => {
  const col = new TriangleCollisionSystem();
  quad(col, -80, 80, -80, 80, GROUND);
  const crash = new BikeCrash(col, { hip: new THREE.Vector3(0, GROUND + 0.95, 0), velocity: { x: 0, z: 18 }, yaw: 0 });
  let lying = null;
  for (let i = 0; i < 600 && !crash.done; i++) {
    crash.update(1 / 60);
    if (crash.phase === 'lie' && lying === null) lying = crash.pitch;
  }
  assert.ok(crash.hip.z > 5, `voou para a frente (${crash.hip.z.toFixed(1)} m)`);
  assert.ok(Math.abs(Math.abs(lying) - Math.PI / 2) < 1e-6, 'fica deitado de bruços ou de costas');
  assert.ok(crash.done);
});
