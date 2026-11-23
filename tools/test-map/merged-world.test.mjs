import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoastalCity } from '../../src/world/districts/CoastalCity.js';
import { SUNSET_BEACH } from '../../src/world/districts/SunsetBeach.js';
import { TEST_CITY_LINK } from '../../src/world/districts/TestCityLink.js';
import { RoadNetwork } from '../../src/world/RoadNetwork.js';
import { LaneGraph } from '../../src/traffic/LaneGraph.js';
import { laneRoute } from '../../src/city/Navigation.js';
import { Terrain } from '../../src/world/Terrain.js';
import { boundsContains, unionBounds } from '../../src/utils/bounds.js';
import { TestCityAnnex } from '../../src/maps/TestCityAnnex.js';
import { trafficMetadata } from './traffic-metadata.mjs';

const L = TEST_CITY_LINK;
const plain = createCoastalCity();
const merged = createCoastalCity({ testCityLink: true });
const meta = trafficMetadata({ bound: L.half });
const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

test('Sunset Beach keeps buildings, spawn and every road except the Flamingo Street west end', () => {
  assert.deepEqual(merged.buildings, plain.buildings);
  assert.deepEqual(merged.spawnPoints, plain.spawnPoints);
  assert.deepEqual(merged.bounds, plain.bounds);
  for (const r of merged.roads) {
    const o = plain.roads.find((p) => p.id === r.id);
    if (r.id === 'flamingo_w') assert.deepEqual({ ...r, end: o.end }, o);
    else assert.deepEqual(r, o);
  }
  assert.equal(merged.roads.find((r) => r.id === 'flamingo_w').end.x, L.roadEndX);
  assert.deepEqual(SUNSET_BEACH.roads.find((r) => r.id === 'flamingo_w').end, { x: -420, z: 0 }); // fonte original intacta
});

test('TEST CITY sits west of Sunset Beach without overlapping any Sunset slab, building or bound', () => {
  assert.ok(L.rect.maxX < merged.bounds.minX);
  assert.ok(L.ground.maxX <= merged.bounds.minX);
  for (const s of merged.slabs) {
    if (s.id.startsWith('tc_link')) continue;
    assert.ok(!overlaps(s, L.ground), `laje ${s.id} sobre o TEST CITY`);
  }
  for (const b of merged.buildings) assert.ok(b.x > merged.bounds.minX, b.id);
  const link = merged.slabs.filter((s) => s.id.startsWith('tc_link_'));
  assert.equal(link.length, 4);
  assert.ok(link.every((s) => s.maxX === merged.bounds.minX));
});

test('one road graph: Flamingo Street drives into the TEST CITY grid and back', () => {
  const net = new RoadNetwork();
  for (const r of merged.roads) net.addRoad(r);
  for (const i of merged.intersections) net.addIntersection(i);
  for (const c of merged.crosswalks) net.addCrosswalk(c);
  const off = L.offset, P = L.prefix, tr = (p) => ({ x: p.x + off.x, z: p.z + off.z });
  for (const r of meta.roads) net.addRoad({ ...r, id: P + r.id, start: tr(r.start), end: tr(r.end) });
  for (const i of meta.intersections) {
    const roads = i.roads.map((id) => P + id);
    if (i.id === L.junction) roads.push('flamingo_w');
    net.addIntersection({ ...i, roads, x: i.x + off.x, z: i.z + off.z });
  }
  for (const c of meta.crosswalks) net.addCrosswalk({ ...c, id: P + c.id, roadId: P + c.roadId });
  const play = unionBounds([merged.bounds, { minX: L.rect.maxX - 1, maxX: merged.bounds.minX + 1, minZ: -L.opening, maxZ: L.opening }, L.rect]);
  const graph = new LaneGraph(net, play);
  const inbound = graph.segments.find((s) => s.road.id === 'flamingo_w' && s.to === L.junction);
  const outbound = graph.segments.find((s) => s.road.id === 'flamingo_w' && s.from === L.junction);
  const deep = graph.segments.find((s) => s.road.id === `${P}x-50` && s.path.points[0].x < off.x - 40);
  assert.ok(inbound && outbound && deep);
  assert.ok(laneRoute(inbound, deep)?.length > 1);
  assert.ok(laneRoute(deep, outbound)?.length > 1);
  // Nenhum trecho do TEST CITY vira sumidouro (o bairro está dentro da área jogável).
  assert.equal(graph.segments.filter((s) => s.road.id.startsWith(P) && s.sink).length, 0);
});

test('union bounds: corridor and both districts inside, the gap between them outside', () => {
  const play = unionBounds([merged.bounds, { minX: L.rect.maxX - 1, maxX: merged.bounds.minX + 1, minZ: -L.opening, maxZ: L.opening }, L.rect]);
  assert.ok(boundsContains(play, -100, 0));
  assert.ok(boundsContains(play, -160, 0));
  assert.ok(boundsContains(play, L.offset.x, L.offset.z + 50));
  assert.ok(!boundsContains(play, -160, 60));
  assert.ok(!boundsContains(play, -300, -200));
  assert.ok(boundsContains({ minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, 5, 5, 2));
});

test('terrain overlay feeds height and surface only inside its rectangle', () => {
  const t = new Terrain();
  t.addOverlay({ minX: -10, maxX: 10, minZ: -10, maxZ: 10, height: () => 4.5, surface: () => 'grass' });
  assert.equal(t.getHeight(0, 0), 4.5);
  assert.equal(t.getSurface(0, 0), 'grass');
  assert.equal(t.getHeight(20, 0), 0);
  assert.equal(t.getSurface(20, 0), 'asphalt');
  t.addSurfaceZone(-2, -2, 2, 2, 'concrete', 1); // lajes do Sunset têm prioridade
  assert.equal(t.getSurface(0, 0), 'concrete');
});

test('only lamp posts standing inside a carriageway are left out when attaching', () => {
  const a = new TestCityAnnex({});
  a.map = { manifest: { roads: meta.roads } };
  assert.equal(a._inCarriageway(93.8, -2.5), true);   // poste 2,5 m dentro da rua X0
  assert.equal(a._inCarriageway(-56.2, 47.5), true);  // idem na rua X50
  assert.equal(a._inCarriageway(75 + 15, 75 - 18.8), false); // borda da calçada
  assert.equal(a._inCarriageway(-75 - 18.8, -25 + 7.5), false);
});
