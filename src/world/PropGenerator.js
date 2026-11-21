import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { composeMatrix } from '../render/StaticBatcher.js';
import { streetSignTexture, customSignTexture } from '../render/ProceduralTextures.js';
import { BREAKABLE_PROFILES, fracturePart } from './DestructionSystem.js';

/**
 * Mobiliário urbano e de praia.
 * Objetos repetidos (postes, bancos, lixeiras, guarda-sóis, cadeiras) usam
 * InstancedMesh: um tipo de objeto = 1 draw call por material.
 */

const _m = new THREE.Matrix4();

/** Constrói a geometria de um tipo de objeto a partir de peças, agrupando por material. */
function makePropType(build) {
  const byMat = new Map();
  const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, color = null) => {
    const g = geometry.clone();
    composeMatrix(x, y, z, rx, ry, rz, sx, sy, sz, _m);
    g.applyMatrix4(_m);
    const keepColor = material.vertexColors && color === null && g.attributes.color;
    for (const name of Object.keys(g.attributes)) {
      if (['position', 'normal', 'uv'].includes(name)) continue;
      if (name === 'color' && keepColor) continue;
      g.deleteAttribute(name);
    }
    if (!g.index) {
      const n = g.attributes.position.count;
      g.setIndex([...Array(n).keys()]);
    }
    if (material.vertexColors && !keepColor) {
      const c = new THREE.Color(color ?? 0xffffff);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    if (!byMat.has(material)) byMat.set(material, []);
    byMat.get(material).push(g);
  };
  build(add);
  const parts = [];
  parts.fragments = [];
  for (const [material, list] of byMat) {
    parts.push({ material, geometry: mergeGeometries(list, false) });
    parts.fragments.push(...list.map(g => fracturePart(g, material)));
    list.forEach((g) => g.dispose());
  }
  return parts;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
const SPH = new THREE.SphereGeometry(1, 12, 8);

function stripedCone(colors, segments = 16, radius = 1.35, height = 0.55) {
  const g = new THREE.ConeGeometry(radius, height, segments, 1, true);
  const ng = g.index ? g.toNonIndexed() : g.clone();
  g.dispose();
  const pos = ng.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const ca = new THREE.Color(colors[0]), cb = new THREE.Color(colors[1]);
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const a = Math.atan2(cz, cx);
    const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * segments) % 2;
    const c = k ? ca : cb;
    for (let j = 0; j < 3; j++) { col[(i + j) * 3] = c.r; col[(i + j) * 3 + 1] = c.g; col[(i + j) * 3 + 2] = c.b; }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.computeVertexNormals();
  return ng;
}

export class PropGenerator {
  constructor(lib, parent, collision, quality, destruction = null) {
    this.lib = lib;
    this.parent = parent;
    this.collision = collision;
    this.quality = quality;
    this.destruction = destruction;
    this.types = this._defineTypes();
    this.placements = new Map();
    this.uniqueMeshes = [];
  }

  _defineTypes() {
    const m = this.lib.m;
    const L = this.lib;
    const lampPole = L.solid(0x2f6f6a, 0.45, 0.5);
    const lampCream = L.solid(0xf2eee2, 0.5, 0.2);
    return {
      lamp: makePropType((add) => {
        add(CYL, lampPole, 0, 0.3, 0, 0, 0, 0, 0.2, 0.6, 0.2);
        add(CYL, lampCream, 0, 0.66, 0, 0, 0, 0, 0.16, 0.12, 0.16);
        add(CYL, lampPole, 0, 3.4, 0, 0, 0, 0, 0.075, 5.6, 0.075);
        add(CYL, lampCream, 0, 6.2, 0, 0, 0, 0, 0.1, 0.12, 0.1);
        add(BOX, lampPole, 0, 6.35, 0.75, 0, 0, 0, 0.08, 0.08, 1.5);
        add(BOX, lampPole, 0, 6.05, 0.3, 0.7, 0, 0, 0.05, 0.05, 0.7);
        add(CYL6, lampCream, 0, 6.3, 1.45, 0, 0, 0, 0.28, 0.2, 0.28);
        add(CYL6, m.lampOn, 0, 6.17, 1.45, 0, 0, 0, 0.22, 0.06, 0.22);
        add(SPH, lampCream, 0, 6.55, 0, 0, 0, 0, 0.1, 0.12, 0.1);
      }),
      stall: makePropType((add) => {
        const wood = L.solid(0xa86d42, 0.85, 0);
        const teal = L.solid(0x36aaa4, 0.9, 0);
        const cream = L.solid(0xffecc7, 0.9, 0);
        for (const x of [-1.25, 1.25]) for (const z of [-0.7, 0.7]) {
          add(BOX, wood, x, 1.2, z, 0, 0, 0, 0.08, 2.4, 0.08);
        }
        for (let i = 0; i < 5; i++) add(BOX, wood, 0, 0.85, -0.6 + i * 0.3, 0, 0, 0, 2.8, 0.08, 0.27);
        for (const side of [-1, 1]) {
          add(BOX, wood, 0, 2.3, side * 0.7, 0, 0, 0, 2.7, 0.08, 0.08);
          for (let i = 0; i < 6; i++) add(BOX, i % 2 ? cream : teal, -1.25 + i * 0.5, 2.48, side * 0.5, side * 0.24, 0, 0, 0.5, 0.035, 1.1);
        }
        add(BOX, teal, 0, 0.48, 0.72, 0, 0, 0, 2.5, 0.65, 0.035);
      }),
      bench: makePropType((add) => {
        const wood = L.solid(0xc98a5a, 0.7, 0);
        const iron = L.solid(0x1f4f4c, 0.45, 0.6);
        for (let i = 0; i < 3; i++) add(BOX, wood, 0, 0.45, -0.12 + i * 0.13, 0, 0, 0, 1.8, 0.04, 0.11);
        for (let i = 0; i < 2; i++) add(BOX, wood, 0, 0.68 + i * 0.17, -0.27, -0.2, 0, 0, 1.8, 0.1, 0.035);
        for (const x of [-0.75, 0.75]) {
          add(BOX, iron, x, 0.22, 0, 0, 0, 0, 0.06, 0.44, 0.4);
          add(BOX, iron, x, 0.7, -0.28, -0.2, 0, 0, 0.06, 0.55, 0.05);
          add(BOX, iron, x, 0.6, 0.02, 0, 0, 0, 0.06, 0.05, 0.42);
        }
      }),
      bin: makePropType((add) => {
        add(CYL, L.solid(0x3aa6a0, 0.5, 0.2), 0, 0.45, 0, 0, 0, 0, 0.3, 0.9, 0.3);
        add(CYL, L.solid(0x2a2c33, 0.5, 0.4), 0, 0.93, 0, 0, 0, 0, 0.32, 0.07, 0.32);
        add(CYL, L.solid(0xf2eee2, 0.5, 0.2), 0, 0.6, 0, 0, 0, 0, 0.305, 0.08, 0.305);
      }),
      // Parquímetro dos anos 80: poste, cabeça com visor e moedeiro.
      parkingMeter: makePropType((add) => {
        const grey = L.solid(0x6f7680, 0.4, 0.6);
        const head = L.solid(0x3a5f8a, 0.35, 0.5);
        add(CYL, grey, 0, 0.55, 0, 0, 0, 0, 0.035, 1.1, 0.035);
        add(BOX, head, 0, 1.2, 0, 0, 0, 0, 0.2, 0.26, 0.16);
        add(SPH, head, 0, 1.33, 0, 0, 0, 0, 0.1, 0.06, 0.08);
        add(BOX, L.solid(0xd8e4ea, 0.1, 0.2, { emissive: 0x334455, emissiveIntensity: 0.2 }), 0, 1.24, 0.081, 0, 0, 0, 0.13, 0.09, 0.004);
        add(BOX, L.solid(0xc9ccd2, 0.3, 0.8), 0, 1.13, 0.081, 0, 0, 0, 0.05, 0.03, 0.006);
      }),
      hydrant: makePropType((add) => {
        const red = L.solid(0xd8342c, 0.45, 0.2);
        add(CYL, red, 0, 0.32, 0, 0, 0, 0, 0.13, 0.64, 0.13);
        add(SPH, red, 0, 0.66, 0, 0, 0, 0, 0.14, 0.12, 0.14);
        add(CYL, red, 0, 0.42, 0, 0, 0, Math.PI / 2, 0.06, 0.42, 0.06);
        add(CYL, L.solid(0xf2c230, 0.5, 0.3), 0, 0.06, 0, 0, 0, 0, 0.18, 0.08, 0.18);
      }),
      lounger: makePropType((add) => {
        const white = L.solid(0xf4f4f0, 0.5, 0.1);
        const cloth = L.solid(0x3cc7c0, 0.9, 0);
        add(BOX, white, 0, 0.32, 0.15, 0, 0, 0, 0.62, 0.05, 1.3);
        add(BOX, white, 0, 0.55, -0.72, -0.85, 0, 0, 0.62, 0.05, 0.7);
        add(BOX, cloth, 0, 0.36, 0.15, 0, 0, 0, 0.56, 0.03, 1.25);
        add(BOX, cloth, 0, 0.58, -0.7, -0.85, 0, 0, 0.56, 0.03, 0.65);
        for (const x of [-0.27, 0.27]) for (const z of [-0.4, 0.7]) add(BOX, white, x, 0.16, z, 0, 0, 0, 0.04, 0.32, 0.04);
      }),
      umbrellaPink: this._umbrella([0xff7fae, 0xfdf6ee]),
      umbrellaTeal: this._umbrella([0x3cc7c0, 0xfdf6ee]),
      umbrellaSun: this._umbrella([0xffb547, 0xff6f4f]),
      towel: makePropType((add) => {
        const cols = [0xff6fae, 0xffffff, 0x3cc7c0, 0xffffff, 0xffb547];
        cols.forEach((c, i) => add(BOX, L.solid(c, 0.95, 0), 0, 0.015, -0.8 + i * 0.4, 0, 0, 0, 0.9, 0.012, 0.4));
      }),
      planter: makePropType((add) => {
        add(CYL, L.solid(0xd7cdbd, 0.85, 0), 0, 0.3, 0, 0, 0, 0, 0.75, 0.6, 0.75);
        add(CYL, L.solid(0x5a4632, 1, 0), 0, 0.61, 0, 0, 0, 0, 0.66, 0.02, 0.66);
      }),
      bush: makePropType((add) => {
        const g1 = L.solid(0x4c8a3a, 0.9, 0), g2 = L.solid(0x5e9e44, 0.9, 0);
        add(SPH, g1, 0, 0.45, 0, 0, 0, 0, 0.8, 0.55, 0.7);
        add(SPH, g2, 0.45, 0.4, 0.2, 0, 0, 0, 0.55, 0.45, 0.5);
        add(SPH, g2, -0.4, 0.38, -0.15, 0, 0, 0, 0.5, 0.4, 0.5);
      }),
      wheelStop: makePropType((add) => {
        add(BOX, L.solid(0xe2ddd2, 0.9, 0), 0, 0.07, 0, 0, 0, 0, 1.8, 0.14, 0.2);
      }),
      newsBox: makePropType((add) => {
        add(BOX, L.solid(0x2a62c9, 0.5, 0.3), 0, 0.55, 0, 0, 0, 0, 0.5, 0.7, 0.45);
        add(BOX, m.glass, 0, 0.65, 0.226, 0, 0, 0, 0.36, 0.3, 0.01);
        add(BOX, L.solid(0x2a2c33, 0.5, 0.5), 0, 0.1, 0, 0, 0, 0, 0.08, 0.2, 0.08);
      }),
      bollard: makePropType((add) => {
        add(CYL, L.solid(0xf2eee2, 0.6, 0.1), 0, 0.45, 0, 0, 0, 0, 0.12, 0.9, 0.12);
        add(CYL, L.solid(0x3aa6a0, 0.6, 0.1), 0, 0.82, 0, 0, 0, 0, 0.125, 0.08, 0.125);
      }),
    };
  }

  _umbrella(colors) {
    const L = this.lib;
    return makePropType((add) => {
      add(CYL, L.solid(0xf4f4f0, 0.5, 0.2), 0, 1.2, 0, 0, 0, 0, 0.035, 2.4, 0.035);
      add(stripedCone(colors), L.m.fabric, 0, 2.35, 0, 0, 0, 0, 1, 1, 1);
      add(SPH, L.solid(0xf4f4f0, 0.5, 0.2), 0, 2.65, 0, 0, 0, 0, 0.05, 0.05, 0.05);
    });
  }

  /** Registra uma instância. Colisão opcional por tipo. */
  place(type, x, y, z, rot = 0, scale = 1, id = null) {
    if (!this.types[type]) throw new Error(`Tipo de objeto desconhecido: ${type}`);
    if (!this.placements.has(type)) this.placements.set(type, []);
    const list = this.placements.get(type);
    const pid = id || `${type}_${list.length}`;
    const collider = this._collider(type, pid, x, y, z, rot, scale);
    list.push({ x, y, z, rot, scale, id: pid, collider });
    return pid;
  }

  _collider(type, id, x, y, z, rot, scale = 1) {
    const c = this.collision;
    const cyl = (r, h, extra = {}) => c.addCylinder({ id: `${id}_col`, ownerId: id, x, z, radius: r * scale, minY: y - 0.2, maxY: y + h * scale, cameraBlocker: false, ...extra });
    const box = (lx, lz, hx, hz, h, extra = {}) => {
      const cs = Math.cos(rot), sn = Math.sin(rot);
      return c.addBox({
        id: `${id}_col`, ownerId: id, cx: x + (lx * cs + lz * sn) * scale, cz: z + (-lx * sn + lz * cs) * scale, hx: hx * scale, hz: hz * scale,
        rotation: rot, minY: y - 0.2, maxY: y + h * scale, cameraBlocker: false, ...extra,
      });
    };
    switch (type) {
      case 'lamp': return cyl(0.2, 6.5, { walkable: false });
      case 'bench': return box(0, -0.05, 0.92, 0.32, 0.5);
      case 'bin': return cyl(0.32, 0.97);
      case 'hydrant': return cyl(0.21, 0.78);
      case 'parkingMeter': return cyl(0.1, 1.4);
      case 'lounger': return box(0, -0.1, 0.32, 0.95, 0.34);
      case 'umbrellaPink': case 'umbrellaTeal': case 'umbrellaSun': return cyl(0.06, 2.7, { walkable: false });
      case 'planter': return cyl(0.76, 0.62);
      case 'newsBox': return box(0, 0, 0.26, 0.24, 0.9);
      case 'bollard': return cyl(0.13, 0.9, { walkable: false });
      case 'stall': return box(0, 0, 1.4, 0.85, 2.8, { walkable: false });
      default: break;
    }
  }

  /** Cria as InstancedMesh de todos os tipos registrados. */
  build() {
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
    let count = 0;
    for (const [type, list] of this.placements) {
      const parts = this.types[type];
      const meshes = [];
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((p, i) => {
          e.set(0, p.rot, 0);
          q.setFromEuler(e);
          s.setScalar(p.scale);
          pos.set(p.x, p.y, p.z);
          im.setMatrixAt(i, _m.compose(pos, q, s));
        });
        im.castShadow = type !== 'towel' && type !== 'wheelStop';
        im.receiveShadow = true;
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.name = `props:${type}`;
        this.parent.add(im);
        meshes.push(im);
        count++;
      }
      if (this.destruction && BREAKABLE_PROFILES[type]) {
        for (const part of parts.fragments) this.destruction.ownedGeometries.add(part.geometry);
        const bounds = new THREE.Box3();
        for (const part of parts) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox); }
        list.forEach((p, index) => {
          meshes[0].getMatrixAt(index, _m);
          const hitbox = this.destruction.createHitbox(p.id, bounds, _m);
          this.destruction.register({ id: p.id, type, matrix: _m, colliders: [p.collider, hitbox].filter(Boolean), fragments: parts.fragments, bindings: meshes.map(mesh => ({ mesh, index })) });
        });
      }
    }
    return count;
  }

  // ---------------------------------------------------------- objetos únicos

  /** Placa de rua dupla (nomes nas duas direções). */
  streetSign(x, y, z, nameA, rotA, nameB) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(CYL, this.lib.solid(0x5a6068, 0.4, 0.7));
    pole.scale.set(0.05, 3.2, 0.05);
    pole.position.y = 1.6;
    pole.castShadow = true;
    g.add(pole);
    const mk = (name, ry, h) => {
      const tex = streetSignTexture(name);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.36, 0.03), mat);
      plate.position.set(0, h, 0);
      plate.rotation.y = ry;
      plate.castShadow = true;
      g.add(plate);
    };
    mk(nameA, rotA, 3.1);
    if (nameB) mk(nameB, rotA + Math.PI / 2, 2.72);
    g.position.set(x, y, z);
    this.parent.add(g);
    const collider = this.collision.addCylinder({ x, z, radius: 0.08, minY: y, maxY: y + 3.2, cameraBlocker: false, walkable: false });
    this.destruction?.registerObject(collider.id, 'streetSign', g, [collider]);
    this.uniqueMeshes.push(g);
    return g;
  }

  /** Placa de trânsito genérica (PARE, limite de velocidade, pedestres, estacionamento). */
  trafficSign(kind, x, y, z, rot) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(CYL, this.lib.solid(0x8a9098, 0.4, 0.7));
    pole.scale.set(0.045, 2.6, 0.045);
    pole.position.y = 1.3;
    pole.castShadow = true;
    g.add(pole);
    let plate;
    if (kind === 'stop') {
      const tex = customSignTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
          ctx.lineTo(w / 2 + Math.cos(a) * w * 0.5, h / 2 + Math.sin(a) * h * 0.5);
        }
        ctx.fill();
        ctx.fillStyle = '#c8202a';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
          ctx.lineTo(w / 2 + Math.cos(a) * w * 0.46, h / 2 + Math.sin(a) * h * 0.46);
        }
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 78px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('STOP', w / 2, h / 2 + 4);
      });
      const geo = new THREE.CylinderGeometry(0.38, 0.38, 0.03, 8, 1);
      geo.rotateX(Math.PI / 2);
      geo.rotateZ(Math.PI / 8);
      const back = this.lib.solid(0x9aa0a8, 0.5, 0.5);
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
      plate = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78), face);
      plate.position.set(0, 2.35, 0.02);
      const b = new THREE.Mesh(geo, back);
      b.position.set(0, 2.35, 0);
      b.castShadow = true;
      g.add(b);
    } else {
      const draw = {
        speed: (ctx, w, h) => {
          ctx.fillStyle = '#f7f7f2'; ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, w - 20, h - 20);
          ctx.fillStyle = '#111'; ctx.textAlign = 'center';
          ctx.font = 'bold 44px Arial, sans-serif'; ctx.fillText('SPEED', w / 2, 70); ctx.fillText('LIMIT', w / 2, 118);
          ctx.font = 'bold 120px Arial, sans-serif'; ctx.fillText('30', w / 2, 236);
        },
        ped: (ctx, w, h) => {
          ctx.fillStyle = '#f5d22a';
          ctx.beginPath(); ctx.moveTo(w / 2, 6); ctx.lineTo(w - 6, h / 2); ctx.lineTo(w / 2, h - 6); ctx.lineTo(6, h / 2); ctx.fill();
          ctx.strokeStyle = '#111'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(w / 2, 18); ctx.lineTo(w - 18, h / 2); ctx.lineTo(w / 2, h - 18); ctx.lineTo(18, h / 2); ctx.closePath(); ctx.stroke();
          ctx.fillStyle = '#111';
          ctx.beginPath(); ctx.arc(w / 2, 82, 16, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 14; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(w / 2, 104); ctx.lineTo(w / 2 - 6, 158); ctx.lineTo(w / 2 - 30, 196);
          ctx.moveTo(w / 2 - 6, 158); ctx.lineTo(w / 2 + 26, 196);
          ctx.moveTo(w / 2 - 30, 128); ctx.lineTo(w / 2 + 30, 136); ctx.stroke();
        },
        parking: (ctx, w, h) => {
          ctx.fillStyle = '#1f55b8'; ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.strokeRect(12, 12, w - 24, h - 24);
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = 'bold 170px Arial, sans-serif'; ctx.fillText('P', w / 2, h / 2 - 10);
          ctx.font = 'bold 30px Arial, sans-serif'; ctx.fillText('CUSTOMER PARKING', w / 2, h - 40);
        },
        closed: (ctx, w, h) => {
          ctx.fillStyle = '#f28a1a'; ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, w - 20, h - 20);
          ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = 'bold 64px Arial, sans-serif'; ctx.fillText('ROAD', w / 2, h * 0.36); ctx.fillText('CLOSED', w / 2, h * 0.66);
        },
      }[kind];
      const tex = customSignTexture(256, 256, draw);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.1 });
      plate = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.03), mat);
      plate.position.set(0, 2.2, 0.03);
      if (kind === 'ped') plate.scale.setScalar(1.05);
    }
    plate.castShadow = true;
    g.add(plate);
    g.position.set(x, y, z);
    g.rotation.y = rot;
    this.parent.add(g);
    const collider = this.collision.addCylinder({ x, z, radius: 0.07, minY: y, maxY: y + 2.6, cameraBlocker: false, walkable: false });
    this.destruction?.registerObject(collider.id, 'trafficSign', g, [collider]);
    this.uniqueMeshes.push(g);
    return g;
  }

  /** Cavalete listrado "ROAD CLOSED" (limite físico do bairro). */
  barricade(batcher, x, y, z, rot, width = 3) {
    const L = this.lib;
    const white = L.solid(0xf6f4ee, 0.6, 0);
    const orange = L.solid(0xf06a1a, 0.6, 0);
    const n = Math.round(width / 0.4);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const at = (lx, ly, lz, sx, sy, sz, mat, rz = 0) => {
      composeMatrix(x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs, 0, rot, rz, sx, sy, sz, _m);
      batcher.add(BOX, mat, _m, null);
    };
    for (const ly of [0.65, 1.05]) {
      for (let i = 0; i < n; i++) {
        at(-width / 2 + (i + 0.5) * (width / n), ly, 0, width / n, 0.24, 0.04, i % 2 ? white : orange);
      }
    }
    for (const lx of [-width / 2 + 0.15, width / 2 - 0.15]) {
      at(lx, 0.6, 0.18, 0.06, 1.25, 0.06, white, 0);
      at(lx, 0.6, -0.18, 0.06, 1.25, 0.06, white, 0);
    }
    at(width / 2 - 0.1, 1.32, 0, 0.14, 0.16, 0.14, L.neon(0xffa020, 2.0));
  }

  /** Cabine telefônica dos anos 80. */
  phoneBooth(batcher, x, y, z, rot) {
    const L = this.lib;
    const group = new THREE.Group();
    group.position.set(x, y, z); group.rotation.y = rot;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const at = (geo, mat, lx, ly, lz, sx, sy, sz) => {
      if (this.destruction) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(lx, ly, lz); mesh.scale.set(sx, sy, sz);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        return;
      }
      composeMatrix(x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs, 0, rot, 0, sx, sy, sz, _m);
      batcher.add(geo, mat, _m, null);
    };
    const steel = L.solid(0xc9ced6, 0.3, 0.8);
    const blue = L.solid(0x2457b8, 0.5, 0.2);
    at(BOX, steel, 0, 1.2, -0.38, 0.9, 2.4, 0.06);
    at(BOX, steel, -0.43, 1.2, 0, 0.05, 2.4, 0.8);
    at(BOX, steel, 0.43, 1.2, 0, 0.05, 2.4, 0.8);
    at(BOX, L.m.glass, -0.43, 1.25, 0, 0.06, 1.6, 0.6);
    at(BOX, L.m.glass, 0.43, 1.25, 0, 0.06, 1.6, 0.6);
    at(BOX, blue, 0, 2.5, 0, 0.95, 0.25, 0.85);
    at(BOX, L.m.lampOn, 0, 2.5, 0.43, 0.7, 0.14, 0.01);
    at(BOX, L.solid(0x30333a, 0.5, 0.5), 0, 1.35, -0.3, 0.32, 0.5, 0.12);
    at(BOX, L.solid(0x111111, 0.4, 0.3), 0.12, 1.45, -0.22, 0.06, 0.22, 0.06);
    const collider = this.collision.addBox({ cx: x - 0.0 * cs, cz: z, hx: 0.5, hz: 0.45, rotation: rot, minY: y, maxY: y + 2.6, cameraBlocker: false, walkable: false });
    if (this.destruction) {
      this.parent.add(group);
      this.uniqueMeshes.push(group);
      this.destruction.registerObject(collider.id, 'phoneBooth', group, [collider]);
    }
  }
}
