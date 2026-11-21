import * as THREE from 'three';
import { InteriorBuilder, mat, glow } from '../interiors/InteriorKit.js';
import { neonTextTexture, createSignMesh } from '../world/NeonSign.js';

/**
 * Locais marítimos originais (coordenadas do mundo; o mar começa em x≈93).
 * Construídos com o mesmo kit modular dos interiores (geometria fundida por
 * material, colisores declarados junto com cada peça).
 */
export const MARINAS = {
  sunset: { id: 'sunset_marina', name: 'SUNSET MARINA', pierZ: -120, x0: 70, x1: 152, deckY: 0.55, fingers: [110, 125, 140],
    office: { x: 76, z: -134, rotY: Math.PI / 2 }, storage: { x: 147.5, z: -113, heading: Math.PI / 2 } },
  azure: { id: 'azure_docks', name: 'AZURE DOCKS', pierZ: -282, x0: 70, x1: 134, deckY: 0.55, fingers: [112, 126],
    warehouse: { x: 70, z: -296 } },
};

export const ISLANDS = [
  { id: 'coral_island', name: 'CORAL ISLAND', x: 300, z: -40, r: 26, top: 0.6, pier: { side: Math.PI, len: 16 } },
  { id: 'hidden_cove', name: 'HIDDEN COVE', x: 330, z: 120, r: 22, top: 0.55, cove: { dx: 14, dz: 6, r: 11 }, pier: { side: Math.PI * 0.75, len: 12 } },
  { id: 'lighthouse_point', name: 'LIGHTHOUSE POINT', x: 420, z: -240, r: 16, top: 0.9, pier: { side: Math.PI * 0.9, len: 14 } },
];

/** Limites do mar navegável (substituem a parede invisível da arrebentação). */
export const SEA = { minX: 110, maxX: 600 };

const M = {
  wood: () => mat(0x8a6a4a, 0.85), woodDark: () => mat(0x5a4030, 0.85), pile: () => mat(0x4a3a2c, 0.9),
  white: () => mat(0xf2ece2, 0.6), rope: () => mat(0xd8c8a0, 0.9), orange: () => mat(0xff7a2a, 0.5), metal: () => mat(0x8a96a4, 0.4, 0.6),
  sand: () => mat(0xe8d6a6, 0.95), rock: () => mat(0x7a7a80, 0.95), roofRed: () => mat(0xc8443a, 0.7), teal: () => mat(0x2f8f83, 0.6),
};

function lamp(b, x, z, y) {
  b.cyl(M.metal(), x, y, z, 0.05, 0.07, 3.2, 8);
  b.sphere(glow(0xffe2b0, 2.2), x, y + 3.3, z, 0.18, 10);
  b.pool(x, z, 3.5, 0xffe2b0);
  b.lightPools[b.lightPools.length - 1].y = y + 0.03;
}

/** Píer com tábuas, estacas, defensas, cunhos, postes e dedos (vagas). */
export function buildMarina(m, ctx) {
  const b = new InteriorBuilder();
  const { pierZ: z, x0, x1, deckY: y } = m;
  const w = 3.4;
  // Rampa curta a partir da areia (degraus menores que a altura de passo do jogador).
  b.box(M.woodDark(), x0 - 2, 0, z, 4, 0.3, w, { r: 0, collide: true, walkable: true });
  b.box(M.wood(), (x0 + x1) / 2, y - 0.2, z, x1 - x0, 0.2, w, { r: 0, collide: true, walkable: true });
  for (let x = x0 + 2; x < x1; x += 0.6) b.box(M.woodDark(), x, y, z, 0.04, 0.012, w - 0.1, { r: 0 });
  for (let x = x0; x <= x1; x += 6) for (const s of [-1, 1]) b.cyl(M.pile(), x, -3, z + s * (w / 2 - 0.1), 0.15, 0.15, 3 + y + 0.25, 8, { collide: true });
  for (let x = x0 + 4; x < x1; x += 12) { lamp(b, x, z + w / 2 - 0.2, y); }
  for (let x = x0 + 10; x < x1; x += 8) for (const s of [-1, 1]) { b.cyl(M.metal(), x, y, z + s * (w / 2 - 0.15), 0.08, 0.1, 0.32, 8); }
  // Dedos (vagas): cada um gera duas vagas.
  const slips = [];
  for (const fx of m.fingers) for (const s of [-1, 1]) {
    const len = 9;
    b.box(M.wood(), fx, y - 0.2, z + s * (w / 2 + len / 2), 2.0, 0.2, len, { r: 0, collide: true, walkable: true });
    for (let k = 0; k <= len; k += 4.5) b.cyl(M.pile(), fx + 0.9, -3, z + s * (w / 2 + k), 0.12, 0.12, 3 + y + 0.2, 8, { collide: true });
    for (let k = 1; k < len; k += 3) b.box(M.orange(), fx + 1.05, y - 0.35, z + s * (w / 2 + k), 0.12, 0.35, 0.5, { r: 0.04 });
    slips.push({ x: fx + 5.5, z: z + s * (w / 2 + len / 2), heading: s > 0 ? 0 : Math.PI });
  }
  // Boias flutuantes e salva-vidas.
  for (let x = x0 + 30; x < x1 + 20; x += 9) b.sphere(M.orange(), x, -0.15, z + 14, 0.35, 10);
  b.cyl(M.orange(), x1 - 1, y + 0.4, z + w / 2 - 0.05, 0.32, 0.32, 0.08, 14, { rx: Math.PI / 2 });
  const built = b.build();
  ctx.group.add(built.group);
  for (const p of b.lightPools) ctx.pools.push(p);
  return { colliders: b.colliders, slips };
}

export function buildOffice(o, name, ctx) {
  const b = new InteriorBuilder();
  const { x, z } = o;
  b.box(M.white(), x, 0.1, z, 6, 3.0, 5, { r: 0.04, collide: true });
  b.box(M.teal(), x, 3.1, z, 6.6, 0.25, 5.6, { r: 0.04 });
  b.box(glow(0xffe2b0, 0.8), x + 3.02, 1.2, z, 0.02, 1.2, 3.6, { r: 0 });
  b.box(M.teal(), x + 3.05, 0.6, z + 1.6, 0.06, 0.06, 1.2, { r: 0 });
  b.box(M.woodDark(), x + 3.6, 0.1, z, 1.2, 0.9, 2.4, { r: 0.03, collide: true });
  b.box(M.white(), x + 3.6, 1.0, z, 1.3, 0.05, 2.5, { r: 0.01 });
  const built = b.build();
  ctx.group.add(built.group);
  const tex = neonTextTexture(name.replace(/^(\w)(\w*)\s(\w)(\w*)$/, (m0, a, bb, c, d) => `${a}${bb.toLowerCase()} ${c}${d.toLowerCase()}`), { color: '#45f3ff', style: 'script', sub: 'BARCOS · VAGAS · ARMAZÉM' });
  const sign = createSignMesh(tex, 4.2, 1.05, { intensity: 1.6, backing: 0x10161c, backingDepth: 0.08 });
  sign.group.position.set(x + 3.15, 3.0, z);
  sign.group.rotation.y = Math.PI / 2;
  ctx.group.add(sign.group);
  return { colliders: b.colliders, counter: { x: x + 4.6, z } };
}

export function buildWarehouse(o, ctx) {
  const b = new InteriorBuilder();
  b.box(mat(0x9fb0c0, 0.8, 0.2), o.x, 0.1, o.z, 10, 5, 8, { r: 0.03, collide: true });
  b.box(mat(0x6a7886, 0.6, 0.3), o.x, 5.1, o.z, 10.6, 0.3, 8.6, { r: 0.03 });
  b.box(mat(0x7a8a98, 0.5, 0.5), o.x + 5.02, 0.1, o.z, 0.04, 3.6, 4.4, { r: 0 });
  for (let k = 0; k < 10; k++) b.box(mat(0x5a6878, 0.5, 0.5), o.x + 5.05, 0.3 + k * 0.34, o.z, 0.03, 0.03, 4.4, { r: 0 });
  for (let k = 0; k < 4; k++) b.box(M.woodDark(), o.x + 6.5 + (k % 2) * 1.1, 0.1 + Math.floor(k / 2) * 0.8, o.z - 3, 1, 0.8, 1, { r: 0.03, collide: k < 2 });
  lamp(b, o.x + 6, o.z + 4.4, 0.1);
  const built = b.build();
  ctx.group.add(built.group);
  for (const p of b.lightPools) ctx.pools.push(p);
  const tex = neonTextTexture('Azure Docks', { color: '#ffe95a', style: 'block', sub: 'PESCA · ARMAZÉM' });
  const sign = createSignMesh(tex, 4.4, 1.1, { intensity: 1.4, backing: 0x10161c, backingDepth: 0.08 });
  sign.group.position.set(o.x + 5.1, 4.2, o.z);
  sign.group.rotation.y = Math.PI / 2;
  ctx.group.add(sign.group);
  return { colliders: b.colliders };
}

// ------------------------------------------------------------ ilhas
function palm(b, x, z, y, h = 5.5, seed = 0) {
  const lean = 0.15 + (seed % 3) * 0.06, dir = seed * 1.7;
  for (let k = 0; k < 6; k++) {
    const t = k / 6;
    b.cyl(mat(0x8a6a4a, 0.9), x + Math.cos(dir) * lean * h * t * t, y + t * h, z + Math.sin(dir) * lean * h * t * t, 0.16 - t * 0.05, 0.18 - t * 0.05, h / 6 + 0.02, 7);
  }
  const tx = x + Math.cos(dir) * lean * h, tz = z + Math.sin(dir) * lean * h, ty = y + h;
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + seed;
    b._add(new THREE.BoxGeometry(2.4, 0.03, 0.5), mat(0x3f8f4a, 0.7), tx + Math.cos(a) * 1.1, ty - 0.25, tz + Math.sin(a) * 1.1, 0, -a, -0.35);
  }
  b.collider(x, z, 0.4, 0.4, y, y + h);
}

function rock(b, x, z, y, s, collide = true) {
  b._add(new THREE.DodecahedronGeometry(s, 0), M.rock(), x, y + s * 0.4, z, s, s * 2, 0);
  if (collide) b.collider(x, z, s * 1.4, s * 1.4, y - 2, y + s * 1.2);
}

/** Malha do relevo (mesma função de fundo usada pela colisão e pela profundidade). */
function islandMesh(is, water) {
  const R = is.r + 14, step = 1.4;
  const n = Math.ceil((R * 2) / step) + 1;
  const pos = [], col = [], idx = [];
  const sand = new THREE.Color(0xe8d6a6), grass = new THREE.Color(0x4f9a52), wet = new THREE.Color(0xb8a27a);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = is.x - R + i * step, z = is.z - R + j * step;
    const y = Math.max(water.level - 2.5, water.seabed(x, z));
    pos.push(x, y, z);
    const c = y > is.top - 0.05 ? grass : y > water.level + 0.05 ? sand : wet;
    col.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b2 = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b2, b2, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  m.receiveShadow = true;
  return m;
}

/** Anel de espuma animado na linha d'água da ilha. */
function foamRing(is, water) {
  // Segue a linha d'água real (a borda da ilha é irregular): por ângulo, busca
  // binária do raio onde o relevo cruza o nível do mar.
  const N = 96, pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    let lo = 0, hi = is.r + 30;
    for (let k = 0; k < 22; k++) {
      const m = (lo + hi) / 2;
      if (water.seabed(is.x + ca * m, is.z + sa * m) > water.level) lo = m; else hi = m;
    }
    const r0 = Math.max(0.5, lo - 1.4), r1 = lo + 2.2;
    pos.push(ca * r0, 0, sa * r0, ca * r1, 0, sa * r1);
    if (i < N) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mtl = new THREE.MeshBasicMaterial({ color: 0xfdf7ee, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(g, mtl);
  m.position.set(is.x, water.level + 0.04, is.z);
  m.renderOrder = 2;
  return m;
}

export function buildIsland(def, water, ctx) {
  const is = water.addIsland({ x: def.x, z: def.z, r: def.r, top: def.top });
  if (def.cove) {
    const c = { x: def.x + def.cove.dx, z: def.z + def.cove.dz, r: def.cove.r };
    const base = is.floor;
    is.floor = (px, pz, d) => {
      const dc = Math.hypot(px - c.x, pz - c.z);
      const f = base(px, pz, d);
      if (dc < c.r) return Math.min(f, water.level - 0.3 - (c.r - dc) * 0.12); // enseada rasa e abrigada
      if (dc < c.r + 5) return Math.min(f, water.level + 0.08 + (dc - c.r) * 0.1); // praia interna
      return f;
    };
  }
  ctx.group.add(islandMesh(is, water));
  const ring = foamRing(is, water);
  ctx.group.add(ring);
  ctx.animated.push((dt, t) => { ring.material.opacity = 0.32 + Math.sin(t * 1.3 + def.x) * 0.12; ring.scale.setScalar(1 + Math.sin(t * 0.9) * 0.012); });
  const b = new InteriorBuilder();
  const top = (x, z) => water.seabed(x, z);
  // Vegetação e rochas (posições pseudoaleatórias estáveis).
  let s = Math.abs(Math.floor(def.x * 13 + def.z * 7));
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < Math.round(def.r * 0.45); k++) {
    const a = rnd() * Math.PI * 2, d = rnd() * (def.r - 9);
    const x = def.x + Math.cos(a) * d, z = def.z + Math.sin(a) * d;
    if (top(x, z) > water.level + 0.3) palm(b, x, z, top(x, z), 4.5 + rnd() * 2.5, k);
  }
  for (let k = 0; k < 8; k++) {
    const a = rnd() * Math.PI * 2, d = def.r - 2 + rnd() * 5;
    const x = def.x + Math.cos(a) * d, z = def.z + Math.sin(a) * d;
    rock(b, x, z, Math.max(water.level - 0.6, top(x, z)), 0.8 + rnd() * 1.4);
  }
  // Trilha (faixa mais escura de areia batida) cruzando a ilha até o píer.
  const pa = def.pier.side;
  for (let d = -def.r + 6; d < def.r - 6; d += 1.6) {
    const x = def.x + Math.cos(pa) * d, z = def.z + Math.sin(pa) * d;
    b.box(mat(0xc8b48a, 0.95), x, top(x, z) + 0.01, z, 1.4, 0.02, 1.7, { r: 0, ry: -pa });
  }
  // Píer de desembarque (até águas fundas o bastante para os barcos).
  const px0 = def.x + Math.cos(pa) * (def.r - 3), pz0 = def.z + Math.sin(pa) * (def.r - 3);
  const len = def.pier.len + 4;
  const pcx = px0 + Math.cos(pa) * len / 2, pcz = pz0 + Math.sin(pa) * len / 2;
  b.box(M.wood(), pcx, 0.35, pcz, len, 0.2, 2.6, { r: 0, ry: -pa, collide: true, walkable: true });
  for (let k = 0; k <= len; k += 4) for (const sd of [-1, 1]) {
    const x = px0 + Math.cos(pa) * k - Math.sin(pa) * sd * 1.1, z = pz0 + Math.sin(pa) * k + Math.cos(pa) * sd * 1.1;
    b.cyl(M.pile(), x, -3, z, 0.12, 0.12, 3.75, 8, { collide: true });
  }
  lamp(b, px0 + Math.cos(pa) * (len - 1), pz0 + Math.sin(pa) * (len - 1), 0.55);
  // Ponto de atracação: ao lado da ponta do píer (o desembarque sai pelo costado), proa para o mar.
  const side = 1.3 + 2.4;
  const dock = { x: px0 + Math.cos(pa) * (len - 3) - Math.sin(pa) * side, z: pz0 + Math.sin(pa) * (len - 3) + Math.cos(pa) * side, heading: Math.atan2(Math.cos(pa), Math.sin(pa)) };
  // Estruturas próprias de cada ilha.
  if (def.id === 'coral_island') {
    const x = def.x + 4, z = def.z - 5, y = top(x, z);
    for (const [sx, sz] of [[-1.6, -1.4], [1.6, -1.4], [-1.6, 1.4], [1.6, 1.4]]) b.cyl(M.woodDark(), x + sx, y, z + sz, 0.08, 0.1, 2.6, 6, { collide: true });
    b._add(new THREE.ConeGeometry(2.9, 1.3, 6), mat(0xd8b46a, 0.95), x, y + 3.1, z, 0, 0.5, 0);
    b.box(M.woodDark(), x, y, z + 1.8, 3.2, 1.0, 0.5, { r: 0.03, collide: true });
    b.box(mat(0xff4fd8, 0.4), x, y + 1.0, z + 1.8, 3.3, 0.05, 0.6, { r: 0 });
    ctx.points.push({ id: 'coral_bar', x, z: z + 3, label: 'BAR DE PRAIA ABANDONADO', text: 'Um quiosque de palha esquecido desde a temporada passada. Ainda há uma placa: "CORAL ISLAND — ONLY SUNSETS".' });
  } else if (def.id === 'lighthouse_point') {
    const x = def.x + 2, z = def.z + 2, y = top(x, z);
    for (let k = 0; k < 6; k++) b.cyl(k % 2 ? mat(0xc8443a, 0.6) : M.white(), x, y + k * 2.2, z, 1.5 - k * 0.12 - 0.12, 1.5 - k * 0.12, 2.2, 14, { collide: k === 0 });
    b.cyl(mat(0x2a2e34, 0.4, 0.5), x, y + 13.2, z, 1.0, 1.0, 0.2, 14);
    b.cyl(glow(0xfff2c0, 2.6), x, y + 13.4, z, 0.7, 0.7, 1.2, 12);
    b._add(new THREE.ConeGeometry(1.1, 1.0, 12), mat(0xc8443a, 0.6), x, y + 15.1, z, 0, 0, 0);
    // Facho de luz giratório (cone aditivo).
    const beam = new THREE.Mesh(new THREE.ConeGeometry(3.5, 30, 16, 1, true).translate(0, -15, 0).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    const pivot = new THREE.Group(); pivot.position.set(x, y + 14, z); pivot.add(beam); ctx.group.add(pivot);
    ctx.animated.push((dt) => { pivot.rotation.y += dt * 0.7; });
    const hx = def.x - 5, hz = def.z - 4, hy = top(hx, hz);
    b.box(M.white(), hx, hy, hz, 4, 2.6, 3.4, { r: 0.04, collide: true });
    b._add(new THREE.ConeGeometry(3.1, 1.4, 4), M.roofRed(), hx, hy + 3.3, hz, 0, Math.PI / 4, 0);
    ctx.points.push({ id: 'lighthouse', x: x - 2.4, z, label: 'FAROL DE LIGHTHOUSE POINT', text: 'O farol automático ilumina a entrada da baía desde 1952. A porta está trancada — a casa do faroleiro guarda boias e cordas.' });
  } else if (def.id === 'hidden_cove') {
    const x = def.x - 6, z = def.z - 6, y = top(x, z);
    for (const [sx, sz] of [[-1.4, -1.0], [1.4, -1.0], [-1.4, 1.0], [1.4, 1.0]]) b.cyl(M.woodDark(), x + sx, y, z + sz, 0.07, 0.08, 2.1, 6, { collide: true });
    b.box(mat(0x6a8a4a, 0.9), x, y + 2.1, z, 3.4, 0.12, 2.6, { r: 0.04, ry: 0.1 });
    b.box(M.woodDark(), x, y + 0.4, z - 0.6, 2.6, 0.08, 0.6, { r: 0.02 });
    ctx.points.push({ id: 'cove_shelter', x, z: z + 2.2, label: 'ABRIGO DA ENSEADA', text: 'Um abrigo de pescadores na enseada escondida. Águas calmas, perfeitas para ancorar longe da cidade.' });
  }
  const built = b.build();
  ctx.group.add(built.group);
  for (const p of b.lightPools) ctx.pools.push(p);
  return { colliders: b.colliders, dock, island: is };
}
