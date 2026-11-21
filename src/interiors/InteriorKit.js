import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Kit modular de interiores ("low-poly premium"): componentes reutilizáveis
 * (mesa, cadeira, cabine, balcão, prateleira, geladeira, caixa registradora,
 * luminária, sofá, banqueta, jukebox, TV de tubo, arara, elevador...) que
 * acumulam geometria por material e são fundidos ao final (poucas draw
 * calls por estabelecimento). Cada componente pode registrar colisor,
 * assento e ponto de interação.
 *
 * Espaço local do interior: centro do piso na origem, +Z = fachada (rua),
 * y = 0 no piso.
 */
const MAT_CACHE = new Map();
export function mat(color, roughness = 0.7, metalness = 0, extra = {}) {
  const key = `${color}|${roughness}|${metalness}|${JSON.stringify(extra)}`;
  let m = MAT_CACHE.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.userData.shared = true;
    MAT_CACHE.set(key, m);
  }
  return m;
}
export function glow(color, intensity = 1.6) {
  return mat(color, 0.5, 0, { emissive: color, emissiveIntensity: intensity });
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export class InteriorBuilder {
  constructor() {
    this.parts = new Map();
    this.colliders = [];
    this.seats = [];
    this.interactables = [];
    this.dynamic = [];
    this.lightPools = [];
    this.animated = [];
  }

  _add(geo, material, x, y, z, rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    g.applyMatrix4(_m.compose(_p, _q, _s));
    let l = this.parts.get(material);
    if (!l) this.parts.set(material, (l = []));
    l.push(g);
    return g;
  }

  /** Caixa com chanfro discreto; (x, y, z) = centro da BASE. */
  box(material, x, y, z, w, h, d, { r = 0.02, ry = 0, collide = false, walkable = false, block = true } = {}) {
    const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
    const geo = rr > 0.004 ? new RoundedBoxGeometry(w, h, d, 1, rr) : new THREE.BoxGeometry(w, h, d);
    this._add(geo, material, x, y + h / 2, z, 0, ry, 0);
    if (collide) this.collider(x, z, w, d, y, y + h, { ry, walkable, cameraBlocker: block });
  }

  cyl(material, x, y, z, rTop, rBot, h, seg = 12, { collide = false, rx = 0, rz = 0 } = {}) {
    this._add(new THREE.CylinderGeometry(rTop, rBot, h, seg), material, x, y + h / 2, z, rx, 0, rz);
    if (collide) this.collider(x, z, rBot * 2, rBot * 2, y, y + h);
  }

  sphere(material, x, y, z, r, seg = 10) {
    this._add(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)), material, x, y, z);
  }

  /** Painel vertical (frente para +Z, girado por ry). */
  panel(material, x, y, z, w, h, ry = 0) {
    this._add(new THREE.PlaneGeometry(w, h), material, x, y, z, 0, ry, 0);
  }

  collider(x, z, w, d, y0, y1, { ry = 0, walkable = false, cameraBlocker = true } = {}) {
    this.colliders.push({ x, z, w, d, y0, y1, ry, walkable, cameraBlocker });
  }

  seat(x, y, z, yaw, kind = 'chair') {
    this.seats.push({ x, y, z, yaw, kind, used: null });
  }

  interact(def) {
    this.interactables.push({ radius: 1.4, ...def });
    return def;
  }

  /** Círculo de luz falso no piso (aditivo, sem custo de iluminação). */
  pool(x, z, radius, color) {
    this.lightPools.push({ x, z, radius, color });
  }

  /** Funde por material; retorna o grupo com as malhas. */
  build() {
    const group = new THREE.Group();
    let triangles = 0;
    for (const [material, geos] of this.parts) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, material);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      triangles += merged.attributes.position.count / 3;
      group.add(mesh);
    }
    for (const d of this.dynamic) group.add(d);
    return { group, triangles };
  }
}

// ---------------------------------------------------------------- casca
/**
 * Paredes, piso, teto, rodapé, vitrine com persianas e vão da porta.
 * spec: { w, d, h, floor, wall, ceiling, trim, doorX, doorW, windows: [{x, w}] }
 */
export function shell(b, s) {
  const { w, d, h } = s;
  const t = 0.2;
  b.box(s.floor, 0, -0.1, 0, w, 0.1, d, { r: 0 });
  b.collider(0, 0, w + 1, d + 1, -2, 0, { walkable: true });
  b.box(s.ceiling, 0, h, 0, w, 0.12, d, { r: 0 });
  // Paredes laterais e do fundo.
  b.box(s.wall, -w / 2 - t / 2, 0, 0, t, h, d + t * 2, { r: 0, collide: true });
  b.box(s.wall, w / 2 + t / 2, 0, 0, t, h, d + t * 2, { r: 0, collide: true });
  b.box(s.wall, 0, 0, -d / 2 - t / 2, w, h, t, { r: 0, collide: true });
  // Fachada: segmentos entre vitrines e o vão da porta.
  const openings = [{ x: s.doorX, w: s.doorW, door: true }, ...(s.windows || [])].sort((a, b2) => a.x - b2.x);
  let cur = -w / 2;
  const zf = d / 2 + t / 2;
  for (const o of openings) {
    const a = o.x - o.w / 2;
    if (a > cur + 0.01) b.box(s.wall, (cur + a) / 2, 0, zf, a - cur, h, t, { r: 0, collide: true });
    if (o.door) {
      b.box(s.wall, o.x, 2.5, zf, o.w, h - 2.5, t, { r: 0 });
      // Vão da porta bloqueado: sai-se pela interação (nunca para fora do volume).
      b.collider(o.x, zf, o.w, t, 0, 2.5);
    } else {
      b.box(s.wall, o.x, 0, zf, o.w, 0.9, t, { r: 0, collide: true });
      b.box(s.wall, o.x, 2.6, zf, o.w, h - 2.6, t, { r: 0, collide: true });
      // Vitrine: vidro + persianas (a rua real fica atrás das persianas).
      b.collider(o.x, zf, o.w, t, 0.9, 2.6);
      b.panel(s.windowGlow, o.x, 1.75, d / 2 + 0.02, o.w - 0.1, 1.68, Math.PI);
      for (let k = 0; k < 9; k++) b.box(s.blinds, o.x, 0.98 + k * 0.18, d / 2 - 0.03, o.w - 0.12, 0.035, 0.05, { r: 0 });
    }
    cur = o.x + o.w / 2;
  }
  if (cur < w / 2 - 0.01) b.box(s.wall, (cur + w / 2) / 2, 0, zf, w / 2 - cur, h, t, { r: 0, collide: true });
  // Rodapé e sanca.
  for (const [x, z, ww, dd] of [[0, -d / 2 + 0.03, w, 0.06], [-w / 2 + 0.03, 0, 0.06, d], [w / 2 - 0.03, 0, 0.06, d]]) {
    b.box(s.trim, x, 0, z, ww, 0.14, dd, { r: 0 });
    b.box(s.trim, x, h - 0.12, z, ww, 0.12, dd, { r: 0 });
  }
}

/** Porta interior (folha animada) no vão da fachada. Retorna o objeto da porta. */
export function doorLeaf(b, x, d, w, color, glass = true) {
  const pivot = new THREE.Group();
  pivot.position.set(x - w / 2, 0, d / 2);
  const frame = new THREE.Mesh(new RoundedBoxGeometry(w, 2.4, 0.06, 1, 0.02), mat(color, 0.35, 0.6));
  frame.position.set(w / 2, 1.2, 0);
  pivot.add(frame);
  if (glass) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, 1.9), mat(0x9fc6d8, 0.05, 0.1, { transparent: true, opacity: 0.35 }));
    pane.position.set(w / 2, 1.25, 0.035);
    pivot.add(pane);
    const pane2 = pane.clone();
    pane2.rotation.y = Math.PI;
    pane2.position.z = -0.035;
    pivot.add(pane2);
  }
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), mat(0xd9d2c0, 0.25, 0.9));
  handle.position.set(w - 0.12, 1.1, -0.06);
  pivot.add(handle);
  b.dynamic.push(pivot);
  return pivot;
}

// ------------------------------------------------------------ móveis
export function table(b, x, z, { w = 0.9, d = 0.9, h = 0.76, top = mat(0xf2e6d0, 0.4), leg = mat(0x2a2a2e, 0.4, 0.6), round = false } = {}) {
  if (round) {
    b.cyl(top, x, h - 0.04, z, w / 2, w / 2, 0.04, 18);
    b.cyl(leg, x, 0, z, 0.04, 0.05, h - 0.04, 8);
    b.cyl(leg, x, 0, z, 0.25, 0.28, 0.03, 14);
    b.collider(x, z, w * 0.8, w * 0.8, 0, h);
    return;
  }
  b.box(top, x, h - 0.045, z, w, 0.045, d, { r: 0.012 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(leg, x + sx * (w / 2 - 0.06), 0, z + sz * (d / 2 - 0.06), 0.045, h - 0.045, 0.045, { r: 0.01 });
  b.collider(x, z, w, d, 0, h);
}

export function chair(b, x, z, yaw, { seat = mat(0xd84a5a, 0.55), frame = mat(0x2a2a2e, 0.35, 0.7), h = 0.46 } = {}) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const L = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  b.box(seat, x, h - 0.06, z, 0.44, 0.06, 0.42, { r: 0.02, ry: yaw });
  const [bx, bz] = L(0, -0.19);
  b.box(seat, bx, h, bz, 0.42, 0.42, 0.05, { r: 0.02, ry: yaw });
  for (const [lx, lz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) {
    const [px, pz] = L(lx, lz);
    b.cyl(frame, px, 0, pz, 0.015, 0.015, h - 0.06, 6);
  }
  b.collider(x, z, 0.4, 0.4, 0, 0.5, { ry: yaw, cameraBlocker: false });
  b.seat(x, h, z, yaw, 'chair');
}

export function stool(b, x, z, yaw = 0, { seat = mat(0xd84a5a, 0.5), metal = mat(0xc9cdd3, 0.25, 0.9), h = 0.74 } = {}) {
  b.cyl(seat, x, h - 0.07, z, 0.19, 0.18, 0.08, 14);
  b.cyl(metal, x, 0, z, 0.035, 0.035, h - 0.07, 8);
  b.cyl(metal, x, 0, z, 0.2, 0.22, 0.03, 12);
  b.cyl(metal, x, 0.28, z, 0.15, 0.15, 0.02, 12);
  b.collider(x, z, 0.36, 0.36, 0, 0.7, { cameraBlocker: false });
  b.seat(x, h, z, yaw, 'stool');
}

/** Cabine estofada (banco em U virado para +Z local, mesa à frente). */
export function booth(b, x, z, yaw, { uph = mat(0xc8344a, 0.55), wood = mat(0x6b3b22, 0.5), w = 1.5 } = {}) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const L = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const [sx, sz] = L(0, -0.5);
  b.box(uph, sx, 0, sz, w, 0.45, 0.55, { r: 0.05, ry: yaw, collide: true, block: false });
  const [kx, kz] = L(0, -0.78);
  b.box(uph, kx, 0.45, kz, w, 0.72, 0.18, { r: 0.06, ry: yaw, collide: true, block: false });
  b.box(wood, kx, 0, kz, w + 0.04, 0.12, 0.6, { r: 0.01, ry: yaw });
  const [tx, tz] = L(0, 0.15);
  table(b, tx, tz, { w: w - 0.2, d: 0.7, top: mat(0xf4ede0, 0.35) });
  const [s1x, s1z] = L(-w * 0.25, -0.45);
  const [s2x, s2z] = L(w * 0.25, -0.45);
  b.seat(s1x, 0.45, s1z, yaw, 'booth');
  b.seat(s2x, 0.45, s2z, yaw, 'booth');
}

export function sofa(b, x, z, yaw, { uph = mat(0x6a3fb0, 0.6), w = 2.0 } = {}) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const L = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  b.box(uph, x, 0, z, w, 0.42, 0.85, { r: 0.08, ry: yaw, collide: true, block: false });
  const [bx, bz] = L(0, -0.36);
  b.box(uph, bx, 0.42, bz, w, 0.5, 0.2, { r: 0.08, ry: yaw });
  for (const sd of [-1, 1]) {
    const [ax, az] = L(sd * (w / 2 - 0.1), 0);
    b.box(uph, ax, 0.42, az, 0.2, 0.22, 0.8, { r: 0.07, ry: yaw });
  }
  for (const k of [-0.5, 0.5]) {
    const [px, pz] = L(k * w * 0.5, 0.05);
    b.seat(px, 0.44, pz, yaw, 'sofa');
  }
}

/** Balcão com tampo e frente decorada; orientado ao longo de X local (frente para +Z). */
export function counter(b, x, z, len, yaw = 0, { top = mat(0x2a2b30, 0.3, 0.2), front = mat(0xf2e3c8, 0.6), accent = null, h = 1.05 } = {}) {
  b.box(front, x, 0, z, len, h - 0.05, 0.6, { r: 0.02, ry: yaw, collide: true });
  b.box(top, x, h - 0.05, z, len + 0.06, 0.05, 0.7, { r: 0.015, ry: yaw });
  if (accent) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    b.box(accent, x + 0.305 * s, 0.25, z + 0.305 * c, len, 0.06, 0.02, { r: 0, ry: yaw });
  }
}

export function register(b, x, y, z, yaw = 0) {
  b.box(mat(0x3a3d44, 0.4, 0.4), x, y, z, 0.42, 0.14, 0.36, { r: 0.02, ry: yaw });
  b.box(mat(0x2b2e34, 0.4, 0.3), x, y + 0.14, z - 0.04, 0.36, 0.12, 0.2, { r: 0.02, ry: yaw });
  b.box(glow(0x58ff9a, 0.9), x, y + 0.27, z - 0.08, 0.2, 0.06, 0.02, { r: 0, ry: yaw });
}

export function lampPendant(b, x, y, z, color = 0xffd9a0, { shade = mat(0xb5312f, 0.5) } = {}) {
  b.cyl(mat(0x222222, 0.5), x, y - 0.6, z, 0.008, 0.008, 0.6, 4);
  b.cyl(shade, x, y - 0.85, z, 0.08, 0.26, 0.25, 14);
  b.sphere(glow(color, 2.2), x, y - 0.86, z, 0.07, 8);
  b.pool(x, z, 1.4, color);
}

export function ceilingPanel(b, x, h, z, w, d, color = 0xf4f7ff, intensity = 1.5) {
  b.box(glow(color, intensity), x, h - 0.04, z, w, 0.04, d, { r: 0 });
  b.pool(x, z, Math.max(w, d) * 0.9, color);
}

export function shelfUnit(b, x, z, len, yaw = 0, { color = mat(0xe8e4dc, 0.5), h = 1.9, levels = 4, depth = 0.5 } = {}) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  b.box(color, x, 0, z, len, 0.1, depth, { r: 0.01, ry: yaw, collide: true });
  b.box(color, x - 0.0 * s, 0, z, len, h, 0.04, { r: 0, ry: yaw });
  for (let k = 1; k <= levels; k++) b.box(color, x, (h / (levels + 0.4)) * k, z, len, 0.03, depth, { r: 0, ry: yaw });
  for (const sd of [-1, 1]) {
    const lx = sd * (len / 2 - 0.02);
    b.box(color, x + lx * c, 0, z - lx * s, 0.04, h, depth, { r: 0, ry: yaw });
  }
  b.collider(x, z, len, depth, 0, h, { ry: yaw });
}

/**
 * Produtos instanciados sobre prateleiras (uma draw call por tipo).
 * slots: [{x, y, z, yaw}] centros de prateleira; cria latas/caixas coloridas.
 */
export function productInstances(slots, palette, { kind = 'box', perSlot = 8, len = 1.6 } = {}) {
  const geo = kind === 'can' ? new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8) : kind === 'bottle'
    ? new THREE.CylinderGeometry(0.03, 0.04, 0.28, 8) : new RoundedBoxGeometry(0.12, 0.18, 0.08, 1, 0.01);
  const h = kind === 'can' ? 0.12 : kind === 'bottle' ? 0.28 : 0.18;
  const total = slots.length * perSlot;
  const mesh = new THREE.InstancedMesh(geo, mat(0xffffff, 0.45, 0.1), total);
  const col = new THREE.Color();
  let i = 0;
  for (const sl of slots) {
    const s = Math.sin(sl.yaw || 0), c = Math.cos(sl.yaw || 0);
    for (let k = 0; k < perSlot; k++) {
      const lx = -len / 2 + 0.12 + (k / Math.max(1, perSlot - 1)) * (len - 0.24);
      _p.set(sl.x + lx * c, sl.y + h / 2 + 0.02, sl.z - lx * s);
      _q.setFromEuler(_e.set(0, (sl.yaw || 0) + (Math.random() - 0.5) * 0.2, 0));
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      mesh.setColorAt(i, col.setHex(palette[(i * 7 + k) % palette.length]));
      i++;
    }
  }
  mesh.receiveShadow = true;
  return mesh;
}

export function fridge(b, x, z, yaw = 0, { w = 0.8, light = 0xdff4ff } = {}) {
  b.box(mat(0xd9dde2, 0.35, 0.5), x, 0, z, w, 2.0, 0.7, { r: 0.03, ry: yaw, collide: true });
  b.box(glow(light, 0.7), x + Math.sin(yaw) * 0.36, 0.2, z + Math.cos(yaw) * 0.36, w - 0.12, 1.6, 0.01, { r: 0, ry: yaw });
}

export function crtTV(b, x, y, z, yaw, screenMat, size = 0.5) {
  b.box(mat(0x2b2a2e, 0.5, 0.2), x, y, z, size * 1.2, size, size * 0.9, { r: 0.04, ry: yaw });
  b.box(screenMat, x + Math.sin(yaw) * size * 0.455, y + size * 0.12, z + Math.cos(yaw) * size * 0.455, size * 0.9, size * 0.72, 0.01, { r: 0, ry: yaw });
}

export function jukebox(b, x, z, yaw) {
  b.box(mat(0x7a2a1e, 0.4, 0.3), x, 0, z, 0.9, 1.25, 0.6, { r: 0.08, ry: yaw, collide: true });
  b.box(glow(0xff9a4a, 1.6), x, 1.25, z, 0.9, 0.35, 0.6, { r: 0.15, ry: yaw });
  b.box(glow(0x45f3ff, 1.2), x + Math.sin(yaw) * 0.305, 0.55, z + Math.cos(yaw) * 0.305, 0.6, 0.5, 0.01, { r: 0, ry: yaw });
}

export function plant(b, x, z, h = 1.2) {
  b.cyl(mat(0xd96f4a, 0.7), x, 0, z, 0.2, 0.15, 0.35, 10);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b._add(new THREE.ConeGeometry(0.09, h * 0.75, 5), mat(0x3f8f4a, 0.7), x + Math.cos(a) * 0.08, 0.35 + h * 0.37, z + Math.sin(a) * 0.08, Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
  }
  b.collider(x, z, 0.4, 0.4, 0, h);
}

export function rack(b, x, z, len, yaw, colors) {
  const metal = mat(0xcfd3d8, 0.25, 0.9);
  const s = Math.sin(yaw), c = Math.cos(yaw);
  for (const sd of [-1, 1]) {
    const lx = sd * len / 2;
    b.cyl(metal, x + lx * c, 0, z - lx * s, 0.02, 0.02, 1.55, 6);
  }
  b.cyl(metal, x, 1.53, z, 0.015, 0.015, len, 6, { rz: Math.PI / 2 });
  const n = Math.floor(len / 0.14);
  for (let k = 0; k < n; k++) {
    const lx = -len / 2 + 0.1 + k * ((len - 0.2) / Math.max(1, n - 1));
    b.box(mat(colors[k % colors.length], 0.8), x + lx * c, 0.75, z - lx * s, 0.04, 0.75, 0.42, { r: 0.015, ry: yaw });
  }
  b.collider(x, z, len, 0.5, 0, 1.6, { ry: yaw });
}

export function sign(texture, w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }));
  return m;
}

/** Textura de texto simples (cardápios, placas de preço). */
export function textTexture(lines, { w = 512, h = 512, bg = '#1a1424', fg = '#ffe9c2', accent = '#ff4fb8', title = null, font = 'Trebuchet MS' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = accent;
  g.lineWidth = 8;
  g.strokeRect(8, 8, w - 16, h - 16);
  let y = 30;
  if (title) {
    g.fillStyle = accent;
    g.font = `bold ${Math.round(w / 11)}px ${font}`;
    g.textAlign = 'center';
    g.fillText(title, w / 2, y + w / 12);
    y += w / 7;
  }
  g.textAlign = 'left';
  g.fillStyle = fg;
  g.font = `${Math.round(w / 20)}px ${font}`;
  for (const l of lines) {
    const [a, b2] = Array.isArray(l) ? l : [l, ''];
    g.fillText(a, 34, y + w / 22);
    if (b2) { g.textAlign = 'right'; g.fillText(b2, w - 34, y + w / 22); g.textAlign = 'left'; }
    y += w / 13;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
