import * as THREE from 'three';
import { createPropertyDefs } from './PropertyDefinitions.js';
import { PropertyGarage } from './PropertyGarage.js';
import { StorageManager } from '../inventory/StorageManager.js';
import { CLOTHES, ITEMS, keyLabel } from '../inventory/InventoryDefinitions.js';
import { AMMO_TYPES } from '../weapons/WeaponDefinitions.js';
import { innerDoor, tvScreen } from '../interiors/InteriorDefinitions.js';
import { neonTextTexture, createSignMesh } from '../world/NeonSign.js';
import { formatClock } from '../player/PlayerStatus.js';
import { CONFIG } from '../config.js';

const money = (n) => `$${Number(n).toLocaleString('pt-BR')}`;

/**
 * Propriedades: registro, posse, compra, desbloqueio, interações das
 * residências (dormir, salvar, guarda-roupa, armário, geladeira, garagem),
 * marcadores no radar e integração com o salvamento. As residências usam o
 * sistema de interiores existente (portas, transição, luz, áudio).
 */
export class PropertyManager {
  constructor(game) {
    this.game = game;
    this.cfg = CONFIG.properties;
    this.owned = new Set();
    this.defs = createPropertyDefs(this);
    for (const d of this.defs) d.gate = (mgr, ext) => this.gate(d, ext);
    this.storage = new StorageManager(game.inventory);
    this.garage = new PropertyGarage(this);
    this.placards = new Map();
    this.sleeping = null;
    this.snackAt = -1e9;
    this._buying = false;
    this.stats = { purchases: 0, refused: 0, sleeps: 0 };
    const I = game.interiors;
    I.extraDefs.push(...this.defs);
    I.outsideProviders.push(() => this._garageCandidates());
    I.onExited = (def) => { if (this.owns(def.id)) this.game.save?.autosave('Saída da residência'); };
  }

  owns(id) { return this.owned.has(id); }
  def(id) { return this.defs.find((d) => d.id === id) || null; }
  garageIds() { return this.defs.map((d) => d.property.garage?.id).filter(Boolean); }

  // ------------------------------------------------------------ mapa
  onMapActivated(env) {
    this.env = env;
    this.garage.setup(env, this.defs);
    this._refreshPlacards();
  }

  /** Placa discreta "À VENDA" ao lado da porta dos imóveis disponíveis. */
  _refreshPlacards() {
    for (const p of this.placards.values()) p.group.removeFromParent();
    this.placards.clear();
    const I = this.game.interiors;
    for (const ext of I.exteriors) {
      const d = ext.def;
      if (!d.property || this.owns(d.id)) continue;
      const tex = neonTextTexture('À VENDA', { color: '#ffe95a', style: 'block', sub: money(d.property.price), width: 512, height: 256 });
      const sign = createSignMesh(tex, 1.1, 0.55, { intensity: 1.2, backing: 0x1a1424, backingDepth: 0.05 });
      const grp = new THREE.Group();
      const s = Math.sin(ext.bld.rotY), c = Math.cos(ext.bld.rotY);
      // 1,6 m ao lado da porta, 0,9 m à frente da fachada, numa haste.
      const side = (ext.doorX > 0 ? -1 : 1) * 1.6;
      grp.position.set(ext.poi.x + c * side + s * 0.9, ext.poi.y, ext.poi.z - s * side + c * 0.9);
      grp.rotation.y = ext.bld.rotY;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), new THREE.MeshStandardMaterial({ color: 0x2a2e34, metalness: 0.5, roughness: 0.4 }));
      pole.position.y = 0.7;
      sign.group.position.y = 1.55;
      grp.add(pole, sign.group);
      this.game.scene.add(grp);
      this.placards.set(d.id, { group: grp });
    }
  }

  // ------------------------------------------------------------ compra
  gate(def) {
    if (this.owns(def.id)) return null;
    return {
      prompt: `${def.name} · ${money(def.property.price)} · PRESSIONE <kbd>E</kbd> PARA VISUALIZAR`,
      page: () => this.listingPage(def),
    };
  }

  listingPage(def) {
    const p = def.property;
    const owned = this.owns(def.id);
    const garage = p.garage ? `Garagem: ${p.garage.capacity} vaga(s)` : 'Sem garagem';
    return {
      who: `${def.name} — ${p.typeLabel}`,
      text: `${p.description}\n\nLocal: ${p.location}\nPreço: ${money(p.price)} · ${garage}\nRecursos: ${p.features.join(', ')}.\nSituação: ${owned ? 'ADQUIRIDO' : 'DISPONÍVEL'}`,
      options: [
        ...(owned ? [] : [{ label: `Comprar por ${money(p.price)}`, run: () => this.confirmPage(def) }]),
        { label: 'Fechar', run: () => null },
      ],
    };
  }

  confirmPage(def) {
    const p = def.property;
    const after = this.game.economy.balance() - p.price;
    return {
      who: 'Confirmar compra',
      text: `Comprar ${def.name} por ${money(p.price)}?\nSaldo atual ${money(this.game.economy.balance())} → ${after >= 0 ? money(after) : 'insuficiente'}.`,
      options: [
        { label: 'Confirmar compra', run: () => this.resultPage(this.buy(def.id)) },
        { label: 'Cancelar', run: () => this.listingPage(def) },
      ],
    };
  }

  resultPage(r) {
    return { who: r.ok ? 'Compra concluída' : 'Compra recusada', text: r.msg, options: [{ label: 'Fechar', run: () => null }] };
  }

  /** Compra protegida: disponível, saldo suficiente, cobrança única, registro e autosave. */
  buy(id) {
    const def = this.def(id);
    if (!def) return { ok: false, msg: 'Imóvel inexistente.' };
    if (this.owns(id)) return { ok: false, msg: 'Você já possui este imóvel.' };
    if (this._buying) return { ok: false, msg: 'Transação em andamento.' };
    this._buying = true;
    try {
      const r = this.game.economy.spend(def.property.price, `Compra de imóvel: ${def.name}`, { txId: `property_${id}` });
      if (!r.ok || r.duplicate) {
        this.stats.refused++;
        this.game.interiors.audio.sfx('deny');
        return { ok: false, msg: r.duplicate ? 'Compra já registrada.' : r.msg };
      }
      this.owned.add(id);
      this.game.inventory.keys.add(`key_${id}`);
      this.placards.get(id)?.group.removeFromParent();
      this.placards.delete(id);
      this.stats.purchases++;
      this.game.interiors.audio.sfx('register');
      this.game.hud.toast(`${def.name} agora é sua!`, 3);
      this.game.save?.autosave('Compra de propriedade');
      return { ok: true, msg: `Parabéns! ${def.name} é sua. A chave está no inventário e a porta já está liberada.${def.property.garage ? ` A garagem tem ${def.property.garage.capacity} vaga(s).` : ''}` };
    } finally {
      this._buying = false;
    }
  }

  // ------------------------------------------------------------ ações nos interiores
  door(b, ctx, opts) { return innerDoor(b, ctx, opts); }
  tvScreen(ctx) { return tvScreen(ctx, 'show'); }

  sleepPage(def) {
    const st = this.game.player.status;
    const wake = this.cfg.wakeHour;
    return {
      who: 'Cama', text: `Agora são ${formatClock(st.minutes)}. Dormir avança o relógio e o progresso é salvo automaticamente ao acordar.`,
      options: [
        { label: `Dormir até as ${String(wake).padStart(2, '0')}:00`, run: () => { this.sleep(wake * 60); return null; } },
        { label: 'Cochilar 2 horas', run: () => { this.sleep((st.minutes + 120) % 1440); return null; } },
        { label: 'Cancelar', run: () => null },
      ],
    };
  }

  /** Transição visual, avanço do relógio existente, ambiente atualizado, controle devolvido. */
  sleep(targetMinutes) {
    if (this.sleeping) return;
    const g = this.game;
    g.player.setExternalPose(g.player.visualPosition.clone(), g.player.controller.yaw, 0, 0);
    this.sleeping = { t: 0, target: targetMinutes, done: false };
    g.interiors.fade.classList.add('on', 'slow');
    this.stats.sleeps++;
  }

  update(dt) {
    const S = this.sleeping;
    if (!S) return;
    const g = this.game;
    S.t += dt;
    if (S.t > 0.9 && !S.done) {
      S.done = true;
      const m = S.target;
      // Reaproveita o ciclo de dia/noite: preset visual coerente + relógio exato.
      const preset = m >= 6 * 60 && m < 17 * 60 ? 'morning' : m >= 17 * 60 && m < 20 * 60 ? 'sunset' : 'night';
      if (g.world.timeOfDay !== preset) g.setTimeOfDay(preset);
      g.player.status.minutes = m;
      g.player.status.setHealth(100);
    }
    if (S.t > 1.8) {
      g.interiors.fade.classList.remove('on', 'slow');
      const p = g.player.external?.position.clone() || g.player.visualPosition.clone();
      g.player.releaseExternalPose(p, g.player.external?.yaw ?? g.player.controller.yaw);
      this.sleeping = null;
      g.hud.toast(`Bom dia! ${formatClock(g.player.status.minutes)}`, 2.5);
      g.save?.autosave('Dormiu');
    }
  }

  wardrobePage(def) {
    const inv = this.game.inventory;
    const glb = this.game.player.modelMode === 'glb';
    const list = inv.ownedClothes();
    const page = (msg) => ({
      who: 'Guarda-roupa',
      text: `${msg}\n${glb ? 'O protagonista importado (GLB) tem uma roupa única, sem peças separadas: a escolha fica registrada e será aplicada quando houver variantes compatíveis do modelo.' : ''}`,
      options: [
        ...list.map((id) => ({ label: `${CLOTHES[id]?.label || id}${inv.clothes.equipped === id ? ' (escolhida)' : ''}`, disabled: inv.clothes.equipped === id, run: () => { inv.equipClothes(id); return page(`Preferência registrada: ${CLOTHES[id].label}.`); } })),
        { label: 'Fechar', run: () => null },
      ],
    });
    return page(`Roupas disponíveis: ${list.length}. Compre mais na Ocean Style.`);
  }

  storagePage(def) {
    const S = this.storage, inv = this.game.inventory;
    const id = def.id;
    const root = (msg = '') => {
      const box = S.box(id);
      const stored = Object.keys(box.weapons);
      const ammo = Object.entries(box.ammo).filter(([, n]) => n > 0).map(([k, n]) => `${AMMO_TYPES[k].label} ${n}`).join(', ') || 'nenhuma';
      return {
        who: `Armário — ${def.name}`,
        text: `${msg ? `${msg}\n` : ''}Guardadas: ${stored.length ? stored.map((w) => inv.inv.defs.find((d) => d.id === w)?.name || w).join(', ') : 'nenhuma arma'}.\nMunição guardada: ${ammo}.`,
        options: [
          { label: 'Guardar uma arma', run: () => weapons('deposit') },
          { label: 'Retirar uma arma', run: () => weapons('withdraw') },
          { label: 'Munição', run: () => ammoPage() },
          { label: 'Consultar inventário', run: () => this.inventoryPage(() => root()) },
          { label: 'Fechar', run: () => null },
        ],
      };
    };
    const weapons = (mode, msg = '') => {
      const box = S.box(id);
      const list = mode === 'deposit' ? inv.inv.list().map((e) => ({ id: e.def.id, name: e.def.name, loaded: e.loaded })) : Object.entries(box.weapons).map(([w, s]) => ({ id: w, name: inv.inv.defs.find((d) => d.id === w)?.name || w, loaded: s.loaded }));
      return {
        who: mode === 'deposit' ? 'Guardar arma' : 'Retirar arma',
        text: msg || (list.length ? 'Escolha a arma (a munição carregada vai junto).' : 'Nada para mostrar aqui.'),
        options: [
          ...list.slice(0, 8).map((w) => ({ label: `${w.name} · ${w.loaded} no pente`, run: () => { const r = mode === 'deposit' ? S.depositWeapon(id, w.id) : S.withdrawWeapon(id, w.id); return weapons(mode, r.msg); } })),
          { label: 'Voltar', run: () => root() },
        ],
      };
    };
    const ammoPage = (msg = '') => {
      const box = S.box(id);
      const cats = Object.keys(AMMO_TYPES);
      return {
        who: 'Munição (30 por vez)',
        text: msg || cats.map((k) => `${AMMO_TYPES[k].label}: com você ${inv.inv.reserve[k] || 0} · no armário ${box.ammo[k] || 0}`).join('\n'),
        options: [
          ...cats.map((k) => ({ label: `Guardar 30 · ${AMMO_TYPES[k].label}`, run: () => ammoPage(S.depositAmmo(id, k, 30).msg) })),
          ...cats.map((k) => ({ label: `Retirar 30 · ${AMMO_TYPES[k].label}`, run: () => ammoPage(S.withdrawAmmo(id, k, 30).msg) })).slice(0, 4),
          { label: 'Voltar', run: () => root() },
        ].slice(0, 9),
      };
    };
    return root();
  }

  /** Consulta do inventário (somente leitura), também usada pelo menu do jogo. */
  inventoryPage(back = null) {
    const inv = this.game.inventory;
    const weapons = inv.inv.list().map((e) => `${e.def.name} (${e.loaded})`).join(', ') || 'nenhuma';
    const ammo = Object.entries(inv.inv.reserve).map(([k, n]) => `${AMMO_TYPES[k].label} ${n}`).join(' · ');
    const clothes = inv.ownedClothes().map((c) => CLOTHES[c]?.label || c).join(', ');
    const keys = [...inv.keys].map((k) => keyLabel(this.def(k.replace(/^key_/, ''))?.name || k)).join(', ') || 'nenhuma';
    const items = Object.entries(inv.ownedItems()).map(([k, n]) => `${ITEMS[k]?.label || k}${n > 1 ? ` ×${n}` : ''}`).join(', ') || 'nenhum';
    return {
      who: 'Inventário',
      text: `Dinheiro: ${money(this.game.economy.balance())}\nArmas: ${weapons}\nMunição: ${ammo}\nRoupas: ${clothes}\nChaves: ${keys}\nObjetos: ${items}`,
      options: [back ? { label: 'Voltar', run: back } : { label: 'Fechar', run: () => null }],
    };
  }

  fridgePage(def) {
    const st = this.game.player.status;
    const ready = this.game.playTime - this.snackAt > 60;
    return {
      who: 'Geladeira', text: ready ? 'Suco de laranja, sobras de pizza e um iogurte.' : 'Você acabou de comer. Volte mais tarde.',
      options: [
        ...(ready ? [{ label: 'Fazer um lanche (+15 de vida)', run: () => { st.setHealth(st.health + 15); this.snackAt = this.game.playTime; this.game.interiors.audio.sfx('fridge'); return { who: 'Geladeira', text: 'Lanche rápido. Vida restaurada.', options: [{ label: 'Fechar', run: () => null }] }; } }] : []),
        { label: 'Fechar', run: () => null },
      ],
    };
  }

  // ------------------------------------------------------------ salvar (ponto de salvamento)
  savePage(def) {
    const saver = this.game.save;
    const ui = this.game.interiors.ui;
    const show = (page) => { if (ui.open) ui.show(page, () => this.game.economy.balance()); };
    const describe = (k, v) => (v?.ok ? `${k.replace('slot', 'Slot ')} · ${new Date(v.meta.savedAt).toLocaleString('pt-BR')} · ${formatClock(v.meta.minutes)} · ${money(v.meta.money)} · ${v.meta.location}` : `${k.replace('slot', 'Slot ')} · ${v?.empty ? 'vazio' : 'inválido'}`);
    const doSave = (slot) => {
      saver.save(slot, { label: def.name }).then((r) => {
        if (r.ok) this.game.interiors.audio.sfx('save');
        show({ who: r.ok ? 'Progresso salvo' : 'Falha ao salvar', text: r.ok ? `Gravado em ${slot.replace('slot', 'Slot ')} (${def.name}). Confirmado após a gravação.` : r.msg, options: [{ label: 'Fechar', run: () => null }] });
      });
      return { who: 'Salvando…', text: 'Gravando a partida. Aguarde a confirmação.', options: [] };
    };
    saver.list().then((l) => show({
      who: `Salvar progresso — ${def.name}`,
      text: 'Escolha um slot. Slots ocupados pedem confirmação antes de serem sobrescritos. O salvamento automático usa um slot separado.',
      options: [
        ...['slot1', 'slot2', 'slot3'].map((k) => ({
          label: describe(k, l[k]),
          run: () => (l[k]?.ok || l[k]?.msg && !l[k]?.empty
            ? { who: 'Sobrescrever?', text: `${describe(k, l[k])}\nSubstituir este salvamento? O anterior fica como cópia de segurança.`, options: [{ label: 'Sim, sobrescrever', run: () => doSave(k) }, { label: 'Não', run: () => null }] }
            : doSave(k)),
        })),
        { label: 'Cancelar', run: () => null },
      ],
    }));
    return { who: 'Salvar progresso', text: 'Lendo os slots…', options: [{ label: 'Cancelar', run: () => null }] };
  }

  // ------------------------------------------------------------ garagem
  garagePage(def, inside = false) {
    const G = this.garage;
    const g = G.forProperty(def.id);
    if (!g) return { who: 'Garagem', text: 'Este imóvel não tem garagem.', options: [{ label: 'Fechar', run: () => null }] };
    const page = (msg = '') => {
      const v = inside ? null : G.vehicleInBay(g);
      return {
        who: `${g.def.label} (${g.vehicles.length}/${g.def.capacity})`,
        text: `${msg ? `${msg}\n` : ''}${g.vehicles.length ? g.vehicles.map((r) => `${r.model} · ${r.plate} · integridade ${Math.round(r.integrity)}%`).join('\n') : 'Nenhum carro guardado.'}${inside ? '\nRetirar daqui deixa o carro na vaga em frente à garagem.' : ''}`,
        options: [
          ...(v ? [{ label: `Guardar ${v.spec.model} (${v.appearance?.plate || ''})`, run: () => { const r = G.store(g.def.id); if (r.ok) { this.game.interiors.audio.sfx('door'); this.game.save?.autosave('Veículo guardado'); } return page(r.msg); } }] : []),
          ...g.vehicles.map((r) => ({ label: `Retirar ${r.model} (${r.plate})`, run: () => { const res = G.retrieve(g.def.id, r.pid); if (res.ok) this.game.save?.autosave('Veículo retirado'); return page(res.msg); } })),
          { label: 'Fechar', run: () => null },
        ],
      };
    };
    return page(inside ? '' : 'Estacione na vaga marcada em azul, desça do carro e use este painel.');
  }

  /** Painéis de garagem (do lado de fora) dos imóveis possuídos. */
  _garageCandidates() {
    const out = [];
    const p = this.game.player.visualPosition;
    for (const g of this.garage.garages.values()) {
      if (!this.owns(g.prop.id)) continue;
      const d = Math.hypot(g.door.x - p.x, g.door.z - p.z);
      if (d > 1.7) continue;
      out.push({ dist: d, anchor: g.door, label: `PRESSIONE <kbd>E</kbd> · GARAGEM · ${g.prop.name}`, run: () => this.garagePage(g.prop, false) });
    }
    return out;
  }

  // ------------------------------------------------------------ radar
  /** Marcadores: residência própria, à venda, garagem, ponto de salvamento. */
  markers() {
    const out = [];
    for (const ext of this.game.interiors.exteriors) {
      if (!ext.def.property) continue;
      const own = this.owns(ext.def.id);
      out.push({ x: ext.poi.x, z: ext.poi.z, kind: own ? 'home' : 'sale', label: ext.def.name });
    }
    for (const g of this.garage.garages.values()) if (this.owns(g.prop.id)) out.push({ x: g.door.x, z: g.door.z, kind: 'garage' });
    return out;
  }

  // ------------------------------------------------------------ partida
  newGame() {
    this.owned = new Set(this.defs.filter((d) => d.property.starter).map((d) => d.id));
    this.game.inventory.keys = new Set([...this.owned].map((id) => `key_${id}`));
    this.storage.boxes = {};
    this.garage.deserialize({}, [], []);
    this._refreshPlacards();
    // Carro inicial do protagonista: o NEON GT, estacionado em frente ao prédio.
    const vm = this.game.vehicles;
    const car = vm.list.find((v) => v.id === this.cfg.starterVehicle);
    const spot = this.cfg.starterSpot;
    if (car && spot && !this.env?.isImported) {
      const y = vm._placementFree(car, spot.x, spot.z, spot.heading);
      if (y !== null) car.setPose(spot.x, y, spot.z, spot.heading);
      for (const s of this.env.parkingSpots || []) if (Math.hypot(s.x - spot.x, s.z - spot.z) < 1.5) { s.occupied = true; s.reservedBy = 'starter'; }
      car.damage?.repair();
      this.garage.owned.add(car.id);
    }
  }

  serializeProperties() {
    return { owned: [...this.owned], storage: this.storage.serialize() };
  }
  serializeGarages() { return this.garage.serializeGarages(); }
  serializeVehicles() { return { world: this.garage.serializeWorld() }; }

  deserialize(s, map, warnings) {
    const valid = new Set(this.defs.map((d) => d.id));
    this.owned = new Set(s.properties.owned.filter((id) => valid.has(id)));
    this.storage.deserialize(s.properties.storage || {}, valid, new Set(this.game.inventory.inv.defs.map((d) => d.id)));
    this.garage.deserialize(s.garages, s.vehicles.world, warnings);
    this._refreshPlacards();
  }

  /** Posiciona o jogador sobre piso válido (nunca dentro de paredes ou abaixo do solo). */
  placePlayerSafely(x, y, z, yaw) {
    const g = this.game;
    const col = g.mapEnv.collision;
    const ok = (px, pz) => {
      const gy = col.getGroundHeight(px, pz, (y ?? 0) + 1.0, 1.0);
      const blocked = col.queryCircle(px, pz, 0.4).some((c) => c.solid && !c.walkable && c.maxY > gy + 0.3 && c.minY < gy + 1.7);
      return blocked ? null : gy;
    };
    let gy = ok(x, z), px = x, pz = z;
    for (let r = 1; gy === null && r <= 12; r++) for (let k = 0; k < 12 && gy === null; k++) {
      const a = (k / 12) * Math.PI * 2;
      const tx = x + Math.cos(a) * r, tz = z + Math.sin(a) * r;
      const t = ok(tx, tz);
      if (t !== null) { gy = t; px = tx; pz = tz; }
    }
    if (gy === null) { const sp = g.mapEnv.spawnPoint; px = sp.x; pz = sp.z; gy = sp.y ?? 0; yaw = sp.yaw ?? yaw; }
    g.player.releaseExternalPose(new THREE.Vector3(px, gy, pz), yaw);
    g.cameras.yaw = yaw + Math.PI;
    g.cameras.third?.reset?.(g.player);
  }
}
