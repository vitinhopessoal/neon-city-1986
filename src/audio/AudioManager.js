/**
 * Áudio ambiente 100% sintetizado com Web Audio API (sem arquivos externos):
 * ondas do mar, brisa, zumbido urbano distante, carros passando ao longe,
 * passos por superfície e impacto de aterrissagem.
 * Só é iniciado após um gesto do usuário (política dos navegadores).
 */
/** Canais de volume (Configurações): geral + música, rádio, vozes, efeitos e ambiente. */
export const AUDIO_CHANNELS = ['master', 'music', 'radio', 'voice', 'sfx', 'ambient'];
const LEVELS_KEY = 'neoncity.audio.levels';

export class AudioManager {
  constructor(volume = 0.7) {
    this.ctx = null;
    this.volume = volume;
    // Níveis por canal (0..1), lembrados entre sessões (preferência do jogador, fora do save).
    this.levels = { master: 1, music: 0.8, radio: 0.8, voice: 0.9, sfx: 1, ambient: 1 };
    try { Object.assign(this.levels, JSON.parse(localStorage.getItem(LEVELS_KEY) || '{}')); } catch { /* armazenamento indisponível */ }
    this.muted = false;
    this.started = false;
    this._nextCar = 6;
    this._t = 0;
  }

  /** Deve ser chamado dentro de um evento de clique/tecla. */
  start() {
    if (this.started) {
      this.ctx?.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    // Ganho principal (volume geral e mudo) → compressor → saída.
    this.main = ctx.createGain();
    this.main.gain.value = this.volume * this.levels.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.main.connect(comp).connect(ctx.destination);
    // Barramentos. "master" continua sendo o destino dos módulos existentes (motores, armas,
    // sirenes, buzinas, barcos...): é o canal de EFEITOS. Ambiente, música e rádio têm canais próprios.
    this.bus = {};
    for (const name of ['sfx', 'ambient', 'music', 'radio', 'voice']) {
      const g = ctx.createGain();
      g.gain.value = this.levels[name] ?? 1;
      g.connect(this.main);
      this.bus[name] = g;
    }
    this.master = this.bus.sfx;
    this.ambientBus = this.bus.ambient;

    this.white = this._noiseBuffer('white', 3);
    this.brown = this._noiseBuffer('brown', 4);
    this.pink = this._noiseBuffer('pink', 4);

    // Ondas: ruído marrom grave + "espuma" (rosa filtrado) que acompanha a crista.
    this.wave = this._loop(this.brown, 'lowpass', 520, 0.7, 0);
    this.wash = this._loop(this.pink, 'bandpass', 1400, 0.6, 0);
    // Brisa.
    this.breeze = this._loop(this.pink, 'bandpass', 700, 0.5, 0);
    // Cidade distante.
    this.city = this._loop(this.brown, 'lowpass', 160, 0.8, 0);
    this.started = true;
  }

  _noiseBuffer(kind, seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.05) * 1.6; }
    }
    // Suaviza a emenda do loop.
    const fade = Math.min(2000, len / 10);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
    return buf;
  }

  _loop(buffer, type, freq, q, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(filter).connect(g);
    if (pan) g.connect(pan).connect(this.ambientBus || this.master); else g.connect(this.ambientBus || this.master);
    src.start(0, Math.random() * buffer.duration);
    return { src, filter, gain: g, pan };
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.main) this.main.gain.setTargetAtTime(this.muted ? 0 : this.volume * this.levels.master, this.ctx.currentTime, 0.1);
    return this.muted;
  }

  /** Ajusta um canal (0..1) e lembra a preferência. */
  setLevel(name, value) {
    if (!AUDIO_CHANNELS.includes(name)) return;
    const v = Math.max(0, Math.min(1, +value || 0));
    this.levels[name] = v;
    try { localStorage.setItem(LEVELS_KEY, JSON.stringify(this.levels)); } catch { /* sem armazenamento */ }
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (name === 'master') { if (!this.muted) this.main.gain.setTargetAtTime(this.volume * v, t, 0.05); }
    else if (this.bus[name]) this.bus[name].gain.setTargetAtTime(v, t, 0.05);
  }

  /**
   * @param {number} shoreDistance distância (m) até a linha d'água (+ em terra)
   * @param {number} yawSin seno do rumo da câmera (pan do mar)
   */
  update(dt, { shoreDistance, inWater, cameraRight }) {
    if (!this.started || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._t += dt;
    const t = this._t;
    const near = 1 / (1 + Math.max(0, shoreDistance) / 30);
    // Ciclo de ondas (~7 s) com leve irregularidade.
    const cycle = Math.sin(t * 0.88) * 0.5 + 0.5;
    const crest = Math.pow(Math.max(0, Math.sin(t * 0.88 - 0.6)), 6);
    this.wave.gain.gain.setTargetAtTime((0.1 + 0.22 * cycle) * near + 0.02, now, 0.3);
    this.wash.gain.gain.setTargetAtTime((0.015 + 0.12 * crest) * near * (inWater ? 1.6 : 1), now, 0.25);
    this.wash.filter.frequency.setTargetAtTime(1000 + crest * 1600, now, 0.3);
    // O mar fica a leste (+X): pan conforme a orientação da câmera.
    if (this.wave.pan) {
      this.wave.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, cameraRight * 0.7)), now, 0.2);
      this.wash.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, cameraRight * 0.6)), now, 0.2);
    }
    const gust = 0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1.3);
    this.breeze.gain.gain.setTargetAtTime(0.018 + 0.035 * gust, now, 0.8);
    this.breeze.filter.frequency.setTargetAtTime(500 + gust * 600, now, 0.8);
    this.city.gain.gain.setTargetAtTime(0.05 + 0.08 * (1 - near), now, 0.5);

    this._nextCar -= dt;
    if (this._nextCar <= 0) {
      this._carPass(1 - near * 0.6);
      this._nextCar = 9 + Math.random() * 14;
    }
  }

  _carPass(level) {
    const ctx = this.ctx;
    const dur = 3.5 + Math.random() * 2;
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    f.frequency.setValueAtTime(220, now);
    f.frequency.linearRampToValueAtTime(520, now + dur * 0.5);
    f.frequency.linearRampToValueAtTime(260, now + dur);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.09 * level, now + dur * 0.5);
    g.gain.linearRampToValueAtTime(0, now + dur);
    let out = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      const dir = Math.random() < 0.5 ? -1 : 1;
      p.pan.setValueAtTime(-0.8 * dir, now);
      p.pan.linearRampToValueAtTime(0.8 * dir, now + dur);
      g.connect(p);
      out = p;
    }
    src.connect(f).connect(g);
    out.connect(this.ambientBus || this.master); // carros ao longe = ambiente
    src.start(now, Math.random() * 2);
    src.stop(now + dur + 0.1);
  }

  /** Passo sintetizado de acordo com a superfície. */
  footstep(surface, run = 0, wading = false) {
    if (!this.started || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const s = wading ? 'water' : surface;
    const P = {
      concrete: { f: 2200, q: 1.1, dur: 0.06, gain: 0.16, type: 'bandpass' },
      pavers: { f: 1700, q: 1.3, dur: 0.07, gain: 0.16, type: 'bandpass' },
      asphalt: { f: 1500, q: 0.9, dur: 0.065, gain: 0.14, type: 'bandpass' },
      sand: { f: 650, q: 0.6, dur: 0.12, gain: 0.13, type: 'bandpass' },
      grass: { f: 1100, q: 0.5, dur: 0.09, gain: 0.08, type: 'bandpass' },
      water: { f: 900, q: 0.4, dur: 0.22, gain: 0.16, type: 'highpass' },
    }[s] || { f: 1800, q: 1, dur: 0.06, gain: 0.14, type: 'bandpass' };
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = P.type;
    f.frequency.value = P.f * (0.9 + Math.random() * 0.2);
    f.Q.value = P.q;
    const g = ctx.createGain();
    const amp = P.gain * (0.75 + run * 0.5);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(amp, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, now + P.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random() * 2);
    src.stop(now + P.dur + 0.05);
  }

  land(impact, surface) {
    if (!this.started || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const k = Math.min(1, impact / 9);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, now);
    o.frequency.exponentialRampToValueAtTime(45, now + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.22 * k + 0.04, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.25);
    this.footstep(surface, 1);
  }

  jump() {
    if (!this.started || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1200;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.05, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random());
    src.stop(now + 0.15);
  }

  dispose() {
    this.ctx?.close();
  }
}
