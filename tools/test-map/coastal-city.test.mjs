import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoastalCity } from '../../src/world/districts/CoastalCity.js';
import { SUNSET_BEACH } from '../../src/world/districts/SunsetBeach.js';
import { RoadNetwork } from '../../src/world/RoadNetwork.js';
import { LaneGraph } from '../../src/traffic/LaneGraph.js';
import { Terrain } from '../../src/world/Terrain.js';
import { CollisionSystem } from '../../src/physics/CollisionSystem.js';
import { buildSlab, buildOverlay } from '../../src/world/RoadGenerator.js';
import { CityGenerator } from '../../src/world/CityGenerator.js';
import * as THREE from 'three';
import { BuildingKit } from '../../src/world/buildings/BuildingKit.js';
import { BUILDING_TYPES } from '../../src/world/BuildingGenerator.js';
import { ZONE_BUILDING_TYPES } from '../../src/world/buildings/ZoneBuildings.js';
import { LANTERN_POINT } from '../../src/world/districts/LanternPoint.js';
import { createRng } from '../../src/utils/math.js';
import { World } from '../../src/world/World.js';
import { Minimap } from '../../src/ui/Minimap.js';

const city = createCoastalCity();
const net = new RoadNetwork();
for (const r of city.roads) net.addRoad(r);
for (const i of city.intersections) net.addIntersection(i);
for (const c of city.crosswalks) net.addCrosswalk(c);
const graph = new LaneGraph(net, city.bounds);
const terrain = new Terrain();
const collision = new CollisionSystem();
collision.setTerrain((x, z) => terrain.getHeight(x, z));
const batcher = { add() {} }, lib = { m: {} };
for (const s of city.slabs) buildSlab(s, batcher, lib, collision, terrain);
for (const o of city.overlays) buildOverlay(o, batcher, lib, terrain, o);

test('Sunset Beach buildings, roads and spawn stay intact', () => {
  assert.deepEqual(city.buildings.slice(0, SUNSET_BEACH.buildings.length), SUNSET_BEACH.buildings);
  assert.deepEqual(city.roads.slice(0, SUNSET_BEACH.roads.length), SUNSET_BEACH.roads);
  assert.deepEqual(city.spawnPoints[0], SUNSET_BEACH.spawnPoints[0]);
  assert.deepEqual(city.slabs.find(s => s.id === 'block_se'), SUNSET_BEACH.slabs.find(s => s.id === 'block_se'));
  assert.deepEqual(city.slabs.find(s => s.id === 'block_sw'), SUNSET_BEACH.slabs.find(s => s.id === 'block_sw'));
  for (const collection of ['roads', 'buildings', 'intersections', 'crosswalks', 'spawnPoints', 'slabs']) {
    assert.equal(new Set(city[collection].map(x => x.id)).size, city[collection].length, collection);
  }
});

test('road lanes remain at asphalt height across the new and existing districts', () => {
  for (const road of net.roads.values()) {
    for (const lane of road.lanes.filter(l => l.type === 'drive')) {
      for (let t = 0; t <= road.length; t += 2) {
        const p = net.pointAt(road, t, lane.offset);
        if (p.x <= city.bounds.minX || p.x >= city.bounds.maxX || p.z <= city.bounds.minZ || p.z >= city.bounds.maxZ) continue;
        const raised = collision.getGroundHeight(p.x, p.z, 0, 0.36);
        assert.equal(raised, 0, `raised road ${road.id} at ${p.x},${p.z}`);
      }
    }
  }
});

test('traffic can drive from Sunset Beach through both northern intersections and return', () => {
  const start = graph.segments.find(s => s.road.id === 'ocean_ave' && !s.lane.forward && s.from === 'int_ocean_flamingo');
  assert.ok(start);
  const seen = new Set(), queue = [start];
  while (queue.length) {
    const s = queue.shift();
    if (seen.has(s)) continue;
    seen.add(s);
    for (const connector of s.out) queue.push(connector.to);
  }
  assert.ok([...seen].some(s => s.road.id === 'beacon_e'), 'Beacon Street must be reachable');
  assert.ok([...seen].some(s => s.road.id === 'lantern_w'), 'western Lantern Lane must be reachable');
  assert.ok([...seen].some(s => s.road.id === 'coral_st' && s.lane.forward && s.to === 'int_coral_flamingo'), 'return route through Coral Street');
  assert.equal(graph.nodes.size, 6);
});

test('outer walls replace the former north border and garden paving has priority', () => {
  const barricades = [];
  const boundsCollision = new CollisionSystem();
  const generator = Object.create(CityGenerator.prototype);
  generator.world = { collision: boundsCollision };
  generator._bounds(city, { barricade(...args) { barricades.push(args); }, trafficSign() {} }, batcher);
  for (const x of [28, -70, 46, 70]) {
    const pos = { x, z: -171 };
    boundsCollision.resolveCircle(pos, 0, 0.34, 1.8, 0.36);
    assert.deepEqual(pos, { x, z: -171 }, 'old district border must be open');
  }
  const outside = { x: 28, z: -331 };
  boundsCollision.resolveCircle(outside, 0, 0.34, 1.8, 0.36);
  assert.ok(outside.z > -330, 'new north wall must block movement');
  assert.equal(terrain.getSurface(-131, -248), 'pavers');
  assert.equal(terrain.getSurface(-140, -240), 'grass');
  assert.equal(collision.getGroundHeight(46, -171, 0.15, 0.36), 0.15);
});

test('layout composition does not mutate source district data', () => {
  assert.equal(SUNSET_BEACH.bounds.minZ, -170);
  assert.equal(SUNSET_BEACH.slabs.find(s => s.id === 'block_ne').minZ, -420);
  assert.equal(SUNSET_BEACH.roads.length, 4);
  assert.equal(SUNSET_BEACH.buildings.length, 45);
});

test('all new buildings generate valid geometry and leave northern traffic lanes clear', () => {
  const buildingCollision = new CollisionSystem();
  const material = new THREE.MeshStandardMaterial();
  const stubLib = {
    m: new Proxy({}, { get: () => material }), solid: () => material, neon: () => material,
    windowTile: () => [0, 0, 1, 1], shopTile: () => [0, 0, 1, 1],
  };
  const signs = new Proxy({}, { get: () => () => new THREE.Group() });
  let pieces = 0;
  const kit = new BuildingKit({ lib: stubLib, collision: buildingCollision, signs, dynamicParent: new THREE.Group(), batcher: {
    add(geo, mat, matrix) {
      assert.ok(geo.attributes.position.count > 0);
      assert.ok(matrix.elements.every(Number.isFinite));
      pieces++;
    },
  } });
  kit.palms = []; kit.plants = []; kit.fans = []; kit.swings = []; kit.flags = [];
  for (const s of LANTERN_POINT.buildings) {
    kit.begin({ id: s.id, x: s.x, y: 0.15, z: s.z, rotY: s.rotY });
    kit.rng = createRng(s.id.length * 131 + Math.round(s.x * 7 + s.z * 13));
    const info = (BUILDING_TYPES[s.type] || ZONE_BUILDING_TYPES[s.type])(kit, s);
    assert.ok(info.entrances.length > 0, s.id);
  }
  for (const road of net.roads.values()) for (const lane of road.lanes.filter(l => l.type === 'drive')) {
    for (let t = 0; t <= road.length; t += 2) {
      const p = net.pointAt(road, t, lane.offset);
      if (p.z < -328 || p.z > -170 || p.x < -148) continue;
      const pos = { x: p.x, z: p.z };
      buildingCollision.resolveCircle(pos, 0, 1, 1.5, 0.36);
      assert.ok(Math.hypot(pos.x - p.x, pos.z - p.z) < 0.01, `building blocks ${road.id} at ${p.x},${p.z}`);
    }
  }
  assert.ok(pieces > 1000);
  material.dispose();
});

test('district labels change at the shared border and keep the new coast accessible', () => {
  const env = { districts: [city] };
  assert.equal(World.prototype.getDistrictAt.call(env, 46, 30).id, 'sunset_beach');
  assert.equal(World.prototype.getDistrictAt.call(env, 46, -171).id, 'lantern_point');
  assert.equal(World.prototype.getDistrictAt.call(env, -131, -248).id, 'lantern_point');
  assert.equal(World.prototype.getDistrictAt.call(env, 46, -331), null);
  assert.equal(World.prototype.boundaryHint.call({ bounds: city.bounds }, 46, -171, 0.34), null);
  assert.equal(World.prototype.boundaryHint.call({ bounds: city.bounds }, 46, -329, 0.34), 'closed');
});

test('minimap draws both views, changes environments and tolerates maps without roads', () => {
  const oldDocument = globalThis.document;
  let draws = 0;
  const ctx = new Proxy({}, { get: () => () => { draws++; } });
  const caption = {}, canvas = { getContext: () => ctx };
  const el = { querySelector: q => q === 'canvas' ? canvas : caption, remove() {} };
  globalThis.document = { createElement: () => el };
  try {
    const minimap = new Minimap({ appendChild() {} });
    minimap.setEnvironment({ bounds: city.bounds, roads: net, districts: [city], pois: [] });
    minimap.update(0.1, { x: 46, z: -248 }, Math.PI);
    assert.ok(draws > 100);
    minimap.toggle();
    assert.equal(caption.textContent, 'N: MAPA LOCAL');
    minimap.update(0.1, { x: 46, z: -248 }, Math.PI);
    minimap.setEnvironment({ isImported: true, manifest: { bounds: city.bounds } });
    assert.equal(el.hidden, true);
    minimap.setEnvironment({ isImported: true, manifest: { bounds: city.bounds, roads: city.roads } });
    assert.equal(el.hidden, false);
    minimap.update(0.1, { x: 0, z: 0 }, 0);
  } finally {
    globalThis.document = oldDocument;
  }
});
