import * as THREE from 'three';
import { door, canopy } from './ArtDecoParts.js';
import { asDetail } from './BuildingKit.js';

/**
 * Módulos arquitetônicos adicionais (Prompt 02), complementando ArtDecoParts:
 * pilastras, frisos, portais recuados, varandas, torres de canto, cobogós,
 * telhado de quatro águas, muros de jardim e caixas com UVs em metros.
 * Todos trabalham no espaço local do edifício (frente para +Z).
 */

/** Pilastras verticais salientes (com capitel simples). */
export function pilasters(kit, face, us, y0, y1, color, o = {}) {
  return asDetail(kit, () => pilastersImpl(kit, face, us, y0, y1, color, o));
}

function pilastersImpl(kit, face, us, y0, y1, color, o) {
  const m = kit.lib.m;
  const w = o.width ?? 0.4, depth = o.depth ?? 0.14;
  for (const u of us) {
    kit.fbox(face, m.trim, color, u, (y0 + y1) / 2, w, y1 - y0, depth, 0);
    if (o.cap !== false) kit.fbox(face, m.trim, o.capColor ?? color, u, y1 + 0.1, w + 0.18, 0.2, depth + 0.08, 0);
    if (o.base) kit.fbox(face, m.trim, o.base, u, y0 + 0.3, w + 0.12, 0.6, depth + 0.05, 0);
  }
}

/** Friso horizontal: 'flutes' (caneluras), 'dentil' (dentículos) ou 'chevron' (zigue-zague). */
export function frieze(kit, face, u, width, v, kind, color, o = {}) {
  return asDetail(kit, () => friezeImpl(kit, face, u, width, v, kind, color, o));
}

function friezeImpl(kit, face, u, width, v, kind, color, o) {
  const m = kit.lib.m;
  const depth = o.depth ?? 0.07;
  const h = o.height ?? 0.6;
  kit.fbox(face, m.trim, color, u, v + h / 2 + 0.05, width, 0.1, depth + 0.04, 0);
  kit.fbox(face, m.trim, color, u, v - h / 2 - 0.05, width, 0.1, depth + 0.04, 0);
  if (kind === 'flutes') {
    const n = Math.max(2, Math.floor(width / 0.42));
    for (let i = 0; i < n; i++) kit.fbox(face, m.trim, color, u - width / 2 + (width / n) * (i + 0.5), v, 0.13, h, depth, 0);
  } else if (kind === 'dentil') {
    const n = Math.max(2, Math.floor(width / 0.5));
    for (let i = 0; i < n; i++) kit.fbox(face, m.trim, color, u - width / 2 + (width / n) * (i + 0.5), v + h * 0.15, 0.24, h * 0.5, depth + 0.03, 0);
  } else {
    const n = Math.max(2, Math.floor(width / 0.9));
    const seg = width / n;
    const len = Math.hypot(seg / 2, h * 0.8);
    const ang = Math.atan2(h * 0.8, seg / 2);
    for (let i = 0; i < n; i++) {
      const uc = u - width / 2 + seg * (i + 0.5);
      kit.fbox(face, m.trim, color, uc - seg / 4, v, len, 0.09, depth, 0, { rz: ang });
      kit.fbox(face, m.trim, color, uc + seg / 4, v, len, 0.09, depth, 0, { rz: -ang });
    }
  }
}

/** Portal de entrada recuado: batentes escalonados, marquise, número e arandelas. */
export function portal(kit, face, u, w, h, color, o = {}) {
  const m = kit.lib.m;
  for (let k = 0; k < 3; k++) {
    const fw = w + 1.2 - k * 0.35, fh = h + 0.75 - k * 0.22, d = 0.42 - k * 0.12;
    const c = k === 1 ? (o.accent ?? color) : color;
    kit.fbox(face, m.trim, c, u - fw / 2 + 0.11, fh / 2, 0.22, fh, d, 0);
    kit.fbox(face, m.trim, c, u + fw / 2 - 0.11, fh / 2, 0.22, fh, d, 0);
    kit.fbox(face, m.trim, c, u, fh - 0.11, fw, 0.22, d, 0);
  }
  // Fundo escuro do recuo (sugere profundidade) e porta.
  kit.fbox(face, m.trim, 0x2b2620, u, h / 2 + 0.06, w + 0.3, h + 0.12, 0.04, 0);
  door(kit, face, u, w, h, { frame: o.frame ?? 0xf4f1ea, glassLeaf: true, outset: 0.04 });
  if (o.canopy !== false) canopy(kit, face, u, w + 2, h + 0.9, o.canopyProj ?? 1.2, o.canopyColor ?? color, { thick: 0.22, lights: true });
  for (const s of [-1, 1]) {
    kit.fbox(face, m.darkMetal, null, u + s * (w / 2 + 0.95), h * 0.72, 0.16, 0.34, 0.12, 0);
    kit.fbox(face, m.lampOn, null, u + s * (w / 2 + 0.95), h * 0.72 + 0.04, 0.12, 0.2, 0.06, 0.12);
  }
  if (o.number) kit.fbox(face, m.trim, o.number, u + w / 2 + 0.95, h * 0.72 + 0.6, 0.42, 0.26, 0.05, 0);
}

/** Varanda Streamline: laje em balanço + guarda-corpo de tubos. */
export function balcony(kit, face, u, v, w, proj, color, rail = 0xffffff) {
  const m = kit.lib.m;
  kit.fbox(face, m.trim, color, u, v, w, 0.18, proj, 0);
  asDetail(kit, () => balconyRails(kit, face, u, v, w, proj, rail));
}

function balconyRails(kit, face, u, v, w, proj, rail) {
  const m = kit.lib.m;
  for (const hh of [0.42, 0.72, 1.0]) {
    kit.fbox(face, m.trim, rail, u, v + hh, w, 0.05, 0.05, proj - 0.06);
    kit.fbox(face, m.trim, rail, u - w / 2 + 0.03, v + hh, 0.05, 0.05, proj - 0.04, 0);
    kit.fbox(face, m.trim, rail, u + w / 2 - 0.03, v + hh, 0.05, 0.05, proj - 0.04, 0);
  }
  for (const s of [-1, 1]) kit.fbox(face, m.trim, rail, u + s * (w / 2 - 0.03), v + 0.5, 0.06, 1.0, 0.06, proj - 0.06);
}

/**
 * Torre de canto: volume vertical saliente que ultrapassa a cobertura,
 * com faixa de blocos de vidro e coroamento escalonado.
 */
export function cornerTower(kit, face, u, tw, H, extra, proj, color, accent) {
  const m = kit.lib.m;
  const top = H + extra;
  const back = 1.2;
  kit.fbox(face, m.paint, color, u, top / 2, tw, top, proj + back, -back);
  kit.fbox(face, m.glassBlock, null, u, top / 2 + 0.8, Math.max(0.5, tw * 0.32), top - 3.4, 0.06, proj);
  kit.fbox(face, m.trim, accent, u, top + 0.15, tw + 0.3, 0.3, proj + back + 0.3, -back - 0.15);
  kit.fbox(face, m.trim, accent, u, top + 0.55, tw * 0.62, 0.5, (proj + back) * 0.62, -back * 0.62);
  kit.fbox(face, m.trim, accent, u, top + 1.1, tw * 0.3, 0.6, (proj + back) * 0.3, -back * 0.3);
  for (const s of [-1, 1]) kit.fbox(face, m.trim, accent, u + s * (tw / 2 + 0.06), top / 2, 0.12, top - 1, 0.25, proj - 0.25);
  const p = kit.facePoint(face, u, 0, (proj - back) / 2);
  const along = Math.abs(face.ux) > 0.5;
  kit.solid(p.x, p.z, along ? tw / 2 : (proj + back) / 2, along ? (proj + back) / 2 : tw / 2, 0, top + 1.4);
}

/** Painel de cobogós (blocos vazados): grade de blocos com frestas. */
export function breezeBlocks(kit, face, u, v0, cols, rows, color, cell = 0.42, outset = 0) {
  return asDetail(kit, () => breezeBlocksImpl(kit, face, u, v0, cols, rows, color, cell, outset));
}

function breezeBlocksImpl(kit, face, u, v0, cols, rows, color, cell, outset) {
  const m = kit.lib.m;
  const s = cell - 0.07;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const uu = u - (cols * cell) / 2 + cell * (c + 0.5);
      const vv = v0 + cell * (r + 0.5);
      // Bloco em "X" vazado: duas lâminas diagonais dentro de um quadro.
      kit.fbox(face, m.trim, color, uu, vv + s / 2 - 0.03, s, 0.06, 0.2, outset);
      kit.fbox(face, m.trim, color, uu, vv - s / 2 + 0.03, s, 0.06, 0.2, outset);
      kit.fbox(face, m.trim, color, uu - s / 2 + 0.03, vv, 0.06, s, 0.2, outset);
      kit.fbox(face, m.trim, color, uu + s / 2 - 0.03, vv, 0.06, s, 0.2, outset);
      kit.fbox(face, m.trim, color, uu, vv, s * 1.2, 0.05, 0.18, outset, { rz: Math.PI / 4 });
    }
  }
}

const _tiledCache = new Map();
/** BoxGeometry com UVs em metros (texturas tileáveis não esticam). */
export function tiledBoxGeometry(sx, sy, sz, tile = 1) {
  const key = `${sx.toFixed(2)}|${sy.toFixed(2)}|${sz.toFixed(2)}|${tile}`;
  let g = _tiledCache.get(key);
  if (g) return g;
  g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  // Ordem das faces do BoxGeometry: +x, -x, +y, -y, +z, -z (4 vértices cada).
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile);
    }
  }
  _tiledCache.set(key, g);
  return g;
}

/**
 * Telhado de quatro águas (cumeeira no eixo mais longo) com beiral e forro.
 * UVs em metros: fileiras de telhas paralelas ao beiral, v subindo a água.
 */
export function hipRoofGeometry(w, d, h, overhang = 0.6, tile = 2) {
  const W = w / 2 + overhang, D = d / 2 + overhang;
  const alongX = W >= D;
  const r = alongX ? W - D : D - W;
  const pos = [], uvs = [];
  // e: direção do beiral; n: normal horizontal da água (para fora).
  const tri = (a, b, c, e, n, edge) => {
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      const along = p[0] * e[0] + p[2] * e[2];
      const inward = edge - (p[0] * n[0] + p[2] * n[2]);
      uvs.push(along / tile, Math.hypot(inward, p[1]) / tile);
    }
  };
  const A = alongX ? [-r, h, 0] : [0, h, -r];
  const B = alongX ? [r, h, 0] : [0, h, r];
  const c00 = [-W, 0, -D], c10 = [W, 0, -D], c11 = [W, 0, D], c01 = [-W, 0, D];
  if (alongX) {
    tri(c01, c11, B, [1, 0, 0], [0, 0, 1], D); tri(c01, B, A, [1, 0, 0], [0, 0, 1], D);
    tri(c10, c00, A, [-1, 0, 0], [0, 0, -1], D); tri(c10, A, B, [-1, 0, 0], [0, 0, -1], D);
    tri(c11, c10, B, [0, 0, -1], [1, 0, 0], W);
    tri(c00, c01, A, [0, 0, 1], [-1, 0, 0], W);
  } else {
    tri(c11, c10, A, [0, 0, -1], [1, 0, 0], W); tri(c11, A, B, [0, 0, -1], [1, 0, 0], W);
    tri(c00, c01, B, [0, 0, 1], [-1, 0, 0], W); tri(c00, B, A, [0, 0, 1], [-1, 0, 0], W);
    tri(c01, c11, B, [1, 0, 0], [0, 0, 1], D);
    tri(c10, c00, A, [-1, 0, 0], [0, 0, -1], D);
  }
  // Forro do beiral (face inferior, voltada para baixo).
  tri(c00, c10, c11, [1, 0, 0], [0, 0, 1], D); tri(c00, c11, c01, [1, 0, 0], [0, 0, 1], D);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/** Muro de jardim com capa e colisão. Segmento local alinhado a X ou Z. */
export function gardenWall(kit, x0, z0, x1, z1, h, color, capColor) {
  const m = kit.lib.m;
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.2) return;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const t = 0.24;
  kit.box(m.paint, color, cx, h / 2, cz, alongX ? len : t, h, alongX ? t : len);
  kit.box(m.trim, capColor, cx, h + 0.05, cz, alongX ? len + 0.06 : t + 0.1, 0.1, alongX ? t + 0.1 : len + 0.06);
  kit.solid(cx, cz, alongX ? len / 2 : t / 2 + 0.02, alongX ? t / 2 + 0.02 : len / 2, 0, h + 0.1, { cameraBlocker: false });
}

/** Retângulo local -> retângulo de mundo (rotações múltiplas de 90°). */
export function worldRect(kit, x0, z0, x1, z1) {
  const a = kit.toWorld(x0, 0, z0), b = kit.toWorld(x1, 0, z1);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}
