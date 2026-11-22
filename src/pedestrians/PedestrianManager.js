import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { PedestrianRenderer, randomLook } from './PedestrianRenderer.js';
import { CitizenBrain } from '../city/CitizenBrain.js';
import { sidewalkPath } from '../city/Navigation.js';
import { boundsContains } from '../utils/bounds.js';

/**
 * Pedestres: rede de caminhos (calçadas dos dois lados de cada rua, faixas
 * de pedestres, calçadão e praia), objetivos simples com destino alcançável
 * (busca no grafo), máquina de estados e reações:
 *   WALK · IDLE · SIT · WAIT_CROSS · CROSS · STARTLED · FLEE · KNOCKED · GETUP
 * Colisão com o cenário pelo mesmo resolvedor do jogador (não atravessam
 * paredes, postes nem bancos); não andam sobre a água.
 */
const SIDE = 1.75;            // distância da borda da rua até a linha da calçada
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const STATES = { WALK: 'WALK', IDLE: 'IDLE', SIT: 'SIT', WAIT_CROSS: 'WAIT_CROSS', CROSS: 'CROSS', STARTLED: 'STARTLED', FLEE: 'FLEE', KNOCKED: 'KNOCKED', GETUP: 'GETUP', WATCH: 'WATCH', CHAT: 'CHAT' };

export class PedestrianManager {
  constructor(game, events) {
    this.game = game;
    this.events = events;
    this.cfg = CONFIG.city;
    const cap = Math.max(...Object.values(this.cfg.profiles).map((p) => p.peds));
    this.renderer = new PedestrianRenderer(game.scene, cap);
    // Sem pedestres ativos (ou simulação desligada): nenhuma draw call.
    this.renderer.group.visible = false;
    this.free = Array.from({ length: cap }, (_, i) => cap - 1 - i);
    this.peds = [];
    this.nodes = [];
    this.crosswalks = new Map();
    this.benches = [];
    this.max = 0;
    this.tick = 0;
    this.stats = { spawned: 0, recycled: 0, crossings: 0, flee: 0, knocked: 0, startled: 0, sits: 0, aiMs: 0 };
    this._serial = 0;
    events.on('propBreak', e => this._threat(e, 16, 'impact'));
    events.on('gunshot', (e) => this._threat(e, 40, 'gunshot'));
    events.on('horn', (e) => this._threat(e, 14, 'horn'));
    // Sirenes de viaturas em perseguição (PROMPT 08): pedestres olham e abrem espaço.
    events.on('siren', (e) => this._threat(e, 26, 'siren'));
  }

  // ------------------------------------------------------- rede de caminhos
  onMapActivated(env, traffic) {
    for (const p of [...this.peds]) this._release(p);
    this.env = env;
    this.traffic = traffic;
    this.nodes = [];
    this.crosswalks.clear();
    this.benches = [];
    const net = traffic.net, graph = traffic.graph;
    if (!net || !graph) { this.max = 0; return; }
    const prof = this.cfg.profiles[this.cfg.density] || this.cfg.profiles.medium;
    this.max = Math.round(prof.peds * (env.isImported ? 0.7 : 1));
    this.bounds = traffic.bounds;
    const col = env.collision;
    const blocked = (x, z) => {
      if (env.waterDepth?.(x, z) > 0.02) return true;
      if (env.boundaryHint?.(x, z, 0.6)) return true;
      // Obstáculo de verdade: topo acima do joelho e base abaixo da cabeça (lajes e meio-fios não contam).
      const gy = col.getGroundHeight(x, z, 0.6, 0.45);
      for (const c of col.queryCircle(x, z, 0.4)) if (c.solid && c.maxY > gy + 0.5 && c.minY < gy + 1.6) return true;
      return false;
    };
    const onRoad = (x, z) => !!net.roadAt(x, z, 0.3);
    const add = (x, z, region) => {
      const n = { i: this.nodes.length, x, z, y: col.getGroundHeight(x, z, 1, 0.5), links: [], region };
      this.nodes.push(n);
      return n;
    };
    const link = (a, b, cw = null) => {
      if (a === b || a.links.some((l) => l.to === b.i)) return;
      a.links.push({ to: b.i, cw });
      b.links.push({ to: a.i, cw });
    };
    const clear = (a, b) => {
      _v.set(a.x, a.y + 0.9, a.z);
      _w.set(b.x - a.x, 0, b.z - a.z);
      const len = _w.length();
      _w.divideScalar(len || 1);
      return col.sphereCast(_v, _w, len, 0.25, null) >= len - 0.05;
    };
    const chain = (pts, region) => {
      let prev = null;
      for (const [x, z] of pts) {
        if (blocked(x, z) || onRoad(x, z) || !this._inBounds(x, z)) { prev = null; continue; }
        const n = add(x, z, region);
        if (prev && Math.hypot(prev.x - x, prev.z - z) < 7 && clear(prev, n)) link(prev, n);
        prev = n;
      }
    };
    // Calçadas: linhas paralelas às ruas, dos dois lados.
    for (const road of net.roads.values()) {
      for (const side of [1, -1]) {
        const off = side * (road.width / 2 + SIDE);
        const pts = [];
        for (let t = 0; t <= road.length; t += 5) {
          const p = net.pointAt(road, t, off);
          pts.push([p.x, p.z]);
        }
        chain(pts, road.id);
      }
    }
    // Caminhos extras do mapa (calçadão, praia) — config por mapa ou manifesto.
    const extra = env.isImported ? env.manifest?.pedestrianPaths : this.cfg.pedestrianPaths?.[env.id || 'sunset-beach'];
    for (const path of extra || []) {
      const pts = [];
      const [ax, az] = path.from, [bx, bz] = path.to;
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 6);
      for (let k = 0; k <= n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
      chain(pts, path.region || 'extra');
    }
    // Esquinas e cruzamentos de cadeias próximas (sem atravessar ruas).
    const cell = new Map();
    const key = (x, z) => `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
    for (const n of this.nodes) { const k = key(n.x, n.z); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(n); }
    for (const n of this.nodes) {
      const cx = Math.floor(n.x / 8), cz = Math.floor(n.z / 8);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (const o of cell.get(`${cx + dx},${cz + dz}`) || []) {
          if (o.i <= n.i || n.links.some((l) => l.to === o.i)) continue;
          const d = Math.hypot(o.x - n.x, o.z - n.z);
          if (d > 6.5 || n.links.length > 3 && o.links.length > 3) continue;
          if (onRoad((o.x + n.x) / 2, (o.z + n.z) / 2) || !clear(n, o)) continue;
          link(n, o);
        }
      }
    }
    // Faixas de pedestres: ligam os dois lados da rua.
    for (const cw of net.crosswalks) {
      const road = net.roads.get(cw.roadId);
      if (!road) continue;
      const a = net.pointAt(road, cw.t, road.width / 2 + SIDE);
      const b = net.pointAt(road, cw.t, -(road.width / 2 + SIDE));
      const na = this._nearest(a.x, a.z, 5), nb = this._nearest(b.x, b.z, 5);
      if (!na || !nb) continue;
      const mid = net.pointAt(road, cw.t, 0);
      let signal = null;
      for (const n of net.intersections.values()) {
        if (n.control === 'signal' && Math.hypot(n.x - mid.x, n.z - mid.z) < 30) signal = graph.signals.get(n.id) || null;
      }
      const c = { id: cw.id, road, a: na.i, b: nb.i, signal, group: Math.abs(road.dir.z) > Math.abs(road.dir.x) ? 'ns' : 'ew', busy: 0, x: mid.x, z: mid.z };
      this.crosswalks.set(cw.id, c);
      link(na, nb, c);
    }
    // Bancos (sentar): colisores "bench" do mapa.
    for (const c of col.colliders.values()) {
      if (!/bench/i.test(c.id) || c.type === 'cyl') continue;
      if (c.raycastOnly) continue;
      this.benches.push({ x: c.cx, z: c.cz, rot: c.rotation || 0, hx: c.hx, hz: c.hz, top: c.maxY, used: null, collider: c });
    }
    // Remove nós isolados da escolha de destino (continuam válidos para posição).
    this.walkable = this.nodes.filter((n) => n.links.length > 0);
  }

  _inBounds(x, z) {
    return boundsContains(this.bounds, x, z, 2);
  }

  _nearest(x, z, maxD = 1e9) {
    let best = null, bd = maxD * maxD;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** Destino alcançável: passeio aleatório no grafo (evita voltar). */
  _route(startIdx, steps = 14 + Math.floor(Math.random() * 22), avoid = null) {
    const path = [startIdx];
    let prev = -1, cur = startIdx;
    for (let k = 0; k < steps; k++) {
      const n = this.nodes[cur];
      let opts = n.links.filter((l) => l.to !== prev);
      if (!opts.length) opts = n.links;
      if (!opts.length) break;
      if (avoid) {
        // Fuga: prefere vizinhos mais longe da ameaça.
        opts = [...opts].sort((a, b) => this._d2(this.nodes[b.to], avoid) - this._d2(this.nodes[a.to], avoid));
        opts = opts.slice(0, Math.max(1, Math.ceil(opts.length / 2)));
      } else {
        // Travessias de rua um pouco menos frequentes que seguir pela calçada.
        const w = opts.map((l) => (l.cw ? 0.45 : 1));
        let r = Math.random() * w.reduce((s, x) => s + x, 0);
        let pickL = opts[0];
        for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) { pickL = opts[i]; break; } }
        opts = [pickL];
      }
      const l = opts[Math.floor(Math.random() * opts.length)];
      prev = cur;
      cur = l.to;
      path.push(cur);
    }
    return path;
  }

  _d2(n, p) {
    return (n.x - p.x) ** 2 + (n.z - p.z) ** 2;
  }

  // -------------------------------------------------------------- ciclo
  update(dt) {
    if (!this.nodes.length || this.game.mapLoading) return;
    const t0 = performance.now();
    this.tick += dt;
    const player = this.traffic._playerPos();
    if (this.tick > 0.6) { this.tick = 0; this._population(player); }
    const vehicles = this.game.vehicles.list;
    const col = this.env.collision;
    for (const p of this.peds) {
      p.brain.update(dt, p.speed > 0.2);
      const dist = Math.hypot(p.x - player.x, p.z - player.z);
      const far = dist > 70;
      if (far && (this._frame = (this._frame || 0) + 1) % 3 !== 0 && p.state === STATES.WALK) { this._move(p, dt, true); continue; }
      this._think(p, dt, vehicles, player);
      this._move(p, dt, far);
      if (!far && p.state !== STATES.KNOCKED && p.state !== STATES.SIT) {
        _v.set(p.x, 0, p.z);
        col.resolveCircle(_v, p.y, 0.28, 1.7, 0.36, 2);
        p.x = _v.x; p.z = _v.z;
      }
    }
    this._separate();
    for (const p of this.peds) this.renderer.write(p.slot, p, this._pose(p, dt));
    this.renderer.group.visible = this.peds.length > 0;
    let top = 0;
    for (const p of this.peds) if (p.slot + 1 > top) top = p.slot + 1;
    this.renderer.setActiveCount(top);
    this.stats.aiMs = +(performance.now() - t0).toFixed(3);
  }

  _population(player) {
    for (const p of [...this.peds]) {
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d > 135 || (d > 95 && !this.traffic._visible(_v.set(p.x, p.y + 1, p.z), d))) this._release(p);
    }
    if (this.peds.length >= this.max || !this.free.length) return;
    const weights = this.cfg.pedRegionWeights;
    for (let k = 0; k < 10; k++) {
      const n = this.walkable[Math.floor(Math.random() * this.walkable.length)];
      if (!n || Math.random() > (weights[n.region] ?? 0.6)) continue;
      const d = Math.hypot(n.x - player.x, n.z - player.z);
      if (d < 18 || d > 85) continue;
      if (d < 60 && this.traffic._visible(_v.set(n.x, n.y + 1, n.z), d)) continue;
      if (this.peds.some((p) => Math.hypot(p.x - n.x, p.z - n.z) < 3)) continue;
      this._spawn(n);
      return;
    }
  }

  _spawn(n) {
    const slot = this.free.pop();
    const look = randomLook();
    const p = {
      id: `ped_${this._serial++}`, slot, look, x: n.x, y: n.y, z: n.z, yaw: Math.random() * Math.PI * 2,
      state: STATES.WALK, path: this._route(n.i), pi: 0, offset: (Math.random() - 0.5) * 1.1,
      walk: 1.15 + Math.random() * 0.4, speed: 0, phase: Math.random() * 6, timer: 0, wait: 0,
      onRoad: false, cw: null, threat: null, lie: 0, sit: 0, bench: null, look2: Math.random() * 10, startle: 0,
    };
    p.brain = new CitizenBrain({ id: p.id, style: look.style });
    p.walk *= p.brain.stride;
    p.senseT = 0;
    this.renderer.applyLook(slot, look);
    this.peds.push(p);
    this.stats.spawned++;
  }

  _release(p) {
    if (p.partner) { p.partner.partner = null; p.partner.timer = 0; p.partner = null; }
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
    if (p.cw) { p.cw.busy = Math.max(0, p.cw.busy - 1); p.cw = null; }
    if (p.bench) p.bench.used = null;
    this.renderer.hide(p.slot);
    this.free.push(p.slot);
    this.stats.recycled++;
  }

  // ---------------------------------------------------------- decisões
  _think(p, dt, vehicles, player) {
    p.timer -= dt;
    p.startle = Math.max(0, p.startle - dt);
    p.senseT -= dt;
    if (p.senseT <= 0) {
      p.senseT = 0.25;
      if (this.game.weapons?.aim > 0.5 && this.game.weapons.drawn) {
        const dx = p.x - player.x, dz = p.z - player.z;
        const d = Math.hypot(dx, dz);
        const heading = this.game.player.controller.yaw;
        if (d < 18 && (dx * Math.sin(heading) + dz * Math.cos(heading)) / (d || 1) > 0.88 && this._sees(p, player)) {
          this._react(p, { type: 'weaponAim', x: player.x, z: player.z }, d, true);
        }
      }
    }
    // Veículos: susto (passa perto) ou atropelamento (contato em velocidade).
    if (p.state !== STATES.KNOCKED && p.state !== STATES.GETUP) {
      for (const v of vehicles) {
        if (!v.root.visible) continue;
        const ph = v.physics;
        const vp = v.root.position;
        const dx = p.x - vp.x, dz = p.z - vp.z;
        if (dx * dx + dz * dz > 100) continue;
        const h = v.root.rotation.y, s = Math.sin(h), c = Math.cos(h);
        const fwd = dx * s + dz * c, lat = dx * c - dz * s;
        const speed = ph?.awake ? Math.abs(ph.vLong) : (this.traffic.agents.find((a) => a.v === v)?.speed || 0);
        if (speed < 1.2) continue;
        const hl = v.spec.length / 2, hw = v.spec.width / 2;
        if (Math.abs(fwd) < hl + 0.25 && Math.abs(lat) < hw + 0.25 && speed > 3) {
          this._knock(p, s, c, speed, v);
          break;
        }
        if (fwd > 0 && fwd < hl + 2 + speed * 0.9 && Math.abs(lat) < hw + 1.3 && p.state !== STATES.STARTLED && p.state !== STATES.FLEE) {
          p.prevState = p.state === STATES.CROSS ? STATES.CROSS : STATES.WALK;
          p.state = STATES.STARTLED;
          p.timer = 0.7;
          p.dodge = { x: lat >= 0 ? c : -c, z: lat >= 0 ? -s : s };
          this.stats.startled++;
          break;
        }
      }
    }
    switch (p.state) {
      case STATES.WALK: {
        if (p.pi >= p.path.length - 1) {
          // Chegou: às vezes senta num banco próximo; senão fica parado um pouco.
          const bench = this._benchNear(p);
          const buddy = this.peds.find(o => o !== p && !o.onRoad && ['WALK', 'IDLE'].includes(o.state) && o.brain.fear < 0.2 && Math.hypot(o.x - p.x, o.z - p.z) < 3);
          const activity = p.brain.chooseActivity({ canRest: !!bench, canChat: !!buddy, canVisit: !!this.env.pois?.length });
          if (activity === 'chat' && buddy) {
            p.state = buddy.state = STATES.CHAT; p.partner = buddy; buddy.partner = p;
            p.timer = buddy.timer = 5 + p.brain.sociability * 4;
            buddy.brain.goal = 'chat'; buddy.brain.goalUntil = buddy.brain.time + p.timer;
            break;
          }
          if (activity === 'visit' && this._visit(p)) break;
          const b = activity === 'rest' ? bench : null;
          if (b) { p.bench = b; b.used = p; p.state = STATES.SIT; p.timer = 12 + Math.random() * 20; this.stats.sits++; }
          else { p.state = STATES.IDLE; p.timer = 2 + Math.random() * 6; }
          break;
        }
        const cur = this.nodes[p.path[p.pi]], nxt = this.nodes[p.path[p.pi + 1]];
        const l = cur.links.find((k) => k.to === nxt.i);
        if (l?.cw && Math.hypot(p.x - cur.x, p.z - cur.z) < 1.2) { p.cw = l.cw; p.state = STATES.WAIT_CROSS; p.wait = 0; }
        break;
      }
      case STATES.IDLE:
        if (p.timer <= 0) { p.path = this._route(p.path[p.path.length - 1]); p.pi = 0; p.state = STATES.WALK; }
        break;
      case STATES.WATCH:
      case STATES.CHAT:
        if (p.state === STATES.CHAT && p.partner && p.partner.state === STATES.CHAT) {
          p.lookAt = p.partner; p.startle = 0.01;
          const yaw = Math.atan2(p.partner.x - p.x, p.partner.z - p.z);
          p.yaw += Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw)) * Math.min(1, dt * 3);
        } else if (p.state === STATES.CHAT) p.timer = 0;
        if (p.timer <= 0) {
          p.partner = null;
          const n = this._nearest(p.x, p.z, 15);
          if (n) { p.path = this._route(n.i); p.pi = 0; }
          p.state = STATES.WALK;
        }
        break;
      case STATES.SIT:
        p.sit = Math.min(1, p.sit + dt * 2);
        if (!p.bench?.collider.solid) p.timer = 0;
        if (p.timer <= 0) {
          if (p.bench) p.bench.used = null;
          p.bench = null;
          const n = this._nearest(p.x, p.z, 15);
          if (n) { p.path = this._route(n.i); p.pi = 0; }
          p.state = STATES.WALK;
        }
        break;
      case STATES.WAIT_CROSS: {
        p.wait += dt;
        if (this._canCross(p.cw, p.wait)) {
          p.state = STATES.CROSS;
          p.cw.busy++;
          p.onRoad = true;
          p.crossT = 0;
          this.stats.crossings++;
        }
        break;
      }
      case STATES.CROSS:
        p.crossT += dt;
        break;
      case STATES.STARTLED:
        if (p.timer <= 0) p.state = p.prevState || STATES.WALK;
        break;
      case STATES.FLEE:
        if (p.timer <= 0 && p.brain.goal !== 'flee') { p.state = STATES.WALK; p.fleeing = 0; }
        break;
      case STATES.KNOCKED:
        p.lie = Math.min(1, p.lie + dt * 4);
        if (p.timer <= 0) { p.state = STATES.GETUP; p.timer = 1.2; }
        break;
      case STATES.GETUP:
        p.lie = Math.max(0, p.lie - dt / 1.2);
        if (p.timer <= 0) {
          p.lie = 0;
          p.onRoad = false;
          const n = this._nearest(p.x, p.z, 25);
          if (n) { p.path = this._route(n.i, 20, { x: p.x, z: p.z }); p.pi = 0; }
          p.state = STATES.WALK;
        }
        break;
      default:
        break;
    }
    if (p.state !== STATES.SIT) p.sit = Math.max(0, p.sit - dt * 2);
  }

  _canCross(cw, wait) {
    if (cw.signal && !cw.signal.failed) {
      // Só com o fluxo da rua atravessada parado e tempo de sobra no vermelho.
      const st = cw.signal.getState(cw.group);
      if (st !== 'red' || cw.signal.timeInState(cw.group) < 5) return false;
    }
    // Brecha no trânsito: nada se aproximando rápido da travessia.
    const limit = wait > 20 ? 8 : 26;
    for (const v of this.game.vehicles.list) {
      if (!v.root.visible) continue;
      const vp = v.root.position;
      const d = Math.hypot(vp.x - cw.x, vp.z - cw.z);
      if (d > limit) continue;
      const a = this.traffic.agents.find((x) => x.v === v);
      const speed = a ? a.speed : Math.abs(v.physics?.vLong || 0);
      if (d < 6.5) return false; // carro sobre a faixa
      if (speed > 1.5) {
        const h = v.root.rotation.y;
        const toward = (cw.x - vp.x) * Math.sin(h) + (cw.z - vp.z) * Math.cos(h);
        if (toward > 0) return false;
      }
    }
    return true;
  }

  _benchNear(p) {
    let best = null, bd = 14 * 14;
    for (const b of this.benches) {
      if (b.used || !b.collider.solid) continue;
      const d = (b.x - p.x) ** 2 + (b.z - p.z) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  _knock(p, s, c, speed, v) {
    if (p.cw && p.state === STATES.CROSS) { /* continua marcado como ocupando a pista */ }
    p.state = STATES.KNOCKED;
    p.timer = 2.6;
    p.onRoad = !!this.traffic.net.roadAt(p.x, p.z, 0.2);
    // Empurrão no sentido do carro (sem ragdoll).
    p.knockV = { x: s * Math.min(6, speed * 0.6), z: c * Math.min(6, speed * 0.6) };
    p.yaw = Math.atan2(-s, -c);
    this.stats.knocked++;
    this.events.emit('pedHit', { x: p.x, z: p.z, id: p.id, vehicleId: v.id, speed });
  }

  _threat(e, radius, kind) {
    for (const p of this.peds) {
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d > radius || p.state === STATES.KNOCKED || p.state === STATES.GETUP) continue;
      this._react(p, { ...e, type: e.type || kind }, d, this._sees(p, e));
    }
  }

  _sees(p, target) {
    _v.set(p.x, p.y + 1.4, p.z);
    _w.set(target.x - p.x, 0, target.z - p.z);
    const distance = _w.length();
    _w.divideScalar(distance || 1);
    return this.env.collision.sphereCast(_v, _w, distance, 0.04, null) >= distance - 0.3;
  }

  _react(p, event, distance, visible) {
    if (!p.brain.perceive(event, { distance, visible })) return;
    p.lookAt = { x: event.x, z: event.z }; p.startle = 0.5;
    if (event.type === 'horn') return;
    if (p.bench) { p.bench.used = null; p.bench = null; }
    p.partner = null;
    if (p.cw && p.state === STATES.WAIT_CROSS) p.cw = null;
    const fleeing = p.brain.goal === 'flee';
    if (p.state !== STATES.CROSS) {
      if (fleeing) {
        const node = this._nearest(p.x, p.z, 20);
        if (node) { p.path = this._route(node.i, Math.max(8, Math.ceil(p.brain.profile.fleeDistance / 3)), p.brain.threat); p.pi = 0; }
      }
      p.state = fleeing ? STATES.FLEE : STATES.WATCH;
    }
    p.timer = p.brain.goalUntil - p.brain.time;
    p.fleeing = fleeing ? p.timer : 0;
    if (fleeing) this.stats.flee++;
  }

  _visit(p) {
    const start = this._nearest(p.x, p.z, 10);
    if (!start) return false;
    const points = (this.env.pois || []).filter(poi => poi.type === 'entrance' && Math.hypot(poi.x - p.x, poi.z - p.z) < 85);
    if (!points.length) return false;
    const poi = points[Math.floor(Math.random() * points.length)];
    const end = this._nearest(poi.x, poi.z, 12);
    const path = end && sidewalkPath(this.nodes, start.i, end.i);
    if (!path || path.length < 2) return false;
    p.path = path; p.pi = 0; p.destination = poi.label; p.state = STATES.WALK;
    return true;
  }

  // --------------------------------------------------------- movimento
  _move(p, dt, far) {
    p.fleeing = Math.max(0, (p.fleeing || 0) - dt);
    let target = null, speed = 0;
    if (p.state === STATES.WALK || p.state === STATES.FLEE || p.state === STATES.CROSS) {
      const nxt = this.nodes[p.path[Math.min(p.pi + 1, p.path.length - 1)]];
      const cur = this.nodes[p.path[p.pi]];
      if (nxt && cur) {
        // Deslocamento lateral próprio (não andam todos na mesma linha).
        const ex = nxt.x - cur.x, ez = nxt.z - cur.z;
        const el = Math.hypot(ex, ez) || 1;
        const off = p.state === STATES.CROSS ? p.offset * 0.5 : p.offset;
        target = _w.set(nxt.x - (ez / el) * off, 0, nxt.z + (ex / el) * off);
        speed = p.state === STATES.FLEE || p.fleeing > 0 ? p.brain.fleeSpeed : p.state === STATES.CROSS ? p.walk * 1.15 : p.walk;
        if (Math.hypot(p.x - target.x, p.z - target.z) < 0.7) {
          p.pi++;
          if (p.state === STATES.CROSS && p.cw && (p.path[p.pi] === p.cw.a || p.path[p.pi] === p.cw.b)) {
            p.cw.busy = Math.max(0, p.cw.busy - 1);
            p.cw = null;
            p.onRoad = false;
            p.state = STATES.WALK;
          }
          if (p.pi >= p.path.length - 1 && p.state === STATES.FLEE) { p.path = this._route(p.path[p.path.length - 1], 10); p.pi = 0; }
        }
      }
    } else if (p.state === STATES.STARTLED && p.dodge) {
      p.x += p.dodge.x * 2.2 * dt;
      p.z += p.dodge.z * 2.2 * dt;
    } else if (p.state === STATES.KNOCKED && p.knockV) {
      p.x += p.knockV.x * dt;
      p.z += p.knockV.z * dt;
      p.knockV.x *= Math.exp(-dt * 4);
      p.knockV.z *= Math.exp(-dt * 4);
    } else if (p.state === STATES.SIT && p.bench) {
      const b = p.bench;
      p.x += (b.x - p.x) * Math.min(1, dt * 4);
      p.z += (b.z - p.z) * Math.min(1, dt * 4);
      const yaw = this._benchYaw(b);
      p.yaw += Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw)) * Math.min(1, dt * 5);
    }
    if (target) {
      const dx = target.x - p.x, dz = target.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      p.speed += (speed - p.speed) * Math.min(1, dt * 4);
      p.x += (dx / d) * p.speed * dt;
      p.z += (dz / d) * p.speed * dt;
      const yaw = Math.atan2(dx, dz);
      p.yaw += Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw)) * Math.min(1, dt * p.brain.turnRate);
    } else {
      p.speed *= Math.exp(-dt * 8);
    }
    if (!far || (this._frame % 6) === 0) p.y = this.env.collision.getGroundHeight(p.x, p.z, p.y + 0.5, 0.45);
  }

  _benchYaw(b) {
    // De frente para a rua mais próxima.
    const road = this.traffic.net.roadAt(b.x, b.z, 25);
    if (!road) return b.rot;
    const pr = this.traffic.net.project(road, b.x, b.z);
    const sgn = pr.s > 0 ? -1 : 1;
    return Math.atan2(road.right.x * sgn, road.right.z * sgn);
  }

  _separate() {
    const P = this.peds;
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        const a = P[i], b = P[j];
        if (a.state === STATES.SIT || b.state === STATES.SIT) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.49 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (0.7 - d) * 0.5;
        a.x -= (dx / d) * push; a.z -= (dz / d) * push;
        b.x += (dx / d) * push; b.z += (dz / d) * push;
      }
    }
  }

  // ------------------------------------------------------- animação
  _pose(p, dt) {
    const pose = p.pose || (p.pose = { thighL: 0, thighR: 0, kneeL: 0, kneeR: 0, armL: 0, armR: 0, elbowL: 0, elbowR: 0, armOut: 0, bob: 0, twist: 0, headYaw: 0, headPitch: 0, lean: 0, sit: 0, lie: 0, footPitch: 0 });
    const run = Math.min(1, Math.max(0, (p.speed - 2) / 1.8));
    const mv = Math.min(1, p.speed / 1.1);
    p.phase += dt * (p.speed * (2.4 - run * 0.6) / p.brain.stride + 0.0001);
    const s = Math.sin(p.phase), c = Math.cos(p.phase);
    const A = (0.42 + run * 0.45) * mv;
    pose.thighL = A * s;
    pose.thighR = -A * s;
    pose.kneeL = Math.max(0, -Math.sin(p.phase - 0.9)) * (0.55 + run * 0.7) * mv + 0.05;
    pose.kneeR = Math.max(0, Math.sin(p.phase - 0.9)) * (0.55 + run * 0.7) * mv + 0.05;
    pose.armL = -A * 0.75 * s;
    pose.armR = A * 0.75 * s;
    pose.elbowL = pose.elbowR = 0.22 + run * 0.95;
    pose.armOut = 0.02 + run * 0.08;
    pose.bob = Math.abs(c) * 0.03 * mv - run * 0.02;
    pose.twist = -s * 0.08 * mv;
    pose.lean = run * 0.18 + (1 - mv) * Math.sin(p.look2 + p.phase * 0.2) * 0.01;
    pose.footPitch = 0;
    // Parado: respiração e olhar ao redor.
    p.look2 += dt;
    pose.headYaw = (1 - mv) * Math.sin(p.look2 * 0.4) * 0.5;
    pose.headPitch = 0;
    if (p.state === STATES.CHAT) {
      pose.armR = 0.4 + Math.sin(p.look2 * 2.6) * 0.2;
      pose.elbowR = 0.9;
      pose.headPitch = Math.sin(p.look2 * 3) * 0.06;
    }
    if (p.state === STATES.WATCH && p.brain.anger > 0.2) { pose.armR = 0.7; pose.elbowR = 1.1; }
    if (p.lookAt) {
      const yaw = Math.atan2(p.lookAt.x - p.x, p.lookAt.z - p.z) - p.yaw;
      pose.headYaw = Math.max(-1, Math.min(1, Math.atan2(Math.sin(yaw), Math.cos(yaw))));
      if (p.startle <= 0) p.lookAt = null;
    }
    // Susto: braços para cima por um instante.
    if (p.startle > 0 || p.state === STATES.STARTLED) {
      const k = Math.min(1, (p.startle || 0.4) / 0.4);
      pose.armL = pose.armR = 2.1 * k + pose.armL * (1 - k);
      pose.elbowL = pose.elbowR = 1.2 * k;
      pose.armOut = 0.35 * k;
    }
    // Sentado.
    pose.sit = p.sit;
    if (p.sit > 0) {
      const k = p.sit;
      pose.thighL = pose.thighL * (1 - k) + 1.5 * k;
      pose.thighR = pose.thighR * (1 - k) + 1.5 * k;
      pose.kneeL = pose.kneeL * (1 - k) + 1.5 * k;
      pose.kneeR = pose.kneeR * (1 - k) + 1.5 * k;
      pose.armL = pose.armR = 0.45 * k;
      pose.elbowL = pose.elbowR = 0.75 * k;
    }
    // Atropelado: deitado (sem ragdoll), pernas e braços relaxados.
    pose.lie = p.lie;
    if (p.lie > 0) {
      pose.thighL = 0.2; pose.thighR = -0.1; pose.kneeL = 0.4; pose.kneeR = 0.2;
      pose.armL = 1.2; pose.armR = 0.6; pose.elbowL = 0.4; pose.elbowR = 0.6;
    }
    return pose;
  }

  // -------------------------------------------------------- consultas
  crosswalkBusy(id) {
    const c = this.crosswalks.get(id);
    return !!c && c.busy > 0;
  }

  onRoad() {
    return this.peds.filter((p) => p.onRoad);
  }

  summary() {
    const states = {};
    for (const p of this.peds) states[p.state] = (states[p.state] || 0) + 1;
    return { peds: this.peds.length, max: this.max, nodes: this.nodes.length, links: this.nodes.reduce((s, n) => s + n.links.length, 0) / 2, crosswalks: this.crosswalks.size, benches: this.benches.length, states, styles: [...new Set(this.peds.map((p) => p.look.style))], ...this.stats };
  }
}
