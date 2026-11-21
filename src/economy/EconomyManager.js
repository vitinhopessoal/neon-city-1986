import { ECONOMY, REWARD_SOURCES } from './PriceDefinitions.js';

/**
 * Carteira centralizada. O saldo continua armazenado em PlayerStatus.money
 * (o HUD e os testes existentes leem dali), mas TODA alteração de dinheiro
 * do jogo passa por aqui: validação de inteiros, saldo nunca negativo,
 * deduplicação por identificador de transação e histórico.
 *
 *   balance()                       → saldo
 *   canAfford(n)
 *   spend(n, reason, { txId })      → { ok, msg, tx }
 *   earn(n, reason, { source, txId })
 *   reward(source, n, reason, txId) → interface para missões/entregas futuras
 *
 * txId: chamadas repetidas com o mesmo id (clique duplo, evento duplicado)
 * devolvem o resultado da primeira sem cobrar/pagar de novo.
 */
export class EconomyManager {
  constructor(status) {
    this.status = status;
    this.history = [];
    this._done = new Map(); // txId -> resultado
    this._seq = 0;
    this.listeners = new Set();
  }

  balance() {
    return this.status.money;
  }

  canAfford(amount) {
    return Number.isSafeInteger(amount) && amount >= 0 && amount <= this.status.money;
  }

  _record(type, amount, reason, extra = {}) {
    const tx = { id: extra.txId || `tx${Date.now().toString(36)}_${++this._seq}`, type, amount, reason: String(reason || ''), balance: this.status.money, t: Date.now(), ...extra.meta };
    this.history.push(tx);
    if (this.history.length > ECONOMY.historySize) this.history.shift();
    for (const fn of this.listeners) { try { fn(tx); } catch { /* ouvinte não interrompe a transação */ } }
    return tx;
  }

  _valid(amount) {
    return Number.isSafeInteger(amount) && amount >= 0;
  }

  spend(amount, reason, { txId } = {}) {
    if (txId && this._done.has(txId)) return { ...this._done.get(txId), duplicate: true };
    if (!this._valid(amount)) return { ok: false, msg: 'Valor inválido.' };
    if (amount > this.status.money) return { ok: false, msg: `Saldo insuficiente: custa $${amount.toLocaleString('pt-BR')}, você tem $${this.status.money.toLocaleString('pt-BR')}.`, insufficient: true };
    // PlayerStatus.spendMoney é a única escrita (mantém a mesma validação usada pelo HUD).
    if (!this.status.spendMoney(amount)) return { ok: false, msg: 'Transação recusada.' };
    const res = { ok: true, msg: 'OK', tx: this._record('spend', amount, reason, { txId }) };
    if (txId) this._done.set(txId, res);
    return res;
  }

  earn(amount, reason, { source = 'event', txId } = {}) {
    if (txId && this._done.has(txId)) return { ...this._done.get(txId), duplicate: true };
    if (!this._valid(amount)) return { ok: false, msg: 'Valor inválido.' };
    const before = this.status.money;
    this.status.addMoney(Math.min(amount, ECONOMY.maxMoney - before));
    const res = { ok: true, msg: 'OK', tx: this._record('earn', this.status.money - before, reason, { txId, meta: { source } }) };
    if (txId) this._done.set(txId, res);
    return res;
  }

  /** Recompensa de atividades (missões, entregas, corridas...). */
  reward(source, amount, reason, txId) {
    if (!REWARD_SOURCES.includes(source)) return { ok: false, msg: `Origem de recompensa desconhecida: ${source}` };
    return this.earn(amount, reason || source, { source, txId });
  }

  /** Somente para nova partida / carregamento (não é uma transação de jogo). */
  _setBalance(amount) {
    if (!this._valid(amount)) return false;
    this.status.money = Math.min(amount, ECONOMY.maxMoney);
    return true;
  }

  serialize() {
    return { money: this.status.money, history: this.history.slice(-ECONOMY.historySize), seq: this._seq };
  }

  deserialize(d) {
    this._setBalance(d.money);
    this.history = Array.isArray(d.history) ? d.history.filter((t) => t && typeof t.type === 'string' && Number.isSafeInteger(t.amount)).slice(-ECONOMY.historySize) : [];
    this._seq = Number.isSafeInteger(d.seq) ? d.seq : 0;
    this._done.clear();
  }

  newGame() {
    this._setBalance(ECONOMY.startingMoney);
    this.history = [];
    this._done.clear();
    this._record('start', ECONOMY.startingMoney, 'Saldo inicial da partida');
  }
}
