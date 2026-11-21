import * as THREE from 'three';
import { createRng } from '../utils/math.js';

/**
 * Texturas procedurais da "revolução visual" (Prompt 02).
 * Todas são geradas em Canvas, compartilhadas e organizadas em atlas para
 * evitar milhares de texturas únicas.
 */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { repeat = true, srgb = true, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Ruído suave e repetível: grade aleatória ampliada com suavização (bordas contínuas). */
export function tileableNoise(size, cells, seed, lo = 0, hi = 255) {
  const rng = createRng(seed);
  const small = canvas(cells, cells);
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(cells, cells);
  for (let i = 0; i < cells * cells; i++) {
    const v = lo + rng.next() * (hi - lo);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  // Desenha 3x3 cópias e recorta o centro: interpolação contínua nas bordas.
  const big = canvas(size * 3, size * 3);
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) bctx.drawImage(small, x * size, y * size, size, size);
  const out = canvas(size, size);
  out.getContext('2d').drawImage(big, size, size, size, size, 0, 0, size, size);
  return out;
}

// ------------------------------------------------------------- superfícies

/**
 * Detalhe de reboco/concreto pintado (tons de cinza em torno de 50%).
 * Aplicado por projeção triplanar nas fachadas: R = detalhe fino, G = manchas grandes.
 */
export function stuccoDetailTexture() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, S, S);
  // Canal fino (R): ruído em várias oitavas + pontilhado de reboco.
  const fine = canvas(S, S);
  const fctx = fine.getContext('2d');
  fctx.globalAlpha = 1;
  fctx.drawImage(tileableNoise(S, 32, 3, 96, 160), 0, 0);
  fctx.globalAlpha = 0.5;
  fctx.drawImage(tileableNoise(S, 64, 5, 80, 176), 0, 0);
  fctx.globalAlpha = 0.35;
  fctx.drawImage(tileableNoise(S, 128, 7, 70, 186), 0, 0);
  fctx.globalAlpha = 1;
  const rng = createRng(9);
  for (let i = 0; i < 2600; i++) {
    const v = rng.chance(0.5) ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)';
    fctx.fillStyle = v;
    fctx.fillRect(rng.next() * S, rng.next() * S, 1.2, 1.2);
  }
  // Canal grosso (G): manchas e desgaste suaves.
  const coarse = tileableNoise(S, 6, 13, 70, 190);
  const fd = fctx.getImageData(0, 0, S, S).data;
  const cd = coarse.getContext('2d').getImageData(0, 0, S, S).data;
  const out = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    out.data[i * 4] = fd[i * 4];
    out.data[i * 4 + 1] = cd[i * 4];
    out.data[i * 4 + 2] = 128;
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return toTexture(c, { srgb: false, anisotropy: 4 });
}

/** Asfalto com agregado, juntas e variação suave. Uma repetição = 8 m. */
export function asphaltTextureHD() {
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const rng = createRng(11);
  ctx.fillStyle = '#3b3b42';
  ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = 0.35;
  ctx.drawImage(tileableNoise(S, 8, 21, 40, 80), 0, 0);
  ctx.globalAlpha = 0.18;
  ctx.drawImage(tileableNoise(S, 48, 22, 30, 110), 0, 0);
  ctx.globalAlpha = 1;
  const agg = ['#2a2a30', '#4c4a52', '#56545c', '#34333a', '#625f66', '#46454c'];
  for (let i = 0; i < 26000; i++) {
    ctx.fillStyle = agg[Math.floor(rng.next() * agg.length)];
    const s = 1 + rng.next() * 1.6;
    ctx.fillRect(rng.next() * S, rng.next() * S, s, s);
  }
  // Fissuras finas e um selante escuro (reparo antigo).
  ctx.strokeStyle = 'rgba(18,18,22,0.4)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    let x = rng.next() * S, y = rng.next() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (rng.next() - 0.5) * 34; y += (rng.next() - 0.5) * 34; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return toTexture(c);
}

/** Calçada: placas de concreto com juntas, leve variação de tom. Repetição = 3 m. */
export function sidewalkTextureHD() {
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const rng = createRng(23);
  ctx.fillStyle = '#d6cfc3';
  ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = 0.25;
  ctx.drawImage(tileableNoise(S, 16, 31, 90, 170), 0, 0);
  ctx.globalAlpha = 1;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = `rgba(${170 + rng.int(0, 40)},${160 + rng.int(0, 35)},${150 + rng.int(0, 30)},0.16)`;
    ctx.fillRect((i % 2) * 256 + 3, Math.floor(i / 2) * 256 + 3, 250, 250);
  }
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.25)' : 'rgba(90,80,70,0.18)';
    ctx.fillRect(rng.next() * S, rng.next() * S, 1.3, 1.3);
  }
  // Juntas de dilatação com borda chanfrada (claro/escuro).
  for (const p of [0, 256]) {
    ctx.fillStyle = 'rgba(105,96,86,0.7)';
    ctx.fillRect(p, 0, 3, S);
    ctx.fillRect(0, p, S, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(p + 3, 0, 1, S);
    ctx.fillRect(0, p + 3, S, 1);
  }
  return toTexture(c);
}

/** Areia com marcas de vento e grãos. Repetição = 8 m. */
export function sandTextureHD() {
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const rng = createRng(41);
  ctx.fillStyle = '#f0d6a2';
  ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = 0.25;
  ctx.drawImage(tileableNoise(S, 10, 43, 90, 170), 0, 0);
  ctx.globalAlpha = 1;
  // Ondulações de vento (linhas suaves).
  ctx.strokeStyle = 'rgba(190,160,110,0.16)';
  ctx.lineWidth = 3;
  for (let y = 0; y < S; y += 14) {
    ctx.beginPath();
    for (let x = 0; x <= S; x += 8) ctx.lineTo(x, y + Math.sin((x / S) * Math.PI * 4 + y * 0.07) * 5);
    ctx.stroke();
  }
  const grains = ['#e0c597', '#f8e8c8', '#d5b886', '#fff4dc', '#cbae80', '#ead2a6'];
  for (let i = 0; i < 30000; i++) {
    ctx.fillStyle = grains[Math.floor(rng.next() * grains.length)];
    ctx.fillRect(rng.next() * S, rng.next() * S, 1.2, 1.2);
  }
  return toTexture(c);
}

// ------------------------------------------------------------- janelas

/**
 * Atlas 4x2 de interiores de janela (cores) + atlas emissivo correspondente.
 * 0 persiana meia-aberta · 1 cortina rosa + abajur · 2 cortina turquesa
 * 3 planta + luminária · 4 persiana fechada · 5 quarto escuro
 * 6 sala iluminada · 7 brilho azul de TV
 */
export function windowAtlasTextures() {
  const TW = 128, TH = 128, W = TW * 4, H = TH * 2;
  const color = canvas(W, H);
  const glow = canvas(W, H);
  const c = color.getContext('2d');
  const g = glow.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const rng = createRng(77);
  const room = (x, y, base) => {
    // Parede do fundo, piso e um batente: sugestão de profundidade.
    const grad = c.createLinearGradient(0, y, 0, y + TH);
    grad.addColorStop(0, base[0]);
    grad.addColorStop(1, base[1]);
    c.fillStyle = grad;
    c.fillRect(x, y, TW, TH);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(x, y + TH * 0.78, TW, TH * 0.22);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fillRect(x + TW * 0.62, y + TH * 0.25, TW * 0.2, TH * 0.55);
  };
  const tiles = [
    () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {},
  ];
  for (let i = 0; i < 8; i++) {
    const x = (i % 4) * TW, y = Math.floor(i / 4) * TH;
    tiles[i] = { x, y };
  }
  // 0 persiana meia-aberta
  { const { x, y } = tiles[0]; room(x, y, ['#2b3346', '#1b2130']);
    for (let k = 0; k < 9; k++) { c.fillStyle = k % 2 ? '#c9c2b3' : '#a59d8f'; c.fillRect(x, y + k * 7, TW, 6); }
    g.fillStyle = 'rgba(255,190,120,0.45)'; g.fillRect(x, y + 66, TW, TH - 66); }
  // 1 cortina rosa + abajur
  { const { x, y } = tiles[1]; room(x, y, ['#3a2a35', '#22181f']);
    c.fillStyle = '#e88aa6'; c.fillRect(x, y, 30, TH); c.fillRect(x + TW - 30, y, 30, TH);
    c.fillStyle = 'rgba(255,255,255,0.15)'; for (let k = 0; k < 6; k++) { c.fillRect(x + 4 + k * 4, y, 1.5, TH); c.fillRect(x + TW - 26 + k * 4, y, 1.5, TH); }
    c.fillStyle = '#f2d7a2'; c.beginPath(); c.moveTo(x + 58, y + 70); c.lineTo(x + 76, y + 70); c.lineTo(x + 72, y + 56); c.lineTo(x + 62, y + 56); c.fill();
    const rg = g.createRadialGradient(x + 67, y + 64, 2, x + 67, y + 64, 50); rg.addColorStop(0, 'rgba(255,200,130,1)'); rg.addColorStop(1, 'rgba(255,150,90,0)'); g.fillStyle = rg; g.fillRect(x, y, TW, TH);
    g.fillStyle = 'rgba(255,120,150,0.35)'; g.fillRect(x, y, 30, TH); g.fillRect(x + TW - 30, y, 30, TH); }
  // 2 cortina turquesa fechada
  { const { x, y } = tiles[2]; c.fillStyle = '#5fbcb4'; c.fillRect(x, y, TW, TH);
    for (let k = 0; k < 16; k++) { c.fillStyle = k % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'; c.fillRect(x + k * 8, y, 8, TH); }
    g.fillStyle = 'rgba(120,255,230,0.55)'; g.fillRect(x, y, TW, TH); }
  // 3 planta + luminária pendente
  { const { x, y } = tiles[3]; room(x, y, ['#2d3a35', '#1a2420']);
    c.fillStyle = '#2f6b3a'; for (let k = 0; k < 7; k++) { c.beginPath(); c.ellipse(x + 30 + (k % 3) * 8, y + 82 - k * 6, 14, 5, (k - 3) * 0.4, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#8a5a3a'; c.fillRect(x + 26, y + 92, 22, 18);
    c.fillStyle = '#f4e3b0'; c.beginPath(); c.arc(x + 90, y + 34, 9, 0, Math.PI); c.fill(); c.fillRect(x + 89, y, 2, 30);
    const rg = g.createRadialGradient(x + 90, y + 40, 1, x + 90, y + 40, 60); rg.addColorStop(0, 'rgba(255,220,150,1)'); rg.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = rg; g.fillRect(x, y, TW, TH); }
  // 4 persiana fechada
  { const { x, y } = tiles[4]; for (let k = 0; k < 18; k++) { c.fillStyle = k % 2 ? '#e9e2d0' : '#d4ccb8'; c.fillRect(x, y + k * 7.2, TW, 7); }
    g.fillStyle = 'rgba(255,215,160,0.5)'; g.fillRect(x, y, TW, TH); }
  // 5 quarto escuro
  { const { x, y } = tiles[5]; room(x, y, ['#1c2230', '#11141c']); c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(x + 20, y + 30, 30, 50); }
  // 6 sala iluminada com estante
  { const { x, y } = tiles[6]; room(x, y, ['#a0745a', '#6b4a38']);
    c.fillStyle = '#4a3326'; c.fillRect(x + 12, y + 40, 40, 60); c.fillStyle = '#d9b48a'; for (let k = 0; k < 4; k++) c.fillRect(x + 14, y + 44 + k * 14, 36, 2);
    c.fillStyle = '#e9d7b5'; c.fillRect(x + 70, y + 70, 44, 20);
    g.fillStyle = 'rgba(255,200,140,0.95)'; g.fillRect(x, y, TW, TH); }
  // 7 brilho de TV
  { const { x, y } = tiles[7]; room(x, y, ['#1a2238', '#0f1322']); c.fillStyle = '#26324d'; c.fillRect(x + 44, y + 64, 40, 30);
    const rg = g.createRadialGradient(x + 64, y + 78, 2, x + 64, y + 78, 70); rg.addColorStop(0, 'rgba(120,170,255,1)'); rg.addColorStop(1, 'rgba(60,90,255,0)'); g.fillStyle = rg; g.fillRect(x, y, TW, TH); }
  // Moldura interna escura em todas as células (separa os recortes).
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = 4;
  for (const t of tiles) c.strokeRect(t.x + 2, t.y + 2, TW - 4, TH - 4);
  void rng;
  const map = toTexture(color, { repeat: false, anisotropy: 4 });
  const emissiveMap = toTexture(glow, { repeat: false, anisotropy: 4 });
  return { map, emissiveMap, cols: 4, rows: 2 };
}

// ------------------------------------------------------------- rua

/**
 * Atlas 4x4 de decalques viários (com alfa):
 * 0 bueiro · 1 grelha de drenagem · 2 seta reta · 3 seta direita
 * 4 seta esquerda · 5 seta reta+direita · 6 remendo · 7 mancha de óleo
 * 8 piso tátil · 9 sarjeta (faixa) · 10 rachadura · 11 tampa elétrica
 */
export function roadDecalAtlas() {
  const T = 128, N = 4, S = T * N;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const rng = createRng(101);
  const cell = (i) => ({ x: (i % N) * T, y: Math.floor(i / N) * T });
  const arrow = (i, kind) => {
    const { x, y } = cell(i);
    ctx.save();
    ctx.translate(x + T / 2, y + T / 2);
    ctx.fillStyle = 'rgba(242,239,230,0.95)';
    ctx.beginPath();
    if (kind === 'straight' || kind === 'straightRight') {
      ctx.moveTo(-7, 56); ctx.lineTo(7, 56); ctx.lineTo(7, -24); ctx.lineTo(20, -24); ctx.lineTo(0, -58); ctx.lineTo(-20, -24); ctx.lineTo(-7, -24); ctx.closePath();
    }
    if (kind === 'right' || kind === 'straightRight') {
      ctx.moveTo(-7, 56); ctx.lineTo(7, 56); ctx.lineTo(7, 4); ctx.quadraticCurveTo(10, -6, 24, -6); ctx.lineTo(24, -20); ctx.lineTo(52, 0); ctx.lineTo(24, 20); ctx.lineTo(24, 8); ctx.quadraticCurveTo(-4, 8, -7, 20); ctx.closePath();
    }
    if (kind === 'left') {
      ctx.moveTo(7, 56); ctx.lineTo(-7, 56); ctx.lineTo(-7, 4); ctx.quadraticCurveTo(-10, -6, -24, -6); ctx.lineTo(-24, -20); ctx.lineTo(-52, 0); ctx.lineTo(-24, 20); ctx.lineTo(-24, 8); ctx.quadraticCurveTo(4, 8, 7, 20); ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  };
  // 0 bueiro (ferro fundido com padrão)
  { const { x, y } = cell(0); const cx = x + T / 2, cy = y + T / 2;
    ctx.fillStyle = '#3a3836'; ctx.beginPath(); ctx.arc(cx, cy, 58, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b2a28'; ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4b4845'; ctx.lineWidth = 3;
    for (let r = 12; r < 50; r += 10) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 50, cy + Math.sin(a) * 50); ctx.stroke(); }
    ctx.fillStyle = '#5a5651'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.fillText('NEON CITY', cx, cy + 4); }
  // 1 grelha de drenagem
  { const { x, y } = cell(1); ctx.fillStyle = '#56534f'; ctx.fillRect(x + 8, y + 34, T - 16, 60); ctx.fillStyle = '#141414';
    for (let k = 0; k < 9; k++) ctx.fillRect(x + 16 + k * 11, y + 40, 6, 48); }
  arrow(2, 'straight'); arrow(3, 'right'); arrow(4, 'left'); arrow(5, 'straightRight');
  // 6 remendo de asfalto (borda irregular)
  { const { x, y } = cell(6); ctx.fillStyle = 'rgba(30,30,35,0.75)'; ctx.beginPath();
    for (let k = 0; k <= 16; k++) { const a = (k / 16) * Math.PI * 2; const r = 46 + rng.range(-8, 8); ctx.lineTo(x + T / 2 + Math.cos(a) * r * 1.1, y + T / 2 + Math.sin(a) * r * 0.75); }
    ctx.fill(); ctx.strokeStyle = 'rgba(15,15,18,0.8)'; ctx.lineWidth = 3; ctx.stroke(); }
  // 7 mancha de óleo
  { const { x, y } = cell(7); const rg = ctx.createRadialGradient(x + T / 2, y + T / 2, 4, x + T / 2, y + T / 2, 58); rg.addColorStop(0, 'rgba(10,10,14,0.55)'); rg.addColorStop(1, 'rgba(10,10,14,0)'); ctx.fillStyle = rg; ctx.fillRect(x, y, T, T); }
  // 8 piso tátil (pontos amarelos)
  { const { x, y } = cell(8); ctx.fillStyle = '#e7b52c'; ctx.fillRect(x + 4, y + 4, T - 8, T - 8); ctx.fillStyle = '#f6cf4a';
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { ctx.beginPath(); ctx.arc(x + 16 + i * 19, y + 16 + j * 19, 6, 0, Math.PI * 2); ctx.fill(); } }
  // 9 sarjeta (concreto, faixa vertical)
  { const { x, y } = cell(9); ctx.fillStyle = '#8f8a82'; ctx.fillRect(x, y, T, T); ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let k = 0; k < 900; k++) ctx.fillRect(x + rng.next() * T, y + rng.next() * T, 1.5, 1.5); ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < T; k += 32) ctx.fillRect(x, y + k, T, 2); }
  // 10 rachadura
  { const { x, y } = cell(10); ctx.strokeStyle = 'rgba(12,12,14,0.85)'; ctx.lineWidth = 2; let px = x + 10, py = y + T / 2; ctx.beginPath(); ctx.moveTo(px, py);
    for (let k = 0; k < 12; k++) { px += 9; py += rng.range(-9, 9); ctx.lineTo(px, py); } ctx.stroke(); }
  // 11 tampa elétrica retangular
  { const { x, y } = cell(11); ctx.fillStyle = '#4a4744'; ctx.fillRect(x + 24, y + 30, 80, 68); ctx.strokeStyle = '#5f5b57'; ctx.lineWidth = 3;
    for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.moveTo(x + 30, y + 40 + k * 12); ctx.lineTo(x + 98, y + 40 + k * 12); ctx.stroke(); } }
  const t = toTexture(c, { repeat: false, anisotropy: 8 });
  return { map: t, cols: N, rows: N };
}

// ------------------------------------------------------------- vegetação e outros

/** Folhagem densa para cercas vivas e copas (verde com variação). */
export function foliageTexture() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const rng = createRng(131);
  ctx.fillStyle = '#3f7a35';
  ctx.fillRect(0, 0, S, S);
  const greens = ['#4f8f3f', '#356b2c', '#5ea24a', '#2d5f27', '#6bb253', '#447f39'];
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = greens[Math.floor(rng.next() * greens.length)];
    ctx.beginPath();
    ctx.ellipse(rng.next() * S, rng.next() * S, 3 + rng.next() * 5, 1.5 + rng.next() * 2.5, rng.next() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

/** Planta ornamental (agave/iúca): folhas pontiagudas com alfa. */
export function agaveTexture() {
  const W = 256, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const rng = createRng(137);
  for (let i = 0; i < 15; i++) {
    const a = -Math.PI / 2 + (i / 14 - 0.5) * 2.4;
    const len = 110 + rng.next() * 30;
    const bx = W / 2, by = H - 6;
    const tx = bx + Math.cos(a) * len, ty = by + Math.sin(a) * len;
    const g = 120 + rng.int(0, 60);
    ctx.fillStyle = `rgb(${Math.floor(g * 0.45)},${g},${Math.floor(g * 0.55)})`;
    const nx = -Math.sin(a) * 9, ny = Math.cos(a) * 9;
    ctx.beginPath();
    ctx.moveTo(bx - nx, by - ny);
    ctx.quadraticCurveTo(bx + (tx - bx) * 0.5 - nx, by + (ty - by) * 0.5 - ny, tx, ty);
    ctx.quadraticCurveTo(bx + (tx - bx) * 0.5 + nx, by + (ty - by) * 0.5 + ny, bx + nx, by + ny);
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,240,180,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
  }
  return toTexture(c, { repeat: false });
}

/** Telhas cerâmicas (estilo espanhol/mediterrâneo). Repetição = 2 m. */
export function roofTileTexture() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const rng = createRng(151);
  ctx.fillStyle = '#9c4a2c';
  ctx.fillRect(0, 0, S, S);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 9; col++) {
      const x = col * 32 + (row % 2) * 16 - 16, y = row * 32;
      const tone = 150 + rng.int(-25, 25);
      const grad = ctx.createLinearGradient(x, 0, x + 32, 0);
      grad.addColorStop(0, `rgb(${tone - 50},${Math.floor(tone * 0.42)},${Math.floor(tone * 0.25)})`);
      grad.addColorStop(0.5, `rgb(${tone + 40},${Math.floor(tone * 0.62)},${Math.floor(tone * 0.38)})`);
      grad.addColorStop(1, `rgb(${tone - 40},${Math.floor(tone * 0.45)},${Math.floor(tone * 0.28)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(x + 1, y + 1, 30, 30);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x, y + 28, 32, 4);
    }
  }
  return toTexture(c);
}

/** Bandeira original de Neon City (listras pastel e sol). */
export function flagTexture() {
  const W = 256, H = 160;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const stripes = ['#ff6fa8', '#ffd36a', '#3fc1b0', '#7a5bd6'];
  stripes.forEach((s, i) => { ctx.fillStyle = s; ctx.fillRect(0, (i * H) / 4, W, H / 4 + 1); });
  ctx.fillStyle = '#fff4dc';
  ctx.beginPath();
  ctx.arc(64, H / 2, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff9a4a';
  ctx.beginPath();
  ctx.arc(64, H / 2, 26, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c, { repeat: false });
}

/** Poça de luz quente no chão (postes à noite). */
export function lightPoolTexture() {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { repeat: false, anisotropy: 1 });
}

/** Sombra de contato suave (veículos, objetos grandes). */
export function contactShadowTexture() {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { repeat: false, anisotropy: 1 });
}

/** Porta de garagem seccionada. */
export function garageDoorTexture() {
  const W = 128, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ece6da';
  ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, k * 32, W, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(0, k * 32 + 3, W, 2);
    for (let j = 0; j < 4; j++) {
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.strokeRect(j * 32 + 4, k * 32 + 7, 24, 20);
    }
  }
  return toTexture(c, { repeat: false });
}

/**
 * Interiores de lojas vistos pela vitrine (atlas 2x2, células 512x256):
 * 0 prateleiras/mercadorias, 1 lavanderia, 2 café/balcão, 3 discos/butique.
 * O mapa emissivo destaca luminárias e a luz quente do ambiente (noite).
 */
export function shopInteriorAtlas() {
  const CW = 512, CH = 256, W = CW * 2, H = CH * 2;
  const color = canvas(W, H);
  const glow = canvas(W, H);
  const c = color.getContext('2d');
  const g = glow.getContext('2d');
  const rng = createRng(919);
  const pal = ['#e85d75', '#4fb3bf', '#f2c14e', '#7d5ba6', '#f78154', '#5fad56', '#3d6fb6', '#f4f1de'];
  const lights = [];
  const room = (x, y, wall, floor) => {
    const gr = c.createLinearGradient(0, y, 0, y + CH);
    gr.addColorStop(0, '#f6efe4');
    gr.addColorStop(0.18, wall);
    gr.addColorStop(0.78, wall);
    gr.addColorStop(0.8, floor);
    gr.addColorStop(1, floor);
    c.fillStyle = gr;
    c.fillRect(x, y, CW, CH);
    // Luminárias no teto.
    for (let i = 0; i < 4; i++) {
      const lx = x + 40 + i * 120;
      c.fillStyle = '#fffbe8';
      c.fillRect(lx, y + 10, 80, 7);
      lights.push([lx, y + 10, 80, 7]);
    }
  };
  // 0 — prateleiras com mercadorias.
  room(0, 0, '#d8e7e4', '#9a8f84');
  for (let s = 0; s < 3; s++) {
    const sy = 60 + s * 50;
    c.fillStyle = '#7b6a5c';
    c.fillRect(20, sy + 34, CW - 40, 5);
    for (let x = 24; x < CW - 30; x += 8 + rng.int(0, 6)) {
      const h = 14 + rng.int(0, 18), w = 6 + rng.int(0, 10);
      c.fillStyle = pal[rng.int(0, pal.length - 1)];
      c.fillRect(x, sy + 34 - h, w, h);
      x += w;
    }
  }
  c.fillStyle = '#5a4a3f';
  c.fillRect(330, 170, 150, 38);
  c.fillStyle = '#e9e2d6';
  c.fillRect(330, 166, 150, 6);
  // 1 — lavanderia: fileira de máquinas.
  room(CW, 0, '#cfe6f0', '#b7c3c9');
  for (let i = 0; i < 6; i++) {
    const mx = CW + 22 + i * 80;
    c.fillStyle = '#f4f6f8';
    c.fillRect(mx, 120, 66, 84);
    c.fillStyle = '#9aa6b0';
    c.fillRect(mx, 120, 66, 10);
    c.beginPath(); c.arc(mx + 33, 168, 22, 0, Math.PI * 2); c.fillStyle = '#5c6a75'; c.fill();
    c.beginPath(); c.arc(mx + 33, 168, 16, 0, Math.PI * 2); c.fillStyle = '#a9d4e6'; c.fill();
  }
  c.fillStyle = '#2f6fb0';
  c.fillRect(CW + 20, 64, CW - 40, 22);
  // 2 — café: balcão, banquetas, quadro de menu e pendentes.
  room(0, CH, '#f3d9b1', '#8a5a3c');
  c.fillStyle = '#2f8f83';
  c.fillRect(30, CH + 150, 300, 58);
  c.fillStyle = '#f4f1ea';
  c.fillRect(30, CH + 146, 300, 7);
  for (let i = 0; i < 5; i++) {
    c.fillStyle = '#c0392b';
    c.beginPath(); c.arc(60 + i * 60, CH + 196, 12, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#555';
    c.fillRect(58 + i * 60, CH + 200, 4, 30);
  }
  c.fillStyle = '#2b2b2b';
  c.fillRect(360, CH + 52, 120, 80);
  c.fillStyle = '#f4f1de';
  for (let k = 0; k < 6; k++) c.fillRect(372, CH + 64 + k * 11, 60 + rng.int(0, 30), 3);
  for (let i = 0; i < 3; i++) {
    c.fillStyle = '#333';
    c.fillRect(90 + i * 100, CH + 20, 2, 40);
    c.fillStyle = '#ffcf7a';
    c.beginPath(); c.arc(91 + i * 100, CH + 64, 12, Math.PI, 0); c.fill();
    lights.push([79 + i * 100, CH + 58, 24, 10]);
  }
  c.fillStyle = '#3f7d36';
  c.beginPath(); c.arc(470, CH + 175, 26, 0, Math.PI * 2); c.fill();
  // 3 — discos/butique: cartazes e caixotes.
  room(CW, CH, '#3b2d52', '#5a4a6a');
  for (let i = 0; i < 5; i++) {
    c.fillStyle = pal[(i * 3) % pal.length];
    c.fillRect(CW + 30 + i * 95, CH + 50, 60, 70);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath(); c.arc(CW + 60 + i * 95, CH + 85, 18, 0, Math.PI * 2); c.fill();
  }
  for (let i = 0; i < 4; i++) {
    c.fillStyle = '#8a5a3c';
    c.fillRect(CW + 30 + i * 120, CH + 160, 100, 46);
    for (let k = 0; k < 10; k++) {
      c.fillStyle = pal[rng.int(0, pal.length - 1)];
      c.fillRect(CW + 34 + i * 120 + k * 9.5, CH + 146, 7, 18);
    }
  }
  // Emissivo: ambiente quente atenuado + luminárias.
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.5;
  g.drawImage(color, 0, 0);
  g.globalAlpha = 1;
  g.fillStyle = '#fff6dc';
  for (const [x, y, w, h] of lights) {
    g.fillRect(x - 2, y - 2, w + 4, h + 4);
  }
  return { map: toTexture(color, { repeat: false }), emissiveMap: toTexture(glow, { repeat: false }), cols: 2, rows: 2 };
}
