import * as THREE from 'three';
import { asDetail } from './BuildingKit.js';

/**
 * Peças arquitetônicas Art Déco / Streamline Moderne reutilizáveis.
 * Todas recebem um BuildingKit e trabalham no espaço local do edifício.
 */

export const CONE = new THREE.CylinderGeometry(0, 1, 1, 16, 1);

/** Ângulos (thetaStart) do CylinderGeometry para cada canto. */
export const CORNER_THETA = {
  fr: 0,
  br: Math.PI / 2,
  bl: Math.PI,
  fl: Math.PI * 1.5,
};

// Atlas de interiores: células com abajur/TV (acesas) e cortinas/persianas (apagadas).
const LIT_TILES = [1, 3, 6, 7];
const DIM_TILES = [0, 2, 4, 5];
/** Proporção de janelas acesas em relação ao valor original (vida noturna). */
const LIT_BOOST = 1.5;

/**
 * Material + recorte do atlas para uma vidraça. A escolha da célula usa um hash
 * da posição (não consome o gerador aleatório: o layout da cidade não muda).
 */
export function windowPane(kit, face, u, v, lit) {
  const m = kit.lib.m;
  const hx = face.ox * 12.9898 + face.oz * 78.233 + u * 37.719 + v * 19.123;
  const r = Math.abs(Math.sin(hx) * 43758.5453) % 1;
  const tiles = lit ? LIT_TILES : DIM_TILES;
  const tile = tiles[Math.floor(r * tiles.length) % tiles.length];
  return { mat: lit ? m.windowLit : m.windowGlass, opts: { uvTile: kit.lib.windowTile(tile) } };
}

export function litRoll(kit, chance) {
  return kit.rng ? kit.rng.next() < Math.min(0.85, chance * LIT_BOOST) : false;
}

/** Centro do arco de um canto arredondado de raio R. */
export function cornerCenter(corner, cx, cz, hw, hd, R) {
  const sx = corner === 'fr' || corner === 'br' ? 1 : -1;
  const sz = corner === 'fr' || corner === 'fl' ? 1 : -1;
  return { x: cx + sx * (hw - R), z: cz + sz * (hd - R) };
}

/**
 * Volume retangular com cantos arredondados opcionais.
 * corners: { fl, fr, bl, br } booleanos.
 */
export function roundedBlock(kit, mat, color, cx, cz, w, d, y0, h, R, corners = {}, opts) {
  const hw = w / 2, hd = d / 2;
  const any = corners.fl || corners.fr || corners.bl || corners.br;
  if (!any || R <= 0) {
    kit.box(mat, color, cx, y0 + h / 2, cz, w, h, d, 0, opts);
    return;
  }
  // Cruz central + cantos.
  kit.box(mat, color, cx, y0 + h / 2, cz, w, h, d - 2 * R, 0, opts);
  kit.box(mat, color, cx, y0 + h / 2, cz, w - 2 * R, h, d, 0, opts);
  for (const k of ['fl', 'fr', 'bl', 'br']) {
    const c = cornerCenter(k, cx, cz, hw, hd, R);
    if (corners[k]) {
      kit.sector(mat, color, c.x, y0 + h / 2, c.z, R, h, CORNER_THETA[k], Math.PI / 2, 12, opts);
    } else {
      const sx = k === 'fr' || k === 'br' ? 1 : -1;
      const sz = k === 'fr' || k === 'fl' ? 1 : -1;
      kit.box(mat, color, c.x + (sx * R) / 2, y0 + h / 2, c.z + (sz * R) / 2, R, h, R, 0, opts);
    }
  }
}

/** Colisores correspondentes ao roundedBlock (caixas + cilindros nos cantos). */
export function roundedSolid(kit, cx, cz, w, d, R, corners, minY, maxY, opts = {}) {
  const hw = w / 2, hd = d / 2;
  const any = corners && (corners.fl || corners.fr || corners.bl || corners.br);
  if (!any) {
    kit.solid(cx, cz, hw, hd, minY, maxY, opts);
    return;
  }
  kit.solid(cx, cz, hw, hd - R, minY, maxY, opts);
  kit.solid(cx, cz, hw - R, hd, minY, maxY, opts);
  for (const k of ['fl', 'fr', 'bl', 'br']) {
    const c = cornerCenter(k, cx, cz, hw, hd, R);
    if (corners[k]) kit.solidCyl(c.x, c.z, R, minY, maxY, opts);
    else {
      const sx = k === 'fr' || k === 'br' ? 1 : -1;
      const sz = k === 'fr' || k === 'fl' ? 1 : -1;
      kit.solid(c.x + (sx * R) / 2, c.z + (sz * R) / 2, R / 2, R / 2, minY, maxY, opts);
    }
  }
}

/** Faixa curva (vidro, marquise, neon) acompanhando um canto arredondado. */
export function curvedBand(kit, mat, color, center, r, y, h, corner, seg = 12) {
  kit.sector(mat, color, center.x, y, center.z, r, h, CORNER_THETA[corner], Math.PI / 2, seg);
}

/** Janela individual com moldura, peitoril e (opcional) "sobrancelha" Art Déco. */
export function windowUnit(kit, face, u, v, w, h, o = {}) {
  const m = kit.lib.m;
  const lit = o.lit ?? litRoll(kit, o.litChance ?? 0.18);
  const pane = windowPane(kit, face, u, v, lit);
  kit.fbox(face, pane.mat, null, u, v, w, h, 0.06, 0, { opts: pane.opts });
  asDetail(kit, () => windowTrim(kit, face, u, v, w, h, o));
}

function windowTrim(kit, face, u, v, w, h, o) {
  const m = kit.lib.m;
  if (o.frame !== null && o.frame !== undefined) {
    const f = o.frame;
    kit.fbox(face, m.trim, f, u, v + h / 2 + 0.05, w + 0.2, 0.1, 0.12);
    kit.fbox(face, m.trim, f, u - w / 2 - 0.05, v, 0.1, h, 0.12);
    kit.fbox(face, m.trim, f, u + w / 2 + 0.05, v, 0.1, h, 0.12);
    if (w > 1.3 && o.mullion !== false) kit.fbox(face, m.trim, f, u, v, 0.06, h, 0.09);
  }
  if (o.sill !== null && o.sill !== undefined) {
    kit.fbox(face, m.trim, o.sill, u, v - h / 2 - 0.06, w + 0.32, 0.12, 0.22);
  }
  if (o.brow !== null && o.brow !== undefined) {
    kit.fbox(face, m.trim, o.brow, u, v + h / 2 + 0.3, w + 0.7, 0.12, o.browDepth ?? 0.55);
  }
  if (o.shutters !== null && o.shutters !== undefined) {
    kit.fbox(face, m.trim, o.shutters, u - w / 2 - 0.42, v, 0.62, h + 0.1, 0.08, 0.02);
    kit.fbox(face, m.trim, o.shutters, u + w / 2 + 0.42, v, 0.62, h + 0.1, 0.08, 0.02);
    for (let i = 0; i < 5; i++) {
      const yy = v - h / 2 + (i + 0.5) * (h / 5);
      kit.fbox(face, m.trim, o.shutterLines ?? 0xffffff, u - w / 2 - 0.42, yy, 0.62, 0.04, 0.03, 0.1);
      kit.fbox(face, m.trim, o.shutterLines ?? 0xffffff, u + w / 2 + 0.42, yy, 0.62, 0.04, 0.03, 0.1);
    }
  }
}

/** Grade de janelas numa face. */
export function windowGrid(kit, face, o) {
  const {
    rows, cols, y0, floorH, winW, winH, spacing, uOffset = 0, skip = null, vOffset = 0.15,
  } = o;
  for (let r = 0; r < rows; r++) {
    const v = y0 + r * floorH + floorH / 2 + vOffset;
    for (let c = 0; c < cols; c++) {
      if (skip && skip(r, c)) continue;
      const u = uOffset + (c - (cols - 1) / 2) * spacing;
      windowUnit(kit, face, u, v, winW, winH, o);
    }
  }
}

/** Janelas em fita contínua (Streamline Moderne) com montantes. */
export function ribbonWindows(kit, face, { from, to, v, h, mullion = 1.6, frame = 0xffffff, litChance = 0.15 }) {
  const m = kit.lib.m;
  const len = to - from;
  const center = (from + to) / 2;
  const segs = Math.max(1, Math.round(len / mullion));
  const segW = len / segs;
  for (let i = 0; i < segs; i++) {
    const u = from + segW * (i + 0.5);
    const lit = litRoll(kit, litChance);
    const pane = windowPane(kit, face, u, v, lit);
    kit.fbox(face, pane.mat, null, u, v, segW - 0.08, h, 0.06, 0, { opts: pane.opts });
  }
  asDetail(kit, () => {
    for (let i = 0; i <= segs; i++) {
      kit.fbox(face, m.trim, frame, from + segW * i, v, 0.08, h, 0.1);
    }
    kit.fbox(face, m.trim, frame, center, v + h / 2 + 0.04, len, 0.08, 0.1);
    kit.fbox(face, m.trim, frame, center, v - h / 2 - 0.05, len + 0.1, 0.1, 0.18);
  });
}

/** Faixa horizontal saliente (sobrancelha contínua / cornija). */
export function ledge(kit, face, u, width, v, depth, color, thick = 0.14) {
  kit.fbox(face, kit.lib.m.trim, color, u, v, width, thick, depth, 0);
}

/** Fachada de loja: rodapé, vitrine, montantes e porta. */
export function storefront(kit, face, u, width, height, o = {}) {
  const m = kit.lib.m;
  const frame = o.frame ?? 0xe8ecf2;
  const kick = o.kick ?? 0x3a3a44;
  // Vitrine com interior do atlas (variação por posição, sem consumir o gerador aleatório).
  let glassMat = o.glass, glassOpts;
  if (!glassMat) {
    glassMat = m.shopWindow;
    const r = Math.abs(Math.sin(face.ox * 3.17 + face.oz * 7.31 + u * 1.7 + kit.ox * 0.13 + kit.oz * 0.29) * 43758.5453) % 1;
    glassOpts = { uvTile: kit.lib.shopTile(o.interior ?? [0, 0, 2, 3][Math.floor(r * 4)]) };
  }
  const doorW = o.doorW ?? 2.2;
  const doorU = o.doorU ?? 0;
  kit.fbox(face, m.trim, kick, u, 0.25, width, 0.5, 0.1, 0);
  kit.fbox(face, glassMat, null, u, 0.5 + (height - 0.5) / 2, width, height - 0.5, 0.05, 0, { opts: glassOpts });
  const segs = Math.max(1, Math.round(width / (o.mullion ?? 1.8)));
  asDetail(kit, () => {
    for (let i = 0; i <= segs; i++) {
      kit.fbox(face, m.trim, frame, u - width / 2 + (width / segs) * i, height / 2 + 0.25, 0.09, height - 0.5, 0.1);
    }
    kit.fbox(face, m.trim, frame, u, height + 0.05, width + 0.1, 0.12, 0.14);
    kit.fbox(face, m.trim, frame, u, 0.52, width, 0.06, 0.12);
  });
  if (o.door !== false) {
    // Porta comercial de 2,45 m no máximo; acima dela, travessa e bandeira envidraçada.
    const dh = Math.min(2.45, height - 0.2);
    door(kit, face, u + doorU, doorW, dh, { frame, leaf: o.doorLeaf, glassLeaf: o.glassDoor ?? true, outset: 0.1 });
    if (height - dh > 0.45) asDetail(kit, () => kit.fbox(face, kit.lib.m.trim, frame, u + doorU, dh + 0.16, doorW + 0.32, 0.08, 0.12, 0.1));
  }
}

/** Porta fechada (folhas duplas). Nunca parece aberta. */
export function door(kit, face, u, w, h, o = {}) {
  const m = kit.lib.m;
  const frame = o.frame ?? 0xf0efe8;
  const outset = o.outset ?? 0;
  kit.fbox(face, m.trim, frame, u, h / 2 + 0.06, w + 0.32, h + 0.12, 0.1, outset);
  const leafMat = o.glassLeaf ? m.glass : m.trim;
  const leafColor = o.leaf ?? 0x3b2b24;
  const lw = w / 2 - 0.05;
  kit.fbox(face, leafMat, leafColor, u - w / 4, h / 2 + 0.02, lw, h - 0.06, 0.06, outset + 0.1);
  kit.fbox(face, leafMat, leafColor, u + w / 4, h / 2 + 0.02, lw, h - 0.06, 0.06, outset + 0.1);
  // Montantes das folhas e puxadores (detalhe).
  asDetail(kit, () => {
    kit.fbox(face, m.trim, frame, u, h / 2, 0.08, h - 0.04, 0.08, outset + 0.1);
    kit.fbox(face, m.chrome, null, u - 0.16, h * 0.48, 0.05, 0.6, 0.06, outset + 0.16);
    kit.fbox(face, m.chrome, null, u + 0.16, h * 0.48, 0.05, 0.6, 0.06, outset + 0.16);
    kit.fbox(face, m.trim, frame, u, h * 0.45, w - 0.1, 0.05, 0.03, outset + 0.16);
  });
}

/** Toldo listrado inclinado com aba frontal. */
export function awning(kit, face, u, width, yTop, proj, colors, drop = 0.4) {
  const m = kit.lib.m;
  const n = Math.max(2, Math.round(width / 0.55));
  const sw = width / n;
  const slope = Math.atan2(0.9, proj);
  const len = Math.hypot(proj, 0.9);
  // O centro da peça inclinada fica a proj/2 da parede (projeção horizontal).
  const outset = (proj - len) / 2;
  for (let i = 0; i < n; i++) {
    const uu = u - width / 2 + sw * (i + 0.5);
    const col = colors[i % colors.length];
    kit.fbox(face, m.fabric, col, uu, yTop - 0.45, sw + 0.005, 0.04, len, outset, { rx: slope });
    kit.fbox(face, m.fabric, col, uu, yTop - 0.9 - drop / 2, sw + 0.005, drop, 0.03, proj - 0.02);
  }
  // Suportes metálicos (detalhe).
  asDetail(kit, () => {
    kit.fbox(face, m.darkMetal, null, u - width / 2, yTop - 0.5, 0.04, 0.04, len, outset, { rx: slope });
    kit.fbox(face, m.darkMetal, null, u + width / 2, yTop - 0.5, 0.04, 0.04, len, outset, { rx: slope });
  });
}

/** Marquise (laje em balanço) com faixa neon frontal opcional. */
export function canopy(kit, face, u, width, y, proj, color, o = {}) {
  const m = kit.lib.m;
  const t = o.thick ?? 0.35;
  kit.fbox(face, m.trim, color, u, y + t / 2, width, t, proj, 0);
  kit.fbox(face, m.trim, o.edge ?? color, u, y + t + 0.08, width, 0.16, 0.12, proj - 0.12);
  if (o.neon) {
    kit.fbox(face, kit.lib.neon(o.neon, 2.4), null, u, y + t * 0.5, width + 0.02, 0.07, 0.04, proj);
  }
  if (o.lights) {
    const n = Math.max(2, Math.round(width / 2.2));
    for (let i = 0; i < n; i++) {
      const uu = u - width / 2 + (width / n) * (i + 0.5);
      kit.fbox(face, m.lampOn, null, uu, y - 0.02, 0.3, 0.04, 0.3, proj * 0.55);
    }
  }
  if (o.poles) {
    for (const s of [-1, 1]) {
      const p = kit.facePoint(face, u + s * (width / 2 - 0.4), 0, proj - 0.4);
      kit.cyl(m.chrome, null, p.x, y / 2, p.z, 0.08, y, { seg: 8 });
      kit.solidCyl(p.x, p.z, 0.12, 0, y, { cameraBlocker: false });
    }
  }
}

/** Aletas verticais (fins) perpendiculares à fachada. */
export function fins(kit, face, us, y0, y1, depth, width, color, neonColor = null) {
  const m = kit.lib.m;
  for (const u of us) {
    kit.fbox(face, m.trim, color, u, (y0 + y1) / 2, width, y1 - y0, depth, 0);
    if (neonColor) {
      kit.fbox(face, kit.lib.neon(neonColor, 2.3), null, u, (y0 + y1) / 2, 0.07, y1 - y0 - 0.2, 0.05, depth);
    }
  }
}

/** Coroamento escalonado ("zigurate") sobre a fachada frontal. */
export function steppedParapet(kit, face, u, y, steps, color, depth = 0.5) {
  const m = kit.lib.m;
  let yy = y;
  for (const s of steps) {
    kit.fbox(face, m.trim, color, u, yy + s.h / 2, s.w, s.h, depth, -depth);
    yy += s.h;
  }
  return yy;
}

/** Equipamentos de cobertura: condensadoras, dutos e caixa d'água. */
export function roofClutter(kit, cx, cz, w, d, y, rng, opts = {}) {
  return asDetail(kit, () => roofClutterImpl(kit, cx, cz, w, d, y, rng, opts));
}

function roofClutterImpl(kit, cx, cz, w, d, y, rng, opts) {
  const m = kit.lib.m;
  const n = opts.count ?? Math.max(1, Math.round((w * d) / 160));
  for (let i = 0; i < n; i++) {
    const x = cx + rng.range(-w / 2 + 2, w / 2 - 2);
    const z = cz + rng.range(-d / 2 + 2, d / 2 - 2);
    const s = rng.range(1, 1.8);
    kit.box(m.metal, 0xb7bcc4, x, y + 0.5, z, s, 1, s * 0.8);
    kit.box(m.darkMetal, null, x, y + 1.02, z, s * 0.7, 0.05, s * 0.6);
    // Exaustor giratório (animado pelo AmbientSystem, quando disponível).
    if (kit.fans) kit.fans.push({ p: kit.toWorld(x, y + 1.08, z), r: s * 0.28 });
  }
  if (opts.tank) {
    const tx = cx + (opts.tank.x ?? 0), tz = cz + (opts.tank.z ?? 0);
    for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      kit.box(m.darkMetal, null, tx + ax * 1.1, y + 1.2, tz + az * 1.1, 0.15, 2.4, 0.15);
    }
    kit.cyl(m.paint, opts.tank.color ?? 0xd8d0c4, tx, y + 3.6, tz, 1.6, 2.4);
    kit.geom(CONE, m.paint, opts.tank.roof ?? 0x9a8f86, tx, y + 5.25, tz, 0, 0, 0, 1.75, 0.9, 1.75);
  }
}
