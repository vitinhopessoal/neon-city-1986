import http from 'node:http';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const request = (path, host = '127.0.0.1') => new Promise((yes, no) => {
  const req = http.request({ hostname: '127.0.0.1', port: Number(process.env.PORT || 5173), method: 'HEAD', path: encodeURI(path), headers: { Host: host } }, response => {
    response.resume(); response.on('end', () => yes(response.statusCode));
  });
  req.on('error', no); req.end();
});
const local = await request('/dev-maps/vice-city/manifest.json');
const tunnelHost = 'pools-subdivision-petersburg-attacks.trycloudflare.com';
const publicAsset = await request('/dev-maps/vice-city/manifest.json', tunnelHost);
const traversal = await request('/dev-maps/foo/../vice-city/manifest.json', tunnelHost);
const publicPackage = await request('/dev-maps/vice-city-converted.zip', tunnelHost);
const packageTraversal = await request('/dev-maps/foo/../vice-city-converted.zip', tunnelHost);
const rawExport = await request('/@fs/' + resolve('dev-maps/vice-city/manifest.json').replaceAll('\\', '/'));
const raw = await request('/@fs/' + resolve('tools/vice-city-local/source-provenance.json').replaceAll('\\', '/'));
assert.equal(local, 200); assert.equal(publicAsset, 403); assert.equal(traversal, 403); assert.equal(raw, 403);
assert.equal(publicPackage, 403); assert.equal(packageTraversal, 403); assert.equal(rawExport, 403);
console.log(JSON.stringify({ localManifest: local, publicAsset, normalizedTraversal: traversal,
  publicPackage, packageTraversal, rawExport, rawWorkingFiles: raw }));
