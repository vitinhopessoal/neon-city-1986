import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../../src/world/World.js';
import { createCoastalCity } from '../../src/world/districts/CoastalCity.js';

// Execute actual city generation without a browser or a graphics context.
// Canvas drawing is stubbed; generated geometry, registries and colliders are real.
function testCanvas() {
  const canvas = { width: 1, height: 1 };
  const gradient = { addColorStop() {} };
  const methods = {
    canvas,
    measureText: text => ({ width: String(text).length * 12 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  const ctx = new Proxy(methods, { get: (o, key) => key in o ? o[key] : () => {} });
  canvas.getContext = () => ctx;
  return canvas;
}

test('complete coastal city registers destructibles, shared pools and protected trees', () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => testCanvas() };
  let world;
  try {
    const scene = new THREE.Scene();
    world = new World({ scene, renderer: {}, quality: { pointLights: false, decorDensity: 1, ambient: true } });
    world.loadDistrict(createCoastalCity());
    const system = world.destruction;
    assert.ok(system.records.size > 100);
    const types = new Set([...system.records.values()].map(r => r.type));
    for (const type of ['lamp', 'hydrant', 'bench', 'stall', 'streetSign', 'trafficSign', 'signal', 'phoneBooth']) assert.ok(types.has(type), type);
    assert.equal([...system.records.values()].filter(r => r.type === 'stall').length, 2);
    assert.ok([...world.collision.colliders.values()].some(c => c.tags?.includes('unbreakable')));
    assert.ok([...world.collision.colliders.values()].filter(c => c.tags?.includes('tree')).every(c => !c.destructible));
    const lamp = [...system.records.values()].find(r => r.type === 'lamp');
    assert.ok(lamp.bindings.some(b => b.secondary), 'ground light belongs to the lamp');
    const rootsBefore = system.root.children.length;
    for (const r of [...system.records.values()].filter(r => ['lamp', 'hydrant', 'bench', 'stall'].includes(r.type)).slice(0, 40)) {
      system.damageCollider(r.colliders[0], { damage: 10000, direction: { x: 1, z: 0.2 } });
    }
    assert.ok(system.root.children.length > rootsBefore);
    assert.ok(system.fragments.length <= 180);
    for (let i = 0; i < 180; i++) system.update(1 / 60);
    for (const f of system.fragments) assert.ok(f.mesh.position.toArray().every(Number.isFinite));
    const nextLamp = [...system.records.values()].find(r => r.type === 'lamp' && !r.broken);
    assert.ok(nextLamp, 'unstruck objects survive the mass-break test');
  } finally {
    world?.destruction.dispose();
    world?.lib.dispose();
    globalThis.document = previous;
  }
});
