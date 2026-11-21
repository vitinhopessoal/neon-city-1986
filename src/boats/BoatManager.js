import * as THREE from 'three';
import { BOATS, SHOP_ORDER, boatRecord } from './BoatDefinitions.js';
import { BoatFactory } from './BoatFactory.js';
import { BoatPhysics } from './BoatPhysics.js';
import { BoatAudio } from './BoatAudio.js';
import { BoatHUD } from '../ui/BoatHUD.js';
import { MaritimeTraffic } from '../maritime/MaritimeTraffic.js';
import { MarinaNPCs } from '../maritime/MarinaNPCs.js';
import { MARINAS } from '../maritime/MaritimeLocations.js';
import { CAMERA_MODES } from '../camera/CameraManager.js';
import { InteriorBuilder, mat, glow } from '../interiors/InteriorKit.js';
import { neonTextTexture, createSignMesh } from '../world/NeonSign.js';

/**
 * OCEAN DRIVE — embarcações do jogador e do mundo.
 * - Embarque/desembarque com E (píer, praia, ilha ou direto na água → nado).
 * - W/S acelerador e ré, A/D leme, SHIFT potência, Q buzina, V câmera.
 * - Loja da Sunset Marina, MARINA STORAGE (Sunset e Azure), save sem dados Three.js.
 * - Barcos atracados nas vagas podem ser usados como os carros estacionados.
 * - Dano por colisão; casco destruído afunda e é rebocado ao armazém.
 * Só existe no mapa procedural (Sunset Beach); TEST CITY não é afetado.
 */
const STORAGE_CAPACITY = 6;
const LAUNCH = { x: 158, z: -113.5, heading: Math.PI / 2 };
const EXIT_MAX_SPEED = 4;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Barcos atracados no início (um de cada modelo; NCPD só na base). */
const MOORED = [
  { type: 'speedster', marina: 'sunset', slip: 1 },
  { type: 'jetski', marina: 'sunset', slip: 2 },
  { type: 'fisher', marina: 'sunset', slip: 4 },
  { type: 'cruiser', marina: 'azure', slip: 1 },
  { type: 'yacht', marina: 'azure', slip: 3 },
  { type: 'patrol', marina: 'azure', slip: 0, police: true },
];

export class BoatManager {
  constructor(game, water) {
    this.game = game;
    this.water = water;
    this.factory = new BoatFactory();
    this.audio = new BoatAudio(game.audio);
    this.hud = new BoatHUD(game.hud.el);
    this.traffic = new MaritimeTraffic(this);
    this.npcs = new MarinaNPCs(game.scene);
    this.group = new THREE.Group();
    this.group.name = 'boats';
    this.boats = new Map();
    this.owned = new Map();
    this.aboard = null;
    this.seq = null;
    this.ready = false;
    this.active = false;
    this.cam = { orbit: 0, lastYaw: 0, idle: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };
    this._n = 0;
    this._obstacles = [];
    this.stats = { boats: 0, physicsMs: 0, wakeSpawned: 0 };
    game.interiors.outsideProviders.push(() => this._candidates());
    game.player.controller.onSwimChange = (on) => this._onSwim(on);
  }

  // ------------------------------------------------------------ mapa
  onMapActivated(env) {
    this.env = env;
    this.active = !!env.seaOpen;
    if (this.active && !this.ready) this._setup(env);
    this.group.visible = this.active;
    if (!this.active && this.aboard) this.forceExit();
  }

  _setup(env) {
    this.collision = env.collision;
    this.game.scene.add(this.group);
    this._buildStorageKiosk(env);
    this.npcs.build();
    for (const m of MOORED) {
      const slip = this.water.slips[m.marina][m.slip];
      if (!slip) continue;
      const b = this.spawn(m.type, { id: `moored_${m.marina}_${m.slip}`, x: slip.x, z: slip.z, heading: slip.heading, owner: m.police ? 'police' : 'npc' });
      b.anchor = { x: slip.x, z: slip.z, heading: slip.heading };
      b.home = b.anchor;
      if (m.police) b.locked = 'Lancha da NCPD HARBOR PATROL — só para a patrulha marítima (em implantação).';
    }
    this.traffic.spawnAll();
    this.ready = true;
  }

  /** Quiosque da MARINA STORAGE na ponta do píer da Sunset Marina. */
  _buildStorageKiosk(env) {
    const b = new InteriorBuilder();
    const x = 149.4, z = MARINAS.sunset.pierZ - 1.25;
    b.box(mat(0x2f8f83, 0.6), x, 0.55, z, 1.3, 2.2, 0.8, { r: 0.05, collide: true });
    b.box(glow(0x45f3ff, 1.4), x, 2.2, z + 0.41, 1.1, 0.25, 0.02, { r: 0 });
    b.box(mat(0x1a1424, 0.4), x, 1.2, z + 0.41, 0.8, 0.6, 0.02, { r: 0 });
    const built = b.build();
    this.group.add(built.group);
    for (const k of b.colliders) this.water._addCollider(env.collision, k, 'storage');
    const tex = neonTextTexture('MARINA STORAGE', { color: '#45f3ff', style: 'block', width: 1024, height: 256 });
    const sign = createSignMesh(tex, 1.6, 0.4, { intensity: 1.4 });
    sign.group.position.set(x, 3.0, z + 0.42);
    this.group.add(sign.group);
    this.storageAnchors = [
      { x, z: z + 0.9, label: 'MARINA STORAGE · SUNSET', launch: LAUNCH },
      { x: MARINAS.azure.warehouse.x + 5.9, z: MARINAS.azure.warehouse.z + 0.5, label: 'MARINA STORAGE · AZURE', launch: { x: 142, z: MARINAS.azure.pierZ + 8, heading: Math.PI / 2 } },
    ];
    const o = this.water.office;
    this.shopAnchor = { x: o.x - 0.6, z: o.z, label: 'LOJA DE BARCOS · SUNSET MARINA' };
  }

  // ------------------------------------------------------------ entidades
  spawn(type, { id = null, x, z, heading = 0, owner = 'npc', name = null, record = null, hp = null } = {}) {
    const spec = BOATS[type];
    const bid = id || `boat_${++this._n}`;
    const m = this.factory.create(type, { id: bid, name });
    const boat = {
      id: bid, type, spec, name: name || spec.name, model: m, root: m.root, owner, record, maxHp: spec.hp,
      hp: hp ?? spec.hp, driver: null, sinking: 0, anchor: null, wakeAcc: 0, sprayAcc: 0, wasAir: false, hitCd: 0,
    };
    boat.phys = new BoatPhysics(boat, this.collision, this.water.surface);
    boat.phys.place(x, z, heading);
    boat.phys.resolveOther = (oid) => this.boats.get(oid)?.phys;
    boat.phys.onImpact = (imp) => this._impact(boat, imp);
    boat.colliderId = `boatcol_${bid}`;
    this.collision.addBox({ id: boat.colliderId, ownerId: bid, cx: x, cz: z, hx: spec.width / 2, hz: spec.length / 2, rotation: heading, minY: -spec.draft - 1.4, maxY: spec.freeboard + spec.height * 0.6, walkable: false, solid: true, cameraBlocker: false, tags: ['boat'] });
    this.group.add(boat.root);
    this.boats.set(bid, boat);
    this._applyDamageLook(boat);
    this._sync(boat);
    return boat;
  }

  _despawn(boat) {
    if (boat === this.aboard) this.forceExit();
    this.collision.remove(boat.colliderId);
    boat.root.removeFromParent();
    boat.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    boat.model.hullMat.dispose();
    this.boats.delete(boat.id);
    const i = this.traffic.list.indexOf(boat);
    if (i >= 0) this.traffic.list.splice(i, 1);
  }

  _sync(boat) {
    const P = boat.phys;
    boat.root.position.set(P.x, P.y, P.z);
    boat.root.rotation.set(P.pitch, P.heading, P.roll, 'YXZ');
    this.collision.move(boat.colliderId, P.x, P.z, P.heading);
  }

  // ------------------------------------------------------------ interação
  /** Candidatos de E a pé (prioridade por distância, via InteriorManager). */
  _candidates() {
    if (!this.active || !this.ready || this.aboard || this.seq) return [];
    const p = this.game.player.visualPosition;
    const out = [];
    for (const b of this.boats.values()) {
      if (b.owner === 'ai' || b.sinking) continue;
      const P = b.phys;
      if (Math.abs(P.x - p.x) > 20 || Math.abs(P.z - p.z) > 20) continue;
      // Distância até a borda do casco (no referencial do barco).
      const dx = p.x - P.x, dz = p.z - P.z;
      const lx = dx * Math.cos(P.heading) - dz * Math.sin(P.heading), lz = dx * Math.sin(P.heading) + dz * Math.cos(P.heading);
      const ex = Math.max(0, Math.abs(lx) - b.spec.width / 2), ez = Math.max(0, Math.abs(lz) - b.spec.length / 2);
      const d = Math.hypot(ex, ez);
      if (d > 2.2 || P.speed > 1.5) continue;
      out.push({ dist: d + 0.3, anchor: { x: P.x, z: P.z }, label: b.locked ? `${b.name} · NCPD` : `PRESSIONE <kbd>E</kbd> PARA PILOTAR · ${b.name}`, run: () => { if (b.locked) { this.game.hud.toast(b.locked, 3); return null; } this.board(b); return null; } });
    }
    for (const a of this.storageAnchors || []) {
      const d = Math.hypot(a.x - p.x, a.z - p.z);
      if (d < 1.8) out.push({ dist: d, anchor: a, label: `PRESSIONE <kbd>E</kbd> · ${a.label}`, run: () => this.storagePage(a) });
    }
    if (this.shopAnchor) {
      const a = this.shopAnchor, d = Math.hypot(a.x - p.x, a.z - p.z);
      if (d < 2.0) out.push({ dist: d, anchor: a, label: `PRESSIONE <kbd>E</kbd> · ${a.label}`, run: () => this.shopPage() });
    }
    out.push(...this.water.candidates(p));
    return out;
  }

  board(boat, immediate = false) {
    if (this.aboard || boat.driver) return false;
    const g = this.game;
    boat.driver = 'player';
    boat.anchor = null;
    boat.phys.sleeping = false;
    this.aboard = boat;
    const from = g.player.visualPosition.clone();
    this.seq = immediate ? null : { t: 0, dur: 0.55, from };
    this.cam.init = false;
    this.cam.orbit = 0;
    this.cam.lastYaw = g.cameras.yaw;
    this._seatPlayer(immediate ? 1 : 0);
    this.audio.start(boat);
    this.hud.show(boat);
    g.hud.setHelpMode?.('vehicle');
    g.hud.toast(`${boat.name} · ${boat.spec.kind}`, 2);
    return true;
  }

  boardImmediately(pid) {
    const b = [...this.boats.values()].find((x) => x.record?.pid === pid);
    return b ? this.board(b, true) : false;
  }

  _seatWorld(boat, out) {
    const s = boat.spec.seat;
    boat.root.updateWorldMatrix(true, false);
    return out.set(s.x, s.y - 0.95, s.z).applyMatrix4(boat.root.matrixWorld);
  }

  _seatPlayer(k = 1) {
    const b = this.aboard, g = this.game;
    const seat = this._seatWorld(b, _v);
    if (k < 1 && this.seq) seat.lerpVectors(this.seq.from, seat, k);
    const steer = b.phys.steer;
    g.player.setExternalPose(seat, b.phys.heading, 0, k, b.type === 'jetski' ? 0.15 : 0.3, -steer);
    g.player.applyExternalPosition();
  }

  /** Saída: píer/praia/ilha se houver chão ao lado; senão, entra na água nadando. */
  tryExit() {
    const b = this.aboard;
    if (!b) return false;
    const P = b.phys, g = this.game;
    if (P.speed > EXIT_MAX_SPEED && !b.sinking) { g.hud.toast('Reduza a velocidade para sair do barco', 2); return false; }
    const level = this.water.surface.level;
    const col = this.collision;
    const sh = Math.sin(P.heading), ch = Math.cos(P.heading);
    const side = [ch, -sh]; // bombordo
    let spot = null;
    // Anel de pontos ao redor do casco (lados primeiro, depois proa/popa), do mais perto ao mais longe:
    // encontra o píer/praia mesmo com o barco um pouco desalinhado.
    const tries = [];
    for (const m of [0.6, 1.1, 1.8, 2.6, 3.4]) for (let k = 0; k < 16; k++) {
      const a = ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 8 + Math.PI / 2; // começa pelo bombordo e alterna
      tries.push([Math.sin(a) * (b.spec.width / 2 + m), Math.cos(a) * (b.spec.length / 2 + m)]);
    }
    for (const [lx, lz] of tries) {
      const x = P.x + side[0] * lx + sh * lz, z = P.z + side[1] * lx + ch * lz;
      const gnd = col.getGroundHeight(x, z, level + 1.6, 2.2);
      if (gnd < level - 0.25) continue; // água: tenta outro lado
      const list = col.queryCircle(x, z, 0.4, this._tmp || (this._tmp = []));
      if (list.some((c) => c.solid && c.type !== 'ramp' && c.maxY > gnd + 0.36 && c.minY < gnd + 1.8)) continue;
      spot = { x, y: gnd, z };
      break;
    }
    const yaw = P.heading;
    this._leave();
    if (spot) {
      g.player.releaseExternalPose(_v.set(spot.x, spot.y, spot.z), yaw);
    } else {
      // Pula na água ao lado do barco (estado SWIMMING).
      const x = P.x + side[0] * (b.spec.width / 2 + 0.9), z = P.z + side[1] * (b.spec.width / 2 + 0.9);
      g.player.releaseExternalPose(_v.set(x, level - g.player.controller.cfg.swimFloat, z), yaw);
      g.player.controller._setSwimming(true);
    }
    return true;
  }

  _leave() {
    const b = this.aboard;
    if (!b) return;
    b.driver = null;
    b.phys.input.throttle = 0; b.phys.input.steer = 0;
    this.aboard = null;
    this.seq = null;
    this.audio.stop();
    this.hud.hide();
    this.game.hud.setHelpMode?.('foot');
    this.game.hud.setPrompt(null);
    this.game.vehicles.interaction.cooldown = 0.6;
  }

  forceExit() {
    const b = this.aboard;
    if (!b) return;
    const P = b.phys;
    this._leave();
    this.game.player.releaseExternalPose(_v.set(P.x + 2, this.water.surface.level - 1.22, P.z), P.heading);
  }

  _onSwim(on) {
    if (!this.active) return;
    this.audio.splash(on ? 1.2 : 0.5);
    const p = this.game.player.controller.position;
    if (on) {
      this.water.effects.foam(p.x, p.z, 0.6, 2.4, 1.2, 0.8);
      for (let i = 0; i < 6; i++) this.water.effects.spray(p.x, this.water.surface.level, p.z, (Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.35, 0.6);
      this.game.hud.toast('Nadando · ESPAÇO junto ao píer para subir', 2.5);
    }
  }

  // ------------------------------------------------------------ ciclo
  /** Antes dos veículos: E/controles do barco (o carro não reage enquanto embarcado). */
  preUpdate(dt, input) {
    if (!this.active || !this.aboard) return;
    const g = this.game, b = this.aboard, P = b.phys;
    g.vehicles.interaction.suppressed = true;
    if (g.state !== 'playing' || g.menuOpen) { P.input.throttle = 0; P.input.steer = 0; return; }
    if (this.seq) {
      this.seq.t += dt;
      const k = Math.min(1, this.seq.t / this.seq.dur);
      this._seatPlayer(k * k * (3 - 2 * k));
      if (k >= 1) this.seq = null;
      return;
    }
    const dead = b.sinking > 0;
    P.input.throttle = dead ? 0 : (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    P.input.steer = dead ? 0 : (input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0);
    P.input.boost = input.isDown('run');
    this.audio.horn(input.isDown('horn') && !dead);
    g.hud.setPrompt(P.speed < EXIT_MAX_SPEED ? `<kbd>E</kbd> SAIR DO BARCO` : null);
    if (input.wasPressed('interact') && !(g.vehicles.interaction.cooldown > 0)) this.tryExit();
  }

  update(dt) {
    if (!this.active || !this.ready) return;
    const g = this.game;
    const inside = g.interiors?.state && g.interiors.state !== 'outside';
    this.group.visible = !inside;
    const t0 = performance.now();
    const cam = g.camera.position;
    // Obstáculos para a IA: barcos e o jogador (nadando ou a pé no raso).
    const obs = this._obstacles;
    obs.length = 0;
    for (const b of this.boats.values()) obs.push({ x: b.phys.x, z: b.phys.z, r: b.spec.length / 2, boat: b });
    const pc = g.player.controller.position;
    if (!this.aboard) obs.push({ x: pc.x, z: pc.z, r: 1 });
    this.traffic.update(dt, cam, obs);
    for (const b of this.boats.values()) {
      const P = b.phys;
      const far = Math.hypot(P.x - cam.x, P.z - cam.z);
      if (b.ai && b.ai.state === 'far') { this._sync(b); b.root.visible = far < 700; continue; }
      if (b.anchor && !b.driver) this._moor(b, dt, far);
      else P.update(dt);
      if (b.sinking) this._sink(b, dt);
      if (b.hitCd > 0) b.hitCd -= dt;
      this._sync(b);
      b.root.visible = far < 700;
      if (far < 160) this._wake(b, dt);
    }
    if (this.aboard) {
      if (!this.seq) this._seatPlayer(1);
      this.audio.update(dt, this.aboard.phys);
      this.hud.update(dt, this.water.placeAt(this.aboard.phys.x, this.aboard.phys.z));
    }
    this.npcs.update(dt, g.player.visualPosition, !inside);
    // Marulho perto dos píeres (sons do oceano da marina).
    const pp = g.player.visualPosition;
    let near = Infinity;
    for (const m of [MARINAS.sunset, MARINAS.azure]) near = Math.min(near, Math.hypot(Math.max(0, m.x0 - pp.x, pp.x - m.x1), pp.z - m.pierZ));
    this.audio.ambient(inside ? 0 : 1 - near / 45);
    this.stats.boats = this.boats.size;
    this.stats.physicsMs = +(performance.now() - t0).toFixed(3);
  }

  /** Atracado: flutua com as ondas preso por amarras elásticas à vaga. */
  _moor(b, dt, far) {
    const P = b.phys, a = b.anchor;
    if (far > 140) {
      P.x = a.x; P.z = a.z; P.heading = a.heading; P.vx = P.vz = P.yawRate = 0;
      P.y = this.water.surface.height(P.x, P.z);
      const s = this.water.surface.slope(P.x, P.z);
      P.pitch = -s.dz * 0.5; P.roll = s.dx * 0.5;
      return;
    }
    P.input.throttle = 0; P.input.steer = 0;
    P.vx += ((a.x - P.x) * 0.8 - P.vx * 0.9) * dt;
    P.vz += ((a.z - P.z) * 0.8 - P.vz * 0.9) * dt;
    P.yawRate += (wrap(a.heading - P.heading) * 0.6 - P.yawRate * 1.2) * dt;
    P.update(dt);
  }

  _impact(b, imp) {
    if (b.hitCd > 0) return;
    b.hitCd = 0.35;
    const k = Math.min(3, b.spec.mass / 3000) * 0.4 + 0.6;
    // Encostar devagar (ou empurrar contra o píer) não estraga o casco.
    const dmg = Math.max(0, (imp - 3) * 3.2 * k);
    if (b === this.aboard || Math.hypot(b.phys.x - this.game.camera.position.x, b.phys.z - this.game.camera.position.z) < 60) this.audio.impact(imp);
    const P = b.phys;
    for (let i = 0; i < Math.min(10, 2 + imp); i++) this.water.effects.spray(P.x + (Math.random() - 0.5) * b.spec.width, P.y + 0.3, P.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, 0.5, 0.8);
    if (!dmg || b.sinking) return;
    b.hp = Math.max(0, b.hp - dmg);
    if (b.record) b.record.hp = b.hp;
    this._applyDamageLook(b);
    if (b === this.aboard && imp > 6) this.game.player.status.damage?.(Math.min(25, (imp - 6) * 3));
    if (b.hp <= 0) this._destroy(b);
  }

  _applyDamageLook(b) {
    const f = 1 - b.hp / b.maxHp;
    const base = new THREE.Color(b.spec.colors.hull);
    b.model.hullMat.color.copy(base).lerp(new THREE.Color(0x3a3430), f * 0.6);
  }

  _destroy(b) {
    b.sinking = 0.001;
    if (b === this.aboard) this.game.hud.toast('Casco destruído — abandone o barco!', 3);
    if (b.record) b.record.destroyed = true;
  }

  _sink(b, dt) {
    b.sinking += dt;
    const P = b.phys;
    P.input.throttle = 0;
    P.y -= dt * 0.35 * Math.min(1, b.sinking / 2);
    P.pitch += dt * 0.05;
    if (b === this.aboard && b.sinking > 2.5) this.tryExit();
    if (b.sinking > 8) {
      const rec = b.record;
      this._despawn(b);
      if (rec) { rec.location = 'storage'; rec.hp = 0; rec.destroyed = false; delete rec.x; delete rec.z; delete rec.heading; this.game.hud.toast(`${rec.name} rebocado para a MARINA STORAGE (precisa de reparo)`, 3.5); this.game.save?.autosave('Barco rebocado'); }
      else if (b.home) this._respawnLater(b);
    }
  }

  _respawnLater(b) {
    const home = b.home, type = b.type, id = b.id, owner = b.owner;
    setTimeout(() => { if (!this.boats.has(id) && this.ready) { const nb = this.spawn(type, { id, x: home.x, z: home.z, heading: home.heading, owner }); nb.anchor = home; nb.home = home; } }, 60000);
  }

  /** Espuma da esteira (popa), bigodes de proa e respingos ao pousar de saltos. */
  _wake(b, dt) {
    const P = b.phys, fx = this.water.effects;
    const v = P.speed;
    const sh = Math.sin(P.heading), ch = Math.cos(P.heading);
    const L = b.spec.length, W = b.spec.width, w = b.spec.wake;
    if (P.wasAir !== undefined && b.wasAir && !P.airborne && P.vy < -1.5) {
      for (let i = 0; i < 10; i++) fx.spray(P.x + (Math.random() - 0.5) * W, P.y, P.z + (Math.random() - 0.5) * L * 0.5, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.6 * w, 0.9);
      fx.foam(P.x, P.z, W, W * 3, 1.8, 0.7);
      if (b === this.aboard) this.audio.splash(1.5);
    }
    b.wasAir = P.airborne;
    if (v < 1.2 || P.airborne || P.submerged < 0.1) return;
    b.wakeAcc += v * dt;
    const step = 0.8 + w * 0.5;
    while (b.wakeAcc > step) {
      b.wakeAcc -= step;
      const k = Math.min(1, v / b.spec.maxSpeed);
      for (const sd of [-1, 1]) {
        const ox = P.x - sh * L * 0.5 + ch * sd * W * 0.35, oz = P.z - ch * L * 0.5 - sh * sd * W * 0.35;
        fx.foam(ox, oz, W * 0.4 * w, W * (0.9 + k * 1.3) * w, 1.8 + k * 1.6, 0.07 + k * 0.1, ch * sd * (0.8 + k * 1.6), -sh * sd * (0.8 + k * 1.6));
      }
      if (k > 0.35) fx.foam(P.x - sh * L * 0.55, P.z - ch * L * 0.55, W * 0.45, W * 0.9, 0.8, 0.16 * k);
      this.stats.wakeSpawned++;
    }
    if (v > b.spec.maxSpeed * 0.45) {
      b.sprayAcc += dt * v;
      if (b.sprayAcc > 6) {
        b.sprayAcc = 0;
        for (const sd of [-1, 1]) fx.spray(P.x + sh * L * 0.3 + ch * sd * W * 0.5, P.y + 0.2, P.z + ch * L * 0.3 - sh * sd * W * 0.5, ch * sd * 3 + sh * v * 0.3, 1.5 + Math.random(), -sh * sd * 3 + ch * v * 0.3, 0.45 * w, 0.6, 0.55);
      }
    }
  }

  // ------------------------------------------------------------ câmera
  /** Depois do CameraManager: câmera de perseguição náutica ou do piloto (V alterna). */
  cameraTick(dt) {
    const b = this.aboard;
    if (!b || !this.active) return;
    const g = this.game, cam = g.camera, c = this.cam, P = b.phys;
    // Mouse orbita em torno do barco; volta para trás após alguns segundos parado.
    const dy = wrap(g.cameras.yaw - c.lastYaw);
    c.lastYaw = g.cameras.yaw;
    if (Math.abs(dy) > 1e-4) { c.orbit = wrap(c.orbit + dy); c.idle = 0; } else c.idle += dt;
    if (c.idle > 2.2) c.orbit *= Math.exp(-dt * 2.2);
    const first = g.cameras.mode === CAMERA_MODES.FIRST;
    const k = 1 - Math.exp(-dt * (first ? 30 : 5));
    if (first) {
      b.root.updateWorldMatrix(true, false);
      const s = b.spec.seat;
      const pos = _v.set(s.x, b.spec.eye, s.z + 0.1).applyMatrix4(b.root.matrixWorld);
      cam.position.copy(pos);
      _e.set(P.pitch * 0.6 - g.cameras.pitch * 0.5 - 0.05, P.heading + Math.PI + c.orbit, -P.roll * 0.6, 'YXZ');
      cam.quaternion.setFromEuler(_e);
      g.player.applyVisibility(cam, true, false, true);
      c.init = false;
      return;
    }
    const L = b.spec.length;
    const dist = 4.5 + L * 0.85 + Math.min(4, P.speed * 0.12);
    const h = 1.6 + L * 0.18 + b.spec.eye * 0.25;
    const yaw = P.heading + c.orbit;
    const target = _v.set(P.x + Math.sin(P.heading) * L * 0.1, P.y + b.spec.freeboard + 0.6, P.z + Math.cos(P.heading) * L * 0.1);
    const want = new THREE.Vector3(target.x - Math.sin(yaw) * dist, Math.max(this.water.surface.level + 0.9, target.y + h), target.z - Math.cos(yaw) * dist);
    if (!c.init) { c.pos.copy(want); c.look.copy(target); c.init = true; }
    c.pos.lerp(want, k);
    c.look.lerp(target, 1 - Math.exp(-dt * 10));
    cam.position.copy(c.pos);
    cam.lookAt(c.look);
    g.player.applyVisibility(cam, false, false, false);
  }

  // ------------------------------------------------------------ loja
  shopPage(msg = '') {
    const g = this.game, eco = g.economy;
    const stored = [...this.owned.values()].filter((r) => r.location === 'storage').length;
    return {
      who: 'Loja de Barcos · Sunset Marina',
      text: `${msg ? `${msg}\n` : ''}Barcos comprados vão para a MARINA STORAGE (${stored}/${STORAGE_CAPACITY}). Retire-os no quiosque da ponta do píer ou no armazém de Azure Docks.`,
      options: [
        ...SHOP_ORDER.map((t) => {
          const s = BOATS[t];
          const n = [...this.owned.values()].filter((r) => r.type === t).length;
          return { label: `${s.name} · ${s.kind} · $${s.price.toLocaleString('pt-BR')}${n ? ` (possui ${n})` : ''}`, disabled: !eco.canAfford(s.price), run: () => this.shopPage(this.buy(t).msg) };
        }),
        { label: 'Fechar', run: () => null },
      ],
    };
  }

  buy(type) {
    const s = BOATS[type];
    if (!s || s.police || !SHOP_ORDER.includes(type)) return { ok: false, msg: 'Modelo indisponível.' };
    const stored = [...this.owned.values()].filter((r) => r.location === 'storage').length;
    if (stored >= STORAGE_CAPACITY) return { ok: false, msg: 'MARINA STORAGE cheia. Retire um barco antes de comprar outro.' };
    const pid = `boat_${type}_${Date.now().toString(36)}_${this.owned.size}`;
    const r = this.game.economy.spend(s.price, `Barco: ${s.name}`, { txId: `boatbuy_${pid}` });
    if (!r?.ok) return { ok: false, msg: r?.msg || 'Saldo insuficiente.' };
    this.owned.set(pid, boatRecord(type, pid));
    this.game.interiors?.audio.sfx('register');
    this.game.save?.autosave('Barco comprado');
    return { ok: true, msg: `${s.name} comprado! Está na MARINA STORAGE.` };
  }

  storagePage(anchor, msg = '') {
    const list = [...this.owned.values()];
    const stored = list.filter((r) => r.location === 'storage');
    const near = [...this.boats.values()].filter((b) => b.record && !b.driver && !b.sinking && Math.hypot(b.phys.x - anchor.x, b.phys.z - anchor.z) < 45);
    const repairCost = (r) => Math.round((BOATS[r.type].hp - r.hp) * 12);
    return {
      who: `${anchor.label} (${stored.length}/${STORAGE_CAPACITY})`,
      text: `${msg ? `${msg}\n` : ''}${list.length ? list.map((r) => `${r.name} · ${r.location === 'storage' ? 'guardado' : 'na água'} · casco ${Math.round((r.hp / BOATS[r.type].hp) * 100)}%`).join('\n') : 'Nenhum barco seu. Compre na loja da Sunset Marina.'}`,
      options: [
        ...near.map((b) => ({ label: `Guardar ${b.name}`, run: () => this.storagePage(anchor, this.store(b.record.pid).msg) })),
        ...stored.filter((r) => r.hp < BOATS[r.type].hp).map((r) => ({ label: `Reparar ${r.name} · $${repairCost(r)}`, disabled: !this.game.economy.canAfford(repairCost(r)), run: () => this.storagePage(anchor, this.repair(r.pid).msg) })),
        ...stored.map((r) => ({ label: `Retirar ${r.name}`, disabled: r.hp <= 0, run: () => this.storagePage(anchor, this.launch(r.pid, anchor.launch).msg) })),
        { label: 'Fechar', run: () => null },
      ],
    };
  }

  repair(pid) {
    const r = this.owned.get(pid);
    if (!r) return { ok: false, msg: 'Barco não encontrado.' };
    const cost = Math.round((BOATS[r.type].hp - r.hp) * 12);
    if (cost <= 0) return { ok: true, msg: 'Casco já está perfeito.' };
    const res = this.game.economy.spend(cost, `Reparo: ${r.name}`, { txId: `boatfix_${pid}_${Math.round(r.hp)}` });
    if (!res?.ok) return { ok: false, msg: res?.msg || 'Saldo insuficiente.' };
    r.hp = BOATS[r.type].hp;
    this.game.save?.autosave('Barco reparado');
    return { ok: true, msg: `${r.name} reparado.` };
  }

  /** Coloca um barco do armazém na água (ponto de lançamento livre). */
  launch(pid, at = LAUNCH) {
    const r = this.owned.get(pid);
    if (!r || r.location !== 'storage') return { ok: false, msg: 'Barco não está no armazém.' };
    if (r.hp <= 0) return { ok: false, msg: 'Repare o casco antes de retirar.' };
    for (const b of this.boats.values()) if (Math.hypot(b.phys.x - at.x, b.phys.z - at.z) < b.spec.length / 2 + BOATS[r.type].length / 2 + 2) return { ok: false, msg: 'Ponto de lançamento ocupado. Afaste o outro barco.' };
    if (this._worldBoat(pid)) return { ok: false, msg: 'Este barco já está na água.' };
    r.location = 'world';
    this.spawn(r.type, { id: `owned_${pid}`, x: at.x, z: at.z, heading: at.heading, owner: 'player', record: r, hp: r.hp });
    this.game.save?.autosave('Barco retirado');
    return { ok: true, msg: `${r.name} está na água, ao lado do píer.` };
  }

  store(pid) {
    const r = this.owned.get(pid);
    const b = this._worldBoat(pid);
    if (!r || !b) return { ok: false, msg: 'Barco não encontrado na água.' };
    if (b.driver) return { ok: false, msg: 'Saia do barco primeiro.' };
    const stored = [...this.owned.values()].filter((x) => x.location === 'storage').length;
    if (stored >= STORAGE_CAPACITY) return { ok: false, msg: 'MARINA STORAGE cheia.' };
    r.hp = b.hp;
    r.location = 'storage';
    delete r.x; delete r.z; delete r.heading;
    this._despawn(b);
    this.game.save?.autosave('Barco guardado');
    return { ok: true, msg: `${r.name} guardado.` };
  }

  _worldBoat(pid) {
    for (const b of this.boats.values()) if (b.record?.pid === pid) return b;
    return null;
  }

  // ------------------------------------------------------------ save
  serialize() {
    const owned = [];
    for (const r of this.owned.values()) {
      const out = { pid: r.pid, type: r.type, name: r.name, hp: Math.round(r.hp * 10) / 10, location: r.location };
      const b = this._worldBoat(r.pid);
      if (r.location === 'world' && b) Object.assign(out, { x: +b.phys.x.toFixed(2), z: +b.phys.z.toFixed(2), heading: +b.phys.heading.toFixed(4), hp: Math.round(b.hp * 10) / 10 });
      else if (r.location === 'world') out.location = 'storage';
      owned.push(out);
    }
    return { owned, aboard: this.aboard?.record?.pid || null };
  }

  /** Restaura sem duplicar: remove os barcos do jogador da água e recria a partir do save. */
  deserialize(data, warnings = []) {
    if (this.aboard) this.forceExit();
    for (const b of [...this.boats.values()]) if (b.record) this._despawn(b);
    this.owned.clear();
    if (!data || !Array.isArray(data.owned)) return;
    for (const o of data.owned) {
      if (!BOATS[o.type] || BOATS[o.type].police) { warnings.push(`barco desconhecido ignorado: ${o.type}`); continue; }
      if (this.owned.has(o.pid)) { warnings.push(`barco duplicado ignorado: ${o.pid}`); continue; }
      const r = boatRecord(o.type, o.pid, { name: o.name || BOATS[o.type].name, hp: Math.max(0, Math.min(BOATS[o.type].hp, +o.hp || 0)), location: 'storage' });
      this.owned.set(r.pid, r);
      if (o.location === 'world' && this.ready && this._waterFree(o.x, o.z, BOATS[o.type])) {
        r.location = 'world';
        this.spawn(o.type, { id: `owned_${r.pid}`, x: o.x, z: o.z, heading: o.heading || 0, owner: 'player', record: r, hp: r.hp });
      } else if (o.location === 'world') warnings.push(`${r.name}: posição salva indisponível, devolvido à MARINA STORAGE.`);
    }
  }

  _waterFree(x, z, spec) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (this.water.surface.depth(x, z) < spec.draft + 0.2) return false;
    const list = this.collision.queryCircle(x, z, spec.length / 2, this._tmp || (this._tmp = []));
    return !list.some((c) => c.solid && !c.tags?.includes('boat') && c.minY < 1 && c.maxY > -0.5 && c.maxY < 150);
  }

  newGame() {
    if (this.aboard) this.forceExit();
    for (const b of [...this.boats.values()]) if (b.record) this._despawn(b);
    this.owned.clear();
  }

  markers() {
    if (!this.active) return [];
    const out = [{ x: MARINAS.sunset.office.x, z: MARINAS.sunset.office.z, kind: 'marina', label: 'SUNSET MARINA' }, { x: MARINAS.azure.warehouse.x, z: MARINAS.azure.warehouse.z, kind: 'marina', label: 'AZURE DOCKS' }];
    for (const b of this.boats.values()) if (b.record && b !== this.aboard) out.push({ x: b.phys.x, z: b.phys.z, kind: 'boat', label: b.name });
    return out;
  }
}
