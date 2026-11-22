import * as THREE from 'three';
import { MaterialLibrary } from '../render/Materials.js';
import { CollisionSystem } from '../physics/CollisionSystem.js';
import { Terrain, BEACH } from './Terrain.js';
import { RoadNetwork } from './RoadNetwork.js';
import { Environment, TIME_PRESETS } from './Environment.js';
import { SURFACE_UNIFORMS, setSurfaceDetailEnabled } from '../render/SurfaceDetail.js';
import { Ocean } from './Ocean.js';
import { NeonSignSystem } from './NeonSign.js';
import { CityGenerator } from './CityGenerator.js';
import { VehicleFactory } from '../vehicles/VehicleFactory.js';
import { SUNSET_BEACH } from './districts/SunsetBeach.js';
import { createCoastalCity } from './districts/CoastalCity.js';
import { DestructionSystem } from './DestructionSystem.js';

/**
 * Contêiner do mundo. Mantém separados:
 *  - groups.static      geometria visual estática fundida
 *  - groups.props       mobiliário instanciado e objetos únicos
 *  - groups.vegetation  palmeiras
 *  - groups.signs       letreiros neon e luzes de apoio
 *  - groups.vehicles    veículos (objetos interativos futuros)
 *  - collision          colisões simplificadas (independentes do visual)
 *  - entities / pois / spawnPoints / lanePaths / parkingSpots  (registros)
 *
 * Novos bairros entram como novos objetos de dados em districts/ e são
 * carregados por loadDistrict() sem alterar os sistemas existentes.
 */
export class World {
  constructor({ scene, renderer, quality }) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.lib = new MaterialLibrary();
    this.collision = new CollisionSystem({ cellSize: 16 });
    this.terrain = new Terrain();
    this.collision.setTerrain((x, z) => this.terrain.getHeight(x, z));
    this.roads = new RoadNetwork();
    this.neonSigns = new NeonSignSystem();
    this.vehicleFactory = new VehicleFactory(this.lib);

    this.groups = {};
    for (const name of ['static', 'props', 'vegetation', 'signs', 'vehicles']) {
      const g = new THREE.Group();
      g.name = name;
      scene.add(g);
      this.groups[name] = g;
    }

    this.destruction = new DestructionSystem(this.groups.props, this.collision);
    this.entities = new Map();
    this.pois = [];
    this.spawnPoints = new Map();
    this.vehicles = [];
    this.trafficSignals = [];
    this.pointLights = [];
    this.textures = [];
    this.lanePaths = [];
    this.parkingSpots = [];
    this.districts = [];
    this.palms = null;
    this.lodMeshes = [];
    this._lodTimer = 0;
    this._lodCam = new THREE.Vector3(1e9, 0, 1e9);
    this.sunsetBuilt = false;
    // Bairros anexados ao mundo (ex.: TEST CITY a oeste): limites, dicas e relevo próprios.
    this.annexes = [];
    this._playBounds = null;
    this.stats = { staticMeshes: 0, buildMs: 0 };
  }

  /** Ambiente compartilhado por todos os mapas (céu, sol, névoa, reflexos). */
  build() {
    this.environment = new Environment(this.scene, this.renderer, this.quality);
    this.environment.buildEnvironmentMap();
    this._pointLightsAllowed = this.quality.pointLights;
    this.applyTimeOfDay();
  }

  get timeOfDay() {
    return this.environment.presetName;
  }

  /**
   * Troca o horário (manhã / pôr do sol / noite). O ambiente é compartilhado
   * por todos os mapas; materiais e luzes do Sunset Beach seguem o preset.
   */
  setTimeOfDay(name) {
    if (!TIME_PRESETS[name]) return false;
    this.environment.setPreset(name);
    this.environment.buildEnvironmentMap();
    this.applyTimeOfDay();
    return true;
  }

  /** Aplica o preset atual aos materiais emissivos, postes, neon, luzes e oceano. */
  applyTimeOfDay() {
    const p = this.environment.preset;
    const ref = TIME_PRESETS.sunset; // valores originais calibrados no pôr do sol
    const m = this.lib.m;
    m.windowLit.emissiveIntensity = p.windowsLit;
    m.windowGlass.emissiveIntensity = p.windowsDim;
    m.glassLit.emissiveIntensity = 1.25 * (p.windowsLit / ref.windowsLit);
    m.shopGlass.emissiveIntensity = 0.35 * (0.4 + 0.6 * p.windowsLit / ref.windowsLit);
    m.shopWindow.emissiveIntensity = 0.45 * (0.35 + 0.65 * p.windowsLit / ref.windowsLit);
    m.glassBlock.emissiveIntensity = 0.25 * (0.5 + 0.5 * p.windowsLit / ref.windowsLit);
    // Postes: desligados de manhã (vidro fosco), acesos ao entardecer e à noite.
    if (p.lamps < 0.05) m.lampOn.color.setRGB(0.62, 0.62, 0.6);
    else m.lampOn.color.setRGB(1.6, 1.25, 0.85).multiplyScalar(0.55 + 0.45 * Math.min(p.lamps / ref.lamps, 2.2));
    m.lightPool.opacity = Math.min(1, p.pools);
    m.lightPool.visible = p.pools > 0.01;
    // Neon (tubos estáticos, halos e letreiros animados).
    this.neonSigns.multiplier = p.neon;
    for (const mat of this.lib.neonMaterials()) mat.color.copy(mat.userData.baseColor).multiplyScalar(p.neon);
    for (const mat of this.lib.glowMaterials()) mat.color.copy(mat.userData.baseColor).multiplyScalar(p.neon);
    for (const l of this.pointLights) {
      if (l.userData.baseIntensity === undefined) l.userData.baseIntensity = l.intensity;
      l.intensity = l.userData.baseIntensity * Math.max(p.neon, 0.4);
    }
    this.setPointLightsEnabled(this._pointLightsAllowed);
    SURFACE_UNIFORMS.uSdGlow.value = p.facadeGlow;
    this.ocean?.syncEnvironment(this.environment.palette);
  }

  /**
   * Gera Sunset Beach (uma única vez) e retorna o World como ambiente de mapa.
   * O cenário permanece em memória quando outro mapa de testes está ativo.
   */
  ensureSunsetBeach() {
    if (!this.sunsetBuilt) {
      this.ocean = new Ocean(this.environment.palette);
      this.scene.add(this.ocean.mesh);
      // A Flamingo Street segue para oeste até o TEST CITY (anexado por TestCityAnnex).
      this.loadDistrict(createCoastalCity({ testCityLink: true }));
      this.sunsetBuilt = true;
      // Ganchos pós-montagem (ex.: NEON MOTOR COMPANY estaciona seus modelos nas vagas recém-criadas).
      for (const fn of this.afterDistrictBuild || []) fn(this);
      this.applyTimeOfDay();
      this.applyQuality(this.quality);
    }
    return this;
  }

  // ------------------------------------- interface de ambiente de mapa
  get isImported() {
    return false;
  }

  get label() {
    return SUNSET_BEACH.name;
  }

  get spawnPoint() {
    return this.spawnPoints.get('spawn_boardwalk');
  }

  setVisible(visible) {
    for (const g of Object.values(this.groups)) g.visible = visible;
    if (this.ocean) this.ocean.mesh.visible = visible;
  }

  /** Dica de limite: 'water' (água profunda), 'closed' (fim do bairro) ou null. */
  boundaryHint(x, z, radius) {
    // Bairros anexados respondem pela própria área (undefined = fora dela).
    for (const a of this.annexes || []) {
      const h = a.boundaryHint(x, z, radius);
      if (h !== undefined) return h;
    }
    if (x > BEACH.waterLimitX - radius - 0.4) return 'water';
    const b = this.bounds;
    if (b && (z < b.minZ + 1.5 || z > b.maxZ - 1.5 || x < b.minX + 1.5)) return 'closed';
    return null;
  }

  loadDistrict(district) {
    new CityGenerator(this).build(district);
    this.districts.push(district);
  }

  get bounds() {
    return this.districts[0]?.bounds;
  }

  /** Área jogável completa (união dos bairros); sem anexos, igual a bounds. */
  get playBounds() {
    return this._playBounds || this.bounds;
  }

  registerEntity(entity) {
    if (this.entities.has(entity.id)) throw new Error(`ID de entidade duplicado: ${entity.id}`);
    this.entities.set(entity.id, entity);
  }

  addPOI(poi) {
    this.pois.push(poi);
  }

  getDistrictAt(x, z) {
    for (const d of this.districts.flatMap(d => d.regions || [d])) {
      const b = d.bounds;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return d;
    }
    return null;
  }

  getSurface(x, z) {
    return this.terrain.getSurface(x, z);
  }

  waterDepth(x, z) {
    return this.terrain.waterDepth(x, z);
  }

  /** Distância horizontal até a linha d'água (positiva em terra). */
  distanceToShore(x) {
    const shoreX = BEACH.flatEnd + (BEACH.dryHeight - BEACH.waterLevel) / BEACH.slope;
    return shoreX - x;
  }

  /**
   * Parâmetros do perfil gráfico que afetam o cenário (sem recriar o mundo nem
   * reposicionar o jogador): detalhe de superfície, densidade decorativa,
   * decalques viários, animações ambientes, anisotropia e ondulações do mar.
   */
  applyQuality(q) {
    setSurfaceDetailEnabled(q.surfaceDetail !== false);
    this.vegetation?.setDensity(q.decorDensity ?? 1);
    this.vegetation?.setWind(q.ambient !== false);
    this.ambient?.setEnabled(q.ambient !== false);
    // Faixa detalhada (com sombra) acompanha a extensão das sombras do perfil.
    this.palms?.setNearDistance(Math.min(90, q.shadowExtent * 0.85));
    if (this.vegetation) for (const t of this.vegetation.tiers) t.setTierDistance(0, Math.min(70, q.shadowExtent * 0.7));
    this._lodCam.set(1e9, 0, 1e9);
    this.lib.m.roadDecal.visible = q.roadDecals !== false;
    this.ocean?.setDetail(q.oceanDetail ?? 1);
    const maxA = this.renderer.capabilities.getMaxAnisotropy();
    const a = Math.max(1, Math.min(q.anisotropy ?? 8, maxA));
    for (const t of Object.values(this.lib.textures)) {
      if (t.anisotropy > 1 && t.anisotropy !== a) { t.anisotropy = a; t.needsUpdate = true; }
    }
    this.setPointLightsEnabled(q.pointLights);
  }

  /** Perfil gráfico permite luzes pontuais; o horário decide se ficam acesas. */
  setPointLightsEnabled(enabled) {
    this._pointLightsAllowed = enabled;
    const on = enabled && !!this.environment?.preset?.pointLights;
    for (const l of this.pointLights) l.visible = on;
  }

  /**
   * LOD por distância da câmera: palmeiras e vegetação (faixas perto/longe) e
   * lotes de detalhe dos edifícios. Barato: só recalcula quando a câmera anda.
   */
  updateLOD(camPos, force = false) {
    if (!this.sunsetBuilt) return;
    this.palms?.updateLOD(camPos, force);
    this.vegetation?.update(this._elapsed ?? 0, camPos);
    if (!force && camPos.distanceToSquared(this._lodCam) < 9) return;
    this._lodCam.copy(camPos);
    for (const m of this.lodMeshes) {
      const bs = m.geometry.boundingSphere;
      m.visible = camPos.distanceTo(bs.center) - bs.radius < m.userData.lodDistance;
    }
  }

  update(dt, elapsed, focus, camera) {
    this._elapsed = elapsed;
    this.destruction.update(dt);
    this.ocean?.update(elapsed);
    this.palms?.update(elapsed);
    this.updateLOD(camera.position);
    this.neonSigns.update(dt, elapsed);
    this.ambient?.update(dt, elapsed, camera);
    for (const s of this.trafficSignals) s.update(dt);
    this.environment.update(dt, elapsed, focus, camera);
  }
}
