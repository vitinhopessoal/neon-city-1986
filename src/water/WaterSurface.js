import { BEACH } from '../world/Terrain.js';

/**
 * Superfície da água em JavaScript, IDÊNTICA ao vertex shader do oceano
 * existente (mesmas três ondas, mesmo amortecimento pela profundidade e o
 * mesmo relógio `uTime`). A física dos barcos lê exatamente as ondas que a
 * tela mostra. As ilhas elevam o fundo (função de relevo única usada pela
 * colisão, pela profundidade e pela malha visual).
 */
const W = [
  { dx: -1.0, dz: 0.25, len: 38, amp: 0.22, spd: 1.1 },
  { dx: -1.0, dz: -0.4, len: 22, amp: 0.12, spd: 1.6 },
  { dx: -0.7, dz: 0.9, len: 14, amp: 0.06, spd: 2.1 },
].map((w) => { const l = Math.hypot(w.dx, w.dz); return { ...w, dx: w.dx / l, dz: w.dz / l, k: 6.2831 / w.len }; });

/** Grade da malha próxima do oceano (world/Ocean.js). */
export const MESH = { x0: 78, z0: -550, cw: 620 / 124, ch: 1100 / 74, nx: 124, nz: 74 };

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class WaterSurface {
  constructor() {
    this.level = BEACH.waterLevel;
    this.time = 0;
    this.amp = 1;
    this.islands = [];
  }

  /** Relógio do shader (lido do oceano a cada quadro). */
  sync(ocean) {
    if (ocean?.uniforms) { this.time = ocean.uniforms.uTime.value; this.amp = ocean.uniforms.uWaveAmp.value; }
  }

  sandHeight(x) {
    return Math.max(BEACH.minHeight, BEACH.dryHeight - Math.max(0, x - BEACH.flatEnd) * BEACH.slope);
  }

  /** Fundo do mar: areia da praia ou relevo de ilha (o maior). */
  seabed(x, z) {
    let y = this.sandHeight(x);
    for (const is of this.islands) {
      const d = Math.hypot(x - is.x, z - is.z);
      if (d > is.r + 40) continue;
      y = Math.max(y, is.floor(x, z, d));
    }
    return y;
  }

  depth(x, z) {
    return this.level - this.seabed(x, z);
  }

  /** Onda analítica num vértice (exatamente o vertex shader). */
  raw(x, z) {
    const depth = this.level - this.sandHeight(x);
    const damp = smooth(0, 1.6, depth) * this.amp;
    let h = 0;
    for (const w of W) h += w.amp * Math.sin(w.k * (w.dx * x + w.dz * z) + this.time * w.spd);
    return this.level + h * damp;
  }

  /**
   * Altura da superfície VISÍVEL: o vertex shader só desloca os vértices da
   * malha do oceano (PlaneGeometry 620×1100, 124×74 células, a partir de
   * x=78, z=−550) e a GPU interpola linearmente cada triângulo. Aqui a mesma
   * triangulação (diagonal b–d do PlaneGeometry) é reproduzida, então o casco
   * e a água desenhada coincidem. Fora da malha o mar distante é plano.
   */
  height(x, z) {
    const G = MESH;
    const fx = (x - G.x0) / G.cw, fz = (z - G.z0) / G.ch;
    if (fx < 0 || fz < 0 || fx >= G.nx || fz >= G.nz) return this.level;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const x0 = G.x0 + ix * G.cw, z0 = G.z0 + iz * G.ch, x1 = x0 + G.cw, z1 = z0 + G.ch;
    const hb = this.raw(x0, z1), hd = this.raw(x1, z0);
    if (u + v <= 1) { const ha = this.raw(x0, z0); return ha + (hd - ha) * u + (hb - ha) * v; }
    const hc = this.raw(x1, z1);
    return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
  }

  /** Inclinação da superfície (derivadas), para pequenos efeitos. */
  slope(x, z) {
    const depth = this.level - this.sandHeight(x);
    const damp = smooth(0, 1.6, depth) * this.amp;
    let dx = 0, dz = 0;
    for (const w of W) { const c = w.amp * w.k * Math.cos(w.k * (w.dx * x + w.dz * z) + this.time * w.spd); dx += c * w.dx; dz += c * w.dz; }
    return { dx: dx * damp, dz: dz * damp };
  }

  /** Ilha circular com topo plano levemente ondulado e encosta até o fundo. */
  addIsland({ x, z, r, top = 0.45, beach = 7, noise = 0.25 }) {
    const is = { x, z, r, top, beach };
    is.floor = (px, pz, d = Math.hypot(px - x, pz - z)) => {
      const a = Math.atan2(pz - z, px - x);
      const rr = r * (1 + noise * 0.18 * Math.sin(a * 3 + x) + noise * 0.1 * Math.sin(a * 7 + z));
      if (d <= rr - beach) return top + 0.25 * Math.sin(px * 0.21) * Math.sin(pz * 0.17) * smooth(rr - beach, rr - beach - 6, d);
      if (d <= rr) return top - (top - this.level + 0.05) * smooth(rr - beach, rr, d); // praia até a linha d'água
      return this.level - 0.05 - (d - rr) * 0.22; // encosta submersa
    };
    this.islands.push(is);
    return is;
  }
}
