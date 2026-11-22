import { STATIONS } from './RadioStations.js';

/**
 * Ponte de eventos → rádio. CONSOME eventos publicados pelos sistemas existentes
 * (polícia, armas, pedestres, destruição, barcos, dia e noite) e transforma em:
 *  - notícias na CITY TALK, com atraso editorial e sem revelar a posição do jogador;
 *  - reações curtas dos DJs das emissoras musicais.
 * Nunca controla a polícia nem outro sistema: só escuta.
 */
const DELAY = { chase: 40, escape: 25, arrest: 25, gunshot: 30, accident: 30, vandalism: 45, sea: 60, night: 15, morning: 15 };
const COOLDOWN = { chase: 300, escape: 240, arrest: 240, gunshot: 240, accident: 240, vandalism: 300, sea: 600, night: 900, morning: 900 };
const REACT = { chase: 'police', escape: 'police', gunshot: 'police', sea: 'sea' };

export class RadioNews {
  constructor(game, scheduler) {
    this.game = game;
    this.sched = scheduler;
    this.last = {};            // tipo → tempo de rádio da última publicação
    this.reports = [];         // histórico (relatório/testes)
    this._wantedT = 0;
    this._chasing = false;
    this._breaks = [];
    this._tod = null;
    this._aboard = false;
    this.stats = { received: 0, published: 0, skipped: 0 };
  }

  attach(events) {
    if (!events || this._attached) return;
    this._attached = true;
    events.on('policeEscape', () => this.report('escape'));
    events.on('policeRespawn', (e) => { if (e?.outcome === 'busted') this.report('arrest'); });
    events.on('gunshot', (e) => { if (e?.source !== 'police') this.report('gunshot'); });
    events.on('pedHit', () => this.report('accident'));
    events.on('propBreak', () => {
      const t = this.sched.now();
      this._breaks = this._breaks.filter((x) => t - x < 60);
      this._breaks.push(t);
      if (this._breaks.length >= 5) { this._breaks.length = 0; this.report('vandalism'); }
    });
  }

  /** Acompanhamento contínuo: perseguição (nível de procurado sustentado), mar, dia/noite. */
  update(dt) {
    const g = this.game;
    const wanted = g.player?.status?.wanted || 0;
    if (wanted >= 2) {
      this._wantedT += dt;
      if (!this._chasing && this._wantedT >= 15) { this._chasing = true; this.report('chase', { level: wanted }); }
    } else if (wanted === 0) { this._wantedT = 0; this._chasing = false; }
    const aboard = !!g.boats?.aboard;
    if (aboard && !this._aboard) this.report('sea');
    this._aboard = aboard;
    const tod = g.world?.timeOfDay;
    if (this._tod && tod !== this._tod) { if (tod === 'night') this.report('night'); else if (tod === 'morning') this.report('morning'); }
    this._tod = tod;
  }

  /** Registra um acontecimento e agenda notícia/reações (com atraso e intervalo mínimo). */
  report(kind, data = {}) {
    this.stats.received++;
    const t = this.sched.now();
    if (this.last[kind] !== undefined && t - this.last[kind] < (COOLDOWN[kind] ?? 240)) { this.stats.skipped++; return false; }
    this.last[kind] = t;
    const readyAt = t + (DELAY[kind] ?? 30);
    const queued = this.sched.enqueue('city_talk', { type: 'news', kind, at: t, readyAt });
    if (REACT[kind]) {
      for (const S of STATIONS) {
        if (S.talkFormat || !S.voice.some((v) => v.kind === REACT[kind])) continue;
        // Nem todo DJ comenta tudo: decisão determinística por emissora e tipo.
        const h = [...(S.id + kind)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
        if (Math.abs(h) % 10 < 6) this.sched.enqueue(S.id, { type: 'react', kind: REACT[kind], event: kind, at: t, readyAt: t + 8 });
      }
    }
    this.reports.push({ kind, at: +t.toFixed(1), readyAt: +readyAt.toFixed(1), queued, data });
    if (this.reports.length > 50) this.reports.shift();
    if (queued) this.stats.published++;
    return queued;
  }
}
