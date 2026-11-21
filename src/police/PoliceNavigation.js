import * as THREE from 'three';
import { laneRoute } from '../city/Navigation.js';
import { Path } from '../traffic/LaneGraph.js';

const p = new THREE.Vector3(), direction = new THREE.Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Opaque map geometry blocks perception and bullets. Ignore the observer's
 * vehicle and the suspect's car (windows), never a building or a wall. */
export function lineOfSight(collision, from, to, ignoreOwners = []) {
  const length = direction.subVectors(to, from).length();
  if (length < 0.01) return true;
  direction.divideScalar(length);
  for (const c of collision._gather(Math.min(from.x, to.x), Math.min(from.z, to.z), Math.max(from.x, to.x), Math.max(from.z, to.z))) {
    if (c.solid === false || ignoreOwners.includes(c.ownerId)) continue;
    const t = collision._rayBox(c, from, direction, 0.03, length);
    if (t >= 0 && t < length - 0.25) return false;
  }
  return true;
}

/** Routes are made of real drive lanes and intersection connectors. */
export function roadRoute(graph, position, heading, target) {
  const start = graph.segments.filter(s => !s.sink).map(segment => {
    const projection = segment.path.project(position);
    const dot = segment.dir.x * Math.sin(heading) + segment.dir.z * Math.cos(heading);
    return { segment, projection, cost: projection.dist + (1 - dot) * 8 };
  }).sort((a, b) => a.cost - b.cost)[0];
  if (!start) return null;
  const goals = graph.segments.filter(s => !s.sink).map(segment => ({ segment, projection: segment.path.project(target) }))
    .sort((a, b) => a.projection.dist - b.projection.dist);
  for (const goal of goals.slice(0, 10)) {
    let route = laneRoute(start.segment, goal.segment);
    if (!route) continue;
    if (!route.length && goal.projection.s < start.projection.s + 2) {
      const cycles = start.segment.out.map(c => {
        const rest = laneRoute(c.to, goal.segment);
        return rest ? [c, ...rest] : null;
      }).filter(Boolean).sort((a, b) => a.length - b.length);
      if (!cycles.length) continue;
      route = cycles[0];
    }
    const points = [];
    const sample = (path, begin, end) => {
      for (let s = begin; s < end; s += 3) points.push(path.sample(s, new THREE.Vector3()));
      points.push(path.sample(end, new THREE.Vector3()));
    };
    sample(start.segment.path, start.projection.s, route.length ? start.segment.path.length : goal.projection.s);
    for (let i = 0; i < route.length; i++) {
      sample(route[i].path, 0, route[i].path.length);
      const segment = route[i].to;
      sample(segment.path, 0, i === route.length - 1 ? goal.projection.s : segment.path.length);
    }
    if (points.length > 1) return new Path(points);
  }
  return null;
}

/** Bounded local A*: collision and water checks on each cell and edge. */
export function footRoute(env, from, target, limit = 700) {
  const step = 2, radius = 42, col = env.collision;
  const key = (x, z) => `${x},${z}`;
  const nodes = new Map(), closed = new Set();
  const endX = Math.round((target.x - from.x) / step), endZ = Math.round((target.z - from.z) / step);
  const dist = Math.hypot(endX, endZ), max = radius / step;
  const tx = dist > max ? Math.round(endX * max / dist) : endX;
  const tz = dist > max ? Math.round(endZ * max / dist) : endZ;
  const make = (ix, iz) => {
    const x = from.x + ix * step, z = from.z + iz * step;
    const y = col.getGroundHeight(x, z, from.y + 0.5, 0.36);
    if (Math.abs(y - from.y) > 1.2 || env.waterDepth?.(x, z) > 0.1 || env.boundaryHint?.(x, z, 0.4)) return null;
    const test = { x, z }; col.resolveCircle(test, y, 0.34, 1.8, 0.36);
    if (Math.hypot(test.x - x, test.z - z) > 0.08) return null;
    return { x, y, z, ix, iz, g: Infinity, f: Infinity, previous: null };
  };
  const start = { x: from.x, y: from.y, z: from.z, ix: 0, iz: 0, g: 0, f: dist, previous: null };
  nodes.set('0,0', start);
  const open = [start]; let best = start, bestD = Infinity;
  while (open.length && closed.size < limit) {
    open.sort((a, b) => a.f - b.f);
    const at = open.shift(), id = key(at.ix, at.iz);
    if (closed.has(id)) continue;
    closed.add(id);
    const h = Math.hypot(at.ix - tx, at.iz - tz);
    if (h < bestD) { bestD = h; best = at; }
    if (h < 1) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ix = at.ix + dx, iz = at.iz + dz, k = key(ix, iz);
      if (Math.hypot(ix, iz) > max + 2 || closed.has(k)) continue;
      let next = nodes.get(k);
      if (!next) { next = make(ix, iz); if (!next) continue; nodes.set(k, next); }
      const a = p.set(at.x, at.y + 0.8, at.z), b = new THREE.Vector3(next.x, next.y + 0.8, next.z);
      const len = direction.subVectors(b, a).length(); direction.divideScalar(len || 1);
      if (col.sphereCast(a, direction, len, 0.32, 'solid') < len - 0.05) continue;
      const cost = at.g + Math.hypot(dx, dz);
      if (cost < next.g) {
        next.previous = at; next.g = cost; next.f = cost + Math.hypot(ix - tx, iz - tz);
        open.push(next);
      }
    }
  }
  const path = [];
  for (let at = best; at && at !== start; at = at.previous) path.push(new THREE.Vector3(at.x, at.y, at.z));
  return path.reverse();
}

export function driveTo(vehicle, path, targetSpeed, dt, obstacles, aggressive = false) {
  const ph = vehicle.physics, c = vehicle.controls, H = ph.H;
  if (!path) { c.throttle = 0; c.brake = 1; c.handbrake = true; return; }
  p.set(ph.x, 0, ph.z);
  const projection = path.project(p), look = clamp(4.5 + Math.abs(ph.vLong) * 0.5, 4.5, 13);
  path.sample(projection.s + look, p);
  const dx = p.x - ph.x, dz = p.z - ph.z, sin = Math.sin(ph.heading), cos = Math.cos(ph.heading);
  const fwd = dx * sin + dz * cos, left = dx * cos - dz * sin;
  const alpha = Math.atan2(left, Math.max(0.3, fwd));
  const delta = Math.atan2(2 * ph.L * Math.sin(alpha), look);
  c.steer = clamp(-delta * (1 + Math.abs(ph.vLong) * H.steerSpeedFalloff) / H.steerMax, -1, 1);
  let speed = Math.min(targetSpeed, Math.max(4, targetSpeed / (1 + Math.abs(alpha) * 3)));
  speed = Math.min(speed, Math.sqrt(Math.max(0, path.length - projection.s - 1) * 5));
  for (const obstacle of obstacles) {
    if (obstacle === vehicle || !obstacle.root.visible || (aggressive && obstacle.driver === 'player')) continue;
    const ox = obstacle.root.position.x - ph.x, oz = obstacle.root.position.z - ph.z;
    const ahead = ox * sin + oz * cos, side = Math.abs(ox * cos - oz * sin);
    if (ahead > 0 && ahead < 4 + Math.abs(ph.vLong) * 1.1 && side < 2) {
      if (aggressive && obstacle.driver === 'ai' && ahead > 2.2 && ahead < 18) {
        // Ultrapassagem de emergência pelo lado livre (esterço + colisões; nunca atravessa).
        // Antes: só entre 5 e 18 m e sempre para a esquerda — um civil cedendo à sirene a
        // menos de 5 m travava a viatura para sempre.
        const obstacleLeft = ox * cos - oz * sin;
        c.steer = clamp(c.steer + (obstacleLeft > 0 ? 0.55 : -0.55), -1, 1);
        speed = Math.min(speed, ahead > 5 ? 6 : 2.5);
      } else speed = Math.min(speed, Math.max(0, (ahead - 5) * 0.8));
    }
  }
  const error = speed - ph.vLong;
  c.handbrake = false;
  c.throttle = speed > 0.2 && error > 0 ? clamp(error * 0.5 + 0.1, 0, 1) : 0;
  c.brake = error < -0.3 ? clamp(-error * 0.4, 0, 1) : speed < 0.2 ? 1 : 0;
  ph.wake();
}
