import * as THREE from 'three';
import { BEACH } from './Terrain.js';
import { composeMatrix, UNIT } from '../render/StaticBatcher.js';

/**
 * Praia: malha de areia com declive, muro baixo do calçadão com acessos,
 * torres de salva-vidas (com rampa caminhável) e cerca de corda nos limites.
 */
const _m = new THREE.Matrix4();

export function buildSand(batcher, lib, terrain, { minZ = -470, maxZ = 470, maxX = 300 } = {}) {
  const x0 = BEACH.start;
  const width = maxX - x0;
  const depth = maxZ - minZ;
  const segX = Math.round(width / 1.5);
  const segZ = Math.round(depth / 8);
  const g = new THREE.PlaneGeometry(width, depth, segX, segZ);
  g.rotateX(-Math.PI / 2);
  g.translate(x0 + width / 2, 0, (minZ + maxZ) / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  // Cor por vértice: areia seca levemente irregular, faixa molhada mais escura
  // junto à água (com borda ondulada) e areia submersa ainda mais escura.
  const shoreX = BEACH.flatEnd + (BEACH.dryHeight - BEACH.waterLevel) / BEACH.slope;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrain.sandHeight(x, z));
    uv.setXY(i, x / 8, z / 8);
    const edge = shoreX - 6.5 + Math.sin(z * 0.07) * 1.2 + Math.sin(z * 0.23 + 1.3) * 0.6;
    const wet = THREE.MathUtils.smoothstep(x, edge, edge + 3.5);
    const sub = THREE.MathUtils.smoothstep(x, shoreX, shoreX + 6);
    const tide = Math.exp(-((x - (edge - 0.6)) ** 2) / 0.35) * 0.06;
    const vary = 1 + Math.sin(x * 0.21 + z * 0.05) * 0.025 + Math.sin(z * 0.13 - x * 0.07) * 0.02;
    const k = vary * (1 - wet * 0.3 - sub * 0.12 - tide);
    col[i * 3] = k * (1 - wet * 0.04);
    col[i * 3 + 1] = k * (1 - wet * 0.06);
    col[i * 3 + 2] = k * (1 - wet * 0.05);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  composeMatrix(0, 0, 0, 0, 0, 0, 1, 1, 1, _m);
  batcher.add(g, lib.m.sand, _m, null, { castShadow: false, receiveShadow: true, chunk: 'sand' });
  g.dispose();
}

let _boardGeo = null;
/** Prancha de surfe (contorno com bico e rabeta, levemente abaulada), em pé no eixo Y. */
function surfboardGeometry() {
  if (_boardGeo) return _boardGeo;
  const L = 2.1, W = 0.56;
  const s = new THREE.Shape();
  s.moveTo(0, -L / 2);
  s.bezierCurveTo(W * 0.42, -L / 2, W / 2, -L * 0.25, W / 2, 0);
  s.bezierCurveTo(W / 2, L * 0.3, W * 0.25, L * 0.48, 0, L / 2);
  s.bezierCurveTo(-W * 0.25, L * 0.48, -W / 2, L * 0.3, -W / 2, 0);
  s.bezierCurveTo(-W / 2, -L * 0.25, -W * 0.42, -L / 2, 0, -L / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.02, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, L / 2, -0.0175);
  _boardGeo = g;
  return g;
}

/**
 * Pranchas de surfe: 'upright' (fincadas na areia, levemente inclinadas) ou
 * 'flat' (deitadas). Geometria compartilhada; lotes estáticos por cor.
 */
export function buildSurfboards(batcher, lib, collision, terrain, list) {
  const geo = surfboardGeometry();
  list.forEach((b, i) => {
    const y = terrain.getHeight(b.x, b.z);
    const mat = lib.solid(b.color, 0.32, 0.05);
    if (b.mode === 'flat') composeMatrix(b.x, y + 0.06, b.z, -Math.PI / 2, b.rot, 0, 1, 1, 1, _m);
    else composeMatrix(b.x, y - 0.3, b.z, b.lean ?? 0.12, b.rot, 0, 1, 1, 1, _m);
    batcher.add(geo, mat, _m, null, { castShadow: true, receiveShadow: true });
    if (b.mode !== 'flat') {
      collision.addCylinder({ id: `surfboard_${i}`, ownerId: 'beach', x: b.x, z: b.z, radius: 0.22, minY: y - 0.2, maxY: y + 1.7, cameraBlocker: false, walkable: false });
    }
  });
}

/** Muro baixo de pedra coral entre calçadão e areia, com aberturas de acesso. */
export function buildSeawall(batcher, lib, collision, { gaps, bounds, minZ = -420, maxZ = 420, gapWidth = 4.5 }) {
  const stone = lib.solid(0xe7c2ac, 0.9, 0);
  const cap = lib.solid(0xf6efe2, 0.8, 0);
  const x = BEACH.start - 0.2;
  const sorted = [...gaps].sort((a, b) => a - b);
  const segments = [];
  let cur = minZ;
  for (const gz of sorted) {
    segments.push([cur, gz - gapWidth / 2]);
    cur = gz + gapWidth / 2;
  }
  segments.push([cur, maxZ]);
  for (const [z0, z1] of segments) {
    const len = z1 - z0;
    if (len <= 0.2) continue;
    const zc = (z0 + z1) / 2;
    composeMatrix(x, 0.15 + 0.29, zc, 0, 0, 0, 0.8, 0.58, len, _m);
    batcher.add(UNIT.box, stone, _m, null, { castShadow: true, chunk: `wall${Math.floor(zc / 80)}` });
    composeMatrix(x, 0.76, zc, 0, 0, 0, 0.98, 0.08, len, _m);
    batcher.add(UNIT.box, cap, _m, null, { castShadow: true, chunk: `wall${Math.floor(zc / 80)}` });
    // Pilares nas pontas das aberturas.
    for (const ze of [z0, z1]) {
      if (ze <= minZ || ze >= maxZ) continue;
      composeMatrix(x, 0.62, ze, 0, 0, 0, 1.1, 0.95, 1.1, _m);
      batcher.add(UNIT.box, cap, _m, null);
      composeMatrix(x, 1.14, ze, 0, 0, 0, 0.28, 0.18, 0.28, _m);
      batcher.add(UNIT.sphere, cap, _m, null);
    }
    // Colisão apenas dentro do bairro.
    const cz0 = Math.max(z0, bounds.minZ - 2), cz1 = Math.min(z1, bounds.maxZ + 2);
    if (cz1 > cz0) {
      collision.addAABB({ minX: x - 0.5, maxX: x + 0.5, minZ: cz0, maxZ: cz1, minY: -0.5, maxY: 0.8, cameraBlocker: false, surface: 'concrete' });
    }
  }
  // Passarelas de madeira sobre a areia a partir de cada acesso.
  const wood = lib.solid(0xcaa27a, 0.85, 0);
  for (const gz of sorted) {
    for (let i = 0; i < 16; i++) {
      const px = BEACH.start + 0.4 + i * 0.7;
      composeMatrix(px, 0.16, gz, 0, 0, 0, 0.55, 0.06, 2.2, _m);
      batcher.add(UNIT.box, wood, _m, null, { castShadow: false });
    }
  }
}

/** Torre de salva-vidas colorida com rampa caminhável e deck. */
export function buildLifeguardTower(kit, lib, terrain, spec) {
  const m = lib.m;
  const y = terrain.getHeight(spec.x, spec.z);
  kit.begin({ id: spec.id, x: spec.x, y, z: spec.z, rotY: Math.PI / 2 });
  kit.rng = null;
  const C = spec.colors;
  const wood = 0xf3ead8;
  const deckY = 2.2;
  // Pilotis e deck.
  for (const sx of [-1.6, 1.6]) for (const sz of [-1.6, 1.6]) {
    kit.box(m.paint, wood, sx, deckY / 2, sz, 0.18, deckY, 0.18);
    kit.solidCyl(sx, sz, 0.14, -0.2, deckY, { cameraBlocker: false, walkable: false });
  }
  kit.box(m.paint, 0xd9cbb3, 0, deckY / 2, 0, 3.3, 0.08, 0.08, Math.PI / 4);
  kit.box(m.paint, wood, 0, deckY + 0.1, 0, 3.7, 0.2, 3.7);
  kit.solid(0, 0, 1.85, 1.85, deckY, deckY + 0.2, { cameraBlocker: false });
  // Cabine.
  kit.box(m.paint, C.hut, 0, deckY + 0.2 + 1.15, -0.5, 2.6, 2.3, 2.2);
  kit.box(m.paint, C.stripe, 0, deckY + 0.75, -0.5, 2.64, 0.32, 2.24);
  kit.box(m.paint, C.stripe, 0, deckY + 1.25, -0.5, 2.64, 0.12, 2.24);
  kit.solid(0, -0.5, 1.3, 1.1, deckY + 0.2, deckY + 2.5);
  const hut = kit.face('front', 0, -0.5, 1.3, 1.1);
  kit.fbox(hut, m.glass, null, 0, deckY + 1.75, 2.0, 0.75, 0.05);
  kit.fbox(hut, m.trim, 0xffffff, 0, deckY + 1.33, 2.2, 0.08, 0.15);
  for (const side of ['left', 'right']) {
    const f = kit.face(side, 0, -0.5, 1.3, 1.1);
    kit.fbox(f, m.glass, null, 0, deckY + 1.75, 1.2, 0.7, 0.05);
  }
  // Telhado inclinado com beiral.
  kit.box(m.paint, C.roof, 0, deckY + 2.62, -0.35, 3.3, 0.16, 3.1, 0, undefined, -0.1);
  kit.box(m.paint, C.stripe, 0, deckY + 2.5, 1.18, 3.3, 0.1, 0.06);
  // Guarda-corpo.
  const rail = 0xffffff;
  kit.box(m.paint, rail, 0, deckY + 1.15, 1.8, 3.6, 0.07, 0.07);
  kit.box(m.paint, rail, 0, deckY + 0.7, 1.8, 3.6, 0.05, 0.05);
  kit.box(m.paint, rail, 1.8, deckY + 1.15, 1.2, 0.07, 0.07, 1.2);
  for (const px of [-1.75, -0.6, 0.6, 1.75]) kit.box(m.paint, rail, px, deckY + 0.7, 1.8, 0.06, 0.95, 0.06);
  kit.solid(0, 1.8, 1.85, 0.08, deckY + 0.2, deckY + 1.2, { cameraBlocker: false });
  kit.solid(1.8, 1.2, 0.08, 0.65, deckY + 0.2, deckY + 1.2, { cameraBlocker: false });
  // Boia e mastro com bandeira.
  const ring = new THREE.TorusGeometry(0.28, 0.07, 8, 18);
  kit.geom(ring, lib.solid(0xff6a1a, 0.6, 0), null, 1.31, deckY + 1.5, -0.5, 0, Math.PI / 2, 0);
  ring.dispose();
  kit.cyl(lib.solid(0xdfe3ea, 0.3, 0.8), null, 1.6, deckY + 2.4, 1.6, 0.04, 4.8, { seg: 8 });
  // Bandeira amarela/vermelha: animada pelo AmbientSystem quando disponível.
  if (kit.flags) {
    const base = kit.toWorld(1.6, 0, 1.6);
    const dir = kit.toWorld(1.6, 0, 0.6).sub(base);
    kit.flags.push({ x: base.x, y: base.y, z: base.z, rot: Math.atan2(-dir.z, dir.x), opts: { height: deckY + 4.8, w: 0.9, h: 0.62, pole: false, colors: [0xffd02a, 0xd8283a] } });
  } else {
    kit.box(m.fabric, 0xffd02a, 1.6, deckY + 4.4, 1.15, 0.02, 0.5, 0.9);
    kit.box(m.fabric, 0xd8283a, 1.6, deckY + 4.15, 1.15, 0.021, 0.25, 0.9);
  }
  // Rampa de acesso (lado -X local), caminhável.
  const rampLen = 6.2;
  const x0 = -1.85 - rampLen, x1 = -1.85;
  const ang = Math.atan2(deckY + 0.2, rampLen);
  const hyp = Math.hypot(rampLen, deckY + 0.2);
  kit.box(m.paint, 0xd9b890, (x0 + x1) / 2, (deckY + 0.2) / 2 - 0.02, 1.2, hyp, 0.1, 1.1, 0, undefined, 0, ang);
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    kit.box(m.paint, 0xc59f74, x0 + t * rampLen, t * (deckY + 0.2) + 0.04, 1.2, 0.05, 0.03, 1.1, 0, undefined, 0, ang);
  }
  for (const rz of [0.62, 1.78]) {
    kit.box(m.paint, rail, (x0 + x1) / 2, (deckY + 0.2) / 2 + 0.95, rz, hyp, 0.06, 0.06, 0, undefined, 0, ang);
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      kit.box(m.paint, rail, x0 + t * rampLen, t * (deckY + 0.2) + 0.5, rz, 0.06, 1.0, 0.06);
    }
    kit.solid((x0 + x1) / 2, rz, rampLen / 2, 0.06, -0.3, deckY + 1.3, { cameraBlocker: false, walkable: false });
  }
  kit.ramp((x0 + x1) / 2, 1.2, rampLen / 2, 0.55, 0.02, deckY + 0.2);
  return kit.end();
}

/** Cerca de postes e corda nos limites norte/sul da praia. */
export function buildRopeFence(batcher, lib, terrain, z, x0, x1) {
  const post = lib.solid(0xcaa27a, 0.85, 0);
  const rope = lib.solid(0xf2ead6, 0.9, 0);
  const n = Math.round((x1 - x0) / 3);
  for (let i = 0; i <= n; i++) {
    const x = x0 + (i / n) * (x1 - x0);
    const y = terrain.getHeight(x, z);
    composeMatrix(x, y + 0.5, z, 0, 0, 0, 0.12, 1.1, 0.12, _m);
    batcher.add(UNIT.box, post, _m, null);
    if (i < n) {
      const xn = x0 + ((i + 1) / n) * (x1 - x0);
      const yn = terrain.getHeight(xn, z);
      composeMatrix((x + xn) / 2, (y + yn) / 2 + 0.85, z, 0, 0, Math.atan2(yn - y, xn - x), xn - x, 0.04, 0.04, _m);
      batcher.add(UNIT.box, rope, _m, null, { castShadow: false });
    }
  }
}
