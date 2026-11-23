import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { TriangleCollisionSystem } from '../../src/physics/TriangleCollisionSystem.js';
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics.js';
import { VehicleFactory } from '../../src/vehicles/VehicleFactory.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TriangleMap } from '../../src/maps/TriangleMap.js';

function floor(col, y) {
  col.addTriangle([-20,y,-20, 20,y,20, 20,y,-20], 1);
  col.addTriangle([-20,y,-20, -20,y,20, 20,y,20], 1);
}

test('stacked streets retain separate floors, ceiling and underside camera collisions', () => {
  const col = new TriangleCollisionSystem(); floor(col, 0); floor(col, 8);
  assert.equal(col.getGroundHeight(0, 0, 0, 0.36), 0);
  assert.equal(col.getGroundHeight(0, 0, 8, 0.36), 8);
  assert.equal(col.getGroundHeight(0, 0, 4, 0.36), 0);
  assert.equal(col.getCeilingHeight(0, 0, 1.8), 8);
  const hit = col.sphereCast(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 1, 0), 20, 0.2);
  assert.ok(Math.abs(hit - 5.8) < 0.01);
});

test('COL walls resolve pedestrian and vehicle contact without filling tunnel openings', () => {
  const col = new TriangleCollisionSystem(); floor(col, 0); floor(col, 8);
  col.addTriangle([0,0,-5, 0,5,5, 0,0,5]);
  col.addTriangle([0,0,-5, 0,5,-5, 0,5,5]);
  const person = { x: -0.1, z: 0 };
  col.resolveCircle(person, 0, 0.35, 1.8, 0.36); assert.ok(person.x < -0.34);
  const vehicle = { x: -0.6, z: 0, hx: 1, hz: 2, rot: 0 }, contacts = [];
  assert.ok(col.resolveOBB(vehicle, 0, 1.5, 0.32, null, contacts, 3) > 0);
  assert.ok(vehicle.x <= -1);
  const top = { x: 0, z: 0 }; col.resolveCircle(top, 8, 0.35, 1.8, 0.36);
  assert.deepEqual(top, { x: 0, z: 0 });
  const ray = col.sphereCast(new THREE.Vector3(-4, 1, 0), new THREE.Vector3(1, 0, 0), 10, 0);
  assert.equal(ray, 4);
});

test('ramps provide continuous support while dynamic boxes still work', () => {
  const col = new TriangleCollisionSystem();
  col.addTriangle([-10,0,-4, 10,4,4, 10,4,-4], 1);
  col.addTriangle([-10,0,-4, -10,0,4, 10,4,4], 1);
  for (let x = -10; x <= 10; x++) assert.ok(Math.abs(col.getGroundHeight(x, 0, (x + 10) * 0.2, 0.36) - (x + 10) * 0.2) < 1e-5);
  col.addBox({ id: 'dynamic-car', cx: 0, cz: 0, hx: 1, hz: 2, minY: 2, maxY: 3.4 });
  const pos = { x: 0.9, z: 0 }; col.resolveCircle(pos, 2, 0.35, 1.8, 0.36);
  assert.ok(pos.x > 1.3); col.remove('dynamic-car');
  assert.equal(col.getGroundHeight(0, 0, 2, 0.36), 2);
});

test('COL spheres retain curved volume, ceiling and bullet rays', () => {
  const col = new TriangleCollisionSystem(); col.addSphere(0, 4, 0, 2);
  assert.equal(col.getGroundHeight(0, 0, 6, 0), 6);
  assert.equal(col.getCeilingHeight(0, 0, 1), 2);
  const position = { x: 1.9, z: 0 }; col.resolveCircle(position, 3, 0.35, 1.8, 0.36);
  assert.ok(position.x >= 2.34);
  assert.equal(col.sphereCast(new THREE.Vector3(-5, 4, 0), new THREE.Vector3(1, 0, 0), 10, 0), 3);
});

test('vehicle exit volume stays free on ramps and rejects a low ceiling', () => {
  const col = new TriangleCollisionSystem();
  col.addTriangle([-10,0,-4, 10,4,4, 10,4,-4], 1);
  col.addTriangle([-10,0,-4, -10,0,4, 10,4,4], 1);
  assert.equal(col.isVolumeFree(0, 2, 0, 0.4, 1.85), true);
  col.addTriangle([-10,3,-4, 10,3,-4, 10,3,4], 1);
  assert.equal(col.isVolumeFree(0, 2, 0, 0.4, 1.85), false);
});

const pilotUrl = new URL('../../dev-maps/vice-city/oceandrv.manifest.json', import.meta.url);
test('local Ocean Drive GLB and COL agree on real ground and support vehicle physics', async t => {
  let manifest;
  try { manifest = JSON.parse(await readFile(pilotUrl, 'utf8')); } catch { t.skip('local GTA resources are not distributed'); return; }
  const folder = new URL('../../dev-maps/vice-city/', import.meta.url);
  const collisionBytes = await readFile(new URL(manifest.collisionFile, folder));
  const col = new TriangleCollisionSystem();
  col.addBuffer(collisionBytes.buffer.slice(collisionBytes.byteOffset, collisionBytes.byteOffset + collisionBytes.byteLength));
  assert.ok(col.triangleCount > 1000);
  const sp = manifest.spawn;
  const y = col.getGroundHeight(sp.x, sp.z, sp.y, 0.4);
  assert.ok(Math.abs(y - sp.y) < 0.01); assert.ok(y > 6);
  const testPos = { x: sp.x, z: sp.z }; col.resolveCircle(testPos, y, 0.4, 1.85, 0.36);
  assert.ok(Math.hypot(testPos.x - sp.x, testPos.z - sp.z) < 0.05);
  const bytes = await readFile(new URL(manifest.file, folder));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'local-test-texture', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  let meshes = 0, triangles = 0;
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    meshes++; triangles += o.geometry.index.count / 3;
    assert.equal(o.userData.collide ?? o.parent.userData.collide, false);
    assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));
  });
  assert.ok(meshes > 100); assert.ok(triangles > 10000);
  // Same bicycle physics used by the legacy chassis. DOM only supplies textures.
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({ measureText: () => ({ width: 20 }) }, { get: (o,k) => o[k] || (() => {}) }) }) };
  try {
    const material = new THREE.MeshBasicMaterial();
    const factory = new VehicleFactory({ m: new Proxy({}, { get: () => material }) });
    const car = factory.create('sedan', { id: 'vc-test-car', color: 0xffffff });
    car.setPose(sp.x, y, sp.z, 0); car.attachCollider(col);
    const env = { getSurface: () => 'asphalt', waterDepth: () => 0 };
    const physics = new VehiclePhysics(car, col, env); car.physics = physics; physics.syncFromRoot();
    car.engineOn = true; car.controls.throttle = 0.4; car.controls.brake = 0; car.controls.handbrake = false;
    physics.wake();
    for (let i = 0; i < 240; i++) {
      physics.update(1 / 60);
      assert.ok([physics.x, physics.y, physics.z, physics.heading].every(Number.isFinite));
      assert.ok(physics.y > 6, 'vehicle must remain on the real street above the sea');
    }
    assert.ok(Math.hypot(physics.x - sp.x, physics.z - sp.z) > 4);
    console.log(JSON.stringify({ pilot: manifest.sourceSector, meshes, triangles, collisionTriangles: col.triangleCount, traveled: Math.hypot(physics.x - sp.x, physics.z - sp.z), height: physics.y }));
    factory.dispose(car); material.dispose();
  } finally { globalThis.document = oldDocument; }
  const map = new TriangleMap({ id: 'vc-pipeline-test', scene: new THREE.Scene(), renderer: { capabilities: { getMaxAnisotropy: () => 1 } } });
  map.manifest = manifest; map._gltf = gltf; map._t0 = performance.now();
  map._timing = { fileBytes: bytes.byteLength, downloadMs: 0, parseMs: 0 };
  map._collisionBuffers = [collisionBytes.buffer.slice(collisionBytes.byteOffset, collisionBytes.byteOffset + collisionBytes.byteLength)];
  map.process();
  assert.ok(map.root.children.length > 0); assert.ok(map.collision.triangleCount > 1000);
  assert.ok(map.spawnPoint.y > 6); assert.equal(map.waterDepth(sp.x, sp.z, sp.y), 0);
  assert.ok(map.stats.drawObjects < meshes, 'existing batcher must reduce the source draw objects');
  const begin = performance.now();
  for (let i = 0; i < 10000; i++) map.collision.getGroundHeight(sp.x + (i % 10) * 0.1, sp.z, sp.y, 0.36);
  const report = { processMs: map.stats.processMs, drawObjects: map.stats.drawObjects, sourceDrawObjects: meshes, tenThousandFloorQueriesMs: +(performance.now() - begin).toFixed(2), ...map.stats };
  console.log(JSON.stringify(report));
  await import('node:fs/promises').then(fs => fs.writeFile(new URL('pilot-runtime-validation.json', folder), JSON.stringify(report, null, 2)));
  map.unload(); assert.equal(map.root, null); assert.equal(map.collision, null);
});
