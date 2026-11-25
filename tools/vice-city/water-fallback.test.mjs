import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TriangleCollisionSystem } from '../../src/physics/TriangleCollisionSystem.js';
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics.js';
import { VehicleFactory } from '../../src/vehicles/VehicleFactory.js';

const WATER = 6;

/** Retângulo horizontal de COL (dois triângulos) em y. */
function quad(col, x0, x1, z0, z1, y) {
  col.addTriangle([x0, y, z0, x1, y, z1, x1, y, z0], 1);
  col.addTriangle([x0, y, z0, x0, y, z1, x1, y, z1], 1);
}

/** Mesmo cálculo de profundidade do TriangleMap. */
function waterEnv(col) {
  return {
    waterLevel: WATER,
    getSurface: () => 'asphalt',
    waterDepth(x, z, referenceY) {
      const ground = col.getGroundHeight(x, z, WATER, 0);
      const near = col.getGroundHeight(x, z, referenceY, 0.4);
      return near >= WATER ? 0 : Math.max(0, WATER - ground);
    },
  };
}

test('open sea without COL becomes seabed instead of the y = -100 void', () => {
  const col = new TriangleCollisionSystem();
  quad(col, -40, 0, -20, 20, 8); // cais; o mar (x > 0) não tem nenhuma face
  assert.equal(col.getGroundHeight(30, 0, 8, 0.4), -100, 'sem preenchimento era o limbo');
  const info = col.buildFallback({ bounds: { minX: -40, maxX: 60, minZ: -20, maxZ: 20 }, waterLevel: WATER });
  assert.ok(info.seaCells > 0);
  assert.equal(col.getGroundHeight(30, 0, 8, 0.4), WATER - 6);
  assert.equal(col.getGroundHeight(-10, 0, 8, 0.4), 8, 'faces reais continuam valendo');
  assert.equal(col.getGroundHeight(500, 500, 8, 0.4), WATER - 6, 'fora da grade também é mar');
});

test('a gap inside land takes the lowest dry border height, never a roof or a tunnel', () => {
  const col = new TriangleCollisionSystem();
  // Rua em y = 9 com um buraco de 8 × 8 m no meio; um telhado alto e um túnel fundo encostados.
  quad(col, -40, -4, -40, 40, 9); quad(col, 4, 40, -40, 40, 9);
  quad(col, -4, 4, -40, -4, 9); quad(col, -4, 4, 8, 40, 9);
  quad(col, -4, 4, 4, 8, 25);   // só telhado (prédio sem piso na COL)
  quad(col, -4, 4, -4, -3, -20); // faixa de túnel lá embaixo
  col.buildFallback({ bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }, waterLevel: WATER });
  assert.equal(col.getGroundHeight(0, 1, 9, 0.4), 9);
});

test('radar water mask wins over connectivity (bays closed off by bridges)', () => {
  const col = new TriangleCollisionSystem();
  // Baía fechada por todos os lados: sem radar seria falha em terra.
  quad(col, -60, -20, -60, 60, 9); quad(col, 20, 60, -60, 60, 9);
  quad(col, -20, 20, -60, -20, 9); quad(col, -20, 20, 20, 60, 9);
  const bounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };
  col.buildFallback({ bounds, waterLevel: WATER, isWater: (x, z) => Math.abs(x) < 20 && Math.abs(z) < 20 });
  assert.equal(col.getGroundHeight(0, 0, 9, 0.4), WATER - 6);
});

test('a lone high structure does not pull bodies up from below', () => {
  const col = new TriangleCollisionSystem();
  quad(col, -10, 10, -10, 10, 300);
  col.buildFallback({ bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, waterLevel: WATER, isWater: () => false });
  assert.equal(col.getGroundHeight(0, 0, 7, 0.4), WATER - 6);
  assert.equal(col.getGroundHeight(0, 0, 300, 0.4), 300);
});

test('a car driven off a quay sinks to the seabed and cannot drive in deep water', () => {
  const col = new TriangleCollisionSystem();
  quad(col, -60, 0, -20, 20, 8);
  col.buildFallback({ bounds: { minX: -60, maxX: 80, minZ: -20, maxZ: 20 }, waterLevel: WATER });
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({ measureText: () => ({ width: 20 }) }, { get: (o, k) => o[k] || (() => {}) }) }) };
  try {
    const material = new THREE.MeshBasicMaterial();
    const factory = new VehicleFactory({ m: new Proxy({}, { get: () => material }) });
    const car = factory.create('sedan', { id: 'water-test-car', color: 0xffffff });
    car.setPose(-30, 8, 0, Math.PI / 2); car.attachCollider(col);
    const physics = new VehiclePhysics(car, col, waterEnv(col)); car.physics = physics; physics.syncFromRoot();
    car.engineOn = true; car.controls.throttle = 1; car.controls.brake = 0; car.controls.handbrake = false;
    physics.wake();
    let enteredAt = null, lowest = Infinity;
    for (let i = 0; i < 60 * 20; i++) {
      physics.update(1 / 60);
      assert.ok([physics.x, physics.y, physics.z].every(Number.isFinite));
      lowest = Math.min(lowest, physics.y);
      if (enteredAt === null && physics.inWater) enteredAt = i / 60;
    }
    assert.ok(enteredAt !== null, 'o carro precisa chegar ao mar');
    assert.ok(lowest >= WATER - 6 - 1e-6, `nunca abaixo do fundo do mar (mínimo ${lowest})`);
    assert.ok(Math.abs(physics.y - (WATER - 6)) < 1e-6, 'termina apoiado no fundo');
    assert.ok(physics.speed < 0.1, 'acelerando no fundo do mar não anda');
    assert.equal(physics.waterImmersion, 1);
    const x = physics.x;
    car.controls.throttle = -1;
    for (let i = 0; i < 120; i++) physics.update(1 / 60);
    assert.ok(Math.abs(physics.x - x) < 0.05, 'nem de ré');
    factory.dispose(car); material.dispose();
  } finally { globalThis.document = oldDocument; }
});
