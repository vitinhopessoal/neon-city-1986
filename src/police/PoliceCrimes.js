/**
 * Detecção de crimes (fonte única de entrada para o nível de procurado).
 * Cada tipo tem gravidade própria, janela de deduplicação por chave
 * (o mesmo evento — uma rajada, um atropelamento, um policial ferido —
 * conta uma vez) e exigência opcional de testemunha (pedestre ou policial
 * por perto). O resultado alimenta PlayerStatus.reportCrime, que continua
 * sendo o único estado de procurado lido pelo HUD.
 */
export const CRIME_TYPES = {
  // disparo em local público: 1 estrela se houver testemunha; a rajada inteira conta uma vez
  gunshot: { severity: 1, window: 4, witness: true, label: 'Disparo em local público' },
  // atropelamento: por vítima e veículo
  pedHit: { severity: 2.5, window: 3, witness: true, label: 'Atropelamento' },
  // destruição de propriedade (props quebrados pelo jogador)
  property: { severity: 0.75, window: 2, witness: true, label: 'Destruição de propriedade' },
  // ameaçar um policial com arma
  threatCop: { severity: 1, window: 6, witness: false, label: 'Ameaça a policial' },
  // ferir / matar policial
  attackCop: { severity: 3, window: 0.6, witness: false, label: 'Agressão a policial' },
  killCop: { severity: 5, window: 0.6, witness: false, label: 'Policial abatido' },
  // atirar em viatura / helicóptero
  shootPolice: { severity: 1.5, window: 1.5, witness: false, label: 'Ataque a viatura' },
  // roubar viatura
  stealPolice: { severity: 3, window: 30, witness: false, label: 'Roubo de viatura' },
  // genérico vindo de outros sistemas (evento "crime")
  generic: { severity: 1, window: 1, witness: true, label: 'Delito' },
};

export class PoliceCrimes {
  constructor() {
    this.recent = new Map(); // chave -> instante
    this.log = [];
    this.counts = { reported: 0, deduped: 0, unwitnessed: 0 };
  }

  /**
   * Decide se um crime deve ser registrado. Retorna a gravidade efetiva (0 = ignorado).
   * key: identifica o evento (ex.: 'gunshot', 'pedHit:veh:ped', 'attackCop:slot').
   */
  evaluate(type, key, now, { witnessed = true } = {}) {
    const def = CRIME_TYPES[type] || CRIME_TYPES.generic;
    const k = `${type}:${key ?? ''}`;
    const last = this.recent.get(k);
    if (last !== undefined && now - last < def.window) { this.counts.deduped++; return 0; }
    if (def.witness && !witnessed) { this.counts.unwitnessed++; return 0; }
    this.recent.set(k, now);
    if (this.recent.size > 64) for (const [kk, t] of this.recent) if (now - t > 60) this.recent.delete(kk);
    this.counts.reported++;
    this.log.push({ type, key: k, t: now, severity: def.severity });
    if (this.log.length > 30) this.log.shift();
    return def.severity;
  }

  reset() {
    this.recent.clear();
  }
}
