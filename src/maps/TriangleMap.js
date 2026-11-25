import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ImportedMap } from './ImportedMap.js';
import { TriangleCollisionSystem } from '../physics/TriangleCollisionSystem.js';
import { cachedFetch, preloadTextures, releaseBlobs } from './mapCache.js';

/** Optional local sector maps: real geometry and independent COL faces.
 * Legacy GLBs continue to use ImportedMap without any behavior changes. */
export class TriangleMap extends ImportedMap {
  async fetch(onProgress = () => {}) {
    this._t0 = performance.now();
    const response = await fetch(this.manifestUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Manifesto indisponível: HTTP ${response.status}`);
    this.manifest = await response.json();
    const m = this.manifest;
    if (!m.bounds || !m.spawn || (!m.file && !m.files)) throw new Error('Manifesto sem limites, spawn ou GLB');
    this.label = m.label || this.id;
    const base = this.manifestUrl.slice(0, this.manifestUrl.lastIndexOf('/') + 1);
    const files = m.files || [m.file], collisions = m.collisionFiles || [m.collisionFile];
    const root = new THREE.Group();
    this._gltf = { scene: root };
    this._collisionBuffers = [];
    this._sharedTextures = new Map();
    this._sharedMaterials = new Map();
    let bytes = 0, parseMs = 0, downloadMs = 0;
    // Setores, colisões e texturas passam pelo cache persistente (mapCache.js) e o
    // setor seguinte é buscado enquanto o atual é interpretado (antes era um por vez).
    const blobs = new Map();
    const download = i => {
      const get = async name => {
        if (!name) return null;
        const res = await cachedFetch(base + name);
        if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
        return res.arrayBuffer();
      };
      const p = Promise.all([get(files[i]), get(collisions[i])])
        .then(async ([buffer, colData]) => [buffer, colData, await preloadTextures(buffer, base, blobs)]);
      p.catch(() => {}); // erro tratado quando o setor for aguardado
      return p;
    };
    let next = files.length ? download(0) : null;
    try {
      for (let i = 0; i < files.length; i++) {
        this._check(); onProgress('download', i / files.length);
        const start = performance.now();
        const [buffer, colData, manager] = await next;
        next = i + 1 < files.length ? download(i + 1) : null;
        bytes += buffer.byteLength;
        downloadMs += performance.now() - start;
        const parsedAt = performance.now();
        const gltf = await new GLTFLoader(manager).parseAsync(buffer, base);
        gltf.scene.traverse(object => {
          const materials = [].concat(object.material || []).map(material => {
            const map = material.map;
            if (map?.name) {
              const shared = this._sharedTextures.get(map.name);
              if (shared && shared !== map) {
                if (map.image !== shared.image) map.image?.close?.();
                map.dispose(); material.map = shared;
              } else this._sharedTextures.set(map.name, map);
            }
            // Identical converted materials share a UUID before the inherited
            // batcher groups meshes, including meshes from different sectors.
            const key = JSON.stringify([material.type, material.color?.getHexString(), material.opacity,
              material.transparent, material.alphaTest, material.side, material.vertexColors,
              material.map?.uuid, material.depthWrite, material.blending, material.toneMapped,
              material.metalness, material.roughness]);
            const shared = this._sharedMaterials.get(key);
            if (shared && shared !== material) { material.dispose(); return shared; }
            this._sharedMaterials.set(key, material); return material;
          });
          if (object.material) object.material = Array.isArray(object.material) ? materials : materials[0];
        });
        root.add(gltf.scene); parseMs += performance.now() - parsedAt;
        if (colData) { this._collisionBuffers.push(colData); bytes += colData.byteLength; }
        // Keep downloading sectors when the tab is in the background. rAF is
        // suspended by browsers there and used to stall the entire city load.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally {
      await next?.catch(() => {});
      releaseBlobs(blobs);
    }
    this._timing = { fileBytes: bytes, downloadMs, parseMs };
    return this;
  }

  process(onProgress = () => {}) {
    const start = performance.now();
    // Reuse mesh instancing/material batching. No visual mesh is replaced by
    // a box; all visual nodes explicitly opt out of automatic box collisions.
    super.process((phase, fraction) => onProgress(phase, fraction * 0.7));
    const col = new TriangleCollisionSystem();
    for (let i = 0; i < this._collisionBuffers.length; i++) col.addBuffer(this._collisionBuffers[i], `${this.id}:${i}`);
    this._collisionBuffers = null;
    this.collision = col;
    this.waterLevel = this.manifest.waterLevel ?? 6;
    const bounds = this.bounds;
    for (const [minX, maxX, minZ, maxZ] of [
      [bounds.minX - 4, bounds.maxX + 4, bounds.minZ - 4, bounds.minZ],
      [bounds.minX - 4, bounds.maxX + 4, bounds.maxZ, bounds.maxZ + 4],
      [bounds.minX - 4, bounds.minX, bounds.minZ, bounds.maxZ],
      [bounds.maxX, bounds.maxX + 4, bounds.minZ, bounds.maxZ],
    ]) col.addAABB({ minX, maxX, minZ, maxZ, minY: -110, maxY: 600, cameraBlocker: false, walkable: false, tags: ['boundary'] });
    const candidates = this.manifest.spawnCandidates || [this.manifest.spawn];
    let chosen = null;
    for (const candidate of candidates) {
      const y = this.groundAt(candidate.x, candidate.z, candidate.y);
      if (y < this.waterLevel || Math.abs(y - candidate.y) > 1.5) continue;
      const pos = { x: candidate.x, z: candidate.z };
      col.resolveCircle(pos, y, 0.4, 1.85, 0.36);
      if (Math.hypot(pos.x - candidate.x, pos.z - candidate.z) > 0.05) continue;
      if (col.getCeilingHeight(pos.x, pos.z, y + 0.1) < y + 1.9) continue;
      chosen = { ...candidate, y, adjusted: candidate !== candidates[0] }; break;
    }
    if (!chosen) throw new Error('O setor não possui spawn seguro entre os pontos convertidos.');
    this.spawnPoint = { ...chosen, id: `${this.id}_spawn` };
    // Water level comes from this installation's water.dat, not a guessed zero.
    const geometry = new THREE.PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: 0x3f8597, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    this.water = new THREE.Mesh(geometry, material);
    this.water.position.set((bounds.minX + bounds.maxX) / 2, this.waterLevel - 0.03, (bounds.minZ + bounds.maxZ) / 2);
    this.water.name = 'VC_WATER'; this.root.add(this.water);
    this.stats.colliders = { total: col.colliders.size, triangles: col.triangleCount, bounds: 4 };
    this.stats.sectors = this.manifest.files?.length || 1;
    this._drawGroups = this.root.children.filter(o => o.isMesh && o !== this.water).map(object => ({ object,
      sphere: object.boundingSphere || object.geometry.boundingSphere }));
    this.stats.drawObjects++;
    this.stats.processMs = Math.round(performance.now() - start);
    this.stats.totalMs = Math.round(performance.now() - this._t0);
    onProgress('done', 1);
    return this;
  }

  groundAt(x, z, referenceY = this.spawnPoint?.y ?? this.manifest.spawn.y) {
    return this.collision.getGroundHeight(x, z, referenceY, 0.4);
  }

  getSurface(x, z, referenceY = this.spawnPoint?.y ?? this.manifest.spawn.y) {
    return this.collision.surfaceAt(x, z, referenceY);
  }

  waterDepth(x, z, referenceY = this.spawnPoint?.y ?? this.manifest.spawn.y) {
    const ground = this.collision.getGroundHeight(x, z, this.waterLevel, 0);
    // Land whose floor is above the water does not turn into a swimming pool.
    const near = this.collision.getGroundHeight(x, z, referenceY, 0.4);
    return near >= this.waterLevel ? 0 : Math.max(0, this.waterLevel - ground);
  }

  distanceToShore(x, z) { return this.waterDepth(x, z) > 0 ? 0 : 100; }

  updateVisibility(position, dt) {
    this._visibilityTimer = (this._visibilityTimer || 0) - dt;
    if (this._visibilityTimer > 0) return;
    this._visibilityTimer = 0.25;
    const range = this.manifest.viewDistance ?? 700;
    let visible = 0;
    for (const { object, sphere } of this._drawGroups || []) {
      object.visible = !sphere || sphere.center.distanceToSquared(position) < (range + sphere.radius) ** 2;
      if (object.visible) visible++;
    }
    if (this.stats) this.stats.distanceVisibleGroups = visible;
  }

  unload() {
    super.unload();
    for (const texture of this._sharedTextures?.values() || []) texture.image?.close?.();
    this._sharedTextures?.clear(); this._gltf = null; this._collisionBuffers = null;
    this._sharedMaterials?.clear();
    this._drawGroups = null;
  }
}
