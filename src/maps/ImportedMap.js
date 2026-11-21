import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CollisionSystem } from '../physics/CollisionSystem.js';
import { StaticBatcher } from '../render/StaticBatcher.js';
import { HeightField } from './HeightField.js';

/**
 * Mapa externo carregado de um GLB + manifest.json (cenário de testes).
 *
 * Convenções lidas dos "extras" dos nós (userData no Three.js):
 *  - ground: true            -> malha de chão (vira campo de alturas)
 *  - surface: 'grass' ...    -> tipo de superfície (passos)
 *  - collide: false          -> sem colisor automático (decalques, faixas)
 *  - collider: 'box'|'ramp'|'none' ou nome COL_* -> proxy de colisão invisível
 *  - castShadow: false       -> não projeta sombra
 *  - cameraBlocker: bool     -> sobrescreve o bloqueio da câmera
 *
 * Implementa a mesma interface de ambiente usada pelo Sunset Beach
 * (collision, waterDepth, getSurface, boundaryHint, distanceToShore,
 * spawnPoint, label, setVisible), então jogador, câmeras e HUD funcionam
 * sem alterações.
 */
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3();
const _x = new THREE.Vector3();
const _box = new THREE.Box3();

export class ImportedMap {
  constructor({ id, manifestUrl, scene, renderer }) {
    this.id = id;
    this.manifestUrl = manifestUrl;
    this.scene = scene;
    this.renderer = renderer;
    this.isImported = true;
    this.root = null;
    this.collision = null;
    this.heightField = null;
    this.manifest = null;
    this.spawnPoint = null;
    this.label = id;
    this.stats = null;
    this._cancelled = false;
    this._footCache = new Map();
    this._tmpList = [];
  }

  cancel() {
    this._cancelled = true;
  }

  _check() {
    if (this._cancelled) throw new Error('Carregamento cancelado');
  }

  /** onProgress(phase, fraction 0..1) */
  async load(onProgress = () => {}) {
    const t0 = performance.now();
    // 1) Manifesto.
    onProgress('manifest', 0);
    let manifest;
    try {
      const res = await fetch(this.manifestUrl, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = await res.json();
    } catch (err) {
      throw new Error(`Manifesto do mapa indisponível (${this.manifestUrl}): ${err.message}. Gere-o com "npm run build:testmap".`);
    }
    for (const key of ['file', 'spawn', 'bounds']) {
      if (!manifest[key]) throw new Error(`Manifesto inválido: campo "${key}" ausente.`);
    }
    this.manifest = manifest;
    this.label = manifest.label || this.id;
    this._check();

    // 2) Download com progresso real (Content-Length).
    const baseUrl = this.manifestUrl.slice(0, this.manifestUrl.lastIndexOf('/') + 1);
    const url = baseUrl + manifest.file;
    const tDl = performance.now();
    let buffer;
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('Content-Length')) || manifest.generated?.bytes || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (total) onProgress('download', Math.min(1, loaded / total));
        this._check();
      }
      buffer = new Uint8Array(loaded);
      let o = 0;
      for (const c of chunks) { buffer.set(c, o); o += c.length; }
    } catch (err) {
      if (this._cancelled) throw err;
      throw new Error(`Falha ao baixar ${url}: ${err.message}`);
    }
    const downloadMs = performance.now() - tDl;

    // 3) Interpretação do glTF (inclui decodificação das texturas).
    onProgress('parse', 0);
    await nextFrame();
    const tParse = performance.now();
    let gltf;
    try {
      gltf = await new GLTFLoader().parseAsync(buffer.buffer, baseUrl);
    } catch (err) {
      throw new Error(`GLB inválido ou corrompido: ${err.message}`);
    }
    const parseMs = performance.now() - tParse;
    this._check();

    // 4) Processamento: colisões, campo de alturas, otimização.
    onProgress('process', 0);
    await nextFrame();
    const tProc = performance.now();
    this._process(gltf, manifest, onProgress);
    const processMs = performance.now() - tProc;

    this.stats.fileBytes = buffer.byteLength;
    this.stats.downloadMs = Math.round(downloadMs);
    this.stats.parseMs = Math.round(parseMs);
    this.stats.processMs = Math.round(processMs);
    this.stats.totalMs = Math.round(performance.now() - t0);
    onProgress('done', 1);
    return this;
  }

  // ------------------------------------------------------------ processamento

  _flags(obj, stop) {
    const chain = [];
    for (let o = obj; o && o !== stop; o = o.parent) chain.push(o);
    const f = {};
    for (let i = chain.length - 1; i >= 0; i--) {
      const o = chain[i];
      Object.assign(f, o.userData);
      if (o.name && o.name.startsWith('COL_')) f.collider = f.collider || 'box';
      if (o.name && o.name.startsWith('GROUND')) f.ground = true;
    }
    return f;
  }

  _process(gltf, manifest, onProgress) {
    const src = gltf.scene;
    const scale = manifest.scale ?? 1;
    if (scale !== 1) src.scale.setScalar(scale);
    src.updateMatrixWorld(true);

    const meshes = [];
    let sourceNodes = 0;
    src.traverse((o) => {
      sourceNodes++;
      if (o.isMesh) meshes.push(o);
    });

    const visual = [];
    const ground = [];
    const proxies = [];
    let sourceTriangles = 0;
    for (const m of meshes) {
      const f = this._flags(m, src);
      m.userData.__flags = f;
      const tri = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      if (f.collider) { proxies.push(m); continue; }
      sourceTriangles += tri;
      visual.push(m);
      if (f.ground) ground.push(m);
    }

    // Campo de alturas a partir das malhas de chão.
    const b = manifest.bounds;
    _box.makeEmpty();
    for (const m of ground) _box.expandByObject(m);
    if (_box.isEmpty()) _box.set(new THREE.Vector3(b.minX, 0, b.minZ), new THREE.Vector3(b.maxX, 0, b.maxZ));
    const hf = new HeightField(_box.min.x, _box.min.z, _box.max.x, _box.max.z, manifest.heightfieldCell ?? 0.5);
    for (const m of ground) hf.rasterize(m, m.userData.__flags.surface || 'ground');
    hf.finalize(manifest.defaultGroundHeight ?? 0);
    this.heightField = hf;
    onProgress('process', 0.25);

    // Colisões (independentes da geometria visual).
    const col = new CollisionSystem({ cellSize: 16 });
    col.setTerrain((x, z) => hf.sample(x, z));
    const counts = { proxyBox: 0, proxyRamp: 0, auto: 0, skipped: 0, bounds: 0 };
    for (const m of proxies) {
      const f = m.userData.__flags;
      if (f.collider === 'none') continue;
      const o = this._obb(m, false);
      if (f.collider === 'ramp') {
        col.addRamp({ id: `${this.id}_${m.name}_${counts.proxyRamp}`, ownerId: m.name, cx: o.cx, cz: o.cz, hx: o.hx, hz: o.hz, rotation: o.rotation, y0: o.minY, y1: o.maxY });
        counts.proxyRamp++;
      } else {
        col.addBox({ ownerId: m.name, cx: o.cx, cz: o.cz, hx: o.hx, hz: o.hz, rotation: o.rotation, minY: o.minY, maxY: o.maxY, cameraBlocker: f.cameraBlocker ?? true, surface: f.surface || null });
        counts.proxyBox++;
      }
    }
    for (const m of visual) {
      const f = m.userData.__flags;
      if (f.ground || f.collide === false) continue;
      const o = this._obb(m, true);
      const h = o.maxY - o.minY;
      if (h < 0.03 || (o.hx < 0.12 && o.hz < 0.12 && h < 0.3)) { counts.skipped++; continue; }
      // Bloqueia a câmera: volumes altos com espessura (pilares, obeliscos, prédios)
      // ou baixos porém amplos (plataformas, fontes). Postes, lixeiras e bancos não.
      const w = 2 * Math.min(o.hx, o.hz), footprint = 4 * o.hx * o.hz;
      const blocker = f.cameraBlocker ?? ((o.fullHeight >= 1.2 && w >= 0.5) || (h >= 0.5 && footprint >= 4));
      col.addBox({ ownerId: m.name || m.parent?.name, cx: o.cx, cz: o.cz, hx: o.hx, hz: o.hz, rotation: o.rotation, minY: o.minY, maxY: o.maxY, cameraBlocker: blocker, surface: f.surface || null });
      counts.auto++;
    }
    if (manifest.addBoundaryWalls !== false) {
      const wall = (minX, maxX, minZ, maxZ) => { col.addAABB({ minX, maxX, minZ, maxZ, minY: -20, maxY: 200, cameraBlocker: false, walkable: false, tags: ['boundary'] }); counts.bounds++; };
      wall(b.minX - 5, b.maxX + 5, b.minZ - 5, b.minZ);
      wall(b.minX - 5, b.maxX + 5, b.maxZ, b.maxZ + 5);
      wall(b.minX - 5, b.minX, b.minZ, b.maxZ);
      wall(b.maxX, b.maxX + 5, b.minZ, b.maxZ);
    }
    this.collision = col;
    onProgress('process', 0.55);

    // Otimização visual: malhas repetidas -> InstancedMesh; únicas -> fusão por material.
    const root = new THREE.Group();
    root.name = `imported:${this.id}`;
    const groups = new Map();
    for (const m of visual) {
      const key = `${m.geometry.uuid}|${m.material.uuid}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    const batcher = new StaticBatcher({ chunkSize: manifest.chunkSize ?? 60 });
    const instanceThreshold = manifest.instanceThreshold ?? 3;
    const keepGeometries = new Set();
    let instancedGroups = 0, instances = 0;
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    for (const list of groups.values()) {
      const first = list[0];
      const f = first.userData.__flags;
      const cast = f.castShadow !== false;
      if (first.material.map) first.material.map.anisotropy = maxAniso;
      if (list.length >= instanceThreshold) {
        const im = new THREE.InstancedMesh(first.geometry, first.material, list.length);
        list.forEach((m, i) => im.setMatrixAt(i, m.matrixWorld));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = cast;
        im.receiveShadow = true;
        im.name = `inst:${first.name || first.parent?.name || 'mesh'}`;
        root.add(im);
        keepGeometries.add(first.geometry);
        instancedGroups++;
        instances += list.length;
      } else {
        for (const m of list) batcher.add(m.geometry, m.material, m.matrixWorld, null, { castShadow: cast, receiveShadow: true });
      }
    }
    const batched = batcher.build(root, this.id);
    // Geometrias de origem que foram fundidas não são mais necessárias.
    const disposed = new Set();
    for (const m of meshes) {
      const g = m.geometry;
      if (!keepGeometries.has(g) && !disposed.has(g)) { g.dispose(); disposed.add(g); }
    }
    for (const m of proxies) for (const mat of [].concat(m.material)) if (!visual.some((v) => v.material === mat)) mat.dispose();
    // Sombra com material de profundidade próprio: o MeshDepthMaterial compartilhado do
    // Three copia material.map e manteria a última textura viva após o descarregamento
    // (reenviando-a à GPU). Materiais com alphaTest usam as variantes do próprio Three.
    this._depthMaterial = new THREE.MeshDepthMaterial();
    root.traverse((o) => {
      if (o.isMesh && o.castShadow && !(o.material.alphaTest > 0) && !o.material.alphaMap) o.customDepthMaterial = this._depthMaterial;
    });
    this.root = root;
    this.scene.add(root);
    onProgress('process', 0.85);

    // Ponto de spawn seguro.
    const sp = manifest.spawn;
    const safe = this._findSafeSpawn(sp.x * scale, sp.z * scale, b);
    this.spawnPoint = { id: `${this.id}_spawn`, x: safe.x, y: safe.y, z: safe.z, yaw: sp.yaw ?? 0, adjusted: safe.adjusted };

    // Estatísticas.
    const texSet = new Set();
    let geoBytes = 0, triangles = 0, drawObjects = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      drawObjects++;
      const g = o.geometry;
      for (const a of Object.values(g.attributes)) geoBytes += a.array.byteLength;
      if (g.index) geoBytes += g.index.array.byteLength;
      const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
      triangles += t * (o.isInstancedMesh ? o.count : 1);
      if (o.material.map) texSet.add(o.material.map);
    });
    let texPixels = 0;
    for (const t of texSet) texPixels += (t.image?.width || 0) * (t.image?.height || 0);
    this.stats = {
      sourceNodes,
      sourceMeshes: meshes.length,
      sourceDrawCalls: visual.length,
      sourceTriangles: Math.round(sourceTriangles),
      drawObjects,
      batchedMeshes: batched.length,
      instancedGroups,
      instances,
      triangles: Math.round(triangles),
      textures: texSet.size,
      textureMB: +((texPixels * 4 * 1.33) / 1048576).toFixed(2),
      geometryMB: +(geoBytes / 1048576).toFixed(2),
      colliders: { ...counts, total: col.colliders.size },
      heightField: { nx: hf.nx, nz: hf.nz, cell: hf.cell, kb: Math.round(hf.byteSize / 1024), triangles: hf.trianglesRasterized },
      spawnAdjusted: safe.adjusted,
    };
  }

  /**
   * Caixa orientada (yaw) do mesh no mundo. Com `foot`, objetos esparsos
   * (postes com braço, árvores) usam só a parte inferior (até 2,5 m) para
   * bloquear o caminhar — evita "paredes invisíveis" sob braços e copas.
   */
  _obb(m, foot) {
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    let bb = g.boundingBox;
    let fullHeight = bb.max.y - bb.min.y;
    if (foot) {
      let cached = this._footCache.get(g.uuid);
      if (!cached) {
        const pos = g.attributes.position;
        const limit = bb.min.y + 2.5;
        const fb = new THREE.Box3();
        for (let i = 0; i < pos.count; i++) {
          if (pos.getY(i) <= limit) fb.expandByPoint(_v.fromBufferAttribute(pos, i));
        }
        const fullArea = (bb.max.x - bb.min.x) * (bb.max.z - bb.min.z);
        const footArea = fb.isEmpty() ? 0 : (fb.max.x - fb.min.x) * (fb.max.z - fb.min.z);
        if (!fb.isEmpty()) {
          // A pegada vem dos vértices baixos, mas a altura cobre toda a faixa de
          // caminhada: um cilindro (poste, tronco) só tem vértices na base e no topo.
          fb.min.y = bb.min.y;
          fb.max.y = Math.min(bb.max.y, limit);
        }
        cached = { sparse: !fb.isEmpty() && fullArea > 0.05 && footArea < fullArea * 0.6, fb };
        this._footCache.set(g.uuid, cached);
      }
      if (cached.sparse) bb = cached.fb;
    }
    m.matrixWorld.decompose(_p, _q, _s);
    _up.set(0, 1, 0).applyQuaternion(_q);
    if (_up.y > 0.999) {
      _x.set(1, 0, 0).applyQuaternion(_q);
      const rotation = Math.atan2(-_x.z, _x.x);
      bb.getCenter(_c).applyMatrix4(m.matrixWorld);
      const hy = ((bb.max.y - bb.min.y) * Math.abs(_s.y)) / 2;
      return {
        cx: _c.x, cz: _c.z,
        hx: ((bb.max.x - bb.min.x) * Math.abs(_s.x)) / 2,
        hz: ((bb.max.z - bb.min.z) * Math.abs(_s.z)) / 2,
        minY: _c.y - hy, maxY: _c.y + hy, rotation,
        fullHeight: fullHeight * Math.abs(_s.y),
      };
    }
    // Inclinado: usa a caixa alinhada aos eixos no mundo.
    _box.copy(bb).applyMatrix4(m.matrixWorld);
    return {
      cx: (_box.min.x + _box.max.x) / 2, cz: (_box.min.z + _box.max.z) / 2,
      hx: (_box.max.x - _box.min.x) / 2, hz: (_box.max.z - _box.min.z) / 2,
      minY: _box.min.y, maxY: _box.max.y, rotation: 0, fullHeight: _box.max.y - _box.min.y,
    };
  }

  /** Altura do chão caminhável em (x, z) a partir do terreno (ignora telhados). */
  groundAt(x, z) {
    const base = this.heightField.sample(x, z);
    return this.collision.getGroundHeight(x, z, base + 0.4, 0.4);
  }

  _isFree(x, z, b, radius = 0.5) {
    if (x < b.minX + 1 || x > b.maxX - 1 || z < b.minZ + 1 || z > b.maxZ - 1) return false;
    const gy = this.groundAt(x, z);
    const list = this.collision.queryCircle(x, z, radius, this._tmpList);
    for (const c of list) {
      if (!c.solid) continue;
      if (c.maxY > gy + 0.36 && c.minY < gy + 1.9) return false;
    }
    return true;
  }

  _findSafeSpawn(x, z, b) {
    if (this._isFree(x, z, b)) return { x, y: this.groundAt(x, z), z, adjusted: false };
    for (let r = 1; r <= 40; r++) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (this._isFree(px, pz, b)) return { x: px, y: this.groundAt(px, pz), z: pz, adjusted: true };
      }
    }
    throw new Error('Nenhum ponto de spawn seguro encontrado perto do spawn do manifesto.');
  }

  // ---------------------------------------------- interface de ambiente

  waterDepth() {
    return 0;
  }

  getSurface(x, z) {
    let surface = this.heightField.surfaceAt(x, z);
    const base = this.heightField.sample(x, z);
    let best = base + 0.05;
    const list = this.collision.queryCircle(x, z, 0.01, this._tmpList);
    for (const c of list) {
      if (c.surface && c.walkable && c.maxY > best && c.maxY < base + 3) {
        best = c.maxY;
        surface = c.surface;
      }
    }
    return surface === 'ground' || surface === 'none' ? 'asphalt' : surface;
  }

  boundaryHint(x, z, radius) {
    const b = this.manifest.bounds;
    // Margem maior que a espessura típica de barreiras junto ao limite.
    const m = radius + (this.manifest.boundaryHintMargin ?? 1.6);
    return x < b.minX + m || x > b.maxX - m || z < b.minZ + m || z > b.maxZ - m ? 'closed' : null;
  }

  distanceToShore() {
    return 10000;
  }

  setVisible(v) {
    if (this.root) this.root.visible = v;
  }

  /** Descarrega tudo: geometrias, materiais, texturas, colisões. */
  unload() {
    this.cancel();
    if (this.root) {
      this.scene.remove(this.root);
      const mats = new Set();
      const geos = new Set();
      this.root.traverse((o) => {
        if (!o.isMesh) return;
        geos.add(o.geometry);
        for (const mat of [].concat(o.material)) mats.add(mat);
        if (o.isInstancedMesh) o.dispose();
      });
      for (const g of geos) g.dispose();
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v && v.isTexture) v.dispose();
        mat.dispose();
      }
    }
    this._depthMaterial?.dispose();
    this._depthMaterial = null;
    this.root = null;
    this.collision = null;
    this.heightField = null;
    this._footCache.clear();
  }
}
