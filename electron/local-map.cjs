'use strict';
const fs = require('node:fs');
const path = require('node:path');

function inside(root, file) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}

function safeFile(root, relative) {
  if (!root || typeof relative !== 'string' || /[\\\0:]/.test(relative)) return null;
  if (relative.split('/').some(part => part === '..' || part === '.')) return null;
  const file = path.resolve(root, relative);
  if (!inside(root, file)) return null;
  try {
    if (!fs.statSync(file).isFile()) return null;
    if (!inside(fs.realpathSync(root), fs.realpathSync(file))) return null;
    return file;
  } catch { return null; }
}

function inspectMap(directory) {
  try {
    const root = path.resolve(directory);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    if (manifest.id !== 'vice-city' || !Array.isArray(manifest.sectors) || !manifest.sectors.length) return null;
    const required = new Set(['manifest.json', manifest.file, manifest.collisionFile, manifest.minimap?.image,
      ...(manifest.files || []), ...(manifest.collisionFiles || []),
      ...manifest.sectors.flatMap(s => [s.file, s.collisionFile])]);
    if (!manifest.minimap?.image || !manifest.collisionFile || [...required].some(file => !safeFile(root, file))) return null;
    return root;
  } catch { return null; }
}

function discoverMap({ explicit, saved, bases = [], userData } = {}) {
  const candidates = [explicit, saved, userData && path.join(userData, 'maps', 'vice-city')];
  for (const base of bases.filter(Boolean)) {
    let parent = path.resolve(base);
    for (let i = 0; i < 4; i++) {
      candidates.push(path.join(parent, 'dev-maps', 'vice-city'), path.join(parent, 'maps', 'vice-city'), path.join(parent, 'vice-city'));
      const next = path.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }
  for (const directory of new Set(candidates.filter(Boolean))) {
    const root = inspectMap(directory);
    if (root) return root;
  }
  return null;
}

function resolveRequest(requestURL, dist, mapRoot) {
  try {
    const url = new URL(requestURL);
    if (url.protocol !== 'app:' || url.hostname !== 'neon-city' || url.port || url.username || url.password) return null;
    const pathname = decodeURIComponent(url.pathname);
    const prefix = '/dev-maps/vice-city/';
    if (pathname.startsWith(prefix)) return safeFile(mapRoot, pathname.slice(prefix.length));
    if (pathname.startsWith('/dev-maps/')) return null;
    return safeFile(dist, pathname === '/' ? 'index.html' : pathname.slice(1));
  } catch { return null; }
}

module.exports = { inspectMap, discoverMap, resolveRequest, safeFile };
