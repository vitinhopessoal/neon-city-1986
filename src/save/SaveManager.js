import { BOATS as BOAT_TYPES } from '../boats/BoatDefinitions.js';
import { SAVE_VERSION, SLOT_KEYS, validateSave, slotSummary, assertPlainData } from './SaveSchema.js';
import { migrateSave } from './SaveMigration.js';

/**
 * Salvamento local robusto.
 *  - IndexedDB (banco "neoncity", store "saves"); se indisponível, cai para
 *    localStorage (os saves têm poucos KB) e, em último caso, memória.
 *  - Slots: "auto" (autosave) separado de "slot1".."slot3" (manuais).
 *  - Fila: toda gravação/leitura é serializada (nunca duas gravações simultâneas).
 *  - Atômico: o snapshot é validado ANTES de gravar; numa única transação o
 *    conteúdo anterior vai para "<slot>.bak" e o novo é gravado — se a
 *    transação falhar, nada muda. A confirmação só sai após o commit.
 *  - Carregar: migra → valida → restaura na ordem mapa → economia →
 *    inventário → propriedades → garagens/veículos → horário → jogador.
 */
const DB_NAME = 'neoncity';
const STORE = 'saves';
const LS_PREFIX = 'neoncity.saves.';
const LEGACY_INTERIORS = 'neoncity.save.interiors';

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB indisponível')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('falha ao abrir IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB bloqueado'));
  });
}

class IdbBackend {
  constructor(db) { this.db = db; this.kind = 'indexeddb'; }
  _tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, mode);
      const st = tx.objectStore(STORE);
      let out;
      Promise.resolve(fn(st, (v) => { out = v; })).catch(reject);
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error || new Error('transação falhou'));
      tx.onabort = () => reject(tx.error || new Error('transação abortada'));
    });
  }
  get(key) {
    return this._tx('readonly', (st, set) => { const r = st.get(key); r.onsuccess = () => set(r.result?.data ?? null); });
  }
  /** Grava key e move o valor anterior para key.bak na MESMA transação. */
  putWithBackup(key, data) {
    return this._tx('readwrite', (st) => {
      const r = st.get(key);
      r.onsuccess = () => {
        if (r.result) st.put({ key: `${key}.bak`, data: r.result.data });
        st.put({ key, data });
      };
    });
  }
  put(key, data) { return this._tx('readwrite', (st) => { st.put({ key, data }); }); }
  delete(key) { return this._tx('readwrite', (st) => { st.delete(key); }); }
}

class LocalBackend {
  constructor() { this.kind = 'localStorage'; this.mem = new Map(); }
  _ok() { try { localStorage.setItem('__nc', '1'); localStorage.removeItem('__nc'); return true; } catch { return false; } }
  async get(key) {
    try { const raw = localStorage.getItem(LS_PREFIX + key); return raw ? JSON.parse(raw) : null; } catch { return this.mem.get(key) ?? null; }
  }
  async putWithBackup(key, data) {
    const json = JSON.stringify(data);
    try {
      const old = localStorage.getItem(LS_PREFIX + key);
      if (old) localStorage.setItem(`${LS_PREFIX}${key}.bak`, old);
      localStorage.setItem(LS_PREFIX + key, json);
    } catch { this.mem.set(key, JSON.parse(json)); this.kind = 'memória'; }
  }
  async put(key, data) { try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(data)); } catch { this.mem.set(key, data); } }
  async delete(key) { try { localStorage.removeItem(LS_PREFIX + key); } catch { this.mem.delete(key); } }
}

export class SaveManager {
  constructor(game) {
    this.game = game;
    this.queue = Promise.resolve();
    this.backend = null;
    this.ready = this._init();
    this.gameId = null;
    this.lastAutosave = 0;
    this.stats = { saves: 0, loads: 0, failed: 0, rejected: 0, autosaves: 0 };
    this.busy = false;
  }

  async _init() {
    try { this.backend = new IdbBackend(await idbOpen()); } catch (e) {
      console.warn('[Save] IndexedDB indisponível, usando localStorage:', e.message);
      this.backend = new LocalBackend();
    }
    // Dados pré-existentes (compras dos estabelecimentos, PROMPT 06): uma cópia é
    // preservada intacta antes de qualquer nova partida reiniciá-los.
    try {
      const legacy = localStorage.getItem(LEGACY_INTERIORS);
      if (legacy && !(await this.backend.get('legacy.interiors'))) await this.backend.put('legacy.interiors', { raw: legacy, preservedAt: new Date().toISOString() });
    } catch { /* sem dados antigos */ }
    return this.backend;
  }

  _enqueue(op) {
    const run = this.queue.then(async () => { await this.ready; this.busy = true; try { return await op(); } finally { this.busy = false; } });
    this.queue = run.catch(() => {});
    return run;
  }

  refs() {
    const g = this.game;
    return {
      maps: new Set(g.maps?.list?.().map((m) => m.id) || ['vice-city']),
      properties: new Set(g.properties?.defs.map((d) => d.id) || []),
      garages: new Set(g.properties?.garageIds() || []),
      weapons: new Set(g.weapons?.inv.defs.map((d) => d.id) || []),
      boats: new Set(Object.keys(g.boats ? BOAT_TYPES : {})),
    };
  }

  // ------------------------------------------------------------- coleta
  collect(label = '') {
    const g = this.game;
    const I = g.interiors;
    const inside = I?.active?.def.id || null;
    // Dentro de um interior a posição externa é a porta do estabelecimento (volta-se por ela).
    let pos = g.player.controller.position, yaw = g.player.controller.yaw;
    if (inside) {
      const e = I.active.ext;
      pos = { x: e.poi.x + e.normal.x * 1.35, y: e.poi.y, z: e.poi.z + e.normal.z * 1.35 };
      yaw = e.bld.rotY;
    } else if (g.vehicles.interaction.crashState) {
      // Caindo da moto: salva o ponto no chão onde o personagem vai se levantar.
      pos = g.vehicles.interaction.crashState.standPoint();
    } else if (g.vehicles.playerVehicle) {
      const v = g.vehicles.playerVehicle;
      pos = { x: v.root.position.x, y: v.root.position.y, z: v.root.position.z };
    } else if (g.boats?.aboard) {
      const P = g.boats.aboard.phys;
      pos = { x: P.x, y: 0, z: P.z };
    }
    const district = g.mapEnv?.getDistrictAt?.(pos.x, pos.z);
    const snap = {
      saveVersion: SAVE_VERSION,
      gameId: this.gameId || this.newGameId(),
      savedAt: new Date().toISOString(),
      label: String(label).slice(0, 40),
      map: g.maps?.activeId || g.maps?.defaultId || 'vice-city',
      location: inside ? I.active.def.name : (district?.name || g.mapEnv?.label || ''),
      playTime: Math.round(g.playTime || 0),
      player: { x: +pos.x.toFixed(3), y: +pos.y.toFixed(3), z: +pos.z.toFixed(3), yaw: +yaw.toFixed(4), health: g.player.status.health, inside },
      time: { minutes: Math.floor(g.player.status.minutes) % 1440, preset: g.world.timeOfDay },
      economy: g.economy.serialize(),
      inventory: g.inventory.serialize(),
      properties: g.properties.serializeProperties(),
      garages: g.properties.serializeGarages(),
      vehicles: g.properties.serializeVehicles(),
      boats: g.boats ? g.boats.serialize() : null,
      radio: g.radio ? g.radio.serialize() : null,
      interiors: g.interiors?.save?.data ? structuredClone(g.interiors.save.data) : null,
      missions: {},
      prefs: { quality: g.qualityKey, camera: g.cameras.mode },
    };
    return snap;
  }

  newGameId() {
    this.gameId = `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    return this.gameId;
  }

  // ------------------------------------------------------------- gravação
  /** Grava no slot; resolve { ok, meta } somente após o commit. */
  save(slot, { label = '', auto = false } = {}) {
    if (!SLOT_KEYS.includes(slot)) return Promise.resolve({ ok: false, msg: 'Slot inválido.' });
    if (auto && slot !== 'auto') return Promise.resolve({ ok: false, msg: 'Autosave só grava no slot automático.' });
    return this._enqueue(async () => {
      let snap;
      try {
        snap = this.collect(label);
        assertPlainData(snap);
        const v = validateSave(snap, this.refs());
        if (!v.ok) { this.stats.rejected++; return { ok: false, msg: `Salvamento recusado: ${v.errors[0]}` }; }
        // Cópia independente (nenhuma referência viva do jogo vai para o banco).
        snap = JSON.parse(JSON.stringify(snap));
        await this.backend.putWithBackup(slot, snap);
        // Releitura: confirma que o conteúdo gravado é idêntico e válido.
        const back = await this.backend.get(slot);
        if (!back || back.savedAt !== snap.savedAt) throw new Error('verificação pós-gravação falhou');
      } catch (e) {
        this.stats.failed++;
        console.error('[Save] falha ao gravar', e);
        return { ok: false, msg: `Falha ao salvar: ${e.message}` };
      }
      this.stats.saves++;
      if (auto) { this.stats.autosaves++; this.lastAutosave = performance.now(); }
      return { ok: true, meta: slotSummary(snap), slot };
    });
  }

  /** Autosave em momentos seguros, com intervalo mínimo (não grava a cada quadro). */
  autosave(reason = '') {
    const g = this.game;
    if (!this.gameId || g.state !== 'playing' || g.mapLoading) return Promise.resolve({ ok: false, msg: 'fora de jogo' });
    if (g.interiors && ['entering', 'exiting', 'moving'].includes(g.interiors.state)) return Promise.resolve({ ok: false, msg: 'em transição' });
    if (g.vehicles.state !== 'ON_FOOT' && g.vehicles.state !== 'DRIVING') return Promise.resolve({ ok: false, msg: 'entrando/saindo de veículo' });
    return this.save('auto', { label: reason, auto: true }).then((r) => {
      if (r.ok) g.hud.toast('Progresso salvo automaticamente', 1.6);
      return r;
    });
  }

  // ------------------------------------------------------------- leitura
  read(slot) {
    return this._enqueue(async () => {
      const raw = await this.backend.get(slot);
      if (!raw) return { ok: false, empty: true, msg: 'Slot vazio.' };
      const m = migrateSave(raw);
      if (!m.ok) return { ok: false, msg: `Salvamento inválido: ${m.error}` };
      const v = validateSave(m.save, this.refs());
      if (!v.ok) return { ok: false, msg: `Salvamento inválido: ${v.errors.slice(0, 2).join('; ')}`, errors: v.errors };
      return { ok: true, save: m.save, warnings: v.warnings, meta: slotSummary(m.save) };
    });
  }

  async list() {
    const out = {};
    for (const k of SLOT_KEYS) {
      const r = await this.read(k);
      out[k] = r.ok ? { ok: true, meta: r.meta } : { ok: false, empty: !!r.empty, msg: r.msg };
    }
    return out;
  }

  /** Último salvamento válido (autosave ou manual), para o botão Continuar. */
  async latest() {
    const l = await this.list();
    let best = null;
    for (const [k, v] of Object.entries(l)) if (v.ok && (!best || Date.parse(v.meta.savedAt) > Date.parse(best.meta.savedAt))) best = { slot: k, meta: v.meta };
    return best;
  }

  remove(slot) {
    return this._enqueue(() => this.backend.delete(slot));
  }

  // ------------------------------------------------------------- restauração
  async load(slot) {
    const r = await this.read(slot);
    if (!r.ok) { this.stats.failed++; return r; }
    try {
      const res = await this.apply(r.save);
      this.stats.loads++;
      return { ok: true, warnings: [...r.warnings, ...(res.warnings || [])], meta: r.meta };
    } catch (e) {
      this.stats.failed++;
      console.error('[Save] falha ao restaurar', e);
      return { ok: false, msg: `Falha ao carregar: ${e.message}` };
    }
  }

  async apply(s) {
    const g = this.game;
    const warnings = [];
    // 1) Mapa: só posiciona o jogador depois que o mapa salvo estiver pronto.
    if (g.interiors?.active) g.interiors._forceOutside();
    if (g.vehicles.interaction.vehicle || g.vehicles.interaction.crashState) g.vehicles.interaction.forceExit();
    if (g.boats?.aboard) g.boats.forceExit();
    const maps = this.refs().maps;
    let map = s.map, recovered = false;
    if (!maps.has(map)) {
      map = g.maps.defaultId || maps.values().next().value;
      if (!map) throw new Error('Nenhum mapa disponível para recuperar o salvamento.');
      warnings.push(`Mapa "${s.map}" indisponível: recuperado em ${g.maps.registry?.get(map)?.label || map}.`);
      recovered = true;
    }
    if (g.maps.activeId !== map) {
      const ok = await g.maps.activate(map);
      if (!ok || g.maps.activeId !== map) throw new Error('Não foi possível carregar o mapa do salvamento.');
    }
    for (let i = 0; i < 400 && g.mapLoading; i++) await new Promise((res) => setTimeout(res, 50));
    // 2) Economia, inventário, compras dos estabelecimentos.
    g.economy.deserialize(s.economy);
    g.inventory.deserialize(s.inventory);
    if (s.interiors && g.interiors?.save) g.interiors.save.replace(s.interiors);
    // 3) Propriedades, 4) garagens e veículos persistentes.
    g.properties.deserialize(s, map, warnings);
    // 4b) Barcos (OCEAN DRIVE): registros do armazém e barcos deixados na água.
    g.boats?.deserialize(s.boats, warnings);
    if (s.radio) g.radio?.deserialize(s.radio);
    // 5) Horário (reaproveita o ciclo existente: preset visual + relógio).
    const m = s.time.minutes;
    const preset = m >= 6 * 60 && m < 17 * 60 ? 'morning' : m >= 17 * 60 && m < 20 * 60 ? 'sunset' : 'night';
    if (g.world.timeOfDay !== preset) g.setTimeOfDay(preset);
    g.player.status.minutes = m;
    // 6) Jogador.
    g.player.status.setHealth(s.player.health);
    g.player.status.setWanted(0);
    this.gameId = s.gameId;
    g.playTime = s.playTime;
    if (s.player.inside && !recovered && g.interiors?.exteriors.some((e) => e.def.id === s.player.inside)) {
      g.interiors.enterImmediately(s.player.inside);
    } else if (s.boats?.aboard && !recovered && g.boats?.boardImmediately(s.boats.aboard)) {
      // Salvo pilotando: volta ao leme do mesmo barco.
    } else {
      const sp = recovered ? g.mapEnv.spawnPoint : s.player;
      g.properties.placePlayerSafely(sp.x, sp.y, sp.z, sp.yaw ?? 0);
    }
    return { warnings };
  }
}
