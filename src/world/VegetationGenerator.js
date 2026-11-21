import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../utils/math.js';
import { InstanceTiers } from '../render/InstanceTiers.js';

/**
 * Vegetação ornamental instanciada (complementa as palmeiras):
 *  - shrub    arbusto (aglomerado de esferas com textura de folhas)
 *  - flowers  arbusto florido (buganvília/hibisco): arbusto + flores coloridas
 *  - agave    planta pontiaguda (planos cruzados com alfa)
 *  - tree     árvore tropical pequena (tronco + copa)
 * Cada tipo usa InstanceTiers: perto (com sombra) e longe (sem sombra), com
 * esfera envolvente por faixa (recorte por frustum). Cores por instância.
 * Balanço discreto ao vento no vertex shader (também nas sombras), desligado
 * quando o perfil congela as animações ambientes. Densidade pelo perfil.
 */
const VEG_WIND = { uVegTime: { value: 0 }, uVegAmp: { value: 1 } };

function vegWind(shader) {
  shader.uniforms.uVegTime = VEG_WIND.uVegTime;
  shader.uniforms.uVegAmp = VEG_WIND.uVegAmp;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uVegTime;\nuniform float uVegAmp;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float vph = 0.0;
        #ifdef USE_INSTANCING
          vph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.53;
        #endif
        float hh = max(0.0, position.y);
        float k = 0.035 * hh * hh / (1.0 + 0.4 * hh) * uVegAmp;
        transformed.x += (sin(uVegTime * 1.6 + vph) * 0.6 + sin(uVegTime * 2.7 + vph * 1.3) * 0.4) * k;
        transformed.z += cos(uVegTime * 1.3 + vph * 0.7) * 0.7 * k;
      }`);
}

function withWind(material) {
  material.onBeforeCompile = vegWind;
  material.customProgramCacheKey = () => 'neon-veg-wind';
  return material;
}
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

/** Aglomerado de esferas com cor por vértice (base mais escura = oclusão). */
function blobCluster(blobs, seed, detail = 1) {
  const rng = createRng(seed);
  const parts = [];
  for (const [x, y, z, r, sy = 1] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // Perturba levemente os vértices (silhueta menos perfeita).
      const k = 1 + (rng.next() - 0.5) * 0.18;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * sy, pos.getZ(i) * k);
    }
    g.translate(x, y, z);
    parts.push(g);
  }
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  parts.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  const pos = merged.attributes.position;
  merged.computeBoundingBox();
  const { min, max } = merged.boundingBox;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / Math.max(0.001, max.y - min.y);
    const k = 0.68 + 0.32 * Math.min(1, t * 1.3);
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return merged;
}

function agaveGeometry() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(1.3, 1.1);
    g.translate(0, 0.55, 0);
    g.rotateX(-0.12 * (i % 2 ? 1 : -1));
    g.rotateY((i / 4) * Math.PI);
    parts.push(g);
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

function blossomGeometry(seed) {
  const rng = createRng(seed);
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const a = rng.next() * Math.PI * 2;
    const y = 0.25 + rng.next() * 0.5;
    const r = 0.5 * Math.sqrt(1 - ((y - 0.45) / 0.55) ** 2) + 0.02;
    const g = new THREE.IcosahedronGeometry(0.075 + rng.next() * 0.04, 0);
    g.translate(Math.cos(a) * r, y, Math.sin(a) * r);
    parts.push(g);
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

export class VegetationGenerator {
  constructor(lib, quality) {
    this.lib = lib;
    this.quality = quality;
    this.meshes = [];
    this.geos = {
      shrub: blobCluster([[0, 0.35, 0, 0.42], [0.28, 0.3, 0.1, 0.32], [-0.25, 0.32, -0.12, 0.34], [0.05, 0.55, -0.05, 0.3]], 11),
      tree: blobCluster([[0, 3.0, 0, 1.05, 0.7], [0.8, 2.75, 0.3, 0.8, 0.7], [-0.75, 2.8, -0.35, 0.85, 0.7], [0.2, 3.35, -0.6, 0.75, 0.7], [-0.3, 3.3, 0.7, 0.7, 0.7]], 23),
      trunk: (() => {
        const g = new THREE.CylinderGeometry(0.1, 0.17, 2.7, 7, 3);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i) + 1.35;
          pos.setX(i, pos.getX(i) + Math.sin(y * 0.9) * 0.08);
          pos.setY(i, y);
        }
        g.computeVertexNormals();
        return g;
      })(),
      agave: agaveGeometry(),
      blossom: blossomGeometry(31),
    };
    this.materials = {
      foliage: withWind(lib.m.foliage.clone()),
      agave: withWind(lib.m.agave.clone()),
      trunk: withWind(new THREE.MeshStandardMaterial({ color: 0x6b5442, roughness: 0.95 })),
      blossom: withWind(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x220010, emissiveIntensity: 0.4 })),
    };
    const depth = (extra = {}) => withWind(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, ...extra }));
    this.depth = { solid: depth(), agave: depth({ map: lib.m.agave.map, alphaTest: 0.45, side: THREE.DoubleSide }) };
    this.tiers = [];
    this.nearDistance = 60;
  }

  /** Balanço ao vento (perfil BAIXO congela as animações ambientes). */
  setWind(enabled) {
    VEG_WIND.uVegAmp.value = enabled ? 1 : 0;
  }

  update(elapsed, camPos) {
    VEG_WIND.uVegTime.value = elapsed;
    if (camPos) for (const t of this.tiers) t.update(camPos);
  }

  /**
   * placements: { type, x, y, z, scale, rot }. A densidade do perfil gráfico
   * define quantas plantas decorativas pequenas aparecem (árvores sempre).
   */
  build(placements, parent, collision) {
    const by = { shrub: [], flowers: [], agave: [], tree: [] };
    for (const p of placements) by[p.type]?.push(p);
    const greens = [0x5f9a48, 0x4d8a3c, 0x6fae52, 0x3f7d36, 0x7cb35a];
    const blooms = [0xff4fa3, 0xe0337a, 0xff7ab8, 0xff9a3c, 0xf7d046, 0xd94dff];
    const rng = createRng(4242);

    const make = (geo, mat, list, colorFn, { shadow = true, depthMat = this.depth.solid } = {}) => {
      if (!list.length) return null;
      const items = list.map((p, i) => {
        const sc = p.scale ?? 1;
        _e.set(0, p.rot ?? 0, 0);
        _q.setFromEuler(_e);
        _s.set(sc, sc, sc);
        const pos = new THREE.Vector3(p.x, p.y ?? 0, p.z);
        return { matrix: new THREE.Matrix4().compose(pos, _q, _s), pos, color: colorFn ? colorFn(p, i).clone() : null };
      });
      const tiers = new InstanceTiers(parent, [
        { geometry: geo, material: mat, castShadow: shadow, customDepthMaterial: shadow ? depthMat : undefined, maxDist: this.nearDistance },
        { geometry: geo, material: mat, castShadow: false },
      ], items, { name: 'vegetation' });
      for (const m of tiers.meshes) m.userData.decorative = true;
      tiers.update(new THREE.Vector3(), true);
      this.tiers.push(tiers);
      this.meshes.push(...tiers.meshes);
      return tiers;
    };

    // Embaralha (determinístico) para que a redução de densidade remova plantas
    // espalhadas pelo bairro, e não as de uma região inteira.
    const shuffle = (a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    shuffle(by.shrub); shuffle(by.flowers); shuffle(by.agave);
    const leaf = () => _c.set(greens[Math.floor(rng.next() * greens.length)]).multiplyScalar(1.2 + rng.next() * 0.3);
    // Floridos primeiro: a flor i corresponde ao arbusto i.
    const shrubs = [...by.flowers, ...by.shrub];
    this.shrubTiers = make(this.geos.shrub, this.materials.foliage, shrubs, leaf);
    this.blossomTiers = make(this.geos.blossom, this.materials.blossom, by.flowers, () => _c.set(blooms[Math.floor(rng.next() * blooms.length)]), { shadow: false });
    this.agaveTiers = make(this.geos.agave, this.materials.agave, by.agave, () => _c.setRGB(0.85 + rng.next() * 0.2, 0.9 + rng.next() * 0.15, 0.85 + rng.next() * 0.2), { shadow: true, depthMat: this.depth.agave });
    this.trunkTiers = make(this.geos.trunk, this.materials.trunk, by.tree, null);
    this.treeTiers = make(this.geos.tree, this.materials.foliage, by.tree, leaf);
    if (collision) {
      by.tree.forEach((p, i) => collision.addCylinder({
        id: `tree_${i}`, ownerId: 'vegetation', x: p.x, z: p.z, radius: 0.2 * (p.scale ?? 1), tags: ['tree', 'unbreakable'],
        minY: (p.y ?? 0) - 0.3, maxY: (p.y ?? 0) + 2.6, cameraBlocker: false, walkable: false,
      }));
    }
    this.counts = { shrub: by.shrub.length, flowers: by.flowers.length, agave: by.agave.length, tree: by.tree.length };
    this.setDensity(this.quality.decorDensity ?? 1);
    return this.meshes;
  }

  /** Perfil gráfico: fração das plantas pequenas desenhadas (instâncias do fim são ocultadas). */
  setDensity(d) {
    const k = Math.max(0, Math.min(1, d));
    this.density = k;
    let shown = 0;
    if (this.shrubTiers) { shown = Math.round(this.shrubTiers.items.length * k); this.shrubTiers.setActive(shown); }
    if (this.agaveTiers) this.agaveTiers.setActive(Math.round(this.agaveTiers.items.length * k));
    // Flores acompanham os arbustos floridos visíveis (mesma ordem e mesmas faixas).
    if (this.blossomTiers) this.blossomTiers.setActive(Math.min(this.blossomTiers.items.length, Math.round(this.blossomTiers.items.length * k), shown));
  }

  /** Instâncias visíveis por tipo (diagnóstico/testes). */
  get visibleCounts() {
    const c = (t) => (t ? t.meshes.reduce((a, m) => a + m.count, 0) : 0);
    return { shrubs: c(this.shrubTiers), blossoms: c(this.blossomTiers), agave: c(this.agaveTiers), trees: c(this.treeTiers) };
  }
}
