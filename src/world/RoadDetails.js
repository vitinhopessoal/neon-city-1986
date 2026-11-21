import * as THREE from 'three';
import { composeMatrix } from '../render/StaticBatcher.js';
import { createRng } from '../utils/math.js';
import { SIDEWALK_HEIGHT } from './RoadGenerator.js';

/**
 * Detalhes viários sobre a malha de ruas existente (não altera asfalto,
 * faixas nem colisões das calçadas):
 *  - sarjetas de concreto junto ao meio-fio e grelhas de drenagem
 *  - bueiros e tampas de serviço
 *  - setas de faixa antes dos cruzamentos (conforme as conversões possíveis)
 *  - remendos, manchas de óleo e rachaduras
 *  - rampas de acessibilidade com piso tátil nas faixas de pedestres
 *
 * Tudo usa o atlas de decalques (um único material transparente) e é fundido
 * pelo StaticBatcher. Um gerador aleatório próprio mantém o restante da
 * cidade inalterado.
 */
const PLANE_XZ = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();

const TILE = {
  manhole: 0, grate: 1, arrowStraight: 2, arrowRight: 3, arrowLeft: 4, arrowStraightRight: 5,
  patch: 6, oil: 7, tactile: 8, gutter: 9, crack: 10, utility: 11,
};

/** Cunha unitária: sobe de y=0 (x=-0.5) até y=1 (x=+0.5). */
function wedgeGeometry() {
  const v = [];
  const quad = (a, b, c, d) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
  const tri = (a, b, c) => v.push(...a, ...b, ...c);
  const A = [-0.5, 0, -0.5], B = [-0.5, 0, 0.5], C = [0.5, 1, 0.5], D = [0.5, 1, -0.5];
  const E = [0.5, 0, 0.5], F = [0.5, 0, -0.5];
  quad(A, B, C, D);          // rampa
  quad(F, D, C, E);          // face alta (encostada no meio-fio)
  tri(B, E, C);              // lateral +z
  tri(A, D, F);              // lateral -z
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
const WEDGE = wedgeGeometry();

/** Direções dos braços (outras ruas) que saem de um cruzamento. */
function intersectionArms(network, node, road) {
  const arms = [];
  for (const r of network.roads.values()) {
    if (r === road) continue;
    const { t, s } = network.project(r, node.x, node.z);
    if (Math.abs(s) > 3 || t < -node.radius * 3 || t > r.length + node.radius * 3) continue;
    if (t > 1) arms.push({ x: -r.dir.x, z: -r.dir.z });
    if (t < r.length - 1) arms.push({ x: r.dir.x, z: r.dir.z });
  }
  return arms;
}

export function buildRoadDetails(network, batcher, lib, collision, { visibleBounds = null, seed = 7331 } = {}) {
  const rng = createRng(seed);
  const decal = lib.m.roadDecal;
  const stats = { decals: 0, ramps: 0 };

  const put = (tile, x, y, z, ry, sx, sz) => {
    composeMatrix(x, y, z, 0, ry, 0, sx, 1, sz, _m);
    batcher.add(PLANE_XZ, decal, _m, null, { castShadow: false, receiveShadow: true, uvTile: lib.decalTile(tile) });
    stats.decals++;
  };
  /** Decalque no referencial da rua (t ao longo, s lateral). flip: topo da célula aponta para +t. */
  const onRoad = (road, tile, t, s, lenT, widthS, { flip = false, rot = 0, y = 0.008 } = {}) => {
    network.pointAt(road, t, s, _p);
    put(tile, _p.x, y, _p.z, road.heading + (flip ? Math.PI : 0) + rot, widthS, lenT);
  };
  const inside = (road, t) => {
    if (!visibleBounds) return true;
    network.pointAt(road, t, 0, _p);
    return _p.x > visibleBounds.minX && _p.x < visibleBounds.maxX && _p.z > visibleBounds.minZ && _p.z < visibleBounds.maxZ;
  };
  const free = (road, t, margin) => !network.isSkipped(road, t, margin);

  for (const road of network.roads.values()) {
    const edge = road.width / 2;

    // --- Sarjetas (segmentos de 4 m com juntas) e grelhas de drenagem.
    const segL = 4;
    for (let t = segL / 2; t < road.length; t += segL) {
      if (!inside(road, t) || !free(road, t, segL / 2)) continue;
      for (const side of [1, -1]) onRoad(road, TILE.gutter, t, side * (edge - 0.24), segL, 0.48, { y: 0.006 });
    }
    for (let t = 15; t < road.length; t += 32) {
      if (!inside(road, t) || !free(road, t, 1.5)) continue;
      for (const side of [1, -1]) onRoad(road, TILE.grate, t + side * 4, side * (edge - 0.3), 1.0, 1.0, { rot: Math.PI / 2, y: 0.01 });
    }

    // --- Bueiros (centro das faixas, alternando) e tampas de serviço.
    let k = 0;
    for (let t = 20 + rng.range(0, 10); t < road.length; t += 34 + rng.range(-6, 8), k++) {
      if (!inside(road, t) || !free(road, t, 1)) continue;
      const lane = road.lanes[k % road.lanes.length];
      if (lane.type !== 'drive') continue;
      onRoad(road, TILE.manhole, t, lane.offset + rng.range(-0.4, 0.4), 0.9, 0.9, { y: 0.01 });
    }
    if (road.parkingWidth > 0) {
      for (let t = 40 + rng.range(0, 20); t < road.length; t += 55 + rng.range(-10, 15)) {
        if (!inside(road, t) || !free(road, t, 1)) continue;
        const side = rng.chance(0.5) ? 1 : -1;
        onRoad(road, TILE.utility, t, side * (road.driveHalf + road.parkingWidth * 0.45), 0.8, 0.8, { y: 0.01 });
      }
    }

    // --- Desgaste: remendos, rachaduras e manchas de óleo.
    for (let t = rng.range(5, 20); t < road.length; t += rng.range(14, 30)) {
      if (!inside(road, t) || !free(road, t, 3)) continue;
      const lane = rng.pick(road.lanes.filter((l) => l.type === 'drive'));
      const w = Math.min(lane.width - 0.8, rng.range(1.2, 2.6));
      onRoad(road, TILE.patch, t, lane.offset + rng.range(-0.3, 0.3), rng.range(1.6, 3.6), w, { rot: rng.chance(0.5) ? 0 : Math.PI, y: 0.007 });
    }
    for (let t = rng.range(3, 12); t < road.length; t += rng.range(10, 22)) {
      if (!inside(road, t) || !free(road, t, 3)) continue;
      const lane = rng.pick(road.lanes);
      onRoad(road, TILE.crack, t, lane.offset + rng.range(-0.8, 0.8), rng.range(1.2, 2.4), rng.range(2.5, 4.2), { rot: Math.PI / 2 + rng.range(-0.6, 0.6), y: 0.009 });
    }
    for (let t = rng.range(2, 8); t < road.length; t += rng.range(6, 14)) {
      if (!inside(road, t) || !free(road, t, 1.5)) continue;
      const lane = rng.pick(road.lanes);
      const sz = rng.range(0.8, 1.8);
      onRoad(road, TILE.oil, t, lane.offset + rng.range(-0.25, 0.25), sz * rng.range(1, 1.6), sz, { y: 0.009 });
    }

    // --- Setas antes dos cruzamentos (de acordo com os braços existentes).
    for (const zone of road.skipZones) {
      if (!zone.intersectionId) continue;
      const node = network.intersections.get(zone.intersectionId);
      const arms = intersectionArms(network, node, road);
      for (const dirSign of [1, -1]) {
        // Início da aproximação: antes de faixas de pedestres coladas ao cruzamento.
        let start = dirSign > 0 ? zone.t0 : zone.t1;
        for (let guard = 0; guard < 4; guard++) {
          const probe = start - dirSign * 4;
          const z2 = road.skipZones.find((z) => z !== zone && probe >= z.t0 && probe <= z.t1);
          if (!z2) break;
          start = dirSign > 0 ? z2.t0 : z2.t1;
        }
        const tc = start - dirSign * 8;
        if (tc < 4 || tc > road.length - 4 || !inside(road, tc)) continue;
        const d = { x: road.dir.x * dirSign, z: road.dir.z * dirSign };
        const right = { x: -d.z, z: d.x };
        let hasRight = false, hasLeft = false;
        for (const a of arms) {
          const dot = a.x * right.x + a.z * right.z;
          if (dot > 0.5) hasRight = true;
          if (dot < -0.5) hasLeft = true;
        }
        const n = road.lanesPerDirection;
        for (let i = 0; i < n; i++) {
          let tile = null;
          if (n > 1) {
            if (i === n - 1) tile = hasRight ? TILE.arrowStraightRight : TILE.arrowStraight;
            else if (i === 0) tile = hasLeft ? TILE.arrowLeft : TILE.arrowStraight;
            else tile = TILE.arrowStraight;
          } else if (hasRight !== hasLeft) {
            tile = hasRight ? TILE.arrowStraightRight : null;
          }
          if (tile === null) continue;
          const s = dirSign * (road.medianWidth / 2 + road.laneWidth * (i + 0.5));
          onRoad(road, tile, tc, s, 5.2, 1.7, { flip: dirSign > 0, y: 0.014 });
        }
      }
    }
  }

  // --- Rampas de acessibilidade + piso tátil nas pontas das faixas de pedestres.
  const curb = lib.m.curb;
  const h = SIDEWALK_HEIGHT + 0.006;
  for (const cw of network.crosswalks) {
    const road = network.roads.get(cw.roadId);
    const edge = road.width / 2;
    const width = Math.min(cw.length, 3) - 0.3;
    for (const side of [1, -1]) {
      const out = { x: road.right.x * side, z: road.right.z * side };
      const ry = Math.atan2(-out.z, out.x);
      const run = 0.9;
      network.pointAt(road, cw.t, side * (edge - run / 2), _p);
      composeMatrix(_p.x, 0, _p.z, 0, ry, 0, run, h, width, _m);
      batcher.add(WEDGE, curb, _m, 0xffffff, { castShadow: false, receiveShadow: true });
      collision.addRamp({
        id: `ramp_${cw.id}_${side > 0 ? 'r' : 'l'}`, ownerId: cw.id,
        cx: _p.x, cz: _p.z, hx: run / 2, hz: width / 2, rotation: ry, y0: 0, y1: h,
      });
      // Piso tátil logo após o meio-fio.
      network.pointAt(road, cw.t, side * (edge + 0.42), _p);
      put(TILE.tactile, _p.x, h + 0.008, _p.z, road.heading, 0.6, width);
      stats.ramps++;
    }
  }
  return stats;
}
