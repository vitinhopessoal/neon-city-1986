import { clamp } from '../utils/math.js';

/**
 * Sons automotivos 100% procedurais (Web Audio API), apenas para o veículo do
 * jogador (veículos distantes não consomem áudio):
 *  - partida (motor de arranque) e marcha lenta
 *  - motor: osciladores na frequência de ignição (rpm/60 · cilindros/2),
 *    saturação suave e filtro que abre com a carga (aceleração/desaceleração)
 *  - derrapagem/frenagem: ruído rosa filtrado proporcional ao escorregamento
 *  - colisão: estalo grave + ruído, volume pela intensidade
 *  - buzina: dois tons quadrados filtrados
 * Volumes moderados (o compressor do AudioManager limita picos).
 */
export class VehicleAudio {
  constructor(audio) {
    this.audio = audio;
    this.n = null;
    this.vehicle = null;
    this.running = false;
    this.hornOn = false;
  }

  get ctx() {
    return this.audio.ctx;
  }

  _build() {
    const ctx = this.ctx;
    if (!ctx || this.n) return !!this.n;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.audio.master);
    // Motor.
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const o3 = ctx.createOscillator(); o3.type = 'sawtooth';
    const g1 = ctx.createGain(); g1.gain.value = 0.55;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const g3 = ctx.createGain(); g3.gain.value = 0.18;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 400; filter.Q.value = 2.2;
    const engine = ctx.createGain(); engine.gain.value = 0;
    // Pulsação (motos): modulação de amplitude na cadência das explosões — monocilíndrico
    // "toc-toc", V2 irregular "potato", carros e 4 cilindros sem pulsação (profundidade 0).
    const pulse = ctx.createGain(); pulse.gain.value = 1;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 10;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0;
    lfo.connect(lfoDepth).connect(pulse.gain); lfo.start();
    o1.connect(g1).connect(shaper); o2.connect(g2).connect(shaper); o3.connect(g3).connect(shaper);
    shaper.connect(filter).connect(pulse).connect(engine).connect(out);
    for (const o of [o1, o2, o3]) { o.frequency.value = 40; o.start(); }
    // Derrapagem.
    const skidSrc = ctx.createBufferSource(); skidSrc.buffer = this.audio.pink; skidSrc.loop = true;
    const skidF = ctx.createBiquadFilter(); skidF.type = 'bandpass'; skidF.frequency.value = 1900; skidF.Q.value = 1.4;
    const skid = ctx.createGain(); skid.gain.value = 0;
    skidSrc.connect(skidF).connect(skid).connect(out);
    skidSrc.start();
    // Buzina.
    const h1 = ctx.createOscillator(); h1.type = 'square'; h1.frequency.value = 370;
    const h2 = ctx.createOscillator(); h2.type = 'square'; h2.frequency.value = 466;
    const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 900; hf.Q.value = 0.9;
    const horn = ctx.createGain(); horn.gain.value = 0;
    h1.connect(hf); h2.connect(hf); hf.connect(horn).connect(out);
    h1.start(); h2.start();
    this.n = { out, o1, o2, o3, filter, engine, skid, skidF, horn, h1, h2, lfo, lfoDepth };
    return true;
  }

  /**
   * Voz do veículo: buzina e pulsação do motor. Motos (PROMPT 15) têm buzina mais
   * aguda e pulsação conforme o motor (handling.cylinders + style.engine); carros
   * mantêm exatamente o som anterior.
   */
  setVoice(vehicle) {
    if (!this._build()) return;
    const s = vehicle.spec, n = this.n, t = this.ctx.currentTime;
    const eng = s.bike ? s.style?.engine : null;
    this.voice = !eng ? { lope: 0, lopeRatio: 0.5, horn: [370, 466] }
      : eng === 'single' ? { lope: 0.45, lopeRatio: 1, horn: [560, 700] }
      : eng === 'twin' ? { lope: 0.25, lopeRatio: 0.5, horn: [520, 655] }
      : eng === 'vtwin' || eng === 'vtwin_big' ? { lope: 0.7, lopeRatio: 0.25, horn: [420, 530] }
      : { lope: 0.06, lopeRatio: 0.5, horn: [600, 760] };
    n.h1.frequency.setValueAtTime(this.voice.horn[0], t);
    n.h2.frequency.setValueAtTime(this.voice.horn[1], t);
    n.lfoDepth.gain.setValueAtTime(this.voice.lope * 0.5, t);
  }

  /** Motor de arranque + entrada do motor. */
  start(vehicle) {
    this.vehicle = vehicle;
    this.running = true;
    if (!this._build()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // Arranque: ruído com modulação ("rrr-rrr") por ~0,6 s.
    const src = ctx.createBufferSource(); src.buffer = this.audio.brown;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 220; f.Q.value = 3;
    const g = ctx.createGain(); g.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.12;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(f).connect(g).connect(this.n.out);
    g.gain.setValueAtTime(0.14, t);
    g.gain.linearRampToValueAtTime(0.0, t + 0.65);
    src.start(t); src.stop(t + 0.7); lfo.start(t); lfo.stop(t + 0.7);
    this.n.engine.gain.cancelScheduledValues(t);
    this.n.engine.gain.setValueAtTime(0, t);
    this.n.engine.gain.linearRampToValueAtTime(0.1, t + 0.75);
  }

  stop() {
    this.running = false;
    this.vehicle = null;
    if (!this.n) return;
    const t = this.ctx.currentTime;
    this.n.engine.gain.cancelScheduledValues(t);
    this.n.engine.gain.setTargetAtTime(0, t, 0.25);
    this.n.skid.gain.setTargetAtTime(0, t, 0.1);
    this.n.horn.gain.setTargetAtTime(0, t, 0.03);
    this.hornOn = false;
  }

  horn(on) {
    if (on === this.hornOn || !this.n) return;
    this.hornOn = on;
    this.n.horn.gain.setTargetAtTime(on ? 0.07 : 0, this.ctx.currentTime, 0.02);
  }

  /** Estalo de colisão (intensidade em m/s). */
  impact(strength) {
    if (!this._build()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = clamp((strength - 2) / 14, 0.1, 1);
    const src = ctx.createBufferSource(); src.buffer = this.audio.white;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + 2400 * k;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3 * k, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + 0.3 * k);
    src.connect(f).connect(g).connect(this.n.out);
    src.start(t); src.stop(t + 0.8);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.35 * k, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og).connect(this.n.out);
    o.start(t); o.stop(t + 0.35);
  }

  update(dt, vehicle) {
    if (!this.n || !this.running || vehicle !== this.vehicle) return;
    const ph = vehicle.physics, H = vehicle.spec.handling, c = vehicle.controls;
    const t = this.ctx.currentTime;
    const rpm = Math.max(H.idleRpm * 0.6, ph.rpm);
    const fire = (rpm / 60) * (H.cylinders / 2) * 0.5 * H.enginePitch;
    this.n.o1.frequency.setTargetAtTime(fire, t, 0.04);
    this.n.o2.frequency.setTargetAtTime(fire * 0.5, t, 0.04);
    this.n.o3.frequency.setTargetAtTime(fire * 2.01, t, 0.04);
    if (this.voice?.lope) this.n.lfo.frequency.setTargetAtTime(fire * this.voice.lopeRatio, t, 0.05);
    const load = clamp(Math.abs(c.throttle), 0, 1);
    const rpmK = clamp((rpm - H.idleRpm) / (H.redline - H.idleRpm), 0, 1);
    this.n.filter.frequency.setTargetAtTime(260 + load * 1700 + rpmK * 900, t, 0.06);
    this.n.engine.gain.setTargetAtTime(0.07 + load * 0.07 + rpmK * 0.05, t, 0.08);
    const skid = ph.skid + (c.brake > 0.6 && Math.abs(ph.vLong) > 8 ? 0.15 : 0);
    this.n.skid.gain.setTargetAtTime(clamp(skid, 0, 1) * 0.16, t, 0.05);
    this.n.skidF.frequency.setTargetAtTime(1500 + Math.abs(ph.vLong) * 25, t, 0.1);
    // Alvos solicitados (o contexto pode estar suspenso sem gesto do usuário).
    this.target = { engineHz: fire, filterHz: 260 + load * 1700 + rpmK * 900, skid: clamp(skid, 0, 1), lope: this.voice?.lope ?? 0, hornHz: this.voice?.horn?.[0] ?? 370 };
  }

  /** Parâmetros atuais (para testes automatizados). */
  get debug() {
    if (!this.n) return null;
    return { state: this.ctx.state, engineHz: this.n.o1.frequency.value, filterHz: this.n.filter.frequency.value, target: this.target || null };
  }
}
