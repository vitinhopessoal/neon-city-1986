import * as THREE from 'three';
import { CollisionSystem } from './CollisionSystem.js';

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const point = new THREE.Vector3(), nearest = new THREE.Vector3(), ray = new THREE.Ray(), tri = new THREE.Triangle();
const SURFACES = { 0: 'asphalt', 1: 'asphalt', 2: 'grass', 3: 'dirt', 4: 'dirt', 5: 'concrete', 7: 'glass', 18: 'sand', 19: 'water', 20: 'wood', 21: 'wood' };

/** Actual COL faces, with a vertical query selecting the floor below the feet.
 * A bridge's deck never replaces the road under it. Dynamic boxes/cylinders
 * (vehicles) continue to use CollisionSystem's original solver. */
export class TriangleCollisionSystem extends CollisionSystem {
  constructor() {
    super({ cellSize: 12 });
    this.triangleCount = 0;
    this.fallback = null;
    this.setTerrain((x, z) => this.fallbackHeight(x, z));
  }

  /**
   * Chão para os pontos sem nenhuma face COL embaixo. O conversor só gera o chão
   * das ilhas: o mar inteiro e algumas falhas em terra ficavam sem colisão, e tudo
   * caía até o plano de segurança em y = -100 ("limbo"). Aqui o mapa é rasterizado
   * numa grade de células: onde o radar (isWater) mostra água, o buraco vira fundo
   * do mar (waterLevel - seaDepth); onde mostra terra, recebe a altura do chão mais
   * próximo. Sem radar, a água é deduzida pela ligação com a borda do mapa.
   * As faces reais continuam tendo prioridade sobre este preenchimento.
   */
  buildFallback({ bounds, waterLevel, cell = 4, seaDepth = 6, isWater = null }) {
    const seabed = waterLevel - seaDepth;
    const minX = bounds.minX, minZ = bounds.minZ;
    const w = Math.max(1, Math.ceil((bounds.maxX - minX) / cell)), d = Math.max(1, Math.ceil((bounds.maxZ - minZ) / cell));
    const n = w * d, low = new Float32Array(n).fill(NaN);
    // Chão mais baixo no centro de cada célula (ignora telhados sobre a rua).
    for (const record of this.colliders.values()) {
      if (record.type !== 'tri' || !record.walkable) continue;
      const v = record.vertices;
      const i0 = Math.max(0, Math.ceil((Math.min(v[0], v[3], v[6]) - minX) / cell - 0.5));
      const i1 = Math.min(w - 1, Math.floor((Math.max(v[0], v[3], v[6]) - minX) / cell - 0.5));
      const j0 = Math.max(0, Math.ceil((Math.min(v[2], v[5], v[8]) - minZ) / cell - 0.5));
      const j1 = Math.min(d - 1, Math.floor((Math.max(v[2], v[5], v[8]) - minZ) / cell - 0.5));
      for (let j = j0; j <= j1; j++) {
        const z = minZ + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const y = this._height(record, minX + (i + 0.5) * cell, z);
          const k = j * w + i;
          if (y !== null && !(low[k] <= y)) low[k] = y;
        }
      }
    }
    const kind = new Uint8Array(n); // 0 chão, 1 mar, 2 buraco em terra
    const queue = new Int32Array(n);
    const regions = [];
    let head = 0, tail = 0;
    const neighbors = (k, fn) => {
      const i = k % w;
      if (i > 0) fn(k - 1); if (i < w - 1) fn(k + 1);
      if (k >= w) fn(k - w); if (k < n - w) fn(k + w);
    };
    if (isWater) {
      // Radar do mapa (fonte confiável): cada buraco é mar ou terra pelo que o radar mostra.
      for (let k = 0; k < n; k++) {
        if (!Number.isNaN(low[k])) continue;
        kind[k] = isWater(minX + (k % w + 0.5) * cell, minZ + (Math.floor(k / w) + 0.5) * cell) ? 1 : 2;
      }
    } else {
      // Sem radar: mar = buracos alcançáveis a partir da borda do mapa.
      const seed = k => { if (Number.isNaN(low[k]) && !kind[k]) { kind[k] = 1; queue[tail++] = k; } };
      for (let i = 0; i < w; i++) { seed(i); seed((d - 1) * w + i); }
      for (let j = 0; j < d; j++) { seed(j * w); seed(j * w + w - 1); }
      while (head < tail) neighbors(queue[head++], seed);
      // Regiões fechadas (pontes e cais cercam baías inteiras): é água quando a região
      // é grande e a margem fica perto do nível do mar; senão é falha em terra firme.
      for (let s = 0; s < n; s++) {
        if (!Number.isNaN(low[s]) || kind[s]) continue;
        const start = tail; kind[s] = 3; queue[tail++] = s;
        const border = [];
        for (let q = start; q < tail; q++) {
          neighbors(queue[q], m => {
            if (!Number.isNaN(low[m])) { if (border.length < 4096) border.push(low[m]); return; }
            if (!kind[m]) { kind[m] = 3; queue[tail++] = m; }
          });
        }
        border.sort((p, q) => p - q);
        const median = border.length ? border[border.length >> 1] : seabed;
        const water = tail - start >= 64 && median < waterLevel + 2;
        for (let q = start; q < tail; q++) kind[queue[q]] = water ? 1 : 2;
        regions.push({ cells: tail - start, water, median });
      }
    }
    // Falhas em terra: cada uma vira um piso plano na altura MAIS BAIXA da sua
    // borda que fique acima da água — a rua, nunca o telhado de um prédio vizinho
    // nem um túnel/fundo do mar encostado. Sem borda seca, usa a mais alta.
    const height = new Float32Array(n);
    for (let k = 0; k < n; k++) height[k] = kind[k] ? seabed : low[k];
    const done = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      if (kind[s] !== 2 || done[s]) continue;
      head = tail = 0; queue[tail++] = s; done[s] = 1;
      let dry = Infinity, wet = -Infinity;
      while (head < tail) {
        neighbors(queue[head++], m => {
          if (kind[m] === 2) { if (!done[m]) { done[m] = 1; queue[tail++] = m; } return; }
          if (kind[m]) return;
          const y = low[m];
          if (y >= waterLevel - 0.5) { if (y < dry) dry = y; } else if (y > wet) wet = y;
        });
      }
      const fill = dry < Infinity ? dry : wet > -Infinity ? wet : seabed;
      for (let q = 0; q < tail; q++) height[queue[q]] = fill;
    }
    let sea = 0, gaps = 0;
    for (let k = 0; k < n; k++) { if (kind[k] === 1) sea++; else if (kind[k] === 2) gaps++; }
    this.fallback = { minX, minZ, cell, w, d, height, seabed };
    return { cells: n, seaCells: sea, landGaps: gaps, source: isWater ? 'radar' : 'conectividade',
      enclosedWater: regions.filter(r => r.water).length, seabed };
  }

  fallbackHeight(x, z) {
    const f = this.fallback;
    if (!f) return -100;
    const i = Math.floor((x - f.minX) / f.cell), j = Math.floor((z - f.minZ) / f.cell);
    if (i < 0 || j < 0 || i >= f.w || j >= f.d) return f.seabed;
    return f.height[j * f.w + i];
  }

  /** Faces reais primeiro; o preenchimento só vale onde não há chão nenhum embaixo. */
  getGroundHeight(x, z, feetY, stepHeight) {
    const limit = feetY + stepHeight;
    let best = -Infinity;
    const list = this._gather(x - 0.01, z - 0.01, x + 0.01, z + 0.01);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.walkable) continue;
      const top = this._topAt(c, x, z);
      if (top !== null && top <= limit && top > best) best = top;
    }
    if (best > -Infinity) return best;
    // Preenchimento muito acima do corpo (só existe uma estrutura alta ali, sem
    // chão embaixo): não puxa ninguém para cima — trata como fundo do mar.
    const fill = this.terrainHeight(x, z);
    return fill <= limit + 2 || !this.fallback ? fill : this.fallback.seabed;
  }

  addBuffer(buffer, prefix = 'col') {
    const view = new DataView(buffer);
    if (view.byteLength < 8 || view.getUint32(0, true) !== 0x31434356) throw new Error('Invalid VCC1 collision file');
    const count = view.getUint32(4, true);
    if (view.byteLength !== 8 + count * 40) throw new Error('Truncated VCC1 collision file');
    for (let i = 0, offset = 8; i < count; i++, offset += 40) {
      const vertices = Array.from({ length: 9 }, (_, k) => view.getFloat32(offset + k * 4, true));
      if (!vertices.every(Number.isFinite)) throw new Error(`Invalid COL vertex ${i}`);
      const material = view.getUint16(offset + 36, true);
      if (view.getUint16(offset + 38, true) === 1) this.addSphere(vertices[0], vertices[1], vertices[2], vertices[3], material, `${prefix}:${i}`);
      else this.addTriangle(vertices, material, `${prefix}:${i}`);
    }
    return count;
  }

  addTriangle(vertices, material = 0, id = `tri:${this.triangleCount}`) {
    a.fromArray(vertices, 0); b.fromArray(vertices, 3); c.fromArray(vertices, 6);
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (normal.lengthSq() < 1e-14) return null;
    normal.normalize();
    const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x);
    const minZ = Math.min(a.z, b.z, c.z), maxZ = Math.max(a.z, b.z, c.z);
    const record = this._base({ id, minY: Math.min(a.y, b.y, c.y), maxY: Math.max(a.y, b.y, c.y),
      solid: true, walkable: Math.abs(normal.y) >= 0.55, cameraBlocker: true, surface: SURFACES[material] || 'concrete' }, 'tri');
    Object.assign(record, { vertices, normal, material, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
      hx: Math.max(0.001, (maxX - minX) / 2), hz: Math.max(0.001, (maxZ - minZ) / 2) });
    this._setRotation(record, 0); this.triangleCount++;
    return this._insert(record);
  }

  addSphere(x, y, z, radius, material = 0, id = `sphere:${this.colliders.size}`) {
    const record = this._base({ id, minY: y - radius, maxY: y + radius, solid: true, walkable: true,
      cameraBlocker: true, surface: SURFACES[material] || 'concrete' }, 'sphere');
    Object.assign(record, { cx: x, cy: y, cz: z, radius, hx: radius, hz: radius });
    this._setRotation(record, 0); return this._insert(record);
  }

  _height(record, x, z) {
    const v = record.vertices;
    const denominator = (v[5] - v[8]) * (v[0] - v[6]) + (v[6] - v[3]) * (v[2] - v[8]);
    if (Math.abs(denominator) < 1e-9) return null;
    const u = ((v[5] - v[8]) * (x - v[6]) + (v[6] - v[3]) * (z - v[8])) / denominator;
    const w = ((v[8] - v[2]) * (x - v[6]) + (v[0] - v[6]) * (z - v[8])) / denominator;
    if (u < -1e-5 || w < -1e-5 || u + w > 1.00001) return null;
    return u * v[1] + w * v[4] + (1 - u - w) * v[7];
  }

  _topAt(record, x, z) {
    if (record.type === 'sphere') {
      const distance = (x - record.cx) ** 2 + (z - record.cz) ** 2;
      return distance <= record.radius ** 2 ? record.cy + Math.sqrt(record.radius ** 2 - distance) : null;
    }
    return record.type === 'tri' ? this._height(record, x, z) : super._topAt(record, x, z);
  }

  _containsPoint(record, x, z, margin = 0) {
    if (record.type === 'sphere') return Math.hypot(x - record.cx, z - record.cz) <= record.radius + margin;
    if (record.type !== 'tri') return super._containsPoint(record, x, z, margin);
    if (this._height(record, x, z) !== null) return true;
    if (!margin) return false;
    const polygon = this._slice(record, record.minY - 0.01, record.maxY + 0.01);
    return this._closest(polygon, x, z).distance < margin;
  }

  getCeilingHeight(x, z, headY, radius = 0.2) {
    let best = Infinity;
    for (const record of this._gather(x - radius, z - radius, x + radius, z + radius)) {
      if (record.type === 'sphere') {
        const d = (x - record.cx) ** 2 + (z - record.cz) ** 2;
        if (d <= record.radius ** 2) {
          const height = record.cy - Math.sqrt(record.radius ** 2 - d);
          if (height >= headY - 0.05) best = Math.min(best, height);
        }
      } else if (record.type === 'tri') {
        const y = this._height(record, x, z);
        if (y !== null && y >= headY - 0.05) best = Math.min(best, y);
      } else if (record.solid && record.minY >= headY - 0.05 && super._containsPoint(record, x, z, 0)) best = Math.min(best, record.minY);
    }
    return best;
  }

  /** Clip a triangle to the body's vertical interval before projecting to XZ.
   * This keeps a wall over a tunnel from blocking the tunnel underneath. */
  _slice(record, lowY, highY) {
    let polygon = [];
    for (let i = 0; i < 9; i += 3) polygon.push([record.vertices[i], record.vertices[i + 1], record.vertices[i + 2]]);
    for (const [height, sign] of [[lowY, 1], [highY, -1]]) {
      const output = [];
      for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i], q = polygon[(i + 1) % polygon.length];
        const insideP = (p[1] - height) * sign >= 0, insideQ = (q[1] - height) * sign >= 0;
        if (insideP) output.push(p);
        if (insideP !== insideQ) {
          const k = (height - p[1]) / (q[1] - p[1]);
          output.push([p[0] + (q[0] - p[0]) * k, height, p[2] + (q[2] - p[2]) * k]);
        }
      }
      polygon = output;
    }
    return polygon;
  }

  _closest(polygon, x, z) {
    let distance = Infinity, px = x, pz = z;
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const dx = q[0] - p[0], dz = q[2] - p[2];
      const k = Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[2]) * dz) / (dx * dx + dz * dz || 1)));
      const cx = p[0] + k * dx, cz = p[2] + k * dz, d = Math.hypot(cx - x, cz - z);
      if (d < distance) { distance = d; px = cx; pz = cz; }
    }
    return { distance, px, pz };
  }

  resolveCircle(pos, feetY, radius, height, stepHeight, iterations = 3) {
    this._bodyLow = feetY + stepHeight; this._bodyHigh = feetY + height;
    return super.resolveCircle(pos, feetY, radius, height, stepHeight, iterations);
  }

  _pushCircle(record, pos, radius) {
    if (record.type === 'sphere') {
      const y = Math.max(this._bodyLow, Math.min(this._bodyHigh, record.cy));
      const section = Math.sqrt(Math.max(0, record.radius ** 2 - (y - record.cy) ** 2));
      let dx = pos.x - record.cx, dz = pos.z - record.cz; const distance = Math.hypot(dx, dz);
      if (distance >= section + radius || !section) return false;
      if (!distance) dx = 1;
      pos.x += (dx / (distance || 1)) * (section + radius - distance + 0.0001);
      pos.z += (dz / (distance || 1)) * (section + radius - distance + 0.0001); return true;
    }
    if (record.type !== 'tri') return super._pushCircle(record, pos, radius);
    if (record.walkable) return false;
    const polygon = this._slice(record, this._bodyLow, this._bodyHigh);
    const hit = this._closest(polygon, pos.x, pos.z);
    if (hit.distance >= radius) return false;
    let nx = pos.x - hit.px, nz = pos.z - hit.pz, d = Math.hypot(nx, nz);
    if (d < 1e-7) {
      nx = record.normal.x; nz = record.normal.z; d = Math.hypot(nx, nz) || 1;
      if ((pos.x - record.vertices[0]) * nx + (pos.z - record.vertices[2]) * nz < 0) { nx = -nx; nz = -nz; }
    }
    pos.x += nx / d * (radius - hit.distance + 0.0001); pos.z += nz / d * (radius - hit.distance + 0.0001);
    return true;
  }

  resolveOBB(body, feetY, height, stepHeight, ignoreOwner, contacts, iterations = 3, onContact = null) {
    this._bodyLow = feetY + stepHeight; this._bodyHigh = feetY + height;
    return super.resolveOBB(body, feetY, height, stepHeight, ignoreOwner, contacts, iterations, onContact);
  }

  _obbVsBox(body, ca, sa, record) {
    if (record.type === 'sphere') {
      const y = Math.max(this._bodyLow, Math.min(this._bodyHigh, record.cy));
      const radius = Math.sqrt(Math.max(0, record.radius ** 2 - (y - record.cy) ** 2));
      return radius ? super._obbVsCyl(body, ca, sa, { ...record, radius }) : null;
    }
    if (record.type !== 'tri') return super._obbVsBox(body, ca, sa, record);
    if (record.walkable) return null;
    const polygon = this._slice(record, this._bodyLow, this._bodyHigh);
    if (!polygon.length) return null;
    const axes = [[ca, -sa], [sa, ca]];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const nx = q[2] - p[2], nz = p[0] - q[0], length = Math.hypot(nx, nz);
      if (length > 1e-7) axes.push([nx / length, nz / length]);
    }
    let depth = Infinity, nx = 0, nz = 0;
    for (const [ax, az] of axes) {
      const center = body.x * ax + body.z * az;
      const radius = body.hx * Math.abs(ca * ax - sa * az) + body.hz * Math.abs(sa * ax + ca * az);
      let min = Infinity, max = -Infinity;
      for (const p of polygon) { const n = p[0] * ax + p[2] * az; min = Math.min(min, n); max = Math.max(max, n); }
      const negative = center + radius - min, positive = max - center + radius;
      if (negative <= 0 || positive <= 0) return null;
      if (Math.min(negative, positive) < depth) {
        depth = Math.min(negative, positive); const sign = negative < positive ? -1 : 1; nx = ax * sign; nz = az * sign;
      }
    }
    const hit = this._closest(polygon, body.x, body.z);
    return { nx, nz, depth: depth + 0.0001, px: hit.px, pz: hit.pz };
  }

  _rayBox(record, origin, direction, radius, maxT) {
    if (record.type === 'sphere') {
      ray.set(origin, direction);
      const hit = ray.intersectSphere(new THREE.Sphere(point.set(record.cx, record.cy, record.cz), record.radius + radius), nearest);
      const distance = hit ? origin.distanceTo(hit) : Infinity; return distance <= maxT ? distance : Infinity;
    }
    if (record.type !== 'tri') return super._rayBox(record, origin, direction, radius, maxT);
    a.fromArray(record.vertices); b.fromArray(record.vertices, 3); c.fromArray(record.vertices, 6);
    tri.set(a, b, c); ray.set(origin, direction);
    if (radius < 1e-5) {
      const hit = ray.intersectTriangle(a, b, c, false, point);
      if (!hit) return Infinity;
      const t = origin.distanceTo(hit); return t <= maxT ? t : Infinity;
    }
    // Conservative advancement for a swept sphere; distance-to-triangle is
    // 1-Lipschitz, so steps cannot skip a thin wall or a bridge underside.
    let t = 0;
    for (let i = 0; i < 48 && t <= maxT; i++) {
      point.copy(origin).addScaledVector(direction, t); tri.closestPointToPoint(point, nearest);
      const distance = point.distanceTo(nearest);
      if (distance <= radius + 0.0005) return t;
      t += Math.max(0.001, distance - radius);
    }
    return Infinity;
  }

  surfaceAt(x, z, referenceY) {
    let best = -Infinity, surface = 'asphalt';
    for (const record of this._gather(x - 0.01, z - 0.01, x + 0.01, z + 0.01)) {
      if (!record.walkable) continue;
      const height = this._topAt(record, x, z);
      if (height !== null && height <= referenceY + 0.4 && height > best) { best = height; surface = record.surface || surface; }
    }
    return surface;
  }

  isVolumeFree(x, y, z, radius, height) {
    const position = { x, z };
    this.resolveCircle(position, y, radius, height, 0.36);
    return Math.hypot(position.x - x, position.z - z) < 0.01 && this.getCeilingHeight(x, z, y + 0.4, radius) >= y + height;
  }
}
