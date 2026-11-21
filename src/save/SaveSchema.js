/**
 * Esquema versionado do salvamento e validação defensiva.
 * O conteúdo persistido NUNCA é executado: só números, textos, booleanos,
 * listas e objetos simples são aceitos; tudo é conferido antes de aplicar.
 */
export const SAVE_VERSION = 1;
export const SLOT_KEYS = ['auto', 'slot1', 'slot2', 'slot3'];

const ID_RE = /^[a-z0-9_\-]{1,64}$/i;
const LIMIT = 100000; // coordenadas plausíveis (o mapa tem ~±400 m)

export const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isSafeInteger(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isPlain = (v) => isObj(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** Rejeita funções, símbolos, objetos com protótipo (ex.: Three.js) e ciclos. */
export function assertPlainData(v, path = 'save', seen = new Set(), depth = 0) {
  if (depth > 12) throw new Error(`${path}: estrutura profunda demais`);
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error(`${path}: número inválido`); return; }
  if (typeof v !== 'object') throw new Error(`${path}: tipo não serializável (${typeof v})`);
  if (seen.has(v)) throw new Error(`${path}: referência circular`);
  seen.add(v);
  if (Array.isArray(v)) v.forEach((x, i) => assertPlainData(x, `${path}[${i}]`, seen, depth + 1));
  else {
    if (!isPlain(v)) throw new Error(`${path}: objeto complexo não permitido`);
    for (const k of Object.keys(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error(`${path}: chave proibida`);
      assertPlainData(v[k], `${path}.${k}`, seen, depth + 1);
    }
  }
  seen.delete(v);
}

/**
 * Valida a estrutura de um salvamento já migrado para SAVE_VERSION.
 * refs: { maps: Set, properties: Set, garages: Set, weapons: Set, ammo: Set }
 * Retorna { ok, errors[], warnings[] }. Erros estruturais invalidam; referências
 * desconhecidas (ex.: imóvel removido numa versão futura) viram avisos e são ignoradas.
 */
export function validateSave(s, refs = {}) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m);
  try { assertPlainData(s); } catch (e) { return { ok: false, errors: [e.message], warnings }; }
  if (!isObj(s)) return { ok: false, errors: ['não é um objeto'], warnings };
  if (s.saveVersion !== SAVE_VERSION) err(`versão ${s.saveVersion} incompatível (esperada ${SAVE_VERSION})`);
  if (!isId(s.gameId)) err('gameId ausente ou inválido');
  if (typeof s.savedAt !== 'string' || Number.isNaN(Date.parse(s.savedAt))) err('data de gravação inválida');
  if (!isId(s.map)) err('mapa inválido');
  else if (refs.maps && !refs.maps.has(s.map)) warnings.push(`mapa "${s.map}" indisponível`);
  if (!isNum(s.playTime) || s.playTime < 0) err('tempo de jogo inválido');

  const p = s.player;
  if (!isObj(p)) err('player ausente');
  else {
    for (const k of ['x', 'y', 'z', 'yaw']) if (!isNum(p[k]) || Math.abs(p[k]) > LIMIT) err(`player.${k} inválido`);
    if (!isNum(p.health) || p.health < 0 || p.health > 100) err('player.health inválido');
    if (p.inside !== null && p.inside !== undefined && !isId(p.inside)) err('player.inside inválido');
  }
  if (!isObj(s.time) || !isNum(s.time.minutes) || s.time.minutes < 0 || s.time.minutes >= 1440) err('horário inválido');

  const e = s.economy;
  if (!isObj(e) || !isInt(e.money) || e.money < 0 || e.money > 99999999) err('dinheiro inválido');
  if (e && e.history !== undefined && !Array.isArray(e.history)) err('histórico financeiro inválido');

  const inv = s.inventory;
  if (!isObj(inv)) err('inventário ausente');
  else {
    const w = inv.weapons;
    if (!isObj(w) || !Array.isArray(w.owned) || !isObj(w.reserve)) err('inventário de armas inválido');
    else {
      const seen = new Set();
      for (const o of w.owned) {
        if (!isObj(o) || !isId(o.id) || !isInt(o.loaded) || o.loaded < 0) { err('arma inválida'); continue; }
        if (seen.has(o.id)) err(`arma duplicada: ${o.id}`);
        seen.add(o.id);
        if (refs.weapons && !refs.weapons.has(o.id)) warnings.push(`arma desconhecida ignorada: ${o.id}`);
      }
      for (const [k, n] of Object.entries(w.reserve)) if (!isInt(n) || n < 0) err(`munição inválida: ${k}`);
      if (w.selected !== null && w.selected !== undefined && !isId(w.selected)) err('arma selecionada inválida');
    }
    for (const k of ['clothes', 'keys']) if (inv[k] !== undefined && !isObj(inv[k]) && !Array.isArray(inv[k])) err(`inventário.${k} inválido`);
    if (inv.items !== undefined && !isObj(inv.items)) err('inventário.items inválido');
  }

  const pr = s.properties;
  if (!isObj(pr) || !Array.isArray(pr.owned)) err('propriedades inválidas');
  else {
    if (new Set(pr.owned).size !== pr.owned.length) err('propriedade duplicada');
    for (const id of pr.owned) {
      if (!isId(id)) err('id de propriedade inválido');
      else if (refs.properties && !refs.properties.has(id)) warnings.push(`propriedade desconhecida ignorada: ${id}`);
    }
    if (pr.storage !== undefined && !isObj(pr.storage)) err('armazenamento inválido');
  }

  const vehIds = new Set();
  const checkVeh = (v, where) => {
    if (!isObj(v) || !isId(v.pid) || !isId(v.type)) { err(`veículo inválido em ${where}`); return; }
    if (vehIds.has(v.pid)) err(`veículo duplicado: ${v.pid}`);
    vehIds.add(v.pid);
    if (!isNum(v.integrity) || v.integrity < 0 || v.integrity > 100) err(`integridade inválida: ${v.pid}`);
    if (!isInt(v.color) || v.color < 0 || v.color > 0xffffff) err(`cor inválida: ${v.pid}`);
  };
  if (!isObj(s.garages)) err('garagens inválidas');
  else for (const [gid, list] of Object.entries(s.garages)) {
    if (!isId(gid) || !Array.isArray(list)) { err(`garagem inválida: ${gid}`); continue; }
    if (refs.garages && !refs.garages.has(gid)) warnings.push(`garagem desconhecida: ${gid}`);
    list.forEach((v) => checkVeh(v, gid));
  }
  // Barcos (PROMPT 11; opcional: saves anteriores não têm a seção).
  if (s.boats !== undefined && s.boats !== null) {
    const bo = s.boats;
    if (!isObj(bo) || !Array.isArray(bo.owned)) err('barcos inválidos');
    else {
      const ids = new Set();
      for (const r of bo.owned) {
        if (!isObj(r) || !isId(r.pid) || !isId(r.type)) { err('barco inválido'); continue; }
        if (ids.has(r.pid)) err(`barco duplicado: ${r.pid}`);
        ids.add(r.pid);
        if (refs.boats && !refs.boats.has(r.type)) warnings.push(`modelo de barco desconhecido: ${r.type}`);
        if (!isNum(r.hp) || r.hp < 0 || r.hp > 1000) err(`casco inválido: ${r.pid}`);
        if (r.location !== 'storage' && r.location !== 'world') err(`local de barco inválido: ${r.pid}`);
        if (r.location === 'world' && !['x', 'z', 'heading'].every((k) => isNum(r[k]) && Math.abs(r[k]) < LIMIT)) err(`posição de barco inválida: ${r.pid}`);
      }
      if (bo.aboard !== null && bo.aboard !== undefined && !ids.has(bo.aboard)) err('barco pilotado inexistente');
    }
  }
  if (!isObj(s.vehicles) || !Array.isArray(s.vehicles.world)) err('veículos inválidos');
  else for (const v of s.vehicles.world) {
    checkVeh(v, 'mundo');
    if (v && !['x', 'y', 'z', 'heading'].every((k) => isNum(v[k]) && Math.abs(v[k]) < LIMIT)) err(`posição de veículo inválida: ${v.pid}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Metadados exibidos nos slots (sem precisar carregar o jogo). */
export function slotSummary(s) {
  return {
    savedAt: s.savedAt, map: s.map, minutes: s.time?.minutes ?? 0, money: s.economy?.money ?? 0,
    playTime: s.playTime ?? 0, location: s.location || s.map, label: s.label || '',
  };
}
