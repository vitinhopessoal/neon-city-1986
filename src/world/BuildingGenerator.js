import {
  roundedBlock, roundedSolid, curvedBand, cornerCenter, windowGrid, windowUnit, ribbonWindows,
  ledge, storefront, door, awning, canopy, fins, steppedParapet, roofClutter, CONE,
  windowPane, litRoll,
} from './buildings/ArtDecoParts.js';
import { pilasters, frieze, portal, balcony, cornerTower } from './buildings/DecoModules.js';

/**
 * Arquétipos de edifícios Art Déco de Sunset Beach.
 * Cada função constrói geometria + colisões + letreiros a partir de um spec
 * e retorna metadados (altura, entradas) usados como pontos de interesse.
 *
 * Espaço local: centro da planta na origem, fachada principal voltada para +Z.
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

// --------------------------------------------------------------------------
// 1. OCEAN CLUB — hotel de luxo
// --------------------------------------------------------------------------
function oceanClub(kit, spec) {
  const m = kit.lib.m;
  const P = { wall: 0xf5f0e6, trim: 0x86d6cb, accent: 0xf3a6c2, base: 0xcfc2ae, ...spec.palette };
  const gf = 4.6, fh = 3.3, floors = 8;
  const roofY = gf + (floors - 1) * fh; // 27.7
  const R = 3;

  // Alas laterais com cantos frontais arredondados.
  for (const side of [-1, 1]) {
    const cx = side * 14;
    const corners = side < 0 ? { fl: true } : { fr: true };
    roundedBlock(kit, m.paint, P.wall, cx, 0, 14, 26, 0, roofY, R, corners);
    roundedBlock(kit, m.trim, P.trim, cx, 0, 14.5, 26.5, roofY, 0.5, R + 0.25, corners);
    roundedBlock(kit, m.trim, P.base, cx, 0, 14.2, 26.2, 0, 0.6, R + 0.1, corners);
    roundedSolid(kit, cx, 0, 14, 26, R, corners, 0, roofY + 0.5);

    const front = kit.face('front', cx, 0, 7, 13);
    const flatU = side < 0 ? 1.5 : -1.5;
    windowGrid(kit, front, {
      rows: floors - 1, cols: 3, y0: gf, floorH: fh, winW: 2.0, winH: 1.7, spacing: 3.3,
      uOffset: flatU, frame: 0xffffff, sill: P.trim, brow: P.trim, browDepth: 0.6, litChance: 0.22,
    });
    // Janelas curvas no canto + sobrancelhas curvas.
    const corner = side < 0 ? 'fl' : 'fr';
    const cc = cornerCenter(corner, cx, 0, 7, 13, R);
    for (let r = 0; r < floors - 1; r++) {
      const v = gf + r * fh + fh / 2 + 0.15;
      curvedBand(kit, kit.rng.next() < 0.2 ? m.glassLit : m.glass, null, cc, R + 0.04, v, 1.7, corner);
      curvedBand(kit, m.trim, P.trim, cc, R + 0.6, v + 1.15, 0.12, corner);
    }
    curvedBand(kit, kit.lib.neon(0xff5fb8, 2.4), null, cc, R + 0.32, roofY + 0.25, 0.1, corner);
    ledge(kit, front, flatU, 11, roofY + 0.25, 0.32, null, 0.1);
    kit.fbox(front, kit.lib.neon(0xff5fb8, 2.4), null, flatU, roofY + 0.25, 11, 0.1, 0.05, 0.28);

    // Térreo das alas: janelas altas com sobrancelha + jardineiras.
    for (const u of [flatU - 3.3, flatU, flatU + 3.3]) {
      windowUnit(kit, front, u, 2.3, 2.3, 2.6, { frame: 0xffffff, sill: P.base, brow: P.trim, browDepth: 0.8, lit: true });
      const p = kit.facePoint(front, u, 0, 0.9);
      kit.box(m.trim, 0xd8cfbf, p.x, 0.35, p.z, 2.2, 0.7, 0.9);
      kit.sphere(m.paint, 0x4f8d3e, p.x - 0.5, 0.85, p.z, 0.5, 0.42, 0.42);
      kit.sphere(m.paint, 0x5d9c47, p.x + 0.45, 0.82, p.z, 0.48, 0.4, 0.4);
      kit.solid(p.x, p.z, 1.1, 0.45, 0, 0.7);
    }

    // Laterais e fundos.
    const sideFace = kit.face(side < 0 ? 'left' : 'right', cx, 0, 7, 13);
    windowGrid(kit, sideFace, {
      rows: floors - 1, cols: 6, y0: gf, floorH: fh, winW: 1.8, winH: 1.6, spacing: 3.6,
      uOffset: side < 0 ? -1.5 : 1.5, frame: 0xffffff, sill: P.trim, litChance: 0.18,
    });
    const back = kit.face('back', cx, 0, 7, 13);
    windowGrid(kit, back, { rows: floors - 1, cols: 3, y0: gf, floorH: fh, winW: 1.8, winH: 1.5, spacing: 3.8, sill: P.trim, litChance: 0.15 });
    roofClutter(kit, cx, -2, 12, 18, roofY + 0.5, kit.rng, { count: 2 });
  }

  // Bloco central saliente com aletas e coroa escalonada.
  const bayH = 33;
  kit.box(m.paint, P.wall, 0, bayH / 2, 0.8, 14, bayH, 27.6);
  kit.box(m.trim, P.base, 0, 0.3, 0.8, 14.2, 0.6, 27.8);
  kit.solid(0, 0.8, 7, 13.8, 0, bayH);
  const bay = kit.face('front', 0, 0.8, 7, 13.8);
  const finU = [-6.6, -3.3, 0, 3.3, 6.6];
  fins(kit, bay, finU, gf, bayH + 0.8, 0.9, 0.36, P.trim, 0x4ff3ff);
  kit.fbox(bay, m.trim, P.trim, 0, bayH + 2.2, 0.5, 3, 0.9);
  for (let r = 0; r < 9; r++) {
    const v = gf + r * fh + fh / 2 + 0.1;
    for (const u of [-4.95, -1.65, 1.65, 4.95]) {
      windowUnit(kit, bay, u, v, 2.3, 2.2, { frame: null, sill: null, litChance: 0.25 });
      kit.fbox(bay, m.trim, P.accent, u, v - 1.45, 2.6, 0.7, 0.05);
    }
  }
  kit.box(m.trim, P.trim, 0, bayH + 0.3, 0.8, 14.6, 0.6, 28.2);
  kit.box(m.paint, P.wall, 0, bayH + 1.5 + 0.6, 6, 11, 3, 12);
  kit.box(m.trim, P.trim, 0, bayH + 3.7, 6, 11.4, 0.4, 12.4);
  kit.box(m.paint, P.wall, 0, bayH + 5.4, 7, 6.5, 3, 7);
  kit.box(m.trim, P.trim, 0, bayH + 7.0, 7, 6.9, 0.3, 7.4);
  kit.cyl(m.paint, P.wall, 0, bayH + 9.6, 7, 0.45, 5, { seg: 12 });
  kit.geom(CONE, m.paint, P.trim, 0, bayH + 13.2, 7, 0, 0, 0, 0.45, 2.2, 0.45);
  for (const y of [bayH + 8.2, bayH + 9.6, bayH + 11]) {
    kit.cyl(kit.lib.neon(0x4ff3ff, 2.6), null, 0, y, 7, 0.62, 0.12, { seg: 16 });
  }
  // Nome no topo (visível de longe).
  const crownSign = kit.signs.text('OCEAN CLUB', { color: '#4ff3ff', style: 'deco', width: 9.5, height: 2.0, flicker: 'pulse' });
  kit.attach(crownSign, 0, bayH + 2.1, 12.08, 0);

  // Lobby térreo + marquise com letreiro.
  storefront(kit, bay, 0, 12.6, 4.0, { frame: 0xe8ecf2, kick: P.base, doorW: 2.6, mullion: 1.6 });
  canopy(kit, bay, 0, 15, 4.05, 5, P.trim, { neon: 0xff5fb8, lights: true, poles: true, edge: 0xffffff });
  const sign = kit.signs.text('Ocean Club', { color: '#ff5fb8', style: 'script', width: 9, height: 2.0, glow: '#ff5fb8', flicker: 'steady' });
  kit.attach(sign, 0, 4.05 + 0.35 + 1.15, 14.6 + 4.6, 0);
  const lamp = kit.signs.light(0xff6fc8, 18, 16);
  if (lamp) kit.attach(lamp, 0, 3.2, 14.6 + 3.5, 0);
  // Tapete de entrada.
  const pc = kit.facePoint(bay, 0, 0, 2.5);
  kit.box(m.fabric, 0xb8283f, pc.x, 0.012, pc.z, 2.4, 0.02, 5);

  return finish(kit, spec, bayH + 14, [{ x: 0, z: 14.6, label: 'Ocean Club — Lobby' }]);
}

// --------------------------------------------------------------------------
// 2. SUNSET PALACE — hotel tropical
// --------------------------------------------------------------------------
function sunsetPalace(kit, spec) {
  const m = kit.lib.m;
  const P = { wall: 0xf7b8c6, trim: 0x5fc9c2, accent: 0xfbf7ef, base: 0xe08ba2, ...spec.palette };
  const gf = 4.4, fh = 3.2, floors = 5;
  const roofY = gf + (floors - 1) * fh; // 17.2
  const hw = 17, hd = 11;

  kit.box(m.paint, P.wall, 0, (roofY + 0.6) / 2, 0, 34, roofY + 0.6, 22);
  kit.box(m.trim, P.base, 0, 0.3, 0, 34.15, 0.6, 22.15);
  kit.box(m.trim, P.trim, 0, roofY + 0.75, 0, 34.6, 0.3, 22.6);
  kit.solid(0, 0, hw, hd, 0, roofY + 0.9);

  const front = kit.face('front', 0, 0, hw, hd);
  for (let i = 0; i < floors - 1; i++) {
    ledge(kit, front, 0, 34, gf + i * fh + fh + 0.02, 0.6, P.trim, 0.14);
  }
  for (const side of [-1, 1]) {
    windowGrid(kit, front, {
      rows: floors - 1, cols: 5, y0: gf, floorH: fh, winW: 1.7, winH: 1.7, spacing: 2.7,
      uOffset: side * 9.3, frame: 0xffffff, sill: P.accent, litChance: 0.22,
    });
    // "Speed lines" nos cantos.
    for (let k = 0; k < 3; k++) {
      const y = roofY - 1.6 + k * 0.45;
      kit.fbox(front, m.trim, P.accent, side * 15.6, y, 2.8, 0.12, 0.1);
      const sideFace = kit.face(side < 0 ? 'left' : 'right', 0, 0, hw, hd);
      kit.fbox(sideFace, m.trim, P.accent, side < 0 ? 9.6 : -9.6, y, 2.8, 0.12, 0.1);
    }
  }

  // Aleta central com janelas circulares e ícone de sol neon.
  kit.box(m.paint, P.accent, 0, (gf + 26) / 2 + 0.2, 12.2, 3.4, 26 - gf, 2.4);
  kit.solid(0, 12.2, 1.7, 1.2, gf, 26, { walkable: false });
  const fin = kit.face('front', 0, 12.2, 1.7, 1.2);
  for (const y of [7.1, 10.3, 13.5, 16.7]) {
    kit.fdisc(fin, m.trim, P.trim, 0, y, 0.72, 0.06, 0);
    kit.fdisc(fin, kit.rng.next() < 0.5 ? m.glassLit : m.glass, null, 0, y, 0.56, 0.1, 0);
  }
  kit.box(m.trim, P.trim, 0, 26.6, 12.2, 2.8, 1.2, 2.0);
  kit.box(m.trim, P.trim, 0, 27.7, 12.2, 1.8, 1.0, 1.3);
  kit.fbox(fin, kit.lib.neon(0x4ff3ff, 2.4), null, -1.62, 15.2, 0.07, 21, 0.06, 0);
  kit.fbox(fin, kit.lib.neon(0x4ff3ff, 2.4), null, 1.62, 15.2, 0.07, 21, 0.06, 0);
  kit.fdisc(fin, m.trim, 0x26324f, 0, 21.8, 2.5, 0.12, 0, 32);
  const sun = kit.signs.icon('sun', { color: '#ff8a3d', color2: '#ffd24a', size: 4.8, flicker: 'pulse' });
  kit.attach(sun, 0, 21.8, 13.4 + 0.14, 0);

  // Varanda coberta com colunas, terraço e mesas.
  kit.fbox(front, m.trim, P.trim, 0, 4.15, 31, 0.3, 3.2, 0);
  kit.fbox(front, m.trim, 0xffffff, 0, 4.38, 31, 0.16, 0.12, 3.08);
  kit.fbox(front, kit.lib.neon(0xff9a3d, 2.4), null, 0, 4.12, 31.02, 0.07, 0.05, 3.2);
  for (const u of [-14.5, -9.5, -4.6, 4.6, 9.5, 14.5]) {
    const p = kit.facePoint(front, u, 0, 2.85);
    kit.cyl(m.paint, P.trim, p.x, 0.3 + 1.85, p.z, 0.22, 3.7, { seg: 12 });
    kit.box(m.trim, 0xffffff, p.x, 3.9, p.z, 0.6, 0.2, 0.6);
    kit.solidCyl(p.x, p.z, 0.26, 0.3, 4.0);
  }
  // Plataforma do terraço (degrau de 0.3 m, o jogador sobe sem pular).
  const tp = kit.facePoint(front, 0, 0, 1.6);
  kit.box(m.trim, 0xe9dccb, tp.x, 0.15, tp.z, 32, 0.3, 3.2);
  kit.solid(tp.x, tp.z, 16, 1.6, -0.2, 0.3, { cameraBlocker: false });
  for (const u of [-12, -7, 7, 12]) {
    const p = kit.facePoint(front, u, 0, 1.6);
    kit.cyl(m.paint, 0xffffff, p.x, 0.3 + 0.72, p.z, 0.45, 0.05, { seg: 16 });
    kit.cyl(m.chrome, null, p.x, 0.3 + 0.36, p.z, 0.05, 0.72, { seg: 8 });
    kit.cyl(m.paint, P.trim, p.x - 0.75, 0.3 + 0.24, p.z, 0.22, 0.48, { seg: 10 });
    kit.cyl(m.paint, P.trim, p.x + 0.75, 0.3 + 0.24, p.z, 0.22, 0.48, { seg: 10 });
    kit.solidCyl(p.x, p.z, 0.48, 0.3, 1.05);
  }
  storefront(kit, front, -9.5, 9, 3.6, { frame: 0xffffff, kick: P.base, door: false });
  storefront(kit, front, 9.5, 9, 3.6, { frame: 0xffffff, kick: P.base, door: false });
  door(kit, front, 0, 3.0, 2.6, { frame: 0xffffff, glassLeaf: true });
  for (const u of [-3, 3]) windowUnit(kit, front, u, 2.0, 1.4, 2.4, { frame: 0xffffff, lit: true, mullion: false });

  const sign = kit.signs.text('Sunset Palace', { color: '#ff5fa8', style: 'script', width: 11, height: 2.3, glow: '#ff5fa8', flicker: 'flicker' });
  kit.attach(sign, 0, 4.53 + 1.2, 11 + 3.05, 0);
  const light = kit.signs.light(0xff7a9a, 14, 14);
  if (light) kit.attach(light, 0, 3.4, 11 + 3.5, 0);

  for (const side of ['left', 'right']) {
    const f = kit.face(side, 0, 0, hw, hd);
    windowGrid(kit, f, { rows: floors - 1, cols: 6, y0: gf, floorH: fh, winW: 1.6, winH: 1.6, spacing: 3.2, frame: 0xffffff, sill: P.accent, litChance: 0.15 });
  }
  const back = kit.face('back', 0, 0, hw, hd);
  windowGrid(kit, back, { rows: floors - 1, cols: 8, y0: gf, floorH: fh, winW: 1.6, winH: 1.5, spacing: 3.8, sill: P.accent, litChance: 0.15 });
  roofClutter(kit, 0, -3, 30, 14, roofY + 0.9, kit.rng, { count: 4 });

  return finish(kit, spec, 28.2, [{ x: 0, z: hd + 0.2, label: 'Sunset Palace — Recepção' }]);
}

// --------------------------------------------------------------------------
// 3. NEON DINER — restaurante Streamline
// --------------------------------------------------------------------------
function neonDiner(kit, spec) {
  const m = kit.lib.m;
  const P = { wall: 0x9fe3cf, trim: 0xffffff, accent: 0xf06aa0, base: 0x3b8f86, ...spec.palette };
  const H = 5.2, R = 7;
  // Corpo: caixa + extremidade semicircular (lado +X).
  kit.box(m.paint, P.trim, -3.5, H / 2, 0, 17, H, 14);
  kit.sector(m.paint, P.trim, 5, H / 2, 0, R, H, 0, Math.PI, 16);
  kit.box(m.paint, P.wall, -3.5, 0.78, 0, 17.08, 1.56, 14.08);
  kit.sector(m.paint, P.wall, 5, 0.78, 0, R + 0.04, 1.56, 0, Math.PI, 16);
  kit.box(m.trim, P.base, -3.5, 0.12, 0, 17.15, 0.24, 14.15);
  kit.sector(m.trim, P.base, 5, 0.12, 0, R + 0.08, 0.24, 0, Math.PI, 16);
  kit.solid(-3.5, 0, 8.5, 7, 0, H);
  kit.solidCyl(5, 0, R, 0, H);

  // Faixas cromadas.
  for (const y of [0.55, 0.85, 1.15]) {
    kit.box(m.chrome, null, -3.5, y, 0, 17.2, 0.07, 14.2);
    kit.sector(m.chrome, null, 5, y, 0, R + 0.1, 0.07, 0, Math.PI, 16);
  }
  // Janelas em fita contínua (frente, curva e fundo).
  const front = kit.face('front', -3.5, 0, 8.5, 7);
  const back = kit.face('back', -3.5, 0, 8.5, 7);
  ribbonWindows(kit, front, { from: -8, to: 8.5, v: 2.45, h: 1.7, mullion: 1.65, frame: 0xe8ecf2, litChance: 0.7 });
  ribbonWindows(kit, back, { from: -8.5, to: 8, v: 2.45, h: 1.7, mullion: 1.65, frame: 0xe8ecf2, litChance: 0.7 });
  kit.sector(m.glassLit, null, 5, 2.45, 0, R + 0.05, 1.7, 0, Math.PI, 16);
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    kit.box(m.chrome, null, 5 + Math.sin(a) * (R + 0.08), 2.45, Math.cos(a) * (R + 0.08), 0.08, 1.7, 0.08);
  }
  // Faixas neon no frontão.
  const neonPink = kit.lib.neon(0xff4fa8, 2.6);
  kit.box(neonPink, null, -3.5, 4.3, 0, 17.1, 0.08, 14.16);
  kit.sector(neonPink, null, 5, 4.3, 0, R + 0.06, 0.08, 0, Math.PI, 16);
  kit.box(m.trim, P.wall, -3.5, H + 0.12, 0, 17.3, 0.24, 14.3);
  kit.sector(m.trim, P.wall, 5, H + 0.12, 0, R + 0.15, 0.24, 0, Math.PI, 16);

  // Porta com pequena marquise.
  door(kit, front, -9.2, 2.0, 2.6, { frame: 0xe8ecf2, glassLeaf: true });
  canopy(kit, front, -9.2, 3.2, 3.0, 1.4, 0xffffff, { neon: 0xff4fa8, thick: 0.2 });

  // Letreiro de cobertura (dupla face) sobre estrutura metálica.
  for (const x of [-8.5, 1.5]) kit.box(m.darkMetal, null, x, H + 1.1, 0, 0.2, 2.2, 0.2);
  kit.box(m.trim, 0x1d1f3a, -3.5, H + 2.3, 0, 12.6, 2.8, 0.3);
  kit.box(m.chrome, null, -3.5, H + 3.78, 0, 12.8, 0.12, 0.34);
  kit.box(m.chrome, null, -3.5, H + 0.88, 0, 12.8, 0.12, 0.34);
  const s1 = kit.signs.text('NEON DINER', { color: '#ff4fd8', style: 'block', outline: true, width: 12, height: 2.6, flicker: 'flicker' });
  kit.attach(s1, -3.5, H + 2.3, 0.16, 0);
  const s2 = kit.signs.text('NEON DINER', { color: '#ff4fd8', style: 'block', outline: true, width: 12, height: 2.6, flicker: 'steady' });
  kit.attach(s2, -3.5, H + 2.3, -0.16, Math.PI);

  // Pilar "EAT" na ponta curva.
  kit.cyl(m.paint, P.trim, 8.4, H + 3, 0, 0.7, 6, { seg: 16 });
  kit.box(m.trim, P.accent, 8.4, H + 3.4, 0, 0.35, 5, 1.9);
  for (const sgn of [1, -1]) {
    const eat = kit.signs.vertical('EAT', { color: '#45f3ff', width: 1.5, height: 4.4, flicker: 'pulse' });
    kit.attach(eat, 8.4, H + 3.4, sgn * 0.2, sgn > 0 ? 0 : Math.PI);
  }
  kit.sphere(kit.lib.neon(0xffe95a, 2.8), null, 8.4, H + 6.4, 0, 0.35, 0.35, 0.35);
  const light = kit.signs.light(0xff5fd0, 14, 14);
  if (light) kit.attach(light, -3.5, H + 1.5, 4, 0);

  return finish(kit, spec, H + 7, [{ x: -9.2, z: 7.2, label: 'Neon Diner' }]);
}

// --------------------------------------------------------------------------
// 4. COCONUT THREADS — loja de roupas
// --------------------------------------------------------------------------
function coconutThreads(kit, spec) {
  const m = kit.lib.m;
  const P = { wall: 0xcdb8ea, trim: 0xfbf8f2, accent: 0xf49a8a, base: 0x8e74b8, ...spec.palette };
  const gf = 4.6, fh = 3.6, H = gf + fh; // 8.2
  const hw = 9, hd = 8;
  kit.box(m.paint, P.wall, 0, H / 2, 0, 18, H, 16);
  kit.box(m.trim, P.base, 0, 0.25, 0, 18.1, 0.5, 16.1);
  kit.box(m.trim, P.trim, 0, H + 0.2, 0, 18.4, 0.4, 16.4);
  kit.solid(0, 0, hw, hd, 0, H + 0.4);
  const front = kit.face('front', 0, 0, hw, hd);
  steppedParapet(kit, front, 0, H + 0.4, [{ w: 11, h: 0.8 }, { w: 6.6, h: 0.8 }, { w: 2.8, h: 0.9 }], P.trim, 0.6);
  kit.fbox(front, kit.lib.neon(0xff7aa8, 2.4), null, 0, H + 0.42, 18.3, 0.07, 0.05, 0.2);

  // Pilastras caneladas e janelas altas no 2º pavimento.
  for (const u of [-6.9, -2.25, 2.25, 6.9]) kit.fbox(front, m.trim, P.trim, u, gf + fh / 2, 0.45, fh, 0.25);
  for (const u of [-4.55, 0, 4.55]) {
    windowUnit(kit, front, u, gf + 2.3, 2.3, 2.3, { frame: P.trim, sill: P.accent, brow: P.accent, browDepth: 0.5, litChance: 0.3 });
  }
  // Blocos de vidro nos cantos.
  for (const u of [-8.3, 8.3]) {
    kit.fbox(front, m.glassBlock, null, u, gf + 1.8, 0.9, 2.8, 0.08);
    for (let k = 1; k < 6; k++) kit.fbox(front, m.trim, P.trim, u, gf + 0.4 + k * (2.8 / 6), 0.92, 0.04, 0.1);
    kit.fbox(front, m.trim, P.trim, u, gf + 1.8, 0.04, 2.8, 0.1);
  }
  // Vitrines e toldo listrado.
  storefront(kit, front, -4.9, 7.0, 3.6, { frame: 0xffffff, kick: P.accent, door: false });
  storefront(kit, front, 4.9, 7.0, 3.6, { frame: 0xffffff, kick: P.accent, door: false });
  door(kit, front, 0, 2.4, 2.6, { frame: 0xffffff, glassLeaf: true });
  kit.fbox(front, m.trim, P.trim, 0, 3.4, 2.8, 0.8, 0.15);
  awning(kit, front, 0, 17, 4.35, 1.9, [P.accent, 0xffffff], 0.35);
  const sign = kit.signs.text('Coconut Threads', { color: '#ff6fae', style: 'script', width: 9.6, height: 1.25, flicker: 'steady' });
  kit.attach(sign, 0, 4.98, hd + 0.08, 0);

  for (const side of ['left', 'right']) {
    const f = kit.face(side, 0, 0, hw, hd);
    windowGrid(kit, f, { rows: 1, cols: 4, y0: gf, floorH: fh, winW: 1.5, winH: 1.8, spacing: 3.4, frame: P.trim, sill: P.accent });
  }
  roofClutter(kit, 0, -2, 14, 10, H + 0.4, kit.rng, { count: 2 });
  return finish(kit, spec, H + 3, [{ x: 0, z: hd + 0.2, label: 'Coconut Threads' }]);
}

// --------------------------------------------------------------------------
// 5. BLUE WAVE — hotel de esquina com canto curvo
// --------------------------------------------------------------------------
function blueWave(kit, spec) {
  const m = kit.lib.m;
  const P = { wall: 0xa9d4ef, trim: 0xfbfbf5, accent: 0x2f5f9e, base: 0x6f9fc8, ...spec.palette };
  const gf = 4.2, fh = 3.2, floors = 4;
  const roofY = gf + (floors - 1) * fh; // 13.8
  const R = 7, hw = 14, hd = 13;
  const corners = { fr: true };
  roundedBlock(kit, m.paint, P.wall, 0, 0, 28, 26, 0, roofY, R, corners);
  roundedBlock(kit, m.trim, P.base, 0, 0, 28.15, 26.15, 0, 0.55, R + 0.07, corners);
  roundedBlock(kit, m.trim, P.trim, 0, 0, 28.7, 26.7, roofY, 0.45, R + 0.35, corners);
  roundedSolid(kit, 0, 0, 28, 26, R, corners, 0, roofY + 0.45);
  const cc = cornerCenter('fr', 0, 0, hw, hd, R);

  const front = kit.face('front', 0, 0, hw, hd);
  const right = kit.face('right', 0, 0, hw, hd);
  for (let r = 0; r < floors - 1; r++) {
    const v = gf + r * fh + fh / 2 + 0.1;
    ribbonWindows(kit, front, { from: -13.2, to: hw - R, v, h: 1.6, mullion: 1.55, frame: 0xffffff, litChance: 0.2 });
    ribbonWindows(kit, right, { from: -(hd - R), to: 12.4, v, h: 1.6, mullion: 1.55, frame: 0xffffff, litChance: 0.2 });
    curvedBand(kit, kit.rng.next() < 0.3 ? m.glassLit : m.glass, null, cc, R + 0.04, v, 1.6, 'fr', 14);
    // Sobrancelhas contínuas (frente, curva, lateral) + linha de destaque.
    ledge(kit, front, (-14 + hw - R) / 2, 14 + hw - R, v + 1.12, 0.65, P.trim, 0.13);
    ledge(kit, right, (-(hd - R) + 13) / 2, 13 + (hd - R), v + 1.12, 0.65, P.trim, 0.13);
    curvedBand(kit, m.trim, P.trim, cc, R + 0.65, v + 1.12, 0.13, 'fr', 14);
    ledge(kit, front, (-14 + hw - R) / 2, 14 + hw - R, v - 1.25, 0.05, P.accent, 0.12);
    ledge(kit, right, (-(hd - R) + 13) / 2, 13 + (hd - R), v - 1.25, 0.05, P.accent, 0.12);
    curvedBand(kit, m.trim, P.accent, cc, R + 0.05, v - 1.25, 0.12, 'fr', 14);
  }

  // Térreo: vitrines nas duas faces e entrada na curva.
  storefront(kit, front, -6, 12, 3.4, { frame: 0xffffff, kick: P.accent, door: false });
  storefront(kit, right, 5.5, 12, 3.4, { frame: 0xffffff, kick: P.accent, doorU: 2, glassDoor: true });
  curvedBand(kit, m.shopGlass, null, cc, R + 0.04, 1.95, 2.9, 'fr', 14);
  const a = Math.PI / 4;
  const dx = cc.x + Math.sin(a) * (R + 0.02), dz = cc.z + Math.cos(a) * (R + 0.02);
  const doorFace = { ox: dx, oz: dz, ux: Math.cos(a), uz: -Math.sin(a), nx: Math.sin(a), nz: Math.cos(a), ry: a, half: 2 };
  door(kit, doorFace, 0, 2.6, 2.6, { frame: 0xffffff, glassLeaf: true, outset: 0.05 });
  // Marquise curva com neon e letreiro diagonal.
  curvedBand(kit, m.trim, P.trim, cc, R + 2.8, 4.0, 0.3, 'fr', 16);
  curvedBand(kit, kit.lib.neon(0x45f3ff, 2.4), null, cc, R + 2.82, 3.95, 0.08, 'fr', 16);
  const sign = kit.signs.text('BLUE WAVE', { color: '#45f3ff', style: 'deco', outline: true, width: 6.4, height: 1.5, glow: '#45f3ff', flicker: 'pulse' });
  kit.attach(sign, cc.x + Math.sin(a) * (R + 2.3), 4.15 + 0.85, cc.z + Math.cos(a) * (R + 2.3), a);
  const light = kit.signs.light(0x45d8ff, 14, 14);
  if (light) kit.attach(light, cc.x + Math.sin(a) * (R + 2), 3.4, cc.z + Math.cos(a) * (R + 2), 0);

  // Tambor sobre o canto + mastro + ícone de onda.
  kit.cyl(m.paint, P.trim, cc.x, roofY + 2.1, cc.z, 4, 3.6, { seg: 24 });
  kit.cyl(m.trim, P.accent, cc.x, roofY + 3.2, cc.z, 4.05, 0.25, { seg: 24 });
  kit.cyl(m.trim, P.trim, cc.x, roofY + 4.05, cc.z, 4.3, 0.3, { seg: 24 });
  kit.cyl(m.chrome, null, cc.x, roofY + 7.2, cc.z, 0.08, 6, { seg: 8 });
  const wave = kit.signs.icon('wave', { color: '#45f3ff', size: 2.6, flicker: 'steady' });
  kit.attach(wave, cc.x + Math.sin(a) * 4.06, roofY + 2.0, cc.z + Math.cos(a) * 4.06, a);

  const left = kit.face('left', 0, 0, hw, hd);
  windowGrid(kit, left, { rows: floors - 1, cols: 6, y0: gf, floorH: fh, winW: 1.6, winH: 1.5, spacing: 3.6, frame: 0xffffff, sill: P.trim });
  const back = kit.face('back', 0, 0, hw, hd);
  windowGrid(kit, back, { rows: floors - 1, cols: 6, y0: gf, floorH: fh, winW: 1.6, winH: 1.5, spacing: 3.8, sill: P.trim });
  roofClutter(kit, -4, -4, 16, 14, roofY + 0.45, kit.rng, { count: 3 });
  return finish(kit, spec, roofY + 10, [{ x: dx, z: dz, label: 'Blue Wave Hotel' }]);
}

// --------------------------------------------------------------------------
// 6. TROPICAL NIGHTS — clube noturno
// --------------------------------------------------------------------------
function tropicalNights(kit, spec) {
  const m = kit.lib.m;
  const P = { wall: 0x4a2c6b, trim: 0xc2408f, accent: 0x1d1528, base: 0x2a1a3d, ...spec.palette };
  const H = 10.5, hw = 11, hd = 11;
  kit.box(m.paint, P.wall, 0, H / 2, 0, 22, H, 22);
  kit.box(m.trim, P.base, 0, 0.3, 0, 22.1, 0.6, 22.1);
  kit.box(m.trim, P.trim, 0, H + 0.2, 0, 22.4, 0.4, 22.4);
  kit.solid(0, 0, hw, hd, 0, H + 0.4);
  const front = kit.face('front', 0, 0, hw, hd);
  const top = steppedParapet(kit, front, 0, H + 0.4, [{ w: 14, h: 0.9 }, { w: 9, h: 0.9 }, { w: 4, h: 1.0 }], P.trim, 0.6);
  void top;
  const pink = kit.lib.neon(0xff3fb4, 2.6);
  const cyan = kit.lib.neon(0x3ff0ff, 2.6);
  // Pilastras com tubos neon.
  for (const u of [-10.4, -5.6, 5.6, 10.4]) {
    kit.fbox(front, m.trim, P.trim, u, H / 2, 0.7, H, 0.35);
    kit.fbox(front, cyan, null, u, H / 2 + 0.2, 0.07, H - 1, 0.05, 0.35);
  }
  // Chevron em zigue-zague.
  const segs = 10, span = 10.4;
  for (let i = 0; i < segs; i++) {
    const u0 = -span / 2 + (span / segs) * (i + 0.5);
    const dir = i % 2 === 0 ? 1 : -1;
    kit.fbox(front, pink, null, u0, 9.35, Math.hypot(span / segs, 0.8) + 0.05, 0.08, 0.05, 0.05, { rz: dir * Math.atan2(0.8, span / segs) });
  }
  // Janelas circulares com aro neon.
  for (const u of [-8, 8]) {
    kit.fdisc(front, cyan, null, u, 7.6, 0.78, 0.04, 0);
    kit.fdisc(front, m.glass, null, u, 7.6, 0.64, 0.08, 0);
  }
  // Entrada: porta preta, marquise e cordões.
  door(kit, front, 0, 3.0, 2.8, { frame: 0xd8dce4, leaf: 0x0c0a12 });
  canopy(kit, front, 0, 8, 3.7, 3, P.accent, { neon: 0xff3fb4, lights: true, edge: P.trim });
  for (const u of [-3.4, -2.0, 2.0, 3.4]) {
    const p = kit.facePoint(front, u, 0, 2.0);
    kit.cyl(m.chrome, null, p.x, 0.5, p.z, 0.05, 1.0, { seg: 8 });
    kit.sphere(m.chrome, null, p.x, 1.03, p.z, 0.08, 0.08, 0.08);
    kit.cyl(m.chrome, null, p.x, 0.02, p.z, 0.18, 0.04, { seg: 12 });
    kit.solidCyl(p.x, p.z, 0.12, 0, 1.0, { cameraBlocker: false });
  }
  for (const s of [-1, 1]) {
    const p0 = kit.facePoint(front, s * 2.7, 0, 2.0);
    kit.box(m.fabric, 0xb01c3c, p0.x, 0.85, p0.z, 1.4, 0.06, 0.06, kit.face('front', 0, 0, hw, hd).ry);
  }
  const sign = kit.signs.text('Tropical Nights', { color: '#ff3fb4', style: 'script', width: 11.5, height: 3.0, sub: 'DANCE CLUB', subColor: '#3ff0ff', glow: '#ff3fb4', flicker: 'flicker' });
  kit.attach(sign, 0, 5.6, hd + 0.08, 0);
  for (const u of [-8, 8]) {
    const palm = kit.signs.icon('palm', { color: '#5dff9a', color2: '#ffb347', size: 3.0, flicker: 'pulse' });
    kit.attach(palm, u, 4.6, hd + 0.1, 0);
  }
  const light = kit.signs.light(0xff3fb4, 22, 16);
  if (light) kit.attach(light, 0, 3.0, hd + 3, 0);

  for (const side of ['left', 'right']) {
    const f = kit.face(side, 0, 0, hw, hd);
    for (const u of [-6, 0, 6]) kit.fbox(f, m.glassBlock, null, u, 6.5, 1.2, 3.2, 0.06);
    kit.fbox(f, pink, null, 0, H - 0.6, 21.8, 0.07, 0.05, 0);
  }
  return finish(kit, spec, H + 3, [{ x: 0, z: hd + 0.2, label: 'Tropical Nights' }]);
}

// --------------------------------------------------------------------------
// 7. SUNNY MART — loja de conveniência
// --------------------------------------------------------------------------
function sunnyMart(kit, spec) {
  const m = kit.lib.m;
  const P = { wall: 0xf6e3a1, trim: 0xf08a3c, accent: 0xd8433a, base: 0x9a6a3a, ...spec.palette };
  const H = 5.4, hw = 10, hd = 8;
  kit.box(m.paint, P.wall, 0, H / 2, 0, 20, H, 16);
  kit.box(m.trim, P.base, 0, 0.25, 0, 20.1, 0.5, 16.1);
  kit.box(m.trim, P.trim, 0, H + 0.2, 0, 20.3, 0.4, 16.3);
  kit.solid(0, 0, hw, hd, 0, H + 0.4);
  const front = kit.face('front', 0, 0, hw, hd);
  storefront(kit, front, 0, 18, 3.3, { frame: 0x2c2f36, kick: P.accent, doorW: 2.4, mullion: 1.8, glassDoor: true });
  ledge(kit, front, 0, 20, 3.45, 0.2, P.trim, 0.2);
  const sign = kit.signs.lightbox((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#fff6d8');
    g.addColorStop(1, '#ffd36a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d8433a';
    ctx.font = '900 150px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SUNNY MART', w / 2, h * 0.43);
    ctx.fillStyle = '#e07a1f';
    ctx.font = 'bold 54px Arial, sans-serif';
    ctx.fillText('OPEN 24 HOURS', w / 2, h * 0.82);
    ctx.fillStyle = '#ffb000';
    ctx.beginPath();
    ctx.arc(110, h * 0.45, 70, 0, Math.PI * 2);
    ctx.fill();
  }, 1536, 288, { width: 14, height: 2.6, backing: 0xf08a3c, intensity: 1.15 });
  kit.attach(sign, 0, 4.55, hd + 0.02, 0);
  for (const side of ['left', 'right']) {
    const f = kit.face(side, 0, 0, hw, hd);
    windowGrid(kit, f, { rows: 1, cols: 2, y0: 0, floorH: 4, winW: 1.6, winH: 1.2, spacing: 6, sill: P.trim });
  }
  roofClutter(kit, 0, -2, 16, 10, H + 0.4, kit.rng, { count: 3 });

  // Máquina de gelo e caixas de jornal na calçada.
  const p = kit.facePoint(front, -7.8, 0, 0.8);
  kit.box(m.paint, 0xf4f6f8, p.x, 0.75, p.z, 1.9, 1.5, 0.9);
  kit.box(m.trim, 0x2a6fd0, p.x, 1.2, p.z + 0.46, 1.6, 0.4, 0.02);
  kit.solid(p.x, p.z, 0.95, 0.45, 0, 1.5);
  return finish(kit, spec, H + 1, [{ x: 0, z: hd + 0.2, label: 'Sunny Mart' }]);
}

// --------------------------------------------------------------------------
// 8. FLAMINGO ARMS — residencial com sacadas
// --------------------------------------------------------------------------
function flamingoArms(kit, spec) {
  const m = kit.lib.m;
  const P = { wall: 0xf7c8a6, trim: 0xea7fa6, accent: 0xffffff, base: 0xc98f7a, ...spec.palette };
  const gf = 3.6, fh = 3.1, floors = 4;
  const roofY = gf + (floors - 1) * fh; // 12.9
  const hw = 15, hd = 10;
  kit.box(m.paint, P.wall, 0, (roofY + 1) / 2, 0, 30, roofY + 1, 20);
  kit.box(m.trim, P.base, 0, 0.3, 0, 30.1, 0.6, 20.1);
  kit.box(m.trim, P.trim, 0, roofY + 1.1, 0, 30.4, 0.3, 20.4);
  kit.solid(0, 0, hw, hd, 0, roofY + 1.2);
  const front = kit.face('front', 0, 0, hw, hd);

  for (let f = 1; f < floors; f++) {
    const y = gf + (f - 1) * fh;
    for (const u of [-11.25, -3.75, 3.75, 11.25]) {
      const lit = litRoll(kit, 0.25);
      const pane = windowPane(kit, front, u - 0.7, y + 1.25, lit);
      kit.fbox(front, pane.mat, null, u - 0.7, y + 1.25, 2.4, 2.3, 0.06, 0, { opts: pane.opts });
      kit.fbox(front, m.trim, 0xffffff, u - 0.7, y + 1.25, 0.08, 2.3, 0.1);
      windowUnit(kit, front, u + 1.65, y + 1.6, 1.1, 1.3, { frame: 0xffffff, litChance: 0.2, mullion: false });
      // Sacada.
      kit.fbox(front, m.trim, P.accent, u, y + 0.1, 5.6, 0.22, 1.5);
      kit.fbox(front, m.trim, P.trim, u, y - 0.02, 5.6, 0.06, 1.52);
      kit.fbox(front, m.metal, 0xffffff, u, y + 1.15, 5.6, 0.06, 0.06, 1.44);
      kit.fbox(front, m.metal, 0xffffff, u, y + 0.7, 5.6, 0.04, 0.04, 1.45);
      for (let k = 0; k <= 6; k++) {
        kit.fbox(front, m.metal, 0xffffff, u - 2.75 + k * (5.5 / 6), y + 0.68, 0.05, 0.95, 0.05, 1.43);
      }
      for (const s of [-1, 1]) {
        const pp = kit.facePoint(front, u + s * 2.77, y + 0.68, 0.75);
        kit.box(m.metal, 0xffffff, pp.x, y + 1.15, pp.z, 0.05, 0.05, 1.45, front.ry);
      }
    }
  }
  // Térreo: janelas com venezianas e entrada com marquise.
  for (const u of [-11, -6, 6, 11]) {
    windowUnit(kit, front, u, 1.9, 1.4, 1.6, { frame: 0xffffff, sill: P.trim, shutters: P.trim, shutterLines: 0xf9d9e4, litChance: 0.3 });
  }
  door(kit, front, 0, 2.4, 2.5, { frame: 0xffffff, glassLeaf: true });
  canopy(kit, front, 0, 5, 3.0, 2.2, P.trim, { neon: 0xff6fae, thick: 0.25 });
  const sign = kit.signs.text('Flamingo Arms', { color: '#ff6fae', style: 'script', width: 6, height: 1.3, flicker: 'steady' });
  kit.attach(sign, 0, 3.0 + 0.25 + 0.75, hd + 2.1, 0);
  const fl = kit.signs.icon('flamingo', { color: '#ff6fae', size: 2.2, flicker: 'pulse' });
  kit.attach(fl, 0, gf + 1.5, hd + 0.08, 0);

  const right = kit.face('right', 0, 0, hw, hd);
  kit.fbox(right, m.glassBlock, null, 6, roofY / 2 + 0.5, 1.1, roofY - 2, 0.08);
  windowGrid(kit, right, { rows: floors - 1, cols: 3, y0: gf, floorH: fh, winW: 1.4, winH: 1.4, spacing: 3.6, uOffset: -3, frame: 0xffffff, sill: P.trim });
  const left = kit.face('left', 0, 0, hw, hd);
  windowGrid(kit, left, { rows: floors - 1, cols: 4, y0: gf, floorH: fh, winW: 1.4, winH: 1.4, spacing: 4, frame: 0xffffff, sill: P.trim });
  const back = kit.face('back', 0, 0, hw, hd);
  windowGrid(kit, back, { rows: floors - 1, cols: 7, y0: gf, floorH: fh, winW: 1.4, winH: 1.4, spacing: 4, sill: P.trim });
  roofClutter(kit, 0, -3, 26, 12, roofY + 1.2, kit.rng, { count: 2, tank: { x: 8, z: -2, color: 0xe4d6c8, roof: 0x9c6f7c } });
  return finish(kit, spec, roofY + 7, [{ x: 0, z: hd + 0.2, label: 'Flamingo Arms' }]);
}

// --------------------------------------------------------------------------
// 9. CORAL TRUST — edifício comercial
// --------------------------------------------------------------------------
function coralTrust(kit, spec) {
  const m = kit.lib.m;
  const P = { wall: 0xefe2c8, trim: 0xe5826a, accent: 0x3a9e9a, spandrel: 0xd9a48c, ...spec.palette };
  const gf = 4.6, fh = 3.3, floors = 9;
  const roofY = gf + (floors - 1) * fh; // 31
  const hw = 13, hd = 12;
  kit.box(m.paint, P.wall, 0, roofY / 2, 0, 26, roofY, 24);
  kit.box(m.trim, P.trim, 0, 0.35, 0, 26.15, 0.7, 24.15);
  kit.box(m.trim, P.trim, 0, roofY + 0.25, 0, 26.6, 0.5, 24.6);
  kit.solid(0, 0, hw, hd, 0, roofY + 0.5);
  const front = kit.face('front', 0, 0, hw, hd);

  const piers = [];
  for (let k = 0; k < 10; k++) piers.push(-11.7 + k * 2.6);
  for (const u of piers) {
    const tall = Math.abs(u) < 1.5;
    kit.fbox(front, m.paint, P.wall, u, (gf + roofY + (tall ? 3 : 0.6)) / 2, 0.42, roofY + (tall ? 3 : 0.6) - gf, 0.55);
  }
  for (let r = 0; r < floors - 1; r++) {
    const v = gf + r * fh + fh / 2 + 0.2;
    for (let k = 0; k < 9; k++) {
      const u = -10.4 + k * 2.6;
      windowUnit(kit, front, u, v, 2.0, 2.1, { frame: null, litChance: 0.3 });
      kit.fbox(front, m.trim, P.spandrel, u, v - 1.5, 2.1, 0.85, 0.04);
      kit.fbox(front, m.trim, P.accent, u, v - 1.5, 0.9, 0.12, 0.08);
    }
  }
  // Recuos e pináculo com anéis neon.
  kit.box(m.paint, P.wall, 0, roofY + 2.5, -1, 18, 4, 16);
  kit.box(m.trim, P.trim, 0, roofY + 4.6, -1, 18.4, 0.3, 16.4);
  kit.box(m.paint, P.wall, 0, roofY + 6.3, -1, 11, 3.2, 10);
  kit.box(m.trim, P.accent, 0, roofY + 8.0, -1, 11.4, 0.3, 10.4);
  kit.cyl(m.paint, P.wall, 0, roofY + 11.5, -1, 0.55, 7, { seg: 12 });
  kit.geom(CONE, m.paint, P.trim, 0, roofY + 16, -1, 0, 0, 0, 0.55, 2, 0.55);
  for (const y of [roofY + 10, roofY + 12, roofY + 14]) {
    kit.cyl(kit.lib.neon(0x3ff0ff, 2.6), null, 0, y, -1, 0.72, 0.14, { seg: 16 });
  }
  const sb = kit.face('front', 0, -1, 9, 8);
  kit.fbox(sb, kit.lib.neon(0x3ff0ff, 2.4), null, -8.9, roofY + 2.5, 0.07, 3.8, 0.05, 0);
  kit.fbox(sb, kit.lib.neon(0x3ff0ff, 2.4), null, 8.9, roofY + 2.5, 0.07, 3.8, 0.05, 0);

  // Portal de entrada em pé-direito duplo.
  kit.fbox(front, m.trim, P.trim, 0, 2.3, 7.2, 4.6, 0.55);
  kit.fbox(front, m.trim, P.accent, 0, 4.35, 7.4, 0.3, 0.7);
  for (let k = 0; k < 4; k++) kit.fbox(front, m.trim, 0xffffff, -2.4 + k * 1.6, 4.0, 0.12, 0.6, 0.62);
  storefront(kit, front, 0, 5.6, 3.6, { frame: 0xd8dce4, kick: P.accent, doorW: 2.4, glass: m.glass, mullion: 1.4 });
  storefront(kit, front, -9, 6.6, 3.4, { frame: 0xd8dce4, kick: P.trim, door: false });
  storefront(kit, front, 9, 6.6, 3.4, { frame: 0xd8dce4, kick: P.trim, door: false });
  const sign = kit.signs.text('CORAL TRUST', { color: '#3ff0ff', style: 'deco', width: 8, height: 1.0, flicker: 'steady' });
  kit.attach(sign, 0, 5.1, hd + 0.6, 0);

  for (const side of ['left', 'right', 'back']) {
    const f = kit.face(side, 0, 0, hw, hd);
    windowGrid(kit, f, { rows: floors - 1, cols: 7, y0: gf, floorH: fh, winW: 1.7, winH: 1.9, spacing: 3.2, litChance: 0.25, sill: P.trim });
  }
  return finish(kit, spec, roofY + 18, [{ x: 0, z: hd + 0.6, label: 'Coral Trust Building' }]);
}

// --------------------------------------------------------------------------
// 10. Edifícios complementares (variações procedurais)
// --------------------------------------------------------------------------
const FILLER_PALETTES = [
  { wall: 0xf6d2b8, trim: 0x63c1b8, accent: 0xffffff },
  { wall: 0xbfe6d8, trim: 0xf29eb4, accent: 0xffffff },
  { wall: 0xf3e5ab, trim: 0x7aa7d9, accent: 0xffffff },
  { wall: 0xd9c8f0, trim: 0xf5b26b, accent: 0xffffff },
  { wall: 0xf5f1e6, trim: 0xe9839f, accent: 0x5fc0c8 },
  { wall: 0xb9dcf2, trim: 0xf7f2e2, accent: 0xef8f6f },
  { wall: 0xf7b9a8, trim: 0xfdf6ea, accent: 0x5aa9a3 },
];

function darken(hex, k) {
  const r = Math.round(((hex >> 16) & 255) * k), g = Math.round(((hex >> 8) & 255) * k), b = Math.round((hex & 255) * k);
  return (r << 16) | (g << 8) | b;
}

/**
 * Edifício genérico com gramática Art Déco: volume (bloco, recuo no último
 * andar ou torre de canto), pilastras, friso, embasamento bicolor, portal
 * recuado, varandas opcionais, coroamento e janelas laterais. Cada combinação
 * gera uma silhueta própria a partir de poucos parâmetros.
 */
function filler(kit, spec) {
  const m = kit.lib.m;
  const rng = kit.rng;
  const P = { ...rng.pick(FILLER_PALETTES), ...spec.palette };
  const w = spec.w ?? 16, d = spec.d ?? 14;
  const hw = w / 2, hd = d / 2;
  const floors = spec.floors ?? rng.int(2, 4);
  const gf = 3.9, fh = 3.1;
  const H = gf + (floors - 1) * fh;
  const style = spec.style ?? rng.pick(['eyebrow', 'ribbon', 'porthole']);
  const crown = spec.crown ?? rng.pick(['step', 'fins', 'flat']);
  const shop = spec.shop ?? rng.chance(0.6);
  const massing = spec.massing ?? (floors >= 3 ? rng.pick(['block', 'setback', 'tower', 'block']) : rng.pick(['block', 'tower', 'block']));
  const setback = massing === 'setback' && floors >= 3;
  const tower = massing === 'tower' && w >= 11;
  const towerSide = rng.chance(0.5) ? 1 : -1;
  const baseColor = P.base ?? darken(P.wall, 0.84);
  const sb = 2.2;
  const H1 = setback ? gf + (floors - 2) * fh : H;

  // --- Volumes e colisões.
  kit.box(m.paint, P.wall, 0, H1 / 2, 0, w, H1, d);
  kit.box(m.trim, P.trim, 0, 0.25, 0, w + 0.1, 0.5, d + 0.1);
  const front = kit.face('front', 0, 0, hw, hd);
  let topFace = front, topW = w, topY = H;
  if (setback) {
    const tw = w - 1.2, td = d - sb;
    kit.box(m.paint, P.wall, 0, H1 + (H - H1) / 2, -sb / 2, tw, H - H1, td);
    kit.box(m.trim, P.trim, 0, H1 + 0.1, 0, w + 0.3, 0.2, d + 0.3);
    kit.box(m.trim, P.trim, 0, H + 0.18, -sb / 2, tw + 0.4, 0.36, td + 0.4);
    // Guarda-corpo do terraço.
    kit.fbox(front, m.trim, P.trim, 0, H1 + 0.55, w, 0.9, 0.18, -0.18);
    kit.solid(0, 0, hw, hd, 0, H1 + 1.0);
    kit.solid(0, -sb / 2, tw / 2, td / 2, H1, H + 0.4);
    topFace = kit.face('front', 0, -sb / 2, tw / 2, td / 2);
    topW = tw;
  } else {
    kit.box(m.trim, P.trim, 0, H + 0.18, 0, w + 0.4, 0.36, d + 0.4);
    kit.solid(0, 0, hw, hd, 0, H + 0.4);
  }
  const cols = Math.max(2, Math.floor(w / 3.1));

  // --- Janelas por andar (no recuo, a última fileira vai para a fachada recuada).
  const rows = floors - 1;
  const rowFace = (r) => (setback && r === rows - 1 ? topFace : front);
  const rowW = (r) => (setback && r === rows - 1 ? topW : w);
  for (let r = 0; r < rows; r++) {
    const f = rowFace(r), fw = rowW(r);
    const v = gf + r * fh + fh / 2 + 0.15;
    if (style === 'ribbon') {
      ribbonWindows(kit, f, { from: -fw / 2 + 1, to: fw / 2 - 1, v: v - 0.05, h: 1.5, frame: 0xffffff, litChance: 0.2 });
      ledge(kit, f, 0, fw, v + 1.0, 0.55, P.trim, 0.12);
    } else if (style === 'porthole') {
      const n = Math.max(1, Math.floor(fw / 3.1) - 1);
      const sp = (fw - 4) / Math.max(1, n - 1);
      for (let c = 0; c < n; c++) windowUnit(kit, f, -1.2 + (c - (n - 1) / 2) * sp, v, 1.5, 1.5, { frame: 0xffffff, sill: P.trim, litChance: 0.2 });
      kit.fdisc(f, m.trim, P.trim, fw / 2 - 1.6, v, 0.62, 0.06, 0);
      kit.fdisc(f, m.glass, null, fw / 2 - 1.6, v, 0.48, 0.1, 0);
    } else {
      const n = Math.max(2, Math.floor(fw / 3.1));
      const sp = (fw - 2) / n;
      const balc = style === 'balcony';
      for (let c = 0; c < n; c++) {
        const u = (c - (n - 1) / 2) * sp;
        windowUnit(kit, f, u, v, 1.5, 1.5, { frame: 0xffffff, sill: balc ? null : P.trim, brow: balc ? null : P.trim, browDepth: 0.5, litChance: 0.22 });
        if (balc && c % 2 === r % 2) balcony(kit, f, u, v - 0.86, Math.min(sp - 0.3, 2.4), 1.0, P.trim, 0xffffff);
      }
      // Pilastras entre os vãos.
      const us = [];
      for (let c = 0; c <= n; c++) us.push(-fw / 2 + 1 + c * sp);
      if (r === 0) pilasters(kit, front, us.filter((u) => u > -hw + 0.6 && u < hw - 0.6), gf - 0.25, H1 - 0.75, P.trim, { width: 0.3, depth: 0.12 });
    }
  }

  // --- Friso sob a cornija e coroamento.
  if (style !== 'ribbon') frieze(kit, topFace, 0, topW - 0.8, topY - 0.5, spec.frieze ?? rng.pick(['flutes', 'chevron', 'dentil']), P.trim, { height: 0.42 });
  if (crown === 'step') {
    steppedParapet(kit, topFace, 0, topY + 0.36, [{ w: topW * 0.55, h: 0.7 }, { w: topW * 0.3, h: 0.7 }], P.trim, 0.45);
  } else if (crown === 'fins') {
    fins(kit, topFace, [-1.2, 0, 1.2], topY - 2, topY + 2.2, 0.6, 0.3, P.trim, null);
  } else {
    kit.fbox(topFace, m.trim, P.accent, 0, topY + 0.6, topW + 0.3, 0.5, 0.25, -0.12);
  }
  if (tower) cornerTower(kit, front, towerSide * (hw - 1.9), 3.2, H, 3.2, 0.6, P.wall === 0xf5f1e6 ? 0xfdfaf2 : darken(P.wall, 0.95), P.trim);

  // --- Térreo: loja ou entrada residencial com portal recuado.
  const signW = Math.min(w - 2, 8) - (tower ? 3.6 : 0);
  const signU = tower ? -towerSide * 1.8 : 0;
  if (shop) {
    storefront(kit, front, signU * 0.5, w - 2.5 - (tower ? 3.4 : 0), 3.2, { frame: 0xffffff, kick: P.trim, doorU: rng.range(-1, 1) });
    if (rng.chance(0.7)) awning(kit, front, signU * 0.5, w - 2 - (tower ? 3.6 : 0), 3.95, 1.6, [P.trim, P.accent === 0xffffff ? 0xffffff : P.accent], 0.3);
  } else {
    kit.fbox(front, m.trim, baseColor, 0, 0.75, w, 1.0, 0.05, 0);
    for (let k = 0; k < 3; k++) kit.fbox(front, m.trim, darken(baseColor, 0.85), 0, 0.42 + k * 0.33, w, 0.03, 0.08, 0);
    portal(kit, front, 0, 2.0, 2.6, P.trim, { accent: P.accent, number: 0xffffff });
    for (const u of [-hw + 2.2, hw - 2.2]) {
      if (tower && Math.sign(u) === towerSide) continue;
      windowUnit(kit, front, u, 1.9, 1.5, 1.5, { frame: 0xffffff, sill: P.trim, litChance: 0.25 });
    }
  }

  // --- Laterais: janelas por padrão (exceto quando a lista é dada explicitamente).
  const sides = spec.exposedSides ?? ['left', 'right'];
  for (const side of sides) {
    const f = kit.face(side, 0, 0, hw, hd);
    const n = Math.max(1, Math.floor((side === 'left' || side === 'right' ? d : w) / 3.6));
    windowGrid(kit, f, { rows: setback ? floors - 2 : floors - 1, cols: n, y0: gf, floorH: fh, winW: 1.3, winH: 1.4, spacing: 3.4, sill: P.trim, litChance: 0.15 });
    pilasters(kit, f, [-f.half + 0.3, f.half - 0.3], 0.5, H1 - 0.3, P.trim, { width: 0.3, depth: 0.1, cap: false });
  }
  if (spec.sign) {
    const s = kit.signs.text(spec.sign.text, { color: spec.sign.color || '#ff6fd0', style: spec.sign.style || 'script', width: Math.max(3, signW), height: 1.2, flicker: spec.sign.flicker || 'steady' });
    kit.attach(s, signU, gf - 0.45, hd + 0.1, 0);
  }
  if (spec.blade) {
    const s = kit.signs.vertical(spec.blade.text, { color: spec.blade.color || '#45f3ff' });
    const bs = tower ? -towerSide : (spec.blade.side ?? 1);
    kit.attach(s, bs * (hw - 0.55), gf + 2.4, hd + 0.6, Math.PI / 2);
  }
  roofClutter(kit, 0, setback ? -sb / 2 : 0, topW - 2, (setback ? d - sb : d) - 2, H + 0.36, rng, { count: 1 });
  return finish(kit, spec, H + (tower ? 5 : 2), [{ x: 0, z: hd + 0.2 }]);
}

export const BUILDING_TYPES = {
  oceanClub,
  sunsetPalace,
  neonDiner,
  coconutThreads,
  blueWave,
  tropicalNights,
  sunnyMart,
  flamingoArms,
  coralTrust,
  filler,
};
