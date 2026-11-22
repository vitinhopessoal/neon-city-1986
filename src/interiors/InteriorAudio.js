/**
 * Áudio dos estabelecimentos, 100% procedural (Web Audio, sem gravações
 * nem músicas comerciais):
 * - música original gerada por sequenciador (estilos synth/disco/lounge e
 *   faixas de jukebox), com batida, baixo, acordes e arpejos;
 * - ambiências por tipo: conversas, cozinha e louça, geladeiras, caixa,
 *   ferramentas e compressor, público;
 * - lá fora, perto da entrada, o som chega abafado (passa-baixas) e cai com
 *   a distância; abrir a porta faz a transição para o som cheio.
 */
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
export const TRACKS = {
  club: { bpm: 112, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], bass: [45, 45, 57, 45, 41, 41, 53, 41], style: 'club', label: 'Neon Paradise (original)' },
  disco: { bpm: 122, chords: [[53, 57, 60], [50, 53, 57], [55, 58, 62], [48, 52, 55]], bass: [41, 53, 41, 53, 38, 50, 38, 50], style: 'disco', label: 'Electric Fever (original)' },
  lounge: { bpm: 84, chords: [[60, 64, 67, 71], [57, 60, 64, 67], [62, 65, 69, 72], [55, 59, 62, 65]], bass: [48, 0, 45, 0, 50, 0, 43, 0], style: 'lounge', label: 'Azure Lobby (original)' },
  sunrise: { bpm: 118, chords: [[55, 59, 62], [52, 55, 59], [48, 52, 55], [50, 54, 57]], bass: [43, 43, 55, 43, 40, 40, 52, 40], style: 'disco', label: 'Sunrise Boulevard' },
  pastel: { bpm: 92, chords: [[62, 65, 69], [58, 62, 65], [60, 64, 67], [57, 60, 64]], bass: [50, 0, 46, 0, 48, 0, 45, 0], style: 'lounge', label: 'Pastel Nights' },
  turbo: { bpm: 128, chords: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 55, 59]], bass: [45, 57, 45, 57, 43, 55, 41, 53], style: 'club', label: 'Turbo Coast' },
};

export class InteriorAudio {
  constructor(audioManager) {
    this.am = audioManager;
    this.track = null;
    this.ambience = null;
    this.nextStep = 0;
    this.step = 0;
    this.level = 0;
    this.played = 0;
    this._amb = [];
    this._ambT = 0;
  }

  get ready() {
    return !!(this.am?.started && this.am.ctx);
  }

  _graph() {
    if (this.bus) return;
    const ctx = this.am.ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.bus.connect(this.filter).connect(this.am.bus?.music || this.am.master);
  }

  /**
   * target: { track, ambience } do estabelecimento ativo ou próximo;
   * inside: dentro; dist: distância até a porta (fora).
   */
  update(dt, target, inside, dist) {
    if (!this.ready) return;
    this._graph();
    const ctx = this.am.ctx;
    const now = ctx.currentTime;
    let gain = 0, cutoff = 18000;
    if (target) {
      if (inside) { gain = 0.9; cutoff = 18000; }
      else if (dist < 40) { gain = 0.55 * Math.max(0, 1 - dist / 40); cutoff = 260 + 500 * Math.max(0, 1 - dist / 12); }
    }
    this.level = gain;
    // Automação só quando o alvo muda de fato: agendar a cada quadro acumula
    // eventos no AudioParam (custo crescente, sobretudo com o contexto suspenso).
    if (this._gT === undefined || Math.abs(gain - this._gT) > 0.01) {
      this._gT = gain;
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setTargetAtTime(gain, now, 0.15);
    }
    if (this._fT === undefined || Math.abs(cutoff - this._fT) > Math.max(20, this._fT * 0.04)) {
      this._fT = cutoff;
      this.filter.frequency.cancelScheduledValues(now);
      this.filter.frequency.setTargetAtTime(cutoff, now, 0.12);
    }
    const trackKey = target?.track || null;
    if (trackKey !== this.trackKey) { this.trackKey = trackKey; this.track = trackKey ? TRACKS[trackKey] : null; this.nextStep = now + 0.05; this.step = 0; }
    const amb = target && (inside || dist < 25) ? target.ambience : null;
    if (amb !== this.ambienceKey) this._setAmbience(amb);
    if (gain <= 0.001) return;
    // Sequenciador (semicolcheias), programado 0,25 s à frente.
    if (this.track) {
      const spb = 60 / this.track.bpm / 4;
      if (this.nextStep < now) this.nextStep = now + 0.02;
      while (this.nextStep < now + 0.25) { this._playStep(this.step, this.nextStep, spb); this.step++; this.nextStep += spb; }
    }
    // Eventos de ambiência (louça, caixa, ferramentas).
    this._ambT -= dt;
    if (amb && this._ambT <= 0) { this._ambT = 0.4 + Math.random() * 1.6; this._ambEvent(amb, now); }
  }

  // ---------------------------------------------------------- instrumentos
  _env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _osc(type, freq, t, a, peak, d, { detune = 0, filter = null, q = 1 } = {}) {
    const ctx = this.am.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    const g = ctx.createGain();
    this._env(g, t, a, peak, d);
    let n = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; f.Q.value = q; o.connect(f); n = f; }
    n.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + a + d + 0.05);
    this.played++;
  }

  _noise(t, type, freq, peak, d, q = 1) {
    const ctx = this.am.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.am.white;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, 0.002, peak, d);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t, Math.random() * 2, d + 0.05);
    this.played++;
  }

  _kick(t) {
    const ctx = this.am.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    this._env(g, t, 0.003, 0.55, 0.22);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.3);
  }

  _playStep(i, t, spb) {
    const T = this.track;
    const s16 = i % 16, bar = Math.floor(i / 16);
    const chord = T.chords[bar % T.chords.length];
    const style = T.style;
    if (style !== 'lounge') {
      if (s16 % 4 === 0) this._kick(t);
      if (s16 === 4 || s16 === 12) this._noise(t, 'bandpass', 1800, 0.22, 0.14, 0.8); // palma/caixa
      if (s16 % 4 === 2) this._noise(t, 'highpass', 7000, style === 'disco' ? 0.12 : 0.07, style === 'disco' ? 0.12 : 0.04);
      else if (s16 % 2 === 1) this._noise(t, 'highpass', 9000, 0.03, 0.03);
      // Baixo em colcheias.
      if (s16 % 2 === 0) {
        const n = T.bass[(s16 / 2) % T.bass.length];
        if (n) this._osc('sawtooth', NOTE(n), t, 0.005, 0.16, spb * 1.6, { filter: style === 'disco' ? 900 : 520, q: 4 });
      }
      // Acordes: pad (club) ou "cordas" em síncope (disco).
      if (style === 'club' && s16 === 0) for (const n of chord) for (const dt of [-8, 8]) this._osc('sawtooth', NOTE(n), t, 0.35, 0.025, spb * 15, { detune: dt, filter: 1600 });
      if (style === 'disco' && (s16 === 2 || s16 === 10)) for (const n of chord) this._osc('square', NOTE(n + 12), t, 0.01, 0.03, spb * 2.5, { filter: 2400 });
      // Arpejo.
      if (style === 'club' && s16 % 2 === 1) this._osc('triangle', NOTE(chord[(s16 >> 1) % chord.length] + 24), t, 0.003, 0.04, spb * 0.9);
    } else {
      // Lounge: piano elétrico e escovinha.
      if (s16 === 0 || s16 === 6 || s16 === 10) for (const n of chord) { this._osc('sine', NOTE(n), t, 0.004, 0.06, spb * 7); this._osc('triangle', NOTE(n + 12), t, 0.004, 0.012, spb * 3); }
      const n = T.bass[(s16 / 2) % T.bass.length];
      if (s16 % 2 === 0 && n) this._osc('sine', NOTE(n - 12), t, 0.01, 0.12, spb * 3);
      if (s16 % 4 === 2) this._noise(t, 'bandpass', 5000, 0.025, 0.09, 0.6);
    }
  }

  // ------------------------------------------------------------ ambiência
  _setAmbience(key) {
    this.ambienceKey = key;
    for (const n of this._amb) { try { n.stop(); } catch { /* já parado */ } }
    this._amb = [];
    if (!key || !this.ready) return;
    const ctx = this.am.ctx;
    // Murmúrio de conversas: ruído rosa em banda de voz com modulação lenta.
    const loop = (buffer, type, freq, q, gain) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.3 + Math.random() * 0.4;
      const lg = ctx.createGain(); lg.gain.value = gain * 0.5;
      lfo.connect(lg).connect(g.gain);
      s.connect(f).connect(g).connect(this.bus);
      s.start(0, Math.random() * 3);
      lfo.start();
      this._amb.push(s, lfo);
    };
    const hum = (freq, gain) => {
      const o = ctx.createOscillator(); o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = gain;
      o.connect(g).connect(this.bus); o.start();
      this._amb.push(o);
    };
    const crowd = { pizza: 0.05, diner: 0.05, bar: 0.05, club: 0.07, disco: 0.07, hotel: 0.02, market: 0.025, workshop: 0.015, clothes: 0.02, electronics: 0.02, test: 0.02, home: 0.005, villa: 0.004 }[key] ?? 0.03;
    loop(this.am.pink, 'bandpass', 650, 0.9, crowd);
    loop(this.am.pink, 'bandpass', 1300, 1.4, crowd * 0.5);
    if (key === 'market' || key === 'pizza' || key === 'diner') hum(120, 0.012);
    if (key === 'workshop') loop(this.am.brown, 'lowpass', 220, 0.8, 0.06);
    if (key === 'electronics') hum(15734 / 100, 0.004);
    // Residências: rumor distante da cidade/ar-condicionado (quase silêncio).
    if (key === 'home' || key === 'villa') loop(this.am.brown, 'lowpass', 260, 0.7, 0.025); // zumbido de TVs de tubo (estilizado)
  }

  _ambEvent(key, now) {
    const t = now + 0.02;
    const ping = (f, g = 0.04) => this._osc('sine', f, t, 0.002, g, 0.25);
    switch (key) {
      case 'pizza': case 'diner': ping(2400 + Math.random() * 1800, 0.03); if (Math.random() < 0.15) this._noise(t, 'bandpass', 900, 0.08, 0.4, 0.6); break;
      case 'market': if (Math.random() < 0.3) this._osc('square', 2100, t, 0.002, 0.04, 0.09); break;
      case 'workshop':
        if (Math.random() < 0.5) for (let k = 0; k < 6; k++) this._noise(t + k * 0.05, 'bandpass', 2400, 0.12, 0.04, 3);
        else ping(900 + Math.random() * 600, 0.07);
        break;
      case 'bar': case 'club': case 'disco': if (Math.random() < 0.4) ping(3200 + Math.random() * 900, 0.025); break;
      default: break;
    }
  }

  /** Efeitos pontuais (porta, caixa registradora, compra, geladeira). */
  sfx(kind) {
    if (!this.ready) return;
    this._graph();
    const ctx = this.am.ctx, t = ctx.currentTime + 0.01;
    const out = this.am.master;
    const one = (type, f, a, peak, d, f2 = null) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
      const g = ctx.createGain(); this._env(g, t, a, peak, d);
      o.connect(g).connect(out); o.start(t); o.stop(t + a + d + 0.05);
    };
    if (kind === 'door') { one('triangle', 180, 0.01, 0.12, 0.25, 120); one('sine', 1600, 0.002, 0.04, 0.4); }
    else if (kind === 'bell') { one('sine', 2093, 0.002, 0.08, 0.8); one('sine', 2637, 0.002, 0.05, 0.6); }
    else if (kind === 'register') { one('square', 1800, 0.002, 0.05, 0.08); one('sine', 2600, 0.04, 0.06, 0.5); }
    else if (kind === 'deny') { one('square', 220, 0.005, 0.06, 0.25); }
    else if (kind === 'save') { one('sine', 1046, 0.005, 0.06, 0.3); one('sine', 1568, 0.12, 0.05, 0.5); }
    else if (kind === 'fridge') { one('sine', 90, 0.05, 0.08, 0.5); }
    else if (kind === 'elevator') { one('sine', 880, 0.005, 0.06, 0.6); one('sine', 660, 0.25, 0.05, 0.6); }
    else if (kind === 'tool') { for (let k = 0; k < 8; k++) { const o = t + k * 0.04; const s = ctx.createBufferSource(); s.buffer = this.am.white; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 3; const g = ctx.createGain(); g.gain.setValueAtTime(0.12, o); g.gain.exponentialRampToValueAtTime(0.0001, o + 0.035); s.connect(f).connect(g).connect(out); s.start(o, Math.random(), 0.05); } }
  }

  stop() {
    this._setAmbience(null);
    this.track = null;
    this.trackKey = null;
    if (this.bus) this.bus.gain.value = 0;
  }
}
