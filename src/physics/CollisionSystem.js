/**
 * Sistema de colisão simplificado, separado da geometria visual.
 *
 * Formas suportadas (todas com faixa vertical minY..maxY):
 *  - box  : caixa orientada (rotação em Y). Caixas alinhadas usam rotation = 0.
 *  - cyl  : cilindro vertical (postes, troncos, lixeiras).
 *  - ramp : superfície caminhável inclinada (apenas solo, não bloqueia na horizontal).
 *
 * Um "spatial hash" em grade 2D (XZ) mantém as consultas baratas.
 * O mesmo sistema servirá para pedestres, veículos e projéteis nas próximas etapas.
 */

let _nextAutoId = 1;

export class CollisionSystem {
  constructor({ cellSize = 16 } = {}) {
    this.cellSize = cellSize;
    this.colliders = new Map();
    this._grid = new Map();
    this._stamp = 0;
    this._candidates = [];
    this.terrainHeight = () => 0;
  }

  /** Define a função de altura do terreno base (praia, ruas, etc.). */
  setTerrain(fn) {
    this.terrainHeight = fn;
  }

  // ---------------------------------------------------------------- criação

  /** Caixa orientada. Informe centro (cx, cz), meias-extensões (hx, hz) e rotação em Y. */
  addBox(opts) {
    const c = this._base(opts, 'box');
    c.cx = opts.cx;
    c.cz = opts.cz;
    c.hx = opts.hx;
    c.hz = opts.hz;
    this._setRotation(c, opts.rotation || 0);
    return this._insert(c);
  }

  /** Caixa alinhada aos eixos a partir de limites mínimos/máximos. */
  addAABB(opts) {
    return this.addBox({
      ...opts,
      cx: (opts.minX + opts.maxX) / 2,
      cz: (opts.minZ + opts.maxZ) / 2,
      hx: (opts.maxX - opts.minX) / 2,
      hz: (opts.maxZ - opts.minZ) / 2,
      rotation: 0,
    });
  }

  addCylinder(opts) {
    const c = this._base(opts, 'cyl');
    c.cx = opts.x;
    c.cz = opts.z;
    c.radius = opts.radius;
    c.hx = c.hz = opts.radius;
    this._setRotation(c, 0);
    return this._insert(c);
  }

  /** Rampa: altura vai de y0 (lado local -hx) até y1 (lado local +hx). */
  addRamp(opts) {
    const c = this._base({ ...opts, solid: false, walkable: true, cameraBlocker: false }, 'ramp');
    c.cx = opts.cx;
    c.cz = opts.cz;
    c.hx = opts.hx;
    c.hz = opts.hz;
    c.y0 = opts.y0;
    c.y1 = opts.y1;
    c.minY = Math.min(opts.y0, opts.y1) - 0.2;
    c.maxY = Math.max(opts.y0, opts.y1);
    this._setRotation(c, opts.rotation || 0);
    return this._insert(c);
  }

  remove(id) {
    const c = this.colliders.get(id);
    if (!c) return false;
    for (const key of c._cells) {
      const list = this._grid.get(key);
      if (!list) continue;
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) this._grid.delete(key);
    }
    this.colliders.delete(id);
    return true;
  }

  /** Atualiza posição/rotação de um colisor (útil para veículos futuramente). */
  move(id, cx, cz, rotation = null) {
    const c = this.colliders.get(id);
    if (!c) return;
    this._unlinkCells(c);
    c.cx = cx;
    c.cz = cz;
    if (rotation !== null) this._setRotation(c, rotation);
    this._linkCells(c);
  }

  // --------------------------------------------------------------- consultas

  /**
   * Altura do solo sob (x, z) considerando o terreno e superfícies caminháveis
   * cujo topo esteja abaixo de feetY + stepHeight.
   */
  getGroundHeight(x, z, feetY, stepHeight) {
    let best = this.terrainHeight(x, z);
    const limit = feetY + stepHeight;
    const list = this._gather(x - 0.01, z - 0.01, x + 0.01, z + 0.01);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.walkable) continue;
      const top = this._topAt(c, x, z);
      if (top === null) continue;
      if (top <= limit && top > best) best = top;
    }
    return best;
  }

  /** Menor base de um obstáculo sólido acima de headY em (x, z); Infinity se nenhum. */
  getCeilingHeight(x, z, headY, radius = 0.2) {
    let best = Infinity;
    const list = this._gather(x - radius, z - radius, x + radius, z + radius);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.solid || c.minY < headY - 0.05) continue;
      if (!this._containsPoint(c, x, z, 0)) continue;
      if (c.minY < best) best = c.minY;
    }
    return best;
  }

  /**
   * Resolve a penetração horizontal de um círculo (corpo do jogador/pedestre).
   * Modifica `pos` (x, z) diretamente. Retorna o número de contatos.
   * Obstáculos cujo topo esteja abaixo de feetY + stepHeight são ignorados
   * (o personagem sobe neles), evitando travar em meios-fios.
   */
  resolveCircle(pos, feetY, radius, height, stepHeight, iterations = 3) {
    let contacts = 0;
    const lowY = feetY + stepHeight;
    const highY = feetY + height;
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      const list = this._gather(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c.solid) continue;
        if (c.maxY <= lowY || c.minY >= highY) continue;
        if (this._pushCircle(c, pos, radius)) {
          moved = true;
          contacts++;
        }
      }
      if (!moved) break;
    }
    return contacts;
  }

  /**
   * Resolve a penetração de uma caixa orientada dinâmica (veículos) contra
   * colisores sólidos (caixas e cilindros), por SAT. Obstáculos cujo topo fica
   * abaixo de feetY + stepHeight (meio-fio, lajes) são ignorados: as rodas
   * sobem neles. body = { x, z, rot, hx, hz } (x/z corrigidos no lugar).
   * Preenche `contacts` com { nx, nz, depth, px, pz, collider } — a normal
   * aponta do obstáculo para o corpo. Retorna o número de contatos.
   */
  resolveOBB(body, feetY, height, stepHeight, ignoreOwner, contacts = [], iterations = 4, onContact = null) {
    contacts.length = 0;
    const lowY = feetY + stepHeight;
    const highY = feetY + height;
    const reach = Math.hypot(body.hx, body.hz);
    for (let it = 0; it < iterations; it++) {
      const ca = Math.cos(body.rot), sa = Math.sin(body.rot);
      const list = this._gather(body.x - reach, body.z - reach, body.x + reach, body.z + reach);
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c.solid || c.type === 'ramp') continue;
        if (ignoreOwner && c.ownerId === ignoreOwner) continue;
        if (c.maxY <= lowY || c.minY >= highY) continue;
        const hit = c.type === 'cyl' ? this._obbVsCyl(body, ca, sa, c) : this._obbVsBox(body, ca, sa, c);
        if (!hit) continue;
        // Destructibles may consume the contact before static wall response.
        if (onContact && onContact({ nx: hit.nx, nz: hit.nz, depth: hit.depth, px: hit.px, pz: hit.pz, collider: c }) === false) continue;
        body.x += hit.nx * hit.depth;
        body.z += hit.nz * hit.depth;
        contacts.push({ nx: hit.nx, nz: hit.nz, depth: hit.depth, px: hit.px, pz: hit.pz, collider: c });
        moved = true;
      }
      if (!moved) break;
    }
    return contacts.length;
  }

  /** SAT caixa x caixa (2D). Normal do obstáculo para o corpo; ponto de contato aproximado. */
  _obbVsBox(b, ca, sa, c) {
    const dx = c.cx - b.x, dz = c.cz - b.z;
    const axes = _axes;
    axes[0] = ca; axes[1] = -sa; axes[2] = sa; axes[3] = ca;
    axes[4] = c.cos; axes[5] = -c.sin; axes[6] = c.sin; axes[7] = c.cos;
    let minO = Infinity, nx = 0, nz = 0, axisIdx = 0;
    for (let k = 0; k < 4; k++) {
      const ax = axes[k * 2], az = axes[k * 2 + 1];
      const rA = b.hx * Math.abs(ca * ax - sa * az) + b.hz * Math.abs(sa * ax + ca * az);
      const rB = c.hx * Math.abs(c.cos * ax - c.sin * az) + c.hz * Math.abs(c.sin * ax + c.cos * az);
      const d = dx * ax + dz * az;
      const o = rA + rB - Math.abs(d);
      if (o <= 0) return null;
      if (o < minO) { minO = o; const s = d > 0 ? -1 : 1; nx = ax * s; nz = az * s; axisIdx = k; }
    }
    // Ponto de contato: quina do outro corpo que mais penetra.
    let px = 0, pz = 0;
    if (axisIdx < 2) {
      let best = -Infinity;
      for (const [sx, sz] of _corners) {
        const x = c.cx + sx * c.hx * c.cos + sz * c.hz * c.sin;
        const z = c.cz - sx * c.hx * c.sin + sz * c.hz * c.cos;
        const v = x * nx + z * nz;
        if (v > best) { best = v; px = x; pz = z; }
      }
    } else {
      let best = Infinity;
      for (const [sx, sz] of _corners) {
        const x = b.x + sx * b.hx * ca + sz * b.hz * sa;
        const z = b.z - sx * b.hx * sa + sz * b.hz * ca;
        const v = x * nx + z * nz;
        if (v < best) { best = v; px = x; pz = z; }
      }
    }
    _hit.nx = nx; _hit.nz = nz; _hit.depth = minO; _hit.px = px; _hit.pz = pz;
    return _hit;
  }

  /** Caixa x cilindro vertical (círculo no plano XZ). */
  _obbVsCyl(b, ca, sa, c) {
    const dx = c.cx - b.x, dz = c.cz - b.z;
    const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
    const qx = Math.max(-b.hx, Math.min(b.hx, lx));
    const qz = Math.max(-b.hz, Math.min(b.hz, lz));
    let ex = lx - qx, ez = lz - qz;
    let d2 = ex * ex + ez * ez;
    let depth, nlx, nlz;
    if (d2 > 1e-10) {
      if (d2 >= c.radius * c.radius) return null;
      const d = Math.sqrt(d2);
      depth = c.radius - d;
      nlx = -ex / d; nlz = -ez / d;
    } else {
      const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz);
      if (px < pz) { depth = px + c.radius; nlx = lx > 0 ? -1 : 1; nlz = 0; } else { depth = pz + c.radius; nlx = 0; nlz = lz > 0 ? -1 : 1; }
    }
    // Local -> mundo (eixos do corpo: X = (ca, -sa), Z = (sa, ca)).
    _hit.nx = nlx * ca + nlz * sa;
    _hit.nz = -nlx * sa + nlz * ca;
    _hit.depth = depth;
    _hit.px = b.x + qx * ca + qz * sa;
    _hit.pz = b.z - qx * sa + qz * ca;
    return _hit;
  }

  /**
   * Teste de segmento com raio (sphere-cast aproximado) contra colisores que
   * bloqueiam a câmera. Retorna a distância até o primeiro impacto ou maxDist.
   */
  sphereCast(origin, dir, maxDist, radius, tagFilter = 'cameraBlocker') {
    const ex = origin.x + dir.x * maxDist;
    const ez = origin.z + dir.z * maxDist;
    const list = this._gather(
      Math.min(origin.x, ex) - radius, Math.min(origin.z, ez) - radius,
      Math.max(origin.x, ex) + radius, Math.max(origin.z, ez) + radius,
    );
    let best = maxDist;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (tagFilter && !c[tagFilter]) continue;
      const t = this._rayBox(c, origin, dir, radius, best);
      if (t < best) best = t;
    }
    return best;
  }

  /** Lista colisores que tocam um círculo (para interações futuras). */
  queryCircle(x, z, radius, out = []) {
    out.length = 0;
    const list = this._gather(x - radius, z - radius, x + radius, z + radius);
    for (let i = 0; i < list.length; i++) {
      if (this._containsPoint(list[i], x, z, radius)) out.push(list[i]);
    }
    return out;
  }

  // ---------------------------------------------------------------- internos

  _base(opts, type) {
    const id = opts.id || `col_${_nextAutoId++}`;
    return {
      id,
      type,
      ownerId: opts.ownerId || null,
      minY: opts.minY ?? 0,
      maxY: opts.maxY ?? 3,
      solid: opts.solid ?? true,
      walkable: opts.walkable ?? true,
      cameraBlocker: opts.cameraBlocker ?? true,
      surface: opts.surface || null,
      tags: opts.tags || null,
      _cells: [],
      _stamp: 0,
    };
  }

  _setRotation(c, rotation) {
    c.rotation = rotation;
    c.cos = Math.cos(rotation);
    c.sin = Math.sin(rotation);
    // Raio do círculo envolvente no plano XZ para indexação.
    c.boundR = c.type === 'cyl' ? c.radius : Math.hypot(c.hx, c.hz);
  }

  _insert(c) {
    if (this.colliders.has(c.id)) this.remove(c.id);
    this.colliders.set(c.id, c);
    this._linkCells(c);
    return c;
  }

  _cellKey(ix, iz) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  _linkCells(c) {
    const s = this.cellSize;
    let minX, maxX, minZ, maxZ;
    if (c.type === 'cyl' || c.rotation === 0) {
      minX = c.cx - c.hx; maxX = c.cx + c.hx;
      minZ = c.cz - c.hz; maxZ = c.cz + c.hz;
    } else {
      const ex = Math.abs(c.hx * c.cos) + Math.abs(c.hz * c.sin);
      const ez = Math.abs(c.hx * c.sin) + Math.abs(c.hz * c.cos);
      minX = c.cx - ex; maxX = c.cx + ex;
      minZ = c.cz - ez; maxZ = c.cz + ez;
    }
    const ix0 = Math.floor(minX / s), ix1 = Math.floor(maxX / s);
    const iz0 = Math.floor(minZ / s), iz1 = Math.floor(maxZ / s);
    c._cells.length = 0;
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = this._cellKey(ix, iz);
        let list = this._grid.get(key);
        if (!list) { list = []; this._grid.set(key, list); }
        list.push(c);
        c._cells.push(key);
      }
    }
  }

  _unlinkCells(c) {
    for (const key of c._cells) {
      const list = this._grid.get(key);
      if (!list) continue;
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    }
    c._cells.length = 0;
  }

  _gather(minX, minZ, maxX, maxZ) {
    const s = this.cellSize;
    const out = this._candidates;
    out.length = 0;
    const stamp = ++this._stamp;
    const ix0 = Math.floor(minX / s), ix1 = Math.floor(maxX / s);
    const iz0 = Math.floor(minZ / s), iz1 = Math.floor(maxZ / s);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = this._grid.get(this._cellKey(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c._stamp === stamp) continue;
          c._stamp = stamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  _toLocal(c, x, z, out) {
    const dx = x - c.cx, dz = z - c.cz;
    out.x = dx * c.cos - dz * c.sin;
    out.z = dx * c.sin + dz * c.cos;
    return out;
  }

  _containsPoint(c, x, z, margin) {
    if (c.type === 'cyl') {
      const dx = x - c.cx, dz = z - c.cz;
      const r = c.radius + margin;
      return dx * dx + dz * dz <= r * r;
    }
    const l = this._toLocal(c, x, z, _tmpLocal);
    return Math.abs(l.x) <= c.hx + margin && Math.abs(l.z) <= c.hz + margin;
  }

  _topAt(c, x, z) {
    if (!this._containsPoint(c, x, z, 0)) return null;
    if (c.type === 'ramp') {
      const l = this._toLocal(c, x, z, _tmpLocal);
      const t = (l.x + c.hx) / (2 * c.hx);
      return c.y0 + (c.y1 - c.y0) * Math.min(1, Math.max(0, t));
    }
    return c.maxY;
  }

  _pushCircle(c, pos, radius) {
    if (c.type === 'cyl') {
      const dx = pos.x - c.cx, dz = pos.z - c.cz;
      const r = c.radius + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return false;
      const d = Math.sqrt(d2);
      if (d < 1e-5) { pos.x += r; return true; }
      const k = (r - d) / d;
      pos.x += dx * k;
      pos.z += dz * k;
      return true;
    }

    const l = this._toLocal(c, pos.x, pos.z, _tmpLocal);
    const qx = Math.max(-c.hx, Math.min(c.hx, l.x));
    const qz = Math.max(-c.hz, Math.min(c.hz, l.z));
    let px = l.x - qx, pz = l.z - qz;
    const d2 = px * px + pz * pz;
    let pushX = 0, pushZ = 0;

    if (d2 > 1e-10) {
      if (d2 >= radius * radius) return false;
      const d = Math.sqrt(d2);
      const k = (radius - d) / d;
      pushX = px * k;
      pushZ = pz * k;
    } else {
      // Centro dentro da caixa: empurra pelo eixo de menor penetração.
      const penX = c.hx - Math.abs(l.x);
      const penZ = c.hz - Math.abs(l.z);
      if (penX < penZ) pushX = (l.x >= 0 ? 1 : -1) * (penX + radius);
      else pushZ = (l.z >= 0 ? 1 : -1) * (penZ + radius);
    }

    // Local -> mundo.
    pos.x += pushX * c.cos + pushZ * c.sin;
    pos.z += -pushX * c.sin + pushZ * c.cos;
    return true;
  }

  /** Interseção raio x cilindro vertical expandido pelo raio r. */
  _rayCyl(c, o, d, r, maxT) {
    const R = c.radius + r;
    const ox = o.x - c.cx, oz = o.z - c.cz;
    const y0 = c.minY - r, y1 = c.maxY + r;
    const a = d.x * d.x + d.z * d.z;
    const b = 2 * (ox * d.x + oz * d.z);
    const cc = ox * ox + oz * oz - R * R;
    if (cc <= 0) {
      if (o.y < y0 || o.y > y1) return this._rayCylCaps(c, o, d, R, y0, y1, maxT);
      const insideReal = ox * ox + oz * oz <= c.radius * c.radius && o.y >= c.minY && o.y <= c.maxY;
      return insideReal ? Infinity : 0;
    }
    if (a < 1e-9) return Infinity;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return Infinity;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > maxT) return Infinity;
    const y = o.y + d.y * t;
    if (y >= y0 && y <= y1) return t;
    return this._rayCylCaps(c, o, d, R, y0, y1, maxT);
  }

  _rayCylCaps(c, o, d, R, y0, y1, maxT) {
    if (Math.abs(d.y) < 1e-9) return Infinity;
    const plane = d.y < 0 ? y1 : y0;
    const t = (plane - o.y) / d.y;
    if (t < 0 || t > maxT) return Infinity;
    const x = o.x + d.x * t - c.cx, z = o.z + d.z * t - c.cz;
    return x * x + z * z <= R * R ? t : Infinity;
  }

  /** Interseção raio x caixa expandida (slab). Retorna t ou Infinity. */
  _rayBox(c, o, d, r, maxT) {
    if (c.type === 'cyl') return this._rayCyl(c, o, d, r, maxT);
    // Origem e direção em espaço local.
    const dx = o.x - c.cx, dz = o.z - c.cz;
    const ox = dx * c.cos - dz * c.sin;
    const oz = dx * c.sin + dz * c.cos;
    const vx = d.x * c.cos - d.z * c.sin;
    const vz = d.x * c.sin + d.z * c.cos;
    const oy = o.y, vy = d.y;

    const hx = (c.type === 'cyl' ? c.radius : c.hx) + r;
    const hz = (c.type === 'cyl' ? c.radius : c.hz) + r;
    const y0 = c.minY - r, y1 = c.maxY + r;

    let tmin = -Infinity, tmax = Infinity;
    // Eixo X
    if (Math.abs(vx) < 1e-9) { if (ox < -hx || ox > hx) return Infinity; }
    else {
      let t1 = (-hx - ox) / vx, t2 = (hx - ox) / vx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
    }
    // Eixo Y
    if (Math.abs(vy) < 1e-9) { if (oy < y0 || oy > y1) return Infinity; }
    else {
      let t1 = (y0 - oy) / vy, t2 = (y1 - oy) / vy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
    }
    // Eixo Z
    if (Math.abs(vz) < 1e-9) { if (oz < -hz || oz > hz) return Infinity; }
    else {
      let t1 = (-hz - oz) / vz, t2 = (hz - oz) / vz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
    }
    if (tmax < tmin || tmax < 0) return Infinity;
    if (tmin < 0) {
      // Origem dentro do volume expandido. Se estiver só na margem (fora do
      // volume real), o obstáculo está colado: impacto imediato. Se estiver
      // dentro do volume real (ex.: teto alto sobre o jogador), ignora.
      const rx = hx - r, rz = hz - r;
      const insideReal = Math.abs(ox) <= rx && Math.abs(oz) <= rz && oy >= c.minY && oy <= c.maxY;
      return insideReal ? Infinity : 0;
    }
    return tmin <= maxT ? tmin : Infinity;
  }
}

const _tmpLocal = { x: 0, z: 0 };
const _axes = new Float64Array(8);
const _hit = { nx: 0, nz: 0, depth: 0, px: 0, pz: 0 };
const _corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
