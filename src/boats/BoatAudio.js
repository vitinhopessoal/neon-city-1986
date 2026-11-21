/**
 * Áudio procedural das embarcações (Web Audio, sem arquivos):
 *  - motor: dois osciladores na frequência do motor + ruído grave
 *    ("borbulhar" da descarga molhada), filtro que abre com a carga;
 *  - casco na água: ruído rosa em banda proporcional à velocidade e ao
 *    impacto nas ondas; batidas do casco ao cair de um salto;
 *  - buzina marítima: dois tons graves; respingo (entrada na água);
 *  - ambiente de marina: ondas batendo nas estacas (só perto dos píeres).
 * Só o barco do jogador tem motor sintetizado (barcos de IA não custam áudio).
 */
export class BoatAudio {
  constructor(audio) {
    this.audio = audio;
    this.n = null;
    this.running = false;
    this.hornOn = false;
    this._lastAutomate = { eng: -1, hiss: -1 };
  }

  get ctx() { return this.audio.ctx; }

  _build() {
    const ctx = this.ctx;
    if (!ctx || this.n) return !!this.n;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.audio.master);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 300; filter.Q.value = 3;
    const engine = ctx.createGain(); engine.gain.value = 0;
    o1.connect(g1).connect(filter); o2.connect(g2).connect(filter);
    // Borbulhar: ruído marrom modulado pela rotação.
    const bub = ctx.createBufferSource(); bub.buffer = this.audio.brown; bub.loop = true;
    const bubF = ctx.createBiquadFilter(); bubF.type = 'bandpass'; bubF.frequency.value = 140; bubF.Q.value = 2;
    const bubG = ctx.createGain(); bubG.gain.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.35;
    lfo.connect(lfoG).connect(bubG.gain);
    bub.connect(bubF).connect(bubG).connect(filter);
    filter.connect(engine).connect(out);
    for (const o of [o1, o2]) { o.frequency.value = 40; o.start(); }
    bub.start(); lfo.start();
    // Casco cortando a água.
    const hs = ctx.createBufferSource(); hs.buffer = this.audio.pink; hs.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 900; hf.Q.value = 0.7;
    const hiss = ctx.createGain(); hiss.gain.value = 0;
    hs.connect(hf).connect(hiss).connect(out);
    hs.start();
    // Buzina marítima (grave).
    const h1 = ctx.createOscillator(); h1.type = 'sawtooth'; h1.frequency.value = 174;
    const h2 = ctx.createOscillator(); h2.type = 'sawtooth'; h2.frequency.value = 220;
    const hornF = ctx.createBiquadFilter(); hornF.type = 'lowpass'; hornF.frequency.value = 700;
    const horn = ctx.createGain(); horn.gain.value = 0;
    h1.connect(hornF); h2.connect(hornF); hornF.connect(horn).connect(out);
    h1.start(); h2.start();
    this.n = { out, o1, o2, filter, engine, bubF, lfo, hiss, hf, horn };
    return true;
  }

  start(boat) {
    this.boat = boat;
    this.running = true;
    if (!this._build()) return;
    const t = this.ctx.currentTime;
    this.n.engine.gain.cancelScheduledValues(t);
    this.n.engine.gain.setValueAtTime(0, t);
    this.n.engine.gain.linearRampToValueAtTime(0.12, t + 0.6);
  }

  stop() {
    this.running = false;
    this.horn(false);
    if (!this.n) return;
    const t = this.ctx.currentTime;
    this.n.engine.gain.setTargetAtTime(0, t, 0.25);
    this.n.hiss.gain.setTargetAtTime(0, t, 0.2);
  }

  horn(on) {
    if (on === this.hornOn) return;
    this.hornOn = on;
    if (!this.n) return;
    this.n.horn.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, on ? 0.03 : 0.08);
  }

  /** Respingo: ruído com envelope curto (entrada na água, batida do casco). */
  splash(strength = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.audio.pink;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 + strength * 400; f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(Math.min(0.5, 0.12 + strength * 0.12), t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + strength * 0.25);
    src.connect(f).connect(g).connect(this.audio.master);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.8 + strength * 0.3);
  }

  /** Batida de casco contra píer/rocha/barco. */
  impact(strength) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.5, 0.08 + strength * 0.04), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(this.audio.master);
    o.start(t); o.stop(t + 0.45);
    this.splash(Math.min(2, strength / 4));
  }

  /**
   * Marulho da marina: água batendo nas estacas e cascos (ruído marrom em
   * passa-banda com LFO lento). level 0..1 pela distância aos píeres.
   */
  ambient(level) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.amb) {
      const src = ctx.createBufferSource(); src.buffer = this.audio.brown; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 1.1;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
      const lg = ctx.createGain(); lg.gain.value = 0.5;
      const mod = ctx.createGain(); mod.gain.value = 0.5;
      lfo.connect(lg).connect(mod.gain);
      src.connect(f).connect(mod).connect(g).connect(this.audio.master);
      src.start(); lfo.start();
      this.amb = { g, level: -1 };
    }
    const v = Math.max(0, Math.min(1, level)) * 0.12;
    if (Math.abs(v - this.amb.level) < 0.004) return;
    this.amb.level = v;
    this.amb.g.gain.setTargetAtTime(v, ctx.currentTime, 0.5);
  }

  /** Automação só quando os valores mudam de forma perceptível (sem custo por quadro). */
  update(dt, phys) {
    if (!this.running || !this.n) return;
    const s = phys.spec.engine;
    const sp = Math.abs(phys.forwardSpeed) / phys.spec.maxSpeed;
    const load = Math.abs(phys.throttle);
    const rpm = Math.min(1.15, 0.12 + load * 0.55 + sp * 0.45 + (phys.airborne ? load * 0.3 : 0));
    const f = s.base + s.range * rpm;
    const t = this.ctx.currentTime;
    if (Math.abs(f - this._lastAutomate.eng) > 0.6) {
      this._lastAutomate.eng = f;
      this.n.o1.frequency.setTargetAtTime(f, t, 0.08);
      this.n.o2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
      this.n.filter.frequency.setTargetAtTime(220 + 1400 * rpm * (0.5 + load * 0.5), t, 0.1);
      this.n.engine.gain.setTargetAtTime(0.07 + 0.09 * load + 0.03 * sp, t, 0.1);
      this.n.lfo.frequency.setTargetAtTime(6 + rpm * 22, t, 0.1);
    }
    const hiss = phys.airborne ? 0.01 : Math.min(0.2, sp * 0.16 + phys.submerged * 0.02 + Math.abs(phys.yawRate) * sp * 0.05);
    if (Math.abs(hiss - this._lastAutomate.hiss) > 0.006) {
      this._lastAutomate.hiss = hiss;
      this.n.hiss.gain.setTargetAtTime(hiss, t, 0.12);
      this.n.hf.frequency.setTargetAtTime(500 + sp * 1600, t, 0.15);
    }
  }
}
