'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectMap, discoverMap, resolveRequest } = require('../../electron/local-map.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-map-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const map = path.join(root, 'dev-maps', 'vice-city');
  const dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(map, 'radar'), { recursive: true });
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), 'game');
  for (const f of ['ocean.glb', 'ocean.collision.bin', 'radar/atlas.png']) fs.writeFileSync(path.join(map, f), 'fixture');
  const manifest = { id: 'vice-city', file: 'ocean.glb', collisionFile: 'ocean.collision.bin',
    sectors: [{ file: 'ocean.glb', collisionFile: 'ocean.collision.bin' }], minimap: { image: 'radar/atlas.png' } };
  fs.writeFileSync(path.join(map, 'manifest.json'), JSON.stringify(manifest));
  return { root, map, dist, manifest };
}

test('finds complete external maps beside a portable executable and remembers a chosen folder', t => {
  const { root, map } = fixture(t);
  assert.equal(inspectMap(map), map);
  assert.equal(discoverMap({ bases: [path.join(root, 'release', 'win-unpacked')] }), map);
  assert.equal(discoverMap({ saved: map }), map);
  assert.equal(discoverMap({ explicit: map }), map);
});

test('rejects incomplete folders and a different map instead of falling back to a generated city', t => {
  const { map, manifest } = fixture(t);
  fs.unlinkSync(path.join(map, 'ocean.collision.bin'));
  assert.equal(inspectMap(map), null);
  fs.writeFileSync(path.join(map, 'ocean.collision.bin'), 'fixture');
  manifest.id = 'other-city';
  fs.writeFileSync(path.join(map, 'manifest.json'), JSON.stringify(manifest));
  assert.equal(inspectMap(map), null);
});

test('serves the renderer and converted assets exclusively from their own roots', t => {
  const { root, map, dist } = fixture(t);
  assert.equal(resolveRequest('app://neon-city/', dist, map), path.join(dist, 'index.html'));
  assert.equal(resolveRequest('app://neon-city/dev-maps/vice-city/radar/atlas.png?v=2', dist, map), path.join(map, 'radar', 'atlas.png'));
  fs.writeFileSync(path.join(root, 'private.txt'), 'must stay private');
  for (const url of ['app://other/index.html', 'https://neon-city/index.html',
    'app://neon-city/dev-maps/other/manifest.json', 'app://neon-city/%2e%2e%2fprivate.txt',
    'app://neon-city/dev-maps/vice-city/%2e%2e%5cprivate.txt',
    'app://neon-city/dev-maps/vice-city/C%3A/private.txt', 'app://neon-city/%00',
    'app://neon-city/%bad', 'app://neon-city@other/index.html']) {
    assert.equal(resolveRequest(url, dist, map), null, url);
  }
  assert.equal(resolveRequest('app://neon-city/dev-maps/vice-city/manifest.json', dist, null), null);
});

test('local converted Vice City has all files required by the packaged desktop loader', () => {
  const map = path.resolve('dev-maps/vice-city');
  assert.equal(inspectMap(map), map);
  assert.equal(discoverMap({ bases: [path.resolve('release/win-unpacked')] }), map);
});
