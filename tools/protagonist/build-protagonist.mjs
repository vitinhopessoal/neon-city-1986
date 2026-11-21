/**
 * Pipeline do protagonista 3D (somente Node, sem instalar nada):
 *
 *   assets-src/protagonist/original/protagonist.obj (+ image0/1.png)
 *     → normaliza (pés em y=0, 1,80 m, frente +Z, giro do corpo corrigido)
 *     → simplifica (QEM com costuras de UV preservadas)
 *     → rig procedural (17 ossos com os nomes do personagem provisório)
 *     → pesos de pele automáticos
 *     → texturas reduzidas
 *     → public/models/protagonist/protagonist.glb
 *
 * Uso: node tools/protagonist/build-protagonist.mjs [--tris=28000] [--tex=1024]
 * Os arquivos originais não são alterados.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOBJ } from './obj.mjs';
import { simplify } from './simplify.mjs';
import { decodePNG, downscale, encodePNG } from './png-io.mjs';
import { BONES, PARENT, q, band, measureJoints, buildBind, computeWeights } from './rig.mjs';
import { writeSkinnedGLB } from './glb-skinned.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'assets-src/protagonist/original');
const OUT = join(ROOT, 'public/models/protagonist');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const TARGET_TRIS = +(args.tris || 28000);
const TEX = +(args.tex || 1024);
const HEIGHT = +(args.height || 1.8);
const log = (...m) => console.log(...m);
const t0 = Date.now();

// ------------------------------------------------------------ 1. leitura
const src = parseOBJ(join(SRC, 'protagonist.obj'));
const np = src.positions.length / 3;
log(`OBJ: ${np} posições, ${src.wedgePos.length} wedges, ${src.tris.length / 3} triângulos (${Date.now() - t0} ms)`);

// ------------------------------------------------------- 2. normalização
const P = src.positions;
let ymin = Infinity, ymax = -Infinity;
for (let i = 1; i < P.length; i += 3) { ymin = Math.min(ymin, P[i]); ymax = Math.max(ymax, P[i]); }
const H0 = ymax - ymin;
for (let i = 0; i < P.length; i += 3) {
  P[i] /= H0;
  P[i + 1] = (P[i + 1] - ymin) / H0;
  P[i + 2] /= H0;
}
// Centro: intervalo do tronco (o maior) na faixa da cintura, onde os braços estão soltos.
const recenter = () => {
  const pts = [];
  for (let i = 0; i < P.length; i += 3) if (P[i + 1] >= 0.47 && P[i + 1] < 0.55) pts.push([P[i], P[i + 2]]);
  pts.sort((a, b) => a[0] - b[0]);
  const iv = [];
  let cur = null;
  for (const [x, z] of pts) {
    if (!cur || x - cur.b > 0.006) { cur = { a: x, b: x, z0: z, z1: z, n: 0 }; iv.push(cur); }
    cur.b = x; cur.n++; cur.z0 = Math.min(cur.z0, z); cur.z1 = Math.max(cur.z1, z);
  }
  const t = iv.reduce((m, c) => (c.n > m.n ? c : m));
  const cx = (t.a + t.b) / 2, cz = (t.z0 + t.z1) / 2;
  for (let i = 0; i < P.length; i += 3) { P[i] -= cx; P[i + 2] -= cz; }
  return { cx, cz };
};
recenter();
// Giro do corpo em torno de Y: ombros, coxas e pés apontam ~20° para o lado.
const pairAngle = (h0, h1, xl) => {
  const L = band(P, 1, h0, h1, (x) => x > xl);
  const R = band(P, 1, h0, h1, (x) => x < -xl);
  return Math.atan2(L.z - R.z, L.x - R.x);
};
const yawS = pairAngle(0.7, 0.8, 0.11);
const yawT = pairAngle(0.28, 0.36, 0.0);
const yaw = (yawS + yawT) / 2;
{
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], z = P[i + 2];
    P[i] = x * c + z * s;
    P[i + 2] = -x * s + z * c;
  }
}
recenter();
for (let i = 0; i < P.length; i++) P[i] *= HEIGHT;
log(`giro corrigido: ombros ${(yawS * 57.3).toFixed(1)}°, coxas ${(yawT * 57.3).toFixed(1)}°, aplicado ${(yaw * 57.3).toFixed(1)}°`);

// Limite lateral braço/tronco: borda do tronco na faixa em que os braços estão soltos.
function torsoHalfWidth(h0, h1) {
  const xs = [];
  for (let i = 0; i < P.length; i += 3) { const h = P[i + 1] / HEIGHT; if (h >= h0 && h < h1) xs.push(P[i] / HEIGHT); }
  xs.sort((a, b) => a - b);
  const iv = [];
  let a = xs[0], b = xs[0];
  for (const x of xs) { if (x - b > 0.006) { iv.push([a, b]); a = x; } b = x; }
  iv.push([a, b]);
  const torso = iv.find(([a, b]) => a <= 0 && b >= 0);
  return { torso, intervals: iv.length, half: Math.max(-torso[0], torso[1]) };
}
if (args.slices) {
  for (let k = 0; k <= 100; k += 1) {
    const h0 = k / 100, h1 = h0 + 0.01;
    const pts = [];
    for (let i = 0; i < P.length; i += 3) { const h = P[i + 1] / HEIGHT; if (h >= h0 && h < h1) pts.push([P[i] / HEIGHT, P[i + 2] / HEIGHT]); }
    pts.sort((a, b) => a[0] - b[0]);
    const iv = [];
    let cur = null;
    for (const [x, z] of pts) { if (!cur || x - cur.b > 0.006) { cur = { a: x, b: x, z0: z, z1: z }; iv.push(cur); } cur.b = x; cur.z0 = Math.min(cur.z0, z); cur.z1 = Math.max(cur.z1, z); }
    log(h0.toFixed(2), iv.map((c) => `x[${c.a.toFixed(3)},${c.b.toFixed(3)}]z[${c.z0.toFixed(3)},${c.z1.toFixed(3)}]`).join(' '));
  }
  process.exit(0);
}
const tw = torsoHalfWidth(0.5, 0.54);
log(`tronco 0,50–0,54: [${tw.torso.map((v) => v.toFixed(3))}] (${tw.intervals} intervalos)`);

// ------------------------------------------------------- 3. simplificação
const t1 = Date.now();
// A simplificação só referencia posições originais (colapso de meia-aresta),
// então o resultado pode ser reaproveitado entre execuções (--reuse).
const CACHE = join(ROOT, `assets-src/protagonist/.cache/simplified-${TARGET_TRIS}.json`);
let simp;
if (args.reuse && existsSync(CACHE)) {
  const c = JSON.parse(readFileSync(CACHE, 'utf8'));
  simp = { positions: P, wedgePos: Int32Array.from(c.wedgePos), wedgeUV: Float64Array.from(c.wedgeUV), tris: Uint32Array.from(c.tris) };
  log('  (simplificação reaproveitada do cache)');
} else {
  simp = simplify(src, TARGET_TRIS, { log: (m) => log('  ' + m) });
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ wedgePos: [...simp.wedgePos], wedgeUV: [...simp.wedgeUV], tris: [...simp.tris] }));
}
log(`simplificação: ${simp.tris.length / 3} triângulos, ${simp.wedgePos.length} vértices (${Date.now() - t1} ms)`);

// Posições usadas pela malha final.
const used = new Int32Array(np).fill(-1);
const usedList = [];
for (const p of simp.wedgePos) if (used[p] < 0) { used[p] = usedList.length; usedList.push(p); }
const PU = new Float64Array(usedList.length * 3);
usedList.forEach((p, i) => { PU[i * 3] = P[p * 3]; PU[i * 3 + 1] = P[p * 3 + 1]; PU[i * 3 + 2] = P[p * 3 + 2]; });

// Normais suaves por posição (média ponderada pela área).
const NU = new Float64Array(PU.length);
for (let f = 0; f < simp.tris.length; f += 3) {
  const [a, b, c] = [0, 1, 2].map((k) => used[simp.wedgePos[simp.tris[f + k]]]);
  const ux = PU[b * 3] - PU[a * 3], uy = PU[b * 3 + 1] - PU[a * 3 + 1], uz = PU[b * 3 + 2] - PU[a * 3 + 2];
  const vx = PU[c * 3] - PU[a * 3], vy = PU[c * 3 + 1] - PU[a * 3 + 1], vz = PU[c * 3 + 2] - PU[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const v of [a, b, c]) { NU[v * 3] += nx; NU[v * 3 + 1] += ny; NU[v * 3 + 2] += nz; }
}
for (let i = 0; i < NU.length; i += 3) {
  const l = Math.hypot(NU[i], NU[i + 1], NU[i + 2]) || 1;
  NU[i] /= l; NU[i + 1] /= l; NU[i + 2] /= l;
}

// ------------------------------------------------------------- 4. rig
const SPEC = {
  hips: 0.45, spine: 0.50, neck: 0.82, head: 0.86,
  shoulder: 0.78, shoulderInset: 0.92, elbow: 0.65, wrist: 0.515, handEnd: 0.43,
  hipJoint: 0.43, knee: 0.23, ankle: 0.06, crotch: 0.415, legTop: 0.45,
  armX: tw.half + 0.004, handExtra: 0.006, shoulderRadius: 0.075,
  ...(args.spec ? JSON.parse(readFileSync(args.spec, 'utf8')) : {}),
};
const { J, ends } = measureJoints(P, HEIGHT, SPEC);
const bind = buildBind(J);

// Braços: candidatos por limite lateral + conectividade a partir do antebraço.
const nU = usedList.length;
const adj = Array.from({ length: nU }, () => []);
for (let f = 0; f < simp.tris.length; f += 3) {
  const t = [0, 1, 2].map((k) => used[simp.wedgePos[simp.tris[f + k]]]);
  for (let k = 0; k < 3; k++) adj[t[k]].push(t[(k + 1) % 3], t[(k + 2) % 3]);
}
const armSideOf = new Int8Array(nU);
for (const s of [1, -1]) {
  const cand = new Uint8Array(nU);
  for (let v = 0; v < nU; v++) {
    const x = PU[v * 3] / HEIGHT, h = PU[v * 3 + 1] / HEIGHT;
    const xl = h < 0.48 ? SPEC.armX + SPEC.handExtra : SPEC.armX;
    // Face interna da mão/braço (normal voltada para o corpo) encostada na
    // pélvis ou no tronco: pertence ao braço mesmo um pouco dentro do limite.
    const inward = s * NU[v * 3] < -0.2 && s * x > SPEC.armX - 0.018;
    if (h > SPEC.handEnd - 0.012 && h < SPEC.shoulder + 0.035 && (s * x > xl || inward)) cand[v] = 1;
  }
  const seen = new Uint8Array(nU);
  const stack = [];
  for (let v = 0; v < nU; v++) {
    const x = PU[v * 3] / HEIGHT, h = PU[v * 3 + 1] / HEIGHT;
    if (cand[v] && h > SPEC.wrist && h < SPEC.elbow && s * x > SPEC.armX + 0.02) { seen[v] = 1; stack.push(v); }
  }
  while (stack.length) {
    const v = stack.pop();
    armSideOf[v] = s;
    for (const u of adj[v]) if (cand[u] && !seen[u]) { seen[u] = 1; stack.push(u); }
  }
}
const skin = computeWeights(PU, HEIGHT, J, SPEC, { armSide: (v) => armSideOf[v] });

// Triângulos que cruzam a fronteira braço/tronco (regiões fundidas na malha original).
// As "pontes" entre mão/antebraço e quadril/coxa (contato fundido abaixo do
// cotovelo) esticam como abas quando o braço se levanta; são removidas.
// As pontes do braço com o tronco perto do ombro ficam (deformação suave).
let cross = 0, bridges = 0;
{
  const keep = [];
  for (let f = 0; f < simp.tris.length; f += 3) {
    const vs = [0, 1, 2].map((k) => used[simp.wedgePos[simp.tris[f + k]]]);
    const r = vs.map((v) => skin.region[v]);
    const arm = r.map((x) => x === 1 || x === 2);
    const isCross = arm.some(Boolean) && !arm.every(Boolean);
    if (isCross) cross++;
    const lowArm = vs.some((v, k) => arm[k] && PU[v * 3 + 1] / HEIGHT < SPEC.elbow);
    if (isCross && lowArm && !args.keepBridges) { bridges++; continue; }
    keep.push(simp.tris[f], simp.tris[f + 1], simp.tris[f + 2]);
  }
  simp.tris = Uint32Array.from(keep);
}

// ---------------------------------------------------- 5. atributos finais
const nW = simp.wedgePos.length;
const pos = new Float32Array(nW * 3), nor = new Float32Array(nW * 3), uv = new Float32Array(nW * 2);
const jnt = new Uint8Array(nW * 4), wgt = new Float32Array(nW * 4);
for (let w = 0; w < nW; w++) {
  const v = used[simp.wedgePos[w]];
  for (let k = 0; k < 3; k++) { pos[w * 3 + k] = PU[v * 3 + k]; nor[w * 3 + k] = NU[v * 3 + k]; }
  uv[w * 2] = simp.wedgeUV[w * 2];
  uv[w * 2 + 1] = 1 - simp.wedgeUV[w * 2 + 1]; // OBJ (v para cima) → glTF (v para baixo)
  for (let k = 0; k < 4; k++) { jnt[w * 4 + k] = skin.idx[v * 4 + k]; wgt[w * 4 + k] = skin.wts[v * 4 + k]; }
}

// Matrizes inversas de ligação: B = T(p)·R0 → B⁻¹ = R0ᵀ · T(−p) (coluna-maior).
const inverseBind = new Float32Array(BONES.length * 16);
BONES.forEach((_, i) => {
  const r = q.inv(bind.R0[i]);
  const ex = q.rot(r, [1, 0, 0]), ey = q.rot(r, [0, 1, 0]), ez = q.rot(r, [0, 0, 1]);
  const t = q.rot(r, bind.pos[i].map((v) => -v));
  inverseBind.set([ex[0], ex[1], ex[2], 0, ey[0], ey[1], ey[2], 0, ez[0], ez[1], ez[2], 0, t[0], t[1], t[2], 1], i * 16);
});

// ------------------------------------------------------------ 6. texturas
const t2 = Date.now();
const baseImg = decodePNG(readFileSync(join(SRC, 'image0.png')));
const base = encodePNG(downscale(baseImg, TEX));
const mrImg = decodePNG(readFileSync(join(SRC, 'image1.png')));
const stats = [0, 1, 2].map((c) => {
  let s = 0, s2 = 0;
  const n = mrImg.width * mrImg.height;
  for (let i = 0; i < n; i++) { const v = mrImg.data[i * 4 + c]; s += v; s2 += v * v; }
  const m = s / n;
  return { mean: +m.toFixed(1), std: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(1) };
});
const mrUniform = stats[1].std < 6 && stats[2].std < 6;
const mr = mrUniform ? null : encodePNG(downscale(mrImg, Math.min(512, mrImg.width)));
log(`texturas: base ${baseImg.width}→${TEX} (${(base.length / 1024).toFixed(0)} KB); metal/rugosidade ${mrImg.width}px G=${JSON.stringify(stats[1])} B=${JSON.stringify(stats[2])} → ${mr ? `${(mr.length / 1024).toFixed(0)} KB` : 'constante'} (${Date.now() - t2} ms)`);

// --------------------------------------------------------------- 7. GLB
const headTop = HEIGHT;
const rig = {
  version: 1,
  bones: BONES,
  parents: PARENT,
  neutralLocal: bind.local.map((v) => v.map((x) => +x.toFixed(5))),
  bindPos: bind.pos.map((v) => v.map((x) => +x.toFixed(5))),
  height: HEIGHT,
  hipsY: +J.hips[1].toFixed(4),
  shoulderY: +J.shoulderL[1].toFixed(4),
  headTop,
  eyeY: +(0.93 * HEIGHT).toFixed(3),
  source: 'third-party OBJ (ImageToStl conversion), auto-rigged by tools/protagonist',
};
const glb = writeSkinnedGLB({
  name: 'protagonist',
  positions: pos, normals: nor, uvs: uv, joints: jnt, weights: wgt, indices: simp.tris,
  bones: BONES, parents: PARENT, bindLocal: bind.bindLocal, inverseBind,
  baseColorPNG: base, metalRoughPNG: mr,
  metallicFactor: mr ? 1 : stats[2].mean / 255, roughnessFactor: mr ? 1 : stats[1].mean / 255,
  rootExtras: { neonRig: rig },
});
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'protagonist.glb'), glb);

const report = {
  generatedAt: new Date().toISOString(),
  source: { positions: np, wedges: src.wedgePos.length, triangles: src.tris.length / 3, objBytes: statSync(join(SRC, 'protagonist.obj')).size },
  output: { triangles: simp.tris.length / 3, vertices: nW, glbBytes: glb.length, baseTexture: TEX, metalRough: mr ? 512 : 'constant' },
  yawCorrectionDeg: +(yaw * 57.2958).toFixed(2),
  spec: SPEC,
  joints: Object.fromEntries(Object.entries(J).map(([k, v]) => [k, v.map((x) => +x.toFixed(4))])),
  handEnds: Object.fromEntries(Object.entries(ends).map(([k, v]) => [k, v.map((x) => +x.toFixed(4))])),
  armVertices: { L: [...armSideOf].filter((s) => s > 0).length, R: [...armSideOf].filter((s) => s < 0).length },
  crossBoundaryTriangles: cross,
  removedHandHipBridges: bridges,
  ms: Date.now() - t0,
};
writeFileSync(join(ROOT, 'assets-src/protagonist/build-report.json'), JSON.stringify(report, null, 2));

// Arquivos intermediários para um auto-rig externo (ex.: Mixamo), caso um dia
// se queira substituir o rig procedural. Ficam só no disco local; enviar a um
// serviço externo exige autorização do dono dos arquivos.
{
  const dir = join(ROOT, 'assets-src/protagonist/mixamo-prep');
  mkdirSync(dir, { recursive: true });
  const lines = ['# NEON CITY protagonist — malha otimizada (1,80 m, pés em y=0, frente +Z)', 'mtllib protagonist_opt.mtl', 'o protagonist'];
  for (let i = 0; i < nU; i++) lines.push(`v ${PU[i * 3].toFixed(5)} ${PU[i * 3 + 1].toFixed(5)} ${PU[i * 3 + 2].toFixed(5)}`);
  for (let w = 0; w < nW; w++) lines.push(`vt ${simp.wedgeUV[w * 2].toFixed(5)} ${simp.wedgeUV[w * 2 + 1].toFixed(5)}`);
  for (let i = 0; i < nU; i++) lines.push(`vn ${NU[i * 3].toFixed(4)} ${NU[i * 3 + 1].toFixed(4)} ${NU[i * 3 + 2].toFixed(4)}`);
  lines.push('usemtl protagonist');
  for (let f = 0; f < simp.tris.length; f += 3) {
    lines.push('f ' + [0, 1, 2].map((k) => { const w = simp.tris[f + k]; const p = used[simp.wedgePos[w]] + 1; return `${p}/${w + 1}/${p}`; }).join(' '));
  }
  writeFileSync(join(dir, 'protagonist_opt.obj'), lines.join('\n'));
  writeFileSync(join(dir, 'protagonist_opt.mtl'), 'newmtl protagonist\nKd 1 1 1\nmap_Kd protagonist_base.png\n');
  writeFileSync(join(dir, 'protagonist_base.png'), base);
}
log(`GLB: ${(glb.length / 1024 / 1024).toFixed(2)} MB, ${report.output.triangles} tris, ${nW} vértices; braço L ${report.armVertices.L} / R ${report.armVertices.R} vértices; ${cross} triângulos na fronteira braço/tronco (${bridges} pontes mão-quadril removidas); ${report.ms} ms`);
log('articulações (m):');
for (const [k, v] of Object.entries(report.joints)) log(`  ${k.padEnd(10)} ${v.map((x) => x.toFixed(3).padStart(7)).join(' ')}`);
