import * as THREE from 'three';
import * as TEX from './ProceduralTextures.js';
import * as UT from './UrbanTextures.js';
import { enhanceSurface, SURFACE_UNIFORMS } from './SurfaceDetail.js';

/**
 * Biblioteca central de materiais compartilhados.
 * Materiais com vertexColors permitem que dezenas de edifícios com cores
 * diferentes sejam desenhados com um único material (menos draw calls).
 * Texturas variadas (janelas, decalques) usam atlas compartilhados.
 */
export class MaterialLibrary {
  constructor() {
    const windows = UT.windowAtlasTextures();
    const decals = UT.roadDecalAtlas();
    const shops = UT.shopInteriorAtlas();
    this.atlases = { windows, decals, shops };
    this.textures = {
      asphalt: UT.asphaltTextureHD(),
      sidewalk: UT.sidewalkTextureHD(),
      pavers: TEX.paverTexture(),
      sand: UT.sandTextureHD(),
      grass: TEX.grassTexture(),
      frond: TEX.frondTexture(),
      glow: TEX.glowTexture(),
      distantFacade: TEX.distantFacadeTexture(),
      stucco: UT.stuccoDetailTexture(),
      windowMap: windows.map,
      windowGlow: windows.emissiveMap,
      decals: decals.map,
      shopMap: shops.map,
      shopGlow: shops.emissiveMap,
      foliage: UT.foliageTexture(),
      agave: UT.agaveTexture(),
      roofTile: UT.roofTileTexture(),
      flag: UT.flagTexture(),
      lightPool: UT.lightPoolTexture(),
      contactShadow: UT.contactShadowTexture(),
      garageDoor: UT.garageDoorTexture(),
    };
    SURFACE_UNIFORMS.uSdMap.value = this.textures.stucco;

    const t = this.textures;
    this.m = {
      // Superfícies pintadas (cor por vértice) com realce de reboco/desgaste.
      paint: enhanceSurface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 }), { scale: 0.5, strength: 0.26, grime: 0.13, rough: 0.2 }),
      trim: enhanceSurface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.02 }), { scale: 0.9, strength: 0.1, grime: 0.05, rough: 0.12 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.85 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.12, metalness: 1.0 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.5, metalness: 0.6 }),
      fabric: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),

      // Vidros.
      glass: new THREE.MeshStandardMaterial({ color: 0x2c4d6e, roughness: 0.05, metalness: 0.92, envMapIntensity: 1.5 }),
      glassLit: new THREE.MeshStandardMaterial({ color: 0x3b2a20, emissive: 0xffc47e, emissiveIntensity: 1.25, roughness: 0.25, metalness: 0.1 }),
      glassBlock: new THREE.MeshStandardMaterial({ color: 0xbfe3ee, roughness: 0.2, metalness: 0.2, emissive: 0x6aa8c0, emissiveIntensity: 0.25 }),
      shopGlass: new THREE.MeshStandardMaterial({ color: 0x4a3a40, roughness: 0.08, metalness: 0.75, emissive: 0xff9f6a, emissiveIntensity: 0.35, envMapIntensity: 1.2 }),
      // Janelas de edifícios: interiores variados (atlas) + reflexo do céu.
      windowGlass: new THREE.MeshStandardMaterial({
        map: t.windowMap, emissiveMap: t.windowGlow, emissive: 0xffffff, emissiveIntensity: 0.05,
        color: 0xb8c4d6, roughness: 0.32, metalness: 0.3, envMapIntensity: 1.5,
      }),
      windowLit: new THREE.MeshStandardMaterial({
        map: t.windowMap, emissiveMap: t.windowGlow, emissive: 0xffffff, emissiveIntensity: 0.9,
        color: 0xd8d0c4, roughness: 0.34, metalness: 0.15, envMapIntensity: 1.2,
      }),

      // Vitrines: interior de loja (atlas) + reflexo.
      shopWindow: new THREE.MeshStandardMaterial({
        map: t.shopMap, emissiveMap: t.shopGlow, emissive: 0xffffff, emissiveIntensity: 0.45,
        color: 0xd2d4d8, roughness: 0.3, metalness: 0.25, envMapIntensity: 1.35,
      }),

      // Chão e ruas.
      asphalt: new THREE.MeshStandardMaterial({ map: t.asphalt, roughness: 0.92, metalness: 0, color: 0xf2f2f2 }),
      sidewalk: new THREE.MeshStandardMaterial({ map: t.sidewalk, roughness: 0.88, metalness: 0 }),
      pavers: new THREE.MeshStandardMaterial({ map: t.pavers, roughness: 0.85, metalness: 0 }),
      sand: new THREE.MeshStandardMaterial({ map: t.sand, roughness: 1, metalness: 0, vertexColors: true }),
      grass: new THREE.MeshStandardMaterial({ map: t.grass, roughness: 1, metalness: 0 }),
      curb: enhanceSurface(new THREE.MeshStandardMaterial({ color: 0xd2cbbf, roughness: 0.82 }), { scale: 1.2, strength: 0.3, grime: 0.18, rough: 0.15 }),
      lineWhite: new THREE.MeshStandardMaterial({
        color: 0xf2efe6, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      }),
      lineYellow: new THREE.MeshStandardMaterial({
        color: 0xf2c230, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      }),
      overlayAsphalt: new THREE.MeshStandardMaterial({
        map: t.asphalt, roughness: 0.93, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      }),
      overlayGrass: new THREE.MeshStandardMaterial({
        map: t.grass, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      }),
      roadDecal: new THREE.MeshStandardMaterial({
        map: t.decals, transparent: true, depthWrite: false, roughness: 0.8, metalness: 0.05,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
      }),
      ground: new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 1 }),

      // Residencial / vegetação.
      roofTile: new THREE.MeshStandardMaterial({ map: t.roofTile, roughness: 0.78, metalness: 0 }),
      garageDoor: new THREE.MeshStandardMaterial({ map: t.garageDoor, roughness: 0.6, metalness: 0.1 }),
      hedge: new THREE.MeshStandardMaterial({ map: t.foliage, roughness: 0.95, metalness: 0 }),
      foliage: new THREE.MeshStandardMaterial({ map: t.foliage, roughness: 0.92, metalness: 0, vertexColors: true }),
      agave: new THREE.MeshStandardMaterial({ map: t.agave, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }),

      // Fundo distante (sem colisão).
      distant: new THREE.MeshStandardMaterial({ vertexColors: true, map: t.distantFacade, roughness: 0.9 }),

      // Brilhos e efeitos.
      glowAdditive: new THREE.MeshBasicMaterial({
        map: t.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      }),
      lampOn: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.25, 0.85), toneMapped: false }),
      lightPool: new THREE.MeshBasicMaterial({
        map: t.lightPool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        color: new THREE.Color(1.0, 0.72, 0.42), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
      }),
      contactShadow: new THREE.MeshBasicMaterial({
        map: t.contactShadow, transparent: true, depthWrite: false, color: 0x000000,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      }),
    };

    for (const k of ['glass', 'glassLit', 'glassBlock', 'shopGlass', 'shopWindow', 'windowGlass', 'windowLit', 'lineWhite', 'lineYellow', 'overlayAsphalt', 'overlayGrass', 'roadDecal', 'lampOn', 'glowAdditive', 'lightPool', 'contactShadow', 'asphalt', 'sidewalk', 'pavers', 'sand', 'grass', 'ground', 'distant']) {
      this.m[k].userData.noCastShadow = true;
    }

    this._solidCache = new Map();
    this._neonCache = new Map();
    this._glowCache = new Map();
  }

  get(name) {
    const mat = this.m[name];
    if (!mat) throw new Error(`Material inexistente: ${name}`);
    return mat;
  }

  /** Recorte de uma célula do atlas de janelas. */
  windowTile(index) {
    const a = this.atlases.windows;
    const col = index % a.cols, row = Math.floor(index / a.cols) % a.rows;
    return { su: 1 / a.cols, sv: 1 / a.rows, ou: col / a.cols, ov: 1 - (row + 1) / a.rows };
  }

  /** Recorte de uma célula do atlas de interiores de lojas. */
  shopTile(index) {
    const a = this.atlases.shops;
    const col = index % a.cols, row = Math.floor(index / a.cols) % a.rows;
    return { su: 1 / a.cols, sv: 1 / a.rows, ou: col / a.cols, ov: 1 - (row + 1) / a.rows };
  }

  /** Recorte de uma célula do atlas de decalques. */
  decalTile(index) {
    const a = this.atlases.decals;
    const col = index % a.cols, row = Math.floor(index / a.cols);
    return { su: 1 / a.cols, sv: 1 / a.rows, ou: col / a.cols, ov: 1 - (row + 1) / a.rows };
  }

  /** Material sólido simples reutilizável (cache por parâmetros). */
  solid(hex, roughness = 0.6, metalness = 0, extra = null) {
    const key = `${hex}|${roughness}|${metalness}|${extra ? JSON.stringify(extra) : ''}`;
    let mat = this._solidCache.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color: hex, roughness, metalness, ...(extra || {}) });
      this._solidCache.set(key, mat);
    }
    return mat;
  }

  /** Material de tubo neon: emissivo, sem tone mapping, intensidade > 1 para bloom. */
  neon(hex, intensity = 2.2) {
    const key = `${hex}|${intensity}`;
    let mat = this._neonCache.get(key);
    if (!mat) {
      const c = new THREE.Color(hex).multiplyScalar(intensity);
      mat = new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
      mat.userData.baseColor = c.clone();
      mat.userData.noCastShadow = true;
      this._neonCache.set(key, mat);
    }
    return mat;
  }

  /** Todos os materiais neon (para o multiplicador por horário). */
  neonMaterials() {
    return [...this._neonCache.values()];
  }

  /** Halo aditivo colorido. */
  glow(hex, intensity = 1) {
    const key = `${hex}|${intensity}`;
    let mat = this._glowCache.get(key);
    if (!mat) {
      mat = this.m.glowAdditive.clone();
      mat.color = new THREE.Color(hex).multiplyScalar(intensity);
      mat.userData.baseColor = mat.color.clone();
      this._glowCache.set(key, mat);
    }
    return mat;
  }

  glowMaterials() {
    return [...this._glowCache.values()];
  }

  /** Lista de todos os materiais (para ajustes globais e descarte). */
  all() {
    return [
      ...Object.values(this.m),
      ...this._solidCache.values(),
      ...this._neonCache.values(),
      ...this._glowCache.values(),
    ];
  }

  dispose() {
    for (const mat of this.all()) mat.dispose();
    for (const tex of Object.values(this.textures)) tex.dispose();
  }
}
