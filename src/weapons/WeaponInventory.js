import { WEAPONS, AMMO_TYPES } from './WeaponDefinitions.js';

/**
 * Inventário: armas possuídas, munição carregada por arma e reserva por
 * categoria (pistola, escopeta, compacta, carabina). Uma arma equipada por
 * vez nesta etapa; o estado sobrevive a troca de câmera, veículos e mapas.
 */
export class WeaponInventory {
  constructor(defs = WEAPONS) {
    this.defs = defs;
    this.owned = new Map(); // id -> { def, loaded }
    this.reserve = Object.fromEntries(Object.keys(AMMO_TYPES).map((k) => [k, 0]));
    this.selectedId = null;
  }

  /** Concede todas as armas (protótipo: arsenal completo disponível). */
  grantAll() {
    for (const d of this.defs) this.give(d.id);
  }

  give(id, extraAmmo = 0) {
    const def = this.defs.find((d) => d.id === id);
    if (!def) return false;
    if (!this.owned.has(id)) {
      this.owned.set(id, { def, loaded: def.mag });
      this.addAmmo(def.category, def.reserveStart);
    }
    if (extraAmmo) this.addAmmo(def.category, extraAmmo);
    return true;
  }

  addAmmo(category, n) {
    const max = AMMO_TYPES[category]?.max ?? 999;
    this.reserve[category] = Math.min(max, (this.reserve[category] || 0) + n);
  }

  /** Lista ordenada por slot (para a seleção rápida). */
  list() {
    return [...this.owned.values()].sort((a, b) => a.def.slot - b.def.slot || this.defs.indexOf(a.def) - this.defs.indexOf(b.def));
  }

  get(id) {
    return this.owned.get(id) || null;
  }

  /** Armas de um slot (o 8 tem duas carabinas: alterna entre elas). */
  bySlot(slot) {
    return this.list().filter((e) => e.def.slot === slot);
  }

  /** Próxima/anterior na ordem do inventário. */
  cycle(fromId, dir) {
    const l = this.list();
    if (!l.length) return null;
    const i = l.findIndex((e) => e.def.id === fromId);
    const n = (i < 0 ? (dir > 0 ? 0 : l.length - 1) : (i + dir + l.length) % l.length);
    return l[n].def.id;
  }
}
