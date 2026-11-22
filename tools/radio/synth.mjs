// NEON RADIO NETWORK — sintetizador e compositor algorítmico (Node, offline).
// Gera músicas ORIGINAIS por gênero (synthwave, disco, rock, electro, soft rock, latina, jazz),
// vinhetas e trilhas de comerciais. Nada é amostrado de gravações existentes: todo som nasce
// de osciladores, ruído, cordas de Karplus-Strong e síntese FM escritos aqui.
export const SR = 44100;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ utilidades
export function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.range = (a0, b0) => a0 + (b0 - a0) * r();
  r.int = (a0, b0) => Math.floor(a0 + (b0 - a0 + 1) * r());
  return r;
}
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Envelope ADSR (amostras). */
function adsr(n, a, d, s, r, hold) {
  const out = new Float32Array(n);
  const A = Math.max(1, a * SR), D = Math.max(1, d * SR), R = Math.max(1, r * SR), H = Math.max(A + D, hold * SR);
  for (let i = 0; i < n; i++) {
    let v;
    if (i < A) v = i / A;
    else if (i < A + D) v = 1 - (1 - s) * ((i - A) / D);
    else if (i < H) v = s;
    else v = s * Math.exp(-((i - H) / R) * 5);
    out[i] = v;
  }
  return out;
}

/** Filtro biquad (in-place) com frequência variável por amostra (array ou número). */
function biquad(x, type, freq, q = 0.707) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0, b1, b2, a1, a2;
  const coef = (f) => {
    const w = TAU * clamp(f, 20, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let n0, n1, n2;
    if (type === 'low') { n0 = (1 - c) / 2; n1 = 1 - c; n2 = (1 - c) / 2; }
    else if (type === 'high') { n0 = (1 + c) / 2; n1 = -(1 + c); n2 = (1 + c) / 2; }
    else { n0 = al; n1 = 0; n2 = -al; }
    const a0 = 1 + al;
    b0 = n0 / a0; b1 = n1 / a0; b2 = n2 / a0; a1 = (-2 * c) / a0; a2 = (1 - al) / a0;
  };
  const dyn = typeof freq !== 'number';
  if (!dyn) coef(freq);
  for (let i = 0; i < x.length; i++) {
    if (dyn && (i & 31) === 0) coef(freq[i]);
    const xi = x[i];
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

/** Osciladores com polyBLEP (menos serrilhado). */
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function osc(n, freq, type, detune = 0, phase0 = 0, vibrato = null) {
  const out = new Float32Array(n);
  let ph = phase0;
  for (let i = 0; i < n; i++) {
    let f = freq * (1 + detune);
    if (vibrato) f *= 1 + vibrato.depth * Math.sin(TAU * vibrato.rate * i / SR) * Math.min(1, i / (SR * (vibrato.delay || 0.2)));
    const dt = f / SR;
    let v;
    if (type === 'saw') v = 2 * ph - 1 - blep(ph, dt);
    else if (type === 'square' || type === 'pulse') {
      const pw = type === 'pulse' ? 0.25 : 0.5;
      v = (ph < pw ? 1 : -1) + blep(ph, dt) - blep((ph + 1 - pw) % 1, dt);
    } else if (type === 'tri') v = 1 - 4 * Math.abs(ph - 0.5);
    else v = Math.sin(TAU * ph);
    out[i] = v;
    ph += dt; if (ph >= 1) ph -= 1;
  }
  return out;
}
function noise(n, r) { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = r() * 2 - 1; return o; }
function mulEnv(x, e, g = 1) { for (let i = 0; i < x.length; i++) x[i] *= e[i] * g; return x; }
function addTo(a, b, g = 1) { for (let i = 0; i < a.length && i < b.length; i++) a[i] += b[i] * g; return a; }
function drive(x, amt) { const k = Math.tanh(amt); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * amt) / k; return x; }

/** Corda de Karplus-Strong (guitarra, baixo acústico, pizzicato). */
function pluck(n, freq, r, { decay = 0.996, bright = 0.5 } = {}) {
  const out = new Float32Array(n);
  const L = Math.max(2, Math.round(SR / freq));
  const buf = new Float32Array(L);
  for (let i = 0; i < L; i++) buf[i] = (r() * 2 - 1) * (0.5 + bright * 0.5);
  let idx = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const cur = buf[idx];
    const nxt = buf[(idx + 1) % L];
    const v = decay * (cur * (0.5 + bright * 0.25) + nxt * (0.5 - bright * 0.25));
    buf[idx] = v;
    out[i] = cur;
    last = v;
    idx = (idx + 1) % L;
  }
  return out;
}

/** FM de dois operadores (piano elétrico, sinos, marimba). */
function fm(n, freq, ratio, index, idxDecay, r = null) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const I = index * Math.exp(-t * idxDecay);
    out[i] = Math.sin(TAU * freq * t + I * Math.sin(TAU * freq * ratio * t));
  }
  return out;
}

// ------------------------------------------------------------------ instrumentos
const sec = (s) => Math.max(1, Math.floor(s * SR));
export const INST = {
  bassSynth(f, dur, v, r, o = {}) {
    const n = sec(dur + 0.15);
    const x = osc(n, f, o.wave || 'saw');
    addTo(x, osc(n, f / 2, 'square'), 0.35);
    const fe = adsr(n, 0.002, 0.18, 0.25, 0.08, dur);
    const cut = new Float32Array(n);
    for (let i = 0; i < n; i++) cut[i] = (o.cut || 380) + fe[i] * (o.env || 1400);
    biquad(x, 'low', cut, 1.6);
    return mulEnv(x, adsr(n, 0.004, 0.1, 0.8, 0.06, dur), 0.45 * v);
  },
  bassSub(f, dur, v) {
    const n = sec(dur + 0.2);
    const x = osc(n, f, 'sine');
    addTo(x, osc(n, f * 2, 'tri'), 0.15);
    return mulEnv(x, adsr(n, 0.005, 0.2, 0.85, 0.12, dur), 0.62 * v);
  },
  bassPluck(f, dur, v, r, o = {}) {
    const n = sec(dur + 0.3);
    const x = pluck(n, f, r, { decay: o.decay || 0.994, bright: o.bright ?? 0.35 });
    biquad(x, 'low', o.cut || 1400, 0.9);
    addTo(x, osc(n, f, 'sine'), 0.35);
    return mulEnv(x, adsr(n, 0.002, 0.3, 0.6, 0.08, dur), 0.7 * v);
  },
  pad(fs, dur, v, r, o = {}) {
    const n = sec(dur + 0.8);
    const x = new Float32Array(n);
    for (const f of fs) for (const d of [-0.006, 0, 0.007]) addTo(x, osc(n, f, o.wave || 'saw', d, r()), 0.16);
    biquad(x, 'low', o.cut || 1800, 0.7);
    return mulEnv(x, adsr(n, o.attack ?? 0.35, 0.4, 0.75, 0.6, dur), 0.32 * v / Math.sqrt(fs.length));
  },
  strings(fs, dur, v, r) { return INST.pad(fs, dur, v, r, { wave: 'saw', cut: 2600, attack: 0.25 }); },
  lead(f, dur, v, r, o = {}) {
    const n = sec(dur + 0.25);
    const x = osc(n, f, o.wave || 'saw', 0, 0, { rate: 5.2, depth: o.vib ?? 0.006, delay: 0.25 });
    addTo(x, osc(n, f, 'square', 0.004), 0.4);
    const fe = adsr(n, 0.01, 0.25, 0.4, 0.2, dur);
    const cut = new Float32Array(n);
    for (let i = 0; i < n; i++) cut[i] = (o.cut || 1200) + fe[i] * (o.env || 2600);
    biquad(x, 'low', cut, 1.1);
    return mulEnv(x, adsr(n, 0.008, 0.15, 0.7, 0.18, dur), 0.26 * v);
  },
  arp(f, dur, v, r) {
    const n = sec(dur + 0.2);
    const x = osc(n, f, 'pulse');
    biquad(x, 'low', 2400, 1.4);
    return mulEnv(x, adsr(n, 0.002, 0.12, 0.15, 0.08, dur), 0.22 * v);
  },
  ep(fs, dur, v, r) {
    const n = sec(dur + 0.9);
    const x = new Float32Array(n);
    for (const f of fs) addTo(x, fm(n, f, 1, 1.6, 3.5), 0.3);
    for (let i = 0; i < n; i++) x[i] *= 1 + 0.18 * Math.sin(TAU * 4.5 * i / SR);
    return mulEnv(x, adsr(n, 0.003, 0.9, 0.35, 0.5, dur), 0.42 * v / Math.sqrt(fs.length));
  },
  piano(fs, dur, v, r) {
    const n = sec(dur + 1.4);
    const x = new Float32Array(n);
    for (const f of fs) {
      for (let h = 1; h <= 6; h++) {
        const fh = f * h * (1 + 0.0004 * h * h);
        const amp = 1 / (h * 1.3);
        const dec = 1.6 + h * 0.9;
        for (let i = 0; i < n; i++) x[i] += Math.sin(TAU * fh * i / SR) * amp * Math.exp(-i / SR * dec);
      }
    }
    return mulEnv(x, adsr(n, 0.002, 0.1, 1, 0.25, dur + 0.6), 0.22 * v / Math.sqrt(fs.length));
  },
  organ(fs, dur, v) {
    const n = sec(dur + 0.1);
    const x = new Float32Array(n);
    for (const f of fs) for (const [h, a] of [[0.5, 0.5], [1, 1], [2, 0.6], [3, 0.35], [4, 0.2]]) addTo(x, osc(n, f * h, 'sine'), a * 0.2);
    for (let i = 0; i < n; i++) x[i] *= 1 + 0.12 * Math.sin(TAU * 6.4 * i / SR);
    return mulEnv(x, adsr(n, 0.01, 0.05, 0.9, 0.08, dur), 0.3 * v / Math.sqrt(fs.length));
  },
  brass(fs, dur, v, r) {
    const n = sec(dur + 0.2);
    const x = new Float32Array(n);
    for (const f of fs) { addTo(x, osc(n, f, 'saw', 0.003), 0.3); addTo(x, osc(n, f, 'saw', -0.004), 0.3); }
    const fe = adsr(n, 0.04, 0.2, 0.5, 0.1, dur);
    const cut = new Float32Array(n);
    for (let i = 0; i < n; i++) cut[i] = 600 + fe[i] * 3200;
    biquad(x, 'low', cut, 0.9);
    return mulEnv(x, adsr(n, 0.03, 0.1, 0.8, 0.12, dur), 0.3 * v / Math.sqrt(fs.length));
  },
  clav(fs, dur, v, r) {
    const n = sec(dur + 0.1);
    const x = new Float32Array(n);
    for (const f of fs) addTo(x, osc(n, f, 'pulse'), 0.4);
    biquad(x, 'band', 1800, 1.2);
    return mulEnv(x, adsr(n, 0.001, 0.09, 0.0, 0.03, dur * 0.4), 0.55 * v / Math.sqrt(fs.length));
  },
  guitarClean(f, dur, v, r) {
    const n = sec(dur + 0.8);
    const x = pluck(n, f, r, { decay: 0.997, bright: 0.6 });
    biquad(x, 'low', 4200, 0.7);
    return mulEnv(x, adsr(n, 0.001, 0.4, 0.7, 0.3, dur), 0.45 * v);
  },
  guitarPower(f, dur, v, r, o = {}) {
    const n = sec(dur + 0.25);
    const x = new Float32Array(n);
    for (const m of [1, 1.4983, 2]) addTo(x, pluck(n, f * m, r, { decay: o.mute ? 0.985 : 0.9985, bright: 0.8 }), 0.5);
    drive(x, o.mute ? 6 : 9);
    biquad(x, 'low', 3400, 0.9);
    biquad(x, 'high', 110, 0.7);
    return mulEnv(x, adsr(n, 0.002, 0.2, o.mute ? 0.3 : 0.85, 0.12, dur), 0.3 * v);
  },
  guitarLead(f, dur, v, r) {
    const n = sec(dur + 0.3);
    const x = osc(n, f, 'saw', 0, 0, { rate: 5.8, depth: 0.009, delay: 0.15 });
    addTo(x, osc(n, f * 2, 'square', 0.002), 0.2);
    drive(x, 7);
    biquad(x, 'low', 3000, 1);
    return mulEnv(x, adsr(n, 0.005, 0.2, 0.75, 0.15, dur), 0.2 * v);
  },
  sax(f, dur, v, r) {
    const n = sec(dur + 0.25);
    const x = osc(n, f, 'saw', 0, 0, { rate: 4.8, depth: 0.012, delay: 0.3 });
    addTo(x, osc(n, f, 'square', 0.003), 0.5);
    const br = noise(n, r); biquad(br, 'band', f * 3, 2); addTo(x, br, 0.08);
    const fe = adsr(n, 0.06, 0.3, 0.6, 0.2, dur);
    const cut = new Float32Array(n);
    for (let i = 0; i < n; i++) cut[i] = 700 + fe[i] * 2200;
    biquad(x, 'low', cut, 1.4);
    return mulEnv(x, adsr(n, 0.04, 0.1, 0.85, 0.15, dur), 0.25 * v);
  },
  flute(f, dur, v, r) {
    const n = sec(dur + 0.2);
    const x = osc(n, f, 'sine', 0, 0, { rate: 5, depth: 0.007, delay: 0.25 });
    const br = noise(n, r); biquad(br, 'band', f * 2, 3); addTo(x, br, 0.05);
    return mulEnv(x, adsr(n, 0.05, 0.1, 0.9, 0.15, dur), 0.32 * v);
  },
  marimba(f, dur, v) {
    const n = sec(Math.min(dur, 0.6) + 0.6);
    const x = fm(n, f, 4, 2.2, 14);
    addTo(x, osc(n, f, 'sine'), 0.6);
    return mulEnv(x, adsr(n, 0.001, 0.5, 0, 0.3, 0.05), 0.42 * v);
  },
  steel(f, dur, v) {
    const n = sec(Math.min(dur, 0.8) + 0.8);
    const x = fm(n, f, 2.76, 1.8, 6);
    return mulEnv(x, adsr(n, 0.002, 0.8, 0.1, 0.4, 0.1), 0.35 * v);
  },
  bell(f, dur, v) {
    const n = sec(1.8);
    const x = fm(n, f, 3.5, 3, 4);
    return mulEnv(x, adsr(n, 0.001, 1.6, 0, 0.3, 0.02), 0.3 * v);
  },
};

// ------------------------------------------------------------------ bateria
export const DRUM = {
  kick(v, r, o = {}) {
    const n = sec(0.45);
    const x = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const f = (o.low || 48) + (o.high || 160) * Math.exp(-t * 32);
      ph += f / SR;
      x[i] = Math.sin(TAU * ph) * Math.exp(-t * (o.decay || 7));
    }
    const cl = noise(sec(0.006), r); for (let i = 0; i < cl.length; i++) x[i] += cl[i] * 0.25 * (1 - i / cl.length);
    return mulEnv(x, new Float32Array(n).fill(1), 0.95 * v);
  },
  k808(v, r) {
    const n = sec(0.9);
    const x = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; ph += (44 + 60 * Math.exp(-t * 25)) / SR; x[i] = Math.sin(TAU * ph) * Math.exp(-t * 3.2); }
    drive(x, 1.8);
    return mulEnv(x, new Float32Array(n).fill(1), 0.9 * v);
  },
  snare(v, r, o = {}) {
    const n = sec(o.gated ? 0.42 : 0.28);
    const nz = noise(n, r); biquad(nz, 'band', 3200, 0.6);
    const x = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      ph += (190 + 60 * Math.exp(-t * 40)) / SR;
      const ne = o.gated ? (t < 0.3 ? Math.exp(-t * 3) : Math.exp(-(t - 0.3) * 60) * Math.exp(-0.9)) : Math.exp(-t * 18);
      x[i] = Math.sin(TAU * ph) * Math.exp(-t * 25) * 0.6 + nz[i] * ne;
    }
    return mulEnv(x, new Float32Array(n).fill(1), 0.55 * v);
  },
  clap(v, r) {
    const n = sec(0.3);
    const nz = noise(n, r); biquad(nz, 'band', 1400, 1.1);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let e = Math.exp(-Math.max(0, t - 0.03) * 22);
      for (const o of [0, 0.01, 0.02]) if (t >= o && t < o + 0.008) e = Math.max(e, 1);
      nz[i] *= e;
    }
    return mulEnv(nz, new Float32Array(n).fill(1), 0.6 * v);
  },
  hat(v, r, o = {}) {
    const n = sec(o.open ? 0.35 : 0.06);
    const x = new Float32Array(n);
    for (const f of [317, 465, 539, 625, 740, 845]) addTo(x, osc(n, f * 4.1, 'square', 0, r()), 0.18);
    addTo(x, noise(n, r), 0.4);
    biquad(x, 'high', 7000, 0.8);
    for (let i = 0; i < n; i++) x[i] *= Math.exp(-(i / SR) * (o.open ? 9 : 70));
    return mulEnv(x, new Float32Array(n).fill(1), 0.24 * v);
  },
  ride(v, r) {
    const n = sec(0.8);
    const x = new Float32Array(n);
    for (const f of [420, 610, 903, 1207]) addTo(x, osc(n, f * 3, 'square', 0, r()), 0.12);
    addTo(x, noise(n, r), 0.15);
    biquad(x, 'high', 5000, 0.8);
    for (let i = 0; i < n; i++) x[i] *= Math.exp(-(i / SR) * 4.5);
    return mulEnv(x, new Float32Array(n).fill(1), 0.2 * v);
  },
  crash(v, r) {
    const n = sec(1.8);
    const x = noise(n, r); biquad(x, 'high', 4500, 0.6);
    for (let i = 0; i < n; i++) x[i] *= Math.exp(-(i / SR) * 2.2);
    return mulEnv(x, new Float32Array(n).fill(1), 0.25 * v);
  },
  tom(v, r, o = {}) {
    const n = sec(0.4);
    const x = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; ph += ((o.f || 120) * (1 + 0.6 * Math.exp(-t * 20))) / SR; x[i] = Math.sin(TAU * ph) * Math.exp(-t * 9); }
    return mulEnv(x, new Float32Array(n).fill(1), 0.6 * v);
  },
  conga(v, r, o = {}) {
    const n = sec(0.3);
    const x = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; ph += ((o.f || 220) * (1 + 0.25 * Math.exp(-t * 40))) / SR; x[i] = Math.sin(TAU * ph) * Math.exp(-t * (o.slap ? 30 : 14)); }
    if (o.slap) { const nz = noise(n, r); biquad(nz, 'band', 2500, 1); for (let i = 0; i < n; i++) x[i] += nz[i] * Math.exp(-(i / SR) * 60) * 0.5; }
    return mulEnv(x, new Float32Array(n).fill(1), 0.5 * v);
  },
  cowbell(v, r) {
    const n = sec(0.25);
    const x = osc(n, 562, 'square'); addTo(x, osc(n, 845, 'square'), 0.8);
    biquad(x, 'band', 900, 2);
    for (let i = 0; i < n; i++) x[i] *= Math.exp(-(i / SR) * 16);
    return mulEnv(x, new Float32Array(n).fill(1), 0.35 * v);
  },
  shaker(v, r) {
    const n = sec(0.08);
    const x = noise(n, r); biquad(x, 'high', 6000, 0.7);
    for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= Math.min(1, t / 0.015) * Math.exp(-t * 40); }
    return mulEnv(x, new Float32Array(n).fill(1), 0.22 * v);
  },
  rim(v, r) {
    const n = sec(0.06);
    const x = osc(n, 1700, 'tri'); addTo(x, noise(n, r), 0.3);
    for (let i = 0; i < n; i++) x[i] *= Math.exp(-(i / SR) * 90);
    return mulEnv(x, new Float32Array(n).fill(1), 0.4 * v);
  },
  brush(v, r) {
    const n = sec(0.22);
    const x = noise(n, r); biquad(x, 'band', 2600, 0.5);
    for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= Math.min(1, t / 0.03) * Math.exp(-t * 14); }
    return mulEnv(x, new Float32Array(n).fill(1), 0.28 * v);
  },
  timbale(v, r) { return DRUM.conga(v, r, { f: 520, slap: true }); },
};

// ------------------------------------------------------------------ mixagem
export class Mixer {
  constructor(seconds) {
    this.n = Math.ceil(seconds * SR);
    this.L = new Float32Array(this.n); this.R = new Float32Array(this.n);
    this.revL = new Float32Array(this.n); this.revR = new Float32Array(this.n);
    this.dlyL = new Float32Array(this.n); this.dlyR = new Float32Array(this.n);
  }
  add(x, t, gain = 1, pan = 0, rev = 0, dly = 0) {
    if (!x) return;
    const s = Math.floor(t * SR);
    const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < x.length; i++) {
      const j = s + i;
      if (j < 0) continue;
      if (j >= this.n) break;
      const v = x[i];
      this.L[j] += v * gl; this.R[j] += v * gr;
      if (rev) { this.revL[j] += v * gl * rev; this.revR[j] += v * gr * rev; }
      if (dly) { this.dlyL[j] += v * gl * dly; this.dlyR[j] += v * gr * dly; }
    }
  }
  /** Delay estéreo com realimentação + reverb (Schroeder) + compressão leve + normalização. */
  master({ delayTime = 0.375, feedback = 0.35, roomSize = 0.84, fadeIn = 0.02, fadeOut = 2.5, target = 0.89 } = {}) {
    const n = this.n;
    const D = Math.floor(delayTime * SR);
    for (let i = D; i < n; i++) {
      this.dlyL[i] += this.dlyR[i - D] * feedback;
      this.dlyR[i] += this.dlyL[i - D] * feedback;
    }
    for (let i = 0; i < n; i++) { const j = i - D; if (j >= 0) { this.L[i] += this.dlyL[j] * 0.6; this.R[i] += this.dlyR[j] * 0.6; this.revL[i] += this.dlyL[j] * 0.15; this.revR[i] += this.dlyR[j] * 0.15; } }
    const reverb = (x, spread) => {
      const out = new Float32Array(n);
      for (const [len, g] of [[1557, roomSize], [1617, roomSize], [1491, roomSize], [1422, roomSize]]) {
        const L = len + spread, buf = new Float32Array(L);
        let idx = 0, lp = 0;
        for (let i = 0; i < n; i++) { const y = buf[idx]; lp = y * 0.75 + lp * 0.25; buf[idx] = x[i] + lp * g; out[i] += y * 0.25; idx = (idx + 1) % L; }
      }
      for (const len of [225 + spread, 556 + spread]) {
        const buf = new Float32Array(len); let idx = 0;
        for (let i = 0; i < n; i++) { const b = buf[idx]; const y = -out[i] + b; buf[idx] = out[i] + b * 0.5; out[i] = y; idx = (idx + 1) % len; }
      }
      return out;
    };
    const rL = reverb(this.revL, 0), rR = reverb(this.revR, 23);
    for (let i = 0; i < n; i++) { this.L[i] += rL[i] * 0.5; this.R[i] += rR[i] * 0.5; }
    // Compressor de envelope RMS simples.
    let env = 0;
    const att = Math.exp(-1 / (0.01 * SR)), rel = Math.exp(-1 / (0.25 * SR));
    let peak = 1e-9;
    for (let i = 0; i < n; i++) {
      const a = Math.max(Math.abs(this.L[i]), Math.abs(this.R[i]));
      env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
      const thr = 0.5, g = env > thr ? Math.pow(env / thr, -0.45) : 1;
      this.L[i] = Math.tanh(this.L[i] * g * 1.1); this.R[i] = Math.tanh(this.R[i] * g * 1.1);
      peak = Math.max(peak, Math.abs(this.L[i]), Math.abs(this.R[i]));
    }
    const k = target / peak;
    const fi = Math.floor(fadeIn * SR), fo = Math.floor(fadeOut * SR);
    for (let i = 0; i < n; i++) {
      let f = k;
      if (i < fi) f *= i / fi;
      if (i > n - fo) f *= Math.max(0, (n - i) / fo);
      this.L[i] *= f; this.R[i] *= f;
    }
    return this;
  }
  wav() {
    const n = this.n, buf = Buffer.alloc(44 + n * 4);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
    buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) {
      buf.writeInt16LE(Math.round(clamp(this.L[i], -1, 1) * 32767), 44 + i * 4);
      buf.writeInt16LE(Math.round(clamp(this.R[i], -1, 1) * 32767), 46 + i * 4);
    }
    return buf;
  }
  stats() {
    let sum = 0, peak = 0, silent = 0;
    for (let i = 0; i < this.n; i++) { const a = Math.abs(this.L[i]); sum += a * a; peak = Math.max(peak, a); }
    const win = SR;
    for (let s = 0; s + win <= this.n; s += win) { let m = 0; for (let i = s; i < s + win; i++) m = Math.max(m, Math.abs(this.L[i])); if (m < 0.01) silent++; }
    return { rms: Math.sqrt(sum / this.n), peak, silentSeconds: silent, seconds: this.n / SR };
  }
}

// ------------------------------------------------------------------ teoria musical
const MODES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixo: [0, 2, 4, 5, 7, 9, 10] };
function scaleNote(root, mode, deg) {
  const s = MODES[mode];
  const o = Math.floor(deg / 7), d = ((deg % 7) + 7) % 7;
  return root + s[d] + 12 * o;
}
function chord(root, mode, degree, seventh = false) {
  const d = degree - 1;
  const notes = [scaleNote(root, mode, d), scaleNote(root, mode, d + 2), scaleNote(root, mode, d + 4)];
  if (seventh) notes.push(scaleNote(root, mode, d + 6));
  return notes;
}
function voice(notes, low, high) { return notes.map((m) => { while (m < low) m += 12; while (m > high) m -= 12; return m; }).sort((a, b) => a - b); }

// ------------------------------------------------------------------ estilos
/** Padrões de 16 passos: 'X' acento, 'x' normal, '.' pausa. */
const P = (s) => [...s].map((c) => (c === 'X' ? 1 : c === 'x' ? 0.65 : c === 'o' ? 0.4 : 0));
export const STYLES = {
  synthwave: {
    bpm: [96, 112], modes: ['minor', 'dorian'], roots: [45, 47, 48, 50, 52], swing: 0,
    progs: [[1, 6, 3, 7], [1, 4, 6, 5], [6, 4, 1, 5], [1, 7, 6, 7]],
    drums: { kick: P('X...X...X...X...'), snare: P('....X.......X...'), hat: P('x.x.x.x.x.x.x.x.') }, snareGated: true,
    bass: 'eighths', bassInst: 'bassSynth', comp: 'pad', arp: true, lead: 'lead', leadOct: 0, rev: 0.35, dly: 0.25,
  },
  disco: {
    bpm: [116, 124], modes: ['dorian', 'minor', 'mixo'], roots: [43, 45, 47, 48, 50], swing: 0,
    progs: [[1, 4, 1, 4], [1, 6, 2, 5], [2, 5, 1, 1], [1, 7, 4, 5]],
    drums: { kick: P('X...X...X...X...'), snare: P('....X.......X...'), hat: P('..x...x...x...x.'), hatOpen: true, shaker: P('x.x.x.x.x.x.x.x.') },
    bass: 'octaves', bassInst: 'bassPluck', comp: 'clav', strings: true, brass: true, lead: 'strings', rev: 0.25, dly: 0.12,
  },
  rock: {
    bpm: [122, 140], modes: ['minor', 'mixo'], roots: [40, 42, 45, 43], swing: 0,
    progs: [[1, 7, 6, 7], [1, 4, 5, 4], [6, 4, 1, 5], [1, 3, 4, 4]],
    drums: { kick: P('X.....x.X.......'), snare: P('....X.......X...'), hat: P('x.x.x.x.x.x.x.x.') }, crash: true,
    bass: 'rootEighths', bassInst: 'bassPluck', comp: 'power', lead: 'guitarLead', rev: 0.18, dly: 0.08,
  },
  electro: {
    bpm: [100, 112], modes: ['minor'], roots: [41, 43, 45, 46], swing: 0.08,
    progs: [[1, 1, 6, 7], [1, 4, 1, 5], [1, 6, 1, 6]],
    drums: { k808: P('X.....X...X.....'), clap: P('....X.......X...'), hat: P('xxxXxxxXxxxXxxxX'), tom: true },
    bass: 'syncSub', bassInst: 'bassSub', comp: 'stabs', lead: 'arp', rev: 0.2, dly: 0.3,
  },
  soft: {
    bpm: [74, 88], modes: ['major'], roots: [48, 50, 53, 55], swing: 0,
    progs: [[1, 5, 6, 4], [1, 6, 4, 5], [4, 5, 3, 6], [1, 3, 4, 5]],
    drums: { kick: P('X.......X.x.....'), snare: P('....X.......X...'), hat: P('x.x.x.x.x.x.x.x.'), soft: true },
    bass: 'roots', bassInst: 'bassPluck', comp: 'piano', guitar: true, strings: true, lead: 'sax', rev: 0.4, dly: 0.1,
  },
  latin: {
    bpm: [100, 116], modes: ['minor', 'major'], roots: [45, 47, 48, 50], swing: 0,
    progs: [[1, 4, 5, 4], [1, 5, 5, 1], [6, 2, 5, 1], [1, 4, 1, 5]],
    drums: { kick: P('X.....x.X.....x.'), clave: P('X..X..X...X.X...'), conga: P('..x.X.x...x.X.x.'), cowbell: P('X...x...X...x...'), shaker: P('x.x.x.x.x.x.x.x.'), timbale: true },
    bass: 'tumbao', bassInst: 'bassPluck', comp: 'montuno', brass: true, lead: 'marimba', rev: 0.25, dly: 0.05,
  },
  jazz: {
    bpm: [92, 128], modes: ['major', 'dorian'], roots: [46, 48, 51, 53], swing: 0.62,
    progs: [[2, 5, 1, 6], [1, 6, 2, 5], [3, 6, 2, 5], [4, 3, 2, 1]],
    drums: { ride: true, brush: P('....x.......x...'), kick: P('X.........x.....'), hatFoot: P('....x.......x...') },
    bass: 'walking', bassInst: 'bassPluck', comp: 'epJazz', lead: 'sax', seventh: true, rev: 0.35, dly: 0.0,
  },
};

// ------------------------------------------------------------------ compositor
/**
 * Compõe e renderiza uma faixa. structure: lista de seções [nome, compassos].
 * Devolve { mixer, info } — info com bpm, tonalidade, duração e seções (metadados reais).
 */
export function composeTrack(styleName, seed, { structure = null, master = {} } = {}) {
  const S = STYLES[styleName];
  const r = rng(seed);
  const bpm = Math.round(r.range(S.bpm[0], S.bpm[1]));
  const mode = r.pick(S.modes);
  const root = r.pick(S.roots);
  const beat = 60 / bpm, bar = beat * 4, step = beat / 4;
  const sections = structure || [['intro', 4], ['A', 8], ['B', 8], ['A', 8], ['B', 8], ['bridge', 8], ['B', 8], ['outro', 4]];
  const totalBars = sections.reduce((s, x) => s + x[1], 0);
  const seconds = totalBars * bar + 3;
  const M = new Mixer(seconds);
  const progA = r.pick(S.progs), progB = r.pick(S.progs), progC = r.pick(S.progs);
  const progOf = (name) => (name === 'B' ? progB : name === 'bridge' ? progC : progA);
  const swingT = (k) => (S.swing && k % 2 === 1 ? step * (S.swing > 0.5 ? (S.swing - 0.5) * 2 * 1.0 : S.swing * 2) : 0);
  // Motivos melódicos (2 compassos) por seção — repetidos com variação.
  const rhythms = [
    [[0, 2], [2, 2], [4, 3], [8, 2], [10, 2], [12, 4], [16, 2], [18, 2], [20, 4], [26, 6]],
    [[0, 3], [3, 3], [6, 2], [8, 6], [16, 2], [18, 2], [20, 2], [22, 2], [24, 8]],
    [[0, 4], [4, 4], [8, 2], [10, 6], [16, 4], [20, 2], [22, 2], [24, 4], [28, 4]],
    [[2, 2], [4, 2], [6, 4], [12, 2], [14, 2], [18, 2], [20, 4], [24, 2], [26, 6]],
  ];
  const motif = {};
  for (const name of ['A', 'B', 'bridge']) {
    const rh = r.pick(rhythms);
    let deg = r.int(0, 4);
    motif[name] = rh.map(([st, len], i) => { deg = clamp(deg + r.pick([-2, -1, -1, 1, 1, 2, 0, 3, -3]), -2, 9); return { st, len, deg: i === 0 ? r.pick([0, 2, 4]) : deg }; });
  }
  let t = 0;
  const pan = { hat: 0.3, ride: 0.35, conga: -0.35, cowbell: 0.4, shaker: -0.4, clave: 0.25, timbale: 0.45 };
  for (const [name, bars] of sections) {
    const prog = progOf(name);
    const intro = name === 'intro', outro = name === 'outro', bridge = name === 'bridge', chorus = name === 'B';
    const leadOn = (name === 'A' || chorus || bridge) && !(styleName === 'electro' && name === 'A' && r() < 0.3);
    for (let b = 0; b < bars; b++) {
      const deg = prog[b % prog.length];
      const ch = chord(root, mode, deg, !!S.seventh);
      const bt = t + b * bar;
      const lastBar = b === bars - 1;
      // --- Bateria.
      const D = S.drums;
      const dvel = intro ? 0.7 : outro ? 0.8 : chorus ? 1 : 0.9;
      for (let k = 0; k < 16; k++) {
        const st = bt + k * step + swingT(k);
        const fill = lastBar && k >= 12 && !intro;
        if (D.kick?.[k] && !(intro && b < 2 && styleName !== 'synthwave')) M.add(DRUM.kick(D.kick[k] * dvel, r, styleName === 'rock' ? { decay: 9 } : {}), st, 1, 0);
        if (D.k808?.[k]) M.add(DRUM.k808(D.k808[k] * dvel, r), st, 1, 0);
        if (D.snare?.[k] && !intro) M.add(DRUM.snare(D.snare[k] * dvel * (D.soft ? 0.6 : 1), r, { gated: S.snareGated }), st, 1, 0, S.snareGated ? 0.6 : 0.2);
        if (D.clap?.[k] && !intro) M.add(DRUM.clap(D.clap[k] * dvel, r), st, 1, 0.05, 0.25);
        if (D.hat?.[k] && !(fill && styleName === 'rock')) M.add(DRUM.hat(D.hat[k] * dvel * (D.soft ? 0.6 : 1), r), st, 1, pan.hat);
        if (D.hatOpen && k % 4 === 2) M.add(DRUM.hat(0.7 * dvel, r, { open: true }), st, 1, pan.hat);
        if (D.shaker?.[k]) M.add(DRUM.shaker(D.shaker[k] * dvel, r), st, 1, pan.shaker);
        if (D.clave?.[k]) M.add(DRUM.rim(D.clave[k] * 0.9, r), st, 1, pan.clave);
        if (D.conga?.[k] && !intro) M.add(DRUM.conga(D.conga[k] * dvel, r, { f: D.conga[k] > 0.8 ? 196 : 262, slap: D.conga[k] > 0.8 }), st, 1, pan.conga, 0.1);
        if (D.cowbell?.[k] && (chorus || bridge)) M.add(DRUM.cowbell(D.cowbell[k] * dvel, r), st, 1, pan.cowbell);
        if (D.brush?.[k]) M.add(DRUM.brush(D.brush[k], r), st, 1, -0.1, 0.15);
        if (D.hatFoot?.[k]) M.add(DRUM.hat(0.4, r), st, 1, 0.2);
        if (D.ride && k % 4 === 0) M.add(DRUM.ride(0.8, r), st, 1, pan.ride, 0.15);
        if (D.ride && (k === 6 || k === 14)) M.add(DRUM.ride(0.55, r), st + (S.swing ? step * 0.25 : 0), 1, pan.ride, 0.15);
        if (fill && (styleName === 'rock' || D.tom) && k % 1 === 0 && k >= 12) M.add(DRUM.tom(0.8, r, { f: 160 - (k - 12) * 22 }), st, 1, (k - 13.5) * 0.2, 0.2);
        if (fill && D.timbale && k % 2 === 0) M.add(DRUM.timbale(0.8, r), st, 1, pan.timbale, 0.15);
      }
      if ((S.crash && b === 0 && (chorus || bridge)) || (b === 0 && chorus && styleName !== 'jazz')) M.add(DRUM.crash(0.8, r), bt, 1, -0.3, 0.3);
      if (outro && b >= bars - 1) continue;
      // --- Baixo.
      const bassRoot = voice([ch[0]], 28, 43)[0];
      const BI = INST[S.bassInst];
      const bvel = intro ? 0.0 : 0.9;
      if (bvel > 0) {
        if (S.bass === 'eighths') for (let k = 0; k < 8; k++) M.add(BI(mtof(bassRoot + (k === 7 && lastBar ? 7 : 0)), step * 1.8, bvel, r), bt + k * step * 2, 1, 0);
        else if (S.bass === 'octaves') for (let k = 0; k < 8; k++) M.add(BI(mtof(bassRoot + (k % 2 ? 12 : 0)), step * 1.4, bvel, r, { bright: 0.55 }), bt + k * step * 2, 1, 0);
        else if (S.bass === 'rootEighths') for (let k = 0; k < 8; k++) M.add(BI(mtof(bassRoot), step * 1.7, bvel, r, { cut: 900 }), bt + k * step * 2, 1, 0);
        else if (S.bass === 'syncSub') for (const k of [0, 6, 10, 14]) M.add(BI(mtof(bassRoot + (k === 14 ? 12 : 0)), step * (k === 0 ? 5 : 3), bvel), bt + k * step, 1, 0);
        else if (S.bass === 'roots') { M.add(BI(mtof(bassRoot), beat * 1.9, bvel, r), bt, 1, 0); M.add(BI(mtof(bassRoot + 7), beat * 1.9, bvel * 0.8, r), bt + beat * 2, 1, 0); }
        else if (S.bass === 'tumbao') for (const [k, iv] of [[3, 0], [6, 7], [11, 12], [14, 7]]) M.add(BI(mtof(bassRoot + iv), step * 2.5, bvel, r), bt + k * step, 1, 0);
        else if (S.bass === 'walking') {
          const next = voice([chord(root, mode, prog[(b + 1) % prog.length])[0]], 28, 43)[0];
          const walk = [bassRoot, voice([ch[1]], 28, 47)[0], voice([ch[2]], 28, 47)[0], next + (r() < 0.5 ? 1 : -1)];
          walk.forEach((m, k) => M.add(BI(mtof(m), beat * 0.95, 0.85, r, { decay: 0.992, bright: 0.2, cut: 900 }), bt + k * beat, 1, -0.05));
        }
      }
      // --- Harmonia / acompanhamento.
      const midV = voice(ch, 55, 72);
      const cvel = intro ? 0.6 : 0.85;
      if (S.comp === 'pad') M.add(INST.pad(midV.map(mtof), bar * 0.98, cvel, r), bt, 0.9, 0, S.rev);
      else if (S.comp === 'clav' && !intro) for (const k of [2, 6, 10, 13]) M.add(INST.clav(midV.map(mtof), step * 1.2, cvel, r), bt + k * step, 1, -0.25);
      else if (S.comp === 'power' && !intro) {
        const pr = voice([ch[0]], 40, 52)[0];
        if (chorus || bridge) { M.add(INST.guitarPower(mtof(pr), bar * 0.48, 1, r), bt, 1, -0.35, 0.1); M.add(INST.guitarPower(mtof(pr), bar * 0.48, 1, r), bt + bar / 2, 1, 0.35, 0.1); }
        else for (let k = 0; k < 8; k++) M.add(INST.guitarPower(mtof(pr), step * 1.6, 0.9, r, { mute: true }), bt + k * step * 2, 1, k % 2 ? 0.3 : -0.3);
      } else if (S.comp === 'stabs' && !intro) for (const k of [0, 3, 10]) M.add(INST.brass(midV.map((m) => mtof(m + 12)), step * 1.3, cvel * 0.8, r), bt + k * step, 1, 0.2, 0.15, 0.3);
      else if (S.comp === 'piano') { M.add(INST.piano(midV.map(mtof), beat * 1.9, cvel, r), bt, 1, -0.15, S.rev); M.add(INST.piano(midV.map(mtof), beat * 1.9, cvel * 0.75, r), bt + beat * 2, 1, -0.15, S.rev); }
      else if (S.comp === 'montuno' && !intro) for (const [k, iv] of [[0, 0], [3, 1], [6, 2], [8, 1], [11, 0], [14, 2]]) M.add(INST.piano([mtof(midV[iv % midV.length] + 12), mtof(midV[iv % midV.length])], step * 1.5, cvel, r), bt + k * step, 1, -0.2, 0.1);
      else if (S.comp === 'epJazz') for (const k of r() < 0.5 ? [0, 6, 11] : [2, 8, 14]) M.add(INST.ep(voice(ch, 57, 74).slice(1).concat([voice(ch, 57, 74)[0] + 12]).map(mtof), step * 3, cvel, r), bt + k * step + swingT(k), 1, 0.2, 0.25);
      if (S.strings && (chorus || bridge)) M.add(INST.strings(voice(ch, 64, 81).map(mtof), bar * 0.98, 0.7, r), bt, 0.8, 0.2, 0.4);
      if (S.brass && chorus && b % 2 === 1) M.add(INST.brass(voice(ch, 60, 76).map(mtof), step * 2, 0.9, r), bt + 12 * step, 1, 0.3, 0.2);
      if (S.guitar && !intro) for (let k = 0; k < 8; k++) M.add(INST.guitarClean(mtof(voice(ch, 52, 67)[k % 3] + (k >= 4 ? 12 : 0)), step * 2, 0.55, r), bt + k * step * 2, 1, 0.4, 0.3);
      if (S.arp && !outro) for (let k = 0; k < 16; k++) { const m = midV[k % midV.length] + 12 * (k % 8 >= 4 ? 1 : 0); M.add(INST.arp(mtof(m), step * 0.9, intro ? 0.5 : 0.7, r), bt + k * step, 1, k % 2 ? 0.35 : -0.35, 0.2, S.dly); }
      // --- Melodia (motivo de 2 compassos).
      if (leadOn && !intro) {
        const mot = motif[name] || motif.A;
        const half = b % 2;
        const leadInst = INST[S.lead] || INST.lead;
        const oct = chorus ? 12 : 0;
        for (const nt of mot) {
          if (Math.floor(nt.st / 16) !== half) continue;
          let m = scaleNote(root + 12, mode, nt.deg) + oct;
          if (styleName === 'rock') m -= 12;
          if (lastBar && nt === mot[mot.length - 1]) m = voice([ch[0]], m - 6, m + 6)[0];
          const st = bt + (nt.st % 16) * step + swingT(nt.st);
          const dur = nt.len * step * (S.lead === 'marimba' ? 0.5 : 0.95);
          if (S.lead === 'strings') M.add(INST.strings([mtof(m)], dur, 0.8, r), st, 1, 0.1, 0.35);
          else M.add(leadInst(mtof(m), dur, chorus ? 1 : 0.85, r), st, 1, 0.08, S.rev, S.dly);
          if (S.lead === 'marimba') M.add(INST.marimba(mtof(m + 12), dur, 0.5), st + step, 1, -0.3, 0.2);
        }
      }
    }
    t += bars * bar;
  }
  M.master({ delayTime: beat * 0.75, ...master });
  return { mixer: M, info: { style: styleName, bpm, mode, rootMidi: root, bars: totalBars, seconds: +(seconds).toFixed(3), sections: sections.map((s) => s.join(':')) } };
}

/** Vinheta curta (acorde + arpejo ascendente) no estilo da emissora. */
export function composeSting(styleName, seed, seconds = 3.2) {
  const S = STYLES[styleName];
  const r = rng(seed);
  const root = r.pick(S.roots) + 12;
  const mode = r.pick(S.modes);
  const M = new Mixer(seconds + 1.5);
  const ch = voice(chord(root, mode, 1, true), 60, 79);
  const lead = INST[S.lead] || INST.lead;
  ch.forEach((m, i) => M.add(styleName === 'rock' ? INST.guitarPower(mtof(m - 12), 0.18, 0.9, r) : INST.arp(mtof(m + 12), 0.16, 0.9, r), i * 0.11, 1, (i - 1.5) * 0.3, 0.3, 0.3));
  M.add(INST.pad(ch.map(mtof), seconds * 0.6, 0.9, r), 0.45, 1, 0, 0.5);
  const top = mtof(ch[ch.length - 1] + 12);
  M.add(S.lead === 'strings' ? INST.strings([top], seconds * 0.4, 1, r) : lead(top, seconds * 0.4, 1, r), 0.5, 1, 0, 0.4, 0.3);
  M.add(DRUM.crash(0.6, r), 0.45, 1, 0, 0.4);
  M.add(DRUM.kick(0.9, r), 0.45, 1, 0);
  M.master({ fadeOut: 0.8 });
  return M;
}

/** Trilha de fundo para comerciais e notícias (loop curto, sem melodia principal). */
export function composeBed(styleName, seed, seconds) {
  const S = STYLES[styleName];
  const bar = 4 * 60 / ((S.bpm[0] + S.bpm[1]) / 2);
  const bars = Math.max(2, Math.ceil(seconds / bar));
  return composeTrack(styleName, seed, { structure: [['A', bars]], master: { fadeOut: 1.2, target: 0.6 } }).mixer;
}
