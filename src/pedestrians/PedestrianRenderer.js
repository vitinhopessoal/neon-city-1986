import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Pedestres estilizados "low-poly semirrealistas", desenhados com uma
 * InstancedMesh por parte do corpo (13 draw calls para toda a população).
 * Cada pedestre tem esqueleto simples (quadril, joelhos, ombros, cotovelos,
 * cabeça) animado proceduralmente e cores por instância (roupas dos anos 80).
 */
const PARTS = ['pelvis', 'torso', 'head', 'hair', 'hairLong', 'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'skirt', 'glasses'];
const PAIRED = new Set(['upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot']);

function torsoGeo() {
  const prof = [[0.0, 0.0], [0.155, 0.0], [0.158, 0.1], [0.165, 0.22], [0.185, 0.34], [0.19, 0.4], [0.16, 0.46], [0.08, 0.5], [0.0, 0.51]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(prof, 9);
  g.scale(1, 1, 0.64);
  return g;
}

function headGeo() {
  const head = new THREE.SphereGeometry(0.105, 9, 7);
  head.scale(0.94, 1.12, 1.02);
  const neck = new THREE.CylinderGeometry(0.048, 0.054, 0.1, 6).translate(0, -0.11, 0);
  const nose = new THREE.ConeGeometry(0.018, 0.045, 6).rotateX(Math.PI / 2 - 0.25).translate(0, -0.005, 0.105);
  const parts = [head, neck, nose].map((g) => g.toNonIndexed());
  const merged = new THREE.BufferGeometry();
  const pos = [], nor = [];
  for (const g of parts) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return merged;
}

export function partGeometries() {
  return {
    pelvis: new RoundedBoxGeometry(0.33, 0.2, 0.22, 1, 0.06),
    torso: torsoGeo(),
    head: headGeo(),
    hair: new THREE.SphereGeometry(0.115, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(1.0, 1.05, 1.08).rotateX(-0.35).translate(0, 0.018, -0.012),
    hairLong: new RoundedBoxGeometry(0.2, 0.26, 0.08, 1, 0.03).translate(0, -0.06, -0.085),
    upperArm: new THREE.CapsuleGeometry(0.05, 0.2, 2, 6).translate(0, -0.14, 0),
    forearm: new THREE.CapsuleGeometry(0.041, 0.17, 2, 6).translate(0, -0.12, 0),
    hand: new RoundedBoxGeometry(0.045, 0.09, 0.075, 1, 0.015).translate(0, -0.05, 0.005),
    thigh: new THREE.CapsuleGeometry(0.074, 0.28, 2, 7).translate(0, -0.2, 0),
    shin: new THREE.CapsuleGeometry(0.058, 0.3, 2, 6).translate(0, -0.2, -0.005),
    foot: new RoundedBoxGeometry(0.1, 0.075, 0.25, 1, 0.025).translate(0, -0.04, 0.05),
    skirt: new THREE.CylinderGeometry(0.17, 0.28, 0.42, 9, 1, true).translate(0, -0.15, 0),
    glasses: new RoundedBoxGeometry(0.15, 0.035, 0.03, 1, 0.008).translate(0, 0.02, 0.1),
  };
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

export class PedestrianRenderer {
  constructor(scene, capacity) {
    this.capacity = capacity;
    this.geos = partGeometries();
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 });
    this.matSkirt = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: THREE.DoubleSide });
    this.matGlasses = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.25, metalness: 0.4 });
    this.meshes = {};
    this.group = new THREE.Group();
    this.group.name = 'pedestrians';
    for (const p of PARTS) {
      const n = PAIRED.has(p) ? capacity * 2 : capacity;
      const mat = p === 'skirt' ? this.matSkirt : p === 'glasses' ? this.matGlasses : this.mat;
      const m = new THREE.InstancedMesh(this.geos[p], mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (p !== 'glasses') m.setColorAt(0, new THREE.Color(1, 1, 1));
      for (let i = 0; i < n; i++) m.setMatrixAt(i, _zero);
      m.count = n;
      m.castShadow = p === 'torso' || p === 'thigh' || p === 'shin' || p === 'pelvis' || p === 'head';
      m.receiveShadow = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.meshes[p] = m;
    }
    scene.add(this.group);
    this.triangles = Object.entries(this.geos).reduce((s, [k, g]) => s + (g.index ? g.index.count : g.attributes.position.count) / 3 * (PAIRED.has(k) ? 2 : 1), 0);
  }

  /** Cores do visual (uma vez, ao criar/reciclar o pedestre). */
  applyLook(slot, look) {
    const M = this.meshes;
    const c = new THREE.Color();
    const set = (part, i, hex) => { M[part].setColorAt(i, c.setHex(hex)); };
    set('pelvis', slot, look.pants);
    set('torso', slot, look.top);
    set('head', slot, look.skin);
    set('hair', slot, look.hair);
    set('hairLong', slot, look.hair);
    set('skirt', slot, look.skirt ?? look.pants);
    for (const k of [0, 1]) {
      const i = slot * 2 + k;
      set('upperArm', i, look.sleeve);
      set('forearm', i, look.forearm);
      set('hand', i, look.skin);
      set('thigh', i, look.thigh);
      set('shin', i, look.shin);
      set('foot', i, look.shoes);
    }
    for (const p of PARTS) if (M[p].instanceColor) M[p].instanceColor.needsUpdate = true;
  }

  /** Desenha só até o maior slot ativo (instâncias ocultas não custam). */
  setActiveCount(n) {
    for (const p of PARTS) this.meshes[p].count = PAIRED.has(p) ? n * 2 : n;
  }

  hide(slot) {
    for (const p of PARTS) {
      const M = this.meshes[p];
      if (PAIRED.has(p)) { M.setMatrixAt(slot * 2, _zero); M.setMatrixAt(slot * 2 + 1, _zero); }
      else M.setMatrixAt(slot, _zero);
      M.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Escreve as matrizes de um pedestre.
   * pose: { thighL, thighR, kneeL, kneeR, armL, armR, elbowL, elbowR, armOut, bob,
   *         twist, headYaw, headPitch, lean, sit, lie } (radianos / metros)
   */
  write(slot, ped, pose) {
    const M = this.meshes, look = ped.look;
    // Raiz: posição, rumo, escala (altura/largura) e "deitado" (atropelado).
    _e.set(-pose.lie * (Math.PI / 2 - 0.05), ped.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(ped.x, ped.y + pose.bob - pose.sit * 0.47 + pose.lie * 0.12, ped.z);
    _s.set(look.width, look.height, look.width);
    const root = this._root || (this._root = new THREE.Matrix4());
    root.compose(_p, _q, _s);
    if (ped.parentMatrix) root.premultiply(ped.parentMatrix);

    const put = (part, i, mat) => M[part].setMatrixAt(i, mat);
    // Matrizes temporárias reaproveitadas (sem alocação por quadro).
    const pool = this._mpool || (this._mpool = Array.from({ length: 32 }, () => new THREE.Matrix4()));
    let pi = 0;
    const local = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, parent = root) => {
      _e.set(rx, ry, rz, 'XYZ');
      _q.setFromEuler(_e);
      _p.set(x, y, z);
      _s.set(sx, sy, sz);
      return pool[pi++].multiplyMatrices(parent, _m.compose(_p, _q, _s));
    };
    // Quadril e tronco.
    const pelvis = local(0, 0.95, 0, pose.lean * 0.3, pose.twist * -0.5, 0);
    put('pelvis', slot, pelvis);
    const torso = local(0, 0.05, 0, pose.lean, pose.twist, 0, look.chest, 1, look.chest, pelvis);
    put('torso', slot, torso);
    put('skirt', slot, look.skirt !== undefined ? local(0, 0.0, 0, 0, 0, 0, 1, look.skirtLen, 1, pelvis) : _zero);
    // Cabeça (com cabelo e óculos opcionais).
    const head = local(0, 0.6, 0.01, pose.headPitch - pose.lean * 0.6, pose.headYaw, 0, 1, 1, 1, torso);
    put('head', slot, head);
    put('hair', slot, local(0, 0.0, 0, 0, 0, 0, look.hairVol, look.hairVol, look.hairVol, head));
    put('hairLong', slot, look.longHair ? local(0, 0, 0, 0, 0, 0, 1, 1, 1, head) : _zero);
    put('glasses', slot, look.glasses ? head : _zero);
    // Braços.
    for (const [k, sgn] of [[0, 1], [1, -1]]) {
      const sh = k === 0 ? pose.armL : pose.armR;
      const el = k === 0 ? pose.elbowL : pose.elbowR;
      const upper = local(sgn * 0.19, 0.42, 0, -sh, 0, sgn * (0.08 + pose.armOut), 1, 1, 1, torso);
      put('upperArm', slot * 2 + k, upper);
      const fore = local(0, -0.28, 0, -el, 0, 0, 1, 1, 1, upper);
      put('forearm', slot * 2 + k, fore);
      put('hand', slot * 2 + k, local(0, -0.24, 0, 0, 0, 0, 1, 1, 1, fore));
    }
    // Pernas.
    for (const [k, sgn] of [[0, 1], [1, -1]]) {
      const th = k === 0 ? pose.thighL : pose.thighR;
      const kn = k === 0 ? pose.kneeL : pose.kneeR;
      // spread (opcional): abertura lateral das pernas (pilotos de moto contornam o tanque).
      const thigh = local(sgn * 0.092, -0.04, 0, -th, 0, sgn * (0.03 + (pose.spread || 0)), 1, 1, 1, pelvis);
      put('thigh', slot * 2 + k, thigh);
      const shin = local(0, -0.42, 0, kn, 0, 0, 1, 1, 1, thigh);
      put('shin', slot * 2 + k, shin);
      put('foot', slot * 2 + k, local(0, -0.41, 0, -Math.max(0, kn) * 0.3 + pose.footPitch, 0, 0, 1, 1, 1, shin));
    }
    for (const p of PARTS) M[p].instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    for (const m of Object.values(this.meshes)) m.dispose();
    for (const g of Object.values(this.geos)) g.dispose();
    this.mat.dispose();
    this.matSkirt.dispose();
    this.matGlasses.dispose();
  }
}

// ----------------------------------------------------------- visuais 80s
const SKIN = [0xf1c9a5, 0xe0ac7e, 0xc68c5f, 0xa86b45, 0x7d4a2b, 0x5c3420];
const HAIR = [0x1d1410, 0x3b2516, 0x6b4426, 0xb8894a, 0xe2c27a, 0x8a2f1c, 0x9a9a9a];
const NEON = [0xff4fb8, 0x3ff0ff, 0xf4d35e, 0x8a5cff, 0x5dff9c, 0xff9a4a, 0xff6f6f];
const PASTEL = [0xf6c1d6, 0xb8e6e1, 0xfff1b5, 0xd7c8f2, 0xc9f0d0, 0xffd3b0, 0xe8e8e8, 0xa7d3f5];
const DARK = [0x23263a, 0x3a3f58, 0x2b4a6f, 0x4a3a2a, 0x333333];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/** Combinação aleatória de roupas dos anos 80 (estilos variados). */
export function randomLook() {
  const style = pick(['beach', 'beach', 'casual', 'casual', 'suit', 'track', 'dress', 'tourist', 'elder']);
  const skin = pick(SKIN);
  const female = Math.random() < 0.5;
  const L = {
    style, skin, female,
    hair: Math.random() < 0.12 ? 0x9a9a9a : pick(HAIR),
    hairVol: 1 + Math.random() * (female ? 0.35 : 0.15),
    longHair: female && Math.random() < 0.6,
    glasses: Math.random() < 0.3,
    height: (female ? 0.94 : 1.0) * (0.95 + Math.random() * 0.09),
    width: 0.92 + Math.random() * 0.16,
    chest: female ? 0.94 : 1.0,
    shoes: pick([0xf5f5f0, 0xf5f5f0, 0x2a2a2a, 0x7a4a2a]),
  };
  const shortsLegs = (shorts) => { L.thigh = shorts; L.shin = skin; L.pants = shorts; };
  switch (style) {
    case 'beach': L.top = pick(NEON); L.sleeve = skin; L.forearm = skin; shortsLegs(pick([...PASTEL, ...NEON])); break;
    case 'casual': L.top = pick(PASTEL); L.sleeve = L.top; L.forearm = skin; L.pants = L.thigh = L.shin = pick([0x3b5b8c, 0x4b6ea8, 0xe9e4d8, 0x2b2b2b]); break;
    case 'suit': L.top = pick(PASTEL); L.sleeve = L.forearm = L.top; L.pants = L.thigh = L.shin = Math.random() < 0.6 ? 0xeee9dc : L.top; L.shoes = pick([0xf5f5f0, 0x6b4426]); break;
    case 'track': L.top = pick(NEON); L.sleeve = L.forearm = L.top; L.pants = L.thigh = L.shin = pick([...DARK, L.top]); L.shoes = 0xf5f5f0; break;
    case 'dress': L.top = pick([...NEON, ...PASTEL]); L.sleeve = Math.random() < 0.5 ? skin : L.top; L.forearm = skin; L.pants = L.top; L.thigh = skin; L.shin = skin; L.skirt = L.top; L.skirtLen = 0.9 + Math.random() * 0.3; break;
    case 'tourist': L.top = pick([0xff6f9f, 0x3fd8d0, 0xf4d35e, 0x7ad35e]); L.sleeve = L.top; L.forearm = skin; shortsLegs(pick([0xd8c69a, 0xc2b280])); break;
    default: L.top = pick([0xc9b8a0, 0x9fb4c7, 0xd8c3d6]); L.sleeve = L.forearm = L.top; L.pants = L.thigh = L.shin = pick([0x6b6b6b, 0x8a7a64, 0xd8d2c4]); L.hair = 0xbdbdbd; break;
  }
  if (style === 'dress' && !female) { L.style = 'casual'; L.skirt = undefined; L.thigh = L.shin = L.pants = 0xe9e4d8; }
  return L;
}
