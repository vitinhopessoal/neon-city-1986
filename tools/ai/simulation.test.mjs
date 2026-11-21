import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import * as THREE from 'three';
import { World } from '../../src/world/World.js';
import { createCoastalCity } from '../../src/world/districts/CoastalCity.js';

function canvasStub() {
  const canvas = { width: 1, height: 1 };
  const gradient = { addColorStop() {} };
  const methods = { canvas, measureText: text => ({ width: String(text).length * 12 }),
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) };
  const ctx = new Proxy(methods, { get: (object, key) => key in object ? object[key] : () => {} });
  canvas.getContext = () => ctx;
  return canvas;
}

test('real city simulates walkers, drivers, passengers and reactions without invalid states', async () => {
  const oldDocument = globalThis.document, oldLocation = globalThis.location, oldRandom = Math.random;
  globalThis.document = { createElement: () => canvasStub() };
  globalThis.location = { search: '?density=low' };
  let seed = 1234;
  Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let server, world, city;
  try {
    server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
    const { CitySimulation } = await server.ssrLoadModule('/src/city/CitySimulation.js');
    const { VehicleManager } = await server.ssrLoadModule('/src/vehicles/VehicleManager.js');
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    camera.position.set(46, 3, 35); camera.lookAt(46, 1, -20);
    world = new World({ scene, renderer: {}, quality: { pointLights: false, decorDensity: 1 } });
    world.loadDistrict(createCoastalCity());
    const playerPos = new THREE.Vector3(46, 0.15, 30);
    const game = { scene, camera, world, state: 'playing', mapLoading: false, weapons: { aim: 0, drawn: false },
      player: { visualPosition: playerPos, controller: { position: playerPos, collision: world.collision, yaw: Math.PI, grounded: true } } };
    const vehicles = { game, env: world, list: world.vehicles, _byId: new Map(), interaction: { onFoot: true, vehicle: null } };
    vehicles.addVehicle = VehicleManager.prototype.addVehicle.bind(vehicles);
    vehicles.removeVehicle = VehicleManager.prototype.removeVehicle.bind(vehicles);
    for (const v of world.vehicles) vehicles.addVehicle(v);
    game.vehicles = vehicles;
    city = game.city = new CitySimulation(game);
    city.onMapActivated(world);
    // Exercise population deterministically; camera culling itself is not tested here.
    city.traffic._visible = () => false;
    for (let frame = 0; frame < 1200; frame++) {
      const dt = 1 / 60;
      city.update(dt);
      for (const v of vehicles.list) {
        v.physics.update(dt);
        if (v.physics.awake || v.doors.some(d => d.open !== d.target)) v.animation.update(dt, false);
      }
      city.postUpdate(dt);
      if (frame === 600 && city.peds.peds.length) {
        const p = city.peds.peds[0];
        city.events.emit('gunshot', { x: p.x + 1, y: p.y + 1, z: p.z });
      }
    }
    assert.ok(city.traffic.agents.length > 0, 'moving vehicles spawn');
    assert.ok(city.occupants.actors.some(a => a.seat.driver), 'actual visible drivers exist');
    assert.ok(city.occupants.actors.some(a => !a.seat.driver), 'passengers exist in the running population');
    assert.ok(city.peds.peds.length > 0);
    for (const a of city.traffic.agents) {
      assert.ok(Number.isFinite(a.speed)); assert.ok(a.brain.profile);
      assert.ok(a.v.root.position.toArray().every(Number.isFinite));
    }
    for (const p of city.peds.peds) {
      assert.ok([p.x, p.y, p.z, p.yaw].every(Number.isFinite));
      assert.ok(p.brain.memory.length <= 8);
    }
    for (const a of city.occupants.actors) assert.ok([a.x, a.y, a.z].every(Number.isFinite));
    const count = city.occupants.actors.length;
    assert.ok(count > 0);
    const crashed = city.traffic.agents[0];
    city.events.emit('collision', { x: crashed.v.root.position.x, z: crashed.v.root.position.z, speed: 12, vehicleId: crashed.v.id });
    crashed.speed = 0;
    city.update(1 / 60);
    assert.equal(crashed.abandoned, true, 'serious crashes produce a stop and abandonment decision');
    city.onMapActivated(world);
    assert.equal(city.occupants.actors.length, 0, 'map switch leaves no duplicate people');
    assert.equal(city.occupants.free.length, city.occupants.renderer.capacity);
  } finally {
    city?.occupants.dispose(); city?.peds.renderer.dispose();
    world?.destruction.dispose(); world?.lib.dispose();
    await server?.close();
    globalThis.document = oldDocument; globalThis.location = oldLocation; Math.random = oldRandom;
  }
});
