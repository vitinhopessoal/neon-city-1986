import * as THREE from 'three';

/**
 * Rede viária em estruturas de dados reutilizáveis.
 * Define ruas, faixas (com sentido), vagas de estacionamento, cruzamentos e
 * faixas de pedestres. Os geradores visuais e a futura IA de trânsito
 * consomem exatamente os mesmos dados.
 *
 * Convenção: mão direita (EUA). Faixas com offset positivo (à direita do
 * sentido start→end) seguem o sentido start→end.
 */
export class RoadNetwork {
  constructor() {
    this.roads = new Map();
    this.intersections = new Map();
    this.crosswalks = [];
  }

  addRoad(def) {
    const {
      id, name, start, end, lanesPerDirection = 1, laneWidth = 3.5, medianWidth = 0.4,
      parkingWidth = 0, speedLimit = 13.4, centerLine = 'double-yellow',
    } = def;
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    const dir = { x: dx / length, z: dz / length };
    const right = { x: -dir.z, z: dir.x };
    const driveHalf = medianWidth / 2 + lanesPerDirection * laneWidth;
    const width = 2 * (driveHalf + parkingWidth);
    const road = {
      id, name, start, end, length, dir, right, width, lanesPerDirection, laneWidth,
      medianWidth, parkingWidth, speedLimit, centerLine, driveHalf,
      heading: Math.atan2(dir.x, dir.z),
      lanes: [],
      skipZones: [], // trechos (t0..t1) sem marcação: cruzamentos
    };
    for (let i = 0; i < lanesPerDirection; i++) {
      const off = medianWidth / 2 + laneWidth * (i + 0.5);
      road.lanes.push({ id: `${id}_f${i}`, roadId: id, type: 'drive', offset: off, forward: true, index: i, width: laneWidth });
      road.lanes.push({ id: `${id}_b${i}`, roadId: id, type: 'drive', offset: -off, forward: false, index: i, width: laneWidth });
    }
    if (parkingWidth > 0) {
      const off = driveHalf + parkingWidth / 2;
      road.lanes.push({ id: `${id}_pR`, roadId: id, type: 'parking', offset: off, forward: true, width: parkingWidth });
      road.lanes.push({ id: `${id}_pL`, roadId: id, type: 'parking', offset: -off, forward: false, width: parkingWidth });
    }
    this.roads.set(id, road);
    return road;
  }

  /** control: 'signal' | 'stop' | 'none' */
  addIntersection({ id, x, z, roads, control = 'none', radius = 12 }) {
    const node = { id, x, z, roads, control, radius };
    this.intersections.set(id, node);
    for (const rid of roads) {
      const road = this.roads.get(rid);
      if (!road) continue;
      const t = this.project(road, x, z).t;
      road.skipZones.push({ t0: t - radius, t1: t + radius, intersectionId: id });
    }
    return node;
  }

  /** Faixa de pedestres atravessando a rua no parâmetro t (metros a partir do início). */
  addCrosswalk({ id, roadId, t, length = 3.2 }) {
    const road = this.roads.get(roadId);
    const cw = { id, roadId, t, length };
    this.crosswalks.push(cw);
    road.skipZones.push({ t0: t - length / 2 - 1.2, t1: t + length / 2 + 1.2, crosswalkId: id });
    return cw;
  }

  /** Projeta (x, z) no eixo da rua: t ao longo, s lateral (positivo à direita). */
  project(road, x, z) {
    const px = x - road.start.x, pz = z - road.start.z;
    return { t: px * road.dir.x + pz * road.dir.z, s: px * road.right.x + pz * road.right.z };
  }

  pointAt(road, t, s, out = new THREE.Vector3(), y = 0) {
    return out.set(
      road.start.x + road.dir.x * t + road.right.x * s,
      y,
      road.start.z + road.dir.z * t + road.right.z * s,
    );
  }

  isSkipped(road, t, margin = 0) {
    for (const zn of road.skipZones) if (t >= zn.t0 - margin && t <= zn.t1 + margin) return true;
    return false;
  }

  /** Rua que contém o ponto (com margem lateral opcional). */
  roadAt(x, z, margin = 0) {
    for (const road of this.roads.values()) {
      const { t, s } = this.project(road, x, z);
      if (t >= -margin && t <= road.length + margin && Math.abs(s) <= road.width / 2 + margin) return road;
    }
    return null;
  }

  /** Caminhos de faixa para IA de trânsito (pontos espaçados ao longo da faixa). */
  getLanePaths(spacing = 10) {
    const paths = [];
    for (const road of this.roads.values()) {
      for (const lane of road.lanes) {
        if (lane.type !== 'drive') continue;
        const pts = [];
        const n = Math.max(1, Math.ceil(road.length / spacing));
        for (let i = 0; i <= n; i++) {
          const t = (i / n) * road.length;
          pts.push(this.pointAt(road, t, lane.offset, new THREE.Vector3(), 0.02));
        }
        if (!lane.forward) pts.reverse();
        paths.push({ id: lane.id, roadId: road.id, points: pts, speedLimit: road.speedLimit, forward: lane.forward });
      }
    }
    return paths;
  }

  /** Vagas paralelas ao longo das faixas de estacionamento. */
  getParkingSpots(spotLength = 6.2, bounds = null) {
    const spots = [];
    for (const road of this.roads.values()) {
      for (const lane of road.lanes) {
        if (lane.type !== 'parking') continue;
        for (let t = spotLength; t < road.length - spotLength; t += spotLength) {
          if (this.isSkipped(road, t, spotLength * 0.5)) continue;
          const p = this.pointAt(road, t, lane.offset);
          if (bounds && (p.x < bounds.minX || p.x > bounds.maxX || p.z < bounds.minZ || p.z > bounds.maxZ)) continue;
          spots.push({
            id: `${lane.id}_${Math.round(t)}`,
            roadId: road.id,
            laneId: lane.id,
            x: p.x,
            z: p.z,
            heading: lane.forward ? road.heading : road.heading + Math.PI,
            occupied: false,
          });
        }
      }
    }
    return spots;
  }
}
