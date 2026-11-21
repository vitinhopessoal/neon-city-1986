import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PoliceManager } from '../../src/police/PoliceManager.js';
import { responseFor, canUseFirearms } from '../../src/police/PoliceRules.js';
import { lineOfSight, footRoute, roadRoute, driveTo } from '../../src/police/PoliceNavigation.js';
import { CollisionSystem } from '../../src/physics/CollisionSystem.js';
import { UrbanEvents } from '../../src/city/UrbanEvents.js';
import { PlayerStatus } from '../../src/player/PlayerStatus.js';
import { World } from '../../src/world/World.js';
import { createCoastalCity } from '../../src/world/districts/CoastalCity.js';
import { LaneGraph } from '../../src/traffic/LaneGraph.js';
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics.js';
import { VehicleDamage } from '../../src/vehicles/VehicleDamage.js';
import { VehicleAnimation } from '../../src/vehicles/VehicleAnimation.js';
import { WeaponBallistics } from '../../src/weapons/WeaponBallistics.js';
import { PoliceCrimes, CRIME_TYPES } from '../../src/police/PoliceCrimes.js';
import { FINES } from '../../src/police/PoliceRules.js';

test('PROMPT 08: crimes are deduplicated per event, need witnesses and cap at six stars', () => {
  const c = new PoliceCrimes();
  // 23 disparos de uma rajada em 1,5 s contam uma única vez.
  let total = 0;
  for (let i = 0; i < 23; i++) total += c.evaluate('gunshot', 'burst', i * 0.065);
  assert.equal(total, CRIME_TYPES.gunshot.severity);
  assert.equal(c.evaluate('gunshot', 'burst', 4.2), CRIME_TYPES.gunshot.severity, 'nova rajada depois da janela conta de novo');
  assert.equal(c.evaluate('gunshot', 'burst', 10, { witnessed: false }), 0, 'sem testemunha não gera procurado');
  assert.equal(c.evaluate('attackCop', 3, 20, { witnessed: false }), CRIME_TYPES.attackCop.severity, 'agredir policial dispensa testemunha');
  assert.equal(c.evaluate('pedHit', 'v1:p1', 30), CRIME_TYPES.pedHit.severity);
  assert.equal(c.evaluate('pedHit', 'v1:p1', 30.5), 0, 'o mesmo atropelamento não conta duas vezes');
  assert.equal(c.evaluate('pedHit', 'v1:p2', 30.5), CRIME_TYPES.pedHit.severity, 'outra vítima conta');
  const s = new PlayerStatus();
  for (let i = 0; i < 40; i++) s.reportCrime(5);
  assert.equal(s.wanted, 6, 'nunca passa de seis estrelas');
  s.setWanted(9); assert.equal(s.wanted, 6);
  s.setWanted(-2); assert.equal(s.wanted, 0);
});

function canvasStub() {
  const c = { width: 1, height: 1, classes: new Set(), appendChild() {}, remove() {} };
  c.classList = { add: s => c.classes.add(s), remove: s => c.classes.delete(s), toggle(s, on) { if (on) c.classes.add(s); else c.classes.delete(s); } };
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({ canvas: c, measureText: t => ({ width: String(t).length * 12 }),
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }, { get: (o, k) => k in o ? o[k] : () => {} });
  c.getContext = () => ctx; return c;
}

test('six response levels escalate resources and firearms rules', () => {
  assert.equal(responseFor(0).units, 1);
  for (let i = 1; i <= 6; i++) assert.equal(responseFor(i).units, i);
  assert.equal(responseFor(3).helicopter, true); assert.equal(responseFor(4).roadblock, true);
  assert.equal(responseFor(6).tier, 'army'); assert.equal(responseFor(99), responseFor(6));
  assert.equal(canUseFirearms(1, false), false); assert.equal(canUseFirearms(1, true), true);
  assert.equal(canUseFirearms(2, false), true);
});

test('walls stop sight and shots; bounded foot navigation goes around walls and avoids water', () => {
  const col = new CollisionSystem();
  col.addBox({ id: 'wall', cx: 0, cz: 0, hx: 0.7, hz: 4, minY: 0, maxY: 3, solid: true });
  const from = new THREE.Vector3(-6, 0, 0), to = new THREE.Vector3(6, 0, 0);
  assert.equal(lineOfSight(col, from.clone().setY(1.5), to.clone().setY(1.5)), false);
  assert.equal(lineOfSight(col, from.clone().setZ(6).setY(1.5), to.clone().setZ(6).setY(1.5)), true);
  const env = { collision: col, waterDepth: (x, z) => z < -5 ? 2 : 0 };
  const route = footRoute(env, from, to);
  let routeLength = 0;
  for (let i = 0; i < route.length; i++) routeLength += route[i].distanceTo(route[i - 1] || from);
  assert.ok(routeLength > from.distanceTo(to)); assert.ok(route.some(p => p.z > 4), 'route must go around the wall on its dry side');
  for (let i = 0; i < route.length; i++) {
    assert.ok(env.waterDepth(route[i].x, route[i].z) < 0.1);
    const a = (route[i - 1] || from).clone().setY(0.8), b = route[i].clone().setY(0.8);
    const direction = b.clone().sub(a).normalize(), length = a.distanceTo(b);
    assert.ok(col.sphereCast(a, direction, length, 0.32, 'solid') >= length - 0.06);
  }
});

test('police simulation integrates physical vehicles, crimes, pursuit, combat, escape and respawn', async t => {
  const oldDocument = globalThis.document, oldRandom = Math.random;
  globalThis.document = { createElement: () => canvasStub() };
  let seed = 761;
  Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let world, police;
  try {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 1.8, 0.1, 900);
    camera.position.set(46, 3, 35); camera.lookAt(46, 1, -30); camera.updateMatrixWorld();
    world = new World({ scene, renderer: {}, quality: { pointLights: false, decorDensity: 0.4 } });
    world.loadDistrict(createCoastalCity());
    const playerPosition = new THREE.Vector3(46, 0.15, 30), events = new UrbanEvents();
    const game = { scene, camera, world, state: 'playing', mapLoading: false, audio: {}, hud: { el: canvasStub() },
      player: { controller: { position: playerPosition, collision: world.collision, horizontalSpeed: 0 }, status: new PlayerStatus(),
        spawn(spawn) { playerPosition.set(spawn.x, spawn.y, spawn.z); } } };
    const vehicles = { list: [], _byId: new Map(), interaction: { onFoot: true, vehicle: null, forceExit() { this.vehicle = null; this.onFoot = true; } },
      get playerVehicle() { return this.interaction.vehicle; },
      addVehicle(v) {
        v.physics = new VehiclePhysics(v, world.collision, world); v.physics.syncFromRoot();
        v.physics.resolveOther = id => this._byId.get(id)?.physics;
        v.damage = new VehicleDamage(v); v.animation = new VehicleAnimation(v);
        this.list.push(v); this._byId.set(v.id, v);
      },
      removeVehicle(v) { const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1); this._byId.delete(v.id); return true; } };
    game.vehicles = vehicles;
    let tracers = 0;
    game.weapons = { aim: 0, effects: { tracer() { tracers++; } }, audio: { shot() {} } };
    game.weapons.ballistics = new WeaponBallistics(game);
    police = new PoliceManager(game, events);
    const graph = new LaneGraph(world.roads, world.bounds);
    police.onMapActivated(world, graph); police._visible = () => false;
    const status = game.player.status;

    await t.test('patrols spawn on clear road positions with two actual uniformed people', () => {
      police.update(1 / 60); police.postUpdate(1 / 60);
      assert.equal(police.units.length, 1); assert.equal(police.officers.length, 2);
      const unit = police.units[0];
      assert.equal(unit.v.driver, 'police'); assert.ok(unit.v.policeRed); assert.ok(unit.v.collider);
      assert.equal(unit.v.npcSeats.size, 2); assert.ok(unit.path?.length > 10);
      for (const officer of police.officers) assert.ok([officer.x, officer.y, officer.z, officer.yaw].every(Number.isFinite));
    });

    await t.test('the same physical chassis follows real lane routes rather than teleporting', () => {
      const unit = police.units[0], v = unit.v, start = v.root.position.clone();
      const path = unit.path;
      assert.ok(path?.length > 15);
      for (let frame = 0; frame < 900; frame++) {
        driveTo(v, path, 12, 1 / 60, [], false); v.physics.update(1 / 60); v.syncCollider(v.physics.x, v.physics.y, v.physics.z, v.physics.heading);
        v.animation.update(1 / 60, false);
        assert.ok(v.root.position.toArray().every(Number.isFinite));
      }
      assert.ok(start.distanceTo(v.root.position) > 15, `patrol moved only ${start.distanceTo(v.root.position).toFixed(1)} m`);
    });

    await t.test('police shots and NPC accidents do not add player crimes', () => {
      events.emit('gunshot', { source: 'police', x: 46, z: 30 });
      events.emit('pedHit', { vehicleId: 'civilian', x: 46, z: 30 }); assert.equal(status.wanted, 0);
      events.emit('gunshot', { x: 46, y: 1.4, z: 30 }); assert.equal(status.wanted, 1);
      assert.equal(police.lastKnown.x, 46);
      const heat = status._heat; game.state = 'title'; events.emit('gunshot', { x: 46, z: 30 });
      assert.equal(status._heat, heat); game.state = 'playing';
    });

    await t.test('civilian traffic detects an approaching siren only behind it in the same direction', () => {
      const v = police.units[0].v;
      v.root.updateMatrixWorld(true);
      const ahead = v.localToWorld(new THREE.Vector3(0, 0, 15));
      const civilian = { v: { root: { position: ahead, rotation: { y: v.root.rotation.y } } } };
      assert.equal(police.emergencyBehind(civilian), true);
      civilian.v.root.rotation.y += Math.PI;
      assert.equal(police.emergencyBehind(civilian), false);
    });

    await t.test('six stars deploy bounded mixed reinforcements, roadblock and helicopter', () => {
      status.setWanted(6); police._see = () => false;
      for (let i = 0; i < 12; i++) police.update(3.1);
      assert.equal(police.units.length, 6); assert.ok(police.units.some(u => u.tier === 'army'));
      assert.ok(police.units.some(u => u.roadblock)); assert.ok(police.helicopter);
      assert.equal(police.officers.length, 12); assert.equal(police.free.length, 4);
      for (const unit of police.units) assert.ok(unit.v.root.position.toArray().every(Number.isFinite));
    });

    await t.test('wanted does not auto-decay while seen; losing sight uses last known position', () => {
      status.setWanted(2); police._see = () => true;
      police.update(0.2); const remembered = police.lastKnown.clone();
      status.update(90); assert.equal(status.wanted, 2, 'HUD clock must not clear a live pursuit');
      for (let i = 0; i < 40; i++) police.update(1);
      assert.equal(status.wanted, 2);
      police._see = () => false; playerPosition.x += 30;
      for (let i = 0; i < 5; i++) police.update(1);
      assert.equal(status.searching, true); assert.deepEqual(police.lastKnown.toArray(), remembered.toArray());
      for (let i = 0; i < 35; i++) police.update(1);
      assert.equal(status.wanted, 1);
    });

    await t.test('officers animate safe exits, receive gun hits and never damage through a wall', () => {
      police.clear(); status.setHealth(100); status.setWanted(2);
      playerPosition.set(46, 0.15, 30); police.lastKnown.copy(playerPosition);
      const unit = police._spawn('patrol'); assert.ok(unit);
      unit.v.setPose(28, 0.02, 30, 0);
      for (const officer of unit.officers) assert.equal(police._exit(officer), true);
      for (let i = 0; i < 70; i++) police.postUpdate(1 / 60);
      assert.ok(unit.officers.every(o => o.state !== 'SEATED' && o.pose.sit === 0));
      const officer = unit.officers[0]; officer.x = 40; officer.y = 0.15; officer.z = 30; officer.yaw = Math.PI / 2;
      world.collision.addBox({ id: 'police_test_wall', cx: 43, cz: 30, hx: 0.5, hz: 5, minY: 0, maxY: 3 });
      police._shoot(officer, null); assert.equal(status.health, 100); assert.equal(tracers, 0);
      world.collision.remove('police_test_wall');
      const wanted = status.wanted;
      for (let i = 0; i < 15; i++) police._shoot(officer, null);
      assert.ok(status.health < 100); assert.ok(tracers > 0);
      assert.equal(status.wanted, wanted, 'police fire must not escalate itself');
      status.setHealth(100);
      const before = officer.health;
      const ray = police._rayHit(new THREE.Vector3(36, 1.3, 30), new THREE.Vector3(1, 0, 0), 7);
      assert.ok(ray); ray.target.onHit({ damage: 25 }); assert.ok(officer.health < before);
      assert.ok(status.wanted > 1);
      police._hurt(officer, 1000); assert.equal(officer.health, 0);
    });

    await t.test('officers disembark at a road approach even when the suspect is beyond the sidewalk', () => {
      police.clear(); status.setWanted(1); police.lastViolent = -Infinity;
      playerPosition.set(46, 0.15, 30); police.lastKnown.copy(playerPosition);
      const unit = police._spawn('patrol'); assert.ok(unit);
      unit.v.setPose(28, 0.02, 30, 0);
      unit.path = { points: [new THREE.Vector3(28, 0.02, 20), new THREE.Vector3(28, 0.02, 30)] };
      unit.goal = police.lastKnown.clone();
      police._unitTick(unit, 0.1, responseFor(1));
      assert.ok(unit.officers.every(o => o.state === 'EXITING'));
      for (let i = 0; i < 12; i++) police.postUpdate(0.1);
      status.setWanted(0);
      const officer = unit.officers[0], door = unit.v.doors.find(d => d.seat === officer.seat.id);
      const entry = unit.v.localToWorld(door.entry);
      officer.x = entry.x; officer.y = entry.y; officer.z = entry.z;
      police._officerTick(officer, 0.1); assert.equal(officer.state, 'ENTERING');
      for (let i = 0; i < 12; i++) police._officerTick(officer, 0.1);
      assert.equal(officer.state, 'SEATED'); assert.ok(unit.v.npcSeats.has(officer.seat.id));
      // Leave the other officer available for the live arrest case below.
    });

    await t.test('a stationary unarmed suspect is arrested by an approaching officer', () => {
      const officer = police.officers.find(o => o.health > 0 && o.state !== 'SEATED');
      status.setWanted(1); police.lastViolent = -Infinity; police._see = () => true;
      officer.state = 'CHASE'; officer.x = playerPosition.x - 1.2; officer.y = playerPosition.y; officer.z = playerPosition.z;
      for (let i = 0; i < 5; i++) police._officerTick(officer, 0.3);
      assert.equal(game.state, 'busted'); police.update(3.1); assert.equal(game.state, 'playing');
    });

    await t.test('busted/wasted respawn resets control, health and wanted without removing the arsenal', () => {
      status.setHealth(20); status.money = 660;
      const targets = game.weapons.ballistics.targets;
      police._outcome('busted'); assert.equal(game.state, 'busted'); assert.ok(police.banner.classes.has('visible'));
      police.update(3.1); assert.equal(game.state, 'playing'); assert.equal(status.health, 100);
      assert.equal(status.wanted, 0); assert.equal(status.money, 560); assert.equal(police.units.length, 0);
      assert.ok(targets.has(police.target));
      status.setHealth(0); police.update(0.1); assert.equal(game.state, 'wasted');
      police.update(3.1); assert.equal(game.state, 'playing'); assert.equal(status.money, 510);
    });

    await t.test('PROMPT 08: a gunfire burst raises one star, not three', () => {
      police.clear(); status.setWanted(0); police.crimes.reset();
      for (let i = 0; i < 23; i++) events.emit('gunshot', { x: playerPosition.x, y: 1, z: playerPosition.z });
      assert.equal(status.wanted, 1);
      status.setWanted(0);
    });

    await t.test('PROMPT 08: busted/wasted inside an interior leaves the interior and fines through the economy', () => {
      let left = 0, spent = 0;
      game.interiors = { active: { ext: { poi: { x: 0, y: 0, z: 0 }, normal: { x: 1, z: 0 } } }, _forceOutside() { left++; this.active = null; } };
      game.economy = { spend(n) { spent += n; status.money -= n; return { ok: true }; } };
      status.money = 70;
      police._outcome('busted'); police.update(3.1);
      assert.equal(left, 1, 'o interior é desativado antes do respawn');
      assert.equal(spent, Math.min(FINES.busted, 70), 'multa limitada ao saldo, via economia');
      assert.equal(status.money, 0); assert.equal(game.state, 'playing');
      delete game.interiors; delete game.economy;
    });

    await t.test('PROMPT 08: police cannot see a player inside an interior; search starts at the door', () => {
      game.interiors = { active: { ext: { poi: { x: 10, y: 0.15, z: 20 }, normal: { x: 1, z: 0 } } } };
      status.setWanted(2);
      // (um subteste anterior substitui _see por um stub; testa a implementação real)
      assert.equal(PoliceManager.prototype._see.call(police, new THREE.Vector3(playerPosition.x + 1, 1.5, playerPosition.z), 100, null), false);
      police._indoor = null; police.update(1 / 60);
      assert.ok(Math.hypot(police.lastKnown.x - 12, police.lastKnown.z - 20) < 0.01, 'última posição conhecida = porta usada');
      delete game.interiors; status.setWanted(0); police._indoor = null;
    });

    await t.test('PROMPT 08: pursuit roles intercept ahead of a fast suspect instead of tailing in a straight line', () => {
      police.clear(); status.setWanted(3);
      const a = police._spawn('patrol'), b = police._spawn('patrol'), c = police._spawn('patrol');
      police.lastKnown.set(0, 0, 0); police.lastSeen = police.time; police.suspectVel.set(0, 0, 15);
      const ga = police._pursuitGoal(a).clone(), gb = police._pursuitGoal(b).clone(), gc = police._pursuitGoal(c).clone();
      assert.ok(gb.z > ga.z + 20, 'a segunda viatura mira à frente');
      assert.ok(Math.abs(gc.x) > 15, 'a terceira fecha pela lateral');
      police.lastSeen = police.time - 10;
      assert.equal(police._pursuitGoal(b).distanceTo(police.lastKnown), 0, 'sem contato recente vão à última posição conhecida');
      police.clear(); status.setWanted(0);
    });

    await t.test('PROMPT 08: helicopter altitude ignores the interior layer at Y=300', () => {
      world.collision.addBox({ id: 'int_test_layer', cx: police.lastKnown.x, cz: police.lastKnown.z, hx: 30, hz: 30, minY: 300, maxY: 304, solid: true });
      status.setWanted(4); police.time = 1000; police.heliCooldown = 0;
      for (let i = 0; i < 300; i++) police._helicopterTick(1 / 30, responseFor(4));
      assert.ok(police.helicopter, 'helicóptero ativo');
      assert.ok(police.helicopter.root.position.y < 150, `altitude ${police.helicopter.root.position.y.toFixed(1)} não sobe para a camada de interiores`);
      world.collision.remove('int_test_layer'); police._removeHelicopter(); status.setWanted(0);
    });

    await t.test('map changes and disposal release all people, cars, targets and listeners', () => {
      police._spawn('patrol'); police.onMapActivated(world, graph);
      assert.equal(police.units.length, 0); assert.equal(police.officers.length, 0); assert.equal(police.free.length, 16);
      police.dispose(); assert.equal(game.weapons.ballistics.targets.size, 0); assert.equal(status.policeManaged, false);
      assert.equal(events.listeners.get('gunshot').size, 0); police = null;
    });
  } finally {
    police?.dispose(); world?.destruction.dispose(); world?.lib.dispose();
    globalThis.document = oldDocument; Math.random = oldRandom;
  }
});
