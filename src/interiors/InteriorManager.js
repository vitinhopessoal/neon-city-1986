import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { InteriorBuilder, shell, doorLeaf, mat } from './InteriorKit.js';
import { INTERIORS, TEST_INTERIOR } from './InteriorDefinitions.js';
import { InteriorNPCs } from './InteriorNPCs.js';
import { InteriorAudio } from './InteriorAudio.js';
import { InteriorUI } from './InteriorUI.js';
import { InteriorPersistence } from './InteriorPersistence.js';
import { neonTextTexture, createSignMesh } from '../world/NeonSign.js';
import { formatClock } from '../player/PlayerStatus.js';

/**
 * Interiores exploráveis.
 *
 * Os prédios externos são geometria fundida em lotes estáticos com colisor
 * sólido; abrir fisicamente as fachadas exigiria refazer esse sistema. Cada
 * estabelecimento é então um volume interno ALINHADO ao prédio (mesmo X/Z,
 * mesma orientação, dimensões limitadas pela planta e porta exatamente atrás
 * da porta da fachada) construído num nível separado (Y = INTERIOR_ALT). A
 * porta abre, a tela escurece por ~0,3 s e o jogador aparece do lado de
 * dentro — sem tela de carregamento. As vitrines internas têm persianas
 * iluminadas: não mostram uma rua diferente da real.
 *
 * Responsabilidades: registro, portas e letreiros externos, prioridade da
 * tecla E (portas de carro × portas de prédio), transições, colisões,
 * iluminação, NPCs, áudio, sentar, diálogos, comércio, horários,
 * persistência e carregamento seletivo.
 */
export const INTERIOR_ALT = 300;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

let POOL_TEX = null;
function poolTexture() {
  if (POOL_TEX) return POOL_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  POOL_TEX = new THREE.CanvasTexture(c);
  return POOL_TEX;
}

export class InteriorManager {
  constructor(game) {
    this.game = game;
    this.cfg = CONFIG.interiors;
    const q = new URLSearchParams(location.search).get('interiors');
    this.ignoreHours = q === 'open' || this.cfg.ignoreHours;
    this.ui = new InteriorUI(game.uiRoot || document.body);
    this.ui.onClose = () => { this.dialogNpc = null; this.dialogWorld = null; };
    this.audio = new InteriorAudio(game.audio);
    this.npcs = new InteriorNPCs(game.scene, 18);
    this.save = new InteriorPersistence();
    this.exteriors = [];
    this.loaded = new Map();
    this.active = null;
    this.state = 'outside';
    this.seated = null;
    this.basket = [];
    this.candidate = null;
    this.t = 0;
    this.stats = { builds: 0, disposed: 0, enters: 0, exits: 0, purchases: 0, denied: 0, sits: 0, dialogs: 0, buildMs: 0 };
    this.fade = document.createElement('div');
    this.fade.className = 'int-fade';
    (game.uiRoot || document.body).appendChild(this.fade);
    this.lights = [new THREE.PointLight(0xffffff, 0, 14, 1.6), new THREE.PointLight(0xffffff, 0, 14, 1.6)];
    this.lastPlayerVehicle = null;
    /** Definições adicionais (ex.: residências do PROMPT 07) — mesmo sistema de portas. */
    this.extraDefs = [];
    /** Provedores de interações externas (ex.: garagens): () => [{ dist, label, run, anchor }]. */
    this.outsideProviders = [];
    this.onEntered = null;
    this.onExited = null;
    game.city?.events.on('gunshot', (e) => { if (this.active) this.npcs.react('gunshot'); });
  }

  // ------------------------------------------------------ mapa e fachadas
  onMapActivated(env) {
    if (this.active) this._forceOutside();
    for (const i of [...this.loaded.values()]) this._dispose(i);
    for (const e of this.exteriors) {
      e.group.removeFromParent();
      e.extra?.removeFromParent();
      if (e.colId) this.env?.collision?.remove(e.colId);
    }
    this.exteriors = [];
    this.env = env;
    const mapId = env.isImported ? env.id : 'sunset-beach';
    const defs = [...(env.isImported ? (env.id === 'test-city' ? [TEST_INTERIOR] : []) : INTERIORS), ...this.extraDefs.filter((d) => (d.maps || ['sunset-beach']).includes(mapId))];
    for (const def of defs) {
      const placed = env.isImported ? this._placeTestBuilding(env, def) : this._placeOnBuilding(env, def);
      if (placed) this.exteriors.push(placed);
    }
    // Mundo unificado: a sala de teste acompanha o TEST CITY no bairro oeste (mesmos pontos, deslocados).
    const tc = !env.isImported && env.testCity?.ready ? env.testCity : null;
    if (tc) {
      const o = tc.link.offset;
      const def = { ...TEST_INTERIOR, testSpots: TEST_INTERIOR.testSpots.map((s) => ({ ...s, x: s.x + o.x, z: s.z + o.z })) };
      const placed = this._placeTestBuilding(env, def);
      if (placed) this.exteriors.push(placed);
    }
  }

  /** Associa a definição a um prédio existente (planta, porta e orientação reais). */
  _placeOnBuilding(world, def) {
    const spec = world.districts.flatMap((d) => d.buildings).find((b) => b.id === def.buildingId);
    const poi = world.pois.find((p) => p.id === `${def.buildingId}_entrance`);
    if (!spec || !poi) { console.warn(`[Interiores] prédio ${def.buildingId} não encontrado`); return null; }
    return this._exterior(def, { x: spec.x, z: spec.z, rotY: spec.rotY || 0, w: spec.w || def.size.w + 1, d: spec.d || def.size.d + 1 }, poi);
  }

  /** TEST CITY: prédio de teste próprio (o GLB importado não é alterado). */
  _placeTestBuilding(env, def) {
    const col = env.collision;
    const spot = def.testSpots.find((s) => col.queryCircle(s.x, s.z, 6).every((c) => !c.solid || c.maxY - c.minY < 0.4));
    if (!spot) return null;
    const { w, d } = def.building;
    const y = col.getGroundHeight(spot.x, spot.z, 2, 0.5);
    const g = new THREE.Group();
    g.position.set(spot.x, y, spot.z);
    g.rotation.y = spot.rotY;
    const wall = mat(0xe9d7c3, 0.75), trim = mat(0x45c8b8, 0.5);
    const box = (m, x, yy, z, ww, hh, dd) => { const me = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, dd), m); me.position.set(x, yy + hh / 2, z); me.castShadow = true; me.receiveShadow = true; g.add(me); };
    box(wall, 0, 0, 0, w, 4.2, d);
    box(trim, 0, 4.2, 0, w + 0.3, 0.3, d + 0.3);
    box(trim, 0, 0, d / 2 + 0.02, w, 0.25, 0.08);
    this.game.scene.add(g);
    const s = Math.sin(spot.rotY), c = Math.cos(spot.rotY);
    const colId = col.addBox({ id: 'test_interior_building', cx: spot.x, cz: spot.z, hx: w / 2, hz: d / 2, rotation: spot.rotY, minY: y, maxY: y + 4.5, cameraBlocker: true, walkable: false }).id;
    const poi = { x: spot.x + s * (d / 2), y, z: spot.z + c * (d / 2) };
    const ext = this._exterior(def, { x: spot.x, z: spot.z, rotY: spot.rotY, w, d, y }, poi);
    ext.extra = g;
    ext.colId = colId;
    return ext;
  }

  _exterior(def, bld, poi) {
    const s = Math.sin(bld.rotY), c = Math.cos(bld.rotY);
    // Casas: a POI fica no caminho do jardim; a porta real está doorInset metros atrás.
    if (def.doorInset) poi = { x: poi.x - s * def.doorInset, y: poi.y, z: poi.z - c * def.doorInset };
    // Posição da porta no espaço local do prédio.
    const dx = poi.x - bld.x, dz = poi.z - bld.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const W = Math.min(def.size.w, bld.w - 0.8), D = Math.min(def.size.d, bld.d - 0.8);
    const doorX = THREE.MathUtils.clamp(lx, -W / 2 + 1.2, W / 2 - 1.2);
    const n = { x: s, z: c };
    // Porta física na fachada (abre ao entrar/sair).
    const group = new THREE.Group();
    group.position.set(poi.x + n.x * 0.08, poi.y ?? 0.15, poi.z + n.z * 0.08);
    group.rotation.y = bld.rotY;
    const dw = def.doorWidth || 1.2;
    const pivot = new THREE.Group();
    pivot.position.x = -dw / 2;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(dw, 2.35, 0.07), mat(def.doorColor ?? 0x2b2e35, 0.35, 0.6));
    leaf.position.set(dw / 2, 1.175, 0);
    leaf.castShadow = true;
    pivot.add(leaf);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(dw - 0.22, 1.7), mat(0x2a3a4a, 0.08, 0.4, { emissive: def.light.windowColor ?? 0xffc98a, emissiveIntensity: 0.35 }));
    glass.position.set(dw / 2, 1.3, 0.04);
    pivot.add(glass);
    group.add(pivot);
    // Letreiro com o nome fictício acima da porta (residências podem dispensá-lo).
    if (def.sign === false) { this.game.scene.add(group); return { def, bld, poi: { x: poi.x, y: poi.y ?? 0.15, z: poi.z }, normal: n, doorX, W, D, group, pivot, open: 0, openTarget: 0 }; }
    const tex = neonTextTexture(def.sign?.text || def.name, { color: def.sign?.color || '#ff4fd8', style: def.sign?.style || 'block', sub: def.sign?.sub || null });
    const signMesh = createSignMesh(tex, def.sign?.w || 3.4, def.sign?.h || 0.85, { intensity: 1.6, backing: 0x1a1424, backingDepth: 0.12 });
    // Logo acima da porta (2,35 m); def.sign.y permite ajustar quando o prédio já tem letreiro próprio.
    signMesh.group.position.set(0, def.sign?.y ?? 2.35 + (def.sign?.h || 0.85) / 2 + 0.1, 0.12);
    group.add(signMesh.group);
    this.game.scene.add(group);
    return {
      def, bld, poi: { x: poi.x, y: poi.y ?? 0.15, z: poi.z }, normal: n, doorX, W, D, group, pivot, open: 0, openTarget: 0,
      sign: signMesh, signTex: tex,
    };
  }

  // ----------------------------------------------------- construção
  _ensureBuilt(ext) {
    if (this.loaded.has(ext.def.id)) return this.loaded.get(ext.def.id);
    const t0 = performance.now();
    const def = ext.def;
    const W = ext.W, D = ext.D, H = def.size.h;
    const b = new InteriorBuilder();
    const P = def.palette;
    const shellSpec = {
      w: W, d: D, h: H, floor: P.floor, wall: P.wall, ceiling: P.ceiling, trim: P.trim,
      doorX: ext.doorX, doorW: (def.doorWidth || 1.2) + 0.2,
      windows: (def.windows || []).map((o) => ({ x: o.x * W, w: o.w })).filter((o) => Math.abs(o.x - ext.doorX) > o.w / 2 + 1.0 && Math.abs(o.x) + o.w / 2 < W / 2 - 0.3),
      windowGlow: mat(0x222a33, 0.6, 0, { emissive: def.light.windowColor ?? 0xffd8a8, emissiveIntensity: 0.55 }),
      blinds: mat(0xe9e2d4, 0.6),
    };
    shell(b, shellSpec);
    const ctx = { w: W, d: D, h: H, doorX: ext.doorX, factory: this.game.world?.vehicleFactory, extras: [], updaters: [], doors: [] };
    def.layout(b, ctx);
    const doorPivot = doorLeaf(b, ext.doorX, D, def.doorWidth || 1.2, def.doorColor ?? 0x2b2e35);
    const built = b.build();
    const root = new THREE.Group();
    root.name = `interior_${def.id}`;
    root.add(built.group);
    for (const e of ctx.extras) root.add(e);
    // Círculos de luz no piso (falsos, aditivos).
    const poolMats = new Map();
    for (const p of b.lightPools) {
      let pm = poolMats.get(p.color);
      if (!pm) { pm = new THREE.MeshBasicMaterial({ map: poolTexture(), color: p.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: def.light.poolStrength ?? 0.5 }); poolMats.set(p.color, pm); }
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.radius * 2, p.radius * 2), pm);
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, 0.012, p.z);
      m.renderOrder = 1;
      root.add(m);
    }
    // Posição no mundo: alinhada ao prédio, fachada interna atrás da porta real.
    const bld = ext.bld;
    const s = Math.sin(bld.rotY), c = Math.cos(bld.rotY);
    const dx = ext.poi.x - bld.x, dz = ext.poi.z - bld.z;
    const lzFacade = dx * s + dz * c;
    const zc = lzFacade - 0.3 - D / 2;
    root.position.set(bld.x + s * zc, INTERIOR_ALT, bld.z + c * zc);
    root.rotation.y = bld.rotY;
    root.visible = false;
    this.game.scene.add(root);
    root.updateMatrixWorld(true);
    const L = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(root.matrixWorld);
    // Colisores no mundo.
    const col = this.env.collision;
    const colIds = [];
    b.colliders.forEach((k, i) => {
      const p = L(k.x, 0, k.z);
      const added = col.addBox({ id: `int_${def.id}_${i}`, cx: p.x, cz: p.z, hx: k.w / 2, hz: k.d / 2, rotation: bld.rotY + (k.ry || 0), minY: INTERIOR_ALT + k.y0, maxY: INTERIOR_ALT + k.y1, walkable: k.walkable, cameraBlocker: k.cameraBlocker, solid: true });
      colIds.push(added.id);
      k.id = added.id;
      k.world = added;
    });
    const interior = {
      def, ext, root, W, D, H, colIds, colliders: b.colliders, seats: b.seats, interactables: b.interactables,
      doorPivot, doorOpen: 0, triangles: built.triangles, ctx, poolMats, L,
      spawn: { local: new THREE.Vector3(ext.doorX, 0, D / 2 - 1.1) },
      pickups: [],
    };
    for (const d of ctx.doors) d.interior = interior;
    this.loaded.set(def.id, interior);
    this.stats.builds++;
    this.stats.buildMs = Math.round(performance.now() - t0);
    return interior;
  }

  _dispose(interior) {
    const col = this.env?.collision;
    for (const id of interior.colIds) col?.remove(id);
    // Recursos externos (carros decorativos da fábrica) liberados antes: a fábrica sabe o que é compartilhado.
    for (const fn of interior.ctx.disposers || []) fn();
    interior.ctx.disposers = [];
    interior.root.removeFromParent();
    interior.root.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        o.geometry?.dispose();
        const ms = [].concat(o.material);
        for (const m of ms) if (m && !m.userData.shared && !m.userData?.keep) { m.map?.dispose?.(); m.dispose(); }
      }
    });
    for (const fn of interior.ctx.disposers || []) fn();
    this.loaded.delete(interior.def.id);
    this.stats.disposed++;
  }

  // ----------------------------------------------------------- ciclo
  /** Antes dos veículos: prioridade da tecla E, interações e transições. */
  preUpdate(dt, input) {
    const g = this.game;
    this.t += dt;
    if (g.vehicles.playerVehicle) this.lastPlayerVehicle = g.vehicles.playerVehicle;
    const vi = g.vehicles.interaction;
    vi.suppressed = false;
    if (g.state !== 'playing' || g.mapLoading) return;
    const pressed = input.wasPressed('interact');
    // Transições em andamento.
    if (this.state === 'entering' || this.state === 'exiting' || this.state === 'moving') { vi.suppressed = true; this._transition(dt); return; }
    if (this.ui.open) {
      vi.suppressed = true;
      if (this.dialogAnchor && this._distTo(this.dialogAnchor) > 3.5) this.ui.close();
      return;
    }
    if (this.seated) {
      vi.suppressed = true;
      g.hud.setPrompt('<kbd>E</kbd> LEVANTAR');
      if (pressed) this._stand();
      return;
    }
    if (this.state === 'outside') {
      if (!vi.onFoot || g.boats?.aboard) return;
      this.candidate = this._nearestExterior();
      // Outras interações externas (garagens etc.): vence a mais próxima.
      let other = null;
      for (const prov of this.outsideProviders) for (const c of prov() || []) if (!other || c.dist < other.dist) other = c;
      const vc = vi.candidate;
      const best = [this.candidate, other].filter(Boolean).sort((a, b) => a.dist - b.dist)[0];
      if (best && (!vc || best.dist < vc.dist)) {
        vi.suppressed = true;
        if (best === other) {
          g.hud.setPrompt(other.label);
          if (pressed) { const page = other.run(); if (page) this.openOutsidePage(page, other.anchor); }
        } else {
          const ext = this.candidate.ext;
          // Portão (imóvel à venda): mostra a ficha em vez de entrar.
          const gate = ext.def.gate?.(this, ext);
          if (gate) {
            g.hud.setPrompt(gate.prompt);
            if (pressed) { const page = gate.page(); if (page) this.openOutsidePage(page, ext.poi); }
          } else {
            const open = this._isOpen(ext.def);
            g.hud.setPrompt(open ? `PRESSIONE <kbd>E</kbd> PARA ENTRAR · ${ext.def.name}` : `${ext.def.name} · FECHADO (abre às ${this._opensAt(ext.def)})`);
            if (pressed) { if (open) this._beginEnter(ext); else this.audio.sfx('deny'); }
          }
        }
      }
    } else if (this.state === 'inside') {
      vi.suppressed = true;
      this.candidate = this._nearestInteractable();
      g.hud.setPrompt(this.candidate ? (this.candidate.prompt || `<kbd>E</kbd> ${this.candidate.label}`) : null);
      if (pressed && this.candidate) this._run(this.candidate);
    }
  }

  /** Depois da câmera: animações, iluminação, NPCs, áudio, carregamento. */
  update(dt) {
    const g = this.game;
    // Portas externas animadas.
    for (const e of this.exteriors) {
      e.open += (e.openTarget - e.open) * Math.min(1, dt * 9);
      e.pivot.rotation.y = -1.25 * e.open;
    }
    const A = this.active;
    if (A) {
      A.doorOpen += ((this.state === 'entering' || this.state === 'exiting' ? 1 : 0) - A.doorOpen) * Math.min(1, dt * 7);
      A.doorPivot.rotation.y = 1.25 * A.doorOpen;
      // Pedestres/polícia reativam a própria visibilidade a cada quadro: mantém ocultos (não são vistos de dentro).
      if (this.state === 'inside' || this.state === 'moving') for (const grp of this._outdoorGroups()) grp.visible = false;
      for (const fn of A.ctx.updaters) fn(dt, this.t, this);
      for (const d of A.ctx.doors) this._animateDoor(d, dt);
      this._applyLighting(A);
      this.npcs.update(dt, g.player.visualPosition);
    }
    // Carregamento seletivo: prepara o interior quando o jogador se aproxima,
    // libera os distantes (mantém o ativo).
    this._loadT = (this._loadT || 0) - dt;
    if (this._loadT <= 0) {
      this._loadT = 0.5;
      const p = g.player.visualPosition;
      let built = false;
      for (const e of this.exteriors) {
        const d = Math.hypot(e.poi.x - p.x, e.poi.z - p.z);
        const inst = this.loaded.get(e.def.id);
        if (!inst && d < this.cfg.preloadDistance && !built && this.state === 'outside') { this._ensureBuilt(e); built = true; }
        else if (inst && inst !== A && d > this.cfg.unloadDistance) this._dispose(inst);
      }
    }
    // Áudio: interior ativo ou estabelecimento próximo (abafado).
    let target = null, dist = 1e9;
    if (A) target = A.def.audio;
    else {
      const p = g.player.visualPosition;
      for (const e of this.exteriors) {
        if (!this._isOpen(e.def)) continue;
        const d = Math.hypot(e.poi.x - p.x, e.poi.z - p.z);
        if (d < dist) { dist = d; target = e.def.audio; }
      }
    }
    const inside = !!A && this.state !== 'exiting';
    this.audio.update(dt, target, inside, Math.max(0, dist - (this.exteriors.find((e) => e.def.audio === target)?.open > 0.3 ? 8 : 0)));
  }

  // ------------------------------------------------------- horários
  _isOpen(def) {
    if (this.ignoreHours || !def.hours) return true;
    const m = this.game.player.status.minutes;
    const [a, b] = def.hours.map((h) => h * 60);
    return a <= b ? m >= a && m < b : m >= a || m < b;
  }

  _opensAt(def) {
    return formatClock(def.hours[0] * 60);
  }

  // --------------------------------------------------- busca de alvos
  _distTo(local) {
    const A = this.active;
    if (this.dialogWorld) {
      const p = this.game.player.visualPosition;
      return Math.hypot(this.dialogWorld.x - p.x, this.dialogWorld.z - p.z);
    }
    if (!A) return 1e9;
    _v.copy(local).applyMatrix4(A.root.matrixWorld);
    const p = this.game.player.visualPosition;
    return Math.hypot(_v.x - p.x, _v.z - p.z) + Math.abs(_v.y - p.y) * 0.5;
  }

  _nearestExterior() {
    const p = this.game.player.visualPosition;
    const yaw = this.game.player.controller.yaw;
    let best = null;
    for (const e of this.exteriors) {
      const dx = e.poi.x - p.x, dz = e.poi.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.9 || Math.abs(e.poi.y - p.y) > 1.2) continue;
      // De frente para a porta (não aciona de costas).
      if (d > 0.5 && (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d < -0.1) continue;
      if (!best || d < best.dist) best = { ext: e, dist: d };
    }
    return best;
  }

  _nearestInteractable() {
    const A = this.active;
    const p = this.game.player.visualPosition;
    const yaw = this.game.player.controller.yaw;
    let best = null;
    const consider = (it, local, label, radius) => {
      _v.copy(local).applyMatrix4(A.root.matrixWorld);
      const dx = _v.x - p.x, dz = _v.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > radius || Math.abs(_v.y - (p.y + 0.9)) > 1.8) return;
      const facing = d < 0.4 ? 1 : (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;
      if (facing < -0.2) return;
      const score = d - facing * 0.4;
      if (!best || score < best.score) best = { ...it, label, score, dist: d, worldPos: _v.clone() };
    };
    consider({ kind: 'exit' }, _w.set(A.ext.doorX, 1.1, A.D / 2 - 0.4), `SAIR · ${A.def.name}`, 1.6);
    for (const it of A.interactables) {
      if (it.hidden) continue;
      consider(it, _w.set(it.x, it.y ?? 1.0, it.z), it.label, it.radius ?? 1.4);
    }
    for (const pk of A.pickups) consider(pk, _w.set(pk.x, pk.y, pk.z), pk.label, 1.3);
    for (const d of A.ctx.doors) consider({ kind: 'door', door: d }, _w.set(d.x, (d.y || 0) + 1.1, d.z), d.locked ? `${d.label} · ${d.lockedText || 'TRANCADA'}` : (d.open ? `FECHAR ${d.label}` : `ABRIR ${d.label}`), 1.4);
    if (!best || best.dist > 0.9) {
      for (const s of A.seats) {
        if (s.used) continue;
        consider({ kind: 'seat', seat: s }, _w.set(s.x, s.y, s.z), 'SENTAR', 1.1);
      }
    }
    return best;
  }

  // ----------------------------------------------------- transições
  _beginEnter(ext) {
    const g = this.game;
    this.state = 'entering';
    this.trans = { t: 0, ext, done: false };
    ext.openTarget = 1;
    this.audio.sfx('door');
    if (ext.def.bell) this.audio.sfx('bell');
    // Congela o controle a pé durante a passagem (sem física).
    g.player.setExternalPose(g.player.visualPosition.clone(), g.player.controller.yaw, 0, 0);
    this.stats.enters++;
  }

  _beginExit() {
    const g = this.game;
    this.state = 'exiting';
    this.trans = { t: 0, ext: this.active.ext, done: false };
    this.audio.sfx('door');
    g.player.setExternalPose(g.player.visualPosition.clone(), g.player.controller.yaw, 0, 0);
    this.stats.exits++;
  }

  _transition(dt) {
    const T = this.trans;
    const g = this.game;
    T.t += dt;
    if (T.t > 0.28 && !T.fadeOn) { T.fadeOn = true; this.fade.classList.add('on'); }
    if (T.t > 0.52 && !T.done) {
      T.done = true;
      if (this.state === 'moving') {
        const A = this.active, f = T.floor;
        this._place(A.L(f.x, f.y, f.z), (f.yaw || 0) + A.ext.bld.rotY);
      } else if (this.state === 'entering') {
        const inst = this._ensureBuilt(T.ext);
        this._activate(inst);
        const p = _v.copy(inst.spawn.local).applyMatrix4(inst.root.matrixWorld);
        const yaw = inst.ext.bld.rotY + Math.PI;
        this._place(p, yaw);
        T.ext.openTarget = 0;
        this.save.visit(inst.def.id);
      } else {
        const ext = T.ext;
        this._deactivate();
        const p = new THREE.Vector3(ext.poi.x + ext.normal.x * 1.35, ext.poi.y, ext.poi.z + ext.normal.z * 1.35);
        ext.open = 1;
        ext.openTarget = 0;
        this._place(p, ext.bld.rotY);
      }
    }
    if (T.t > 0.7 && T.fadeOn && !T.fadeOff) { T.fadeOff = true; this.fade.classList.remove('on'); }
    if (T.t > 0.95) {
      const p = g.player.external?.position.clone() || g.player.visualPosition.clone();
      const yaw = g.player.external?.yaw ?? g.player.controller.yaw;
      g.player.releaseExternalPose(p, yaw);
      const was = this.state;
      this.state = this.active ? 'inside' : 'outside';
      this.trans = null;
      if (was === 'entering') this.onEntered?.(this.active.def);
      else if (was === 'exiting') this.onExited?.(T.ext.def);
    }
  }

  /** Reposiciona jogador e câmera (sempre sobre piso válido). */
  _place(p, yaw) {
    const g = this.game;
    const col = this.env.collision;
    p.y = col.getGroundHeight(p.x, p.z, p.y + 0.6, 0.6);
    g.player.setExternalPose(p, yaw, 0, 0);
    g.player.controller.teleport(p.x, p.y, p.z, yaw);
    g.player.visualPosition.copy(p);
    g.cameras.yaw = yaw + Math.PI;
    g.cameras.third?.reset?.(g.player);
  }

  /** Coloca o jogador dentro do interior sem animação de porta (novo jogo / carregar partida). */
  enterImmediately(id) {
    const ext = this.exteriors.find((e) => e.def.id === id);
    if (!ext) return false;
    if (this.active) this._forceOutside();
    const inst = this._ensureBuilt(ext);
    this._activate(inst);
    const p = _v.copy(inst.spawn.local).applyMatrix4(inst.root.matrixWorld).clone();
    this._place(p, inst.ext.bld.rotY + Math.PI);
    this.game.player.releaseExternalPose(this.game.player.controller.position.clone(), inst.ext.bld.rotY + Math.PI);
    this.state = 'inside';
    this.trans = null;
    this.fade.classList.remove('on');
    this.save.visit(id);
    return true;
  }

  _forceOutside() {
    if (this.seated) this._stand();
    const ext = this.active.ext;
    this._deactivate();
    this.state = 'outside';
    this.fade.classList.remove('on');
    const p = new THREE.Vector3(ext.poi.x + ext.normal.x * 1.35, ext.poi.y, ext.poi.z + ext.normal.z * 1.35);
    this.game.player.releaseExternalPose(p, ext.bld.rotY);
  }

  // ------------------------------------------- ativar / desativar
  _activate(inst) {
    const g = this.game;
    this.active = inst;
    inst.root.visible = true;
    // O exterior não é visível de dentro: deixa de ser desenhado (desempenho).
    this._saved = {
      sunI: g.world.environment.sun.intensity, sunShadow: g.world.environment.sun.castShadow,
      exposure: g.renderer.toneMappingExposure, fogNear: g.scene.fog?.near, fogFar: g.scene.fog?.far,
    };
    g.world.setVisible?.(false);
    for (const grp of this._outdoorGroups()) grp.visible = false;
    g.world.environment.sun.castShadow = false;
    const L = inst.def.light;
    (L.points || []).slice(0, 2).forEach((pt, i) => {
      const light = this.lights[i];
      light.color.set(pt.color);
      light.intensity = pt.intensity;
      light.distance = pt.distance || 14;
      light.position.copy(_v.set(pt.x * inst.W, pt.y, pt.z * inst.D).applyMatrix4(inst.root.matrixWorld));
      g.scene.add(light);
    });
    this.npcs.bpm = inst.def.bpm || 120;
    this.npcs.spawn(inst, typeof inst.def.npcs === 'function' ? inst.def.npcs(inst) : inst.def.npcs);
    this.audio.sfx(inst.def.bell ? 'bell' : 'door');
  }

  _deactivate() {
    const g = this.game;
    const inst = this.active;
    if (!inst) return;
    this.ui.close();
    inst.root.visible = false;
    for (const l of this.lights) { l.intensity = 0; l.removeFromParent(); }
    g.world.setVisible?.(true);
    for (const grp of this._outdoorGroups()) grp.visible = true;
    const env = g.world.environment;
    env.sun.intensity = env.preset?.sunIntensity ?? this._saved.sunI;
    env.hemi.color.set(env.preset.hemiSky);
    env.hemi.groundColor.set(env.preset.hemiGround);
    env.hemi.intensity = env.preset.hemiIntensity;
    g.scene.environmentIntensity = env.preset?.envIntensity ?? 0.4;
    env.sun.castShadow = this._saved.sunShadow;
    g.renderer.toneMappingExposure = env.preset?.exposure ?? this._saved.exposure;
    this.npcs.clear();
    this.basket = [];
    this.active = null;
  }

  _outdoorGroups() {
    const g = this.game;
    const pol = g.city?.police?.renderer;
    return [g.city?.traffic?.group, g.city?.peds?.renderer?.group, pol?.body?.group, pol?.accessories, ...this.exteriors.map((e) => e.group), ...this.exteriors.map((e) => e.extra).filter(Boolean)].filter(Boolean);
  }

  _applyLighting(inst) {
    const env = this.game.world.environment;
    const L = inst.def.light;
    env.sun.intensity = 0;
    // O mapa de ambiente é o céu externo (pôr do sol etc.): quase desligado dentro.
    this.game.scene.environmentIntensity = (L.env ?? 0.1) * (inst.lightsOff ? 0.3 : 1);
    env.hemi.color.set(L.sky);
    env.hemi.groundColor.set(L.ground);
    env.hemi.intensity = L.hemi * (inst.lightsOff ? 0.3 : 1);
    this.game.renderer.toneMappingExposure = L.exposure ?? 1.0;
    (L.points || []).slice(0, 2).forEach((pt, i) => { if (!inst.ctx.lightDriver) this.lights[i].intensity = inst.lightsOff ? 0 : pt.intensity; });
  }

  // ------------------------------------------------------ interações
  _run(it) {
    const A = this.active;
    switch (it.kind) {
      case 'exit': this._beginExit(); return;
      case 'seat': this._sit(it.seat); return;
      case 'door': this._toggleDoor(it.door); return;
      case 'pickup': this._eat(it); return;
      default: break;
    }
    if (it.action) {
      const page = it.action(this.api(A, it));
      if (page) this._openPage(page, it);
    }
  }

  /** Painel aberto do lado de fora (ficha de imóvel, garagem). anchor em coordenadas do mundo. */
  openOutsidePage(page, anchor) {
    this.dialogWorld = { x: anchor.x, z: anchor.z };
    this.dialogAnchor = new THREE.Vector3();
    this.stats.dialogs++;
    this.ui.show({ place: '', ...page }, () => this.game.player.status.money);
  }

  _openPage(page, it) {
    const A = this.active;
    this.dialogWorld = null;
    this.dialogAnchor = new THREE.Vector3(it.x, it.y ?? 1, it.z);
    this.stats.dialogs++;
    this.ui.show({ place: A.def.name, ...page }, () => this.game.player.status.money);
  }

  /** API passada às definições (diálogos, comércio, serviços). */
  api(A, it) {
    const g = this.game;
    const self = this;
    return {
      def: A.def, interior: A, item: it, status: g.player.status, save: this.save, sfx: (k) => this.audio.sfx(k),
      buy(item) { return self._buy(A, item); },
      basket: this.basket,
      jukebox(track) { A.def.audio = { ...A.def.audio, track }; return TRACK_LABEL(track); },
      vehicleNear() { return self._serviceVehicle(A); },
      toast: (t) => g.hud.toast(t),
      npc: (role) => this.npcs.byRole(role),
      setDoorLocked: (id, v) => { const d = A.ctx.doors.find((x) => x.id === id); if (d) d.locked = v; },
      elevator: (floor) => self._elevator(A, floor),
      toggleLights: () => { A.lightsOff = !A.lightsOff; return A.lightsOff; },
    };
  }

  /** Compra: saldo suficiente, sem duplicar, com retorno visual e sonoro. */
  _buy(A, item) {
    const st = this.game.player.status;
    if (item.unique && this.save.owns(item.id)) return { ok: false, msg: 'Você já tem este item.' };
    // Toda cobrança passa pela economia central (validação, histórico, sem saldo negativo).
    const r = this.game.economy ? this.game.economy.spend(item.price, `${A.def.name}: ${item.label}`) : (st.spendMoney(item.price) ? { ok: true } : { ok: false, msg: `Saldo insuficiente: custa $${item.price}, você tem $${st.money}.` });
    if (!r.ok) {
      this.audio.sfx('deny');
      this.stats.denied++;
      return { ok: false, msg: r.msg };
    }
    this.audio.sfx('register');
    this.stats.purchases++;
    this.save.recordPurchase(A.def.id, item.id, item.price, !!item.durable);
    const e = item.effect || {};
    if (e.heal) st.setHealth(st.health + e.heal);
    if (e.pickup) this._spawnPickup(A, item);
    return { ok: true, msg: item.done || `Comprado: ${item.label} por $${item.price}.` };
  }

  _spawnPickup(A, item) {
    const spot = A.ctx.pickupSpot || { x: A.ext.doorX, y: 1.1, z: 0 };
    const mesh = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 16), mat(0xe2a13a, 0.6));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.012, 16), mat(0xc8352a, 0.6));
    top.position.y = 0.02;
    mesh.add(base, top);
    mesh.position.set(spot.x, spot.y, spot.z);
    A.root.add(mesh);
    A.pickups.push({ kind: 'pickup', x: spot.x, y: spot.y, z: spot.z, mesh, label: `COMER ${item.label.toUpperCase()}`, heal: item.effect.pickupHeal || 15, name: item.label });
  }

  _eat(pk) {
    const A = this.active;
    const st = this.game.player.status;
    st.setHealth(st.health + pk.heal);
    pk.mesh.removeFromParent();
    pk.mesh.traverse((o) => o.geometry?.dispose());
    A.pickups.splice(A.pickups.indexOf(pk), 1);
    this.game.hud.toast(`${pk.name}: +${pk.heal} de vida`);
  }

  _serviceVehicle(A) {
    const vm = this.game.vehicles;
    const e = A.ext;
    const bay = { x: e.poi.x + e.normal.x * 5, z: e.poi.z + e.normal.z * 5 };
    let best = null, bd = 18;
    for (const v of vm.list) {
      if (v.driver === 'ai' || !v.damage) continue;
      const d = Math.hypot(v.root.position.x - bay.x, v.root.position.z - bay.z);
      const bonus = v === this.lastPlayerVehicle ? -6 : 0;
      if (d + bonus < bd) { bd = d + bonus; best = v; }
    }
    return best;
  }

  /** Elevador: transição curta para outro andar do mesmo prédio. */
  _elevator(A, floor) {
    const f = A.ctx.floors?.[floor];
    if (!f) return;
    this.audio.sfx('elevator');
    this.state = 'moving';
    this.trans = { t: 0, floor: f, done: false };
    this.game.player.setExternalPose(this.game.player.visualPosition.clone(), this.game.player.controller.yaw, 0, 0);
  }

  // ------------------------------------------------------------ sentar
  _sit(seat) {
    const A = this.active;
    const g = this.game;
    const p = _v.set(seat.x, seat.y + 0.1 - 0.95, seat.z).applyMatrix4(A.root.matrixWorld).clone();
    const yaw = seat.yaw + A.ext.bld.rotY;
    seat.used = 'player';
    const an = g.player.animator;
    an.seatGrip = null;
    an.seatFloor = -(seat.y - (seat.floor || 0) + 0.1);
    an.seatHeadroom = null;
    an.seatHands = 'lap';
    g.player.setExternalPose(p, yaw, 0, 1, seat.kind === 'sofa' ? 0.32 : 0.12, 0, 0);
    this.seated = { seat, eat: false };
    this.stats.sits++;
  }

  _stand() {
    const A = this.active;
    const g = this.game;
    const s = this.seated.seat;
    s.used = null;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const p = _v.set(s.x + fx * 0.65, s.floor || 0, s.z + fz * 0.65).applyMatrix4(A.root.matrixWorld).clone();
    g.player.animator.seatHands = 'wheel';
    g.player.releaseExternalPose(p, s.yaw + A.ext.bld.rotY);
    this.seated = null;
  }

  // ------------------------------------------------------------ portas
  /** Portas internas: estado, pivô, colisão atualizada e bloqueio. */
  _toggleDoor(d) {
    if (d.locked) { this.audio.sfx('deny'); this.game.hud.toast(d.lockedText || 'Trancada'); return; }
    if (d.open) {
      // Não fecha sobre o jogador (nem o empurra para dentro da parede).
      const p = this.game.player.visualPosition;
      const w = d.interior.L(d.x, 0, d.z);
      if (Math.hypot(w.x - p.x, w.z - p.z) < 0.75) { this.game.hud.toast('Saia da passagem para fechar a porta'); return; }
    }
    d.open = !d.open;
    this.audio.sfx('door');
    const c = d.collider?.world;
    if (c) { c.solid = !d.open; c.cameraBlocker = !d.open; }
  }

  _animateDoor(d, dt) {
    d.k += ((d.open ? 1 : 0) - d.k) * Math.min(1, dt * 8);
    if (d.type === 'slide') d.obj.position.x = d.base + d.k * (d.w * 0.95);
    else if (d.type === 'roll') { d.obj.position.y = d.base + d.k * 2.4; d.obj.scale.y = 1 - d.k * 0.9; }
    else d.obj.rotation.y = d.base - d.k * 1.45 * (d.dir || 1);
  }

  // ---------------------------------------------------------- consultas
  summary() {
    return {
      exteriors: this.exteriors.map((e) => e.def.id), loaded: [...this.loaded.keys()], active: this.active?.def.id || null, state: this.state,
      open: this.exteriors.map((e) => [e.def.id, this._isOpen(e.def)]), triangles: this.active?.triangles || 0, ...this.stats, save: this.save.summary(),
    };
  }
}

const TRACK_LABEL = (t) => t;
