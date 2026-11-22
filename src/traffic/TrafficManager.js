import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { RoadNetwork } from '../world/RoadNetwork.js';
import { LaneGraph, Path } from './LaneGraph.js';
import { TrafficVehicleAI, PERSONALITIES, STATES } from './TrafficVehicleAI.js';
import { buildImpostor, setImpostor } from './VehicleImpostor.js';
import { laneRoute } from '../city/Navigation.js';
import { TRAFFIC_BASE, trafficWeights, neonZoneAt } from '../vehicles/models/NeonMotor.js';
import { motoTrafficWeights } from '../vehicles/models/NeonMoto.js';
import { SPECS } from '../vehicles/VehicleFactory.js';

/**
 * Trânsito de Sunset Beach (e de mapas com metadados de ruas).
 *
 * - Rede: LaneGraph sobre o RoadNetwork do mapa (ou `manifest.roads`).
 * - População: veículos surgem fora da vista, a distância, em faixas válidas;
 *   são reciclados longe do jogador (pool, sem recriar geometria).
 * - Níveis de simulação: perto = IA completa + física existente;
 *   longe = movimento cinemático na faixa, decisões em frequência menor.
 * - Cruzamentos: semáforos existentes (fases ns/ew, nunca verdes conflitantes),
 *   placa PARE com reserva do cruzamento (ordem de chegada), conversão à
 *   esquerda cedendo ao fluxo oposto.
 * - Estacionamento nas vagas do RoadNetwork; o jogador pode usar um carro
 *   estacionado (ele sai do controle do trânsito, sem duplicação).
 */
// Modelos e pesos (PROMPT 12): os três procedurais + nove da NEON MOTOR COMPANY, com peso por zona.
const TYPES = TRAFFIC_BASE;
const COLORS = [0xf2eee6, 0xff6fa8, 0x3fd8d0, 0x8fd3ff, 0xd6c29a, 0xe8e2d0, 0x2b2d42, 0xc0392b, 0xf4d35e, 0x6a4c93, 0x1b998b, 0xfafafa, 0x1a1a1e, 0xff9a4a];
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

function pickWeighted(list, w = (x) => x[1]) {
  let total = 0;
  for (const x of list) total += w(x);
  let r = Math.random() * total;
  for (const x of list) { r -= w(x); if (r <= 0) return x; }
  return list[list.length - 1];
}

export class TrafficManager {
  constructor(game, events) {
    this.game = game;
    this.events = events;
    this.cfg = CONFIG.city;
    this.agents = [];
    this.pool = [];
    this.graph = null;
    this.env = null;
    this.nodeOcc = new Map();
    this.spots = [];
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    game.scene.add(this.group);
    this.tick = 0;
    this._serial = 0;
    this._hornGlobal = 0;
    this.stats = { spawned: 0, recycled: 0, recoveries: 0, parked: 0, pulledOut: 0, aiMs: 0, created: 0, takenByPlayer: 0 };
    this.debug = null;
    this.maxAgents = 0;
    events.on('gunshot', (e) => this._onGunshot(e));
    events.on('collision', e => {
      for (const a of this.agents) {
        const p = a.v.root.position, distance = Math.hypot(p.x - e.x, p.z - e.z);
        a.brain.perceive(e, { distance, visible: true });
        if (e.vehicleId === a.v.id && e.speed > 7) a.emergencyStop = true;
      }
    });
  }

  // ---------------------------------------------------------- mapa
  onMapActivated(env) {
    for (const a of [...this.agents]) this._release(a);
    this.env = env;
    this.nodeOcc.clear();
    this.graph = null;
    const built = this._network(env);
    if (!built) { this.maxAgents = 0; return; }
    const { net, bounds } = built;
    this.net = net;
    this.bounds = bounds;
    this.graph = new LaneGraph(net, bounds, { signals: env.trafficSignals || [] });
    this._buildSpots(net, bounds);
    const prof = this.cfg.profiles[this.cfg.density] || this.cfg.profiles.medium;
    this.maxAgents = Math.round(prof.vehicles * (env.isImported ? 0.8 : 1));
    this.range = env.isImported ? this.cfg.importedRange : this.cfg.range;
    this.debug?.rebuild(this);
  }

  /** Rede viária: a do mundo procedural ou metadados opcionais do manifesto. */
  _network(env) {
    if (!env.isImported) {
      const b = env.bounds || env.districts?.[0]?.bounds;
      return env.roads?.roads?.size ? { net: env.roads, bounds: b } : null;
    }
    const m = env.manifest;
    if (!m?.roads?.length) return null; // manifestos antigos: sem trânsito
    const net = new RoadNetwork();
    for (const r of m.roads) net.addRoad(r);
    for (const i of m.intersections || []) net.addIntersection(i);
    for (const c of m.crosswalks || []) net.addCrosswalk(c);
    return { net, bounds: m.bounds };
  }

  _buildSpots(net, bounds) {
    const vm = this.game.vehicles;
    this.spots = net.getParkingSpots(6.4, bounds).filter((sp) => {
      if (this.env.waterDepth?.(sp.x, sp.z) > 0.05) return false;
      const col = this.env.collision;
      const body = { x: sp.x, z: sp.z, rot: sp.heading, hx: 1.0, hz: 2.4 };
      return col.resolveOBB(body, 0.05, 1.2, 0.3, null, this._contacts || (this._contacts = []), 1) === 0;
    });
    // Vagas já ocupadas pelos carros estacionados do mapa.
    for (const sp of this.spots) {
      sp.occupied = vm.list.some((v) => Math.hypot(v.root.position.x - sp.x, v.root.position.z - sp.z) < 4);
      sp.agent = null;
    }
    // Associa cada vaga ao segmento da faixa externa do mesmo lado.
    for (const seg of this.graph.segments) seg.spots = [];
    for (const sp of this.spots) {
      let best = null, bd = 6, bs = 0;
      for (const seg of this.graph.segments) {
        if (seg.road.id !== sp.roadId || seg.laneIndex !== seg.lanesPerDirection - 1) continue;
        if ((sp.laneId.endsWith('_pR')) !== seg.lane.forward) continue;
        const pr = seg.path.project(_v.set(sp.x, 0, sp.z));
        if (pr.dist < bd && pr.s > 12 && pr.s < seg.path.length - 10) { bd = pr.dist; best = seg; bs = pr.s; }
      }
      if (best) { best.spots.push({ spot: sp, s: bs }); sp.seg = best; sp.s = bs; }
    }
  }

  // ----------------------------------------------------------- ciclo
  /** Antes da física: decisões e comandos. */
  update(dt) {
    if (!this.graph || this.game.mapLoading) return;
    const t0 = performance.now();
    this.tick += dt;
    this._hornGlobal -= dt;
    const player = this._playerPos();
    if (this.tick >= 0.5) {
      this.tick = 0;
      this._population(player);
    }
    const obstacles = this._obstacles();
    const cam = this.game.camera.position;
    for (const a of this.agents) {
      a.brain.update(dt, a.speed > 0.5);
      if (a.brain.goal === 'flee') a.panicT = Math.max(a.panicT, 2);
      const dist = Math.hypot(a.v.root.position.x - player.x, a.v.root.position.z - player.z);
      // LOD visual: impostor de malha única longe da câmera.
      setImpostor(a.v, a.v.root.position.distanceTo(cam) > this.cfg.impostorDistance && a.v.driver !== 'player');
      if (a.state === STATES.PARKED) { this._parkedTick(a, dt, player); continue; }
      if (a.emergencyStop) {
        a.acc = -5;
        a.v.controls.throttle = 0; a.v.controls.brake = 1;
        a.reason = 'parando após colisão';
        if (a.speed < 0.6) {
          this._parked(a);
          this.game.city?.occupants?.abandon(a);
        }
        continue;
      }
      this._lod(a, dist);
      a.panicT = Math.max(0, a.panicT - dt);
      a.hornCd -= dt;
      a.decideT -= dt;
      if (a.decideT <= 0) {
        const period = a.mode === 'phys' ? 0.05 : dist < 120 ? 0.12 : 0.3;
        a.decideT = period;
        a.decide(period, obstacles);
        a.emergencyYield = !!this.game.city?.police?.emergencyBehind(a);
        if (a.emergencyYield) {
          a.acc = Math.min(a.acc, -1.6); a.reason = 'cedendo à sirene'; a.blockedLegit = true;
        }
        this._reactions(a, dist, period);
        this._congestion(a, dist, period, player);
      }
      if (a.mode === 'phys') a.applyControls(dt);
    }
    this.stats.aiMs = +(performance.now() - t0).toFixed(3);
  }

  /** Depois da física: progresso na rota e movimento cinemático. */
  postUpdate(dt) {
    if (!this.graph) return;
    for (const a of [...this.agents]) {
      if (a.state === STATES.PARKED) continue;
      let r;
      if (a.mode === 'phys') r = a.syncFromPhysics();
      else r = a.kinStep(dt);
      if (r === 'sink') this._release(a);
      else if (a.el.kind === 'park' && !a.el.to && a.el.path.length - a.s < 1.6 && a.speed < 0.3) this._parked(a);
    }
    this.debug?.update(this);
  }

  _playerPos() {
    const g = this.game;
    const pv = g.vehicles.playerVehicle;
    return pv ? pv.root.position : g.player.visualPosition;
  }

  _visible(p, dist) {
    const cam = this.game.camera;
    if (dist > 140) return false;
    cam.getWorldDirection(_f);
    _v.subVectors(p, cam.position);
    const len = _v.length();
    if (len < 12) return true;
    return _v.dot(_f) / len > 0.35;
  }

  // ------------------------------------------------- população e LOD
  _population(player) {
    // Jogador assumiu um carro estacionado do trânsito: sai do controle.
    for (const a of [...this.agents]) {
      if (a.v.driver === 'player') {
        setImpostor(a.v, false);
        this.game.city?.occupants?.release(a, true);
        this.agents.splice(this.agents.indexOf(a), 1);
        if (a.parkSpot) { a.parkSpot.agent = null; a.parkSpot.occupied = false; a.parkSpot = null; }
        this.stats.takenByPlayer++;
      }
    }
    // Reciclagem longe do jogador e fora da vista.
    const R = this.range;
    for (const a of [...this.agents]) {
      const p = a.v.root.position;
      const dist = Math.hypot(p.x - player.x, p.z - player.z);
      if (dist > R.max + 40 || (dist > R.max && !this._visible(p, dist))) this._release(a);
    }
    // Surgimento: um por ciclo, até o limite da densidade.
    if (this.agents.length < this.maxAgents) this._trySpawn(player);
  }

  _trySpawn(player) {
    if (this.game.city?.occupants && !this.game.city.occupants.free.length) return null;
    const R = this.range;
    const segs = this.graph.segments;
    const weights = this.cfg.roadWeights;
    for (let attempt = 0; attempt < 12; attempt++) {
      const seg = pickWeighted(segs, (s) => s.path.length * (weights[s.road.id] ?? 0.5));
      if (seg.path.length < 24) continue;
      const s = 10 + Math.random() * (seg.path.length - 20);
      seg.path.sample(s, _v);
      if (this.bounds && (_v.x < this.bounds.minX + 3 || _v.x > this.bounds.maxX - 3 || _v.z < this.bounds.minZ + 3 || _v.z > this.bounds.maxZ - 3)) continue;
      const dist = Math.hypot(_v.x - player.x, _v.z - player.z);
      if (dist < R.min || dist > R.max) continue;
      if (this._visible(_v, dist)) continue;
      if (this.game.vehicles.list.some((v) => (v.root.position.x - _v.x) ** 2 + (v.root.position.z - _v.z) ** 2 < 16 * 16)) continue;
      const v = this._acquire(_v.x, _v.z);
      if (!v) return;
      const pk = pickWeighted(Object.entries(PERSONALITIES), ([, p]) => p.weight)[0];
      const a = new TrafficVehicleAI(this, v, pk);
      a.place(seg, s, seg.speedLimit * 0.7);
      v.driver = 'ai';
      v.engineOn = true;
      v.controls.handbrake = false;
      v.controls.brake = 0;
      v.root.visible = true;
      a.kinStep(0);
      v.attachCollider(this.env.collision);
      this.game.vehicles.addVehicle(v);
      v.physics.awake = false;
      this.agents.push(a);
      this.assignDestination(a, seg);
      if (this.game.city?.occupants && !this.game.city.occupants.attach(a)) { this._release(a); return null; }
      this.stats.spawned++;
      return a;
    }
    return null;
  }

  _acquire(x, z) {
    // Modelo sorteado pelos pesos da zona; reaproveita um carro do mesmo modelo
    // do pool (ou qualquer um, se o pool já estiver grande) antes de criar outro.
    // Motos (PROMPT 15) entram no mesmo sorteio: básicas comuns, customs menos, esportivas raras.
    const factory = this.game.world.vehicleFactory;
    const motoW = motoTrafficWeights(Number.isFinite(x) ? neonZoneAt(x, z) : null, (t) => factory.moto?.has(t));
    const want = pickWeighted([...(Number.isFinite(x) ? trafficWeights(x, z) : TYPES), ...motoW])[0];
    const same = this.pool.findIndex((p) => p.type === want);
    if (same >= 0) return this.pool.splice(same, 1)[0];
    if (this.pool.length >= 6) return this.pool.pop();
    // Cria um veículo novo (no máximo um por ciclo de população).
    const type = want;
    // Motos mantêm a pintura de fábrica (esquemas de cor do modelo).
    const color = SPECS[type]?.bike ? undefined : COLORS[Math.floor(Math.random() * COLORS.length)];
    const id = `traffic_${this._serial++}`;
    const plate = `SB ${String(1000 + Math.floor(Math.random() * 8999))}`;
    const v = factory.create(type, { id, color, stripe: Math.random() < 0.3 ? 0xff4fb8 : null, plate });
    this.group.add(v.root);
    // Motos usam o LOD próprio (VehicleManager); carros, o impostor de malha única.
    v.impostor = v.bike ? null : buildImpostor(v);
    this.stats.created++;
    return v;
  }

  _release(a) {
    this.game.city?.occupants?.release(a, true);
    const i = this.agents.indexOf(a);
    if (i >= 0) this.agents.splice(i, 1);
    const v = a.v;
    for (const set of this.nodeOcc.values()) set.delete(a);
    if (a.parkSpot) { a.parkSpot.agent = null; a.parkSpot.occupied = false; a.parkSpot = null; }
    if (v.driver === 'player') return; // nunca remove o carro do jogador
    if (!this.game.vehicles.removeVehicle(v)) return;
    if (v.collision && v.colliderId) v.collision.remove(v.colliderId);
    v.colliderId = null;
    v.collider = null;
    v.root.visible = false;
    v.driver = null;
    v.engineOn = false;
    if (v.physics) v.physics.awake = false;
    this.pool.push(v);
    this.stats.recycled++;
  }

  _lod(a, dist) {
    const ph = a.v.physics;
    if (a.mode === 'kin' && dist < this.cfg.physicsNear) {
      ph.syncFromRoot();
      const h = a.v.root.rotation.y;
      ph.vx = Math.sin(h) * a.speed;
      ph.vz = Math.cos(h) * a.speed;
      ph.vLong = a.speed;
      ph.wake();
      a.mode = 'phys';
    } else if (a.mode === 'phys' && dist > this.cfg.physicsNear + 12) {
      a.speed = Math.max(0, ph.vLong);
      ph.awake = false;
      a.mode = 'kin';
    }
  }

  /** Obstáculos dinâmicos: veículos, jogador a pé e pedestres na pista. */
  _obstacles() {
    const out = this._obs || (this._obs = []);
    out.length = 0;
    const byV = this._agentByV || (this._agentByV = new Map());
    byV.clear();
    for (const a of this.agents) byV.set(a.v, a);
    for (const v of this.game.vehicles.list) {
      if (!v.root.visible) continue;
      const a = byV.get(v);
      const speed = a ? a.speed : Math.abs(v.physics?.vLong || 0);
      out.push({ v, x: v.root.position.x, z: v.root.position.z, speed, halfLen: v.spec.length / 2, halfWid: v.spec.width / 2, kind: v.driver === 'player' ? 'playerCar' : 'car' });
    }
    const g = this.game;
    if (g.vehicles.interaction.onFoot) {
      const p = g.player.visualPosition;
      out.push({ v: null, x: p.x, z: p.z, speed: 0, halfLen: 0.4, halfWid: 0.4, kind: 'player' });
    }
    const peds = g.city?.peds;
    if (peds) for (const ped of peds.onRoad()) out.push({ v: null, x: ped.x, z: ped.z, speed: 0, halfLen: 0.35, halfWid: 0.35, kind: 'ped' });
    for (const actor of g.city?.occupants?.onRoad() || []) out.push({ v: null, x: actor.x, z: actor.z, speed: 0, halfLen: 0.35, halfWid: 0.35, kind: 'ped' });
    return out;
  }

  // --------------------------------------------------------- cruzamentos
  _onEnterNode(a, con) {
    if (!con.node) return;
    let set = this.nodeOcc.get(con.node.id);
    if (!set) this.nodeOcc.set(con.node.id, (set = new Set()));
    set.add(a);
    a.conInNode = con;
  }

  _onLeave(a, el) {
    if (a.isConnector(el) && el.node) {
      this.nodeOcc.get(el.node.id)?.delete(a);
      a.conInNode = null;
    }
    // Entrou num segmento novo: talvez procure vaga.
    if (a.isConnector(el) && el.to?.spots?.length && Math.random() < this.cfg.parkChance) a.wantPark = true;
    if (a.isConnector(el) && el.to === a.destination) {
      if (el.to.spots?.length && a.brain.fear < 0.35) a.wantPark = true;
      this.assignDestination(a, el.to);
    }
  }

  assignDestination(agent, start) {
    const candidates = this.graph.segments.filter(segment => {
      if (segment === start || !segment.out.length || segment.sink || segment.path.length <= 20) return false;
      const p = segment.path.sample(segment.path.length / 2, new THREE.Vector3()), b = this.bounds;
      return !b || (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ);
    });
    for (let k = 0; k < 12 && candidates.length; k++) {
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      const route = laneRoute(start, target);
      if (!route?.length) continue;
      agent.destination = target; agent.plannedRoute = route;
      agent.destinationLabel = target.road.name;
      return;
    }
    agent.destination = null; agent.plannedRoute = [];
  }

  /** PARE: entra se o cruzamento estiver livre (ou só com quem vem do mesmo acesso). */
  canEnter(nodeId, a, con) {
    const set = this.nodeOcc.get(nodeId);
    if (set) for (const o of set) if (o !== a && o.conInNode?.from !== con?.from && o.reservedFrom !== a.el) return false;
    // Carro do jogador dentro do cruzamento.
    const node = this.graph.nodes.get(nodeId)?.node;
    const pv = this.game.vehicles.playerVehicle;
    if (node && pv && Math.hypot(pv.root.position.x - node.x, pv.root.position.z - node.z) < node.radius + 4) return false;
    // Reserva imediata (evita dois acessos liberados no mesmo instante).
    let s2 = set;
    if (!s2) this.nodeOcc.set(nodeId, (s2 = new Set()));
    s2.add(a);
    a.conInNode = con;
    return true;
  }

  /** Fluxo oposto se aproximando ou atravessando (para a conversão à esquerda). */
  oncoming(seg, a) {
    for (const o of this.agents) {
      if (o === a) continue;
      if (o.el?.to === seg.to && !o.isConnector(o.el) && o.el.dir.x * seg.dir.x + o.el.dir.z * seg.dir.z < -0.7) {
        const remain = o.el.path.length - o.s;
        if (remain < 32 && o.speed > 1.5 && (o.next?.turn !== 'left')) return true;
      }
      if (o.conInNode && o.conInNode.node?.id === seg.to && o.conInNode.turn === 'straight') {
        const d = o.conInNode.from.dir;
        if (d.x * seg.dir.x + d.z * seg.dir.z < -0.7) return true;
      }
    }
    return false;
  }

  /** Distância livre até uma faixa de pedestres ocupada à frente (ou null). */
  crosswalkStop(a) {
    const peds = this.game.city?.peds;
    if (!peds || a.isConnector()) return null;
    const el = a.el;
    let best = null;
    const check = (seg, base) => {
      for (const cw of seg.crosswalks || []) {
        const d = base + cw.s - cw.half - 1.2 - a.halfLen;
        if (d < -1 || d > 40) continue;
        if (peds.crosswalkBusy(cw.id) && (best === null || d < best)) best = d;
      }
    };
    check(el, -a.s);
    if (a.next?.to) check(a.next.to, el.path.length - a.s + a.next.path.length);
    return best;
  }

  // ----------------------------------------------------------- vagas
  _maybePark(a) {
    if (!a.wantPark || a.parkSpot || a.isConnector() || a.el.kind === 'park' || !a.el.spots?.length) return;
    const c = a.el.spots.find((x) => !x.spot.occupied && x.s > a.s + 22 && x.s < a.s + 70);
    if (!c) return;
    c.spot.occupied = true;
    c.spot.agent = a;
    a.parkSpot = c.spot;
    a.parkS = c.s;
    a.wantPark = false;
  }

  _startParking(a) {
    const sp = a.parkSpot;
    const seg = a.el;
    const p0 = seg.path.sample(a.s, new THREE.Vector3());
    const p1 = seg.path.sample(a.s + 6, new THREE.Vector3());
    const dir = new THREE.Vector3(Math.sin(sp.heading), 0, Math.cos(sp.heading));
    const p3 = new THREE.Vector3(sp.x, 0.02, sp.z);
    const p2 = p3.clone().addScaledVector(dir, -5);
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, u = 1 - t;
      pts.push(new THREE.Vector3(
        u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, 0.02,
        u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z,
      ));
    }
    a.place({ kind: 'park', path: new Path(pts), speedLimit: 3.2, to: null, out: [] }, 0, a.speed);
  }

  _parked(a) {
    const v = a.v;
    a.state = STATES.PARKED;
    v.driver = this.game.city?.occupants ? 'ai' : null;
    v.engineOn = false;
    Object.assign(v.controls, { throttle: 0, brake: 1, steer: 0, handbrake: true });
    a.parkT = 25 + Math.random() * 45;
    // Física coerente com a pose (se o jogador encostar, não há salto).
    v.physics.syncFromRoot();
    this.stats.parked++;
    a.speed = 0;
    this.game.city?.occupants?.onPark(a);
  }

  _parkedTick(a, dt, player) {
    a.parkT -= dt;
    const p = a.v.root.position;
    if (a.parkT > 0 || a.abandoned || (this.game.city?.occupants && !this.game.city.occupants.readyToDrive(a))) return;
    const sp = a.parkSpot;
    const seg = sp?.seg;
    if (!seg) return;
    // Sai da vaga: volta à faixa ~14 m à frente.
    const joinS = Math.min(seg.path.length - 1, sp.s + 14);
    const p3 = seg.path.sample(joinS, new THREE.Vector3());
    if (this.game.vehicles.list.some(v => v !== a.v && Math.hypot(v.root.position.x - p3.x, v.root.position.z - p3.z) < 12)) return;
    const d = new THREE.Vector3();
    seg.path.sample(joinS, null, d);
    const p0 = new THREE.Vector3(p.x, 0.02, p.z);
    const h = a.v.root.rotation.y;
    const p1 = p0.clone().add(new THREE.Vector3(Math.sin(h) * 5, 0, Math.cos(h) * 5));
    const p2 = p3.clone().addScaledVector(d, -6);
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, u = 1 - t;
      pts.push(new THREE.Vector3(
        u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, 0.02,
        u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z,
      ));
    }
    sp.occupied = false;
    sp.agent = null;
    a.parkSpot = null;
    a.place({ kind: 'park', path: new Path(pts), speedLimit: 4, to: seg, joinS, out: [] }, 0, 0);
    a.state = STATES.PULLING_OUT;
    a.v.driver = 'ai';
    a.v.engineOn = true;
    a.v.controls.handbrake = false;
    if (a.mode === 'phys') a.v.physics.wake();
    this.stats.pulledOut++;
  }

  // ------------------------------------------------- reações e buzinas
  _reactions(a, dist, period) {
    this._maybePark(a);
    if (a.parkSpot && a.el === a.parkSpot.seg && a.s >= a.parkS - 16) this._startParking(a);
    // Batida: reação curta (para e buzina).
    const ph = a.v.physics;
    if (a.mode === 'phys' && ph.contactTimer > 0 && a.state !== STATES.RECOVERING) {
      this._honk(a, dist, 0.9);
    }
    // Buzina: jogador na frente, carro do jogador parado no caminho, ou espera longa.
    if (a.speed < 0.5 && (a.leadKind === 'player' || a.leadKind === 'playerCar')) a.blockedT += period; else a.blockedT = 0;
    if (a.blockedT > 2.2 * (1.5 - a.brain.profile.temper / 100)) { this._honk(a, dist, a.P.honk); a.blockedT = 0; }
  }

  _honk(a, dist, chance) {
    if (a.hornCd > 0 || this._hornGlobal > 0 || Math.random() > chance) return;
    a.hornCd = 7 + Math.random() * 8;
    this._hornGlobal = 1.5;
    const p = a.v.root.position;
    this.events.emit('horn', { x: p.x, z: p.z, source: a.v.id });
    this.stats.horns = (this.stats.horns || 0) + 1;
    const am = this.game.audio;
    if (!am?.started || !am.ctx || dist > 70) return;
    const ctx = am.ctx, t = ctx.currentTime + 0.01;
    const g = ctx.createGain();
    const vol = 0.14 * Math.max(0.05, 1 - dist / 70);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.setValueAtTime(vol, t + 0.28);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    for (const f of [330, 415]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * (0.97 + Math.random() * 0.06);
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.4);
    }
    const cam = this.game.camera;
    let node = g;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      _v.subVectors(p, cam.position).normalize();
      _f.set(1, 0, 0).applyQuaternion(cam.quaternion);
      pan.pan.value = Math.max(-1, Math.min(1, _v.dot(_f)));
      g.connect(pan);
      node = pan;
    }
    lp.connect(g);
    node.connect(am.master);
  }

  _onGunshot(e) {
    for (const a of this.agents) {
      const p = a.v.root.position;
      if ((p.x - e.x) ** 2 + (p.z - e.z) ** 2 < 45 * 45) {
        a.brain.perceive(e, { distance: Math.hypot(p.x - e.x, p.z - e.z), visible: false });
        a.panicT = a.brain.goal === 'flee' ? 8 : 2;
        if (a.state === STATES.PARKED && a.brain.fear > 0.6) this.game.city?.occupants?.abandon(a);
        if (Math.random() < 0.4) this._honk(a, Math.hypot(p.x - e.x, p.z - e.z), 1);
      }
    }
  }

  // ------------------------------------------------- congestionamentos
  _congestion(a, dist, period, player) {
    if (a.state === STATES.PARKED) return;
    if (a.speed < 0.3 && !a.blockedLegit && a.leadKind !== 'player' && a.leadKind !== 'playerCar') a.stuckT += period;
    else a.stuckT = Math.max(0, a.stuckT - period * 2);
    if (a.stuckT < 12) return;
    const p = a.v.root.position;
    // Longe ou fora da vista: recicla sem teletransporte visível.
    if (!this._visible(p, dist) && dist > 35) {
      this.stats.recoveries++;
      this._release(a);
      return;
    }
    // Perto: ré curta e nova tentativa (fora da faixa ou travado em obstáculo).
    if (a.mode === 'phys') {
      a.reverseT = 1.2;
      a.state = STATES.RECOVERING;
      a.stuckT = 6;
      a.recoverCount++;
      this.stats.recoveries++;
    } else a.stuckT = 8;
  }

  groundY(x, z) {
    const env = this.env;
    if (env?.groundAt) return env.groundAt(x, z);
    return env?.collision ? env.collision.getGroundHeight(x, z, 0.6, 0.6) : 0;
  }

  // ------------------------------------------------------- consultas
  summary() {
    const states = {}, modes = { phys: 0, kin: 0 };
    for (const a of this.agents) {
      states[a.state] = (states[a.state] || 0) + 1;
      modes[a.mode]++;
    }
    return { agents: this.agents.length, max: this.maxAgents, pool: this.pool.length, states, modes, ...this.stats, graph: this.graph?.stats() };
  }
}
