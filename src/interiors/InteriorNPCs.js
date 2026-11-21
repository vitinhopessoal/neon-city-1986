import * as THREE from 'three';
import { PedestrianRenderer, randomLook } from '../pedestrians/PedestrianRenderer.js';

/**
 * NPCs dos estabelecimentos. Reaproveita a arquitetura de pedestres
 * existente (mesmo PedestrianRenderer instanciado, mesmos visuais dos anos
 * 80 e o mesmo esqueleto procedural) com comportamentos internos:
 *   stand · work · patrol · sit · talk · dance · dj
 * Os pontos de patrulha vêm do layout; entre eles a rota é calculada numa
 * grade de navegação gerada dos colisores do interior (A* + suavização), de
 * modo que os NPCs contornam móveis e paredes. Só o interior ativo é simulado.
 */
const _v = new THREE.Vector3();

// ------------------------------------------------------------ navegação
const CELL = 0.3;
const NPC_R = 0.28;

/** Grade de células livres do piso (coordenadas locais) para um nível ly. */
function buildNavGrid(interior, ly) {
  const W = interior.W, D = interior.D;
  const nx = Math.ceil(W / CELL), nz = Math.ceil(D / CELL);
  const blocked = new Uint8Array(nx * nz);
  for (const k of interior.colliders) {
    if (k.walkable || k.y0 > ly + 1.6 || k.y1 < ly + 0.25) continue;
    const c = Math.cos(k.ry || 0), s = Math.sin(k.ry || 0);
    const hw = k.w / 2 + NPC_R, hd = k.d / 2 + NPC_R;
    const ex = Math.abs(c) * hw + Math.abs(s) * hd, ez = Math.abs(s) * hw + Math.abs(c) * hd;
    const i0 = Math.max(0, Math.floor((k.x - ex + W / 2) / CELL)), i1 = Math.min(nx - 1, Math.floor((k.x + ex + W / 2) / CELL));
    const j0 = Math.max(0, Math.floor((k.z - ez + D / 2) / CELL)), j1 = Math.min(nz - 1, Math.floor((k.z + ez + D / 2) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = -W / 2 + (i + 0.5) * CELL - k.x, pz = -D / 2 + (j + 0.5) * CELL - k.z;
      // Ponto no espaço do colisor (rotação inversa).
      const lx = px * c - pz * s, lz = px * s + pz * c;
      if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) blocked[j * nx + i] = 1;
    }
  }
  // Bordas (paredes externas).
  for (let i = 0; i < nx; i++) { blocked[i] = 1; blocked[(nz - 1) * nx + i] = 1; }
  for (let j = 0; j < nz; j++) { blocked[j * nx] = 1; blocked[j * nx + nx - 1] = 1; }
  return { W, D, nx, nz, blocked };
}

function cellOf(g, x, z) {
  return [Math.min(g.nx - 1, Math.max(0, Math.floor((x + g.W / 2) / CELL))), Math.min(g.nz - 1, Math.max(0, Math.floor((z + g.D / 2) / CELL)))];
}
const centerOf = (g, i, j) => [-g.W / 2 + (i + 0.5) * CELL, -g.D / 2 + (j + 0.5) * CELL];

/** Célula livre mais próxima (busca em anéis). */
function nearestFree(g, i, j) {
  if (!g.blocked[j * g.nx + i]) return [i, j];
  for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const a = i + di, b = j + dj;
    if (a >= 0 && b >= 0 && a < g.nx && b < g.nz && !g.blocked[b * g.nx + a]) return [a, b];
  }
  return null;
}

function lineFree(g, a, b) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL * 0.5)) + 1;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const [i, j] = cellOf(g, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    if (g.blocked[j * g.nx + i]) return false;
  }
  return true;
}

/** A* 8-vizinhos entre dois pontos locais; retorna pontos suavizados ou null. */
function findPath(g, from, to) {
  const s = nearestFree(g, ...cellOf(g, from[0], from[1])), e = nearestFree(g, ...cellOf(g, to[0], to[1]));
  if (!s || !e) return null;
  const N = g.nx * g.nz, start = s[1] * g.nx + s[0], goal = e[1] * g.nx + e[0];
  const gs = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const open = [start];
  gs[start] = 0;
  const h = (id) => Math.hypot((id % g.nx) - e[0], Math.floor(id / g.nx) - e[1]);
  const f = new Float32Array(N).fill(Infinity);
  f[start] = h(start);
  let guard = 0;
  while (open.length && guard++ < 20000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal) break;
    closed[cur] = 1;
    const ci = cur % g.nx, cj = Math.floor(cur / g.nx);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = ci + di, b = cj + dj;
      if (a < 0 || b < 0 || a >= g.nx || b >= g.nz) continue;
      const id = b * g.nx + a;
      if (g.blocked[id] || closed[id]) continue;
      if (di && dj && (g.blocked[cj * g.nx + a] || g.blocked[b * g.nx + ci])) continue; // sem cortar quinas
      const ng = gs[cur] + (di && dj ? 1.414 : 1);
      if (ng < gs[id]) { if (gs[id] === Infinity) open.push(id); gs[id] = ng; f[id] = ng + h(id); came[id] = cur; }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const cells = [];
  for (let id = goal; id !== -1; id = came[id]) cells.push(centerOf(g, id % g.nx, Math.floor(id / g.nx)));
  cells.reverse();
  // Suavização por linha de visada.
  const out = [cells[0]];
  let k = 0;
  while (k < cells.length - 1) {
    let m = cells.length - 1;
    while (m > k + 1 && !lineFree(g, cells[k], cells[m])) m--;
    out.push(cells[m]);
    k = m;
  }
  return out;
}

function emptyPose() {
  return { thighL: 0, thighR: 0, kneeL: 0.05, kneeR: 0.05, armL: 0, armR: 0, elbowL: 0.2, elbowR: 0.2, armOut: 0.03, bob: 0, twist: 0, headYaw: 0, headPitch: 0, lean: 0, sit: 0, lie: 0, footPitch: 0 };
}

export class InteriorNPCs {
  constructor(scene, capacity = 18) {
    this.renderer = new PedestrianRenderer(scene, capacity);
    this.renderer.group.name = 'interiorNPCs';
    this.renderer.group.visible = false;
    this.capacity = capacity;
    this.npcs = [];
    this.root = null;
    this.time = 0;
    this.bpm = 120;
  }

  /** Popula o interior ativo. specs em coordenadas locais do interior. */
  spawn(interior, specs) {
    this.clear();
    this.root = interior.root;
    this.interior = interior;
    specs.slice(0, this.capacity).forEach((s, i) => {
      const look = randomLook();
      if (s.uniform) Object.assign(look, s.uniform);
      const p0 = s.points?.[0] || [s.x, s.z];
      const seat = s.seat !== undefined ? interior.seats[s.seat] : null;
      if (seat) seat.used = `npc${i}`;
      const n = {
        id: `${interior.def.id}_npc${i}`, slot: i, spec: s, look, role: s.role, behavior: s.behavior,
        lx: seat ? seat.x : p0[0], lz: seat ? seat.z : p0[1], ly: seat ? seat.y - 0.46 : (s.y || 0), yawL: seat ? seat.yaw : (s.yaw ?? 0),
        x: 0, y: 0, z: 0, yaw: 0, pi: 0, wait: 1 + Math.random() * 3, speed: 0, phase: Math.random() * 6,
        seat, startle: 0, danceStyle: i % 3, talkT: Math.random() * 5, name: s.name || null,
      };
      if (s.behavior === 'patrol' && s.points?.length > 1) n.route = this._route(interior, s.points, n.ly);
      if (n.route) { n.lx = n.route[0].x; n.lz = n.route[0].z; }
      this.renderer.applyLook(i, look);
      this.npcs.push(n);
    });
    this.renderer.group.visible = this.npcs.length > 0;
  }

  /** Rota fechada pelos pontos de patrulha, contornando colisores (pontos-chave marcados). */
  _route(interior, points, ly) {
    interior._nav = interior._nav || {};
    const key = ly.toFixed(2);
    const g = interior._nav[key] || (interior._nav[key] = buildNavGrid(interior, ly));
    const route = [];
    for (let k = 0; k < points.length; k++) {
      const a = points[k], b = points[(k + 1) % points.length];
      const path = findPath(g, a, b);
      if (!path) return null; // sem rota: o NPC fica parado no primeiro ponto
      path.forEach((p, i) => { if (i < path.length - 1 || k === points.length - 1) route.push({ x: p[0], z: p[1], key: i === 0 }); });
    }
    // Remove duplicatas consecutivas.
    return route.filter((p, i) => i === 0 || Math.hypot(p.x - route[i - 1].x, p.z - route[i - 1].z) > 0.05);
  }

  clear() {
    for (const n of this.npcs) { this.renderer.hide(n.slot); if (n.seat) n.seat.used = null; }
    this.npcs = [];
    this.renderer.group.visible = false;
    this.renderer.setActiveCount?.(0);
  }

  /** NPC pelo id de papel (ex.: 'attendant') para diálogos. */
  byRole(role) {
    return this.npcs.find((n) => n.role === role) || null;
  }

  react(kind) {
    for (const n of this.npcs) n.startle = kind === 'gunshot' ? 3 + Math.random() : 0.6;
  }

  update(dt, playerPos) {
    if (!this.npcs.length || !this.root) return;
    this.time += dt;
    const beat = (this.time * this.bpm) / 60;
    this.root.updateMatrixWorld();
    for (const n of this.npcs) {
      n.startle = Math.max(0, n.startle - dt);
      this._behave(n, dt);
      _v.set(n.lx, n.ly, n.lz).applyMatrix4(this.root.matrixWorld);
      n.x = _v.x; n.y = _v.y; n.z = _v.z;
      n.yaw = n.yawL + this.root.rotation.y;
      // Olha para o jogador quando ele chega perto.
      const dx = playerPos.x - n.x, dz = playerPos.z - n.z;
      n.near = dx * dx + dz * dz < 9;
      const pose = this._pose(n, dt, beat, n.near ? Math.atan2(dx, dz) - n.yaw : null);
      this.renderer.write(n.slot, n, pose);
    }
    this.renderer.setActiveCount?.(this.npcs.length);
  }

  _behave(n, dt) {
    const s = n.spec;
    if (n.behavior === 'patrol' && n.route?.length > 1 && n.startle <= 0) {
      if (n.wait > 0) { n.wait -= dt; n.speed *= Math.exp(-dt * 6); return; }
      const R = n.route;
      const tgt = R[(n.pi + 1) % R.length];
      const tx = tgt.x, tz = tgt.z;
      const dx = tx - n.lx, dz = tz - n.lz;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) { n.pi = (n.pi + 1) % R.length; if (tgt.key) n.wait = 1.5 + Math.random() * 4; return; }
      n.speed += ((s.speed || 1.05) - n.speed) * Math.min(1, dt * 4);
      n.lx += (dx / d) * n.speed * dt;
      n.lz += (dz / d) * n.speed * dt;
      const yaw = Math.atan2(dx, dz);
      n.yawL += Math.atan2(Math.sin(yaw - n.yawL), Math.cos(yaw - n.yawL)) * Math.min(1, dt * 8);
    } else {
      n.speed *= Math.exp(-dt * 6);
    }
  }

  _pose(n, dt, beat, lookYaw) {
    const p = n.pose || (n.pose = emptyPose());
    Object.assign(p, { thighL: 0, thighR: 0, kneeL: 0.05, kneeR: 0.05, armL: 0, armR: 0, elbowL: 0.2, elbowR: 0.2, armOut: 0.03, bob: 0, twist: 0, headYaw: 0, headPitch: 0, lean: 0, sit: 0, footPitch: 0 });
    const t = this.time + n.slot * 0.7;
    const mv = Math.min(1, n.speed / 1.0);
    if (mv > 0.05) {
      n.phase += dt * n.speed * 2.4;
      const s = Math.sin(n.phase);
      const A = 0.42 * mv;
      p.thighL = A * s; p.thighR = -A * s;
      p.kneeL = Math.max(0, -Math.sin(n.phase - 0.9)) * 0.55 * mv + 0.05;
      p.kneeR = Math.max(0, Math.sin(n.phase - 0.9)) * 0.55 * mv + 0.05;
      p.armL = -A * 0.75 * s; p.armR = A * 0.75 * s;
      p.bob = Math.abs(Math.cos(n.phase)) * 0.03 * mv;
    }
    switch (n.behavior) {
      case 'work': // limpando balcão / cozinhando
        p.armR = 0.9 + Math.sin(t * 3.1) * 0.25; p.elbowR = 0.9;
        p.armL = 0.6; p.elbowL = 0.8; p.armOut = 0.0 + Math.sin(t * 3.1) * 0.08;
        p.headPitch = 0.35;
        break;
      case 'sit':
      case 'talk':
        p.sit = 1; p.thighL = p.thighR = 1.5; p.kneeL = p.kneeR = 1.5;
        p.armL = 0.55; p.armR = 0.55 + (n.behavior === 'talk' ? Math.max(0, Math.sin(t * 1.7)) * 0.5 : 0);
        p.elbowL = p.elbowR = 0.9;
        p.headYaw = Math.sin(t * 0.6) * 0.4;
        if (n.behavior === 'talk') p.headPitch = Math.sin(t * 2.3) * 0.08;
        break;
      case 'dance': {
        const b = beat * Math.PI * 2;
        const st = n.danceStyle;
        p.bob = Math.abs(Math.sin(b / 2)) * 0.07 - 0.03;
        p.kneeL = 0.25 + Math.max(0, Math.sin(b / 2)) * 0.35;
        p.kneeR = 0.25 + Math.max(0, -Math.sin(b / 2)) * 0.35;
        p.thighL = 0.15 + Math.max(0, Math.sin(b / 2)) * 0.25;
        p.thighR = 0.15 + Math.max(0, -Math.sin(b / 2)) * 0.25;
        p.twist = Math.sin(b / 4) * 0.35;
        if (st === 0) { p.armL = 2.6 + Math.sin(b) * 0.3; p.armR = 0.4 + Math.sin(b + 1) * 0.5; p.elbowL = 0.3; p.elbowR = 1.2; }
        else if (st === 1) { p.armL = p.armR = 1.1 + Math.sin(b / 2) * 0.6; p.elbowL = p.elbowR = 1.4; p.armOut = 0.25; }
        else { p.armL = 0.9 + Math.sin(b / 2) * 0.9; p.armR = 0.9 - Math.sin(b / 2) * 0.9; p.elbowL = p.elbowR = 0.6; }
        p.headPitch = Math.sin(b) * 0.12;
        break;
      }
      case 'dj':
        p.armL = 1.0 + Math.sin(t * 2) * 0.1; p.armR = 1.05; p.elbowL = p.elbowR = 1.2;
        p.headPitch = Math.abs(Math.sin(beat * Math.PI)) * 0.25 - 0.05;
        p.bob = Math.abs(Math.sin(beat * Math.PI)) * 0.03;
        break;
      case 'guard':
        p.armL = p.armR = 0.35; p.elbowL = p.elbowR = 1.6; p.armOut = -0.2;
        p.headYaw = Math.sin(t * 0.4) * 0.6;
        break;
      default:
        p.headYaw = Math.sin(t * 0.5) * 0.4;
        p.armOut = 0.03;
    }
    if (lookYaw !== null && n.behavior !== 'dance') {
      p.headYaw = Math.max(-1, Math.min(1, Math.atan2(Math.sin(lookYaw), Math.cos(lookYaw))));
    }
    if (n.startle > 0) {
      const k = Math.min(1, n.startle);
      p.armL = p.armR = 2.3 * k + p.armL * (1 - k);
      p.elbowL = p.elbowR = 1.1 * k;
    }
    return p;
  }

  dispose() {
    this.clear();
    this.renderer.dispose();
  }
}
