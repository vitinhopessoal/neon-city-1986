/**
 * Barramento de eventos urbanos (sem dependências entre módulos): quem emite
 * não conhece quem reage. Tipos usados hoje:
 *   'gunshot'   { x, y, z, weapon }        — arsenal (disparo)
 *   'impact'    { x, y, z, material }      — arsenal (impacto)
 *   'horn'      { x, z, source }           — buzinas (jogador ou IA)
 *   'collision' { x, z, speed, vehicleId } — veículo atingiu algo/alguém
 *   'pedHit'    { x, z, id }               — pedestre atingido por veículo
 * Eventos recentes ficam numa janela curta para consultas por proximidade.
 */
export class UrbanEvents {
  constructor() {
    this.listeners = new Map();
    this.recent = [];
    this.time = 0;
    this.counts = {};
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  emit(type, data = {}) {
    const ev = { type, t: this.time, ...data };
    this.counts[type] = (this.counts[type] || 0) + 1;
    this.recent.push(ev);
    if (this.recent.length > 64) this.recent.shift();
    const set = this.listeners.get(type);
    if (set) for (const fn of set) fn(ev);
    return ev;
  }

  /** Eventos de um tipo nos últimos `sec` segundos dentro de `radius` metros. */
  near(type, x, z, radius, sec = 2) {
    const out = [];
    for (const e of this.recent) {
      if (e.type !== type || this.time - e.t > sec) continue;
      if (e.x === undefined || (e.x - x) ** 2 + (e.z - z) ** 2 <= radius * radius) out.push(e);
    }
    return out;
  }

  update(dt) {
    this.time += dt;
    while (this.recent.length && this.time - this.recent[0].t > 10) this.recent.shift();
  }
}
