import * as THREE from 'three';
import { groundPlane } from '../../render/StaticBatcher.js';
import {
  windowUnit, ledge, storefront, door, awning, canopy, steppedParapet, roofClutter, CONE,
} from './ArtDecoParts.js';
import {
  pilasters, frieze, balcony, breezeBlocks, tiledBoxGeometry, hipRoofGeometry, gardenWall, worldRect,
} from './DecoModules.js';

/**
 * Tipos de edifícios das zonas novas do Prompt 02:
 *  - shop     Zona B (comercial): lojas de rua com vitrines, toldos e letreiros
 *  - house    Zona D (residencial): bangalôs e casas "MiMo" com lotes murados
 *  - busStop  abrigo de ônibus (mobiliário urbano construído com o kit)
 * Espaço local: frente voltada para +Z, chão em y = 0 (topo da calçada).
 */

function finish(kit, spec, height, entrances) {
  return {
    ...kit.end(),
    height,
    entrances: entrances.map((e) => {
      const p = kit.toWorld(e.x, 0, e.z);
      return { x: p.x, y: p.y, z: p.z, label: e.label || spec.name };
    }),
  };
}

// ---------------------------------------------------------------- Zona B

const SHOP_VARIANTS = {
  cafe: { wall: 0xf6d7a7, trim: 0x2f8f83, accent: 0xffffff, awning: [0x2f8f83, 0xfdf6ea], sign: '#ffb347', style: 'script', parapet: 'step', frieze: 'chevron' },
  pharmacy: { wall: 0xe9f4ee, trim: 0x3aa36b, accent: 0x1f6f4a, awning: null, sign: '#5dff9a', style: 'block', parapet: 'flat', frieze: 'flutes' },
  barber: { wall: 0xbfe0f2, trim: 0xd8433a, accent: 0xffffff, awning: [0xd8433a, 0xffffff, 0x2f5f9e, 0xffffff], sign: '#ff5a6e', style: 'deco', parapet: 'peak', frieze: 'dentil' },
  icecream: { wall: 0xf9c6d8, trim: 0xfff4e0, accent: 0x7fd6cf, awning: [0xf38bb2, 0xfff4e0], sign: '#ff8fd8', style: 'script', parapet: 'curve', frieze: 'dentil' },
  laundry: { wall: 0xcde9f6, trim: 0x2f6fb0, accent: 0xffffff, awning: null, sign: '#45f3ff', style: 'block', parapet: 'step', frieze: 'flutes' },
  travel: { wall: 0xf3e5ab, trim: 0xe5826a, accent: 0x3a9e9a, awning: [0xe5826a, 0xfdf6ea], sign: '#ffe95a', style: 'deco', parapet: 'flat', frieze: 'chevron' },
  records: { wall: 0x4b3466, trim: 0xf2a6c8, accent: 0x1d1528, awning: null, sign: '#ff6fd0', style: 'block', parapet: 'peak', frieze: 'chevron' },
};

function shop(kit, spec) {
  const m = kit.lib.m;
  const rng = kit.rng;
  const V = SHOP_VARIANTS[spec.variant] ?? SHOP_VARIANTS.cafe;
  const P = { ...V, ...spec.palette };
  const w = spec.w ?? 9, d = spec.d ?? 10;
  const hw = w / 2, hd = d / 2;
  const floors = spec.floors ?? 1;
  // Térreo alto: vitrine (até 3,1 m), bandeira, faixa do letreiro e friso sem sobreposição.
  const gf = 5.6, fh = 3.2;
  const H = gf + (floors - 1) * fh;

  kit.box(m.paint, P.wall, 0, H / 2, 0, w, H, d);
  kit.box(m.trim, P.trim, 0, H + 0.15, 0, w + 0.3, 0.3, d + 0.3);
  kit.solid(0, 0, hw, hd, 0, H + 0.3);
  const front = kit.face('front', 0, 0, hw, hd);

  // Vitrine com bandeira de blocos de vidro, pilastras laterais e faixa do letreiro.
  const sfW = w - 1.6;
  storefront(kit, front, 0, sfW, 3.1, { interior: { cafe: 2, pharmacy: 0, barber: 3, icecream: 2, laundry: 1, travel: 0, records: 3 }[spec.variant] ?? 0, frame: P.accent === 0xffffff ? 0xf4f1ea : P.accent, kick: P.trim, doorU: spec.doorU ?? (rng.chance(0.5) ? -sfW / 2 + 1.4 : sfW / 2 - 1.4), mullion: 1.5 });
  kit.fbox(front, m.glassBlock, null, 0, 3.45, sfW, 0.45, 0.05, 0);
  kit.fbox(front, m.trim, P.trim, 0, 3.72, sfW + 0.2, 0.1, 0.14, 0);
  pilasters(kit, front, [-hw + 0.4, hw - 0.4], 0, H - 0.2, P.trim, { width: 0.55, depth: 0.2, base: P.accent });
  frieze(kit, front, 0, w - 1.6, H - 0.38, P.frieze, P.trim, { height: 0.3 });

  // Coroamento: cada variante com silhueta própria.
  if (P.parapet === 'step') {
    steppedParapet(kit, front, 0, H + 0.3, [{ w: w * 0.62, h: 0.6 }, { w: w * 0.36, h: 0.6 }, { w: w * 0.14, h: 0.5 }], P.trim, 0.4);
  } else if (P.parapet === 'peak') {
    for (let k = 0; k < 5; k++) kit.fbox(front, m.trim, k % 2 ? P.accent : P.trim, 0, H + 0.3 + k * 0.32 + 0.16, w * (0.8 - k * 0.15), 0.32, 0.35, -0.35);
  } else if (P.parapet === 'curve') {
    const r = w * 0.34, n = 7;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      kit.fbox(front, m.trim, k === n - 1 ? P.accent : P.trim, 0, H + 0.3 + (k + 0.5) * (r * 0.62 / n), 2 * r * Math.sqrt(1 - t * t), r * 0.62 / n + 0.01, 0.35, -0.35);
    }
  } else {
    kit.fbox(front, m.trim, P.accent, 0, H + 0.55, w + 0.3, 0.5, 0.3, -0.15);
  }

  // Letreiro neon na faixa acima da vitrine (ou caixa de luz).
  if (spec.sign) {
    const s = kit.signs.text(spec.sign, { color: P.sign, style: P.style, width: Math.min(w - 2.2, 7.5), height: 1.05, flicker: spec.flicker || 'steady', sub: spec.sub, subColor: '#ffffff' });
    kit.attach(s, 0, 4.55, hd + 0.12, 0);
  }

  // Toldo ou marquise.
  if (P.awning) awning(kit, front, 0, sfW + 0.4, 3.85, 1.5, P.awning, 0.32);
  else canopy(kit, front, 0, sfW + 0.6, 3.6, 1.1, P.trim, { thick: 0.18, lights: true });

  // Andar superior: janelas com sobrancelha e uma varanda.
  for (let f = 1; f < floors; f++) {
    const y = gf + (f - 1) * fh;
    const n = Math.max(2, Math.floor(w / 3));
    for (let i = 0; i < n; i++) {
      const u = -hw + (w / n) * (i + 0.5);
      windowUnit(kit, front, u, y + 1.7, 1.3, 1.5, { frame: 0xffffff, sill: P.trim, brow: P.trim, browDepth: 0.45, litChance: 0.35 });
    }
    if (rng.chance(0.6)) balcony(kit, front, -hw + w / n / 2, y + 0.55, 2.2, 0.9, P.trim, 0xffffff);
  }

  // Detalhes de cada ramo.
  const v = spec.variant;
  if (v === 'cafe') {
    for (const u of [-hw + 1.5, hw - 1.5]) {
      const p = kit.facePoint(front, u, 0, 1.0);
      kit.cyl(m.darkMetal, null, p.x, 0.37, p.z, 0.05, 0.74, { seg: 8 });
      kit.cyl(m.trim, 0xf4f1ea, p.x, 0.75, p.z, 0.38, 0.04, { seg: 12 });
      for (const s of [-1, 1]) kit.box(m.trim, P.trim, p.x + s * 0.62, 0.45, p.z, 0.4, 0.06, 0.4);
      kit.cyl(m.darkMetal, null, p.x, 1.4, p.z, 0.025, 1.3, { seg: 6 });
      kit.geom(CONE, m.fabric, P.awning[0], p.x, 2.15, p.z, 0, 0, 0, 1.0, 0.35, 1.0);
      kit.solidCyl(p.x, p.z, 0.45, 0, 0.8, { cameraBlocker: false });
    }
  } else if (v === 'barber') {
    const p = kit.facePoint(front, hw - 0.4, 0, 0.32);
    kit.cyl(m.chrome, null, p.x, 2.0, p.z, 0.13, 0.12, { seg: 12 });
    const cols = [0xd8433a, 0xffffff, 0x2f5f9e, 0xffffff];
    for (let i = 0; i < 8; i++) kit.cyl(m.trim, cols[i % 4], p.x, 2.12 + i * 0.12 + 0.06, p.z, 0.1, 0.12, { seg: 12 });
    kit.cyl(m.chrome, null, p.x, 3.1, p.z, 0.13, 0.12, { seg: 12 });
  } else if (v === 'pharmacy') {
    // Cruz luminosa em bandeira, perpendicular à fachada.
    const g = kit.lib.neon(0x3dff8a, 2.2);
    const bx = -hw + 0.6, bz = hd + 1.0;
    kit.box(m.darkMetal, null, bx, 4.4, hd + 0.25, 0.08, 0.08, 0.5);
    kit.box(m.trim, 0xffffff, bx, 4.4, bz, 0.2, 1.2, 1.2);
    for (const s of [-1, 1]) {
      kit.box(g, null, bx + s * 0.11, 4.4, bz, 0.04, 1.0, 0.34);
      kit.box(g, null, bx + s * 0.11, 4.4, bz, 0.04, 0.34, 1.0);
    }
  } else if (v === 'laundry') {
    // Saída de ar da secadora na fachada (as máquinas aparecem no interior da vitrine).
    kit.fbox(front, m.metal, 0xc8ccd2, hw - 1.2, H - 1.2, 0.6, 0.4, 0.25, 0);
  } else if (v === 'icecream') {
    // Casquinha gigante sobre a cobertura (letreiro tridimensional).
    const p = kit.facePoint(front, 0, 0, -1.6);
    kit.geom(CONE, m.paint, 0xe2b06e, p.x, H + 2.6, p.z, Math.PI, 0, 0, 0.75, 2.3, 0.75);
    kit.sphere(m.paint, 0xfff1d6, p.x, H + 3.85, p.z, 0.82, 0.7, 0.82);
    kit.sphere(m.paint, 0xf38bb2, p.x, H + 4.45, p.z, 0.66, 0.58, 0.66);
    kit.sphere(m.trim, 0xd8283a, p.x, H + 5.0, p.z, 0.16, 0.16, 0.16);
    kit.solidCyl(p.x, p.z, 0.9, H, H + 5.2);
  } else if (v === 'records') {
    const s = kit.signs.vertical(spec.blade ?? 'RECORDS', { color: '#45f3ff', width: 0.8, height: 3.4 });
    kit.attach(s, hw - 0.6, H - 2.1, hd + 0.6, Math.PI / 2);
    kit.box(m.darkMetal, null, hw - 0.6, H - 0.35, hd + 0.3, 0.06, 0.06, 0.6);
  } else if (v === 'travel') {
    const s = kit.signs.icon('palm', { color: '#45f3ff', color2: '#ff6fd0', size: 1.4 });
    kit.attach(s, hw - 1.1, H + 1.3, hd - 0.2, 0);
  }

  // Placa pendurada em suporte, balançando ao vento (café, barbearia, sorveteria, farmácia).
  if (kit.swings && ['cafe', 'barber', 'icecream', 'travel'].includes(v)) {
    const u = hw - 0.4;
    kit.fbox(front, m.darkMetal, null, u, 3.05, 0.05, 0.05, 1.0, 0.18);
    const pivot = new THREE.Group();
    const swing = new THREE.Group();
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.62), kit.lib.solid(P.trim, 0.6, 0.05));
    plaque.position.y = -0.32;
    plaque.castShadow = true;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.5), kit.lib.solid(P.accent === 0xffffff ? 0xfdf6ea : P.accent, 0.5, 0.05));
    rim.position.y = -0.32;
    swing.add(plaque, rim);
    pivot.add(swing);
    kit.attach(pivot, u, 3.0, hd + 0.75, 0);
    kit.swings.push(swing);
  }

  // Lateral exposta: pilastras, janela alta e uma porta de serviço.
  for (const side of spec.exposedSides ?? []) {
    const f = kit.face(side, 0, 0, hw, hd);
    pilasters(kit, f, [-hd + 0.4, hd - 0.4], 0, H - 0.2, P.trim, { width: 0.45, depth: 0.15 });
    windowUnit(kit, f, 0, 2.4, 1.2, 1.2, { frame: 0xffffff, sill: P.trim, litChance: 0.3 });
    door(kit, f, -hd + 2.2, 1.0, 2.2, { frame: P.trim, leaf: 0x6a6f78 });
    if (floors > 1) windowUnit(kit, f, 0, gf + 1.7, 1.2, 1.4, { frame: 0xffffff, sill: P.trim, litChance: 0.3 });
  }
  roofClutter(kit, 0, -hd * 0.3, w - 2, d - 3, H + 0.3, rng, { count: 1 });
  return finish(kit, spec, H + 2, [{ x: 0, z: hd + 0.4 }]);
}

// ---------------------------------------------------------------- Zona D

const HOUSE_PALETTES = {
  bungalow: [
    { wall: 0xf7c9c9, trim: 0xfdf8ee, accent: 0x3a9e9a, wallLot: 0xf2e6d4 },
    { wall: 0xf6e3a1, trim: 0xffffff, accent: 0xe5826a, wallLot: 0xf4ead8 },
    { wall: 0xfdfaf2, trim: 0x5fc0c8, accent: 0x2f6fb0, wallLot: 0xe6efe9 },
  ],
  mimo: [
    { wall: 0xbfe6d8, trim: 0xffffff, accent: 0xf29eb4, wallLot: 0xe9f3ef, stone: 0xb8a48c },
    { wall: 0xd9c8f0, trim: 0xfbf8f2, accent: 0xf5b26b, wallLot: 0xefe9f6, stone: 0xa89a8a },
  ],
};

/**
 * Casa térrea em lote murado. spec: style ('bungalow' | 'mimo'), lotW, lotD,
 * garage ('left' | 'right' | null), carport (mimo), walls { left, right, back }.
 */
function house(kit, spec) {
  const m = kit.lib.m;
  const rng = kit.rng;
  const style = spec.style ?? 'bungalow';
  const P = { ...HOUSE_PALETTES[style][(spec.paletteIndex ?? rng.int(0, 9)) % HOUSE_PALETTES[style].length], ...spec.palette };
  const lotW = spec.lotW ?? 14, lotD = spec.lotD ?? 22;
  const lw = lotW / 2, ld = lotD / 2;
  const w = spec.w ?? (style === 'mimo' ? 10.5 : 9.5);
  const d = spec.d ?? 8.5;
  const hw = w / 2, hd = d / 2;
  const garageSide = spec.garage === undefined ? (rng.chance(0.5) ? 'left' : 'right') : spec.garage;
  const gSign = garageSide === 'left' ? -1 : 1;
  const gW = 3.8;
  // Casa deslocada para o lado oposto à garagem; recuo frontal de ~6 m.
  const hx = garageSide ? -gSign * (gW / 2 - 0.2) : 0;
  const hz = ld - 6.2 - hd;
  const wallH = style === 'mimo' ? 3.1 : 3.3;

  // --- Lote: gramado, entrada de carros, caminho e muros.
  const grass = groundPlane(lotW - 0.3, lotD - 0.3, 4);
  kit.geom(grass, m.overlayGrass, null, 0, 0.004, 0);
  grass.dispose();
  const drvX = garageSide ? hx + gSign * (hw + gW / 2) : hx + hw - 1.6;
  const drvLen = ld - (hz + hd) + (garageSide ? 0 : 0);
  const drive = groundPlane(3.2, drvLen, 3);
  kit.geom(drive, m.sidewalk, null, drvX, 0.012, ld - drvLen / 2);
  drive.dispose();
  const pathX = hx + (spec.doorU ?? -1.2);
  const pathLen = ld - (hz + hd) - (style === 'bungalow' ? 2.0 : 0);
  const path = groundPlane(1.3, pathLen, 1.5);
  kit.geom(path, m.pavers, null, pathX, 0.012, ld - pathLen / 2);
  path.dispose();
  if (kit.terrain) {
    const r = worldRect(kit, -lw, -ld, lw, ld);
    kit.terrain.addSurfaceZone(r.minX, r.minZ, r.maxX, r.maxZ, 'grass', 2);
  }

  const wallC = P.wallLot, capC = P.trim;
  const fz = ld - 0.15;
  const gaps = [[pathX - 0.8, pathX + 0.8], [drvX - 1.7, drvX + 1.7]].sort((a, b) => a[0] - b[0]);
  let cur = -lw;
  for (const [a, b] of gaps) {
    if (a > cur + 0.2) gardenWall(kit, cur, fz, a, fz, 0.9, wallC, capC);
    // Pilares do portão.
    for (const x of [a, b]) {
      kit.box(m.paint, wallC, x, 0.65, fz, 0.42, 1.3, 0.42);
      kit.box(m.trim, capC, x, 1.36, fz, 0.5, 0.12, 0.5);
    }
    cur = b;
  }
  if (lw > cur + 0.2) gardenWall(kit, cur, fz, lw, fz, 0.9, wallC, capC);
  const walls = spec.walls ?? { left: true, right: false, back: true };
  if (walls.left) gardenWall(kit, -lw + 0.15, -ld, -lw + 0.15, fz - 0.15, 1.5, wallC, capC);
  if (walls.right) gardenWall(kit, lw - 0.15, -ld, lw - 0.15, fz - 0.15, 1.5, wallC, capC);
  if (walls.back) gardenWall(kit, -lw, -ld + 0.15, lw, -ld + 0.15, 1.8, wallC, capC);

  // Caixa de correio junto à entrada de carros.
  {
    // Do lado de fora do muro, junto ao pilar do portão de pedestres.
    const px = pathX + 1.25;
    kit.box(m.darkMetal, null, px, 0.55, fz + 0.45, 0.08, 1.1, 0.08);
    kit.box(m.paint, P.accent, px, 1.18, fz + 0.45, 0.28, 0.26, 0.48);
    kit.box(m.trim, 0xd8283a, px + 0.16, 1.3, fz + 0.4, 0.03, 0.16, 0.05);
    kit.solidCyl(px, fz + 0.45, 0.2, 0, 1.3, { cameraBlocker: false });
  }

  // Sebe interna junto ao muro frontal (fora dos acessos).
  {
    let c0 = -lw + 0.4;
    for (const [a, b] of gaps) {
      if (a - c0 > 1.2) {
        const len = a - 0.4 - c0;
        kit.geom(tiledBoxGeometry(len, 0.8, 0.7, 1.2), m.hedge, null, c0 + len / 2, 0.4, fz - 0.6);
      }
      c0 = b + 0.4;
    }
    if (lw - 0.4 - c0 > 1.2) {
      const len = lw - 0.4 - c0;
      kit.geom(tiledBoxGeometry(len, 0.8, 0.7, 1.2), m.hedge, null, c0 + len / 2, 0.4, fz - 0.6);
    }
  }

  // --- Casa.
  kit.box(m.paint, P.wall, hx, wallH / 2, hz, w, wallH, d);
  kit.box(m.trim, style === 'mimo' ? P.stone : P.accent, hx, 0.3, hz, w + 0.06, 0.6, d + 0.06);
  kit.solid(hx, hz, hw, hd, 0, wallH + (style === 'mimo' ? 0.4 : 2.0));
  const front = kit.face('front', hx, hz, hw, hd);
  const left = kit.face('left', hx, hz, hw, hd);
  const right = kit.face('right', hx, hz, hw, hd);
  const back = kit.face('back', hx, hz, hw, hd);
  const doorU = spec.doorU ?? -1.2;

  if (style === 'bungalow') {
    // Telhado de quatro águas em telha cerâmica + testeira.
    const roof = hipRoofGeometry(w, d, 2.0, 0.65, 2);
    kit.geom(roof, m.roofTile, null, hx, wallH, hz);
    roof.dispose();
    kit.box(m.trim, P.trim, hx, wallH - 0.08, hz, w + 1.32, 0.16, d + 1.32);
    // Varanda frontal com colunas e telhadinho.
    kit.box(m.trim, 0xd9cfc2, hx + doorU, 0.15, hz + hd + 1.0, 3.6, 0.3, 2.0);
    kit.solid(hx + doorU, hz + hd + 1.0, 1.8, 1.0, 0, 0.3, { cameraBlocker: false });
    for (const s of [-1, 1]) {
      kit.cyl(m.trim, P.trim, hx + doorU + s * 1.55, 1.5, hz + hd + 1.8, 0.12, 2.6, { seg: 10 });
      kit.solidCyl(hx + doorU + s * 1.55, hz + hd + 1.8, 0.14, 0, 2.8, { cameraBlocker: false });
    }
    kit.box(m.trim, P.trim, hx + doorU, 2.85, hz + hd + 1.05, 3.9, 0.22, 2.3);
    kit.geom(tiledBoxGeometry(3.8, 0.12, 2.2, 2), m.roofTile, null, hx + doorU, 3.02, hz + hd + 1.05, -0.12, 0, 0);
    door(kit, front, doorU, 1.1, 2.3, { frame: P.trim, leaf: P.accent });
    // Janelas com venezianas (jalousie).
    for (const u of [doorU - 2.7, doorU + 2.7, doorU + 5.2, doorU - 5.2].filter((u) => u > -hw + 1.3 && u < hw - 1.3)) {
      windowUnit(kit, front, u, 1.75, 1.3, 1.45, { frame: 0xffffff, sill: P.trim, shutters: P.accent, shutterLines: P.trim, litChance: 0.4 });
    }
    for (const f of [left, right]) windowUnit(kit, f, 0, 1.75, 1.2, 1.3, { frame: 0xffffff, sill: P.trim, litChance: 0.3 });
    windowUnit(kit, back, 0, 1.75, 1.2, 1.3, { frame: 0xffffff, sill: P.trim, litChance: 0.2 });
  } else {
    // MiMo: laje plana com beiral largo, cobogós e parede de pedra.
    kit.box(m.trim, P.trim, hx, wallH + 0.18, hz + 0.4, w + 1.6, 0.26, d + 2.2);
    kit.box(m.trim, P.accent, hx, wallH + 0.36, hz + 0.4, w + 1.66, 0.1, d + 2.26);
    // Parede de pedra (faixa vertical) e cobogós ao lado da porta.
    kit.fbox(front, m.paint, P.stone, -hw + 1.3, wallH / 2, 2.6, wallH, 0.12, 0);
    breezeBlocks(kit, front, doorU + 1.9, 0.35, 4, 6, P.trim, 0.42, 0.25);
    door(kit, front, doorU, 1.2, 2.4, { frame: P.accent, leaf: 0xf4f1ea, glassLeaf: true });
    // Janelas em fita (clerestório) e janela larga.
    kit.fbox(front, m.windowGlass, null, hw - 2.0, 1.8, 2.6, 1.5, 0.06, 0, { opts: { uvTile: kit.lib.windowTile(rng.pick([0, 2, 4])) } });
    kit.fbox(front, m.trim, 0xffffff, hw - 2.0, 1.02, 2.9, 0.12, 0.2, 0);
    for (const f of [left, right]) kit.fbox(f, m.windowGlass, null, 0, wallH - 0.55, d - 2.5, 0.5, 0.06, 0, { opts: { uvTile: kit.lib.windowTile(5) } });
    windowUnit(kit, back, 0, 1.75, 1.6, 1.3, { frame: 0xffffff, litChance: 0.3 });
  }

  // Garagem anexa (bangalô) ou cobertura para carro com pilares inclinados (MiMo).
  if (garageSide) {
    const gx = hx + gSign * (hw + gW / 2);
    const gz = hz + hd - 3.2;
    if (style === 'mimo' && spec.carport !== false) {
      kit.box(m.trim, P.trim, gx, 2.75, gz + 0.6, gW + 0.4, 0.2, 7.4);
      kit.box(m.trim, P.accent, gx, 2.89, gz + 0.6, gW + 0.44, 0.08, 7.44);
      for (const zz of [gz + 3.7, gz - 1.6]) {
        kit.box(m.darkMetal, null, gx + gSign * (gW / 2 - 0.1), 1.35, zz, 0.12, 2.8, 0.12, 0, undefined, 0, gSign * 0.18);
        kit.solidCyl(gx + gSign * (gW / 2 - 0.1), zz, 0.12, 0, 2.7, { cameraBlocker: false });
      }
    } else {
      kit.box(m.paint, P.wall, gx, 1.45, gz, gW, 2.9, 6.4);
      kit.box(m.trim, P.trim, gx, 2.98, gz, gW + 0.2, 0.18, 6.6);
      kit.solid(gx, gz, gW / 2, 3.2, 0, 3.1);
      const gf = kit.face('front', gx, gz, gW / 2, 3.2);
      kit.fbox(gf, m.garageDoor, null, 0, 1.15, gW - 0.9, 2.2, 0.06, 0);
      kit.fbox(gf, m.trim, P.trim, 0, 2.35, gW - 0.6, 0.16, 0.12, 0);
      kit.fbox(gf, m.lampOn, null, 0, 2.6, 0.22, 0.18, 0.1, 0.02);
    }
  }

  // --- Jardim: palmeira, arbustos, agaves, flores e uma árvore pequena.
  const plant = (type, x, z, scale = 1) => {
    if (!kit.plants) return;
    const p = kit.toWorld(x, 0, z);
    kit.plants.push({ type, x: p.x, y: p.y, z: p.z, scale, rot: rng.range(0, Math.PI * 2) });
  };
  const yardX0 = -lw + 0.9, yardX1 = lw - 0.9;
  const fy0 = hz + hd + (style === 'bungalow' ? 2.3 : 0.9), fy1 = fz - 1.2;
  for (let i = 0; i < 4; i++) {
    const x = yardX0 + rng.next() * (yardX1 - yardX0);
    if (Math.abs(x - pathX) < 1.4 || Math.abs(x - drvX) < 2.2) continue;
    plant(rng.chance(0.5) ? 'shrub' : 'flowers', x, THREE.MathUtils.lerp(fy0, fy1, rng.next()), rng.range(0.8, 1.3));
  }
  plant('agave', pathX + 1.1, fz - 1.5, rng.range(0.8, 1.1));
  plant('agave', pathX - 1.1, hz + hd + 0.9, rng.range(0.7, 1.0));
  // Canteiro de flores ao longo da fachada.
  for (let x = -hw + 0.8; x < hw - 0.6; x += 1.4) {
    if (Math.abs(x - doorU) < 1.6) continue;
    plant(rng.chance(0.35) ? 'flowers' : 'shrub', hx + x, hz + hd + 0.55, rng.range(0.45, 0.7));
  }
  // Quintal: árvore tropical e arbustos.
  plant('tree', hx + rng.range(-hw + 1, hw - 1), -ld + 2.4, rng.range(0.9, 1.2));
  plant('shrub', -lw + 1.2, -ld + 1.2, 1.2);
  plant('shrub', lw - 1.2, -ld + 1.4, 1.1);
  if (kit.palms && spec.palm !== false) {
    const px = garageSide ? -gSign * (lw - 1.6) : lw - 1.6;
    const p = kit.toWorld(px, 0, fz - 2.2);
    kit.palms.push({ id: `${spec.id}_palm`, x: p.x, y: p.y, z: p.z, rot: rng.range(0, 6.28), scale: rng.range(0.7, 0.85), variant: rng.int(0, 3) });
  }

  return finish(kit, spec, wallH + 2, [{ x: hx + doorU, z: hz + hd + 1.2, label: spec.name }]);
}

// ------------------------------------------------------------ ponto de ônibus

function busStop(kit, spec) {
  const m = kit.lib.m;
  const P = { frame: 0x2f8f83, roof: 0xf4f1ea, accent: 0xf29eb4, ...spec.palette };
  const w = 4.2, d = 1.7;
  // Estrutura: postes, painel de vidro traseiro, cobertura curva em degraus.
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) {
    for (const z of [-d / 2 + 0.1, d / 2 - 0.3]) kit.box(m.metal, P.frame, x, 1.25, z, 0.1, 2.5, 0.1);
    kit.solidCyl(x, -d / 2 + 0.1, 0.1, 0, 2.5, { cameraBlocker: false });
  }
  kit.box(m.glass, null, 0, 1.3, -d / 2 + 0.1, w - 0.2, 1.9, 0.04);
  kit.box(m.metal, P.frame, 0, 0.32, -d / 2 + 0.1, w - 0.2, 0.06, 0.06);
  kit.box(m.metal, P.frame, 0, 2.27, -d / 2 + 0.1, w - 0.2, 0.06, 0.06);
  kit.solid(0, -d / 2 + 0.1, w / 2, 0.08, 0, 2.5, { cameraBlocker: false });
  kit.box(m.trim, P.roof, 0, 2.58, 0, w + 0.4, 0.14, d + 0.4);
  kit.box(m.trim, P.roof, 0, 2.7, -0.15, w + 0.1, 0.1, d);
  kit.box(m.trim, P.accent, 0, 2.5, d / 2 + 0.18, w + 0.4, 0.12, 0.06);
  // Banco.
  kit.box(m.trim, 0x8a5a3c, 0, 0.48, -d / 2 + 0.45, w - 0.8, 0.06, 0.42);
  kit.box(m.trim, 0x8a5a3c, 0, 0.8, -d / 2 + 0.22, w - 0.8, 0.3, 0.05);
  for (const x of [-w / 2 + 0.7, w / 2 - 0.7]) kit.box(m.darkMetal, null, x, 0.24, -d / 2 + 0.45, 0.06, 0.48, 0.36);
  kit.solid(0, -d / 2 + 0.45, w / 2 - 0.4, 0.24, 0, 0.5, { cameraBlocker: false });
  // Painel publicitário luminoso na lateral (fictício).
  const ad = kit.signs.lightbox((ctx, cw, ch) => {
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, '#ff9fc0');
    g.addColorStop(0.55, '#ffd36a');
    g.addColorStop(1, '#45c9d8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#fff6e8';
    ctx.beginPath();
    ctx.arc(cw / 2, ch * 0.36, cw * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2350';
    ctx.textAlign = 'center';
    ctx.font = '900 64px "Arial Black", Impact, sans-serif';
    ctx.fillText('SOL', cw / 2, ch * 0.72);
    ctx.fillText('SODA', cw / 2, ch * 0.84);
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.fillText('GELADA • 25¢', cw / 2, ch * 0.94);
  }, 256, 512, { width: 0.95, height: 1.75, backing: P.frame, intensity: 1.0 });
  kit.attach(ad, w / 2 + 0.25, 1.35, 0, Math.PI / 2);
  kit.solid(w / 2 + 0.25, 0, 0.2, 0.6, 0, 2.3);
  // Placa do ponto.
  kit.box(m.metal, 0x9aa3ad, -w / 2 - 0.9, 1.4, d / 2, 0.08, 2.8, 0.08);
  kit.box(m.trim, 0x2f6fb0, -w / 2 - 0.9, 2.55, d / 2, 0.05, 0.5, 0.7);
  kit.box(m.trim, 0xffffff, -w / 2 - 0.87, 2.55, d / 2, 0.02, 0.32, 0.5);
  kit.solidCyl(-w / 2 - 0.9, d / 2, 0.08, 0, 2.8, { cameraBlocker: false });
  return finish(kit, spec, 3, [{ x: 0, z: d / 2 + 0.5, label: spec.name || 'Ponto de ônibus' }]);
}

export const ZONE_BUILDING_TYPES = { shop, house, busStop };
