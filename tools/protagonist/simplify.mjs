/**
 * Simplificação de malha por métricas de erro quádrico (Garland & Heckbert)
 * com colapso de meia-aresta (o vértice que fica mantém posição e UV).
 *
 * Preserva costuras de UV: a malha é processada por posição soldada, mas
 * cada "wedge" (posição + UV) do vértice removido precisa ter um wedge
 * correspondente no vértice destino dentro da mesma ilha de UV. Assim as
 * costuras só encolhem ao longo de si mesmas e a textura não "escorre".
 * Também rejeita colapsos que invertem normais ou dobram triângulos no UV.
 */

function planeQuadric(Q, o, a, b, c, d, w) {
  Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
  Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
  Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
}

function evalQ(Q, oa, ob, x, y, z) {
  const q0 = Q[oa] + Q[ob], q1 = Q[oa + 1] + Q[ob + 1], q2 = Q[oa + 2] + Q[ob + 2], q3 = Q[oa + 3] + Q[ob + 3];
  const q4 = Q[oa + 4] + Q[ob + 4], q5 = Q[oa + 5] + Q[ob + 5], q6 = Q[oa + 6] + Q[ob + 6];
  const q7 = Q[oa + 7] + Q[ob + 7], q8 = Q[oa + 8] + Q[ob + 8], q9 = Q[oa + 9] + Q[ob + 9];
  return q0 * x * x + 2 * q1 * x * y + 2 * q2 * x * z + 2 * q3 * x + q4 * y * y + 2 * q5 * y * z + 2 * q6 * y + q7 * z * z + 2 * q8 * z + q9;
}

class Heap {
  constructor(cap = 1 << 20) {
    this.cost = new Float64Array(cap);
    this.a = new Int32Array(cap);
    this.b = new Int32Array(cap);
    this.sa = new Int32Array(cap);
    this.sb = new Int32Array(cap);
    this.n = 0;
  }
  _grow() {
    const cap = this.cost.length * 2;
    for (const k of ['cost', 'a', 'b', 'sa', 'sb']) {
      const t = new this[k].constructor(cap);
      t.set(this[k]);
      this[k] = t;
    }
  }
  _swap(i, j) {
    for (const k of ['cost', 'a', 'b', 'sa', 'sb']) {
      const arr = this[k];
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
  }
  push(cost, a, b, sa, sb) {
    if (this.n === this.cost.length) this._grow();
    let i = this.n++;
    this.cost[i] = cost; this.a[i] = a; this.b[i] = b; this.sa[i] = sa; this.sb[i] = sb;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p] <= this.cost[i]) break;
      this._swap(i, p);
      i = p;
    }
  }
  pop(out) {
    out.cost = this.cost[0]; out.a = this.a[0]; out.b = this.b[0]; out.sa = this.sa[0]; out.sb = this.sb[0];
    const last = --this.n;
    if (last > 0) {
      this.cost[0] = this.cost[last]; this.a[0] = this.a[last]; this.b[0] = this.b[last];
      this.sa[0] = this.sa[last]; this.sb[0] = this.sb[last];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < last && this.cost[l] < this.cost[m]) m = l;
        if (r < last && this.cost[r] < this.cost[m]) m = r;
        if (m === i) break;
        this._swap(i, m);
        i = m;
      }
    }
    return out;
  }
}

/**
 * @param {{positions: Float64Array, wedgePos: Int32Array, wedgeUV: Float64Array, tris: Int32Array}} mesh
 * @param {number} targetTris
 */
export function simplify(mesh, targetTris, { seamWeight = 8, minCos = 0.25, log = () => {} } = {}) {
  const P = mesh.positions;
  const wp = mesh.wedgePos;
  const UV = mesh.wedgeUV;
  const np = P.length / 3;
  const nF = mesh.tris.length / 3;
  const F = Int32Array.from(mesh.tris);
  const alive = new Uint8Array(nF).fill(1);
  let aliveCount = nF;
  const vf = Array.from({ length: np }, () => []);
  for (let f = 0; f < nF; f++) for (let k = 0; k < 3; k++) vf[wp[F[f * 3 + k]]].push(f);

  // Quádricas dos planos das faces (peso = área).
  const Q = new Float64Array(np * 10);
  const fn = new Float64Array(3);
  const faceNormal = (pa, pb, pc, out) => {
    const ax = P[pa * 3], ay = P[pa * 3 + 1], az = P[pa * 3 + 2];
    const ux = P[pb * 3] - ax, uy = P[pb * 3 + 1] - ay, uz = P[pb * 3 + 2] - az;
    const vx = P[pc * 3] - ax, vy = P[pc * 3 + 1] - ay, vz = P[pc * 3 + 2] - az;
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
    return out;
  };
  for (let f = 0; f < nF; f++) {
    const pa = wp[F[f * 3]], pb = wp[F[f * 3 + 1]], pc = wp[F[f * 3 + 2]];
    faceNormal(pa, pb, pc, fn);
    const len = Math.hypot(fn[0], fn[1], fn[2]);
    if (len < 1e-14) continue;
    const a = fn[0] / len, b = fn[1] / len, c = fn[2] / len;
    const d = -(a * P[pa * 3] + b * P[pa * 3 + 1] + c * P[pa * 3 + 2]);
    const w = len * 0.5;
    for (const p of [pa, pb, pc]) planeQuadric(Q, p * 10, a, b, c, d, w);
  }

  // Arestas: costuras de UV, bordas e arestas não-manifold recebem planos de
  // restrição perpendiculares (mantêm a linha da costura no lugar).
  const edgeFaces = new Map();
  for (let f = 0; f < nF; f++) {
    for (let k = 0; k < 3; k++) {
      const a = wp[F[f * 3 + k]], b = wp[F[f * 3 + ((k + 1) % 3)]];
      const key = a < b ? a * np + b : b * np + a;
      let l = edgeFaces.get(key);
      if (!l) edgeFaces.set(key, (l = []));
      l.push(f);
    }
  }
  const wedgeAt = (f, p) => {
    for (let k = 0; k < 3; k++) if (wp[F[f * 3 + k]] === p) return F[f * 3 + k];
    return -1;
  };
  const locked = new Uint8Array(np);
  let seams = 0, nonManifold = 0;
  for (const [key, faces] of edgeFaces) {
    const a = Math.floor(key / np), b = key % np;
    let constrain = faces.length !== 2;
    if (faces.length > 2) { nonManifold++; locked[a] = locked[b] = 1; }
    if (faces.length === 2) {
      const [f0, f1] = faces;
      if (wedgeAt(f0, a) !== wedgeAt(f1, a) || wedgeAt(f0, b) !== wedgeAt(f1, b)) constrain = true;
    }
    if (!constrain) continue;
    seams++;
    const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], ez = P[b * 3 + 2] - P[a * 3 + 2];
    const el2 = ex * ex + ey * ey + ez * ez;
    for (const f of faces) {
      faceNormal(wp[F[f * 3]], wp[F[f * 3 + 1]], wp[F[f * 3 + 2]], fn);
      let cx = ey * fn[2] - ez * fn[1], cy = ez * fn[0] - ex * fn[2], cz = ex * fn[1] - ey * fn[0];
      const cl = Math.hypot(cx, cy, cz);
      if (cl < 1e-14) continue;
      cx /= cl; cy /= cl; cz /= cl;
      const d = -(cx * P[a * 3] + cy * P[a * 3 + 1] + cz * P[a * 3 + 2]);
      const w = el2 * seamWeight;
      planeQuadric(Q, a * 10, cx, cy, cz, d, w);
      planeQuadric(Q, b * 10, cx, cy, cz, d, w);
    }
  }
  log(`arestas ${edgeFaces.size}, costuras/bordas ${seams}, não-manifold ${nonManifold}`);
  edgeFaces.clear();

  const removed = new Uint8Array(np);
  const stamp = new Int32Array(np);
  const markA = new Int32Array(np);
  const markB = new Int32Array(np);
  const markN = new Int32Array(np);
  let token = 0;
  let ntoken = 0;
  const mapFrom = [];
  const mapTo = [];
  const n0 = new Float64Array(3);
  const n1 = new Float64Array(3);

  const uvArea = (w0, w1, w2) =>
    (UV[w1 * 2] - UV[w0 * 2]) * (UV[w2 * 2 + 1] - UV[w0 * 2 + 1]) - (UV[w2 * 2] - UV[w0 * 2]) * (UV[w1 * 2 + 1] - UV[w0 * 2 + 1]);

  /** Valida o colapso a→b; preenche mapFrom/mapTo (wedges). */
  function canCollapse(a, b) {
    if (locked[a]) return false;
    const fa = vf[a];
    mapFrom.length = 0;
    mapTo.length = 0;
    let shared = 0;
    for (const f of fa) {
      if (!alive[f]) continue;
      const wb = wedgeAt(f, b);
      if (wb < 0) continue;
      shared++;
      const wa = wedgeAt(f, a);
      const i = mapFrom.indexOf(wa);
      if (i >= 0) { if (mapTo[i] !== wb) return false; }
      else { mapFrom.push(wa); mapTo.push(wb); }
    }
    if (shared !== 2) return false;
    // Condição de ligação: vizinhos em comum = exatamente os 2 opostos.
    token++;
    for (const f of fa) {
      if (!alive[f]) continue;
      for (let k = 0; k < 3; k++) { const p = wp[F[f * 3 + k]]; if (p !== a) markA[p] = token; }
    }
    let common = 0;
    for (const f of vf[b]) {
      if (!alive[f]) continue;
      for (let k = 0; k < 3; k++) {
        const p = wp[F[f * 3 + k]];
        if (p !== b && p !== a && markA[p] === token && markB[p] !== token) { markB[p] = token; common++; }
      }
    }
    if (common !== 2) return false;
    // Faces que se movem: wedge mapeado, sem inversão de normal nem de UV.
    for (const f of fa) {
      if (!alive[f]) continue;
      if (wedgeAt(f, b) >= 0) continue;
      let ka = 0;
      for (let k = 0; k < 3; k++) if (wp[F[f * 3 + k]] === a) ka = k;
      const wa = F[f * 3 + ka];
      const mi = mapFrom.indexOf(wa);
      if (mi < 0) return false;
      const w1 = F[f * 3 + ((ka + 1) % 3)], w2 = F[f * 3 + ((ka + 2) % 3)];
      const p1 = wp[w1], p2 = wp[w2];
      faceNormal(a, p1, p2, n0);
      faceNormal(b, p1, p2, n1);
      const l0 = Math.hypot(n0[0], n0[1], n0[2]), l1 = Math.hypot(n1[0], n1[1], n1[2]);
      if (l1 < 1e-12) return false;
      if (l0 > 1e-14 && (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (l0 * l1) < minCos) return false;
      const s0 = uvArea(wa, w1, w2), s1 = uvArea(mapTo[mi], w1, w2);
      if (s0 * s1 <= 0 && Math.abs(s0) > 1e-12) return false;
    }
    return true;
  }

  const heap = new Heap();
  function pushEdge(a, b) {
    const ca = evalQ(Q, a * 10, b * 10, P[b * 3], P[b * 3 + 1], P[b * 3 + 2]); // a→b
    const cb = evalQ(Q, a * 10, b * 10, P[a * 3], P[a * 3 + 1], P[a * 3 + 2]); // b→a
    const first = ca <= cb ? [a, b, ca] : [b, a, cb];
    const second = ca <= cb ? [b, a, cb] : [a, b, ca];
    for (const [x, y, c] of [first, second]) {
      if (canCollapse(x, y)) { heap.push(Math.max(0, c), x, y, stamp[x], stamp[y]); return; }
    }
  }

  // Arestas iniciais.
  {
    const seen = new Set();
    for (let f = 0; f < nF; f++) {
      for (let k = 0; k < 3; k++) {
        const a = wp[F[f * 3 + k]], b = wp[F[f * 3 + ((k + 1) % 3)]];
        const key = a < b ? a * np + b : b * np + a;
        if (seen.has(key)) continue;
        seen.add(key);
        pushEdge(a, b);
      }
    }
  }
  log(`fila inicial ${heap.n}`);

  const e = {};
  let collapses = 0;
  let maxCost = 0;
  while (aliveCount > targetTris && heap.n > 0) {
    heap.pop(e);
    const { a, b } = e;
    if (removed[a] || removed[b] || stamp[a] !== e.sa || stamp[b] !== e.sb) continue;
    if (!canCollapse(a, b)) continue;
    // Executa o colapso.
    for (const f of vf[a]) {
      if (!alive[f]) continue;
      if (wedgeAt(f, b) >= 0) {
        alive[f] = 0;
        aliveCount--;
        continue;
      }
      for (let k = 0; k < 3; k++) {
        if (wp[F[f * 3 + k]] === a) F[f * 3 + k] = mapTo[mapFrom.indexOf(F[f * 3 + k])];
      }
      vf[b].push(f);
    }
    vf[a] = [];
    removed[a] = 1;
    for (let k = 0; k < 10; k++) Q[b * 10 + k] += Q[a * 10 + k];
    stamp[b]++;
    if (e.cost > maxCost) maxCost = e.cost;
    collapses++;
    // Limpa listas e reinsere as arestas de b.
    vf[b] = vf[b].filter((f) => alive[f]);
    ntoken++;
    const nbrs = [];
    for (const f of vf[b]) {
      for (let k = 0; k < 3; k++) {
        const p = wp[F[f * 3 + k]];
        if (p !== b && markN[p] !== ntoken) { markN[p] = ntoken; nbrs.push(p); }
      }
    }
    for (const p of nbrs) {
      vf[p] = vf[p].filter((f) => alive[f]);
      stamp[p]++;
    }
    for (const p of nbrs) {
      pushEdge(b, p);
      // As arestas do anel do vizinho também são revalidadas.
      for (const f of vf[p]) {
        for (let k = 0; k < 3; k++) {
          const q = wp[F[f * 3 + k]];
          if (q !== p && q !== b && (markN[q] !== ntoken || q > p)) pushEdge(p, q);
        }
      }
    }
    if (collapses % 20000 === 0) log(`  colapsos ${collapses}, triângulos ${aliveCount}, fila ${heap.n}`);
  }
  log(`colapsos ${collapses}, triângulos finais ${aliveCount}, erro máx ${Math.sqrt(maxCost).toExponential(2)}`);

  // Compacta.
  const out = [];
  for (let f = 0; f < nF; f++) if (alive[f]) out.push(F[f * 3], F[f * 3 + 1], F[f * 3 + 2]);
  const remap = new Int32Array(wp.length).fill(-1);
  const newWP = [];
  const newUV = [];
  const tris = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    if (remap[w] < 0) {
      remap[w] = newWP.length;
      newWP.push(wp[w]);
      newUV.push(UV[w * 2], UV[w * 2 + 1]);
    }
    tris[i] = remap[w];
  }
  return { positions: P, wedgePos: Int32Array.from(newWP), wedgeUV: Float64Array.from(newUV), tris };
}
