import * as THREE from 'three';
import { StaticBatcher, groundPlane, composeMatrix, tiledBox } from '../render/StaticBatcher.js';
import { buildRoads, buildSlab, buildOverlay, paintLine, SIDEWALK_HEIGHT } from './RoadGenerator.js';
import { buildRoadDetails } from './RoadDetails.js';
import { BuildingKit } from './buildings/BuildingKit.js';
import { BUILDING_TYPES } from './BuildingGenerator.js';
import { ZONE_BUILDING_TYPES } from './buildings/ZoneBuildings.js';
import { VegetationGenerator } from './VegetationGenerator.js';
import { AmbientSystem } from './AmbientSystem.js';
import { buildSand, buildSeawall, buildLifeguardTower, buildRopeFence, buildSurfboards } from './BeachGenerator.js';
import { PalmGenerator } from './PalmGenerator.js';
import { PropGenerator } from './PropGenerator.js';
import { TrafficSignalController } from './TrafficSignals.js';
import { neonTextTexture, neonVerticalTexture, neonIconTexture, createSignMesh } from './NeonSign.js';
import { customSignTexture } from '../render/ProceduralTextures.js';
import { BEACH } from './Terrain.js';
import { createRng } from '../utils/math.js';

/**
 * Constrói um bairro a partir de seus dados de layout.
 * Separa explicitamente: geometria visual (batcher/instâncias), colisões,
 * objetos interativos (veículos), decoração, pontos de interesse, caminhos
 * de veículos e pontos de spawn — todos registrados no World.
 */
export class CityGenerator {
  constructor(world) {
    this.world = world;
    this.lib = world.lib;
    this.quality = world.quality;
  }

  /** Fábrica de letreiros usada pelos arquétipos de edifícios. */
  _signFactory() {
    const lib = this.lib;
    const neon = this.world.neonSigns;
    const quality = this.quality;
    const world = this.world;
    const glowFactory = (hex) => lib.glow(hex, 0.35);
    return {
      text: (text, o = {}) => {
        // ~120 px por metro, potência de 2 entre 512 e 1024 (proporção 4:1 mantida).
        const px = (o.width ?? 6) >= 5 ? 1024 : 512;
        const tex = neonTextTexture(text, { color: o.color, style: o.style, outline: o.outline, sub: o.sub, subColor: o.subColor, frame: o.frame, width: px, height: px / 4 });
        const { group, material } = createSignMesh(tex, o.width, o.height, {
          intensity: o.intensity ?? 1.45, backing: o.backing ?? null, glowColor: o.glow ?? null, glowMaterialFactory: glowFactory, doubleSided: o.doubleSided,
        });
        neon.register(material, o.flicker || 'steady', text.length * 3.7);
        world.textures.push(tex);
        return group;
      },
      vertical: (text, o = {}) => {
        const tex = neonVerticalTexture(text, { color: o.color });
        const { group, material } = createSignMesh(tex, o.width, o.height, { intensity: o.intensity ?? 1.5 });
        neon.register(material, o.flicker || 'steady', text.length * 5.1);
        world.textures.push(tex);
        return group;
      },
      icon: (kind, o = {}) => {
        const tex = neonIconTexture(kind, o.color, o.color2, (o.size ?? 2) >= 2.5 ? 512 : 256);
        const { group, material } = createSignMesh(tex, o.size, o.size, { intensity: o.intensity ?? 1.5 });
        neon.register(material, o.flicker || 'steady', kind.length * 2.3);
        world.textures.push(tex);
        return group;
      },
      lightbox: (draw, cw, ch, o = {}) => {
        const tex = customSignTexture(cw, ch, draw);
        world.textures.push(tex);
        const g = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color().setScalar(o.intensity ?? 1.1) });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(o.width, o.height), mat);
        plane.position.z = 0.17;
        g.add(plane);
        const box = new THREE.Mesh(new THREE.BoxGeometry(o.width + 0.2, o.height + 0.2, 0.3), lib.solid(o.backing ?? 0xffffff, 0.5, 0.1));
        box.castShadow = true;
        g.add(box);
        return g;
      },
      light: (color, intensity, distance) => {
        const l = new THREE.PointLight(color, intensity, distance, 2);
        l.castShadow = false;
        l.visible = quality.pointLights;
        world.pointLights.push(l);
        return l;
      },
    };
  }

  build(district) {
    const world = this.world;
    const lib = this.lib;
    const batcher = new StaticBatcher({ chunkSize: 140 });
    const rng = createRng(1986);
    const t0 = performance.now();
    // Tempo por etapa (diagnóstico de carregamento; exposto em world.stats.stages).
    const stages = {};
    let tPrev = t0;
    const mark = (k) => { const t = performance.now(); stages[k] = Math.round(t - tPrev); tPrev = t; };

    // --- Ruas e cruzamentos (dados -> malha) ---------------------------
    const net = world.roads;
    for (const r of district.roads) net.addRoad(r);
    for (const i of district.intersections) net.addIntersection(i);
    for (const c of district.crosswalks) {
      const cw = net.addCrosswalk(c);
      cw.stopLine = c.stopLine || null;
    }
    buildRoads(net, batcher, lib, { visibleBounds: district.visibleBounds });

    // --- Lajes de calçada, gramados e estacionamento -------------------
    for (const s of district.slabs) buildSlab(s, batcher, lib, world.collision, world.terrain);
    this.roadDetails = buildRoadDetails(net, batcher, lib, world.collision, { visibleBounds: district.visibleBounds });
    for (const o of district.overlays) buildOverlay(o, batcher, lib, world.terrain, o);
    this._parkingLot(district.parkingLot, batcher);

    // Chão de fundo (além das lajes) — termina onde a praia começa, para não
    // cobrir a areia inclinada nem o oceano.
    const groundW = 3000;
    const ground = groundPlane(groundW, 4000, 20);
    composeMatrix(BEACH.start - groundW / 2, -0.05, 0, 0, 0, 0, 1, 1, 1, this._m || (this._m = new THREE.Matrix4()));
    batcher.add(ground, lib.m.ground, this._m, null, { castShadow: false, chunk: 'ground' });
    ground.dispose();

    mark('ruas_lajes');
    // --- Edifícios ------------------------------------------------------
    const kit = new BuildingKit({
      batcher, lib, collision: world.collision, dynamicParent: world.groups.signs, signs: this._signFactory(),
    });
    // Listas compartilhadas: edifícios (jardins) e decoração adicionam palmeiras e plantas.
    const palms = [];
    const plants = [];
    kit.palms = palms;
    kit.plants = plants;
    kit.terrain = world.terrain;
    kit.fans = [];
    kit.swings = [];
    kit.flags = [];
    for (const spec of district.buildings) {
      const fn = BUILDING_TYPES[spec.type] ?? ZONE_BUILDING_TYPES[spec.type];
      if (!fn) throw new Error(`Tipo de edifício desconhecido: ${spec.type}`);
      kit.begin({ id: spec.id, x: spec.x, y: SIDEWALK_HEIGHT, z: spec.z, rotY: spec.rotY });
      kit.rng = createRng(spec.id.length * 131 + Math.round(spec.x * 7 + spec.z * 13));
      const tb = performance.now();
      const info = fn(kit, spec);
      stages[`tipo_${spec.type}`] = Math.round((stages[`tipo_${spec.type}`] || 0) + performance.now() - tb);
      world.registerEntity({ id: spec.id, type: 'building', subtype: spec.type, name: spec.name || spec.id, data: info });
      for (const e of info.entrances) {
        world.addPOI({ id: `${spec.id}_entrance`, type: 'entrance', label: e.label || spec.name || spec.id, x: e.x, y: e.y, z: e.z, buildingId: spec.id });
      }
    }

    mark('edificios');
    // --- Praia ----------------------------------------------------------
    buildSand(batcher, lib, world.terrain, {});
    if (district.surfboards) buildSurfboards(batcher, lib, world.collision, world.terrain, district.surfboards);
    buildSeawall(batcher, lib, world.collision, { gaps: district.beachAccess, bounds: district.bounds });
    for (const t of district.lifeguardTowers) {
      const info = buildLifeguardTower(kit, lib, world.terrain, t);
      world.registerEntity({ id: t.id, type: 'landmark', subtype: 'lifeguardTower', name: 'Torre de salva-vidas', data: info });
      world.addPOI({ id: t.id, type: 'landmark', label: 'Torre de salva-vidas', x: t.x, y: 0, z: t.z });
    }
    buildRopeFence(batcher, lib, world.terrain, district.bounds.minZ - 1, BEACH.start + 0.6, BEACH.waterLimitX + 6);
    buildRopeFence(batcher, lib, world.terrain, district.bounds.maxZ + 1, BEACH.start + 0.6, BEACH.waterLimitX + 6);

    mark('praia');
    // --- Mobiliário, palmeiras e sinalização ---------------------------
    const props = new PropGenerator(lib, world.groups.props, world.collision, this.quality, world.destruction);
    const signals = [];
    district.decorate?.({ district, props, palms, plants, signals, batcher, rng, world, lib, net });
    for (const sig of signals) {
      const ctrl = new TrafficSignalController(sig.id, lib, world.groups.props, world.collision, world.destruction);
      for (const pole of sig.poles) ctrl.addPole(pole);
      world.trafficSignals.push(ctrl);
    }
    props.build();
    mark('mobiliario');
    world.palms = new PalmGenerator(lib, { variants: 4 });
    world.palms.build(palms, world.groups.vegetation, world.collision);
    world.vegetation = new VegetationGenerator(lib, this.quality);
    world.vegetation.build(plants, world.groups.vegetation, world.collision);

    // --- Animações ambientes: bandeiras, placas penduradas e exaustores.
    const ambient = new AmbientSystem(lib, world.groups.props, this.quality);
    for (const f of kit.fans) ambient.addFan(f.p, f.r);
    for (const s of kit.swings) ambient.addSwing(s, 0.1, 1.4 + (s.id % 5) * 0.12);
    for (const a of district.beachAccess) ambient.addFlag(52.3, SIDEWALK_HEIGHT, a + 2.2, Math.PI, { height: 5.4 });
    // Bandeiras das torres de salva-vidas (mastro já existente).
    for (const f of kit.flags) ambient.addFlag(f.x, f.y, f.z, f.rot, f.opts);
    // Boias da área de banho (vermelhas e brancas alternadas).
    const bz = district.buoys;
    if (bz) {
      let k = 0;
      for (let z = bz.from; z <= bz.to; z += bz.step, k++) {
        ambient.addBuoy(bz.x, BEACH.waterLevel - 0.12, z, k % 2 ? 0xfdf6ee : 0xff4f3a);
        world.collision.addCylinder({ id: `buoy_${k}`, ownerId: 'beach', x: bz.x, z, radius: 0.32, minY: -2, maxY: 0.6, cameraBlocker: false, walkable: false });
      }
    }
    ambient.build(world.collision);
    mark('vegetacao_ambiente');
    world.ambient = ambient;

    // --- Poças de luz dos postes (visíveis ao entardecer e à noite).
    const lamps = props.placements.get('lamp') || [];
    const pool = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const lightPools = new THREE.InstancedMesh(pool, lib.m.lightPool, lamps.length);
    lightPools.name = 'lamp-light-pools';
    lightPools.castShadow = lightPools.receiveShadow = false;
    const pm = new THREE.Matrix4();
    for (const [index, l] of lamps.entries()) {
      const hx = l.x + Math.sin(l.rot) * 1.45, hz = l.z + Math.cos(l.rot) * 1.45;
      composeMatrix(hx, l.y + 0.02, hz, 0, l.rot, 0, 8.5, 1, 8.5, pm);
      lightPools.setMatrixAt(index, pm);
      world.destruction.addBinding(l.id, lightPools, index);
    }
    lightPools.instanceMatrix.needsUpdate = true;
    lightPools.computeBoundingSphere();
    world.groups.props.add(lightPools);

    // --- Limites físicos do bairro -------------------------------------
    this._bounds(district, props, batcher);

    // --- Silhuetas de fundo (fora do bairro, sem colisão) --------------
    this._background(district, batcher, rng);

    mark('limites_fundo');
    // --- Veículos estacionados (objetos interativos futuros) -----------
    for (const v of district.vehicles) {
      const vehicle = world.vehicleFactory.create(v.type, { id: v.id, color: v.color, stripe: v.stripe, plate: v.plate });
      world.groups.vehicles.add(vehicle.root);
      vehicle.setPose(v.x, SIDEWALK_HEIGHT * (this._onSlab(v.x, v.z) ? 1 : 0), v.z, v.heading);
      vehicle.attachCollider(world.collision);
      world.vehicles.push(vehicle);
      world.registerEntity({ id: v.id, type: 'vehicle', subtype: v.type, name: vehicle.spec.model, data: vehicle });
    }

    // --- Spawn e caminhos de tráfego ------------------------------------
    for (const s of district.spawnPoints) world.spawnPoints.set(s.id, s);
    world.lanePaths = net.getLanePaths(10);
    world.parkingSpots.push(...net.getParkingSpots(6.2, district.bounds));
    // Marca como ocupadas as vagas onde há veículos estacionados.
    for (const spot of world.parkingSpots) {
      spot.occupied = world.vehicles.some((v) => Math.hypot(v.root.position.x - spot.x, v.root.position.z - spot.z) < 2.5);
    }

    mark('veiculos_spawn');
    const meshes = batcher.build(world.groups.static, district.id);
    // Lotes de detalhe (LOD): visibilidade por distância, atualizada pelo World.
    world.lodMeshes.push(...meshes.filter((m) => m.userData.lodDistance));
    mark('fusao_geometria');
    world.stats.stages = stages;
    world.stats.batchItems = batcher.itemCount;
    world.stats.staticMeshes += meshes.length;
    world.stats.buildMs = performance.now() - t0;
  }

  _onSlab(x, z) {
    const s = this.world.terrain.getSurface(x, z);
    return s !== 'asphalt';
  }

  _parkingLot(lot, batcher) {
    if (!lot) return;
    const lib = this.lib;
    const n = Math.floor((lot.maxZ - lot.minZ) / lot.stallWidth);
    for (const row of lot.rows) {
      const xEnd = row.x0 + row.facing * row.depth;
      const xc = (row.x0 + xEnd) / 2;
      for (let k = 0; k <= n; k++) {
        const z = lot.minZ + k * lot.stallWidth;
        paintLine(batcher, lib, xc, z, row.depth, 0.12);
      }
      paintLine(batcher, lib, xEnd, (lot.minZ + lot.maxZ) / 2, 0.12, n * lot.stallWidth);
      for (let k = 0; k < n; k++) {
        const z = lot.minZ + (k + 0.5) * lot.stallWidth;
        this.world.parkingSpots.push({ id: `${lot.id}_${row.x0}_${k}`, x: xc, z, heading: row.facing > 0 ? -Math.PI / 2 : Math.PI / 2, occupied: false, lotId: lot.id });
      }
    }
    // Setas do corredor.
    for (const z of [92, 108]) paintLine(batcher, lib, 0.5, z, 2.4, 0.3);
  }

  _bounds(district, props, batcher) {
    const b = district.bounds;
    const c = this.world.collision;
    const wall = (minX, maxX, minZ, maxZ, id) => c.addAABB({ id, minX, maxX, minZ, maxZ, minY: -5, maxY: 60, cameraBlocker: false, walkable: false, tags: ['boundary'] });
    wall(b.minX - 4, BEACH.waterLimitX + 20, b.minZ - 4, b.minZ, 'bound_north');
    wall(b.minX - 4, BEACH.waterLimitX + 20, b.maxZ, b.maxZ + 4, 'bound_south');
    wall(b.minX - 4, b.minX, b.minZ - 4, b.maxZ + 4, 'bound_west');
    wall(BEACH.waterLimitX, BEACH.waterLimitX + 20, b.minZ - 4, b.maxZ + 4, 'bound_water');

    // Barreiras visuais "ROAD CLOSED" nas vias que saem do bairro.
    const across = (x0, x1, z, rot = 0) => {
      const n = Math.max(1, Math.round((x1 - x0) / 3.2));
      for (let i = 0; i < n; i++) props.barricade(batcher, x0 + (i + 0.5) * ((x1 - x0) / n), 0, z, rot, (x1 - x0) / n - 0.3);
    };
    for (const z of [b.minZ + 1.2, b.maxZ - 1.2]) {
      across(18.4, 37.6, z);
      across(-75.6, -64.4, z);
      const y = SIDEWALK_HEIGHT;
      const sb = (x0, x1) => {
        const n = Math.max(1, Math.round((x1 - x0) / 3.2));
        for (let i = 0; i < n; i++) props.barricade(batcher, x0 + (i + 0.5) * ((x1 - x0) / n), y, z, 0, (x1 - x0) / n - 0.3);
      };
      sb(38.4, 53);
      sb(12.6, 17.8);
      sb(-63.6, -58.6);
      sb(-80.6, -76.4);
      props.trafficSign('closed', 17.2, y, z + (z < 0 ? 1.5 : -1.5), z < 0 ? 0 : Math.PI);
      props.trafficSign('closed', -63.2, y, z + (z < 0 ? 1.5 : -1.5), z < 0 ? 0 : Math.PI);
    }
    // Flamingo Street (oeste).
    for (let i = 0; i < 4; i++) props.barricade(batcher, b.minX + 1.2, 0, -4.5 + i * 3, Math.PI / 2, 2.7);
    props.trafficSign('closed', b.minX + 2.5, SIDEWALK_HEIGHT, 7.5, Math.PI / 2);
  }

  /** Massas de edifícios distantes para sugerir a cidade além de Sunset Beach. */
  _background(district, batcher, rng) {
    const lib = this.lib;
    const palette = [0xf6d2b8, 0xbfe6d8, 0xf3e5ab, 0xd9c8f0, 0xf5f1e6, 0xb9dcf2, 0xf7b9a8, 0xe9d6f2];
    const m = new THREE.Matrix4();
    const add = (x, z, w, d, h) => {
      const g = tiledBox(w, h, d, 12, 12.8);
      composeMatrix(x, SIDEWALK_HEIGHT + h / 2, z, 0, 0, 0, 1, 1, 1, m);
      batcher.add(g, lib.m.distant, m, rng.pick(palette), { castShadow: false, receiveShadow: false, chunk: `bg${Math.floor(x / 200)}_${Math.floor(z / 200)}` });
      g.dispose();
    };
    const b = district.bounds;
    // Orla norte e sul (continuação da avenida).
    for (const dir of [-1, 1]) {
      const edge = dir < 0 ? -b.minZ : b.maxZ;
      for (let z = edge + 19; z < 430; z += rng.range(26, 40)) {
        const zz = dir * z;
        add(rng.range(-6, 0), zz, rng.range(18, 26), rng.range(22, 30), rng.range(12, 42));
        add(rng.range(-46, -36), zz + rng.range(-6, 6), rng.range(16, 24), rng.range(18, 24), rng.range(9, 26));
        if (rng.chance(0.8)) add(rng.range(-100, -86), zz, rng.range(18, 26), rng.range(20, 26), rng.range(10, 34));
      }
    }
    // Oeste.
    for (let z = -400; z < 400; z += rng.range(30, 46)) {
      add(rng.range(-190, -175), z, rng.range(20, 30), rng.range(22, 30), rng.range(10, 48));
      if (rng.chance(0.7)) add(rng.range(-250, -225), z + 10, rng.range(24, 34), rng.range(24, 34), rng.range(16, 60));
    }
  }
}
