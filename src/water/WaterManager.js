import * as THREE from 'three';
import { BEACH } from '../world/Terrain.js';
import { WaterSurface } from './WaterSurface.js';
import { WaterEffects } from './WaterEffects.js';
import { InteriorBuilder, mat, glow } from '../interiors/InteriorKit.js';
import { neonTextTexture, createSignMesh } from '../world/NeonSign.js';
import { MARINAS, ISLANDS, SEA, buildMarina, buildOffice, buildWarehouse, buildIsland } from '../maritime/MaritimeLocations.js';

/**
 * OCEAN DRIVE — água navegável de Sunset Beach.
 * - Substitui a parede invisível da arrebentação por limites distantes no mar
 *   (só o colisor 'bound_water' sai; os demais limites do bairro ficam).
 * - Ilhas entram no MESMO terreno da colisão e na mesma profundidade usada
 *   pelo jogador, pelos carros e pelos barcos (função de relevo única).
 * - O ambiente ganha waterHeight()/waterLevel: ondas idênticas às do shader.
 * - Só atua no mapa procedural; mapas importados (TEST CITY) ficam intactos.
 */
export class WaterManager {
  constructor(game) {
    this.game = game;
    this.surface = new WaterSurface();
    this.effects = new WaterEffects(game.scene);
    this.ready = false;
    this.active = false;
    this.group = new THREE.Group();
    this.group.name = 'ocean-drive';
    this.parts = [];
    this.animated = [];
    this.points = [];
    this.slips = { sunset: [], azure: [] };
    this.docks = {};
    this.colliderIds = [];
    this.t = 0;
    this._lodT = 0;
    this.stats = { buildMs: 0, colliders: 0, triangles: 0, visibleParts: 0 };
  }

  onMapActivated(env) {
    this.env = env;
    this.active = !env.isImported && !!env.ocean;
    if (this.active && !this.ready) this._build(env);
    this.group.visible = this.active;
    this.effects.setVisible(this.active);
  }

  // ------------------------------------------------------------ construção
  _build(env) {
    const t0 = performance.now();
    const c = env.collision;
    const b = env.bounds;
    // Mar aberto: remove só a barreira da arrebentação; novos limites ao largo.
    c.remove('bound_water');
    const wall = (minX, maxX, minZ, maxZ, id) => {
      c.addAABB({ id, minX, maxX, minZ, maxZ, minY: -5, maxY: 60, cameraBlocker: false, walkable: false, tags: ['boundary'] });
      this.colliderIds.push(id);
    };
    wall(BEACH.waterLimitX, SEA.maxX + 20, b.minZ - 4, b.minZ, 'sea_north');
    wall(BEACH.waterLimitX, SEA.maxX + 20, b.maxZ, b.maxZ + 4, 'sea_south');
    wall(SEA.maxX, SEA.maxX + 20, b.minZ - 4, b.maxZ + 4, 'sea_east');
    this.sea = { minX: BEACH.flatEnd, maxX: SEA.maxX, minZ: b.minZ, maxZ: b.maxZ };

    const S = this.surface;
    const ctx = { group: null, pools: [], animated: this.animated, points: this.points };
    const part = (name, center, radius, fn) => {
      const g = new THREE.Group(); g.name = name;
      ctx.group = g;
      const res = fn();
      for (const k of res.colliders || []) this._addCollider(c, k, name);
      this.group.add(g);
      this.parts.push({ name, group: g, center, radius });
      return res;
    };
    // Ilhas primeiro (o relevo alimenta a colisão das peças apoiadas nelas).
    for (const def of ISLANDS) {
      const r = part(def.id, new THREE.Vector3(def.x, 0, def.z), def.r + 30, () => buildIsland(def, S, ctx));
      this.docks[def.id] = { ...r.dock, name: def.name };
    }
    const sm = part('sunset_marina', new THREE.Vector3(110, 0, -120), 60, () => {
      const r = buildMarina(MARINAS.sunset, ctx);
      const o = buildOffice(MARINAS.sunset.office, MARINAS.sunset.name, ctx);
      this.office = o.counter;
      return { colliders: [...r.colliders, ...o.colliders], slips: r.slips };
    });
    this.slips.sunset = sm.slips;
    const az = part('azure_docks', new THREE.Vector3(100, 0, -285), 55, () => {
      const r = buildMarina(MARINAS.azure, ctx);
      const w = buildWarehouse(MARINAS.azure.warehouse, ctx);
      const p = this._policeBase(ctx);
      return { colliders: [...r.colliders, ...w.colliders, ...p.colliders], slips: r.slips };
    });
    this.slips.azure = az.slips;
    this.docks.sunset_marina = { x: 152 + 4, z: MARINAS.sunset.pierZ - 6, heading: Math.PI / 2, name: MARINAS.sunset.name };
    this.docks.azure_docks = { x: 134 + 4, z: MARINAS.azure.pierZ - 6, heading: Math.PI / 2, name: MARINAS.azure.name };
    this._pools(ctx.pools);
    this.game.scene.add(this.group);

    // Terreno, profundidade, superfície e limites do ambiente (mesma função para tudo).
    const baseTerrain = c.terrainHeight;
    c.setTerrain((x, z) => (x < 200 ? baseTerrain(x, z) : Math.max(baseTerrain(x, z), S.seabed(x, z))));
    const baseDepth = env.waterDepth.bind(env);
    env.waterDepth = (x, z) => (x < 200 ? baseDepth(x, z) : Math.max(0, S.depth(x, z)));
    const baseSurface = env.getSurface.bind(env);
    env.getSurface = (x, z) => {
      if (x < 200) return baseSurface(x, z);
      return S.depth(x, z) > 0.04 ? 'water' : 'sand';
    };
    env.waterHeight = (x, z) => S.height(x, z);
    env.waterLevel = S.level;
    env.waterSurface = S;
    env.seaOpen = true;
    const sea = this.sea;
    const baseHint = env.boundaryHint.bind(env);
    env.boundaryHint = (x, z, radius) => {
      if (x > BEACH.waterLimitX) return x > sea.maxX - radius - 3 || z < sea.minZ + 2 || z > sea.maxZ - 2 ? 'water' : null;
      const h = baseHint(x, z, radius);
      return h === 'water' ? null : h;
    };
    this.ready = true;
    this.stats.buildMs = Math.round(performance.now() - t0);
    this.stats.colliders = this.colliderIds.length;
    let tri = 0;
    this.group.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) tri += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    this.stats.triangles = Math.round(tri);
  }

  _addCollider(c, k, prefix) {
    const id = `sea_${prefix}_${this.colliderIds.length}`;
    c.addBox({ id, cx: k.x, cz: k.z, hx: k.w / 2, hz: k.d / 2, rotation: k.ry || 0, minY: k.y0, maxY: k.y1, walkable: k.walkable, cameraBlocker: k.cameraBlocker, solid: true, tags: ['maritime'] });
    this.colliderIds.push(id);
  }

  /** Base da patrulha marítima (somente estrutura e embarcação atracada). */
  _policeBase(ctx) {
    const b = new InteriorBuilder();
    const x = 64, z = -270;
    b.box(mat(0xe8eef4, 0.6), x, 0.1, z, 5, 2.8, 4, { r: 0.04, collide: true });
    b.box(mat(0x1d3a6e, 0.5), x, 2.9, z, 5.5, 0.25, 4.5, { r: 0.04 });
    b.box(glow(0x4d8dff, 1.6), x - 2.2, 3.15, z - 1.9, 0.4, 0.18, 0.18, { r: 0.02 });
    b.box(glow(0xff3048, 1.6), x + 2.2, 3.15, z - 1.9, 0.4, 0.18, 0.18, { r: 0.02 });
    b.box(glow(0xdce8ff, 0.7), x + 2.52, 1.0, z, 0.02, 1.1, 2.6, { r: 0 });
    const built = b.build();
    ctx.group.add(built.group);
    const tex = neonTextTexture('NCPD HARBOR', { color: '#7fb2ff', style: 'block', sub: 'PATRULHA MARÍTIMA' });
    const sign = createSignMesh(tex, 3.6, 0.9, { intensity: 1.3, backing: 0x0e1626, backingDepth: 0.06 });
    sign.group.position.set(x + 2.58, 2.3, z);
    sign.group.rotation.y = Math.PI / 2;
    ctx.group.add(sign.group);
    this.policeBase = { x, z, label: 'NCPD HARBOR PATROL' };
    ctx.points.push({ id: 'harbor_patrol', x: x + 3.2, z, label: 'NCPD HARBOR PATROL', text: 'Base da patrulha marítima da NCPD. A lancha de patrulha fica atracada aqui; as perseguições no mar ainda não estão em operação.' });
    return { colliders: b.colliders };
  }

  /** Círculos de luz falsos (aditivos) sob os postes dos píeres: uma malha instanciada. */
  _pools(list) {
    if (!list.length) return;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 });
    const inst = new THREE.InstancedMesh(geo, m, list.length);
    const M4 = new THREE.Matrix4(), col = new THREE.Color();
    list.forEach((p, i) => {
      M4.makeScale(p.radius * 2, 1, p.radius * 2).setPosition(p.x, p.y ?? 0.6, p.z);
      inst.setMatrixAt(i, M4);
      inst.setColorAt(i, col.setHex(p.color));
    });
    inst.renderOrder = 2;
    this.poolMesh = inst;
    this.poolMaterial = m;
    this.group.add(inst);
  }

  // ------------------------------------------------------------ consultas
  /** Ponto de interesse marítimo mais próximo (texto curto, tecla E). */
  candidates(p) {
    const out = [];
    for (const pt of this.points) {
      const d = Math.hypot(pt.x - p.x, pt.z - p.z);
      if (d < 2.2) out.push({ dist: d, anchor: pt, label: `<kbd>E</kbd> ${pt.label}`, run: () => ({ who: pt.label, text: pt.text, options: [{ label: 'Fechar', run: () => null }] }) });
    }
    return out;
  }

  /** Nome do local marítimo perto de (x, z), para o HUD. */
  placeAt(x, z) {
    for (const def of ISLANDS) if (Math.hypot(x - def.x, z - def.z) < def.r + 25) return def.name;
    if (Math.abs(z - MARINAS.sunset.pierZ) < 40 && x > 60 && x < 175) return MARINAS.sunset.name;
    if (Math.abs(z - MARINAS.azure.pierZ) < 35 && x > 55 && x < 155) return MARINAS.azure.name;
    if (x > 140) return 'MAR ABERTO · BAÍA DE NEON CITY';
    return null;
  }

  // ------------------------------------------------------------ ciclo
  update(dt, camera) {
    if (!this.active || !this.ready) return;
    this.t += dt;
    this.surface.sync(this.env.ocean);
    for (const f of this.animated) f(dt, this.t);
    // LOD por distância (barato: 4 vezes por segundo).
    this._lodT -= dt;
    if (this._lodT <= 0) {
      this._lodT = 0.25;
      let n = 0;
      for (const p of this.parts) {
        const vis = camera.position.distanceTo(p.center) - p.radius < 520;
        p.group.visible = vis;
        if (vis) n++;
      }
      this.stats.visibleParts = n;
      if (this.poolMaterial) this.poolMaterial.opacity = this.game.world.environment?.preset?.pointLights ? 0.45 : 0.12;
    }
    this.effects.update(dt, this.surface);
  }
}
