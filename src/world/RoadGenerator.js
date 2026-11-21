import * as THREE from 'three';
import { groundPlane, composeMatrix, UNIT } from '../render/StaticBatcher.js';

/**
 * Gera a malha das ruas (asfalto + sinalização horizontal) a partir do
 * RoadNetwork, e as lajes de calçada/lotes (com meio-fio e colisão).
 */
const PLANE_XZ = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();

export const SIDEWALK_HEIGHT = 0.15;

function addMark(batcher, mat, road, network, t, s, lenT, widthS, y = 0.012) {
  network.pointAt(road, t, s, _p, y);
  composeMatrix(_p.x, y, _p.z, 0, road.heading, 0, widthS, 1, lenT, _m);
  batcher.add(PLANE_XZ, mat, _m, null, { castShadow: false, receiveShadow: true });
}

/** Intervalos [t0, t1] do eixo que não caem em zonas sem marcação. */
function freeIntervals(road, from = 0, to = road.length) {
  const zones = [...road.skipZones].sort((a, b) => a.t0 - b.t0);
  const out = [];
  let cur = from;
  for (const z of zones) {
    if (z.t1 < cur) continue;
    if (z.t0 > cur) out.push([cur, Math.min(z.t0, to)]);
    cur = Math.max(cur, z.t1);
    if (cur >= to) break;
  }
  if (cur < to) out.push([cur, to]);
  return out.filter(([a, b]) => b - a > 0.5);
}

export function buildRoads(network, batcher, lib, { visibleBounds = null } = {}) {
  const m = lib.m;
  for (const road of network.roads.values()) {
    // Asfalto.
    const mid = network.pointAt(road, road.length / 2, 0, new THREE.Vector3());
    // Ladrilho de 8 m (textura HD de asfalto desenhada para essa escala).
    const g = groundPlane(road.width, road.length, 8, 1, Math.max(1, Math.round(road.length / 40)));
    composeMatrix(mid.x, 0, mid.z, 0, road.heading, 0, 1, 1, 1, _m);
    batcher.add(g, m.asphalt, _m, null, { castShadow: false, receiveShadow: true });
    g.dispose();

    const inside = (t) => {
      if (!visibleBounds) return true;
      network.pointAt(road, t, 0, _p);
      return _p.x > visibleBounds.minX && _p.x < visibleBounds.maxX && _p.z > visibleBounds.minZ && _p.z < visibleBounds.maxZ;
    };

    const intervals = freeIntervals(road);
    const centerOff = road.medianWidth > 0.6 ? road.medianWidth / 2 - 0.12 : 0.14;
    for (const [t0, t1] of intervals) {
      const len = t1 - t0, tc = (t0 + t1) / 2;
      // Linha central dupla amarela.
      addMark(batcher, m.lineYellow, road, network, tc, centerOff, len, 0.12);
      addMark(batcher, m.lineYellow, road, network, tc, -centerOff, len, 0.12);
      // Linhas de borda entre faixa de rolamento e estacionamento.
      const edge = road.parkingWidth > 0 ? road.driveHalf : road.driveHalf - 0.25;
      addMark(batcher, m.lineWhite, road, network, tc, edge, len, 0.14);
      addMark(batcher, m.lineWhite, road, network, tc, -edge, len, 0.14);
      // Divisórias tracejadas entre faixas do mesmo sentido.
      for (let i = 1; i < road.lanesPerDirection; i++) {
        const s = road.medianWidth / 2 + road.laneWidth * i;
        for (let t = t0 + 2; t + 3 < t1; t += 9) {
          if (!inside(t)) continue;
          addMark(batcher, m.lineWhite, road, network, t + 1.5, s, 3, 0.12);
          addMark(batcher, m.lineWhite, road, network, t + 1.5, -s, 3, 0.12);
        }
      }
      // Marcas de vagas.
      if (road.parkingWidth > 0) {
        for (let t = t0 + 3.1; t < t1 - 1; t += 6.2) {
          if (!inside(t)) continue;
          for (const sign of [1, -1]) {
            const s = sign * (road.driveHalf + road.parkingWidth * 0.5);
            addMark(batcher, m.lineWhite, road, network, t, s, 0.12, road.parkingWidth - 0.1);
          }
        }
      }
    }

    // Faixas de pedestres e linhas de retenção.
    for (const cw of network.crosswalks) {
      if (cw.roadId !== road.id) continue;
      const n = Math.floor((road.width - 1.2) / 1.15);
      for (let i = 0; i < n; i++) {
        const s = -road.width / 2 + 0.9 + i * 1.15 + 0.28;
        addMark(batcher, m.lineWhite, road, network, cw.t, s, cw.length, 0.55, 0.013);
      }
      if (cw.stopLine) {
        const dirSign = cw.stopLine === 'forward' ? 1 : -1;
        const t = cw.t - dirSign * (cw.length / 2 + 1.1);
        const s0 = road.medianWidth / 2, s1 = road.driveHalf;
        addMark(batcher, m.lineWhite, road, network, t, dirSign * (s0 + s1) / 2, 0.45, s1 - s0, 0.013);
      }
    }
  }
}

/**
 * Laje de quarteirão / calçada elevada com meio-fio.
 * material: 'sidewalk' | 'pavers'
 */
export function buildSlab(slab, batcher, lib, collision, terrain) {
  const { id, minX, maxX, minZ, maxZ, material = 'sidewalk', tile = 3, surface = 'concrete', curbs = { n: true, s: true, e: true, w: true } } = slab;
  const w = maxX - minX, d = maxZ - minZ;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const h = SIDEWALK_HEIGHT;
  const top = groundPlane(w, d, tile, Math.max(1, Math.round(w / 30)), Math.max(1, Math.round(d / 30)));
  composeMatrix(cx, h, cz, 0, 0, 0, 1, 1, 1, _m);
  batcher.add(top, lib.m[material], _m, null, { castShadow: false, receiveShadow: true });
  top.dispose();

  // Meio-fio (faces laterais visíveis).
  const ct = 0.3;
  const curbMat = lib.m.curb;
  const ch = h + 0.25;
  if (curbs.n) { composeMatrix(cx, h - ch / 2 + 0.006, minZ + ct / 2, 0, 0, 0, w, ch, ct, _m); batcher.add(UNIT.box, curbMat, _m, null, { castShadow: false }); }
  if (curbs.s) { composeMatrix(cx, h - ch / 2 + 0.006, maxZ - ct / 2, 0, 0, 0, w, ch, ct, _m); batcher.add(UNIT.box, curbMat, _m, null, { castShadow: false }); }
  if (curbs.w) { composeMatrix(minX + ct / 2, h - ch / 2 + 0.006, cz, 0, 0, 0, ct, ch, d, _m); batcher.add(UNIT.box, curbMat, _m, null, { castShadow: false }); }
  if (curbs.e) { composeMatrix(maxX - ct / 2, h - ch / 2 + 0.006, cz, 0, 0, 0, ct, ch, d, _m); batcher.add(UNIT.box, curbMat, _m, null, { castShadow: false }); }

  collision.addAABB({
    id: `${id}_slab`, ownerId: id, minX, maxX, minZ, maxZ, minY: -1, maxY: h,
    solid: true, walkable: true, cameraBlocker: false, surface,
  });
  terrain.addSurfaceZone(minX, minZ, maxX, maxZ, surface, 1);
}

/** Sobreposição plana sobre uma laje (grama, asfalto do estacionamento). */
export function buildOverlay(rect, batcher, lib, terrain, { material, tile = 4, surface, priority = 2, y = SIDEWALK_HEIGHT + 0.004 }) {
  const w = rect.maxX - rect.minX, d = rect.maxZ - rect.minZ;
  const g = groundPlane(w, d, tile);
  composeMatrix((rect.minX + rect.maxX) / 2, y, (rect.minZ + rect.maxZ) / 2, 0, 0, 0, 1, 1, 1, _m);
  batcher.add(g, lib.m[material], _m, null, { castShadow: false, receiveShadow: true });
  g.dispose();
  if (surface) terrain.addSurfaceZone(rect.minX, rect.minZ, rect.maxX, rect.maxZ, surface, priority);
}

/** Linha pintada horizontal (estacionamentos). */
export function paintLine(batcher, lib, x, z, lenX, lenZ, y = SIDEWALK_HEIGHT + 0.012, color = 'lineWhite') {
  composeMatrix(x, y, z, 0, 0, 0, lenX, 1, lenZ, _m);
  batcher.add(PLANE_XZ, lib.m[color], _m, null, { castShadow: false });
}
