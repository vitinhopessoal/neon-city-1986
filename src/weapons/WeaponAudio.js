/**
 * Sons das armas 100% sintetizados (Web Audio API, sem gravações): estalo
 * agudo + corpo grave + cauda de reverberação por categoria; cliques
 * mecânicos de recarga e bombeamento; arma vazia; equipar/guardar; impactos
 * por material; cápsulas tilintando. Usa o contexto e o master do
 * AudioManager existente (respeita o mudo e o compressor).
 */
const MAX_VOICES = 28;

export class WeaponAudio {
  constructor(audioManager) {
    this.am = audioManager;
    this.voices = 0;
    this.bus = null;
    this.played = 0;
  }

  get ready() {
    return !!(this.am && this.am.started && this.am.ctx);
  }

  _bus() {
    if (!this.bus) {
      const ctx = this.am.ctx;
      this.bus = ctx.createGain();
      this.bus.gain.value = 0.75;
      this.bus.connect(this.am.master);
    }
    return this.bus;
  }

  _voice(dur) {
    if (this.voices >= MAX_VOICES) return false;
    this.voices++;
    this.played++;
    setTimeout(() => { this.voices--; }, (dur + 0.1) * 1000);
    return true;
  }

  /** Ruído filtrado com envelope (base de quase todos os sons). */
  _noise(t0, { type = 'bandpass', freq = 1000, q = 1, gain = 0.5, attack = 0.001, decay = 0.1, buffer = 'white', pan = 0, rate = 1 }) {
    const ctx = this.am.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.am[buffer] || this.am.white;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    src.connect(f).connect(g);
    this._out(g, pan);
    const off = Math.random() * Math.max(0, src.buffer.duration - decay - 0.1);
    src.start(t0, off, attack + decay + 0.05);
  }

  _tone(t0, { f0 = 200, f1 = 80, gain = 0.4, decay = 0.12, type = 'sine', pan = 0 }) {
    const ctx = this.am.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, gain), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    o.connect(g);
    this._out(g, pan);
    o.start(t0);
    o.stop(t0 + decay + 0.02);
  }

  _out(node, pan) {
    const ctx = this.am.ctx;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p).connect(this._bus());
    } else node.connect(this._bus());
  }

  /** Disparo. p = def.sound; category ajusta o caráter. */
  shot(p, category) {
    if (!this.ready || !this._voice(p.decay + 0.6)) return;
    const t = this.am.ctx.currentTime + 0.002;
    const g = p.gain;
    const shotgun = category === 'shotgun';
    const carbine = category === 'carbine';
    // Estalo (frente de onda).
    this._noise(t, { type: 'highpass', freq: p.crack, q: 0.7, gain: 0.55 * g, decay: carbine ? 0.05 : 0.035 });
    // Corpo.
    this._noise(t, { type: 'lowpass', freq: p.body * 9, q: 0.9, gain: (shotgun ? 1.0 : 0.75) * g, decay: p.decay * 0.6 });
    this._tone(t, { f0: p.body * 1.4, f1: p.body * 0.45, gain: (shotgun ? 0.7 : 0.45) * g, decay: shotgun ? 0.22 : 0.13 });
    // Cauda (reflexões do ambiente).
    this._noise(t + 0.015, { type: 'lowpass', freq: shotgun ? 600 : 900, q: 0.5, gain: 0.22 * g, attack: 0.02, decay: p.decay + (shotgun ? 0.5 : 0.3), buffer: 'pink' });
  }

  /** Cliques mecânicos (recarga, ferrolho, bomba, vazio, equipar). */
  mech(kind) {
    if (!this.ready || !this._voice(0.3)) return;
    const t = this.am.ctx.currentTime + 0.002;
    const click = (dt, freq, gain, decay = 0.025, q = 4) => this._noise(t + dt, { type: 'bandpass', freq, q, gain, decay });
    switch (kind) {
      case 'magOut': click(0, 1800, 0.25); click(0.04, 900, 0.18, 0.05, 2); break;
      case 'magIn': click(0, 1200, 0.3); click(0.03, 2600, 0.22, 0.02, 6); break;
      case 'slide': click(0, 2200, 0.25, 0.03, 3); click(0.07, 1500, 0.35, 0.04, 3); break;
      case 'bolt': click(0, 1600, 0.3, 0.04, 2); click(0.09, 2000, 0.35, 0.035, 3); break;
      case 'pump': click(0, 700, 0.35, 0.06, 1.5); click(0.13, 900, 0.42, 0.05, 1.8); break;
      case 'shell': click(0, 1300, 0.22, 0.03, 3); click(0.05, 600, 0.15, 0.06, 1); break;
      case 'empty': click(0, 3000, 0.3, 0.015, 8); break;
      case 'equip': this._noise(t, { type: 'bandpass', freq: 500, q: 0.8, gain: 0.12, attack: 0.03, decay: 0.12, buffer: 'pink' }); click(0.12, 2400, 0.2, 0.02, 6); break;
      case 'holster': this._noise(t, { type: 'bandpass', freq: 420, q: 0.8, gain: 0.12, attack: 0.03, decay: 0.15, buffer: 'pink' }); click(0.16, 1400, 0.16, 0.03, 3); break;
      default: click(0, 1500, 0.2);
    }
  }

  /** Impacto por material; distance atenua e pan posiciona. */
  impact(material, distance = 10, pan = 0) {
    if (!this.ready || distance > 90 || !this._voice(0.3)) return;
    const t = this.am.ctx.currentTime + Math.min(0.25, distance / 340);
    const g = Math.max(0.05, 1 - distance / 90) * 0.5;
    switch (material) {
      case 'metal':
        this._tone(t, { f0: 1800 + Math.random() * 1400, f1: 1500, gain: 0.18 * g, decay: 0.22, type: 'triangle', pan });
        this._noise(t, { type: 'highpass', freq: 3000, gain: 0.3 * g, decay: 0.03, pan });
        break;
      case 'wood':
        this._noise(t, { type: 'bandpass', freq: 650, q: 2, gain: 0.5 * g, decay: 0.06, pan });
        break;
      case 'glass':
        for (let i = 0; i < 3; i++) this._tone(t + i * 0.03, { f0: 3500 + Math.random() * 2500, f1: 3000, gain: 0.08 * g, decay: 0.12, type: 'sine', pan });
        this._noise(t, { type: 'highpass', freq: 4000, gain: 0.35 * g, decay: 0.08, pan });
        break;
      case 'sand': case 'dirt':
        this._noise(t, { type: 'lowpass', freq: 900, gain: 0.35 * g, decay: 0.08, buffer: 'pink', pan });
        break;
      case 'water':
        this._noise(t, { type: 'bandpass', freq: 1200, q: 0.7, gain: 0.35 * g, decay: 0.18, buffer: 'pink', pan });
        break;
      default:
        this._noise(t, { type: 'bandpass', freq: 1100, q: 1.2, gain: 0.45 * g, decay: 0.05, pan });
        this._noise(t, { type: 'lowpass', freq: 400, gain: 0.3 * g, decay: 0.07, pan });
    }
  }

  /** Cápsula caindo no chão (atrasada). */
  casing(shotgun = false) {
    if (!this.ready || !this._voice(0.8)) return;
    const t = this.am.ctx.currentTime + 0.35 + Math.random() * 0.25;
    if (shotgun) {
      this._noise(t, { type: 'bandpass', freq: 700, q: 2, gain: 0.08, decay: 0.05 });
      return;
    }
    this._tone(t, { f0: 4200 + Math.random() * 800, f1: 3800, gain: 0.05, decay: 0.07, type: 'sine' });
    this._tone(t + 0.07 + Math.random() * 0.05, { f0: 5200, f1: 4800, gain: 0.03, decay: 0.05, type: 'sine' });
  }
}
