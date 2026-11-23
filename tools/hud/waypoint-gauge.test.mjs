import test from 'node:test';
import assert from 'node:assert/strict';
import { radarProjection } from '../../src/ui/Minimap.js';
import { MapViewport } from '../../src/ui/WorldMapView.js';
import { validateWaypoint, waypointIndicator, readWaypoint, storeWaypoint } from '../../src/ui/Waypoint.js';
import { VehicleHUD, vehicleGaugeReadout } from '../../src/ui/VehicleHUD.js';
import { VehicleManager } from '../../src/vehicles/VehicleManager.js';
import { SPECS } from '../../src/vehicles/VehicleFactory.js';
import { TriangleCollisionSystem } from '../../src/physics/TriangleCollisionSystem.js';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';

const bounds = { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('map picking is invertible after zoom, pan and radar rotation', () => {
  for (const yaw of [0, 0.7, Math.PI]) {
    const p = radarProjection({ x: 263.2, z: 1247.9 }, yaw);
    const pixel = p.project(-358.94, -38.24), world = p.unproject(pixel.x, pixel.y);
    close(world.x, -358.94); close(world.z, -38.24);
  }
  const view = new MapViewport(bounds);
  view.pan(53, -31, 1000, 600);
  const cursor = { x: 670, y: 200 }, before = view.projection(1000, 600).unproject(cursor.x, cursor.y);
  view.zoomAt(3, cursor.x, cursor.y, 1000, 600);
  const after = view.projection(1000, 600).unproject(cursor.x, cursor.y);
  close(after.x, before.x); close(after.z, before.z);
  const pixel = view.projection(1000, 600).project(263.2, 1247.9);
  const point = view.projection(1000, 600).unproject(pixel.x, pixel.y);
  close(point.x, 263.2); close(point.z, 1247.9);
  view.reset(); assert.equal(view.zoom, 1); assert.deepEqual(view.center, { x: 0, z: 0 });
});

test('distant destinations stay visible as edge arrows pointing toward their actual coordinates', () => {
  const origin = { x: 168, y: 115.2 };
  for (const point of [{ x: 900, y: -500 }, { x: -400, y: 700 }, { x: 168, y: -1000 }, { x: 1000, y: 115.2 }]) {
    const marker = waypointIndicator(point, origin, 336, 180);
    assert.equal(marker.inside, false);
    assert.ok(marker.x >= 15 && marker.x <= 321 && marker.y >= 15 && marker.y <= 165);
    close((marker.x - origin.x) * (point.y - origin.y) - (marker.y - origin.y) * (point.x - origin.x), 0);
  }
  assert.equal(waypointIndicator({ x: 200, y: 90 }, origin, 336, 180).inside, true);
});

test('waypoints persist by map, reject invalid coordinates, and can be removed', () => {
  const previous = globalThis.localStorage, storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  try {
    const point = validateWaypoint({ x: 263.2, z: 1247.9, unwanted: 'ignored' }, bounds);
    assert.deepEqual(point, { x: 263.2, z: 1247.9 });
    storeWaypoint('vice-city', point); assert.deepEqual(readWaypoint('vice-city', bounds), point);
    assert.equal(readWaypoint('different-map', bounds), null);
    assert.equal(validateWaypoint({ x: Infinity, z: 2 }, bounds), null);
    assert.equal(validateWaypoint({ x: 0, z: 2001 }, bounds), null);
    storeWaypoint('vice-city', null); assert.equal(readWaypoint('vice-city', bounds), null);
  } finally { globalThis.localStorage = previous; }
});

function vehicle(bike = false) {
  return { bike, spec: { model: bike ? 'Palm Rider 125' : 'Palm Sedan', handling: { redline: bike ? 9500 : 6500 } },
    controls: { throttle: 0.6 }, physics: { vLong: 25, rpm: 4300, gear: 3, powertrainActive: false }, damage: { integrity: 87 } };
}

test('car and motorcycle instruments use speed, RPM and gear independently, including reverse and neutral', () => {
  for (const bike of [false, true]) {
    const v = vehicle(bike), reading = vehicleGaugeReadout(v);
    assert.equal(reading.speedKmh, 90); assert.equal(reading.rpm, 4300); assert.equal(reading.gear, '3'); assert.equal(reading.integrity, 87);
    v.physics.vLong = -5; v.physics.gear = 'R';
    assert.equal(vehicleGaugeReadout(v).speedKmh, 18); assert.equal(vehicleGaugeReadout(v).gear, 'R');
    v.physics.vLong = 0; v.physics.rpm = 5000; v.physics.gear = 0;
    assert.equal(vehicleGaugeReadout(v).speedKmh, 0); assert.equal(vehicleGaugeReadout(v).rpm, 5000); assert.equal(vehicleGaugeReadout(v).gear, 'N');
  }
});

const classes = () => { const values = new Set(); return { values, add: value => values.add(value), remove: value => values.delete(value), toggle: (value, on) => { if (on) values.add(value); else values.delete(value); }, contains: value => values.has(value) }; };
test('the compact HUD appears for either vehicle, updates its tachometer, and disappears on exit', () => {
  const previous = globalThis.document;
  let element;
  globalThis.document = { createElement() {
    const refs = {};
    element = { classList: classes(), attrs: {}, setAttribute(key, value) { this.attrs[key] = value; },
      set innerHTML(html) { for (const match of html.matchAll(/data-ref="([^"]+)"/g)) refs[match[1]] = { dataset: { ref: match[1] }, style: {}, classList: classes(), attrs: {}, setAttribute(key,value) { this.attrs[key]=value; }, parentElement: { parentElement: { classList: classes() } } }; },
      querySelectorAll: () => Object.values(refs) };
    return element;
  } };
  try {
    const hud = new VehicleHUD({ appendChild() {} });
    for (const bike of [false, true]) {
      const v = vehicle(bike); hud.show(v);
      assert.equal(hud.visible, true); assert.equal(element.classList.contains('visible'), true);
      assert.equal(hud.refs.speed.textContent, '90');
      const before = hud.refs.needle.attrs.transform;
      v.physics.rpm = 6000; hud.update(0.1);
      assert.notEqual(hud.refs.needle.attrs.transform, before); assert.equal(hud.refs.speed.textContent, '90');
      hud.hide(); assert.equal(hud.visible, false); assert.equal(element.classList.contains('visible'), false);
    }
  } finally { globalThis.document = previous; }
});

test('the local map has a motorcycle and cars placed on real safe street surfaces', async t => {
  const folder = new URL('../../dev-maps/vice-city/', import.meta.url);
  let manifest;
  try { manifest = JSON.parse(await readFile(new URL('oceandrv.manifest.json', folder), 'utf8')); }
  catch { t.skip('local GTA resources are not distributed'); return; }
  const bytes = await readFile(new URL(manifest.collisionFile, folder)), collision = new TriangleCollisionSystem();
  collision.addBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const env = { id: 'placement-test', manifest, collision, spawnPoint: manifest.spawn,
    groundAt: (x,z,y) => collision.getGroundHeight(x,z,y,0.4), waterDepth: () => 0 };
  const factory = { create(type) {
    const root = new THREE.Group();
    return { type, root, spec: SPECS[type], setPose(x,y,z,heading) { root.position.set(x,y,z); root.rotation.y = heading; }, attachCollider() {} };
  } };
  const manager = { game: { world: { vehicleFactory: factory }, scene: new THREE.Scene() } };
  const vehicles = VehicleManager.prototype._spawnForImported.call(manager, env);
  assert.equal(vehicles.length, 3);
  assert.ok(vehicles.some(v => v.spec.bike));
  for (const v of vehicles) {
    const p = v.root.position;
    close(collision.getGroundHeight(p.x,p.z,p.y,0.4),p.y);
    assert.ok(p.y > 6);
    assert.equal(collision.isVolumeFree(p.x,p.y,p.z,v.spec.width/2,v.spec.height),true);
  }
});
