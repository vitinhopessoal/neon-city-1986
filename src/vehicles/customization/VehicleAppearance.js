import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAINTS, FINISHES, PARTS, partOption } from './CustomizationCatalog.js';

/**
 * Aparência real no modelo 3D. Regras de isolamento:
 *  - a pintura já é um material próprio do veículo (VehicleFactory);
 *  - vidro, bancos, painel e faixas usam materiais COMPARTILHADOS pela cidade:
 *    são clonados só no carro personalizado antes de qualquer alteração;
 *  - geometrias de peças e aros são cacheadas por modelo/estilo e marcadas
 *    como compartilhadas (não são descartadas por um carro);
 *  - trocar peças remove o grupo anterior (sem acumular malhas invisíveis).
 */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16, 1);
const partCache = new Map();
const rimCache = new Map();
const matCache = new Map();

function sharedMat(key, make) {
  let m = matCache.get(key);
  if (!m) { m = make(); m.userData.shared = true; matCache.set(key, m); }
  return m;
}
const RIM_FINISH = {
  alloy: () => sharedMat('rim:alloy', () => new THREE.MeshStandardMaterial({ color: 0xd9dde4, roughness: 0.22, metalness: 0.9 })),
  chrome: () => sharedMat('rim:chrome', () => new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.08, metalness: 1.0 })),
  white: () => sharedMat('rim:white', () => new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.35, metalness: 0.2 })),
  gold: () => sharedMat('rim:gold', () => new THREE.MeshStandardMaterial({ color: 0xd4a83a, roughness: 0.25, metalness: 0.9 })),
  black: () => sharedMat('rim:black', () => new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.5, metalness: 0.4 })),
};
const TRIM = () => sharedMat('trim', () => new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.45, metalness: 0.3 }));
const CHROME = () => sharedMat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.1, metalness: 1.0 }));
const FOG = () => sharedMat('fog', () => new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffc060, emissiveIntensity: 1.2, roughness: 0.2 }));

/** Acumula caixas/cilindros transformados e funde numa geometria. */
class Builder {
  constructor() { this.parts = []; }
  add(geo, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const g = geo.clone();
    _q.setFromEuler(_e.set(rx, ry, rz));
    g.applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)));
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    this.parts.push(g.index ? g.toNonIndexed() : g);
    return this;
  }
  /** Caixa entre dois pontos do perfil (segue a inclinação da superfície). */
  slab(x, z0, y0, z1, y1, w, t) {
    const len = Math.hypot(z1 - z0, y1 - y0);
    return this.add(BOX, x, (y0 + y1) / 2 + t / 2, (z0 + z1) / 2, w, t, len, -Math.atan2(y1 - y0, z1 - z0), 0, 0);
  }
  build() {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    g.computeVertexNormals();
    g.userData.shared = true;
    return g;
  }
}

// ------------------------------------------------------------ medidas do modelo
/** Altura da superfície superior da carroceria num z (perfil lateral + estufa). */
export function topY(spec, z) {
  let y = 0;
  const chain = [...spec.profile, ...(spec.green || [])];
  const scan = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [z0, y0] = pts[i], [z1, y1] = pts[i + 1];
      if ((z >= Math.min(z0, z1)) && (z <= Math.max(z0, z1)) && Math.abs(z1 - z0) > 1e-4) y = Math.max(y, y0 + ((z - z0) / (z1 - z0)) * (y1 - y0));
    }
  };
  scan(spec.profile);
  if (spec.green) scan(spec.green);
  return y || Math.max(...chain.map((p) => p[1]));
}
function dims(spec) {
  const zs = spec.profile.map((p) => p[0]);
  const front = Math.max(...zs), rear = Math.min(...zs);
  const hoodStart = spec.green ? Math.max(...spec.green.map((p) => p[0])) + 0.05 : (spec.dashZ ?? 0.5) + 0.3;
  const trunkEnd = spec.green ? Math.min(...spec.green.map((p) => p[0])) - 0.05 : -0.95;
  return { front, rear, hoodStart, trunkEnd, hw: spec.width / 2, wb: spec.wheelBase, r: spec.wheelRadius };
}

// ------------------------------------------------------------ peças
const PART_BUILDERS = {
  bumperSport(spec) {
    const d = dims(spec), P = new Builder();
    P.add(BOX, 0, 0.26, d.front - 0.02, spec.width - 0.22, 0.06, 0.26);
    P.add(BOX, 0, 0.29, d.rear + 0.04, spec.width - 0.28, 0.08, 0.16);
    for (const sx of [-1, 1]) P.add(BOX, sx * (d.hw - 0.06), 0.3, d.front - 0.18, 0.08, 0.1, 0.32);
    return { paint: P.build() };
  },
  bumperAero(spec) {
    const d = dims(spec), T = new Builder(), P = new Builder();
    T.add(BOX, 0, 0.235, d.front + 0.06, spec.width + 0.04, 0.035, 0.42);
    for (const sx of [-1, 1]) {
      T.add(BOX, sx * (d.hw - 0.06), 0.42, d.front + 0.02, 0.22, 0.03, 0.2, 0, sx * 0.4, sx * 0.25);
      T.add(BOX, sx * (d.hw - 0.32), 0.42, d.front + 0.005, 0.3, 0.12, 0.04);
    }
    for (let i = 0; i < 5; i++) T.add(BOX, -0.5 + i * 0.25, 0.25, d.rear - 0.06, 0.025, 0.14, 0.3);
    T.add(BOX, 0, 0.2, d.rear - 0.04, spec.width - 0.2, 0.03, 0.36);
    P.add(BOX, 0, 0.27, d.front - 0.04, spec.width - 0.12, 0.08, 0.2);
    return { trim: T.build(), paint: P.build() };
  },
  bumperRetro(spec) {
    const d = dims(spec), C = new Builder(), F = new Builder();
    C.add(BOX, 0, 0.42, d.front + 0.09, spec.width + 0.1, 0.13, 0.12);
    C.add(BOX, 0, 0.42, d.rear - 0.09, spec.width + 0.1, 0.13, 0.12);
    for (const sx of [-1, 1]) {
      C.add(CYL, sx * 0.55, 0.62, d.front + 0.1, 0.11, 0.06, 0.11, Math.PI / 2, 0, 0);
      F.add(CYL, sx * 0.55, 0.62, d.front + 0.135, 0.09, 0.02, 0.09, Math.PI / 2, 0, 0);
    }
    return { chrome: C.build(), fog: F.build() };
  },
  skirtSport(spec) {
    const d = dims(spec), P = new Builder();
    const z0 = -d.wb / 2 + d.r + 0.16, z1 = d.wb / 2 - d.r - 0.16;
    for (const sx of [-1, 1]) P.add(BOX, sx * (d.hw + 0.02), 0.3, (z0 + z1) / 2, 0.06, 0.1, z1 - z0);
    return { paint: P.build() };
  },
  skirtAero(spec) {
    const d = dims(spec), P = new Builder(), T = new Builder();
    const z0 = -d.wb / 2 + d.r + 0.12, z1 = d.wb / 2 - d.r - 0.12;
    for (const sx of [-1, 1]) {
      P.add(BOX, sx * (d.hw + 0.05), 0.3, (z0 + z1) / 2, 0.12, 0.17, z1 - z0);
      T.add(BOX, sx * (d.hw + 0.115), 0.31, z0 + 0.28, 0.01, 0.1, 0.32);
    }
    return { paint: P.build(), trim: T.build() };
  },
  spoilerLip(spec) {
    const d = dims(spec), P = new Builder();
    const z = d.rear + 0.22, y = topY(spec, z);
    P.add(BOX, 0, y + 0.01, z, spec.width - 0.42, 0.045, 0.2, -0.18, 0, 0);
    return { paint: P.build() };
  },
  spoilerSport(spec) {
    const d = dims(spec), P = new Builder(), T = new Builder();
    const z = d.rear + 0.3, y = topY(spec, z);
    P.add(BOX, 0, y + 0.22, z - 0.04, spec.width - 0.26, 0.045, 0.32, -0.08, 0, 0);
    for (const sx of [-1, 1]) T.add(BOX, sx * (d.hw - 0.45), y + 0.11, z, 0.05, 0.22, 0.1);
    return { paint: P.build(), trim: T.build() };
  },
  spoilerWing(spec) {
    const d = dims(spec), P = new Builder(), T = new Builder();
    const z = d.rear + 0.3, y = topY(spec, z);
    P.add(BOX, 0, y + 0.42, z - 0.06, spec.width - 0.12, 0.05, 0.38, -0.1, 0, 0);
    for (const sx of [-1, 1]) {
      T.add(BOX, sx * (spec.width / 2 - 0.06), y + 0.36, z - 0.06, 0.03, 0.22, 0.44);
      T.add(BOX, sx * (d.hw - 0.42), y + 0.21, z, 0.05, 0.42, 0.1);
    }
    return { paint: P.build(), trim: T.build() };
  },
  hoodSport(spec) {
    const d = dims(spec), P = new Builder();
    const z0 = d.hoodStart + 0.12, z1 = d.front - 0.35;
    P.slab(0, z0, topY(spec, z0) - 0.01, z1, topY(spec, z1) - 0.01, 0.72, 0.055);
    return { paint: P.build() };
  },
  hoodVents(spec) {
    const d = dims(spec), P = new Builder(), T = new Builder();
    const z0 = d.hoodStart + 0.2, z1 = Math.min(d.front - 0.45, z0 + 0.42);
    for (const sx of [-1, 1]) {
      P.slab(sx * 0.36, z0, topY(spec, z0) - 0.005, z1, topY(spec, z1) - 0.005, 0.3, 0.07);
      T.slab(sx * 0.36, z1 - 0.01, topY(spec, z1) + 0.015, z1 + 0.02, topY(spec, z1) + 0.015, 0.24, 0.045);
    }
    return { paint: P.build(), trim: T.build() };
  },
  exhaustSport(spec) {
    const d = dims(spec), C = new Builder(), T = new Builder();
    const x = spec.exhaust[0];
    C.add(CYL, x, 0.33, d.rear - 0.09, 0.075, 0.24, 0.06, Math.PI / 2, 0, 0);
    T.add(CYL, x, 0.33, d.rear - 0.21, 0.055, 0.01, 0.042, Math.PI / 2, 0, 0);
    return { chrome: C.build(), trim: T.build() };
  },
  exhaustDual(spec) {
    const d = dims(spec), C = new Builder(), T = new Builder();
    for (const x of [0.5, -0.5]) {
      C.add(CYL, x, 0.33, d.rear - 0.09, 0.06, 0.24, 0.06, Math.PI / 2, 0, 0);
      T.add(CYL, x, 0.33, d.rear - 0.21, 0.045, 0.01, 0.045, Math.PI / 2, 0, 0);
    }
    return { chrome: C.build(), trim: T.build() };
  },
  stripes(spec) {
    const d = dims(spec), P = new Builder();
    for (const x of [-0.15, 0.15]) {
      const z0 = d.hoodStart, z1 = d.front - 0.12;
      P.slab(x, z0, topY(spec, z0) + 0.004, z1, topY(spec, z1) + 0.004, 0.17, 0.008);
      const t0 = d.rear + 0.12, t1 = d.trunkEnd;
      if (t1 > t0 + 0.2) P.slab(x, t0, topY(spec, t0) + 0.004, t1, topY(spec, t1) + 0.004, 0.17, 0.008);
      if (spec.roof) { const r0 = spec.roof.z - spec.roof.len / 2, r1 = spec.roof.z + spec.roof.len / 2; P.slab(x, r0, spec.roof.y + 0.004, r1, spec.roof.y + 0.004, 0.17, 0.008); }
    }
    return { paint2: P.build() };
  },
};

function partGeometries(type, spec, part) {
  const key = `${type}:${part}`;
  let g = partCache.get(key);
  if (!g) { g = PART_BUILDERS[part](spec); partCache.set(key, g); }
  return g;
}

// ------------------------------------------------------------ aros
function rimGeometry(style, r) {
  const key = `${style}|${r.toFixed(3)}`;
  let g = rimCache.get(key);
  if (g) return g;
  const B = new Builder();
  const disc = new THREE.CylinderGeometry(1, 1, 1, 24, 1).rotateZ(Math.PI / 2);
  const ring = new THREE.TorusGeometry(1, 0.07, 6, 28).rotateY(Math.PI / 2);
  B.add(ring, 0.125, 0, 0, 1, r * 0.64, r * 0.64);
  B.add(disc, 0.1, 0, 0, 0.02, r * 0.6, r * 0.6);
  const spokes = (n, w, len, x = 0.13, phase = 0, tilt = 0) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + phase;
      B.add(BOX, x, Math.sin(a) * r * len / 2 * 1.15, Math.cos(a) * r * len / 2 * 1.15, 0.035, w, r * len, -a + tilt, 0, 0);
    }
  };
  if (style === 'fivespoke') { spokes(5, r * 0.22, 0.58); B.add(disc, 0.15, 0, 0, 0.04, r * 0.18, r * 0.18); }
  else if (style === 'multispoke') { spokes(12, r * 0.06, 0.56); B.add(disc, 0.15, 0, 0, 0.04, r * 0.15, r * 0.15); }
  else if (style === 'disc') { B.add(disc, 0.135, 0, 0, 0.03, r * 0.58, r * 0.58); B.add(ring, 0.15, 0, 0, 1, r * 0.2, r * 0.2); }
  else if (style === 'classic') { spokes(16, r * 0.03, 0.56, 0.13, 0, 0.25); B.add(disc, 0.16, 0, 0, 0.06, r * 0.24, r * 0.24); }
  else if (style === 'mesh') { spokes(10, r * 0.05, 0.56, 0.13, 0, 0.5); spokes(10, r * 0.05, 0.56, 0.135, 0.31, -0.5); B.add(disc, 0.15, 0, 0, 0.04, r * 0.14, r * 0.14); }
  else if (style === 'steel') {
    B.add(disc, 0.13, 0, 0, 0.03, r * 0.56, r * 0.56);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; B.add(disc, 0.145, Math.sin(a) * r * 0.36, Math.cos(a) * r * 0.36, 0.012, r * 0.08, r * 0.08); }
    B.add(disc, 0.15, 0, 0, 0.04, r * 0.16, r * 0.16);
  }
  disc.dispose(); ring.dispose();
  g = B.build();
  rimCache.set(key, g);
  return g;
}

// ------------------------------------------------------------ aplicação
/** Guarda o estado de fábrica uma única vez (para "Original" e para cancelar a prévia). */
function capture(v, factory) {
  if (v._stock) return v._stock;
  const fm = factory?.m || {};
  const stock = {
    height: v.spec.height,
    head: v.mats.headlight ? { color: v.mats.headlight.color.getHex(), emissive: v.mats.headlight.emissive.getHex() } : null,
    tail: v.mats.taillight ? v.mats.taillight.color.getHex() : null,
    wheels: v.wheels.map((w) => { const tire = w.spin.children[0], rim = w.spin.children[1]; return { tireScaleX: tire.scale.x, rimGeo: rim.geometry, rimMat: rim.material, rimScale: rim.scale.x }; }),
    glass: [], seats: [], dash: [], stripes: [],
  };
  // Materiais compartilhados usados por este carro → clones próprios (a cidade nunca muda).
  const paintMats = new Set(Object.values(factory?._paintCache ? Object.fromEntries(factory._paintCache) : {}));
  v.root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m === fm.glass) { o.material = m.clone(); o.material.userData = {}; stock.glass.push({ mesh: o, color: m.color.getHex(), opacity: m.opacity }); }
    else if (m === fm.seat || m === fm.seatDark) { o.material = m.clone(); o.material.userData = { noShadow: true }; stock.seats.push({ mesh: o, color: m.color.getHex() }); }
    else if (m === fm.interior) { o.material = m.clone(); o.material.userData = { noShadow: true }; stock.dash.push({ mesh: o, color: m.color.getHex() }); }
    else if (paintMats.has(m) && m !== v.mats.paint) { o.material = m.clone(); o.material.userData = {}; stock.stripes.push({ mesh: o, color: m.color.getHex() }); }
  });
  v._stock = stock;
  return stock;
}

export function paintHexOf(cfg) {
  return PAINTS.find((p) => p.id === cfg.paint)?.hex ?? cfg.paintHex ?? 0xffffff;
}

/** Aplica a configuração visual completa ao veículo (idempotente). */
export function applyAppearance(v, cfg, factory) {
  const st = capture(v, factory);
  // Pintura e acabamento (material próprio do carro) + base do sistema de danos.
  const hex = paintHexOf(cfg);
  const fin = FINISHES[cfg.finish] || FINISHES.gloss;
  const paint = v.mats.paint;
  paint.color.setHex(hex);
  Object.assign(paint, fin.material);
  paint.needsUpdate = true;
  v.appearance = { ...(v.appearance || {}), color: hex };
  if (v.damage) {
    v.damage._baseColor?.setHex(hex);
    v.damage._baseRough = paint.roughness;
    v.damage._baseClear = paint.clearcoat;
    v.damage._applyVisuals?.();
  }
  // Pintura secundária: faixas de fábrica recoloridas + faixas centrais próprias.
  const hex2 = PAINTS.find((p) => p.id === cfg.paint2)?.hex ?? null;
  for (const s of st.stripes) s.mesh.material.color.setHex(hex2 ?? s.color);
  if (hex2 !== null) {
    if (!v._paint2) { v._paint2 = paint.clone(); v._paint2.userData = {}; }
    v._paint2.color.setHex(hex2);
    Object.assign(v._paint2, fin.material);
  }
  // Rodas e pneus.
  const w = partOption('wheels', cfg.wheels), tire = partOption('tires', cfg.tires);
  v.wheels.forEach((wh, i) => {
    const s = st.wheels[i];
    const tireMesh = wh.spin.children[0], rim = wh.spin.children[1];
    tireMesh.scale.x = tire?.tire?.width ?? s.tireScaleX;
    if (w?.rim) {
      rim.geometry = rimGeometry(w.rim.style, wh.radius);
      rim.material = RIM_FINISH[w.rim.finish]();
    } else { rim.geometry = s.rimGeo; rim.material = s.rimMat; }
    const k = tire?.tire?.rimScale ?? 1;
    rim.scale.set(1, k, k);
  });
  // Altura: carroceria e colisor (spec.height usado pelo colisor do veículo).
  const ride = partOption('ride', cfg.ride)?.ride ?? 0;
  v.body.userData.rideOffset = ride;
  v.spec.height = st.height + ride;
  if (v.collider) v.collider.maxY = v.collider.minY + v.spec.height * 0.92;
  // Faróis e lanternas (materiais já próprios do veículo).
  const L = partOption('lights', cfg.lights)?.lights;
  if (v.mats.headlight && st.head) { v.mats.headlight.color.setHex(L?.head ?? st.head.color); v.mats.headlight.emissive.setHex(L?.headEmissive ?? st.head.emissive); }
  if (v.mats.taillight && st.tail !== null) v.mats.taillight.color.setHex(L?.tail ?? st.tail);
  // Película (vidro clonado; mínimo de transparência preserva a visão interna).
  const G = partOption('tint', cfg.tint)?.glass;
  for (const g of st.glass) { g.mesh.material.opacity = G?.opacity ?? g.opacity; g.mesh.material.color.setHex(G?.color ?? g.color); }
  // Interior (bancos e painel modelados).
  const I = partOption('interior', cfg.interior)?.interior;
  for (const s of st.seats) s.mesh.material.color.setHex(I?.seat ?? s.color);
  for (const s of st.dash) s.mesh.material.color.setHex(I?.dash ?? s.color);
  // Peças de carroceria: grupo reconstruído (geometrias cacheadas por modelo).
  const old = v.body.getObjectByName('custom-parts');
  if (old) old.removeFromParent();
  const grp = new THREE.Group();
  grp.name = 'custom-parts';
  const mats = { paint, paint2: v._paint2, trim: TRIM(), chrome: CHROME(), fog: FOG() };
  const want = [];
  for (const cat of ['bumper', 'skirts', 'spoiler', 'hood', 'exhaust']) { const p = partOption(cat, cfg[cat])?.part; if (p) want.push(p); }
  if (hex2 !== null && !st.stripes.length) want.push('stripes');
  for (const part of want) {
    const geos = partGeometries(v.type, v.spec, part);
    for (const [mk, geo] of Object.entries(geos)) {
      if (!geo || !mats[mk]) continue;
      const mesh = new THREE.Mesh(geo, mats[mk]);
      mesh.castShadow = true;
      mesh.name = `part:${part}:${mk}`;
      grp.add(mesh);
    }
  }
  if (grp.children.length) v.body.add(grp);
  return grp.children.length;
}

/** Conta peças visíveis (testes e relatório). */
export function partSummary(v) {
  const g = v.body.getObjectByName('custom-parts');
  return g ? g.children.map((c) => c.name) : [];
}

export { PARTS };
