import * as THREE from 'three';
import { PedestrianRenderer, randomLook } from '../pedestrians/PedestrianRenderer.js';
import { CitizenBrain } from '../city/CitizenBrain.js';
import { sidewalkPath } from '../city/Navigation.js';

export const OCCUPANT_STATES = { SEATED: 'SEATED', EXITING: 'EXITING', WALKING: 'WALKING', IDLE: 'IDLE', RETURNING: 'RETURNING', ENTERING: 'ENTERING' };
const _pos = new THREE.Vector3(), _dir = new THREE.Vector3();
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const pose = () => ({ thighL: 0, thighR: 0, kneeL: 0, kneeR: 0, armL: 0, armR: 0, elbowL: 0, elbowR: 0, armOut: 0, bob: 0, twist: 0, headYaw: 0, headPitch: 0, lean: 0, sit: 0, lie: 0, footPitch: 0, spread: 0 });

/** IK planar de dois ossos (unidades do corpo, altura 1): [ângulo do osso proximal, dobra]. */
function ik2(dy, dz, L1, L2, out) {
  const d = Math.min(Math.max(Math.hypot(dy, dz), Math.abs(L1 - L2) + 0.01), L1 + L2 - 0.004);
  const phi = Math.atan2(dz, -dy);
  const bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
  const delta = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
  out[0] = phi; out[1] = delta; out[2] = bend;
  return out;
}
const _ik = [0, 0, 0];

/**
 * Pilotos de moto (PROMPT 15): pernas nas pedaleiras, mãos nas manoplas e tronco pelo
 * estilo, usando os mesmos pontos de apoio do protagonista (seat.ride). A moto inclina
 * nas curvas e o piloto acompanha (parentMatrix = carroceria da moto).
 */
function ridePose(p, seat, v, h, speed = 9) {
  const R = seat.ride;
  p.sit = 1;
  p.lean = -seat.recline;
  // Pernas (coxa 0,42, canela 0,41 + pé) até a pedaleira.
  ik2((R.pegY + 0.05 - R.hipY) / h, (R.pegZ - R.hipZ) / h, 0.42, 0.45, _ik);
  p.thighL = p.thighR = _ik[0] + _ik[1];
  p.kneeL = p.kneeR = _ik[2];
  p.spread = R.spread;
  // Braços: ombro no topo do tronco inclinado (pelve 0,3·lean + tronco lean).
  const tl = p.lean * 1.3;
  const sy = 0.05 + 0.42 * Math.cos(tl), sz = 0.42 * Math.sin(tl);
  const steer = v.physics ? v.physics.steerAngle : 0;
  const ds = R.gripW * Math.sin(steer);
  for (const [k, side] of [['L', -1], ['R', 1]]) {
    ik2((R.gripY - R.hipY) / h - sy, (R.gripZ - R.hipZ + side * ds) / h - sz, 0.28, 0.27, _ik);
    p['arm' + k] = _ik[0] - _ik[1] - tl;
    p['elbow' + k] = _ik[2];
  }
  p.armOut = Math.asin(Math.max(-0.4, Math.min(0.8, (R.gripW / h - 0.19) / 0.55))) - 0.08;
  p.footPitch = 0.2;
  // Parado (semáforo, fila): pé esquerdo no chão.
  if (speed < 0.4) {
    ik2((0.05 - R.hipY) / h, 0.12 / h, 0.42, 0.45, _ik);
    p.thighL = _ik[0] + _ik[1];
    p.kneeL = _ik[2];
  }
}

/** Visible people tied to actual vehicle seats, with walking/return transitions. */
export class VehicleOccupants {
  constructor(game, capacity = 42) {
    this.game = game;
    this.renderer = new PedestrianRenderer(game.scene, capacity);
    this.renderer.group.name = 'vehicle-occupants';
    this.renderer.group.visible = false;
    this.free = Array.from({ length: capacity }, (_, i) => capacity - 1 - i);
    this.actors = [];
    this.serial = 0;
    this.stats = { exited: 0, entered: 0, abandoned: 0 };
  }

  onMapActivated(env) {
    for (const actor of [...this.actors]) this._remove(actor);
    this.env = env;
  }

  attach(agent) {
    if (!this.free.length) return false;
    const seats = agent.v.seats.filter(s => !s.rear);
    const driver = seats.find(s => s.driver);
    if (!driver) return false;
    const spawn = seat => {
      const slot = this.free.pop(), look = randomLook();
      look.height = Math.min(1, look.height);
      const actor = { id: `occupant_${this.serial++}`, slot, look, agent, vehicle: agent.v, seat, state: 'SEATED', pose: pose(), x: 0, y: 0, z: 0, yaw: 0, phase: Math.random() * 6, speed: 0, timer: 0, path: [], pi: 0 };
      (agent.v.npcSeats ||= new Set()).add(seat.id);
      actor.brain = seat.driver ? agent.brain : new CitizenBrain({ id: actor.id, style: look.style });
      this.renderer.applyLook(slot, look);
      this.actors.push(actor);
    };
    spawn(driver);
    if (this.free.length && seats.length > 1 && (this.actors.length === 1 || Math.random() < 0.35)) spawn(seats.find(s => !s.driver));
    return true;
  }

  release(agent, preserveWalkers = false) {
    for (const actor of [...this.actors]) if (actor.agent === agent) {
      if (preserveWalkers && actor.vehicle?.driver === 'player' && !actor.seat.driver && ['SEATED', 'ENTERING', 'EXITING'].includes(actor.state)) {
        actor.agent = null;
        continue;
      }
      if (preserveWalkers && !['SEATED', 'EXITING', 'ENTERING'].includes(actor.state)) {
        actor.agent = null; actor.vehicle = null; actor.returning = false;
        actor.directEntry = false;
        actor.state = 'WALKING'; actor.timer = 0;
      } else this._remove(actor);
    }
  }

  _remove(actor) {
    if (actor.door) actor.door.target = 0;
    actor.vehicle?.npcSeats?.delete(actor.seat.id);
    if (actor.crossing) actor.crossing.busy = Math.max(0, actor.crossing.busy - 1);
    this.renderer.hide(actor.slot);
    this.free.push(actor.slot);
    this.actors.splice(this.actors.indexOf(actor), 1);
  }

  _seatPosition(actor, out) {
    const v = actor.vehicle, seat = actor.seat;
    v.body.updateWorldMatrix(true, false);
    return out.set(seat.x, seat.hipY + 0.47 - 0.95 * actor.look.height, seat.z).applyMatrix4(v.body.matrixWorld);
  }

  _safeExit(actor) {
    const v = actor.vehicle, peds = this.game.city.peds, col = this.env.collision;
    v.root.updateWorldMatrix(true, true);
    const doors = [...v.doors].sort((a, b) => Number(b.seat === actor.seat.id) - Number(a.seat === actor.seat.id));
    for (const door of doors) {
      const entry = v.localToWorld(door.entry, new THREE.Vector3());
      entry.y = col.getGroundHeight(entry.x, entry.z, v.root.position.y + 0.5, 0.4);
      if (this.env.waterDepth?.(entry.x, entry.z) > 0.05 || this.env.boundaryHint?.(entry.x, entry.z, 0.4)) continue;
      const check = { x: entry.x, z: entry.z };
      col.resolveCircle(check, entry.y, 0.28, 1.7, 0.36);
      if (Math.hypot(check.x - entry.x, check.z - entry.z) > 0.1) continue;
      const candidates = peds.nodes.filter(n => n.links.length && Math.hypot(n.x - entry.x, n.z - entry.z) < 14)
        .sort((a, b) => Math.hypot(a.x - entry.x, a.z - entry.z) - Math.hypot(b.x - entry.x, b.z - entry.z));
      const node = candidates.find(n => {
        _pos.set(entry.x, entry.y + 0.9, entry.z); _dir.set(n.x - entry.x, 0, n.z - entry.z);
        const len = _dir.length(); _dir.divideScalar(len || 1);
        return col.sphereCast(_pos, _dir, len, 0.25, null) >= len - 0.1;
      });
      if (node) return { door, entry, node };
    }
    return null;
  }

  onPark(agent) {
    let started = false;
    for (const actor of this.actors.filter(a => a.agent === agent && a.state === 'SEATED')) {
      const exit = this._safeExit(actor);
      if (!exit) continue;
      Object.assign(actor, exit, { state: 'EXITING', timer: 0, parentMatrix: null, returning: false, directEntry: false });
      actor.from = this._seatPosition(actor, new THREE.Vector3());
      started = true;
    }
    return started;
  }

  readyToDrive(agent) {
    const people = this.actors.filter(a => a.agent === agent);
    return people.some(a => a.seat.driver) && people.every(a => a.state === 'SEATED') && !agent.abandoned;
  }

  perceive(event) {
    for (const actor of this.actors) {
      const position = actor.state === 'SEATED' ? this._seatPosition(actor, _pos) : actor;
      const distance = Math.hypot(position.x - event.x, position.z - event.z);
      if (!actor.brain.perceive(event, { distance, visible: actor.state !== 'SEATED' })) continue;
      if (actor.brain.goal === 'flee' && ['WALKING', 'RETURNING', 'IDLE'].includes(actor.state)) {
        const peds = this.game.city.peds, node = peds._nearest(actor.x, actor.z, 15);
        if (actor.agent) this.abandon(actor.agent);
        actor.returning = false; actor.directEntry = false;
        if (node) { actor.path = peds._route(node.i, 10, actor.brain.threat); actor.pi = 0; actor.state = 'WALKING'; }
      }
    }
  }

  abandon(agent) {
    if (agent.abandoned) return;
    agent.abandoned = true; agent.parkT = Infinity;
    this.stats.abandoned++;
    this.onPark(agent);
  }

  _return(actor) {
    const peds = this.game.city.peds, start = peds._nearest(actor.x, actor.z, 15);
    const path = start && sidewalkPath(peds.nodes, start.i, actor.node.i);
    if (!path) return;
    actor.path = path; actor.pi = 0; actor.state = 'RETURNING'; actor.returning = true;
  }

  _beginEnter(actor) {
    if (actor.seat.driver && actor.vehicle.driver && actor.vehicle.driver !== 'ai') {
      actor.agent = null; actor.vehicle = null; actor.state = 'WALKING'; actor.returning = false; actor.directEntry = false;
      return false;
    }
    if (actor.seat.driver) actor.vehicle.driver = 'ai';
    (actor.vehicle.npcSeats ||= new Set()).add(actor.seat.id);
    actor.state = 'ENTERING'; actor.timer = 0;
    actor.from = new THREE.Vector3(actor.x, actor.y, actor.z);
    actor.door.target = 1;
    return true;
  }

  _foot(actor, dt) {
    const peds = this.game.city.peds, col = this.env.collision;
    if (!actor.path.length) { actor.state = 'IDLE'; actor.timer = 2; return; }
    let node = peds.nodes[actor.path[Math.min(actor.pi, actor.path.length - 1)]];
    if (!node) return;
    // Before a crosswalk use the same pedestrian/vehicle gap rules as walkers.
    const previous = peds.nodes[actor.path[Math.max(0, actor.pi - 1)]];
    const crosswalk = previous?.links.find(l => l.to === node.i)?.cw;
    if (crosswalk && actor.pi > 0 && !actor.crossing) {
      actor.wait = (actor.wait || 0) + dt;
      if (!peds._canCross(crosswalk, actor.wait)) { actor.speed = 0; return; }
      actor.crossing = crosswalk; crosswalk.busy++;
    }
    const dx = node.x - actor.x, dz = node.z - actor.z, dist = Math.hypot(dx, dz);
    if (dist < 0.45) {
      if (actor.crossing) { actor.crossing.busy = Math.max(0, actor.crossing.busy - 1); actor.crossing = null; actor.wait = 0; }
      if (actor.pi < actor.path.length - 1) { actor.pi++; return; }
      if (actor.returning) {
        const distance = Math.hypot(actor.entry.x - actor.x, actor.entry.z - actor.z);
        if (distance > 0.4) { node = { ...actor.entry }; actor.path = []; actor.directEntry = true; }
        else { this._beginEnter(actor); return; }
      } else { actor.state = 'IDLE'; actor.timer = 6 + actor.brain.sociability * 5; actor.speed = 0; return; }
    }
    this._walkToward(actor, node, dt, col);
  }

  _walkToward(actor, target, dt, col) {
    const dx = target.x - actor.x, dz = target.z - actor.z, dist = Math.hypot(dx, dz);
    const speed = actor.brain.goal === 'flee' ? actor.brain.fleeSpeed : 1.3 * actor.brain.stride;
    const step = Math.min(dist, speed * dt);
    const pos = { x: actor.x + dx / (dist || 1) * step, z: actor.z + dz / (dist || 1) * step };
    col.resolveCircle(pos, actor.y, 0.28, 1.7, 0.36);
    actor.speed = Math.hypot(pos.x - actor.x, pos.z - actor.z) / Math.max(dt, 0.001);
    actor.x = pos.x; actor.z = pos.z;
    actor.y = col.getGroundHeight(actor.x, actor.z, actor.y + 0.5, 0.4);
    const yaw = Math.atan2(dx, dz);
    actor.yaw += Math.atan2(Math.sin(yaw - actor.yaw), Math.cos(yaw - actor.yaw)) * Math.min(1, dt * actor.brain.turnRate);
  }

  update(dt) {
    if (!this.env || this.game.mapLoading) return;
    const peds = this.game.city.peds;
    for (const actor of [...this.actors]) {
      const a = actor.agent, v = actor.vehicle, s = actor.state, p = actor.pose;
      if (!actor.seat.driver || !a) actor.brain.update(dt, actor.speed > 0.2);
      actor.parentMatrix = null;
      Object.assign(p, pose());
      if (s === 'SEATED') {
        if (!v || (actor.seat.driver && v.driver === 'player')) { this._remove(actor); continue; }
        v.body.updateWorldMatrix(true, false);
        actor.parentMatrix = v.body.matrixWorld;
        actor.x = actor.seat.x; actor.y = actor.seat.hipY + 0.47 - 0.95 * actor.look.height; actor.z = actor.seat.z; actor.yaw = 0;
        if (actor.seat.ride) {
          ridePose(p, actor.seat, v, actor.look.height, actor.agent ? (actor.agent.mode === 'phys' ? Math.abs(v.physics?.vLong ?? 0) : actor.agent.speed) : 0);
          p.headYaw = actor.brain.alert > 0.3 ? Math.sin(actor.brain.time * 2) * 0.4 : Math.sin(actor.brain.time * 0.4) * 0.08;
          if (v._impOn || !v.root.visible) { this.renderer.hide(actor.slot); continue; }
          this.renderer.write(actor.slot, actor, p);
          continue;
        }
        p.sit = 1; p.lean = -actor.seat.recline;
        p.thighL = p.thighR = 1.35; p.kneeL = p.kneeR = 1.45;
        p.armL = actor.seat.driver ? 0.9 + v.controls.steer * 0.2 : 0.1;
        p.armR = actor.seat.driver ? 0.9 - v.controls.steer * 0.2 : 0.1;
        p.elbowL = p.elbowR = actor.seat.driver ? 0.55 : 0.2;
        p.headYaw = actor.brain.alert > 0.3 ? Math.sin(actor.brain.time * 2) * 0.5 : Math.sin(actor.brain.time * 0.4) * 0.12;
        if (v._impOn || !v.root.visible) { this.renderer.hide(actor.slot); continue; }
      } else if (s === 'EXITING' || s === 'ENTERING') {
        actor.timer += dt;
        actor.door.target = 1;
        const k = smooth((actor.timer - 0.2) / 0.8), entering = s === 'ENTERING';
        const seat = this._seatPosition(actor, _pos);
        const from = entering ? actor.from : seat, to = entering ? seat : actor.entry;
        actor.x = from.x + (to.x - from.x) * k; actor.y = from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 0.08; actor.z = from.z + (to.z - from.z) * k;
        actor.yaw = v.root.rotation.y; p.sit = entering ? k : 1 - k; p.lean = -actor.seat.recline * p.sit;
        p.thighL = p.thighR = 1.35 * p.sit; p.kneeL = p.kneeR = 1.45 * p.sit;
        if (actor.timer >= 1.2) {
          actor.door.target = 0;
          if (entering) { actor.state = 'SEATED'; this.stats.entered++; }
          else {
            v.npcSeats?.delete(actor.seat.id);
            actor.state = 'WALKING'; this.stats.exited++;
            actor.path = [actor.node.i, ...peds._route(actor.node.i, 4, actor.brain.goal === 'flee' ? actor.brain.threat : null).slice(1)]; actor.pi = 0;
            if (actor.seat.driver && v.driver !== 'player') v.driver = null;
          }
        }
      } else {
        if (!a && Math.hypot(actor.x - this.game.player.visualPosition.x, actor.z - this.game.player.visualPosition.z) > 140) { this._remove(actor); continue; }
        if (a && a.parkT < 8 && !a.abandoned && !actor.returning) this._return(actor);
        if (actor.directEntry) {
          this._walkToward(actor, actor.entry, dt, this.env.collision);
          if (Math.hypot(actor.x - actor.entry.x, actor.z - actor.entry.z) < 0.4) { actor.directEntry = false; this._beginEnter(actor); }
        } else if (actor.state === 'WALKING' || actor.state === 'RETURNING') this._foot(actor, dt);
        else {
          actor.speed = 0; actor.timer -= dt;
          if (actor.timer <= 0 && (!a || a.abandoned)) {
            const node = peds._nearest(actor.x, actor.z, 15);
            if (node) { actor.path = peds._route(node.i, 5, actor.brain.threat); actor.pi = 0; actor.state = 'WALKING'; }
          }
        }
        actor.phase += dt * actor.speed * 2.4;
        const swing = Math.sin(actor.phase) * Math.min(0.6, actor.speed * 0.35);
        p.thighL = swing; p.thighR = -swing; p.armL = -swing; p.armR = swing;
        p.kneeL = Math.max(0, -swing) * 1.3; p.kneeR = Math.max(0, swing) * 1.3;
        p.elbowL = p.elbowR = 0.25; p.bob = Math.abs(Math.cos(actor.phase)) * 0.025 * Math.min(1, actor.speed);
      }
      this.renderer.write(actor.slot, actor, p);
    }
    this.renderer.setActiveCount(this.actors.reduce((top, a) => Math.max(top, a.slot + 1), 0));
    this.renderer.group.visible = this.actors.length > 0;
  }

  onRoad() { return this.actors.filter(a => !['SEATED', 'ENTERING', 'EXITING'].includes(a.state) && this.game.city.traffic.net?.roadAt(a.x, a.z)); }
  summary() {
    const states = {};
    for (const a of this.actors) states[a.state] = (states[a.state] || 0) + 1;
    return { count: this.actors.length, states, ...this.stats };
  }
  dispose() { for (const a of [...this.actors]) this._remove(a); this.renderer.dispose(); }
}
