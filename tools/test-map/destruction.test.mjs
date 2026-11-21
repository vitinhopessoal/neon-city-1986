import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DestructionSystem } from '../../src/world/DestructionSystem.js';
import { PropGenerator } from '../../src/world/PropGenerator.js';
import { CollisionSystem } from '../../src/physics/CollisionSystem.js';
import { WeaponBallistics } from '../../src/weapons/WeaponBallistics.js';
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics.js';
import { TrafficSignalController } from '../../src/world/TrafficSignals.js';

function fixture(placements, options = {}) {
  const parent = new THREE.Group(), collision = new CollisionSystem();
  const system = new DestructionSystem(parent, collision, { random: () => 0.6, ...options });
  const materials = new Map();
  const material = key => {
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color: typeof key === 'number' ? key : 0xffffff, vertexColors: key === 'fabric' }));
    return materials.get(key);
  };
  const lib = { m: new Proxy({}, { get: (_, name) => material(name) }), solid: material, neon: material };
  const props = new PropGenerator(lib, parent, collision, {}, system);
  for (const [type, x = 0, z = 0, scale = 1] of placements) props.place(type, x, 0.15, z, 0, scale);
  props.build();
  const ballistics = new WeaponBallistics({ player: { controller: { collision } }, mapEnv: { getSurface: () => 'concrete' } });
  return { parent, collision, system, props, lib, ballistics, dispose() {
    system.dispose();
    for (const parts of Object.values(props.types)) {
      for (const part of parts) part.geometry.dispose();
      for (const part of parts.fragments) part.geometry.dispose();
    }
    for (const m of materials.values()) m.dispose();
  } };
}

function vehicle(f, speed) {
  const v = { id: 'test-car', spec: { width: 1.8, length: 4, height: 1.5, wheelBase: 2.5, handling: { mass: 1200, inertiaScale: 1 } } };
  const physics = new VehiclePhysics(v, f.collision, { destruction: f.system });
  physics.z = -2.15; physics.vz = speed;
  return physics;
}

test('shots accumulate damage, animate only the struck instance and clear its colliders', () => {
  const f = fixture([['bench'], ['bench', 8]]);
  try {
    const hit = f.ballistics.cast(new THREE.Vector3(0, 0.9, -8), new THREE.Vector3(0, 0, 1), 20);
    assert.ok(hit.hit, 'bench backrest must be shootable above the walkable seat');
    assert.equal(hit.material, 'wood');
    const record = f.system.records.get('bench_0');
    assert.equal(hit.collider.destructible, record);
    const other = f.system.records.get('bench_1');
    const original = new THREE.Matrix4(); other.bindings[0].mesh.getMatrixAt(other.bindings[0].index, original);
    f.system.damageCollider(hit.collider, { damage: 34, direction: { x: 0, z: 1 } });
    assert.equal(record.hp, 6); assert.equal(record.broken, false);
    f.system.update(0.05);
    f.system.damageCollider(hit.collider, { damage: 34, direction: { x: 0, z: 1 } });
    assert.equal(record.broken, true);
    assert.ok(f.system.fragments.length >= 5, 'actual bench boards detach');
    for (const c of record.colliders) assert.equal(f.collision.colliders.has(c.id), false);
    const hidden = new THREE.Matrix4(); record.bindings[0].mesh.getMatrixAt(record.bindings[0].index, hidden);
    assert.equal(hidden.elements[0], 0);
    const untouched = new THREE.Matrix4(); other.bindings[0].mesh.getMatrixAt(other.bindings[0].index, untouched);
    assert.deepEqual(untouched.elements, original.elements);
    assert.equal(other.hp, other.profile.hp);
    assert.equal(f.ballistics.cast(new THREE.Vector3(0, 0.9, -8), new THREE.Vector3(0, 0, 1), 20).hit, false);
  } finally { f.dispose(); }
});

test('fast vehicles break a lamp before the static collision impulse', () => {
  const f = fixture([['lamp']]);
  try {
    const physics = vehicle(f, 8);
    physics._collide(1 / 120);
    assert.equal(f.system.records.get('lamp_0').broken, true);
    assert.equal(physics.z, -2.15, 'no push out of the destroyed pole');
    assert.ok(physics.vz > 7, 'car continues through instead of bouncing');
    assert.equal(physics.contacts.length, 0);
    const fragment = f.system.fragments[0];
    const initialRotation = fragment.mesh.quaternion.clone();
    f.system.update(0.1);
    assert.ok(initialRotation.angleTo(fragment.mesh.quaternion) > 0.05, 'broken pole pieces visibly tumble');
  } finally { f.dispose(); }
});

test('low speed and tangential contacts keep props solid', () => {
  for (const tangential of [false, true]) {
    const f = fixture([['lamp']]);
    try {
      const physics = vehicle(f, tangential ? 0 : 2);
      if (tangential) physics.vx = 9;
      physics._collide(1 / 120);
      assert.equal(f.system.records.get('lamp_0').broken, false);
      assert.ok(physics.contacts.length > 0);
    } finally { f.dispose(); }
  }
});

test('thick tree colliders keep blocking vehicles and cannot take prop damage', () => {
  const f = fixture([]);
  try {
    const tree = f.collision.addCylinder({ id: 'thick-tree', x: 0, z: 0, radius: 0.4, minY: 0, maxY: 5, walkable: false, tags: ['tree', 'unbreakable'] });
    assert.equal(f.system.damageCollider(tree, { damage: 9999 }), false);
    const physics = vehicle(f, 12);
    physics._collide(1 / 120);
    assert.equal(tree.solid, true);
    assert.ok(physics.contacts.length > 0);
    assert.ok(physics.z < -2.15);
    assert.equal(f.system.brokenCount, 0);
  } finally { f.dispose(); }
});

test('hydrant spray, flying fragments and their cleanup remain finite and bounded', () => {
  const f = fixture([['hydrant']]);
  try {
    const record = f.system.records.get('hydrant_0');
    let breaks = 0; f.system.onBreak = () => breaks++;
    f.system.damageCollider(record.colliders[0], { damage: 1000, direction: { x: 1, z: 0 }, force: 5 });
    f.system.damageCollider(record.colliders[0], { damage: 1000 });
    assert.equal(breaks, 1);
    assert.equal(f.system.jets.length, 1);
    const initial = f.system.fragments[0].mesh.position.clone();
    for (let i = 0; i < 60; i++) f.system.update(1 / 60);
    assert.ok(initial.distanceTo(f.system.fragments[0].mesh.position) > 0.2);
    const positions = f.system.jets[0].mesh.geometry.attributes.position;
    assert.ok(Array.from(positions.array).every(Number.isFinite));
    assert.ok(Array.from({ length: positions.count }, (_, i) => positions.getY(i)).some(y => y > 2));
    for (let i = 0; i < 900; i++) f.system.update(1 / 60);
    assert.equal(f.system.jets.length, 0);
    assert.equal(f.system.fragments.length, 0);
    assert.equal(record.broken, true, 'cleanup must not respawn intact props');
  } finally { f.dispose(); }
});

test('fragment budget, secondary light pools and map visibility stay consistent', () => {
  const f = fixture([['lamp'], ['bench', 8], ['stall', 16]], { maxFragments: 8 });
  try {
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), f.lib.m.lightPool, 1);
    pool.setMatrixAt(0, new THREE.Matrix4());
    f.system.addBinding('lamp_0', pool, 0);
    for (const record of f.system.records.values()) f.system.damageCollider(record.colliders[0], { damage: 999 });
    assert.equal(f.system.fragments.length, 8);
    const m = new THREE.Matrix4(); pool.getMatrixAt(0, m);
    assert.equal(m.elements[0], 0, 'fallen lamp no longer lights the ground');
    f.parent.visible = false;
    f.system.update(1);
    assert.equal(f.system.fragments[0].age, 0);
    f.parent.visible = true; f.system.update(0.1);
    assert.ok(f.system.fragments[0].age > 0);
    assert.equal(f.system.brokenCount, 3);
    pool.geometry.dispose();
  } finally { f.dispose(); }
});

test('destroyed signal turns the intersection into an all-way stop', () => {
  const f = fixture([]);
  try {
    const signal = new TrafficSignalController('test-intersection', f.lib, f.parent, f.collision, f.system);
    const object = signal.addPole({ x: 0, z: 0 });
    const record = [...f.system.records.values()][0];
    assert.equal(signal.getState('ns'), 'green');
    f.system.damageCollider(record.colliders[0], { damage: 200 });
    assert.equal(object.visible, false);
    assert.equal(signal.getState('ns'), 'stop');
    assert.equal(signal.getState('ew'), 'stop');
    signal.update(60);
    assert.equal(signal.timeInState('ns'), 0);
    assert.ok(f.system.fragments.length > 3);
  } finally { f.dispose(); }
});

test('stalls, parasols and telephone booths detach original construction pieces', () => {
  const f = fixture([['stall'], ['umbrellaTeal', 8]]);
  try {
    f.props.phoneBooth({ add() { throw new Error('booth cannot remain in static batch'); } }, 16, 0.15, 0, 0);
    for (const record of f.system.records.values()) {
      assert.ok(record.fragments.length >= 3, record.type);
      f.system.damageCollider(record.colliders[0], { damage: 999, direction: { x: 0, z: 1 } });
      assert.ok(record.colliders.every(c => !c.solid));
    }
    for (let i = 0; i < 180; i++) f.system.update(1 / 60);
    for (const f2 of f.system.fragments) {
      assert.ok(f2.mesh.position.toArray().every(Number.isFinite));
      assert.ok(f2.mesh.quaternion.toArray().every(Number.isFinite));
      assert.ok(f2.mesh.position.y >= 0);
    }
  } finally { f.dispose(); }
});

test('plants resting inside a planter break with it and do not remain suspended', () => {
  const f = fixture([['planter']]);
  try {
    // Plant-on-pot placement used by the city decorator.
    f.props.place('bush', 0, 0.7, 0);
    // Build only the newly added type to preserve stable instance registration.
    f.props.placements.delete('planter');
    f.props.build();
    const planter = f.system.records.get('planter_0');
    const bush = f.system.records.get('bush_0');
    f.system.damageCollider(planter.colliders[0], { damage: 100 });
    assert.equal(bush.broken, true);
    assert.equal(bush.hp, 0);
    assert.equal(f.system.brokenCount, 2);
  } finally { f.dispose(); }
});
