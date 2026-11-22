/**
 * Reprodução do rádio (um único "receptor" ativo por vez).
 *  - Arquivos longos tocam por HTMLAudioElement ligado ao Web Audio (streaming: nada de
 *    decodificar músicas inteiras na memória). Três tocadores fixos: A e B alternam os
 *    segmentos (o próximo é pré-carregado alguns segundos antes) e V toca a locução por cima.
 *  - A posição vem do agendador: ao sintonizar, toca o segmento atual a partir do ponto exato.
 *  - Troca suave (rampas de ganho), sem duas emissoras ao mesmo tempo e sem estalos.
 *  - Saídas: direta (dentro do carro/barco), espacial (PannerNode no veículo, com atenuação
 *    e abafamento) e interior (loja/casa: mais baixo e abafado).
 *  - Falhas de arquivo não travam o jogo: o segmento fica em silêncio e a programação segue.
 */
const FADE_IN = 0.12, FADE_OUT = 0.25;

export class RadioPlayback {
  constructor(audioManager, baseUrl = '/') {
    this.am = audioManager;
    this.base = baseUrl;
    this.players = null;
    this.mode = 'off';
    this.failed = new Set();
    this.stats = { starts: 0, seeks: 0, switches: 0, errors: 0, preloads: 0 };
    this.onEnded = null;
    this._duck = 1;
  }

  get ready() { return !!this.players; }

  _graph() {
    if (this.players) return true;
    const ctx = this.am.ctx;
    if (!ctx || !this.am.bus?.radio) return false;
    const mk = (name) => {
      const el = new Audio();
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.station);
      const p = { name, el, gain, key: null, seg: null, kind: null };
      el.addEventListener('ended', () => { p.ended = true; this.onEnded?.(); });
      el.addEventListener('error', () => { if (p.key) { this.failed.add(el.dataset.file); this.stats.errors++; console.warn('[RADIO] arquivo indisponível:', el.dataset.file); } });
      return p;
    };
    this.station = ctx.createGain();
    this.station.gain.value = 1;
    // Saída direta (alto-falante do carro: corta graves extremos, realça presença).
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 55;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2600; pk.Q.value = 0.8; pk.gain.value = 2;
    this.direct = ctx.createGain(); this.direct.gain.value = 0;
    this.station.connect(hp).connect(pk).connect(this.direct).connect(this.am.bus.radio);
    // Saída espacial (rádio de um carro estacionado/NPC ouvido de fora).
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 2400;
    this.panner = ctx.createPanner();
    Object.assign(this.panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 2.5, maxDistance: 40, rolloffFactor: 1.4 });
    this.spatial = ctx.createGain(); this.spatial.gain.value = 0;
    this.station.connect(this.muffle).connect(this.panner).connect(this.spatial).connect(this.am.bus.radio);
    // Saída de interior (rádio da loja/casa).
    this.roomLp = ctx.createBiquadFilter(); this.roomLp.type = 'lowpass'; this.roomLp.frequency.value = 5200;
    this.room = ctx.createGain(); this.room.gain.value = 0;
    this.station.connect(this.roomLp).connect(this.room).connect(this.am.bus.radio);
    this.players = { A: mk('A'), B: mk('B'), V: mk('V') };
    this.main = this.players.A;
    return true;
  }

  _ramp(param, v, tau = 0.06) {
    const t = this.am.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(v, t, tau);
  }

  /** Nível do conteúdo conforme o tipo (canais Música / Vozes). */
  _level(kind) {
    const L = this.am.levels || {};
    return ['track', 'jingle'].includes(kind) ? (L.music ?? 1) : (L.voice ?? 1);
  }

  setOutput(mode, pos = null) {
    if (!this._graph()) return;
    if (mode !== this.mode) {
      this.mode = mode;
      this._ramp(this.direct.gain, mode === 'direct' ? 0.62 : 0, 0.08);
      this._ramp(this.spatial.gain, mode === 'spatial' ? 1.0 : 0, 0.08);
      this._ramp(this.room.gain, mode === 'interior' ? 0.42 : 0, 0.08);
    }
    if (mode === 'spatial' && pos) {
      const t = this.am.ctx.currentTime;
      const P = this.panner;
      if (P.positionX) { P.positionX.setTargetAtTime(pos.x, t, 0.05); P.positionY.setTargetAtTime(pos.y + 0.8, t, 0.05); P.positionZ.setTargetAtTime(pos.z, t, 0.05); }
      else P.setPosition(pos.x, pos.y + 0.8, pos.z);
    }
  }

  /** Posição do ouvinte = câmera (só afeta a saída espacial). */
  setListener(cam) {
    const ctx = this.am.ctx;
    if (!ctx || !this.players) return;
    const L = ctx.listener;
    const p = cam.position;
    const f = cam.getWorldDirection(this._f || (this._f = cam.position.clone()));
    const t = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.03); L.positionY.setTargetAtTime(p.y, t, 0.03); L.positionZ.setTargetAtTime(p.z, t, 0.03);
      L.forwardX.setTargetAtTime(f.x, t, 0.03); L.forwardY.setTargetAtTime(f.y, t, 0.03); L.forwardZ.setTargetAtTime(f.z, t, 0.03);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }

  /** Abaixa o rádio (ex.: sirene próxima) sem silenciar. */
  setDuck(k) {
    if (!this.players || Math.abs(k - this._duck) < 0.02) return;
    this._duck = k;
    this._ramp(this.station.gain, k, 0.2);
  }

  _url(file) { return this.base + file; }

  _load(p, seg) {
    if (p.el.dataset.file === seg.file) return;
    p.el.dataset.file = seg.file;
    p.ended = false;
    p.el.src = this._url(seg.file);
    p.el.load();
  }

  _start(p, key, seg, offset, kind) {
    p.key = key; p.seg = seg; p.kind = kind; p.ended = false;
    this._load(p, seg);
    const go = () => {
      if (p.key !== key) return;
      const want = Math.max(0, Math.min(offset(), (p.el.duration || seg.dur) - 0.05));
      if (Math.abs(p.el.currentTime - want) > 0.08) p.el.currentTime = want;
      p.el.play().catch(() => {});
      this._ramp(p.gain.gain, this._level(kind) * (p === this.players.V ? 1.15 : 1), FADE_IN / 3);
    };
    if (p.el.readyState >= 1) go(); else p.el.addEventListener('loadedmetadata', go, { once: true });
    this.stats.starts++;
  }

  _stop(p) {
    if (!p.key) return;
    p.key = null; p.seg = null;
    this._ramp(p.gain.gain, 0, FADE_OUT / 3);
    const el = p.el;
    setTimeout(() => { if (!p.key) el.pause(); }, FADE_OUT * 1000 + 60);
  }

  /** Para tudo (rádio desligado, saiu de perto, título...). A programação continua virtualmente. */
  stop() {
    if (!this.players) return;
    for (const p of Object.values(this.players)) this._stop(p);
    this.current = null;
  }

  /**
   * Mantém o receptor na emissora `station`, no segmento `seg` (do agendador).
   * now(): tempo de rádio atual; next: próximo segmento (pré-carregamento).
   */
  sync(station, seg, next, now) {
    if (!seg || !this._graph()) return;
    const key = `${station}|${seg.start.toFixed(3)}|${seg.id}`;
    const P = this.players;
    if (this.current?.station !== station) this.stats.switches += this.current ? 1 : 0;
    if (P.A.key !== key && P.B.key !== key) {
      const old = this.main;
      const fresh = old === P.A ? P.B : P.A;
      this._stop(old);
      if (!this.failed.has(seg.file)) this._start(fresh, key, seg, () => now() - seg.start, seg.k);
      this.main = fresh;
      this._stop(P.V);
    } else if (this.main.key !== key) this.main = P.A.key === key ? P.A : P.B;
    this.current = { station, seg, key };
    const m = this.main;
    // Correção de deriva (aba em segundo plano, travadas): só se passar de 1 s.
    if (m.el.readyState >= 1 && !m.el.paused && !m.ended) {
      const want = now() - seg.start;
      if (want < (m.el.duration || seg.dur) - 0.3 && Math.abs(m.el.currentTime - want) > 1.0) { m.el.currentTime = Math.max(0, want); this.stats.seeks++; }
    }
    // Pré-carrega o próximo segmento no tocador livre (troca quase sem lacuna).
    const idle = m === P.A ? P.B : P.A;
    if (next && !idle.key && seg.start + seg.dur - now() < 6 && idle.el.dataset.file !== next.file && !this.failed.has(next.file)) { this._load(idle, next); this.stats.preloads++; }
    // Locução por cima da introdução, com o volume da música abaixado.
    const ov = seg.overlay;
    const rel = now() - seg.start;
    const inOv = ov && rel >= ov.at && rel < ov.at + ov.dur - 0.05;
    if (inOv) {
      const vkey = `${key}|ov`;
      if (P.V.key !== vkey && !this.failed.has(ov.file)) this._start(P.V, vkey, ov, () => now() - seg.start - ov.at, 'voice');
      this._ramp(m.gain.gain, this._level(m.kind) * 0.42, 0.08);
    } else if (P.V.key) {
      this._stop(P.V);
      this._ramp(m.gain.gain, this._level(m.kind), 0.25);
    }
  }

  /** Reaplica os níveis (mudança nas Configurações). */
  refreshLevels() {
    if (!this.players) return;
    for (const p of [this.players.A, this.players.B]) if (p.key) this._ramp(p.gain.gain, this._level(p.kind), 0.05);
  }

  debug() {
    if (!this.players) return { ready: false };
    const P = this.players;
    const d = (p) => ({ key: p.key, file: p.el.dataset.file || null, t: +p.el.currentTime.toFixed(2), paused: p.el.paused, ready: p.el.readyState, gain: +p.gain.gain.value.toFixed(3) });
    return { ready: true, mode: this.mode, A: d(P.A), B: d(P.B), V: d(P.V), main: this.main.name, failed: [...this.failed], stats: { ...this.stats } };
  }

  dispose() {
    if (!this.players) return;
    for (const p of Object.values(this.players)) { p.el.pause(); p.el.removeAttribute('src'); p.el.load(); }
    this.players = null;
  }
}
