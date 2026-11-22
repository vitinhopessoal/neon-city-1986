import * as THREE from 'three';
import { responseFor, UNIFORMS, HEADING_RATE, FINES, canUseFirearms } from './PoliceRules.js';
import { PoliceCrimes } from './PoliceCrimes.js';
import { angleDelta } from '../utils/math.js';
import { lineOfSight, roadRoute, footRoute, driveTo } from './PoliceNavigation.js';
import { Path } from '../traffic/LaneGraph.js';
import { boundsContains } from '../utils/bounds.js';
import { PoliceOfficers, PoliceAudio, officerPose, officerLook, createPoliceVehicle, disposePoliceVehicle, createHelicopter } from './PoliceVisuals.js';

const p = new THREE.Vector3(), q = new THREE.Vector3(), r = new THREE.Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Bounded police simulation. Perception is the only source of live suspect
 * positions; routes otherwise use remembered radio reports, not wall vision. */
export class PoliceManager {
  constructor(game, events) {
    this.game = game; this.events = events;
    this.units = []; this.officers = []; this.free = Array.from({ length: 16 }, (_, i) => 15 - i);
    this.renderer = new PoliceOfficers(game.scene, 16);
    this.audio = new PoliceAudio(game.audio || {});
    this.time = 0; this.serial = 0; this.spawnTimer = 0; this.lastSeen = -Infinity;
    this.lastKnown = new THREE.Vector3(); this.searchClock = 0; this.lastViolent = -Infinity;
    this._view = new THREE.Frustum(); this._viewMatrix = new THREE.Matrix4();
    this.stats = { spawned: 0, shots: 0, arrests: 0, wasted: 0, escaped: 0, hits: 0 };
    this.crimes = new PoliceCrimes();
    this.suspectVel = new THREE.Vector3(); this._prevSeen = null;
    this.sirenTimer = 0; this.arrestToast = -Infinity;
    this.unsub = [
      // Uma rajada inteira conta como UM disparo em local público (antes: cada tiro somava).
      events.on('gunshot', e => { if (e.source !== 'police') { this.lastViolent = this.time; this.report('gunshot', 'burst', e); } }),
      events.on('pedHit', e => { if (e.vehicleId === game.vehicles.playerVehicle?.id) this.report('pedHit', `${e.vehicleId}:${e.id}`, e); }),
      events.on('crime', e => { if (e.source === 'player') this.report(e.kind === 'property' || e.id ? 'property' : 'generic', e.id ?? e.key ?? 'x', e, e.severity); }),
    ];
    this.target = { hit: (origin, dir, maxT) => this._rayHit(origin, dir, maxT) };
    game.weapons?.ballistics?.targets.add(this.target);
    this.banner = document.createElement('div'); this.banner.className = 'police-outcome';
    game.hud?.el?.appendChild(this.banner);
  }

  get status() { return this.game.player.status; }
  get playerPosition() { return this.game.player.controller.position; }

  onMapActivated(env, graph) {
    this.clear(); this.env = env; this.graph = graph;
    this.spawnTimer = 0; this.lastSeen = -Infinity; this.lastKnown.copy(env.spawnPoint || this.playerPosition);
    this._wanted = this.status?.wanted || 0; this.searchClock = 0;
    if (this.status) { this.status.policeManaged = !!graph; this.status.searching = false; }
  }

  /** Testemunhas: pedestre a até 35 m ou policial/viatura/helicóptero a até 70 m. */
  _witnessed(at) {
    const x = at.x ?? this.playerPosition.x, z = at.z ?? this.playerPosition.z;
    if (this.game.city?.peds?.peds?.some((p) => Math.hypot(p.x - x, p.z - z) < 35)) return true;
    if (this.officers.some((o) => o.health > 0 && Math.hypot(o.x - x, o.z - z) < 70)) return true;
    if (this.units.some((u) => Math.hypot(u.v.root.position.x - x, u.v.root.position.z - z) < 70)) return true;
    if (this.helicopter && Math.hypot(this.helicopter.root.position.x - x, this.helicopter.root.position.z - z) < 90) return true;
    return !this.game.city?.peds; // sem sistema de pedestres (testes/mapas): conta como testemunhado
  }

  /** Entrada única de crimes: gravidade por tipo, deduplicação e testemunhas. */
  report(type, key, location = this.playerPosition, severity = null) {
    if (!this.status || this.game.state !== 'playing' || this.game.mapLoading) return 0;
    const sev = this.crimes.evaluate(type, key, this.time, { witnessed: this._witnessed(location) });
    if (!sev) return 0;
    this.crime(severity ?? sev, location);
    return sev;
  }

  crime(severity, location = this.playerPosition) {
    if (!this.status || this.game.state !== 'playing' || this.game.mapLoading) return;
    const before = this.status.wanted;
    this.status.reportCrime(severity);
    // Despacho imediato quando o nível sobe (antes: até 8 s de espera do temporizador de patrulha).
    if (this.status.wanted > before) this.spawnTimer = Math.min(this.spawnTimer, 0.6);
    this.lastKnown.set(location.x ?? this.playerPosition.x, location.y ?? this.playerPosition.y, location.z ?? this.playerPosition.z);
    this.lastSeen = this.time; this.searchClock = 0;
    this.events.emit('policeAlert', { x: this.lastKnown.x, z: this.lastKnown.z, level: this.status.wanted });
  }

  _visible(point) {
    const camera = this.game.camera;
    if (!camera) return false;
    camera.updateMatrixWorld();
    this._viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._view.setFromProjectionMatrix(this._viewMatrix);
    return this._view.containsPoint(p.set(point.x, (point.y || 0) + 1, point.z));
  }

  _spawnPoint(center, roadblock = false) {
    const options = [], bounds = this.graph.bounds;
    for (const segment of this.graph.segments) {
      if (segment.sink || segment.path.length < 18) continue;
      for (let s = 8; s < segment.path.length - 7; s += 16) {
        const pos = segment.path.sample(s, new THREE.Vector3());
        if (bounds && !boundsContains(bounds, pos.x, pos.z, 4)) continue;
        const d = dist(pos, center), playerDistance = dist(pos, this.playerPosition);
        if (d < (roadblock ? 55 : 60) || d > 150 || playerDistance < 45 || this._visible(pos)) continue;
        if (this.game.vehicles.list.some(v => v.root.visible && dist(v.root.position, pos) < 9)) continue;
        if (this.env.waterDepth?.(pos.x, pos.z) > 0.05) continue;
        pos.y = this.env.collision.getGroundHeight(pos.x, pos.z, 0.5, 0.36);
        const heading = Math.atan2(segment.dir.x, segment.dir.z) + (roadblock ? Math.PI / 2 : 0);
        const body = { x: pos.x, z: pos.z, rot: heading, hx: 1.1, hz: 2.65 };
        if (this.env.collision.resolveOBB(body, pos.y, 1.8, 0.32, null, [], 1)) continue;
        options.push({ pos, heading, cost: Math.abs(d - 90) + Math.random() * 25 });
      }
    }
    return options.sort((a, b) => a.cost - b.cost)[0] || null;
  }

  _spawn(tier, roadblock = false) {
    if (this.free.length < 2) return null;
    const point = this._spawnPoint(this.status.wanted ? this.lastKnown : this.playerPosition, roadblock);
    if (!point) return null;
    const v = createPoliceVehicle(this.game, tier, this.serial++);
    this.game.scene.add(v.root); v.setPose(point.pos.x, point.pos.y, point.pos.z, point.heading);
    v.attachCollider(this.env.collision); this.game.vehicles.addVehicle(v);
    v.driver = 'police'; v.engineOn = true;
    const unit = { v, tier, state: roadblock ? 'ROADBLOCK' : this.status.wanted ? 'PURSUIT' : 'PATROL', officers: [], path: null, planTimer: 0, goal: null, sense: 0, stuck: 0, reverse: 0, age: 0, roadblock };
    for (const seat of v.seats.filter(s => !s.rear).slice(0, 2)) {
      const officer = { slot: this.free.pop(), unit, tier, seat, health: UNIFORMS[tier].health,
        look: officerLook(tier, this.serial), pose: officerPose(), x: point.pos.x, y: point.pos.y, z: point.pos.z,
        yaw: point.heading, state: 'SEATED', timer: 0, phase: 0, speed: 0, flash: 0, fire: 1.5,
        aiming: false, path: [], pathIndex: 0, planTimer: 0, arrest: 0, role: unit.officers.length };
      v.npcSeats.add(seat.id); unit.officers.push(officer); this.officers.push(officer); this.renderer.applyLook(officer);
    }
    this.units.push(unit); this.stats.spawned++;
    if (roadblock) for (const officer of unit.officers) this._exit(officer);
    return unit;
  }

  _remove(unit, keepVehicle = false) {
    for (const officer of unit.officers) {
      this.renderer.hide(officer.slot); this.free.push(officer.slot);
      const i = this.officers.indexOf(officer); if (i >= 0) this.officers.splice(i, 1);
      unit.v.npcSeats.delete(officer.seat.id);
    }
    this.units.splice(this.units.indexOf(unit), 1);
    const v = unit.v;
    if (keepVehicle || v.driver === 'player' || this.game.vehicles.playerVehicle === v) return;
    this.game.vehicles.removeVehicle(v);
    if (v.collision && v.colliderId) v.collision.remove(v.colliderId);
    disposePoliceVehicle(v, this.game.world.vehicleFactory);
  }

  _seated(officer) {
    const v = officer.unit.v, seat = officer.seat;
    v.body.updateWorldMatrix(true, false);
    p.set(seat.x, seat.hipY + 0.47 - 0.95, seat.z).applyMatrix4(v.body.matrixWorld);
    officer.x = p.x; officer.y = p.y; officer.z = p.z; officer.yaw = v.root.rotation.y;
    officer.pose.sit = 1; officer.pose.thighL = officer.pose.thighR = 1.35;
    officer.pose.kneeL = officer.pose.kneeR = 1.45; officer.pose.armL = officer.pose.armR = 0.8;
  }

  _exit(officer) {
    if (officer.state !== 'SEATED' || Math.abs(officer.unit.v.physics.speed) > 1.3) return false;
    const v = officer.unit.v, doors = [...v.doors].sort((a, b) => Number(b.seat === officer.seat.id) - Number(a.seat === officer.seat.id));
    v.root.updateMatrixWorld(true);
    for (const door of doors) {
      const exit = v.localToWorld(door.entry, new THREE.Vector3());
      exit.y = this.env.collision.getGroundHeight(exit.x, exit.z, v.root.position.y + 0.4, 0.36);
      const test = { x: exit.x, z: exit.z };
      this.env.collision.resolveCircle(test, exit.y, 0.32, 1.8, 0.36);
      if (dist(test, exit) > 0.08 || this.env.waterDepth?.(exit.x, exit.z) > 0.1) continue;
      this._seated(officer);
      officer.from = new THREE.Vector3(officer.x, officer.y, officer.z); officer.exit = exit;
      officer.door = door; door.target = 1; officer.state = 'EXITING'; officer.timer = 0;
      v.npcSeats.delete(officer.seat.id);
      return true;
    }
    return false;
  }

  _see(from, range, ownVehicle) {
    if (this.game.interiors?.active) return false;
    const target = this.playerPosition;
    if (dist(from, target) > range) return false;
    q.set(target.x, target.y + 1.2, target.z);
    return lineOfSight(this.env.collision, from, q, [ownVehicle?.id, this.game.vehicles.playerVehicle?.id]);
  }

  update(dt) {
    if (this.outcome) { this._outcomeTick(dt); return; }
    if (!this.env || !this.status || this.game.state !== 'playing' || this.game.mapLoading) { this.audio.update(dt, 0, false); return; }
    this.time += dt;
    if (this.status.health <= 0) { this._outcome('wasted'); return; }
    if (!this.graph) return;
    const wanted = this.status.wanted, response = responseFor(wanted);
    if (wanted && !this._wanted) { this.lastKnown.copy(this.playerPosition); this.lastSeen = this.time; }
    this._wanted = wanted;
    // Interiores: a polícia não entra (sem navegação policial interna); a última posição
    // conhecida passa a ser a porta usada e a busca acontece do lado de fora.
    const indoor = this.game.interiors?.active;
    if (indoor && wanted && this._indoor !== indoor) { const e = indoor.ext; this.lastKnown.set(e.poi.x + e.normal.x * 2, e.poi.y, e.poi.z + e.normal.z * 2); }
    this._indoor = indoor || null;
    // Aiming directly at a visible officer is perceived as a threat.
    if (!wanted && this.game.weapons?.drawn && this.game.weapons.aim > 0.5) {
      const heading = this.game.player.controller.yaw || 0;
      for (const officer of this.officers) {
        if (officer.health <= 0) continue;
        const at = officer.state === 'SEATED' ? officer.unit.v.root.position : officer;
        const dx = at.x - this.playerPosition.x, dz = at.z - this.playerPosition.z, d = Math.hypot(dx, dz);
        if (d < 20 && (dx * Math.sin(heading) + dz * Math.cos(heading)) / (d || 1) > 0.92 && this._see(new THREE.Vector3(at.x, at.y + 1.5, at.z), 20, officer.unit.v)) {
          this.lastViolent = this.time; this.report('threatCop', 'aim'); break;
        }
      }
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = wanted ? 3 : 8;
      if (this.units.length < response.units) this._spawn(this.units.length === 0 ? 'patrol' : response.tier,
        response.roadblock && !this.units.some(u => u.roadblock) && this.units.length >= 2);
    }
    for (const unit of [...this.units]) {
      unit.age += dt; unit.sense -= dt;
      if (unit.sense <= 0) {
        unit.sense = 0.2;
        let saw = false;
        for (const officer of unit.officers) {
          if (officer.health <= 0) continue;
          const at = officer.state === 'SEATED' ? unit.v.root.position : officer;
          p.set(at.x, at.y + 1.55, at.z);
          if (this._see(p, response.range, unit.v)) saw = true;
        }
        unit.seesPlayer = saw;
        if (wanted && saw) this._sighting();
      }
      if (unit.officers.every(o => o.health <= 0) && !this._visible(unit.v.root.position) && dist(unit.v.root.position, this.playerPosition) > 50) { this._remove(unit); continue; }
      if (this.units.length > response.units && dist(unit.v.root.position, this.playerPosition) > 100 && !this._visible(unit.v.root.position)) { this._remove(unit); continue; }
      this._unitTick(unit, dt, response);
    }
    this._helicopterTick(dt, response);
    const unseen = this.time - this.lastSeen > 3;
    this.status.searching = wanted > 0 && unseen;
    this.status.searchTime = this.time;
    if (wanted && unseen) {
      this.searchClock += dt;
      if (this.searchClock >= response.escape) {
        this.status.setWanted(wanted - 1); this.searchClock = 0; this.stats.escaped++;
        if (!this.status.wanted) this.events.emit('policeEscape');
      }
    } else this.searchClock = 0;
    let nearest = Infinity;
    for (const unit of this.units) if (unit.v.engineOn && !unit.disabled && unit.v.driver !== 'player') nearest = Math.min(nearest, dist(unit.v.root.position, this.playerPosition));
    this.sirenTimer -= dt;
    if (wanted && this.sirenTimer <= 0) {
      this.sirenTimer = 1.5;
      for (const unit of this.units) if (unit.v.driver === 'police' && unit.v.physics.speed > 2) this.events.emit('siren', { x: unit.v.root.position.x, z: unit.v.root.position.z, id: unit.v.id, source: 'police' });
    }
    this.audio.update(dt, nearest, wanted > 0 && nearest < 130);
    this.audio.rotor?.(dt, this.helicopter && this.helicopter.health > 0 ? this.helicopter.root.position.distanceTo(this.playerPosition) : Infinity);
  }

  _unitTick(unit, dt, response) {
    const v = unit.v, wanted = this.status.wanted, alive = unit.officers.filter(o => o.health > 0);
    if (alive.length && !alive.some(o => o.seat.driver)) {
      // A surviving partner takes the driver's role when the driver is down.
      const driverSeat = v.seats.find(s => s.driver);
      if (driverSeat) { v.npcSeats.delete(alive[0].seat.id); alive[0].seat = driverSeat; }
    }
    const seated = alive.filter(o => o.state === 'SEATED');
    unit.planTimer -= dt;
    if (v.driver === 'player') {
      if (!unit.stolen) this.report('stealPolice', v.id, v.root.position);
      unit.stolen = true; unit.state = 'FOOT';
    }
    if (v.damage.integrity < 12) unit.disabled = true;
    if (!alive.length) {
      v.driver = null; v.engineOn = false;
      v.policeRed.material.emissiveIntensity = v.policeBlue.material.emissiveIntensity = 0;
      Object.assign(v.controls, { throttle: 0, brake: 1, handbrake: true }); return;
    }
    if (unit.roadblock && wanted < 4) { unit.roadblock = false; unit.state = 'RETURN'; }
    const nearTarget = dist(v.root.position, this.lastKnown) < 17;
    const approach = unit.path?.points[unit.path.points.length - 1];
    const atRoadEnd = approach && unit.goal && dist(unit.goal, this.lastKnown) < 14 && dist(v.root.position, approach) < 9 && dist(v.root.position, this.lastKnown) < 90;
    if (seated.length && (unit.disabled || unit.roadblock || (wanted && (nearTarget || atRoadEnd) && (!this.game.vehicles.playerVehicle || this.game.vehicles.playerVehicle.physics.speed < 1.2)))) {
      Object.assign(v.controls, { throttle: 0, brake: 1, handbrake: true });
      for (const officer of seated) this._exit(officer);
      unit.state = unit.roadblock ? 'ROADBLOCK' : 'FOOT';
    } else if (seated.length === alive.length && !unit.stolen && !unit.disabled && !unit.roadblock) {
      v.driver = 'police'; v.engineOn = true;
      unit.state = wanted ? this.status.searching ? 'SEARCH' : 'PURSUIT' : 'PATROL';
      const goal = wanted ? this._pursuitGoal(unit) : unit.goal;
      if (!unit.path || unit.planTimer <= 0 && (wanted || !goal || dist(v.root.position, goal) < 12)) {
        let target = goal;
        if (!wanted) {
          const choices = this.graph.segments.filter(s => !s.sink && s.out.length && s.path.length > 20);
          const segment = choices[Math.floor(Math.random() * choices.length)];
          target = segment?.path.sample(segment.path.length / 2, new THREE.Vector3());
        }
        if (target) { unit.path = roadRoute(this.graph, v.root.position, v.root.rotation.y, target); unit.goal = target.clone(); }
        unit.planTimer = wanted ? 1.4 : 5;
      }
      // Sem rota a partir da faixa atual (faixa sem saída/desconectada): tenta meia-volta e
      // depois um alvo intermediário; antes a viatura ficava freada para sempre sem caminho.
      if (!unit.path) {
        unit.noRoute = (unit.noRoute || 0) + dt;
        if (unit.noRoute > 1.5 && unit.goal) {
          unit.path = roadRoute(this.graph, v.root.position, v.root.rotation.y + Math.PI, unit.goal)
            || roadRoute(this.graph, v.root.position, v.root.rotation.y, v.root.position.clone().add(new THREE.Vector3(Math.sin(v.root.rotation.y) * 60, 0, Math.cos(v.root.rotation.y) * 60)));
          if (unit.path) this.stats.reroutes = (this.stats.reroutes || 0) + 1;
        }
        if (!unit.path && unit.noRoute > 8 && !this._visible(v.root.position) && dist(v.root.position, this.playerPosition) > 60) {
          this.stats.noRouteRecycled = (this.stats.noRouteRecycled || 0) + 1;
          if (import.meta.env?.DEV) console.warn('[Polícia] viatura sem rota reciclada fora da vista', v.id);
          this._remove(unit); return;
        }
      } else unit.noRoute = 0;
      if (unit.reverse > 0) {
        // Ré curta: abre espaço para o desvio.
        unit.reverse -= dt; Object.assign(v.controls, { throttle: -0.8, brake: 0, steer: unit.revSteer || 0, handbrake: false }); v.physics.wake();
        if (unit.reverse <= 0) unit.bypass = this._bypassPath(unit);
      } else if (unit.bypass) {
        // Desvio temporário pela lateral livre; volta à rota original logo à frente.
        unit.bypass.t -= dt;
        driveTo(v, unit.bypass.path, 7, dt, this.game.vehicles.list, true);
        const left = unit.bypass.path.length - unit.bypass.path.project(p.set(v.physics.x, 0, v.physics.z)).s;
        if (left < 2 || unit.bypass.t <= 0) { unit.bypass = null; unit.planTimer = 0; }
      } else {
        driveTo(v, unit.path, response.speed, dt, this.game.vehicles.list, wanted >= 1);
        // Preso: acelerando sem sair do lugar OU freado por obstáculo com rota pela frente.
        const remaining = unit.path ? unit.path.length - unit.path.project(p.set(v.physics.x, 0, v.physics.z)).s : 0;
        const blocked = v.physics.speed < 0.5 && ((v.controls.throttle > 0.2) || (v.controls.brake > 0.5 && remaining > 12));
        unit.stuck = blocked ? unit.stuck + dt : 0;
        if (unit.stuck > 2.5) { unit.reverse = 1.8; unit.revSteer = 0; unit.stuck = 0; this.stats.unstuck = (this.stats.unstuck || 0) + 1; }
      }
    } else if (v.driver !== 'player') {
      v.driver = seated.some(o => o.seat.driver) ? 'police' : null;
      Object.assign(v.controls, { throttle: 0, brake: 1, handbrake: true });
      if (!wanted) unit.state = 'RETURN';
    }
    const flash = Math.sin(this.time * 14 + unit.age) > 0;
    v.policeRed.material.emissiveIntensity = wanted && flash ? 4 : 0;
    v.policeBlue.material.emissiveIntensity = wanted && !flash ? 4 : 0;
  }

  postUpdate(dt) {
    if (!this.env || !this.status || this.game.state !== 'playing' || this.game.mapLoading || this.outcome) return;
    for (const officer of this.officers) {
      officer.flash = Math.max(0, officer.flash - dt); officer.fire -= dt;
      if (officer.state === 'SEATED') this._seated(officer);
      else this._officerTick(officer, dt);
      this.renderer.write(officer);
    }
    if (this.status.health <= 0) this._outcome('wasted');
  }

  _officerTick(officer, dt) {
    const v = officer.unit.v;
    if (officer.health <= 0) {
      officer.pose.sit = 0; officer.pose.lie = Math.min(1, officer.pose.lie + dt * 4);
      officer.aiming = false; officer.speed = 0; return;
    }
    if (officer.state === 'EXITING' || officer.state === 'ENTERING') {
      officer.timer += dt;
      const k = clamp(officer.timer / 1.1, 0, 1), entering = officer.state === 'ENTERING';
      this._seated(officer);
      const seated = new THREE.Vector3(officer.x, officer.y, officer.z);
      const pos = entering ? p.lerpVectors(officer.exit, seated, k) : p.lerpVectors(seated, officer.exit, k);
      officer.x = pos.x; officer.y = pos.y; officer.z = pos.z;
      officer.pose.sit = entering ? k : 1 - k;
      if (k >= 1) {
        officer.door.target = 0; officer.state = entering ? 'SEATED' : 'CHASE';
        if (entering) v.npcSeats.add(officer.seat.id);
        else { officer.pose = officerPose(); officer.planTimer = 0; }
      }
      return;
    }
    // A police car can hit a person too. Attribute crime only to the player car.
    for (const car of this.game.vehicles.list) {
      if (car === v || !car.root.visible || car.physics.speed < 3 || Math.abs(car.root.position.y - officer.y) > 1.4) continue;
      const dx = officer.x - car.root.position.x, dz = officer.z - car.root.position.z, h = car.root.rotation.y;
      if (Math.abs(dx * Math.cos(h) - dz * Math.sin(h)) < car.spec.width / 2 + 0.25 && Math.abs(dx * Math.sin(h) + dz * Math.cos(h)) < car.spec.length / 2 + 0.3) {
        this._hurt(officer, car.physics.speed * 6, car.driver === 'player'); return;
      }
    }
    const wanted = this.status.wanted, uniform = UNIFORMS[officer.tier], suspect = this.playerPosition;
    const response = responseFor(wanted);
    p.set(officer.x, officer.y + 1.55, officer.z);
    const sees = wanted && this._see(p, response.range, v);
    if (sees) this._sighting();
    let goal;
    const suspectCar = this.game.vehicles.playerVehicle;
    const distance = dist(officer, suspect);
    const threatened = this.time - this.lastViolent < 12 || (this.game.weapons?.aim > 0.4 && sees);
    officer.aiming = false; officer.speed = 0;
    if (!wanted) {
      officer.state = 'RETURN';
      if (v.driver === 'player' || officer.unit.disabled) {
        officer.state = 'GUARD'; officer.pose = officerPose(); return;
      }
      v.root.updateMatrixWorld(true);
      const door = v.doors.find(d => d.seat === officer.seat.id) || v.doors[0];
      goal = v.localToWorld(door.entry, new THREE.Vector3());
      goal.y = this.env.collision.getGroundHeight(goal.x, goal.z, officer.y + 0.4, 0.36);
      if (dist(officer, goal) < 0.8 && v.physics.speed < 0.5) {
        officer.exit = new THREE.Vector3(officer.x, officer.y, officer.z);
        officer.door = door; officer.door.target = 1; officer.timer = 0; officer.state = 'ENTERING'; return;
      }
    } else if (sees) {
      officer.yaw = Math.atan2(suspect.x - officer.x, suspect.z - officer.z);
      const moving = suspectCar ? suspectCar.physics.speed : this.game.player.controller.horizontalSpeed || 0;
      let arrestRange = distance;
      if (suspectCar) {
        const driverDoor = suspectCar.doors.find(d => d.side === 1) || suspectCar.doors[0];
        arrestRange = driverDoor ? dist(officer, suspectCar.localToWorld(driverDoor.entry, q)) : Infinity;
      }
      if (arrestRange < 1.65 && moving < 0.9 && !threatened) {
        officer.state = 'ARREST'; officer.arrest += dt;
        if (this.time - this.arrestToast > 4) { this.arrestToast = this.time; this.game.hud?.toast?.('POLÍCIA! PARADO! — mova-se para fugir', 2); }
        if (officer.arrest > (suspectCar ? 2 : 1.3)) this._outcome('busted');
        officer.pose.armL = officer.pose.armR = 0.9; return;
      }
      officer.arrest = 0;
      if (canUseFirearms(wanted, threatened) && distance > 3 && distance < (officer.tier === 'patrol' ? 27 : 38)) {
        officer.state = officer.health < uniform.health * 0.3 ? 'COVER' : 'COMBAT';
        officer.aiming = true;
        if (officer.fire <= 0) this._shoot(officer, suspectCar);
        if (officer.state !== 'COVER') { this._animate(officer, dt); return; }
        // Wounded officers fall back toward their own vehicle's far side.
        const away = q.subVectors(v.root.position, suspect).setY(0).normalize();
        goal = v.root.position.clone().addScaledVector(away, 3.5);
      } else {
        officer.state = 'CHASE';
        if (suspectCar && suspectCar.physics.speed > 5 && dist(officer, v.root.position) < 8 && !officer.unit.stolen && !officer.unit.disabled) {
          officer.state = 'RETURN';
          const door = v.doors.find(d => d.seat === officer.seat.id) || v.doors[0];
          goal = v.localToWorld(door.entry, new THREE.Vector3());
          if (dist(officer, goal) < 0.8) {
            officer.exit = new THREE.Vector3(officer.x, officer.y, officer.z); officer.door = door;
            door.target = 1; officer.state = 'ENTERING'; officer.timer = 0; return;
          }
        } else {
          goal = suspectCar ? suspectCar.localToWorld((suspectCar.doors.find(d => d.side === 1) || suspectCar.doors[0]).entry, new THREE.Vector3()) : this.lastKnown.clone();
          if (distance < 1.5 && officer.fire <= 0) { this.status.damage(6); officer.fire = 1.3; }
        }
      }
    } else {
      officer.arrest = 0; officer.state = 'SEARCH';
      // Search offsets are anchored to the last sighting, never hidden movement.
      goal = this.lastKnown.clone();
      if (dist(officer, goal) < 5) {
        const a = Math.floor(this.time / 6) * 1.7 + officer.slot;
        goal.x += Math.sin(a) * 12; goal.z += Math.cos(a) * 12;
      }
    }
    if (goal && !this.outcome) this._walk(officer, goal, wanted ? 4.4 : 1.6, dt);
    this._animate(officer, dt);
  }

  _walk(officer, goal, speed, dt) {
    officer.planTimer -= dt;
    if (officer.planTimer <= 0) {
      officer.path = footRoute(this.env, officer, goal, 260); officer.pathIndex = 0;
      officer.planTimer = 0.9 + officer.slot * 0.025;
    }
    const waypoint = officer.path[officer.pathIndex];
    if (!waypoint) return;
    const distance = dist(officer, waypoint);
    if (distance < 0.35) { officer.pathIndex++; return; }
    const step = Math.min(distance, speed * dt), dx = (waypoint.x - officer.x) / distance, dz = (waypoint.z - officer.z) / distance;
    const next = { x: officer.x + dx * step, z: officer.z + dz * step };
    const beforeX = officer.x, beforeZ = officer.z;
    this.env.collision.resolveCircle(next, officer.y, 0.32, 1.8, 0.36);
    // Separation between officers prevents a single overlapping pile.
    for (const other of this.officers) {
      if (other === officer || other.health <= 0 || other.state === 'SEATED') continue;
      const d = Math.hypot(next.x - other.x, next.z - other.z);
      if (d < 0.6 && d > 0.001) { next.x += (next.x - other.x) / d * 0.05; next.z += (next.z - other.z) / d * 0.05; }
    }
    this.env.collision.resolveCircle(next, officer.y, 0.32, 1.8, 0.36);
    if (dist(next, officer) > step + 0.3 || this.env.waterDepth?.(next.x, next.z) > 0.1 || this.env.boundaryHint?.(next.x, next.z, 0.4)) return;
    officer.x = next.x; officer.z = next.z;
    officer.y = this.env.collision.getGroundHeight(officer.x, officer.z, officer.y + 0.4, 0.36);
    officer.speed = Math.hypot(officer.x - beforeX, officer.z - beforeZ) / Math.max(dt, 0.001);
    if (!officer.aiming) officer.yaw += clamp(angleDelta(officer.yaw, Math.atan2(dx, dz)), -HEADING_RATE * dt, HEADING_RATE * dt);
  }

  _animate(officer, dt) {
    const pose = officer.pose; pose.sit = 0;
    officer.phase += officer.speed * dt * 3.6;
    const swing = Math.sin(officer.phase) * Math.min(0.85, officer.speed * 0.2);
    pose.thighL = swing; pose.thighR = -swing;
    pose.kneeL = Math.max(0, -swing) * 1.2; pose.kneeR = Math.max(0, swing) * 1.2;
    pose.armL = officer.aiming ? 1.35 : -swing * 0.8; pose.armR = officer.aiming ? 1.5 : swing * 0.8;
    pose.elbowL = officer.aiming ? 0.4 : 0.15; pose.elbowR = officer.aiming ? 0.2 : 0.15;
    pose.bob = Math.abs(Math.sin(officer.phase)) * Math.min(0.035, officer.speed * 0.008);
    pose.lean = officer.speed > 3 ? 0.08 : 0;
  }

  _shoot(officer, suspectCar) {
    const uniform = UNIFORMS[officer.tier];
    officer.fire = uniform.interval + Math.random() * 0.3; officer.flash = 0.08;
    const from = new THREE.Vector3(officer.x + Math.sin(officer.yaw) * 0.65, officer.y + 1.4, officer.z + Math.cos(officer.yaw) * 0.65);
    const target = new THREE.Vector3(this.playerPosition.x, this.playerPosition.y + 1.1, this.playerPosition.z);
    if (!lineOfSight(this.env.collision, from, target, [officer.unit.v.id, suspectCar?.id])) return;
    // Other officers can block a shot; never shoot through a friendly body.
    const ray = q.subVectors(target, from).normalize(), length = from.distanceTo(target);
    for (const other of this.officers) {
      if (other === officer || other.health <= 0 || other.state === 'SEATED') continue;
      r.set(other.x - from.x, other.y + 1 - from.y, other.z - from.z);
      const t = r.dot(ray);
      if (t > 0.5 && t < length && r.addScaledVector(ray, -t).length() < 0.5) return;
    }
    const moving = this.game.player.controller.horizontalSpeed || 0;
    const accuracy = clamp(0.8 - length * 0.013 - moving * 0.025, 0.15, 0.75);
    const hit = Math.random() < accuracy;
    if (!hit) target.x += (Math.random() < 0.5 ? -1 : 1) * 1.2;
    this.game.weapons?.effects?.tracer(from, target);
    this.game.weapons?.audio?.shot({ body: 125, crack: 2300, decay: 0.2, gain: 0.25 * Math.max(0.1, 1 - length / 90) }, 'pistol');
    if (hit) {
      this.status.damage(uniform.damage * (suspectCar ? 0.5 : 1));
      if (suspectCar) suspectCar.damage.integrity = Math.max(0, suspectCar.damage.integrity - uniform.damage * 0.35);
    }
    this.stats.shots++;
    this.events.emit('gunshot', { x: from.x, y: from.y, z: from.z, source: 'police', weapon: officer.tier });
  }

  _hurt(officer, damage, player = true) {
    if (officer.health <= 0) return { kill: false };
    officer.health = Math.max(0, officer.health - damage * (1 - UNIFORMS[officer.tier].armor));
    if (officer.health === 0) officer.unit.v.npcSeats.delete(officer.seat.id);
    if (player) { this.lastViolent = this.time; this.report(officer.health <= 0 ? 'killCop' : 'attackCop', officer.slot); }
    officer.planTimer = 0; this.stats.hits++;
    return { kill: officer.health <= 0 };
  }

  hitVehicle(id, damage) {
    const unit = this.units.find(u => u.v.id === id);
    if (!unit || !Number.isFinite(damage) || damage <= 0) return false;
    unit.v.damage.integrity = Math.max(0, unit.v.damage.integrity - damage * (unit.tier === 'swat' || unit.tier === 'army' ? 0.15 : 0.4));
    this.lastViolent = this.time; this.report('shootPolice', id);
    return true;
  }

  _rayHit(origin, direction, maxT) {
    let best = maxT, target = null;
    for (const officer of this.officers) {
      if (officer.health <= 0 || officer.state === 'SEATED' || officer.state === 'EXITING' || officer.state === 'ENTERING') continue;
      // Vertical body AABB; map/vehicle rays are resolved first by WeaponBallistics.
      let near = 0, far = best;
      for (const [axis, low, high] of [['x', officer.x - 0.3, officer.x + 0.3], ['y', officer.y, officer.y + 1.85], ['z', officer.z - 0.3, officer.z + 0.3]]) {
        if (Math.abs(direction[axis]) < 1e-8) { if (origin[axis] < low || origin[axis] > high) { far = -1; break; } }
        else {
          let a = (low - origin[axis]) / direction[axis], b = (high - origin[axis]) / direction[axis];
          if (a > b) [a, b] = [b, a]; near = Math.max(near, a); far = Math.min(far, b);
        }
      }
      if (near < far && near < best && near > 0) { best = near; target = { onHit: ({ damage }) => this._hurt(officer, damage) }; }
    }
    if (this.helicopter && this.helicopter.health > 0) {
      const sphere = new THREE.Sphere(this.helicopter.root.position, 2.3);
      const point = new THREE.Ray(origin, direction).intersectSphere(sphere, new THREE.Vector3());
      const t = point ? origin.distanceTo(point) : Infinity;
      if (t < best) {
        best = t; target = { onHit: ({ damage }) => { this.helicopter.health -= damage; this.report('shootPolice', 'heli'); return { kill: this.helicopter.health <= 0 }; } };
      }
    }
    return target ? { t: best, normal: direction.clone().negate(), material: 'metal', target } : null;
  }

  _helicopterTick(dt, response) {
    if (response.helicopter && !this.helicopter && this.time > (this.heliCooldown || 0)) {
      const spawn = this._spawnPoint(this.lastKnown);
      if (spawn) { this.helicopter = createHelicopter(this.game.scene); this.helicopter.root.position.set(spawn.pos.x, 65, spawn.pos.z); }
    }
    const helicopter = this.helicopter;
    if (!helicopter) return;
    if (helicopter.health <= 0) {
      helicopter.root.position.y -= dt * 8; helicopter.root.rotation.z += dt * 1.5;
      if (helicopter.root.position.y < 2) { this._removeHelicopter(); this.heliCooldown = this.time + 35; }
      return;
    }
    if (!response.helicopter) {
      helicopter.root.position.y += dt * 10;
      if (helicopter.root.position.y > 130) this._removeHelicopter();
      return;
    }
    helicopter.phase += dt * 0.18;
    const goal = this.lastKnown.clone().add(new THREE.Vector3(Math.sin(helicopter.phase) * 24, 0, Math.cos(helicopter.phase) * 24));
    let roof = 25;
    const at = helicopter.root.position;
    for (const c of this.env.collision._gather(Math.min(goal.x, at.x) - 8, Math.min(goal.z, at.z) - 8, Math.max(goal.x, at.x) + 8, Math.max(goal.z, at.z) + 8)) {
      // Colisores de interiores ficam numa camada separada (Y=300): não são prédios do mapa.
      if (c.minY > 150) continue;
      roof = Math.max(roof, c.maxY + 12);
    }
    goal.y = Math.max(roof, 32);
    const before = helicopter.root.position.clone();
    helicopter.root.position.lerp(goal, 1 - Math.exp(-dt * 0.6));
    // Sobe antes de avançar sobre prédios mais altos (nunca atravessa telhados).
    if (helicopter.root.position.y < roof) helicopter.root.position.y = Math.min(roof, before.y + dt * 12);
    const wantYaw = Math.atan2(this.lastKnown.x - helicopter.root.position.x, this.lastKnown.z - helicopter.root.position.z);
    const turn = clamp(angleDelta(helicopter.root.rotation.y, wantYaw), -1.1 * dt, 1.1 * dt);
    helicopter.root.rotation.y += turn;
    const vel = helicopter.root.position.clone().sub(before).divideScalar(Math.max(dt, 1e-3));
    const fwd = vel.x * Math.sin(helicopter.root.rotation.y) + vel.z * Math.cos(helicopter.root.rotation.y);
    helicopter.root.rotation.x = THREE.MathUtils.lerp(helicopter.root.rotation.x, clamp(fwd * 0.012, -0.25, 0.25), 1 - Math.exp(-dt * 2));
    helicopter.root.rotation.z = THREE.MathUtils.lerp(helicopter.root.rotation.z, clamp(-turn / Math.max(dt, 1e-3) * 0.15, -0.3, 0.3), 1 - Math.exp(-dt * 2));
    helicopter.rotor.rotation.y += dt * 30; helicopter.tail.rotation.x += dt * 40;
    helicopter.fire -= dt;
    const from = helicopter.root.position.clone();
    if (this._see(from, 115)) {
      this._sighting();
      if (this.status.wanted >= 3 && helicopter.fire <= 0) {
        helicopter.fire = 1.6;
        const target = this.playerPosition.clone().add(new THREE.Vector3(0, 1, 0));
        this.game.weapons?.effects?.tracer(from, target);
        if (Math.random() < 0.25) this.status.damage(5);
        this.stats.shots++;
      }
    }
  }

  _removeHelicopter() {
    if (!this.helicopter) return;
    const geometries = new Set(), materials = new Set();
    this.helicopter.root.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    for (const g of geometries) g.dispose(); for (const m of materials) m.dispose();
    this.helicopter.root.removeFromParent(); this.helicopter = null;
  }

  _outcome(type) {
    if (this.outcome) return;
    this.outcome = { type, timer: 3 }; this.game.state = type;
    this.stats[type === 'busted' ? 'arrests' : 'wasted']++;
    this.banner.textContent = type === 'busted' ? 'PRESO' : 'MORTO';
    this.banner.classList.add('visible');
    this.banner.classList.toggle('wasted', type === 'wasted');
    for (const unit of this.units) if (unit.v.driver !== 'player') Object.assign(unit.v.controls, { throttle: 0, brake: 1, handbrake: true });
    const vehicle = this.game.vehicles.playerVehicle;
    if (vehicle) Object.assign(vehicle.controls, { throttle: 0, brake: 1, handbrake: true });
    this.audio.update(0.1, 0, false);
  }

  _outcomeTick(dt) {
    this.outcome.timer -= dt;
    if (this.outcome.timer > 0) return;
    const type = this.outcome.type, spawn = this.env.spawnPoint;
    // Morto/preso dentro de um estabelecimento: sai do interior antes de reposicionar
    // (antes: o jogador voltava à rua com o interior ainda ativo e o mundo oculto).
    if (this.game.interiors?.active) this.game.interiors._forceOutside();
    if (this.game.properties?.sleeping) this.game.properties.sleeping = null;
    this.game.vehicles.interaction.forceExit?.(new THREE.Vector3(spawn.x, spawn.y, spawn.z));
    this.clear(); this.status.setHealth(100); this.status.setWanted(0);
    // Multa fictícia limitada ao saldo, pela economia central (propriedades e save intactos).
    const fine = Math.min(FINES[type] ?? 0, this.status.money);
    if (this.game.economy) this.game.economy.spend(fine, type === 'busted' ? 'Fiança (preso)' : 'Despesas hospitalares');
    else this.status.addMoney(-fine);
    this.status.searching = false; this.crimes.reset();
    this.game.player.spawn(spawn); this.game.cameras?.snapToPlayer?.();
    this.game.state = 'playing'; this.lastSeen = -Infinity; this.searchClock = 0; this._wanted = 0;
    this.events.emit('policeRespawn', { outcome: type });
  }

  /**
   * Rota de desvio: escolhe o lado (esquerda/direita) sem paredes nem veículos,
   * passa 3,4 m ao lado do obstáculo e reencontra a rota original ~16 m à frente.
   * Nada é teletransportado nem atravessado: a física e as colisões continuam valendo.
   */
  _bypassPath(unit) {
    const v = unit.v, ph = v.physics, col = this.env.collision;
    const sin = Math.sin(ph.heading), cos = Math.cos(ph.heading);
    const free = (x, z) => {
      if (col.queryCircle(x, z, 1.3).some((c) => c.solid && !c.walkable && c.maxY > ph.y + 0.4 && c.minY < ph.y + 1.6 && c.ownerId !== v.id)) return false;
      return !this.game.vehicles.list.some((o) => o !== v && o.root.visible && Math.hypot(o.root.position.x - x, o.root.position.z - z) < 2.6);
    };
    const rejoin = unit.path ? unit.path.sample(Math.min(unit.path.length, unit.path.project(p.set(ph.x, 0, ph.z)).s + 18), new THREE.Vector3()) : new THREE.Vector3(ph.x + sin * 18, 0, ph.z + cos * 18);
    for (const side of [unit.lastSide === 1 ? -1 : 1, unit.lastSide === 1 ? 1 : -1]) {
      const lx = cos * side, lz = -sin * side; // lateral (esquerda = +1)
      // Saída gradual (ângulo pequeno): lateral completa antes de alcançar o obstáculo.
      const a = new THREE.Vector3(ph.x + sin * 1.5 + lx * 1.0, 0, ph.z + cos * 1.5 + lz * 1.0);
      const b = new THREE.Vector3(ph.x + sin * 5 + lx * 3.4, 0, ph.z + cos * 5 + lz * 3.4);
      const c = new THREE.Vector3(ph.x + sin * 14 + lx * 3.4, 0, ph.z + cos * 14 + lz * 3.4);
      if (!free(b.x, b.z) || !free(c.x, c.z) || !free((b.x + c.x) / 2, (b.z + c.z) / 2)) continue;
      unit.lastSide = side;
      return { path: new Path([new THREE.Vector3(ph.x, 0, ph.z), a, b, c, rejoin]), t: 7 };
    }
    return null; // sem lateral livre: replaneja a rota (outra rua) em vez de forçar passagem
  }

  /** Avistamento: atualiza a última posição e estima a velocidade do suspeito. */
  _sighting() {
    const p0 = this.playerPosition;
    if (this._prevSeen && this.time - this._prevSeen.t > 0.05 && this.time - this._prevSeen.t < 1.5) {
      const k = 1 / (this.time - this._prevSeen.t);
      this.suspectVel.lerp(r.set((p0.x - this._prevSeen.x) * k, 0, (p0.z - this._prevSeen.z) * k), 0.5);
    }
    this._prevSeen = { x: p0.x, z: p0.z, t: this.time };
    this.lastKnown.copy(p0); this.lastSeen = this.time;
  }

  /**
   * Papéis dinâmicos das viaturas: a 1ª segue o suspeito com antecipação curta, a 2ª
   * mira um ponto à frente (interceptação) e as demais fecham por ruas laterais.
   * Destinos são projetados no grafo de ruas por roadRoute (nada em linha reta).
   */
  _pursuitGoal(unit) {
    const goal = unit._goal || (unit._goal = new THREE.Vector3());
    goal.copy(this.lastKnown);
    const fresh = this.time - this.lastSeen < 2.5, v = this.suspectVel, speed = Math.hypot(v.x, v.z);
    if (!fresh || speed < 3) return goal;
    const chasers = this.units.filter((u) => !u.roadblock && !u.stolen);
    const role = Math.max(0, chasers.indexOf(unit));
    const lead = role === 0 ? 1.2 : role === 1 ? 4 : 3;
    goal.x += v.x * lead; goal.z += v.z * lead;
    if (role >= 2) { const side = role % 2 ? 1 : -1; goal.x += (-v.z / speed) * 22 * side; goal.z += (v.x / speed) * 22 * side; }
    unit.role = ['perseguição', 'interceptação', 'flanco'][Math.min(2, role)];
    return goal;
  }

  clear() {
    for (const unit of [...this.units]) this._remove(unit);
    this._removeHelicopter(); this.outcome = null; this.banner?.classList?.remove('visible');
    this.audio.update(0.1, 0, false); this.audio.rotor?.(0.1, Infinity);
  }

  summary() {
    return { units: this.units.length, officers: this.officers.filter(o => o.health > 0).length, helicopter: !!this.helicopter, crimes: { ...this.crimes.counts }, roles: this.units.map(u => u.role || '-'),
      phase: this.status?.searching ? 'SEARCH' : this.status?.wanted ? 'PURSUIT' : 'PATROL',
      lastKnown: this.lastKnown.toArray(), states: this.units.map(u => u.state), ...this.stats };
  }

  radarContacts() {
    if (!this.status?.wanted) return [];
    const contacts = this.units.filter(u => u.officers.some(o => o.health > 0) && !u.stolen)
      .map(u => ({ x: u.v.root.position.x, z: u.v.root.position.z }));
    if (this.helicopter) contacts.push(this.helicopter.root.position);
    return contacts;
  }

  emergencyBehind(agent) {
    if (!this.status?.wanted) return false;
    const h = agent.v.root.rotation.y, sin = Math.sin(h), cos = Math.cos(h), at = agent.v.root.position;
    return this.units.some(unit => {
      const v = unit.v;
      if (v.driver !== 'police') return false;
      const dx = at.x - v.root.position.x, dz = at.z - v.root.position.z;
      const ahead = dx * sin + dz * cos, side = Math.abs(dx * cos - dz * sin);
      return ahead > 4 && ahead < 32 && side < 3.5 && Math.cos(v.root.rotation.y - h) > 0.8;
    });
  }

  dispose() {
    this.clear(); this.renderer.dispose(); this.audio.dispose(); this.banner.remove?.();
    for (const unsubscribe of this.unsub) unsubscribe();
    this.game.weapons?.ballistics?.targets.delete(this.target);
    if (this.status) this.status.policeManaged = false;
  }
}
