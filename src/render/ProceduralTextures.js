import * as THREE from 'three';
import { createRng } from '../utils/math.js';

/**
 * Texturas geradas por código (CanvasTexture). Nenhuma imagem externa é usada.
 */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { repeat = true, srgb = true, anisotropy = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function speckle(ctx, w, h, rng, count, colors, sizeMin = 1, sizeMax = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng.next() * colors.length)];
    const s = sizeMin + rng.next() * (sizeMax - sizeMin);
    ctx.fillRect(rng.next() * w, rng.next() * h, s, s);
  }
}

/** Asfalto escuro com grãos e manchas sutis. Uma repetição = 6 m. */
export function asphaltTexture() {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  const rng = createRng(11);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 18; i++) {
    const g = ctx.createRadialGradient(rng.next() * 256, rng.next() * 256, 0, 128, 128, 60);
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = rng.chance(0.5) ? '#24242c' : '#4a4954';
    ctx.beginPath();
    ctx.arc(rng.next() * 256, rng.next() * 256, 20 + rng.next() * 50, 0, Math.PI * 2);
    ctx.fill();
    void g;
  }
  ctx.globalAlpha = 1;
  speckle(ctx, 256, 256, rng, 5200, ['#2b2b33', '#484753', '#55545e', '#33323b', '#5d5a62'], 1, 2);
  // Pequenas rachaduras
  ctx.strokeStyle = 'rgba(20,20,26,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    let x = rng.next() * 256, y = rng.next() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rng.next() - 0.5) * 22;
      y += (rng.next() - 0.5) * 22;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(c);
}

/** Calçada de concreto claro com placas quadradas. Uma repetição = 3 m (2x2 placas). */
export function sidewalkTexture() {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  const rng = createRng(23);
  ctx.fillStyle = '#d9d2c6';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, rng, 3000, ['#cfc7ba', '#e2dbcf', '#c8c0b2', '#ddd6ca'], 1, 2);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = `rgba(${180 + rng.int(0, 30)},${170 + rng.int(0, 25)},${160 + rng.int(0, 20)},0.18)`;
    ctx.fillRect((i % 2) * 128 + 2, Math.floor(i / 2) * 128 + 2, 124, 124);
  }
  ctx.strokeStyle = 'rgba(120,110,100,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 1); ctx.lineTo(256, 1);
  ctx.moveTo(0, 128); ctx.lineTo(256, 128);
  ctx.moveTo(1, 0); ctx.lineTo(1, 256);
  ctx.moveTo(128, 0); ctx.lineTo(128, 256);
  ctx.stroke();
  return toTexture(c);
}

/** Calçadão em pavers rosados/creme em espinha de peixe. Uma repetição = 2.4 m. */
export function paverTexture() {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  const rng = createRng(37);
  ctx.fillStyle = '#b98f86';
  ctx.fillRect(0, 0, 256, 256);
  const colors = ['#f0c9b6', '#e9b8a6', '#f4d7c2', '#e7c0b0', '#efceb9', '#dcae9f'];
  const bw = 32, bh = 16;
  for (let y = -2; y < 18; y++) {
    for (let x = -2; x < 10; x++) {
      ctx.fillStyle = colors[rng.int(0, colors.length - 1)];
      const ox = (y % 2) * (bw / 2);
      ctx.fillRect(x * bw + ox + 1.5, y * bh + 1.5, bw - 3, bh - 3);
    }
  }
  speckle(ctx, 256, 256, rng, 1500, ['rgba(120,80,70,0.25)', 'rgba(255,255,255,0.2)'], 1, 2);
  return toTexture(c);
}

/** Areia clara com grãos. Uma repetição = 8 m. */
export function sandTexture() {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  const rng = createRng(41);
  ctx.fillStyle = '#f2d8a4';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = rng.chance(0.5) ? '#d9bf90' : '#fbe9c8';
    ctx.beginPath();
    ctx.ellipse(rng.next() * 256, rng.next() * 256, 20 + rng.next() * 40, 6 + rng.next() * 12, rng.next() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckle(ctx, 256, 256, rng, 7000, ['#e3c89a', '#f7e6c4', '#d8bb8a', '#fff3da', '#cdb184'], 1, 1.6);
  return toTexture(c);
}

/** Grama tropical. Uma repetição = 4 m. */
export function grassTexture() {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  const rng = createRng(53);
  ctx.fillStyle = '#5f9a4c';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const x = rng.next() * 256, y = rng.next() * 256;
    ctx.strokeStyle = rng.pick(['#6fae58', '#4f8a3f', '#7dbb63', '#578f45', '#8cc56c']);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng.next() - 0.5) * 3, y - 2 - rng.next() * 4);
    ctx.stroke();
  }
  return toTexture(c);
}

/** Textura de folha de palmeira (com transparência para alphaTest). */
export function frondTexture() {
  const w = 256, h = 512;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const rng = createRng(67);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  // Folíolos: lâminas afiladas preenchidas, densas, a partir da nervura central.
  const count = 58;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const y = 8 + t * (h - 16);
    const len = (Math.sin(Math.min(1, 0.08 + t * 1.05) * Math.PI) * 0.92 + 0.08) * (w * 0.49) * (0.85 + rng.next() * 0.2);
    const droop = 22 + t * 26;
    const base = 7.5 - t * 3;
    for (const side of [-1, 1]) {
      const g = 150 + Math.floor(rng.next() * 70);
      ctx.fillStyle = `rgb(${Math.floor(g * 0.48)},${g},${Math.floor(g * 0.3)})`;
      const tipX = cx + side * len, tipY = y + droop;
      ctx.beginPath();
      ctx.moveTo(cx, y - base * 0.5);
      ctx.quadraticCurveTo(cx + side * len * 0.55, y - base * 0.6 + droop * 0.25, tipX, tipY);
      ctx.quadraticCurveTo(cx + side * len * 0.5, y + base + droop * 0.35, cx, y + base);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(230,255,180,0.35)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, y + base * 0.2);
      ctx.quadraticCurveTo(cx + side * len * 0.55, y + droop * 0.3, tipX, tipY);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#a6b65a';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.stroke();
  const t = toTexture(c, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Halo radial suave para brilho de neon e lâmpadas (aditivo). */
export function glowTexture() {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(c, { repeat: false });
}

/** Fachada distante com janelas (para silhuetas de fundo fora do bairro). */
export function distantFacadeTexture() {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  const rng = createRng(79);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const lit = rng.chance(0.18);
      ctx.fillStyle = lit ? '#ffd9a0' : '#5d6c86';
      ctx.fillRect(x * 32 + 8, y * 32 + 9, 16, 15);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillRect(x * 32 + 5, y * 32 + 25, 22, 3);
    }
  }
  return toTexture(c);
}

/** Placa de rua (fundo verde, texto branco). */
export function streetSignTexture(text) {
  const c = canvas(512, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0f6b4a';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#f2f2f2';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.fillStyle = '#f7f7f2';
  ctx.font = 'bold 70px "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  return toTexture(c, { repeat: false });
}

/** Placa genérica desenhada por função. */
export function customSignTexture(w, h, draw) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  return toTexture(c, { repeat: false });
}

/** Placa de licença dos carros. */
export function licensePlateTexture(text) {
  return customSignTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1b6e8f';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#e8643c';
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEON STATE', w / 2, 30);
    ctx.fillStyle = '#163d6b';
    ctx.font = 'bold 58px "Arial Black", Arial, sans-serif';
    ctx.fillText(text, w / 2, 96);
  });
}
