import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CitizenBrain } from '../../src/city/CitizenBrain.js';
import { PED_STATS } from '../../src/city/data/PedStats.js';
import { parsePedStats } from './import-pedstats.mjs';
import { sidewalkPath, laneRoute } from '../../src/city/Navigation.js';
import { VehicleOccupants } from '../../src/traffic/VehicleOccupants.js';
import { CollisionSystem } from '../../src/physics/CollisionSystem.js';
import { SPECS } from '../../src/vehicles/VehicleFactory.js';

test('forty supplied profiles are data, with validated import fields', () => {
  assert.equal(Object.keys(PED_STATS).length, 40);
  assert.equal(PED_STATS.STAT_TOURIST.fear, 100);
  assert.equal(PED_STATS.STAT_TAXIDRIVER.temper, 80);
  const row = 'STAT_STREET_GUY 17 7.5 45 30 30 60 1 1 6';
  assert.deepEqual(parsePedStats(row).STAT_STREET_GUY, PED_STATS.STAT_STREET_GUY);
  assert.throws(() => parsePedStats('STAT_BAD 1 2 nope'));
});

test('fear varies by profile and sensory range; concealed aiming is not perceived', () => {
  const brave = new CitizenBrain({ profile: 'STAT_FIREMAN', random: () => 0.5 });
  const tourist = new CitizenBrain({ profile: 'STAT_TOURIST', random: () => 0.5 });
  const event = { type: 'gunshot', x: 0, z: 0 };
  brave.perceive(event, { distance: 25 }); tourist.perceive(event, { distance: 25 });
  assert.ok(tourist.fear > brave.fear);
  assert.equal(tourist.goal, 'flee'); assert.equal(brave.goal, 'watch');
  assert.equal(brave.perceive({ type: 'weaponAim', x: 0, z: 0 }, { distance: 5, visible: false }), false);
  assert.equal(brave.perceive(event, { distance: 200 }), false);
});

test('memory prevents duplicate threats, is bounded and expires as fear recovers', () => {
  const brain = new CitizenBrain({ random: () => 0.5 });
  brain.perceive({ type: 'gunshot', x: 1, z: 2 });
  const fear = brain.fear;
  assert.equal(brain.perceive({ type: 'gunshot', x: 1, z: 2 }), false);
  assert.equal(brain.fear, fear);
  for (let i = 0; i < 20; i++) { brain.update(1); brain.perceive({ type: 'horn', id: String(i), x: i, z: 0 }); }
  assert.ok(brain.memory.length <= 8);
  brain.update(40);
  assert.equal(brain.memory.length, 0); assert.equal(brain.fear, 0); assert.equal(brain.goal, 'walk');
});

test('motives choose rest and social contact; routes never jump disconnected components', () => {
  const brain = new CitizenBrain({ random: () => 0.9 });
  brain.fatigue = 0.8;
  assert.equal(brain.chooseActivity({ canRest: true }), 'rest');
  brain.update(11); brain.fatigue = 0; brain.social = 1;
  assert.equal(brain.chooseActivity({ canChat: true }), 'chat');
  const nodes = [{ links: [{ to: 1 }] }, { links: [{ to: 0 }, { to: 2 }] }, { links: [{ to: 1 }] }, { links: [] }];
  assert.deepEqual(sidewalkPath(nodes, 0, 2), [0, 1, 2]);
  assert.equal(sidewalkPath(nodes, 0, 3), null);
  const a = { out: [] }, b = { out: [] }, c = { out: [] };
  const ab = { from: a, to: b }, bc = { from: b, to: c }; a.out.push(ab); b.out.push(bc);
  assert.deepEqual(laneRoute(a, c), [ab, bc]); assert.equal(laneRoute(c, a), null);
});

function occupantsFixture() {
  const collision = new CollisionSystem();
  const nodes = [0, 4, 8].map((z, i) => ({ i, x: 3, y: 0, z, links: [] }));
  nodes[0].links = [{ to: 1 }]; nodes[1].links = [{ to: 0 }, { to: 2 }]; nodes[2].links = [{ to: 1 }];
  const game = { scene: new THREE.Scene(), player: { visualPosition: new THREE.Vector3() }, mapLoading: false, city: {
    peds: { nodes, _nearest: (x, z) => [...nodes].sort((a, b) => Math.hypot(x - a.x, z - a.z) - Math.hypot(x - b.x, z - b.z))[0],
      _route: start => start === 0 ? [0, 1, 2] : start === 2 ? [2, 1, 0] : [1, 2], _canCross: () => true },
    traffic: { net: { roadAt: () => null } },
  } };
  const people = new VehicleOccupants(game, 6);
  people.onMapActivated({ collision, waterDepth: () => 0, boundaryHint: () => null });
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body); game.scene.add(root);
  const v = { root, body, seats: [SPECS.sports.seats[0]], driver: 'ai', controls: { steer: 0 }, doors: [
    { id: 'driver', seat: 'driver', entry: new THREE.Vector3(1.6, 0, 0), target: 0 },
  ], localToWorld(local, out) { root.updateMatrixWorld(true); return out.copy(local).applyMatrix4(root.matrixWorld); } };
  collision.addBox({ id: 'test-car', ownerId: 'test-car', cx: 0, cz: 0, hx: 0.93, hz: 2.2, minY: 0, maxY: 1.3, walkable: false });
  const a = { v, brain: new CitizenBrain({ random: () => 0.5 }), parkT: 22 };
  assert.ok(people.attach(a));
  return { people, game, a, v, collision };
}

test('driver follows the real body transform and is hidden with the distant impostor', () => {
  const f = occupantsFixture();
  try {
    f.people.update(0.1);
    const actor = f.people.actors[0], before = new THREE.Matrix4(), after = new THREE.Matrix4();
    f.people.renderer.meshes.head.getMatrixAt(actor.slot, before);
    f.v.root.position.x += 10; f.v.body.rotation.z = 0.1;
    f.people.update(0.1); f.people.renderer.meshes.head.getMatrixAt(actor.slot, after);
    assert.ok(after.elements[12] - before.elements[12] > 9);
    assert.ok(after.elements.every(Number.isFinite));
    assert.ok(f.v.npcSeats.has('driver'));
    f.v._impOn = true; f.people.update(0.1);
    f.people.renderer.meshes.head.getMatrixAt(actor.slot, after);
    assert.equal(after.elements[0], 0);
  } finally { f.people.dispose(); }
});

test('parked driver opens the door, walks, returns and reclaims the driver seat', () => {
  const f = occupantsFixture();
  try {
    assert.ok(f.people.onPark(f.a));
    assert.equal(f.people.actors[0].state, 'EXITING');
    const seen = new Set();
    for (let i = 0; i < 1100; i++) {
      f.a.parkT -= 0.05; f.a.brain.update(0.05);
      f.people.update(0.05); seen.add(f.people.actors[0].state);
      assert.ok(Number.isFinite(f.people.actors[0].x));
      if (seen.has('WALKING') && f.people.readyToDrive(f.a)) break;
    }
    for (const state of ['EXITING', 'WALKING', 'IDLE', 'RETURNING', 'ENTERING', 'SEATED']) assert.ok(seen.has(state), state);
    assert.equal(f.v.driver, 'ai');
    assert.equal(f.people.stats.exited, 1); assert.equal(f.people.stats.entered, 1);
    assert.equal(f.v.doors[0].target, 0);
  } finally { f.people.dispose(); }
});

test('blocked exits keep the person seated; cleanup releases every render slot', () => {
  const f = occupantsFixture();
  try {
    f.collision.addAABB({ id: 'blocked-door', minX: 1.2, maxX: 2, minZ: -1, maxZ: 1, minY: 0, maxY: 3, walkable: false });
    assert.equal(f.people.onPark(f.a), false);
    assert.equal(f.people.actors[0].state, 'SEATED');
    f.people.onMapActivated({ collision: f.collision });
    assert.equal(f.people.actors.length, 0); assert.equal(f.people.free.length, 6);
    assert.equal(f.v.npcSeats.size, 0);
  } finally { f.people.dispose(); }
});

test('taking an empty parked car preserves its former driver walking in the world', () => {
  const f = occupantsFixture();
  try {
    f.people.onPark(f.a);
    for (let i = 0; i < 30; i++) f.people.update(0.05);
    const actor = f.people.actors[0];
    assert.equal(f.v.driver, null);
    f.v.driver = 'player';
    f.people.release(f.a, true);
    assert.equal(f.people.actors.length, 1);
    assert.equal(actor.vehicle, null); assert.equal(actor.agent, null);
    assert.equal(actor.state, 'WALKING');
    f.people.update(0.05);
  } finally { f.people.dispose(); }
});
