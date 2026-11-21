#!/usr/bin/env node
/**
 * Gera o mapa de testes "TEST CITY" (conteúdo 100% original do Neon City)
 * como GLB + manifest.json em dev-maps/test-city/.
 *
 * O objetivo é exercitar o pipeline de importação externo (GLTFLoader) com
 * características típicas de mapas de terceiros: muitos nós, malhas reusadas,
 * múltiplas primitivas, texturas PNG, prédios girados, terreno irregular,
 * escadas com colisão explícita (proxies COL_*) e objetos de calibração de escala.
 *
 * Uso: npm run build:testmap
 */
import { trafficMetadata } from './traffic-metadata.mjs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGLB } from './glb-writer.mjs';
import { makeImage } from './png.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dev-maps', 'test-city');

// ------------------------------------------------------------------ RNG
function rngFrom(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (a, b) => a + (b - a) * next(), int: (a, b) => Math.floor(a + (b - a + 1) * next()), pick: (arr) => arr[Math.floor(next() * arr.length)] };
}
const rng = rngFrom(1986);
const noise = rngFrom(7);
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

// ------------------------------------------------------------- texturas
// Convenção: y = 0 é a base visual (linha 0 da imagem = v 0 no glTF).
const TEX = {
  asphalt: { name: 'asphalt', png: makeImage(256, 256, () => { const v = 62 + noise.range(-14, 14); return [v, v, v + 4]; }) },
  concrete: {
    name: 'concrete',
    png: makeImage(256, 256, (x, y) => {
      const seam = x % 128 < 2 || y % 128 < 2;
      const v = seam ? 150 : 205 + noise.range(-12, 10);
      return [v, v - 4, v - 10];
    }),
  },
  grass: { name: 'grass', png: makeImage(256, 256, () => [clamp255(80 + noise.range(-25, 20)), clamp255(140 + noise.range(-30, 30)), clamp255(60 + noise.range(-20, 15))]) },
  stone: {
    name: 'stone',
    png: makeImage(256, 256, (x, y) => {
      const row = Math.floor(y / 32);
      const off = (row % 2) * 32;
      const seam = y % 32 < 2 || (x + off) % 64 < 2;
      const v = seam ? 150 : 222 + noise.range(-14, 10);
      return [v, v - 12, v - 30];
    }),
  },
  window: {
    // Um módulo de fachada = 3 m x 3,2 m (um pavimento).
    name: 'facade_window',
    png: makeImage(128, 128, (x, y) => {
      const inWin = x >= 22 && x < 106 && y >= 34 && y < 104;
      const frame = x >= 18 && x < 110 && y >= 30 && y < 108 && !inWin;
      const sill = y >= 26 && y < 30 && x >= 14 && x < 114;
      if (inWin) {
        // Vidro com reflexo vertical suave e um montante central.
        if (x >= 62 && x < 66) return [228, 228, 222];
        const g = 70 + (y - 34) * 1.1 + (x < 64 ? 8 : 0);
        return [clamp255(g * 0.62), clamp255(g * 0.82), clamp255(g * 1.18)];
      }
      if (frame || sill) return [238, 238, 232];
      const v = 230 + noise.range(-8, 6);
      return [v, v, v];
    }),
  },
  brick: {
    name: 'brick_window',
    png: makeImage(128, 128, (x, y) => {
      const inWin = x >= 28 && x < 100 && y >= 36 && y < 102;
      if (inWin) return [60, 74, 96];
      if (x >= 24 && x < 104 && y >= 32 && y < 106) return [230, 222, 205];
      const row = Math.floor(y / 8);
      const seam = y % 8 === 0 || (x + (row % 2) * 8) % 16 === 0;
      return seam ? [190, 182, 170] : [clamp255(168 + noise.range(-20, 15)), clamp255(78 + noise.range(-12, 10)), clamp255(58 + noise.range(-10, 10))];
    }),
  },
  hazard: { name: 'hazard', png: makeImage(64, 64, (x, y) => (((x + y) >> 4) % 2 ? [20, 20, 20] : [245, 200, 30])) },
};

// ------------------------------------------------------------ materiais
const M = {};
const mat = (name, opts) => {
  const { texture, ...rest } = opts;
  const m = new THREE.MeshStandardMaterial({ name, ...rest });
  if (texture) m.userData.texture = texture;
  M[name] = m;
  return m;
};
mat('asphalt', { color: 0xffffff, roughness: 0.95, texture: TEX.asphalt });
mat('sidewalk', { color: 0xffffff, roughness: 0.9, texture: TEX.concrete });
mat('grass', { color: 0xffffff, roughness: 1, texture: TEX.grass });
mat('plaza', { color: 0xffffff, roughness: 0.85, texture: TEX.stone });
const FACADE_COLORS = [0xf2d3c1, 0xc9e4f0, 0xf0e6b8, 0xd9cdea, 0xbfe3d0, 0xf4c2c2, 0xe8e8e8];
const facades = FACADE_COLORS.map((c, i) => mat(`facade_${i}`, { color: c, roughness: 0.85, texture: TEX.window }));
mat('brick', { color: 0xffffff, roughness: 0.9, texture: TEX.brick });
mat('roof', { color: 0x5a5c63, roughness: 0.9 });
mat('cornice', { color: 0xf3f0e8, roughness: 0.7 });
mat('door', { color: 0x3a2a22, roughness: 0.6 });
mat('metal', { color: 0x40454d, roughness: 0.45, metalness: 0.7 });
mat('lampGlass', { color: 0xfff1c8, emissive: 0xffd890, emissiveIntensity: 1, roughness: 0.3 });
mat('paint', { color: 0xf4f2ea, roughness: 0.7 });
mat('trunk', { color: 0x7b5a3c, roughness: 0.95 });
mat('leaves', { color: 0x4f8f3a, roughness: 0.9 });
mat('wood', { color: 0xb5814f, roughness: 0.8 });
mat('water', { color: 0x3aa7c9, roughness: 0.15, metalness: 0.1 });
mat('cone', { color: 0xf26b1d, roughness: 0.6 });
mat('concrete', { color: 0xc8c4bb, roughness: 0.9 });
mat('hazard', { color: 0xffffff, roughness: 0.6, texture: TEX.hazard });
mat('scaleRed', { color: 0xd8342c, roughness: 0.6 });

// ------------------------------------------------------------ geometrias
const geoCache = new Map();
/** Caixa com base em y=0 e UVs em metros (tileU x tileV). */
function box(w, h, d, tileU = 0, tileV = 0) {
  const key = `box|${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${tileU}|${tileV}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.BoxGeometry(w, h, d);
  if (tileU && tileV) {
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, (uv.getX(i) * dims[f][0]) / tileU, (uv.getY(i) * dims[f][1]) / tileV);
      }
    }
  }
  g.translate(0, h / 2, 0);
  geoCache.set(key, g);
  return g;
}
function cyl(rTop, rBottom, h, seg = 12) {
  const key = `cyl|${rTop}|${rBottom}|${h}|${seg}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg).translate(0, h / 2, 0);
  geoCache.set(key, g);
  return g;
}
function sphere(r, w = 10, h = 8) {
  const key = `sph|${r}|${w}|${h}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.SphereGeometry(r, w, h);
  geoCache.set(key, g);
  return g;
}

// ------------------------------------------------------------- cena
const root = new THREE.Group();
root.name = 'TEST_CITY';
let nodeCount = 0;

function meshNode(name, geometry, material, parent, x = 0, y = 0, z = 0, ry = 0, extras = null) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.position.set(x, y, z);
  m.rotation.y = ry;
  if (extras) Object.assign(m.userData, extras);
  parent.add(m);
  nodeCount++;
  return m;
}
/** Nó com malha de múltiplas primitivas (reutilizável). */
function multiNode(name, meshName, parts, parent, x, y, z, ry = 0, extras = null) {
  const g = new THREE.Object3D();
  g.name = name;
  g.position.set(x, y, z);
  g.rotation.y = ry;
  g.userData.__primitives = parts;
  g.userData.__meshName = meshName;
  if (extras) Object.assign(g.userData, extras);
  parent.add(g);
  nodeCount++;
  return g;
}
function group(name, parent, x = 0, y = 0, z = 0, ry = 0, extras = null) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  g.rotation.y = ry;
  if (extras) Object.assign(g.userData, extras);
  parent.add(g);
  nodeCount++;
  return g;
}
/** Proxy de colisão invisível (o carregador não o renderiza). */
function colliderProxy(name, parent, kind, w, h, d, x, y, z, ry = 0, extra = {}) {
  return meshNode(`COL_${name}`, box(w, h, d), M.concrete, parent, x, y, z, ry, { collider: kind, ...extra });
}

// ----------------------------------------------------------- layout
const STREETS = [-100, -50, 0, 50, 100];
const STREET_W = 10;
const BLOCK_CENTERS = [-75, -25, 25, 75];
const HALF_BLOCK = 20;
const SLAB_H = 0.15;
const BOUND = 108;
const PARK = { cx: 75, cz: 75, minX: 55, maxX: 95, minZ: 55, maxZ: 95 };

const hillHeight = (x, z) => {
  const r = Math.hypot(x - PARK.cx, z - PARK.cz) / 17;
  if (r >= 1) return 0;
  const c = Math.cos(r * Math.PI * 0.5);
  return 4.5 * c * c;
};

// Chão principal (com buraco onde fica o parque).
{
  const size = 260, cell = 4, n = size / cell;
  const geos = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = -size / 2 + i * cell, z0 = -size / 2 + j * cell;
      if (x0 >= PARK.minX && x0 + cell <= PARK.maxX && z0 >= PARK.minZ && z0 + cell <= PARK.maxZ) continue;
      const q = new THREE.PlaneGeometry(cell, cell).rotateX(-Math.PI / 2).translate(x0 + cell / 2, 0, z0 + cell / 2);
      const uv = q.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (x0 + uv.getX(k) * cell) / 8, (z0 + (1 - uv.getY(k)) * cell) / 8);
      geos.push(q);
    }
  }
  const ground = mergeGeometries(geos, false);
  meshNode('GROUND_streets', ground, M.asphalt, root, 0, 0, 0, 0, { ground: true, surface: 'asphalt', castShadow: false });
}
// Parque com colina (terreno irregular).
{
  const w = PARK.maxX - PARK.minX, seg = 40;
  const g = new THREE.PlaneGeometry(w, w, seg, seg).rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) + PARK.cx, z = pos.getZ(k) + PARK.cz;
    pos.setY(k, hillHeight(x, z));
    uv.setXY(k, x / 6, z / 6);
  }
  g.computeVertexNormals();
  meshNode('GROUND_park_hill', g, M.grass, root, PARK.cx, 0, PARK.cz, 0, { ground: true, surface: 'grass', castShadow: false });
}

// Faixas tracejadas e faixas de pedestres (muitos objetos pequenos: teste de agrupamento).
const markings = group('ROAD_MARKINGS', root);
for (const s of STREETS) {
  for (let t = -104; t < 104; t += 9) {
    if (STREETS.some((c) => Math.abs(t + 1.5 - c) < 7)) continue;
    meshNode('dash', box(0.18, 0.02, 3), M.paint, markings, s, 0.005, t + 1.5, 0, { collide: false, castShadow: false });
    meshNode('dash', box(3, 0.02, 0.18), M.paint, markings, t + 1.5, 0.005, s, 0, { collide: false, castShadow: false });
  }
}
for (const sx of [0, 50]) {
  for (const sz of [0, -50]) {
    for (let k = 0; k < 7; k++) {
      meshNode('crosswalk', box(0.6, 0.02, 3), M.paint, markings, sx - 3.6 + k * 1.2, 0.006, sz + 7, 0, { collide: false, castShadow: false });
      meshNode('crosswalk', box(3, 0.02, 0.6), M.paint, markings, sx + 7, 0.006, sz - 3.6 + k * 1.2, 0, { collide: false, castShadow: false });
    }
  }
}

// Mobiliário reutilizável (malhas compartilhadas => teste de instanciamento).
const LAMP = [
  { geometry: mergeGeometries([cyl(0.09, 0.12, 6), box(0.08, 0.08, 1.4).clone().translate(0, 5.8, 0.65)]), material: M.metal },
  { geometry: box(0.5, 0.22, 0.32).clone().translate(0, 5.65, 1.3), material: M.lampGlass },
];
const TREE = [
  { geometry: cyl(0.16, 0.24, 3.2, 8), material: M.trunk },
  { geometry: sphere(2.1, 10, 8).clone().scale(1, 0.85, 1).translate(0, 4.6, 0), material: M.leaves },
];
const BENCH = [
  { geometry: mergeGeometries([box(1.8, 0.06, 0.45).clone().translate(0, 0.42, 0), box(1.8, 0.4, 0.06).clone().translate(0, 0.5, -0.22)]), material: M.wood },
  { geometry: mergeGeometries([box(0.06, 0.42, 0.42).clone().translate(-0.8, 0, 0), box(0.06, 0.42, 0.42).clone().translate(0.8, 0, 0)]), material: M.metal },
];
const BOLLARD = [{ geometry: cyl(0.12, 0.14, 0.9, 10), material: M.concrete }];
const BIN = [{ geometry: cyl(0.3, 0.28, 1.0, 12), material: M.metal }];
const CRATE = [{ geometry: box(1, 1, 1, 1, 1), material: M.wood }];
const BARREL = [{ geometry: cyl(0.32, 0.32, 0.95, 12), material: M.cone }];
const CONE = [{ geometry: cyl(0.03, 0.22, 0.7, 10), material: M.cone }];
const JERSEY = [{ geometry: mergeGeometries([box(2.9, 0.35, 0.6), box(2.9, 0.55, 0.22).clone().translate(0, 0.35, 0)]), material: M.concrete }];
const AC = [{ geometry: box(1.4, 0.9, 1.0), material: M.metal }];

const props = group('PROPS', root);
let propId = 0;
const place = (kind, parts, x, y, z, ry = 0, extras = null) => multiNode(`${kind}_${propId++}`, kind, parts, props, x, y, z, ry, extras);

// Quarteirões: calçada elevada (laje) + conteúdo.
const blocks = group('BLOCKS', root);
const buildings = group('BUILDINGS', root);
let bldId = 0;

function building(parent, x, z, w, d, h, ry = 0, opts = {}) {
  const g = group(`BLD_${bldId++}`, parent, x, SLAB_H, z, ry, opts.extras || null);
  const facade = opts.material || rng.pick(facades);
  meshNode('body', box(w, h, d, 3, 3.2), facade, g, 0, 0, 0);
  meshNode('cornice', box(w + 0.6, 0.45, d + 0.6), M.cornice, g, 0, h, 0);
  meshNode('roof', box(w - 0.4, 0.06, d - 0.4), M.roof, g, 0, h + 0.45, 0, 0, { collide: false });
  meshNode('door', box(1.6, 2.2, 0.12), M.door, g, 0, 0, d / 2 + 0.03, 0, { collide: false });
  let top = h + 0.45;
  if (h > 30) {
    const sw = w * 0.6, sd = d * 0.6, sh = rng.range(6, 14);
    meshNode('setback', box(sw, sh, sd, 3, 3.2), facade, g, 0, top, 0);
    meshNode('cornice2', box(sw + 0.5, 0.4, sd + 0.5), M.cornice, g, 0, top + sh, 0);
    top += sh + 0.4;
    if (rng.next() < 0.6) meshNode('spire', cyl(0.05, 0.4, 8, 8), M.metal, g, 0, top, 0, 0, { collide: false });
  }
  const acs = Math.max(1, Math.round((w * d) / 120));
  for (let i = 0; i < acs; i++) {
    multiNode(`ac_${i}`, 'ac_unit', AC, g, rng.range(-w / 2 + 1.5, w / 2 - 1.5), h + 0.51, rng.range(-d / 2 + 1.5, d / 2 - 1.5), 0, { collide: false });
  }
  return g;
}

for (const bx of BLOCK_CENTERS) {
  for (const bz of BLOCK_CENTERS) {
    const isPark = bx === PARK.cx && bz === PARK.cz;
    if (!isPark) {
      meshNode(`SLAB_${bx}_${bz}`, box(40, SLAB_H, 40, 3, 3), M.sidewalk, blocks, bx, 0, bz, 0, { surface: 'concrete', castShadow: false, cameraBlocker: false });
    }
    // Postes e lixeiras na borda das calçadas.
    const isPlaza = bx === -25 && bz === -25;
    for (let k = -1; k <= 1; k += 2) {
      for (let t = -15; t <= 15; t += 15) {
        if (isPark) continue;
        place('lamp', LAMP, bx + t, SLAB_H, bz + k * 18.8, k > 0 ? 0 : Math.PI);
        // A borda leste da praça recebe a rampa: sem postes ali.
        if (isPlaza && k > 0) continue;
        place('lamp', LAMP, bx + k * 18.8, SLAB_H, bz + t + 7.5, k > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
      if (!isPark) place('bin', BIN, bx + k * 18.6, SLAB_H, bz + 12.5);
    }
    for (const [cx, cz] of [[-19.3, -19.3], [19.3, -19.3], [-19.3, 19.3], [19.3, 19.3]]) {
      if (!isPark) place('bollard', BOLLARD, bx + cx, SLAB_H, bz + cz);
    }
  }
}

// --- Quarteirões especiais ------------------------------------------------
// PRAÇA ELEVADA (-25, -25): plataforma de 1,5 m, escada (proxy de rampa), rampa, fonte e obelisco.
{
  const px = -25, pz = -25, ph = 1.5, top = SLAB_H + ph, P = 12; // plataforma 24 x 24
  const plaza = group('PLAZA', root, 0, 0, 0);
  meshNode('platform', box(2 * P, ph, 2 * P), M.plaza, plaza, px, SLAB_H, pz, 0, { surface: 'stone' });
  // Escada ao sul (desce em direção a +Z): degraus visuais + rampa de colisão
  // cujo topo coincide com a borda da plataforma.
  const steps = 6, run = 0.45, rise = ph / steps, stairLen = steps * run;
  for (let i = 0; i < steps; i++) {
    meshNode(`step_${i}`, box(8, rise * (steps - i), run), M.plaza, plaza, px, SLAB_H, pz + P + run * (i + 0.5), 0, { collide: false });
  }
  colliderProxy('plaza_stairs', plaza, 'ramp', stairLen, ph, 8, px, SLAB_H, pz + P + stairLen / 2, Math.PI / 2, { surface: 'stone' });
  // Rampa acessível a leste (sobe em direção a -X), dentro do quarteirão.
  const rampLen = 7.6;
  const slope = Math.atan2(ph, rampLen);
  const rampVis = meshNode('ramp_visual', box(Math.hypot(rampLen, ph), 0.2, 3), M.plaza, plaza, px + P + rampLen / 2, SLAB_H + ph / 2 - 0.1, pz + 6, 0, { collide: false });
  rampVis.rotation.z = -slope;
  colliderProxy('plaza_ramp', plaza, 'ramp', rampLen, ph, 3, px + P + rampLen / 2, SLAB_H, pz + 6, Math.PI, { surface: 'stone' });
  for (let i = 0; i <= 5; i++) meshNode('ramp_rail', box(0.08, 1.0 + (ph * (5 - i)) / 5, 0.08), M.metal, plaza, px + P + (rampLen * i) / 5, SLAB_H, pz + 7.6, 0, { collide: false });
  // Fonte e obelisco no topo.
  meshNode('fountain_basin', cyl(3.2, 3.4, 0.7, 24), M.concrete, plaza, px, top, pz);
  meshNode('fountain_water', cyl(2.9, 2.9, 0.05, 24), M.water, plaza, px, top + 0.6, pz, 0, { collide: false });
  meshNode('obelisk', box(1.4, 14, 1.4), M.cornice, plaza, px + 9, top, pz - 9);
  meshNode('obelisk_tip', cyl(0.02, 1.0, 2, 4), M.cornice, plaza, px + 9, top + 14, pz - 9, Math.PI / 4, { collide: false });
  for (let i = 0; i < 8; i++) place('bench', BENCH, px - 8 + (i % 4) * 5.3, top, pz + (i < 4 ? 8 : -8), i < 4 ? Math.PI : 0);
}

// GALERIA COM PILOTIS (25, -25): massa superior a partir de 4,5 m sobre pilares.
{
  const g = group('ARCADE', buildings, 25, SLAB_H, -25);
  const w = 30, d = 16, base = 4.5, h = 16;
  meshNode('upper_mass', box(w, h, d, 3, 3.2), facades[1], g, 0, base, 6);
  meshNode('upper_cornice', box(w + 0.6, 0.45, d + 0.6), M.cornice, g, 0, base + h, 6);
  meshNode('ceiling', box(w, 0.3, d), M.cornice, g, 0, base - 0.3, 6);
  for (let i = 0; i <= 6; i++) {
    for (const zz of [-1.6, 13.6]) meshNode(`pillar_${i}_${zz}`, box(0.6, base - 0.3, 0.6), M.cornice, g, -w / 2 + 0.4 + i * ((w - 0.8) / 6), 0, zz);
  }
  // Fundo da galeria ao norte: o lado sul (rua) fica aberto entre os pilares.
  meshNode('shop_back', box(w - 2, base - 0.3, 0.3, 3, 3.2), M.brick, g, 0, 0, -1.2);
  building(buildings, 25 + 9, -25 - 12, 12, 10, 42);
}

// PRÉDIOS GIRADOS (-75, 25): caixas orientadas (OBB).
{
  building(buildings, -82, 18, 14, 10, 14, THREE.MathUtils.degToRad(20));
  building(buildings, -66, 34, 12, 12, 26, THREE.MathUtils.degToRad(-35));
  building(buildings, -84, 34, 8, 14, 9, THREE.MathUtils.degToRad(45), { material: M.brick });
}

// BECO ESTREITO + PRÉDIO EM "L" (25, 25).
{
  building(buildings, 25, 13, 34, 9, 18);
  building(buildings, 25, 25.5, 34, 9, 12, 0, { material: M.brick }); // vão de 3,5 m entre eles
  const L = group('BLD_L', buildings, 25, SLAB_H, 40);
  meshNode('wing_a', box(20, 10, 6, 3, 3.2), facades[4], L, -6, 0, 0);
  meshNode('wing_b', box(6, 10, 10, 3, 3.2), facades[4], L, 7, 0, -2);
  meshNode('cornice_a', box(20.6, 0.4, 6.6), M.cornice, L, -6, 10, 0);
  meshNode('cornice_b', box(6.6, 0.4, 10.6), M.cornice, L, 7, 10, -2);
  for (let i = 0; i < 6; i++) place('crate', CRATE, 12 + (i % 3) * 1.1, SLAB_H + Math.floor(i / 3), 19.2, rng.range(-0.2, 0.2));
  for (let i = 0; i < 4; i++) place('barrel', BARREL, 34 + i * 0.8, SLAB_H, 19.5);
}

// CALIBRAÇÃO DE ESCALA (-25, 25): cubos de 1 m, porta de 2,2 m, parede de 3,2 m e haste de 1,8 m.
{
  const s = group('SCALE_REFERENCE', root, -20, SLAB_H, 10);
  for (let i = 0; i < 3; i++) meshNode(`cube_1m_${i}`, box(1, 1, 1, 1, 1), M.hazard, s, 0, i, 0);
  meshNode('door_post_l', box(0.15, 2.2, 0.15), M.scaleRed, s, 3, 0, 0);
  meshNode('door_post_r', box(0.15, 2.2, 0.15), M.scaleRed, s, 4.1, 0, 0);
  meshNode('door_lintel', box(1.25, 0.15, 0.15), M.scaleRed, s, 3.55, 2.2, 0);
  meshNode('wall_3m2', box(3, 3.2, 0.3, 3, 3.2), facades[6], s, 7, 0, 0);
  for (let m = 1; m <= 3; m++) meshNode(`meter_${m}`, box(3.05, 0.04, 0.35), M.scaleRed, s, 7, m, 0, 0, { collide: false });
  meshNode('human_height_1m80', box(0.1, 1.8, 0.1), M.scaleRed, s, 10, 0, 0);
  building(buildings, -32, 25, 22, 18, 22);
}

// QUARTEIRÕES GENÉRICOS.
const special = new Set(['-25,-25', '25,-25', '-75,25', '25,25', '-25,25', `${PARK.cx},${PARK.cz}`]);
for (const bx of BLOCK_CENTERS) {
  for (const bz of BLOCK_CENTERS) {
    if (special.has(`${bx},${bz}`)) continue;
    const pattern = rng.int(0, 2);
    if (pattern === 0) {
      for (const [ox, oz] of [[-8.5, -8.5], [8.5, -8.5], [-8.5, 8.5], [8.5, 8.5]]) {
        building(buildings, bx + ox, bz + oz, rng.range(11, 14), rng.range(11, 14), rng.pick([8, 12, 18, 24, 36, 48]));
      }
    } else if (pattern === 1) {
      building(buildings, bx - 7, bz, 16, 16, rng.range(40, 62));
      building(buildings, bx + 10, bz - 9, 10, 14, rng.range(9, 16));
      building(buildings, bx + 10, bz + 9, 10, 14, rng.range(9, 16), 0, { material: M.brick });
    } else {
      building(buildings, bx, bz - 8.5, 32, 14, rng.range(14, 30));
      building(buildings, bx, bz + 9.5, 32, 12, rng.range(10, 22), Math.PI);
    }
  }
}

// PARQUE: árvores na colina e bancos.
for (let i = 0; i < 46; i++) {
  const x = rng.range(PARK.minX + 2, PARK.maxX - 2), z = rng.range(PARK.minZ + 2, PARK.maxZ - 2);
  if (Math.hypot(x - PARK.cx, z - PARK.cz) < 4) continue;
  place('tree', TREE, x, hillHeight(x, z) - 0.05, z, rng.range(0, 6), { cameraBlocker: false });
}
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2, x = PARK.cx + Math.cos(a) * 19, z = PARK.cz + Math.sin(a) * 19;
  place('bench', BENCH, x, hillHeight(x, z), z, -a - Math.PI / 2);
}
// Obras: cones e barreiras.
for (let i = 0; i < 12; i++) place('cone', CONE, -52 + (i % 2) * 1.5, 0, 14 + 1.2 * i);
// Limite físico: barreiras de concreto + paredes invisíveis.
for (let t = -BOUND + 1.5; t <= BOUND - 1.5; t += 3) {
  place('jersey', JERSEY, t, 0, -BOUND + 0.4);
  place('jersey', JERSEY, t, 0, BOUND - 0.4);
  place('jersey', JERSEY, -BOUND + 0.4, 0, t, Math.PI / 2);
  place('jersey', JERSEY, BOUND - 0.4, 0, t, Math.PI / 2);
}
const bounds = group('BOUNDS', root);
colliderProxy('north', bounds, 'box', 2 * BOUND + 8, 30, 4, 0, -2, -BOUND - 2, 0, { cameraBlocker: false });
colliderProxy('south', bounds, 'box', 2 * BOUND + 8, 30, 4, 0, -2, BOUND + 2, 0, { cameraBlocker: false });
colliderProxy('west', bounds, 'box', 4, 30, 2 * BOUND + 8, -BOUND - 2, -2, 0, 0, { cameraBlocker: false });
colliderProxy('east', bounds, 'box', 4, 30, 2 * BOUND + 8, BOUND + 2, -2, 0, 0, { cameraBlocker: false });

// ------------------------------------------------------------- exportar
root.updateMatrixWorld(true);
let tris = 0;
root.traverse((o) => {
  const parts = o.userData.__primitives || (o.isMesh ? [{ geometry: o.geometry }] : []);
  for (const p of parts) tris += (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3;
});
const { glb, summary } = exportGLB(root, { copyright: 'Neon City: 1986 — conteúdo original (mapa de testes)' });
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'test-city.glb'), glb);
const manifest = {
  id: 'test-city',
  label: 'TEST CITY',
  file: 'test-city.glb',
  units: 'meters',
  scale: 1,
  spawn: { x: 0, y: 0, z: 15, yaw: 0 },
  bounds: { minX: -BOUND, maxX: BOUND, minZ: -BOUND, maxZ: BOUND },
  heightfieldCell: 0.5,
  source: 'Gerado por tools/test-map/build-test-map.mjs (conteúdo original do Neon City)',
  license: 'Original — uso interno de testes',
  // Metadados opcionais de trânsito/pedestres (não alteram o modelo 3D).
  ...trafficMetadata({ streets: STREETS, bound: BOUND }),
  generated: { nodes: summary.nodes, meshes: summary.meshes, primitives: summary.primitives, materials: summary.materials, textures: summary.textures, triangles: Math.round(tris), bytes: glb.length },
};
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`TEST CITY gerado em ${OUT_DIR}`);
console.log(JSON.stringify(manifest.generated));
