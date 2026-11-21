import * as THREE from 'three';

/**
 * Detecção de impactos por raio (sem balística realista): testa os colisores
 * do mapa ativo (CollisionSystem), o terreno e os alvos registrados.
 * Funciona igual em Sunset Beach e no TEST CITY, pois ambos expõem colisores
 * e altura do terreno pela mesma interface.
 */
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Material de impacto inferido do colisor (ids/tags do mapa). */
export function colliderMaterial(c) {
  if (c.destructible) return c.destructible.profile.material;
  if (c.surface) return surfaceMaterial(c.surface);
  const id = `${c.id} ${c.ownerId || ''} ${(c.tags || []).join(' ')}`.toLowerCase();
  if (id.includes('veh') || id.includes('car')) return 'metal';
  if (/palm|tree|trunk|bench|wood|deck|pier|board/.test(id)) return 'wood';
  if (/lamp|pole|post|sign|meter|rail|hydrant|bollard|signal|light|mast|booth|kiosk|fence/.test(id)) return 'metal';
  if (/glass|window|shop/.test(id)) return 'glass';
  return 'concrete';
}

export function surfaceMaterial(s) {
  if (!s) return 'concrete';
  if (s === 'sand') return 'sand';
  if (s === 'grass' || s === 'dirt') return 'dirt';
  if (s === 'water' || s === 'shallow') return 'water';
  if (s === 'asphalt') return 'asphalt';
  if (s === 'wood') return 'wood';
  if (s === 'metal') return 'metal';
  return 'concrete';
}

export class WeaponBallistics {
  constructor(game) {
    this.game = game;
    /** Alvos extras: objetos com hit(origin, dir, maxT) → { t, normal, target } | null. */
    this.targets = new Set();
    this.result = WeaponBallistics.makeResult();
  }

  static makeResult() {
    return { hit: false, t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), material: 'concrete', target: null, collider: null };
  }

  get collision() {
    return this.game.player.controller.collision;
  }

  /**
   * Lança um raio. dir normalizado. Retorna this.result (reutilizado).
   * ignoreOwner: id de dono de colisor a ignorar (ex.: o próprio carro).
   */
  cast(origin, dir, maxDist, { ignoreOwner = null, out = null } = {}) {
    const r = out || this.result;
    r.hit = false;
    r.target = null;
    r.collider = null;
    let best = maxDist;
    const col = this.collision;
    // 1) Colisores do mapa.
    if (col) {
      const ex = origin.x + dir.x * maxDist, ez = origin.z + dir.z * maxDist;
      const list = col._gather(Math.min(origin.x, ex), Math.min(origin.z, ez), Math.max(origin.x, ex), Math.max(origin.z, ez));
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.solid === false && !c.raycastOnly) continue;
        if (ignoreOwner && c.ownerId === ignoreOwner) continue;
        const t = col._rayBox(c, origin, dir, 0, best);
        if (t > 0 && t < best) { best = t; r.collider = c; }
      }
    }
    // 2) Terreno (marcha + bisseção).
    const tg = this._ground(origin, dir, best);
    let ground = false;
    if (tg < best) { best = tg; r.collider = null; ground = true; }
    // 3) Alvos.
    for (const tgt of this.targets) {
      const h = tgt.hit(origin, dir, best);
      if (h && h.t < best) { best = h.t; r.target = h.target || tgt; r.collider = null; ground = false; r.normal.copy(h.normal); r.material = h.material || 'metal'; }
    }
    if (best >= maxDist) return r;
    r.hit = true;
    r.t = best;
    r.point.copy(origin).addScaledVector(dir, best);
    if (r.target) return r;
    if (ground) {
      r.normal.set(0, 1, 0);
      const env = this.game.mapEnv || this.game.world;
      r.material = surfaceMaterial(env.getSurface?.(r.point.x, r.point.z));
    } else if (r.collider) {
      this._normal(r.collider, r.point, dir, r.normal);
      r.material = colliderMaterial(r.collider);
    }
    return r;
  }

  /** Altura do chão (terreno + topos caminháveis baixos). */
  _groundY(x, z, y) {
    const col = this.collision;
    return col ? col.getGroundHeight(x, z, y, 0) : 0;
  }

  _ground(o, d, maxT) {
    if (d.y > 0.2) return Infinity;
    const step = 0.6;
    let tPrev = 0;
    let above = o.y - this._groundY(o.x, o.z, o.y);
    if (above < 0) return Infinity;
    for (let t = step; t < maxT + step; t += step) {
      const tt = Math.min(t, maxT);
      _p.copy(o).addScaledVector(d, tt);
      const h = _p.y - this._groundY(_p.x, _p.z, _p.y + 0.05);
      if (h <= 0) {
        // Bisseção entre tPrev e tt.
        let a = tPrev, b = tt;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) / 2;
          _p.copy(o).addScaledVector(d, m);
          if (_p.y - this._groundY(_p.x, _p.z, _p.y + 0.05) <= 0) b = m; else a = m;
        }
        return b;
      }
      tPrev = tt;
      if (tt >= maxT) break;
    }
    return Infinity;
  }

  /** Normal da face atingida de uma caixa orientada ou cilindro. */
  _normal(c, p, dir, out) {
    if (c.type === 'cyl') {
      const top = Math.abs(p.y - c.maxY) < 0.03;
      if (top) return out.set(0, 1, 0);
      return out.set(p.x - c.cx, 0, p.z - c.cz).normalize();
    }
    const dx = p.x - c.cx, dz = p.z - c.cz;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const ex = Math.abs(Math.abs(lx) - c.hx);
    const ez = Math.abs(Math.abs(lz) - c.hz);
    const ey = Math.abs(p.y - c.maxY);
    if (ey < ex && ey < ez && ey < 0.05) return out.set(0, 1, 0);
    let nx = 0, nz = 0;
    if (ex < ez) nx = Math.sign(lx); else nz = Math.sign(lz);
    // De volta ao mundo (inversa da rotação usada em _toLocal).
    out.set(nx * c.cos + nz * c.sin, 0, -nx * c.sin + nz * c.cos);
    if (out.dot(dir) > 0) out.negate();
    return out;
  }
}

export const _tmp = { _o, _d };
