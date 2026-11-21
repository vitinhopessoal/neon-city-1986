import * as THREE from 'three';

/**
 * Campo de alturas gerado por rasterização dos triângulos das malhas de chão
 * (marcadas como ground no mapa importado). Permite terreno irregular (colinas)
 * sem testar raios contra milhares de triângulos a cada quadro.
 * Plataformas, calçadas e escadas NÃO entram aqui: viram colisores caminháveis,
 * que respeitam a altura máxima de degrau do personagem.
 */
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class HeightField {
  constructor(minX, minZ, maxX, maxZ, cell = 0.5) {
    this.minX = minX;
    this.minZ = minZ;
    this.cell = cell;
    this.nx = Math.ceil((maxX - minX) / cell) + 1;
    this.nz = Math.ceil((maxZ - minZ) / cell) + 1;
    this.heights = new Float32Array(this.nx * this.nz).fill(-Infinity);
    this.surfaces = new Uint8Array(this.nx * this.nz);
    this.surfaceNames = ['none'];
    this.defaultHeight = 0;
    this.trianglesRasterized = 0;
  }

  _surfaceId(name) {
    let i = this.surfaceNames.indexOf(name);
    if (i < 0) {
      this.surfaceNames.push(name);
      i = this.surfaceNames.length - 1;
    }
    return i;
  }

  /** Rasteriza uma malha (em espaço do mundo) mantendo a maior altura por ponto. */
  rasterize(mesh, surface = 'ground') {
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const m = mesh.matrixWorld;
    const sid = this._surfaceId(surface);
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const { cell, minX, minZ, nx, nz, heights, surfaces } = this;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      _a.fromBufferAttribute(pos, i0).applyMatrix4(m);
      _b.fromBufferAttribute(pos, i1).applyMatrix4(m);
      _c.fromBufferAttribute(pos, i2).applyMatrix4(m);
      const det = (_b.z - _c.z) * (_a.x - _c.x) + (_c.x - _b.x) * (_a.z - _c.z);
      if (Math.abs(det) < 1e-9) continue; // triângulo vertical (paredes)
      const x0 = Math.max(0, Math.floor((Math.min(_a.x, _b.x, _c.x) - minX) / cell));
      const x1 = Math.min(nx - 1, Math.ceil((Math.max(_a.x, _b.x, _c.x) - minX) / cell));
      const z0 = Math.max(0, Math.floor((Math.min(_a.z, _b.z, _c.z) - minZ) / cell));
      const z1 = Math.min(nz - 1, Math.ceil((Math.max(_a.z, _b.z, _c.z) - minZ) / cell));
      for (let iz = z0; iz <= z1; iz++) {
        const pz = minZ + iz * cell;
        for (let ix = x0; ix <= x1; ix++) {
          const px = minX + ix * cell;
          const l1 = ((_b.z - _c.z) * (px - _c.x) + (_c.x - _b.x) * (pz - _c.z)) / det;
          const l2 = ((_c.z - _a.z) * (px - _c.x) + (_a.x - _c.x) * (pz - _c.z)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
          const h = l1 * _a.y + l2 * _b.y + l3 * _c.y;
          const k = iz * nx + ix;
          if (h > heights[k]) {
            heights[k] = h;
            surfaces[k] = sid;
          }
        }
      }
      this.trianglesRasterized++;
    }
  }

  /** Preenche pontos sem chão com a altura padrão. */
  finalize(defaultHeight = 0) {
    this.defaultHeight = defaultHeight;
    for (let i = 0; i < this.heights.length; i++) if (this.heights[i] === -Infinity) this.heights[i] = defaultHeight;
  }

  /** Altura interpolada (bilinear). */
  sample(x, z) {
    const fx = (x - this.minX) / this.cell, fz = (z - this.minZ) / this.cell;
    if (fx < 0 || fz < 0 || fx >= this.nx - 1 || fz >= this.nz - 1) return this.defaultHeight;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const n = this.nx, h = this.heights;
    const k = iz * n + ix;
    const a = h[k] + (h[k + 1] - h[k]) * tx;
    const b = h[k + n] + (h[k + n + 1] - h[k + n]) * tx;
    return a + (b - a) * tz;
  }

  surfaceAt(x, z) {
    const ix = Math.round((x - this.minX) / this.cell), iz = Math.round((z - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return 'none';
    return this.surfaceNames[this.surfaces[iz * this.nx + ix]];
  }

  get byteSize() {
    return this.heights.byteLength + this.surfaces.byteLength;
  }
}
