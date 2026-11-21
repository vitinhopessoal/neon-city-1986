// Gera build/icon.png (512x512) proceduralmente: sol neon listrado sobre grade synthwave.
// Arte original, sem dependências (PNG escrito à mão com zlib). Uso: node tools/desktop/make-icon.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const N = 512;
const px = Buffer.alloc(N * N * 4);
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v) => Math.max(0, Math.min(1, v));

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    // Fundo: roxo noturno → magenta no horizonte.
    let r = mix(26, 120, clamp(v / 0.62)), g = mix(11, 20, v), b = mix(46, 110, clamp(v / 0.62));
    const horizon = 0.62;
    // Sol listrado (amarelo → rosa).
    const dx = u - 0.5, dy = v - 0.42, d = Math.hypot(dx, dy);
    if (d < 0.27 && v < horizon) {
      const t = clamp((v - 0.15) / 0.47);
      const stripe = v > 0.44 && Math.sin((v - 0.44) * 140) > 0.35 - (v - 0.44) * 4;
      if (!stripe) { r = mix(255, 255, t); g = mix(214, 46, t); b = mix(90, 150, t); }
    }
    // Brilho em volta do sol.
    const glow = clamp(1 - Math.abs(d - 0.27) / 0.06) * 0.5;
    if (v < horizon) { r = mix(r, 255, glow); g = mix(g, 80, glow); b = mix(b, 190, glow); }
    // Chão: grade em perspectiva ciano.
    if (v >= horizon) {
      const depth = (v - horizon) / (1 - horizon);
      r = 20; g = 6; b = 40;
      const z = 1 / (depth + 0.04);
      const hLine = Math.abs(Math.sin(z * 3.2)) < 0.12 * (1 + depth);
      const vx = (u - 0.5) / (depth + 0.04);
      const vLine = Math.abs(Math.sin(vx * 2.4)) < 0.09 + depth * 0.05;
      if (hLine || vLine) { const k = 0.35 + depth * 0.65; r = mix(r, 40, k); g = mix(g, 240, k); b = mix(b, 255, k); }
      if (v - horizon < 0.006) { r = 255; g = 120; b = 220; }
    }
    // Cantos arredondados (alfa).
    const m = 0.1, cx = Math.min(Math.max(u, m), 1 - m), cy = Math.min(Math.max(v, m), 1 - m);
    const corner = Math.hypot(u - cx, v - cy);
    const a = clamp((m - corner) * N / 2);
    const i = (y * N + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = Math.round(a * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
console.log(`build/icon.png ${png.length} bytes`);
