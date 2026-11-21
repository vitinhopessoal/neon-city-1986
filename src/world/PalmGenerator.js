import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../utils/math.js';
import { InstanceTiers } from '../render/InstanceTiers.js';

/**
 * Gerador de palmeiras procedurais com InstancedMesh.
 * - Algumas variantes (curvatura/altura) compartilham materiais.
 * - Tronco segmentado com anéis (cor por vértice) e copa com folhas em
 *   textura recortada (alphaTest).
 * - Vento aplicado no vertex shader (onBeforeCompile): balanço do tronco e
 *   tremulação das folhas, com fase por instância — inclusive nas sombras
 *   (material de profundidade próprio com o mesmo vento).
 * - Dois níveis de detalhe (InstanceTiers): perto = geometria completa com
 *   sombra; longe = tronco e copa simplificados, sem sombra.
 */

const WIND_UNIFORMS = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector3(0.8, 0, -0.6).normalize() },
  uWindStrength: { value: 1 },
};

function windShader(shader) {
  shader.uniforms.uTime = WIND_UNIFORMS.uTime;
  shader.uniforms.uWindDir = WIND_UNIFORMS.uWindDir;
  shader.uniforms.uWindStrength = WIND_UNIFORMS.uWindStrength;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      uniform float uTime;
      uniform vec3 uWindDir;
      uniform float uWindStrength;
      attribute float aSway;
      attribute float aFlutter;
      attribute float aPhase;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec3 wl = uWindDir;
        #ifdef USE_INSTANCING
          wl = normalize(transpose(mat3(instanceMatrix)) * uWindDir);
        #endif
        float t = uTime;
        float gust = 0.75 + 0.25 * sin(t * 0.23 + aPhase * 0.5) * sin(t * 0.37);
        float sway = (sin(t * 0.9 + aPhase) * 0.55 + sin(t * 2.1 + aPhase * 1.7) * 0.22 + 0.35) * gust;
        transformed += wl * sway * aSway * 0.32 * uWindStrength;
        float fl = sin(t * 3.4 + aPhase * 2.3 + position.x * 0.9 + position.z * 0.7);
        transformed.y += fl * aFlutter * 0.13 * uWindStrength;
        transformed += wl * (fl * 0.5 + 0.5) * aFlutter * 0.08 * uWindStrength;
      }`,
    );
}

function setConstAttr(geo, name, value) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n).fill(value);
  geo.setAttribute(name, new THREE.BufferAttribute(arr, 1));
}

/** Tronco ao longo de uma curva, com raio afunilado e anéis. */
function buildTrunk(height, lean, rng, { ringStep = 0.26, radial = 9, coconuts = 5 } = {}) {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(lean * height * 0.1, height * 0.55, 0),
    new THREE.Vector3(lean * height, height, 0),
  );
  const rings = Math.max(6, Math.round(height / ringStep));
  const positions = [], normals = [], colors = [], uvs = [], sway = [], indices = [];
  const cA = new THREE.Color(0x9a8a74), cB = new THREE.Color(0x7c6a55), cTop = new THREE.Color(0x6f7a3e);
  const p = new THREE.Vector3(), tan = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3();
  const up = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    curve.getPoint(t, p);
    curve.getTangent(t, tan);
    nrm.crossVectors(tan, up).normalize();
    bin.crossVectors(tan, nrm).normalize();
    const ring = ringStep < 0.4 ? ((i % 2 === 0) ? 1.07 : 0.97) : 1;
    // Base alargada (raízes) e afunilamento até a copa.
    const flare = t < 0.1 ? 1 + (0.1 - t) * 4.5 : 1;
    const base = THREE.MathUtils.lerp(0.25, 0.15, Math.pow(t, 0.8)) * flare;
    const r = base * ring;
    const col = (i % 2 === 0 ? cA : cB).clone().lerp(cTop, Math.max(0, t - 0.85) * 4);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const wob = 1 + Math.sin(a * 3 + i * 0.7) * 0.025;
      const cx = Math.cos(a) * wob, sx = Math.sin(a) * wob;
      const nx = nrm.x * cx + bin.x * sx, ny = nrm.y * cx + bin.y * sx, nz = nrm.z * cx + bin.z * sx;
      positions.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
      normals.push(nx, ny, nz);
      colors.push(col.r, col.g, col.b);
      uvs.push(j / radial, t * height);
      sway.push(Math.pow(p.y / height, 2));
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(indices);
  setConstAttr(g, 'aFlutter', 0);

  // Cocos e "bainha" no topo.
  const top = curve.getPoint(1);
  const parts = [g];
  const coco = new THREE.SphereGeometry(0.13, 7, 5);
  for (let k = 0; k < coconuts; k++) {
    const a = (k / Math.max(1, coconuts)) * Math.PI * 2 + rng.next();
    const c = coco.clone().translate(top.x + Math.cos(a) * 0.2, top.y - 0.25 - rng.next() * 0.1, top.z + Math.sin(a) * 0.2);
    const n = c.attributes.position.count;
    const cc = new Float32Array(n * 3);
    const col = new THREE.Color(k % 2 ? 0x6b5a2a : 0x7d8a33);
    for (let i = 0; i < n; i++) { cc[i * 3] = col.r; cc[i * 3 + 1] = col.g; cc[i * 3 + 2] = col.b; }
    c.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    setConstAttr(c, 'aSway', 1);
    setConstAttr(c, 'aFlutter', 0);
    parts.push(c);
  }
  const sheath = new THREE.CylinderGeometry(0.17, 0.2, 0.7, Math.min(8, radial)).translate(top.x, top.y - 0.15, top.z);
  {
    const n = sheath.attributes.position.count;
    const cc = new Float32Array(n * 3);
    const col = new THREE.Color(0x6e7a3a);
    for (let i = 0; i < n; i++) { cc[i * 3] = col.r; cc[i * 3 + 1] = col.g; cc[i * 3 + 2] = col.b; }
    sheath.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    setConstAttr(sheath, 'aSway', 1);
    setConstAttr(sheath, 'aFlutter', 0);
  }
  parts.push(sheath);
  const merged = mergeGeometries(parts.map((p2) => (p2.index ? p2 : p2)), false);
  parts.forEach((p2) => p2.dispose());
  coco.dispose();
  return { geometry: merged, top };
}

/** Folha: fita com dobra em "V", curvada e pendente. */
function buildFrond(length, width, droop, lift, color, segs = 12) {
  const positions = [], uvs = [], colors = [], flutter = [], indices = [];
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    const x = s * length;
    const y = Math.sin(s * Math.PI * 0.55) * lift - s * s * droop;
    const w = Math.sin(Math.min(1, s * 1.1) * Math.PI) * width * 0.5 + 0.03;
    const fold = w * 0.38;
    positions.push(x, y - fold, -w, x, y + 0.02, 0, x, y - fold, w);
    uvs.push(0, s, 0.5, s, 1, s);
    for (let k = 0; k < 3; k++) {
      colors.push(color.r, color.g, color.b);
      flutter.push(s * s * (k === 1 ? 0.8 : 1));
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3;
    indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aFlutter', new THREE.Float32BufferAttribute(flutter, 1));
  g.setIndex(indices);
  g.computeVertexNormals();
  setConstAttr(g, 'aSway', 1);
  return g;
}

/** Sorteia a disposição das folhas (compartilhada pelos dois níveis de detalhe). */
function crownParams(rng) {
  const count = rng.int(10, 13);
  const fronds = [];
  for (let i = 0; i < count; i++) {
    const dead = i < 2;
    fronds.push({
      dead,
      len: dead ? rng.range(2.2, 2.8) : rng.range(3.0, 3.9),
      width: rng.range(0.85, 1.1),
      droop: dead ? 2.6 : rng.range(1.0, 1.9),
      lift: dead ? 0.1 : rng.range(0.4, 0.8),
      yaw: (i / count) * Math.PI * 2 + rng.range(-0.2, 0.2),
      pitch: dead ? -0.9 : rng.range(-0.15, 0.35),
    });
  }
  // Folhas jovens, mais curtas e eretas, no centro da copa.
  for (let i = 0; i < 3; i++) {
    fronds.push({ young: true, len: rng.range(1.3, 1.8), width: 0.5, droop: 0.15, lift: 0.35, yaw: (i / 3) * Math.PI * 2 + rng.range(0, 1), pitch: 0.95 + rng.range(0, 0.25) });
  }
  return fronds;
}

function buildCrown(params, { segs = 12, lod = false } = {}) {
  const parts = [];
  // A textura já é verde; a cor por vértice só varia levemente o tom.
  const green = [new THREE.Color(0xffffff), new THREE.Color(0xe4f2c8), new THREE.Color(0xf4ffd8), new THREE.Color(0xd6e8b8)];
  const young = new THREE.Color(0xf0ffc8);
  params.forEach((fp, i) => {
    if (lod && (fp.young || (i % 3 === 2 && !fp.dead))) return; // longe: menos folhas
    const col = fp.dead ? new THREE.Color(0xe0a868) : fp.young ? young : green[i % green.length];
    const f = buildFrond(fp.len, fp.width, fp.droop, fp.lift, col, fp.young ? Math.max(4, segs >> 1) : segs);
    f.rotateZ(fp.pitch);
    f.rotateY(fp.yaw);
    parts.push(f);
  });
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

export class PalmGenerator {
  constructor(lib, { variants = 4, seed = 7 } = {}) {
    this.lib = lib;
    const rng = createRng(seed);
    this.trunkMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    this.trunkMaterial.onBeforeCompile = windShader;
    this.frondMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: lib.textures.frond,
      alphaTest: 0.4,
      alphaToCoverage: true,
      side: THREE.DoubleSide,
      roughness: 0.7,
    });
    this.frondMaterial.onBeforeCompile = windShader;
    // Sombras que balançam junto (mesmo vento no material de profundidade).
    this.trunkDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.trunkDepth.onBeforeCompile = windShader;
    this.frondDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: lib.textures.frond, alphaTest: 0.4, side: THREE.DoubleSide });
    this.frondDepth.onBeforeCompile = windShader;
    this.variants = [];
    for (let i = 0; i < variants; i++) {
      const height = 6.5 + i * 1.6 + rng.range(-0.4, 0.4);
      const lean = [0.06, 0.16, 0.26, 0.11][i % 4];
      const vr = seed * 100 + i * 17;
      const trunk = buildTrunk(height, lean, createRng(vr));
      const trunkFar = buildTrunk(height, lean, createRng(vr), { ringStep: 0.75, radial: 6, coconuts: 0 });
      const params = crownParams(createRng(vr + 5));
      this.variants.push({
        height, top: trunk.top,
        trunk: trunk.geometry, crown: buildCrown(params),
        trunkFar: trunkFar.geometry, crownFar: buildCrown(params, { segs: 5, lod: true }),
      });
    }
    this.uniforms = WIND_UNIFORMS;
    this.nearDistance = 75;
    this.tiers = [];
  }

  /**
   * Cria as InstancedMesh para uma lista de posições.
   * placements: [{ x, y, z, rot, scale, variant }]
   */
  build(placements, parent, collision) {
    const byVariant = this.variants.map(() => []);
    placements.forEach((p, i) => byVariant[(p.variant ?? i) % this.variants.length].push(p));
    const q = new THREE.Quaternion(), s = new THREE.Vector3();
    const e = new THREE.Euler();
    const meshes = [];
    byVariant.forEach((list, vi) => {
      if (list.length === 0) return;
      const v = this.variants[vi];
      const trunkItems = [], crownItems = [];
      for (const p of list) {
        const sc = p.scale ?? 1;
        e.set(0, p.rot ?? 0, 0);
        q.setFromEuler(e);
        s.set(sc, sc, sc);
        const pos = new THREE.Vector3(p.x, p.y ?? 0, p.z);
        const phase = (p.x * 0.37 + p.z * 0.61) % (Math.PI * 2);
        trunkItems.push({ matrix: new THREE.Matrix4().compose(pos, q, s), pos, attrs: { aPhase: phase } });
        // Copa no topo do tronco (mesma rotação/escala).
        const top = v.top.clone().multiplyScalar(sc).applyQuaternion(q).add(pos);
        crownItems.push({ matrix: new THREE.Matrix4().compose(top, q, s), pos, attrs: { aPhase: phase } });
        if (collision) {
          collision.addCylinder({
            id: p.id || undefined, ownerId: p.id || 'palm', x: p.x, z: p.z, radius: 0.3 * sc, tags: ['tree', 'unbreakable'],
            minY: (p.y ?? 0) - 0.5, maxY: (p.y ?? 0) + 4, cameraBlocker: false, walkable: false,
          });
        }
      }
      const trunks = new InstanceTiers(parent, [
        { geometry: v.trunk, material: this.trunkMaterial, castShadow: true, customDepthMaterial: this.trunkDepth, maxDist: this.nearDistance },
        { geometry: v.trunkFar, material: this.trunkMaterial, castShadow: false },
      ], trunkItems, { attrNames: ['aPhase'], name: `palm${vi}:trunk` });
      const crowns = new InstanceTiers(parent, [
        { geometry: v.crown, material: this.frondMaterial, castShadow: true, customDepthMaterial: this.frondDepth, maxDist: this.nearDistance },
        { geometry: v.crownFar, material: this.frondMaterial, castShadow: false },
      ], crownItems, { attrNames: ['aPhase'], name: `palm${vi}:crown` });
      this.tiers.push(trunks, crowns);
      meshes.push(...trunks.meshes, ...crowns.meshes);
    });
    // Estado inicial: tudo como "perto" até a primeira atualização com a câmera.
    for (const t of this.tiers) t.update(new THREE.Vector3(0, 0, 0), true);
    return meshes;
  }

  /** Redistribui perto/longe conforme a câmera (barato: só quando ela anda). */
  updateLOD(camPos, force = false) {
    for (const t of this.tiers) t.update(camPos, force);
  }

  /** Distância da faixa detalhada (acompanha a extensão das sombras do perfil). */
  setNearDistance(d) {
    this.nearDistance = d;
    for (const t of this.tiers) t.setTierDistance(0, d);
  }

  update(elapsed) {
    WIND_UNIFORMS.uTime.value = elapsed;
  }
}
