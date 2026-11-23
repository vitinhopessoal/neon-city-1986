import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { Minimap, radarProjection } from '../../src/ui/Minimap.js';
import { GameMenu } from '../../src/ui/GameMenu.js';
import { TriangleMap } from '../../src/maps/TriangleMap.js';
import { INTERFACE_DEFAULTS, sanitizePreferences, loadInterfacePreferences, saveInterfacePreferences } from '../../src/ui/InterfacePreferences.js';

test('radar keeps the player fixed while forward movement points up in every cardinal direction', () => {
  const player = { x: 263.2, z: 1247.9 };
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const p = radarProjection(player, yaw);
    const origin = p.project(player.x, player.z);
    const ahead = p.project(player.x + Math.sin(yaw) * 100, player.z + Math.cos(yaw) * 100);
    assert.ok(Math.abs(origin.x - 168) < 1e-8);
    assert.ok(Math.abs(origin.y - 115.2) < 1e-8);
    assert.ok(Math.abs(ahead.x - origin.x) < 1e-8);
    assert.ok(ahead.y < origin.y);
  }
  const p = radarProjection(player, 1, { northUp: true });
  assert.ok(p.project(player.x + 100, player.z).x > p.px);
  assert.ok(p.project(player.x, player.z - 100).y < p.py);
});

test('native radar is calibrated to the real Ocean Drive spawn and overlapping bridge', async t => {
  const folder = new URL('../../dev-maps/vice-city/', import.meta.url);
  let manifest;
  try { manifest = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8')); }
  catch { t.skip('local GTA resources are not distributed'); return; }
  const atlas = await readFile(new URL(manifest.minimap.image, folder));
  const width = atlas.readUInt32BE(16), height = atlas.readUInt32BE(20);
  const compressed = [];
  for (let offset = 8; offset < atlas.length;) {
    const length = atlas.readUInt32BE(offset);
    if (atlas.subarray(offset + 4, offset + 8).toString() === 'IDAT') compressed.push(atlas.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const pixels = inflateSync(Buffer.concat(compressed)), bounds = manifest.minimap.bounds;
  for (const point of [{ x: 263.2, z: 1247.9 }, { x: -358.9427, z: -38.2402 }]) {
    const x = Math.floor((point.x - bounds.minX) / (bounds.maxX - bounds.minX) * width);
    const y = Math.floor((point.z - bounds.minZ) / (bounds.maxZ - bounds.minZ) * height);
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    assert.deepEqual([...pixels.subarray(offset, offset + 4)], [0, 0, 0, 255], 'real road positions must lie on native radar roads');
  }
  const provenance = JSON.parse(await readFile(new URL('radar/provenance.json', folder), 'utf8'));
  assert.equal(provenance.tiles.length, 64);
});

test('imported city draws its native image without requiring procedural road metadata', () => {
  const previousDocument = globalThis.document, previousImage = globalThis.Image;
  const draws = [], elements = {}, ctx = new Proxy({}, { get: (object, key) => object[key] ?? ((...args) => { if (key === 'drawImage') draws.push(args); }) });
  const canvas = { width: 672, height: 360, getContext: () => ctx, setAttribute() {} };
  const element = { querySelector: key => key === 'canvas' ? canvas : (elements[key] ??= { style: {}, setAttribute() {} }), remove() {} };
  globalThis.document = { createElement: () => element };
  globalThis.Image = class {};
  try {
    const map = new Minimap({ appendChild() {} });
    map.setEnvironment({ manifestUrl: '/dev-maps/vice-city/manifest.json', isImported: true,
      bounds: { minX: -1700, maxX: 1500, minZ: -1500, maxZ: 1750 },
      manifest: { minimap: { image: 'radar/atlas.png', bounds: { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 } } } });
    assert.equal(element.hidden, false);
    assert.equal(map.image.src, '/dev-maps/vice-city/radar/atlas.png');
    map.image.onload(); map.update(0.1, { x: 263.2, z: 1247.9 }, Math.PI, { health: 75 });
    assert.deepEqual(draws[0].slice(1), [-2000, -2000, 4000, 4000]);
    assert.equal(elements['.minimap-health i'].style.width, '75%');
    assert.equal(map.setWaypoint({ x: 300, z: 1200 }), true);
    assert.ok(Math.abs(map.waypointDistance - Math.hypot(300 - 263.2, 1200 - 1247.9)) < 1e-8);
    assert.equal(map.setWaypoint({ x: Infinity, z: 0 }), false);
    assert.deepEqual(map.waypoint, { x: 300, z: 1200 });
    map.clearWaypoint(); assert.equal(map.waypoint, null);
  } finally { globalThis.document = previousDocument; globalThis.Image = previousImage; }
});

test('settings survive reload while invalid or unknown values safely return to supported ranges', () => {
  const previous = globalThis.localStorage, data = new Map();
  globalThis.localStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  try {
    saveInterfacePreferences({ sensitivity: 70, northUp: true, zoom: 1.4, helpSize: 'large' });
    const loaded = loadInterfacePreferences();
    assert.equal(loaded.sensitivity, 70); assert.equal(loaded.northUp, true); assert.equal(loaded.zoom, 1.4); assert.equal(loaded.helpSize, 'large');
    const invalid = sanitizePreferences({ sensitivity: Infinity, zoom: 1000, helpSize: 'huge', invertY: 'yes', script: 'no' });
    assert.equal(invalid.sensitivity, INTERFACE_DEFAULTS.sensitivity); assert.equal(invalid.zoom, 2);
    assert.equal(invalid.helpSize, 'normal'); assert.equal(invalid.invertY, false); assert.equal('script' in invalid, false);
  } finally { globalThis.localStorage = previous; }
});

test('opening P pauses gameplay, clears held controls, and closing resumes with no stuck keys', () => {
  const previousDocument = globalThis.document;
  let cleared = 0, reset = 0, page;
  globalThis.document = { activeElement: {}, exitPointerLock() {} };
  const menu = Object.create(GameMenu.prototype);
  menu.el = { classList: { add() {}, remove() {} }, querySelector() {}, contains: () => false };
  menu.tab = value => { page = value; };
  menu.game = { state: 'playing', mapLoading: false, renderer: { info: { render: { calls: 500 } } },
    input: { clearAll: () => cleared++, exitPointerLock() {} }, time: { fps: 40, reset: () => reset++ } };
  try {
    menu.show(); assert.equal(menu.game.menuOpen, true); assert.equal(menu.open, true); assert.equal(page, 'settings');
    menu.close(); assert.equal(menu.game.menuOpen, false); assert.equal(cleared, 2); assert.equal(reset, 1);
  } finally { globalThis.document = previousDocument; }
});

test('sector downloads finish while background tabs have no animation frames', async () => {
  const previousFetch = globalThis.fetch, previousRAF = globalThis.requestAnimationFrame;
  const source = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] });
  const json = Buffer.from(source.padEnd(Math.ceil(source.length / 4) * 4, ' '));
  const glb = Buffer.alloc(20 + json.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); json.copy(glb, 20);
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(url);
    return url.endsWith('manifest.json') ? new Response(JSON.stringify({
      spawn: { x: 0, y: 0, z: 0 }, bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, files: ['a.glb', 'b.glb'] })) : new Response(glb);
  };
  globalThis.requestAnimationFrame = () => { throw new Error('Background tabs cannot supply an animation frame'); };
  try {
    const map = new TriangleMap({ id: 'background-test', manifestUrl: '/local/manifest.json' });
    await map.fetch();
    assert.deepEqual(requests, ['/local/manifest.json', '/local/a.glb', '/local/b.glb']);
    assert.equal(map._gltf.scene.children.length, 2);
  } finally { globalThis.fetch = previousFetch; globalThis.requestAnimationFrame = previousRAF; }
});
