/**
 * Terreno base analítico: ruas no nível 0 e praia com declive até o oceano.
 * Calçadas, calçadão e lotes são lajes registradas no CollisionSystem.
 * As mesmas constantes alimentam o shader do oceano (profundidade analítica).
 */
export const BEACH = {
  start: 54,          // fim do calçadão / início da areia (x)
  flatEnd: 84,        // fim da areia seca
  dryHeight: 0.1,
  slope: 0.045,       // declive da faixa molhada
  minHeight: -2.6,
  waterLevel: -0.3,
  waterLimitX: 110,   // limite de interação na água (profundidade ~0.8 m)
  wadeDepth: 0.22,
};

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Terrain {
  constructor() {
    this.zones = [];
    // Relevos anexados (ex.: campo de alturas do TEST CITY): { minX, maxX, minZ, maxZ, height(x, z), surface(x, z) }.
    this.overlays = [];
  }

  /** Anexa um relevo externo numa área retangular (tem prioridade sobre o perfil analítico). */
  addOverlay(o) {
    this.overlays.push(o);
  }

  _overlayAt(x, z) {
    for (const o of this.overlays) if (x >= o.minX && x <= o.maxX && z >= o.minZ && z <= o.maxZ) return o;
    return null;
  }

  /** Altura da areia (contínua, usada pela malha e pela física). */
  sandHeight(x, z) {
    const B = BEACH;
    if (x <= B.flatEnd) {
      const dunes = 0.07 * Math.sin(z * 0.045 + x * 0.11) * smooth(B.start, B.start + 6, x) * (1 - smooth(B.flatEnd - 8, B.flatEnd, x));
      return B.dryHeight + dunes;
    }
    return Math.max(B.minHeight, B.dryHeight - (x - B.flatEnd) * B.slope);
  }

  getHeight(x, z) {
    if (this.overlays.length) { const o = this._overlayAt(x, z); if (o) return o.height(x, z); }
    if (x < BEACH.start) return 0;
    return this.sandHeight(x, z);
  }

  waterDepth(x, z) {
    if (x < BEACH.start) return 0;
    return BEACH.waterLevel - this.sandHeight(x, z);
  }

  /** Registra uma zona retangular de superfície (para passos e futuras regras). */
  addSurfaceZone(minX, minZ, maxX, maxZ, type, priority = 0) {
    this.zones.push({ minX, minZ, maxX, maxZ, type, priority });
    this.zones.sort((a, b) => b.priority - a.priority);
  }

  getSurface(x, z) {
    for (const zn of this.zones) {
      if (x >= zn.minX && x <= zn.maxX && z >= zn.minZ && z <= zn.maxZ) return zn.type;
    }
    if (this.overlays.length) { const o = this._overlayAt(x, z); if (o?.surface) return o.surface(x, z); }
    if (x >= BEACH.start) return this.waterDepth(x, z) > 0.04 ? 'water' : 'sand';
    return 'asphalt';
  }
}
