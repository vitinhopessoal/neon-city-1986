/**
 * Rig procedural do protagonista: mede articulações na malha (cortes por
 * altura), define a pose de ligação (bind) e calcula pesos de pele.
 *
 * Os nomes e a hierarquia espelham o personagem provisório
 * (src/player/CharacterModel.js), para que o PlayerAnimator existente
 * dirija os dois modelos com as mesmas rotações.
 *
 * Coordenadas de entrada: metros, pés em y = 0, frente +Z, esquerda +X.
 */

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'wristL',
  'shoulderR', 'elbowR', 'wristR',
  'hipL', 'kneeL', 'ankleL',
  'hipR', 'kneeR', 'ankleR',
];
export const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));

// ------------------------------------------------------------- utilidades
export const q = {
  /** Quaternion que gira o vetor unitário a até o vetor unitário b. */
  fromUnit(a, b) {
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
    let w = 1 + d;
    if (w < 1e-8) { x = 1; y = 0; z = 0; w = 0; }
    const l = Math.hypot(x, y, z, w);
    return [x / l, y / l, z / l, w / l];
  },
  inv: (a) => [-a[0], -a[1], -a[2], a[3]],
  mul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  },
  rot(a, v) {
    const [x, y, z, w] = a;
    const ix = w * v[0] + y * v[2] - z * v[1];
    const iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0];
    const iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  },
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Centroide (x, z) e extensões de uma faixa de altura filtrada. */
export function band(P, H, h0, h1, pred = () => true) {
  let sx = 0, sz = 0, n = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], h = P[i + 1] / H, z = P[i + 2];
    if (h < h0 || h >= h1 || !pred(x, h, z)) continue;
    sx += x; sz += z; n++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x: sx / n, z: sz / n, n, x0, x1, z0, z1 };
}

/**
 * Mede as articulações. `spec` dá as alturas relativas (fração da altura)
 * e o limite lateral que separa braço de tronco.
 */
export function measureJoints(P, H, spec) {
  const S = spec;
  const armPred = (s) => (x) => s * x > S.armX * H;
  const legPred = (s) => (x) => s * x > 0;
  const J = {};
  const at = (c, h) => [c.x, h * H, c.z];
  const pelvis = band(P, H, S.crotch, S.legTop + 0.03, (x) => Math.abs(x) < S.armX * H * 0.85);
  J.hips = at(pelvis, S.hips);
  const waist = band(P, H, 0.46, 0.52, (x) => Math.abs(x) < S.armX * H * 0.85);
  J.spine = at(waist, S.spine);
  J.chest = J.spine.slice();
  J.neck = at(band(P, H, S.neck - 0.01, S.neck + 0.015, (x) => Math.abs(x) < 0.08 * H), S.neck);
  J.head = at(band(P, H, S.head - 0.01, S.head + 0.015, (x) => Math.abs(x) < 0.08 * H), S.head);
  const ends = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const sh = band(P, H, S.shoulder - 0.03, S.shoulder + 0.015, armPred(s));
    J[`shoulder${side}`] = [sh.x * S.shoulderInset, S.shoulder * H, sh.z];
    J[`elbow${side}`] = at(band(P, H, S.elbow - 0.015, S.elbow + 0.015, armPred(s)), S.elbow);
    J[`wrist${side}`] = at(band(P, H, S.wrist - 0.012, S.wrist + 0.012, armPred(s)), S.wrist);
    const hand = band(P, H, S.handEnd, S.handEnd + 0.03, armPred(s));
    ends[`hand${side}`] = [hand.x, S.handEnd * H, hand.z];
    J[`hip${side}`] = at(band(P, H, S.hipJoint - 0.07, S.hipJoint - 0.03, legPred(s)), S.hipJoint);
    J[`knee${side}`] = at(band(P, H, S.knee - 0.015, S.knee + 0.015, legPred(s)), S.knee);
    J[`ankle${side}`] = at(band(P, H, S.ankle, S.ankle + 0.03, legPred(s)), S.ankle);
  }
  return { J, ends };
}

/**
 * Pose de ligação: rotação de repouso R0 por osso (membros alinhados de -Y
 * para a direção medida) e posições "neutras" (membros retos para baixo),
 * que correspondem às rotações zero do PlayerAnimator.
 */
export function buildBind(J) {
  const down = [0, -1, 0];
  const R0 = BONES.map(() => [0, 0, 0, 1]);
  const dirTo = (a, b) => norm(sub(J[b], J[a]));
  for (const s of ['L', 'R']) {
    R0[B[`shoulder${s}`]] = q.fromUnit(down, dirTo(`shoulder${s}`, `elbow${s}`));
    R0[B[`elbow${s}`]] = q.fromUnit(down, dirTo(`elbow${s}`, `wrist${s}`));
    R0[B[`wrist${s}`]] = R0[B[`elbow${s}`]].slice();
    R0[B[`hip${s}`]] = q.fromUnit(down, dirTo(`hip${s}`, `knee${s}`));
    R0[B[`knee${s}`]] = q.fromUnit(down, dirTo(`knee${s}`, `ankle${s}`));
    // Pé: mantém a orientação medida (apoiado no chão).
  }
  const pos = BONES.map((n) => J[n]);
  const neutral = BONES.map(() => [0, 0, 0]);
  const local = BONES.map(() => [0, 0, 0]); // deslocamento neutro em relação ao pai
  for (let i = 0; i < BONES.length; i++) {
    const p = PARENT[i];
    if (p < 0) { neutral[i] = pos[i].slice(); local[i] = pos[i].slice(); continue; }
    local[i] = q.rot(q.inv(R0[p]), sub(pos[i], pos[p]));
    neutral[i] = add(neutral[p], local[i]);
  }
  // TRS de ligação (para o glTF): local = B_pai^-1 · B_filho.
  const bindLocal = BONES.map((_, i) => {
    const p = PARENT[i];
    if (p < 0) return { t: pos[i].slice(), r: R0[i].slice() };
    return { t: q.rot(q.inv(R0[p]), sub(pos[i], pos[p])), r: q.mul(q.inv(R0[p]), R0[i]) };
  });
  return { R0, pos, neutral, local, bindLocal };
}

/**
 * Pesos de pele por vértice (até 4 ossos). Classificação por região
 * (pernas, braços, tronco/cabeça) e mistura suave ao longo de cada cadeia.
 * Retorna Uint8Array (índices) e Float32Array (pesos), 4 por vértice.
 */
export function computeWeights(P, H, J, spec, { armSide } = {}) {
  const n = P.length / 3;
  const idx = new Uint8Array(n * 4);
  const wts = new Float32Array(n * 4);
  const S = spec;
  const region = new Uint8Array(n); // 0 tronco, 1 braço L, 2 braço R, 3 perna
  const w = new Float64Array(BONES.length);
  for (let v = 0; v < n; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const h = y / H;
    w.fill(0);
    const side = armSide ? armSide(v, x, h, z) : 0;
    if (side !== 0) {
      // Braço.
      const s = side > 0 ? 'L' : 'R';
      region[v] = side > 0 ? 1 : 2;
      const wHand = smooth(S.wrist + 0.012, S.wrist - 0.012, h);
      const wFore = smooth(S.elbow + 0.02, S.elbow - 0.02, h) - wHand;
      let wUpper = 1 - wHand - wFore;
      const toChest = wUpper * smooth(S.shoulder - 0.035, S.shoulder + 0.04, h);
      wUpper -= toChest;
      w[B[`wrist${s}`]] += wHand;
      w[B[`elbow${s}`]] += wFore;
      w[B[`shoulder${s}`]] += wUpper;
      w[B.chest] += toChest;
    } else if (h < S.legTop) {
      // Pernas (com divisão suave no centro e mistura com o quadril).
      region[v] = 3;
      const sL = smooth(-0.025 * H, 0.025 * H, x);
      const toHips = smooth(S.crotch - 0.01, S.legTop, h);
      const wFoot = smooth(S.ankle + 0.02, S.ankle - 0.012, h);
      const wShin = smooth(S.knee + 0.03, S.knee - 0.03, h) - wFoot;
      let wThigh = 1 - wFoot - wShin;
      const hipsPart = wThigh * toHips;
      wThigh -= hipsPart;
      w[B.hips] += hipsPart;
      for (const [s, k] of [['L', sL], ['R', 1 - sL]]) {
        w[B[`ankle${s}`]] += wFoot * k;
        w[B[`knee${s}`]] += wShin * k;
        w[B[`hip${s}`]] += wThigh * k;
      }
    } else {
      // Tronco e cabeça.
      const wHead = smooth(S.head - 0.02, S.head + 0.012, h);
      const neckBand = smooth(S.neck - 0.02, S.neck + 0.005, h);
      const wNeck = neckBand * (1 - wHead);
      const upper = smooth(S.spine - 0.04, S.spine + 0.03, h) * (1 - neckBand);
      const wHips = (1 - smooth(S.spine - 0.04, S.spine + 0.03, h)) * (1 - neckBand);
      w[B.head] += wHead;
      w[B.neck] += wNeck;
      w[B.chest] += upper;
      w[B.hips] += wHips;
      // Ombro: o tronco perto da articulação acompanha parte do braço.
      for (const s of ['L', 'R']) {
        const j = J[`shoulder${s}`];
        const d = Math.hypot(x - j[0], y - j[1], z - j[2]) / H;
        const k = 0.45 * smooth(S.shoulderRadius, 0, d);
        if (k > 0) {
          for (let b = 0; b < w.length; b++) w[b] *= 1 - k;
          w[B[`shoulder${s}`]] += k;
        }
      }
      // Parte de cima das coxas na pélvis.
      if (h < S.legTop + 0.03) {
        const k = 0.35 * smooth(S.legTop + 0.03, S.crotch, h);
        const sL = smooth(-0.04 * H, 0.04 * H, x);
        for (let b = 0; b < w.length; b++) w[b] *= 1 - k;
        w[B.hipL] += k * sL;
        w[B.hipR] += k * (1 - sL);
      }
    }
    // Quatro maiores.
    const order = [...w.keys()].filter((b) => w[b] > 1e-4).sort((a, b) => w[b] - w[a]).slice(0, 4);
    let sum = 0;
    for (const b of order) sum += w[b];
    order.forEach((b, k) => { idx[v * 4 + k] = b; wts[v * 4 + k] = w[b] / sum; });
  }
  return { idx, wts, region };
}
