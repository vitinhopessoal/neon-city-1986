import * as THREE from 'three';
import { PAINTS, FINISHES, PARTS, UPGRADES, REPAIR_PER_POINT, SECONDARY_PRICE, defaultConfig, partOption, isCompatible, sanitizeConfig } from './CustomizationCatalog.js';
import { applyAppearance, paintHexOf, partSummary } from './VehicleAppearance.js';
import { applyPerformance, statsFor } from './VehiclePerformance.js';
import { CustomizationUI } from './CustomizationUI.js';
import { mat, glow, counter, register, ceilingPanel, rack, plant, chair } from '../../interiors/InteriorKit.js';
import { neonTextTexture, createSignMesh } from '../../world/NeonSign.js';

/**
 * NEON CUSTOMS — seção especializada da SUNSET AUTO WORKS (não duplica o
 * estabelecimento): vaga de entrada pintada na rua em frente à oficina e uma
 * baia de personalização interna (mesma tecnologia dos interiores: transição
 * curta, mundo externo oculto, iluminação própria, mecânico NPC).
 *
 * O MESMO objeto do veículo é levado à baia e devolvido à vaga (sem cópias).
 * Prévia: altera só a aparência e as barras; nada é cobrado ou salvo até
 * "Comprar". Cancelar restaura exatamente o instalado.
 */
const BAY_DEF = {
  id: 'neon_customs_bay', type: 'oficina', name: 'NEON CUSTOMS',
  size: { w: 16, d: 14, h: 5.2 }, hours: null, doorColor: 0x2a2e34,
  palette: { floor: mat(0x2a2a34, 0.4, 0.2), wall: mat(0x1d1a2a, 0.8), ceiling: mat(0x121018, 0.9), trim: mat(0xff4fd8, 0.4) },
  windows: [],
  light: { sky: 0xb8a8ff, ground: 0x2a1840, hemi: 1.05, exposure: 1.05, windowColor: 0xff4fd8, poolStrength: 0.6, env: 0.25, points: [{ x: 0, y: 4.3, z: 0, color: 0xf4f0ff, intensity: 16, distance: 16 }, { x: -0.3, y: 3.6, z: -0.3, color: 0xff4fd8, intensity: 6, distance: 12 }] },
  audio: { track: 'turbo', ambience: 'workshop' },
  layout(b, ctx) {
    const { w: W, d: D, h: H } = ctx;
    // Plataforma giratória estilizada com anel neon, faixas e grade.
    b.cyl(mat(0x3a3a46, 0.3, 0.6), 0, 0, 0, 3.4, 3.4, 0.04, 40);
    b.cyl(glow(0x45f3ff, 2.0), 0, 0.04, 0, 3.45, 3.45, 0.01, 40);
    b.cyl(mat(0x3a3a46, 0.3, 0.6), 0, 0.04, 0, 3.3, 3.3, 0.012, 40);
    for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) b.box(glow(x < 0 ? 0xff4fd8 : 0x45f3ff, 2.2), x, H - 0.6, 0, 0.04, 0.08, D - 1, { r: 0 });
    b.box(glow(0x8a5cff, 2.0), 0, H - 0.06, -D / 2 + 0.06, W - 1, 0.06, 0.04, { r: 0 });
    for (let x = -W / 2 + 2.5; x < W / 2 - 1; x += 3.5) ceilingPanel(b, x, H, 0, 2.6, 0.3, 0xf4f0ff, 2.0);
    // Parede de rodas expostas, bancadas, armários, ferramentas.
    for (let k = 0; k < 5; k++) {
      b.cyl(mat(0x1d1d20, 0.9), -W / 2 + 0.14, 1.6, -4.5 + k * 1.3, 0.34, 0.34, 0.22, 18, { rz: Math.PI / 2 });
      b.cyl(mat([0xd9dde4, 0xd4a83a, 0xf4f6fa, 0x1c1c22, 0xf2f2ee][k], 0.2, 0.9), -W / 2 + 0.26, 1.6, -4.5 + k * 1.3, 0.2, 0.2, 0.04, 14, { rz: Math.PI / 2 });
    }
    b.box(mat(0x2a2e34, 0.4, 0.5), W / 2 - 0.4, 0, -3.5, 0.7, 0.95, 3.6, { r: 0.02, collide: true });
    b.box(mat(0xff4fd8, 0.4, 0.3), W / 2 - 0.4, 0.95, -3.5, 0.75, 0.05, 3.7, { r: 0.01 });
    b.box(mat(0x161620, 0.5), W / 2 - 0.08, 1.2, -3.5, 0.04, 1.3, 3.4, { r: 0 });
    for (let k = 0; k < 10; k++) b.box(mat(0xd0d4da, 0.3, 0.9), W / 2 - 0.12, 1.4 + (k % 2) * 0.45, -4.9 + Math.floor(k / 2) * 0.7, 0.03, 0.3, 0.06, { r: 0 });
    for (let k = 0; k < 5; k++) b.box(mat([0xff4fd8, 0x45f3ff, 0x8a5cff, 0xff4fd8, 0x45f3ff][k], 0.45, 0.4), -W / 2 + 1.0 + k * 0.62, 0, -D / 2 + 0.3, 0.58, 1.9, 0.45, { r: 0.02, collide: true });
    rack(b, -W / 2 + 4.6, -D / 2 + 0.6, 2.0, 0, [0x2a2a30, 0x3a3a40, 0xd4a83a]);
    // Elevador estilizado ao fundo (decorativo) e recepção junto à saída.
    for (const sx of [-1.3, 1.3]) b.box(mat(0xd8283a, 0.4, 0.4), 4.5 + sx, 0, -D / 2 + 1.2, 0.3, 2.8, 0.4, { r: 0.03, collide: true });
    counter(b, -4.5, D / 2 - 2.0, 2.6, 0, { front: mat(0x1d1a2a, 0.4), top: mat(0xff4fd8, 0.3, 0.2), accent: glow(0x45f3ff, 1.6) });
    register(b, -5.0, 1.05, D / 2 - 2.05);
    chair(b, -2.6, D / 2 - 1.0, Math.PI, { seat: mat(0x8a5cff, 0.5) });
    plant(b, W / 2 - 0.6, D / 2 - 0.6, 1.3);
    const tex = neonTextTexture('Neon Customs', { color: '#ff4fd8', style: 'script', sub: 'BODY · PAINT · PERFORMANCE' });
    const sign = createSignMesh(tex, 5.2, 1.3, { intensity: 1.8, backing: 0x120a1c, backingDepth: 0.08 });
    sign.group.position.set(0, H - 1.5, -D / 2 + 0.1);
    ctx.extras.push(sign.group);
    ctx.spots = { mech: [2.4, 2.2] };
  },
  npcs(inst) {
    return [{ role: 'mechanic', name: 'Rico', behavior: 'work', x: 3.4, z: 1.2, yaw: -Math.PI / 2, uniform: { top: 0x8a5cff, sleeve: 0x8a5cff, pants: 0x1d1a2a, thigh: 0x1d1a2a, shin: 0x1d1a2a, shoes: 0x111111, skirt: undefined } }];
  },
};

const CAT_TABS = [
  { id: 'paint', label: 'Pintura' }, { id: 'wheels', label: 'Rodas' }, { id: 'body', label: 'Carroceria' },
  { id: 'suspension', label: 'Suspensão' }, { id: 'lighting', label: 'Iluminação' }, { id: 'interior', label: 'Interior' },
  { id: 'performance', label: 'Performance' }, { id: 'repair', label: 'Reparos' },
];

export class VehicleCustomizationManager {
  constructor(game) {
    this.game = game;
    this.session = null;
    this.sessionSeq = 0;
    this.ui = new CustomizationUI(this, game.uiRoot || document.body);
    this.stats = { sessions: 0, purchases: 0, refused: 0, previews: 0 };
    this.cam = { yaw: 0.8, pitch: 0.22, dist: 6.2, target: new THREE.Vector3(), cur: null, preset: 'orbit' };
  }

  // ------------------------------------------------------------ mapa e entrada
  onMapActivated(env) {
    this.env = env;
    this.entry?.group.removeFromParent();
    this.entry = null;
    if (env.isImported) return;
    const ws = this.game.interiors?.exteriors.find((e) => e.def.id === 'sunset_auto');
    if (!ws) return;
    // Vaga de rua mais próxima da oficina, reservada (o trânsito não estaciona nela).
    let best = null, bd = Infinity;
    for (const s of env.parkingSpots || []) {
      if (s.reservedBy) continue;
      const d = Math.hypot(s.x - ws.poi.x, s.z - ws.poi.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best || bd > 30) return;
    best.occupied = true; best.reservedBy = 'neon_customs';
    const grp = new THREE.Group();
    const y = env.collision.getGroundHeight(best.x, best.z, 1, 1);
    grp.position.set(best.x, y + 0.02, best.z);
    grp.rotation.y = best.heading;
    const paint = new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.6, depthWrite: false });
    for (const [w, d, x, z] of [[2.7, 0.1, 0, 2.7], [2.7, 0.1, 0, -2.7], [0.1, 5.4, 1.35, 0], [0.1, 5.4, -1.35, 0]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint); m.rotation.x = -Math.PI / 2; m.position.set(x, 0, z); grp.add(m);
    }
    this.game.scene.add(grp);
    // Letreiro NEON CUSTOMS acima do da oficina (mesma fachada).
    const tex = neonTextTexture('Neon Customs', { color: '#ff4fd8', style: 'script', sub: 'PERSONALIZAÇÃO' });
    const sign = createSignMesh(tex, 3.6, 0.9, { intensity: 1.8, backing: 0x120a1c, backingDepth: 0.1 });
    sign.group.position.set(ws.poi.x + ws.normal.x * 0.15, ws.poi.y + 4.0, ws.poi.z + ws.normal.z * 0.15);
    sign.group.rotation.y = ws.bld.rotY;
    this.game.scene.add(sign.group);
    this.entry = { spot: best, x: best.x, z: best.z, heading: best.heading, group: grp, sign };
    // Baia interna: interior próprio num lote sem estabelecimento (camada Y=300).
    this.bayExt = { def: BAY_DEF, W: 16, D: 14, doorX: 0, bld: { x: -132, z: -70, rotY: Math.PI / 2, w: 30, d: 20 }, poi: { x: -132 + 10, y: 0.15, z: -70 }, normal: { x: 1, z: 0 }, group: new THREE.Group(), pivot: new THREE.Group(), open: 0, openTarget: 0 };
  }

  /** Antes dos veículos: prioridade da tecla E dentro do carro na vaga. */
  preUpdate(dt, input) {
    const g = this.game, vm = g.vehicles, vi = vm.interaction;
    if (this.session) { vi.suppressed = true; this._sessionTick(dt); return; }
    if (!this.entry || g.state !== 'playing' || vm.state !== 'DRIVING') return;
    const v = vm.playerVehicle;
    if (!v || v.police) return;
    const d = Math.hypot(v.root.position.x - this.entry.x, v.root.position.z - this.entry.z);
    // Logo após sair da oficina o carro está na vaga: o E volta a ser "sair do veículo"
    // até o carro se afastar (antes: o jogador não conseguia descer na vaga).
    if (this.zoneLocked) { if (d > 6) this.zoneLocked = false; return; }
    if (d > 3.6) return;
    vi.suppressed = true;
    const slow = Math.abs(v.physics.speed) < 2;
    g.hud.setPrompt(slow ? 'PRESSIONE <kbd>E</kbd> PARA PERSONALIZAR · NEON CUSTOMS' : 'NEON CUSTOMS · PARE NA VAGA ROSA');
    if (slow && input.wasPressed('interact')) this.start(v);
  }

  // ------------------------------------------------------------ sessão
  configOf(v) {
    if (!v.custom) v.custom = defaultConfig(v);
    return v.custom;
  }

  /** Aplica uma configuração salva (garagem / carregamento) ao veículo. */
  applyConfig(v, raw) {
    const cfg = sanitizeConfig(raw, v);
    v.custom = cfg;
    applyAppearance(v, cfg, this.game.world.vehicleFactory);
    applyPerformance(v, cfg);
    return cfg;
  }

  start(v) {
    if (this.session) return false;
    const g = this.game, vm = g.vehicles;
    if (vm.playerVehicle !== v || vm.state !== 'DRIVING' || v.police) return false;
    if (g.interiors?.active || g.gameMenu?.open) return false;
    // Identidade persistente (carros vindos do trânsito ganham id próprio) e posse.
    if (!v.persistId && v.id.startsWith('traffic')) v.persistId = `own_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    g.properties?.garage.owned.add(v.persistId || v.id);
    const installed = { ...this.configOf(v) };
    this.session = { v, installed, preview: { ...installed }, t: 0, phase: 'in', id: ++this.sessionSeq, pose: { x: v.root.position.x, y: v.root.position.y, z: v.root.position.z, heading: v.physics.heading }, busy: false };
    vm.inputLocked = true;
    Object.assign(v.controls, { throttle: 0, brake: 1, steer: 0, handbrake: true });
    g.interiors.fade.classList.add('on');
    this.stats.sessions++;
    return true;
  }

  _sessionTick(dt) {
    const S = this.session, g = this.game, I = g.interiors;
    S.t += dt;
    if (S.phase === 'in' && S.t > 0.35) {
      S.phase = 'open';
      const inst = I._ensureBuilt(this.bayExt);
      I._activate(inst);
      this.inst = inst;
      // O carro pertence ao grupo de veículos do mapa (oculto com o mundo externo): fica
      // na cena durante a sessão e volta ao grupo original na saída (mesmo objeto).
      S.parent = S.v.root.parent;
      g.scene.add(S.v.root);
      const p = inst.L(0, 0, 0);
      S.v.setPose(p.x, p.y + 0.06, p.z, this.bayExt.bld.rotY + Math.PI / 2);
      S.v.physics.awake = false;
      this.cam.target.set(p.x, p.y + 0.7, p.z);
      this.cam.cur = null;
      I.fade.classList.remove('on');
      try { document.exitPointerLock?.(); } catch { /* ignorado */ }
      this.ui.open(CAT_TABS);
      g.hud.setPrompt(null);
    } else if (S.phase === 'out' && S.t > 0.35 && !S.done) {
      S.done = true;
      I._deactivate();
      this.inst = null;
      if (S.parent) S.parent.add(S.v.root);
      // Devolve o MESMO carro à vaga de entrada (posição livre verificada).
      const e = this.entry, v = S.v, vm = g.vehicles;
      const y = vm._placementFree(v, e.x, e.z, e.heading);
      const pose = y !== null ? { x: e.x, y, z: e.z, heading: e.heading } : vm._findRecoverySpot({ id: v.id, spec: v.spec, physics: { x: e.x, z: e.z, heading: e.heading } }) || S.pose;
      v.setPose(pose.x, pose.y ?? S.pose.y, pose.z, pose.heading);
      v.physics.syncFromRoot();
      // A física foi posta para dormir na baia: acorda para o jogador voltar a dirigir.
      v.physics.wake?.();
      v.engineOn = true;
      I.fade.classList.remove('on');
      vm.inputLocked = false;
      g.cameras.third?.reset?.(g.player);
      this.session = null;
      this.zoneLocked = true;
      g.save?.autosave('Personalização');
    }
  }

  /** Sai da oficina: prévia não comprada é descartada (volta ao instalado). */
  leave() {
    const S = this.session;
    if (!S || S.phase !== 'open') return;
    S.preview = { ...S.installed };
    applyAppearance(S.v, S.installed, this.game.world.vehicleFactory);
    this.ui.close();
    S.phase = 'out'; S.t = 0;
    this.game.interiors.fade.classList.add('on');
  }

  // ------------------------------------------------------------ prévia e compra
  /** Prévia visual + barras; não cobra nem salva. */
  preview(cat, value) {
    const S = this.session;
    if (!S) return { ok: false };
    const next = { ...S.preview };
    if (cat === 'paint') { next.paint = value.paint; next.paintHex = PAINTS.find((p) => p.id === value.paint)?.hex ?? next.paintHex; next.finish = value.finish; }
    else next[cat] = value;
    if (cat !== 'paint' && !this.compatible(cat, value, next)) return { ok: false, msg: 'Incompatível com este veículo ou com outra peça instalada.' };
    S.preview = next;
    if (!(cat in UPGRADES)) applyAppearance(S.v, next, this.game.world.vehicleFactory);
    this.stats.previews++;
    return { ok: true };
  }

  cancelPreview(cat) {
    const S = this.session;
    if (!S) return;
    if (cat === 'paint') { S.preview.paint = S.installed.paint; S.preview.paintHex = S.installed.paintHex; S.preview.finish = S.installed.finish; }
    else S.preview[cat] = S.installed[cat];
    applyAppearance(S.v, S.preview, this.game.world.vehicleFactory);
  }

  compatible(cat, value, cfg = this.session?.preview) {
    const type = this.session?.v.type;
    if (cat in UPGRADES || cat === 'paint' || cat === 'repair') return true;
    if (cat === 'paint2') return value === null || PAINTS.some((p) => p.id === value);
    return isCompatible(cat, value, type, cfg || {});
  }

  priceOf(cat, value) {
    if (cat === 'paint') return FINISHES[value.finish]?.price ?? 0;
    if (cat === 'paint2') return value ? SECONDARY_PRICE : 0;
    if (cat in UPGRADES) return UPGRADES[cat].levels[value]?.price ?? 0;
    return partOption(cat, value)?.price ?? 0;
  }

  isInstalled(cat, value) {
    const I = this.session?.installed;
    if (!I) return false;
    if (cat === 'paint') return I.paint === value.paint && I.finish === value.finish;
    return I[cat] === value;
  }

  /** Compra protegida: compatível, saldo, cobrança única (id por sessão), aplica e persiste. */
  buy(cat, value) {
    const S = this.session, g = this.game;
    if (!S || S.busy) return { ok: false, msg: 'Aguarde.' };
    if (this.isInstalled(cat, value)) return { ok: false, msg: 'Já instalado.' };
    if (!this.compatible(cat, value)) { this.stats.refused++; return { ok: false, msg: 'Peça incompatível.' }; }
    const price = this.priceOf(cat, value);
    S.busy = true;
    try {
      const key = cat === 'paint' ? `${value.paint}_${value.finish}` : String(value);
      const r = g.economy.spend(price, `NEON CUSTOMS: ${cat} ${key}`, { txId: `custom_${S.id}_${cat}_${key}` });
      if (!r.ok || r.duplicate) { this.stats.refused++; g.interiors?.audio.sfx('deny'); return { ok: false, msg: r.duplicate ? 'Compra já registrada.' : r.msg }; }
      if (cat === 'paint') { S.installed.paint = value.paint; S.installed.paintHex = PAINTS.find((p) => p.id === value.paint)?.hex ?? S.installed.paintHex; S.installed.finish = value.finish; }
      else S.installed[cat] = value;
      S.preview = { ...S.preview, ...(cat === 'paint' ? { paint: S.installed.paint, paintHex: S.installed.paintHex, finish: S.installed.finish } : { [cat]: value }) };
      S.v.custom = { ...S.installed };
      applyAppearance(S.v, S.preview, g.world.vehicleFactory);
      applyPerformance(S.v, S.installed);
      this.stats.purchases++;
      g.interiors?.audio.sfx('register');
      return { ok: true, msg: `Instalado por $${price.toLocaleString('pt-BR')}.` };
    } finally {
      S.busy = false;
    }
  }

  repairCost() {
    const v = this.session?.v;
    if (!v?.damage) return 0;
    return Math.ceil((100 - v.damage.integrity) * REPAIR_PER_POINT);
  }

  repair() {
    const S = this.session, g = this.game;
    if (!S || S.busy) return { ok: false, msg: 'Aguarde.' };
    const cost = this.repairCost();
    if (cost <= 0) return { ok: false, msg: 'O carro está inteiro.' };
    const r = g.economy.spend(cost, 'NEON CUSTOMS: reparo', { txId: `repair_${S.id}_${Math.round(S.v.damage.integrity)}` });
    if (!r.ok) { g.interiors?.audio.sfx('deny'); return { ok: false, msg: r.msg }; }
    S.v.damage.repair();
    // Reparo preserva todas as peças e a pintura personalizada.
    applyAppearance(S.v, S.preview, g.world.vehicleFactory);
    g.interiors?.audio.sfx('tool');
    return { ok: true, msg: `Reparo completo por $${cost.toLocaleString('pt-BR')}. Peças preservadas.` };
  }

  barStats() {
    const S = this.session;
    if (!S) return null;
    return { installed: statsFor(S.v.type, S.installed), preview: statsFor(S.v.type, S.preview) };
  }

  // ------------------------------------------------------------ câmera de apresentação
  setPreset(name) {
    const c = this.cam;
    c.preset = name;
    const P = { front: [0, 0.18, 5.6], back: [Math.PI, 0.2, 5.6], side: [Math.PI / 2, 0.12, 5.8], wheels: [0.55, 0.05, 3.3], interior: [0, 0, 0], orbit: [c.yaw, c.pitch, c.dist] }[name];
    if (P && name !== 'interior') { c.yaw = P[0]; c.pitch = P[1]; c.dist = P[2]; }
  }

  rotate(dx, dy) { this.cam.yaw -= dx * 0.008; this.cam.pitch = THREE.MathUtils.clamp(this.cam.pitch + dy * 0.005, -0.02, 0.9); if (this.cam.preset === 'interior') this.cam.preset = 'orbit'; }
  zoom(d) { this.cam.dist = THREE.MathUtils.clamp(this.cam.dist + d * 0.004, 3.2, 8.5); }

  /** Depois das câmeras do jogo: sobrepõe a câmera de apresentação, com limites. */
  cameraTick(dt) {
    const S = this.session;
    if (!S || S.phase !== 'open' || !this.inst) return;
    const cam = this.game.camera, c = this.cam, v = S.v;
    const heading = v.root.rotation.y;
    let pos;
    const look = c.target.clone();
    if (c.preset === 'interior') {
      const seat = v.spec.seats.find((s) => s.driver) || v.spec.seats[0];
      pos = new THREE.Vector3(seat.x, seat.hipY + 0.62, seat.z).applyMatrix4(v.root.matrixWorld);
      look.copy(new THREE.Vector3(seat.x, seat.hipY + 0.5, seat.z + 2).applyMatrix4(v.root.matrixWorld));
    } else {
      const yaw = heading + c.yaw;
      const half = { x: v.spec.width / 2 + 0.6, z: v.spec.length / 2 + 0.6 };
      let dist = c.dist;
      pos = new THREE.Vector3(c.target.x + Math.sin(yaw) * Math.cos(c.pitch) * dist, c.target.y + Math.sin(c.pitch) * dist + 0.3, c.target.z + Math.cos(yaw) * Math.cos(c.pitch) * dist);
      // Nunca dentro da carroceria (caixa do carro ampliada) e sempre dentro da baia.
      const local = pos.clone().sub(v.root.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -heading);
      if (Math.abs(local.x) < half.x && Math.abs(local.z) < half.z && local.y < v.spec.height + 0.5) local.y = v.spec.height + 0.6;
      pos.copy(local.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading).add(v.root.position));
      const b = this.inst, l = b.root.worldToLocal(pos.clone());
      l.x = THREE.MathUtils.clamp(l.x, -b.W / 2 + 0.5, b.W / 2 - 0.5);
      l.z = THREE.MathUtils.clamp(l.z, -b.D / 2 + 0.5, b.D / 2 - 0.5);
      l.y = THREE.MathUtils.clamp(l.y, 0.5, b.H - 0.4);
      pos = b.root.localToWorld(l);
      if (c.preset === 'wheels') look.copy(new THREE.Vector3(v.spec.track / 2, v.spec.wheelRadius, v.spec.wheelBase / 2).applyMatrix4(v.root.matrixWorld));
    }
    if (!c.cur) c.cur = { pos: pos.clone(), look: look.clone() };
    const k = 1 - Math.exp(-dt * 6);
    c.cur.pos.lerp(pos, k); c.cur.look.lerp(look, k);
    cam.position.copy(c.cur.pos);
    cam.lookAt(c.cur.look);
    cam.updateMatrixWorld();
  }

  summary() {
    const v = this.session?.v || this.game.vehicles.playerVehicle;
    return { session: !!this.session, entry: this.entry ? [this.entry.x, this.entry.z] : null, config: v?.custom || null, parts: v ? partSummary(v) : [], ...this.stats };
  }
}

export { CAT_TABS, PARTS, UPGRADES, PAINTS, FINISHES, paintHexOf };
