/**
 * Persistência mínima dos estabelecimentos (não havia sistema de salvamento):
 * compras realizadas, itens duráveis adquiridos e locais visitados.
 * O saldo continua sendo do PlayerStatus (não persistido aqui) e nenhuma
 * recompensa é concedida ao recarregar — o registro só lembra o que já foi
 * comprado. Compatível com expansões futuras (campo version).
 */
const KEY = 'neoncity.save.interiors';

export class InteriorPersistence {
  constructor() {
    this.data = { version: 1, purchases: [], owned: {}, visited: [] };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.version === 1) this.data = { ...this.data, ...d };
      }
    } catch { /* armazenamento indisponível: segue só em memória */ }
  }

  _save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignorado */ }
  }

  recordPurchase(placeId, itemId, price, durable) {
    this.data.purchases.push({ place: placeId, item: itemId, price, t: Date.now() });
    if (this.data.purchases.length > 200) this.data.purchases.shift();
    if (durable) this.data.owned[itemId] = (this.data.owned[itemId] || 0) + 1;
    this._save();
  }

  owns(itemId) {
    return this.data.owned[itemId] || 0;
  }

  visit(placeId) {
    if (this.data.visited.includes(placeId)) return;
    this.data.visited.push(placeId);
    this._save();
  }

  /** Substitui o registro (carregar partida) — dados já validados como objeto simples. */
  replace(d) {
    if (!d || d.version !== 1) return false;
    this.data = {
      version: 1,
      purchases: Array.isArray(d.purchases) ? d.purchases.slice(-200) : [],
      owned: Object.fromEntries(Object.entries(d.owned || {}).filter(([, n]) => Number.isSafeInteger(n) && n > 0)),
      visited: Array.isArray(d.visited) ? d.visited.filter((x) => typeof x === 'string') : [],
    };
    this._save();
    return true;
  }

  /** Nova partida (o registro antigo é preservado pelo SaveManager antes). */
  reset() {
    this.data = { version: 1, purchases: [], owned: {}, visited: [] };
    this._save();
  }

  summary() {
    return { purchases: this.data.purchases.length, owned: { ...this.data.owned }, visited: [...this.data.visited] };
  }
}
