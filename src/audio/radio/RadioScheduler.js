import { STATIONS, STATION_BY_ID, ADS, NEWS, LEADS, TALKS } from './RadioStations.js';

/**
 * Relógio e programação contínua do NEON RADIO NETWORK.
 *
 * RELÓGIO: tempo de rádio em segundos = origem persistida + tempo REAL monotônico da sessão
 * (performance.now). Não usa o relógio acelerado do dia/noite (uma música de 3 min dura 3 min).
 * Continua contando com o menu aberto e com a aba em segundo plano (como uma rádio real).
 * Ao carregar um save, a origem volta ao valor salvo: a programação retoma de onde estava.
 *
 * PROGRAMAÇÃO: cada emissora tem um estado (segmento atual, plano, memória, contadores, semente).
 * Nenhum áudio é tocado para avançar: o estado é recalculado virtualmente quando consultado
 * (advance), então oito emissoras "no ar" custam só alguns cálculos.
 *
 * IA DOS LOCUTORES (determinística, local): máquina de estados por emissora que decide
 * música → fala do DJ / vinheta → música → intervalo (chamada + comerciais + vinheta) ...,
 * com memória das últimas faixas, falas, comerciais e notícias (sem repetições próximas)
 * e uma fila de conteúdos disparados por eventos do jogo (notícias, reações).
 */
const MEM = { track: 3, voice: 12, ad: 5, jingle: 2, news: 8, talk: 4 };

function rand(st) {
  let a = st.seed | 0;
  a = (a + 0x6d2b79f5) | 0;
  st.seed = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export class RadioScheduler {
  constructor({ now = () => performance.now() } = {}) {
    this._now = now;
    this.origin = 0;
    this.t0 = this._now();
    this.states = new Map();
    this.context = { timeOfDay: 'sunset' };
    this.log = [];
    this.logCap = 400; // histórico recente (depuração/testes)
    this.newsMem = [];
    this.reset(12345);
  }

  /** Tempo de rádio atual (s). */
  now() { return this.origin + (this._now() - this.t0) / 1000; }
  setClock(t) { this.origin = t; this.t0 = this._now(); }

  /** Nova partida: origem arbitrária; cada emissora começa em um ponto diferente da programação. */
  reset(seed = Math.floor(Math.random() * 1e9)) {
    this.setClock(3600 + (seed % 7200));
    this.states.clear();
    this.log.length = 0;
    this.newsMem.length = 0;
    const now = this.now();
    STATIONS.forEach((S, i) => {
      const st = { id: S.id, seed: (seed + i * 7919) | 0, seg: null, next: null, plan: [], pending: [], mem: { track: [], voice: [], ad: [], jingle: [], news: [], talk: [] }, c: { sinceAds: 0, adsTarget: 2, blk: 0 } };
      st.c.adsTarget = this._int(st, S.rules.adsEvery[0], S.rules.adsEvery[1]);
      const first = S.talkFormat ? this._talk(st) : this._track(st, false);
      first.start = now - rand(st) * first.dur * 0.9;
      st.seg = first;
      this.states.set(S.id, st);
    });
  }

  _int(st, a, b) { return a + Math.floor(rand(st) * (b - a + 1)); }

  /** Escolhe sem repetir os itens recentes (memória por tipo). */
  _pick(st, kind, list, key = (e) => e.id, mem = st.mem[kind]) {
    if (!list.length) return null;
    const fresh = list.filter((e) => !mem.includes(key(e)));
    const pool = fresh.length ? fresh : [list.reduce((a, b) => (mem.indexOf(key(a)) < mem.indexOf(key(b)) ? a : b))];
    const it = pool[Math.floor(rand(st) * pool.length)];
    mem.push(key(it));
    const cap = Math.min(MEM[kind] ?? 6, Math.max(1, list.length - 1));
    while (mem.length > cap) mem.shift();
    return it;
  }

  _seg(k, e, extra = {}) { return { k, id: e.id, file: e.file, dur: e.duration, start: 0, ...extra }; }

  _track(st, allowOverlay = true) {
    const S = STATION_BY_ID.get(st.id);
    const tr = this._pick(st, 'track', S.tracks);
    if (!tr) return this._talk(st);
    const seg = this._seg('track', tr, { title: tr.title, artist: tr.artist });
    if (allowOverlay && rand(st) < S.rules.overlay) {
      // Locução por cima da introdução: a apresentação específica da faixa ou uma abertura.
      const intro = S.voice.find((v) => v.kind === 'intro' && v.track === tr.id);
      const v = intro && rand(st) < 0.7 ? intro : this._pick(st, 'voice', S.voice.filter((x) => x.kind === 'open'));
      if (v && v.duration < tr.duration * 0.4) seg.overlay = { id: v.id, file: v.file, dur: v.duration, at: 0.8, text: v.text };
    }
    return seg;
  }

  _voice(st, kinds) {
    const S = STATION_BY_ID.get(st.id);
    const v = this._pick(st, 'voice', S.voice.filter((x) => kinds.includes(x.kind)));
    return v ? this._seg('voice', v, { text: v.text, kind: v.kind }) : null;
  }

  _jingle(st) {
    const S = STATION_BY_ID.get(st.id);
    const j = this._pick(st, 'jingle', S.jingles);
    return j ? this._seg('jingle', j, { text: j.text }) : null;
  }

  _ad(st) { const a = this._pick(st, 'ad', ADS); return a ? this._seg('ad', a, { text: a.text, business: a.business }) : null; }

  _news(st, kind = null) {
    let pool = kind ? NEWS.filter((n) => n.kind === kind) : NEWS.filter((n) => n.kind === 'ambient' || n.kind === this.context.timeOfDay);
    if (!pool.length) pool = NEWS.filter((n) => n.kind === 'ambient');
    const n = this._pick(st, 'news', pool, (e) => e.id, this.newsMem);
    return n ? this._seg('news', n, { text: n.text, kind: n.kind }) : null;
  }

  _talk(st) { const t = this._pick(st, 'talk', TALKS); return t ? this._seg('talk', t, { title: t.title }) : this._news(st); }

  _timeKind() {
    const t = this.context.timeOfDay;
    return ['morning', 'afternoon', 'sunset', 'night'].includes(t) ? t : 'afternoon';
  }

  /** Decide o próximo segmento (IA da programação). */
  _decide(st, t) {
    const S = STATION_BY_ID.get(st.id);
    // 1) Plano em andamento (intervalo comercial, bloco de notícias).
    if (st.plan.length) return st.plan.shift();
    // 2) Conteúdo disparado por evento (notícia / reação), respeitando o atraso editorial.
    const pi = st.pending.findIndex((p) => p.readyAt <= t);
    const lastK = st.seg?.k;
    if (pi >= 0 && (S.talkFormat || lastK === 'track' || lastK === 'jingle' || lastK === 'ad')) {
      const p = st.pending.splice(pi, 1)[0];
      if (p.type === 'news') {
        const lead = this._pick(st, 'voice', LEADS, (e) => e.id, st.mem.voice);
        const news = this._news(st, p.kind);
        if (news) { news.event = p.kind; news.eventAt = p.at; }
        const plan = [lead && this._seg('lead', lead, { text: lead.text }), news].filter(Boolean);
        if (plan.length) { st.plan.push(...plan.slice(1)); return plan[0]; }
      } else if (p.type === 'react') {
        const v = this._voice(st, [p.kind]);
        if (v) { v.event = p.event; return v; }
      }
    }
    // 3) Formato de conversa (CITY TALK): blocos de notícia, programas, comentários e comerciais.
    if (S.talkFormat) {
      const blk = ['jingle', 'open', 'news', 'news', 'talk', 'comment', 'ads', 'news', 'talk', 'time', 'ads'][st.c.blk++ % 11];
      if (blk === 'jingle') return this._jingle(st) || this._news(st);
      if (blk === 'open') return this._voice(st, ['open']) || this._news(st);
      if (blk === 'news') return this._news(st);
      if (blk === 'talk') return this._talk(st);
      if (blk === 'comment') return this._voice(st, ['comment']) || this._news(st);
      if (blk === 'time') return this._voice(st, [this._timeKind()]) || this._news(st);
      const call = this._voice(st, ['toAds']);
      const n = this._int(st, 1, 2);
      for (let i = 0; i < n; i++) { const a = this._ad(st); if (a) st.plan.push(a); }
      return call || st.plan.shift() || this._news(st);
    }
    // 4) Emissoras musicais.
    if (lastK === 'track') {
      st.c.sinceAds++;
      if (st.c.sinceAds >= st.c.adsTarget) {
        st.c.sinceAds = 0;
        st.c.adsTarget = this._int(st, S.rules.adsEvery[0], S.rules.adsEvery[1]);
        const call = this._voice(st, ['toAds']);
        const n = this._int(st, 1, 2);
        for (let i = 0; i < n; i++) { const a = this._ad(st); if (a) st.plan.push(a); }
        const j = this._jingle(st); if (j) st.plan.push(j);
        return call || st.plan.shift();
      }
      const r = rand(st);
      if (r < S.rules.talk) {
        const kinds = rand(st) < 0.25 ? [this._timeKind()] : rand(st) < 0.5 ? ['back'] : ['comment'];
        const v = this._voice(st, kinds) || this._voice(st, ['comment']);
        if (v) return v;
      } else if (r < S.rules.talk + S.rules.jingle * (1 - S.rules.talk)) {
        const j = this._jingle(st);
        if (j) return j;
      }
    }
    return this._track(st, lastK !== 'voice');
  }

  _advance(st, t) {
    let guard = 0;
    while (t >= st.seg.start + st.seg.dur && guard < 800) {
      const end = st.seg.start + st.seg.dur;
      const nx = st.next || this._decide(st, end) || (STATION_BY_ID.get(st.id).talkFormat ? this._news(st) : this._track(st, false));
      st.next = null;
      nx.start = end;
      st.seg = nx;
      this._log(st, nx);
      guard++;
    }
    if (guard >= 800) st.seg.start = t - Math.min(st.seg.dur * 0.5, 5); // ausência muito longa: ressincroniza
  }

  _log(st, seg) {
    this.log.push({ station: st.id, k: seg.k, id: seg.id, start: +seg.start.toFixed(2), dur: seg.dur, event: seg.event || null });
    if (this.log.length > this.logCap) this.log.splice(0, this.log.length - this.logCap);
  }

  /** Segmento no ar agora numa emissora (com deslocamento calculado pelo chamador). */
  current(id) {
    const st = this.states.get(id);
    if (!st) return null;
    this._advance(st, this.now());
    return st.seg;
  }

  /** Próximo segmento (decidido antecipadamente para pré-carregar o arquivo). */
  upcoming(id) {
    const st = this.states.get(id);
    if (!st) return null;
    this._advance(st, this.now());
    if (!st.next) st.next = this._decide(st, st.seg.start + st.seg.dur);
    return { ...st.next, start: st.seg.start + st.seg.dur };
  }

  /** Conteúdo disparado por evento (notícia/reação) para uma emissora. */
  enqueue(id, item) {
    const st = this.states.get(id);
    if (!st) return false;
    if (st.pending.some((p) => p.type === item.type && p.kind === item.kind)) return false; // não empilha a mesma notícia
    st.pending.push(item);
    if (st.pending.length > 4) st.pending.shift();
    return true;
  }

  // ---------------------------------------------------------------- persistência
  serialize() {
    const now = this.now();
    return {
      clock: +now.toFixed(3),
      newsMem: [...this.newsMem],
      stations: [...this.states.values()].map((st) => ({ id: st.id, seed: st.seed, seg: st.seg, next: st.next, plan: st.plan, pending: st.pending, mem: st.mem, c: st.c })),
    };
  }

  deserialize(data) {
    if (!data || typeof data.clock !== 'number') return false;
    const files = new Set([...STATIONS.flatMap((s) => [...s.tracks, ...s.voice, ...s.jingles]), ...ADS, ...NEWS, ...LEADS, ...TALKS].map((e) => e.file));
    const okSeg = (s) => s && files.has(s.file) && Number.isFinite(s.start) && s.dur > 0;
    this.setClock(data.clock);
    this.newsMem = Array.isArray(data.newsMem) ? data.newsMem.slice(-MEM.news) : [];
    for (const saved of data.stations || []) {
      const st = this.states.get(saved.id);
      if (!st || !okSeg(saved.seg)) continue; // emissora nova ou arquivo removido: mantém o estado atual
      Object.assign(st, {
        seed: saved.seed | 0, seg: saved.seg, next: okSeg(saved.next) ? saved.next : null,
        plan: (saved.plan || []).filter(okSeg), pending: (saved.pending || []).slice(0, 4),
        mem: { ...st.mem, ...(saved.mem || {}) }, c: { ...st.c, ...(saved.c || {}) },
      });
    }
    return true;
  }
}
