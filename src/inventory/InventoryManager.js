import { CLOTHES, ITEMS } from './InventoryDefinitions.js';
import { AMMO_TYPES } from '../weapons/WeaponDefinitions.js';
import { CONFIG } from '../config.js';

/**
 * Inventário do protagonista, separado da representação visual.
 *  - Armas/munição: o inventário REAL do arsenal (WeaponInventory) — não há cópia.
 *  - Roupas, chaves, objetos e especiais: dados simples serializáveis.
 *  - Compras duráveis dos estabelecimentos (roupas, eletrônicos) vêm do
 *    registro de compras dos interiores, então nada é duplicado.
 */
export class InventoryManager {
  constructor(game) {
    this.game = game;
    this.clothes = { owned: new Set(['traje_padrao']), equipped: 'traje_padrao' };
    this.keys = new Set();
    this.items = {};
    this.special = new Set();
  }

  get weapons() { return this.game.weapons; }
  get inv() { return this.game.weapons.inv; }

  /** Roupas possuídas = padrão + compradas na Ocean Style. */
  ownedClothes() {
    const out = new Set(this.clothes.owned);
    const saved = this.game.interiors?.save;
    for (const id of Object.keys(CLOTHES)) if (saved?.owns(id)) out.add(id);
    return [...out];
  }

  /** Objetos duráveis comprados (eletrônicos, itens do mercado) + objetos próprios. */
  ownedItems() {
    const out = { ...this.items };
    const saved = this.game.interiors?.save;
    for (const id of Object.keys(ITEMS)) { const n = saved?.owns(id) || 0; if (n) out[id] = (out[id] || 0) + n; }
    return out;
  }

  equipClothes(id) {
    if (!this.ownedClothes().includes(id)) return false;
    this.clothes.equipped = id;
    return true;
  }

  // ------------------------------------------------------ armas (arsenal real)
  /** Remove a arma do inventário (para o armário) preservando a munição carregada. */
  takeWeapon(id) {
    const e = this.inv.get(id);
    if (!e) return null;
    const W = this.weapons;
    if (W.selected === e) {
      W._forceHolster();
      const next = this.inv.list().find((x) => x !== e);
      if (next) W._setSelected(next);
      else this._clearSelection();
    }
    this.inv.owned.delete(id);
    return { id, loaded: e.loaded };
  }

  /** Devolve uma arma do armário; recusa se já estiver no inventário (sem duplicar). */
  putWeapon(id, loaded) {
    if (this.inv.owned.has(id)) return false;
    const def = this.inv.defs.find((d) => d.id === id);
    if (!def) return false;
    this.inv.owned.set(id, { def, loaded: Math.max(0, Math.min(def.mag, loaded | 0)) });
    if (!this.weapons.selected) this.weapons._setSelected(this.inv.get(id));
    return true;
  }

  _clearSelection() {
    const W = this.weapons;
    if (W.view.current) {
      W.view.current.tp.root.removeFromParent();
      W.view.current.fp.root.removeFromParent();
      W.view.current = null;
    }
    W.selected = null;
  }

  takeAmmo(cat, n) {
    const have = this.inv.reserve[cat] || 0;
    const k = Math.max(0, Math.min(have, n | 0));
    this.inv.reserve[cat] = have - k;
    return k;
  }

  /** Devolve munição respeitando o máximo; retorna quanto coube. */
  putAmmo(cat, n) {
    const max = AMMO_TYPES[cat]?.max ?? 999;
    const have = this.inv.reserve[cat] || 0;
    const k = Math.max(0, Math.min(max - have, n | 0));
    this.inv.reserve[cat] = have + k;
    return k;
  }

  // ------------------------------------------------------ persistência
  serialize() {
    const W = this.weapons;
    return {
      weapons: {
        owned: this.inv.list().map((e) => ({ id: e.def.id, loaded: e.loaded })),
        reserve: { ...this.inv.reserve },
        selected: W.selected?.def.id || null,
        drawn: !!W.drawn,
      },
      clothes: { owned: [...this.clothes.owned], equipped: this.clothes.equipped },
      keys: [...this.keys],
      items: { ...this.items },
      special: [...this.special],
    };
  }

  deserialize(d) {
    const W = this.weapons, inv = this.inv;
    W._forceHolster();
    inv.owned.clear();
    for (const o of d.weapons.owned) {
      const def = inv.defs.find((x) => x.id === o.id);
      if (def && !inv.owned.has(o.id)) inv.owned.set(o.id, { def, loaded: Math.max(0, Math.min(def.mag, o.loaded | 0)) });
    }
    for (const k of Object.keys(inv.reserve)) {
      const n = d.weapons.reserve[k];
      inv.reserve[k] = Number.isSafeInteger(n) ? Math.max(0, Math.min(AMMO_TYPES[k]?.max ?? 999, n)) : 0;
    }
    const sel = d.weapons.selected && inv.get(d.weapons.selected);
    if (sel) W._setSelected(sel);
    else if (inv.list()[0]) W._setSelected(inv.list()[0]);
    else this._clearSelection();
    const c = d.clothes || {};
    this.clothes.owned = new Set(['traje_padrao', ...(Array.isArray(c.owned) ? c.owned.filter((x) => CLOTHES[x]) : [])]);
    this.clothes.equipped = CLOTHES[c.equipped] ? c.equipped : 'traje_padrao';
    this.keys = new Set(Array.isArray(d.keys) ? d.keys.filter((x) => typeof x === 'string') : []);
    this.items = {};
    for (const [k, n] of Object.entries(d.items || {})) if (Number.isSafeInteger(n) && n > 0) this.items[k] = n;
    this.special = new Set(Array.isArray(d.special) ? d.special : []);
  }

  newGame() {
    const W = this.weapons, inv = this.inv;
    W._forceHolster();
    inv.owned.clear();
    for (const k of Object.keys(inv.reserve)) inv.reserve[k] = 0;
    if (CONFIG.weapons.grantAll) inv.grantAll();
    const start = CONFIG.weapons.startWith && inv.get(CONFIG.weapons.startWith);
    if (start) W._setSelected(start);
    else this._clearSelection();
    this.clothes = { owned: new Set(['traje_padrao']), equipped: 'traje_padrao' };
    this.keys = new Set();
    this.items = {};
    this.special = new Set();
  }
}
