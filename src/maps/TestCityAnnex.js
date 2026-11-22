import * as THREE from 'three';
import { ImportedMap } from './ImportedMap.js';
import { TEST_CITY_LINK } from '../world/districts/TestCityLink.js';
import { unionBounds } from '../utils/bounds.js';
import { neonTextTexture, createSignMesh } from '../world/NeonSign.js';

/**
 * TEST CITY como bairro do mundo (junção dos dois mapas).
 *
 * O GLB original é carregado sem alterações e transladado para oeste de
 * Sunset Beach (TestCityLink.js). Este módulo só ANEXA o que já existe:
 *  - colisões e campo de alturas do GLB entram no CollisionSystem e no Terrain do mundo;
 *  - ruas, cruzamentos e faixas do manifesto entram na mesma rede viária
 *    (trânsito, pedestres, polícia e minimapa passam a enxergar o bairro);
 *  - a Flamingo Street chega ao cruzamento da rua Z100;
 *  - limites: paredes do bairro com uma passagem a leste e um corredor até o Sunset.
 *
 * Omitidos ao anexar (o arquivo não muda): as paredes invisíveis do mapa isolado
 * (grupo BOUNDS) e as barreiras de concreto da borda leste na largura da passagem.
 */
const _v = new THREE.Vector3();

export class TestCityAnnex {
  constructor(world) {
    this.world = world;
    this.link = TEST_CITY_LINK;
    this.map = null;
    this.ready = false;
    this.error = null;
    this.bounds = null;
    this.wallIds = [];
    this.stats = null;
  }

  /** Baixa e interpreta o GLB em paralelo com a inicialização (nada entra na cena ainda). */
  preload() {
    const w = this.world, L = this.link;
    this.map = new ImportedMap({
      id: 'test-city', manifestUrl: L.manifestUrl, scene: w.scene, renderer: w.renderer,
      attach: { collision: w.collision, parent: w.groups.static, offset: L.offset, skip: (m) => this._skip(m) },
    });
    this.loading = this.map.fetch()
      .then(() => true)
      .catch((err) => {
        this.error = err.message;
        this.map = null;
        console.warn('[TEST CITY]', err.message);
        return false;
      });
    return this.loading;
  }

  /** Nós do GLB que não entram no mundo unificado. */
  _skip(m) {
    const L = this.link;
    for (let o = m; o; o = o.parent) {
      if (o.name === 'BOUNDS') return true; // paredes invisíveis do mapa isolado
      if (o.name?.startsWith('jersey_')) {
        o.getWorldPosition(_v);
        return _v.x - L.offset.x > L.half - 4 && Math.abs(_v.z - L.offset.z) < L.opening;
      }
      // Postes que o gerador do mapa de testes plantou 2,5 m dentro da pista (na saída dos
      // cruzamentos): no mundo unificado o trânsito e o jogador passam por ali em velocidade.
      if (o.name?.startsWith('lamp_')) {
        o.getWorldPosition(_v);
        return this._inCarriageway(_v.x - L.offset.x, _v.z - L.offset.z);
      }
    }
    return false;
  }

  /** (lx, lz) local do GLB dentro da pista de rolamento de alguma rua do manifesto. */
  _inCarriageway(lx, lz) {
    for (const r of this.map?.manifest?.roads || []) {
      const half = (r.medianWidth ?? 0.4) / 2 + (r.lanesPerDirection ?? 1) * (r.laneWidth ?? 3.5) + 0.3;
      const alongX = Math.abs(r.start.z - r.end.z) < 0.01;
      const [a0, a1] = alongX ? [Math.min(r.start.x, r.end.x), Math.max(r.start.x, r.end.x)] : [Math.min(r.start.z, r.end.z), Math.max(r.start.z, r.end.z)];
      const along = alongX ? lx : lz, across = alongX ? lz - r.start.z : lx - r.start.x;
      if (along >= a0 && along <= a1 && Math.abs(across) < half) return true;
    }
    return false;
  }

  /**
   * Monta o bairro no mundo (síncrono). Chamado logo depois de Sunset Beach,
   * antes de trânsito, pedestres, polícia, interiores e minimapa receberem o mapa.
   */
  attach() {
    if (!this.map || this.ready) return false;
    const t0 = performance.now();
    const w = this.world, L = this.link, map = this.map, off = L.offset;
    map.process();
    const b = map.bounds;
    this.bounds = b;
    const hf = map.heightField;

    // Relevo (colina do parque) e superfícies (passos, pneus) do GLB.
    w.terrain.addOverlay({
      minX: hf.minX, maxX: hf.minX + hf.nx * hf.cell, minZ: hf.minZ, maxZ: hf.minZ + hf.nz * hf.cell,
      height: (x, z) => hf.sample(x, z),
      surface: (x, z) => map.getSurface(x, z),
    });

    // Rede viária: as ruas do manifesto, deslocadas, na mesma rede do Sunset Beach.
    const net = w.roads, man = map.manifest, P = L.prefix;
    const tr = (p) => ({ x: p.x + off.x, z: p.z + off.z });
    for (const r of man.roads || []) net.addRoad({ ...r, id: P + r.id, start: tr(r.start), end: tr(r.end) });
    for (const i of man.intersections || []) {
      const id = i.id.startsWith(P) ? i.id : P + i.id;
      const roads = i.roads.map((rid) => P + rid);
      if (id === L.junction) roads.push('flamingo_w');
      net.addIntersection({ ...i, id, roads, x: i.x + off.x, z: i.z + off.z });
    }
    for (const c of man.crosswalks || []) net.addCrosswalk({ ...c, id: P + c.id, roadId: P + c.roadId });
    w.lanePaths = net.getLanePaths(10);

    // Limites: bairro fechado, exceto a passagem leste; corredor até Sunset Beach.
    const c = w.collision;
    const wall = (minX, maxX, minZ, maxZ, id) => {
      c.addAABB({ id, minX, maxX, minZ, maxZ, minY: -5, maxY: 60, cameraBlocker: false, walkable: false, tags: ['boundary'] });
      this.wallIds.push(id);
    };
    const k = L.corridor;
    wall(b.minX - 4, b.maxX + 4, b.minZ - 4, b.minZ, 'tc_bound_north');
    wall(b.minX - 4, b.maxX + 4, b.maxZ, b.maxZ + 4, 'tc_bound_south');
    wall(b.minX - 4, b.minX, b.minZ, b.maxZ, 'tc_bound_west');
    wall(b.maxX, b.maxX + 4, b.minZ, k.minZ, 'tc_bound_east_n');
    wall(b.maxX, b.maxX + 4, k.maxZ, b.maxZ, 'tc_bound_east_s');
    wall(b.maxX, k.maxX, k.minZ - 3, k.minZ, 'tc_link_wall_n');
    wall(b.maxX, k.maxX, k.maxZ, k.maxZ + 3, 'tc_link_wall_s');
    c.remove('bound_west_link');
    this._corridorVisuals();

    // Bairro registrado no mundo: nome no HUD, minimapa (ruas, prédios, parque) e área jogável.
    this.district = {
      id: L.id, name: L.name, annex: true, bounds: { ...b }, labelX: off.x,
      buildings: map.footprints.map((f) => ({ id: f.id, x: f.x, z: f.z, rotY: f.rotY, w: f.w, d: f.d })),
      // Parque com colina do GLB (quarteirão 55…95 do gerador do mapa de testes).
      overlays: [{ minX: 55 + off.x, maxX: 95 + off.x, minZ: 55 + off.z, maxZ: 95 + off.z, surface: 'grass' }],
    };
    w.districts.push(this.district);
    const home = w.bounds;
    w._playBounds = unionBounds([home, { minX: b.maxX - 1, maxX: home.minX + 1, minZ: k.minZ, maxZ: k.maxZ }, b]);
    w.annexes.push(this);
    w.testCity = this;
    w.spawnPoints.set('spawn_test_city', { ...map.spawnPoint, id: 'spawn_test_city' });

    this.ready = true;
    this.stats = { ...map.stats, attachMs: Math.round(performance.now() - t0) };
    return true;
  }

  /** Muretas do corredor e um letreiro de boas-vindas (geometria própria, fora do GLB). */
  _corridorVisuals() {
    const w = this.world, L = this.link, k = L.corridor;
    const len = k.maxX - k.minX;
    const mat = w.lib.m.curb;
    const geo = new THREE.BoxGeometry(len, 0.9, 0.45);
    for (const z of [k.minZ - 0.25, k.maxZ + 0.25]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set((k.minX + k.maxX) / 2, 0.45, z);
      m.castShadow = m.receiveShadow = true;
      m.name = 'tc_link_wall';
      w.groups.static.add(m);
    }
    const tex = neonTextTexture('TEST CITY', { color: '#45f3ff', style: 'block', sub: 'BAIRRO OESTE', width: 1024, height: 256 });
    w.textures.push(tex);
    const sign = createSignMesh(tex, 6, 1.5, { intensity: 1.05, backing: 0x1a1424, backingDepth: 0.15 });
    w.neonSigns.register(sign.material, 'steady', 9);
    // Pórtico sobre a Flamingo Street, de frente para quem chega do Sunset Beach (olhando para -X).
    const g = new THREE.Group();
    g.position.set(k.maxX - 3, 0, 0);
    g.rotation.y = Math.PI / 2;
    const postMat = w.lib.solid(0x2a2e38, 0.5, 0.4);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6.6, 0.35), postMat);
      post.position.set(s * (L.opening - 0.6), 3.3, 0);
      post.castShadow = true;
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * L.opening - 1.2, 0.4, 0.4), postMat);
    beam.position.set(0, 6.4, 0);
    beam.castShadow = true;
    g.add(beam);
    sign.group.position.set(0, 5.3, 0.25);
    g.add(sign.group);
    const back = sign.group.clone();
    back.rotation.y = Math.PI;
    back.position.z = -0.25;
    g.add(back);
    w.groups.signs.add(g);
    for (const s of [-1, 1]) {
      const x = g.position.x, z = s * (L.opening - 0.6);
      this.wallIds.push(w.collision.addCylinder({ id: `tc_gate_post_${s > 0 ? 's' : 'n'}`, x, z, radius: 0.25, minY: 0, maxY: 6.6, cameraBlocker: false, walkable: false }).id);
    }
  }

  /** Dica de limite na área do bairro e do corredor; undefined fora dela. */
  boundaryHint(x, z, radius) {
    const b = this.bounds, k = this.link.corridor;
    if (!b) return undefined;
    if (z > k.minZ && z < k.maxZ && x > b.maxX - 6 && x < k.maxX + 4) {
      return Math.abs(z) > k.maxZ - radius - 0.4 ? 'closed' : null;
    }
    if (x < b.minX - 4 || x > b.maxX + 4 || z < b.minZ - 4 || z > b.maxZ + 4) return undefined;
    const m = radius + 1.6;
    return x < b.minX + m || x > b.maxX - m || z < b.minZ + m || z > b.maxZ - m ? 'closed' : null;
  }

  contains(x, z) {
    const b = this.bounds;
    return !!b && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }
}
