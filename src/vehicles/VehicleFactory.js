import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Vehicle } from './Vehicle.js';
import { licensePlateTexture } from '../render/ProceduralTextures.js';
import { composeMatrix } from '../render/StaticBatcher.js';
import { NEON_SPECS, NeonModelLibrary, buildNeonVehicle } from './models/NeonMotor.js';

/**
 * Modelos procedurais de carros dos anos 80 (originais):
 *  - NEON GT        (sports)      esportivo baixo em cunha, faróis escamoteáveis
 *  - SUNSET CLASSIC (convertible) conversível com interior visível
 *  - PALM SEDAN     (sedan)       sedã quatro portas, cromados
 * Frente para +Z, origem no chão sob o centro do carro; lado do motorista = +X.
 *
 * Cada carro tem: carroceria com vão real da cabine (portas articuladas
 * fecham o vão), interior (bancos, painel, volante com pivô, assoalho),
 * rodas independentes (pivô de esterçamento + giro + suspensão), faróis,
 * lanternas, luzes de freio e ré (materiais próprios por veículo),
 * retrovisores, para-choques, escapamento e placa.
 * Os parâmetros de dirigibilidade ficam em `handling` (consumidos por VehiclePhysics).
 */

const _m = new THREE.Matrix4();
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14, 1);
const TIRE = new THREE.CylinderGeometry(1, 1, 1, 24, 1).rotateZ(Math.PI / 2);
// Recursos compartilhados entre todos os veículos (nunca descartados por um veículo).
for (const g of [BOX, CYL, TIRE]) g.userData.shared = true;
const _rimCache = new Map();

/**
 * Conjunto da roda (aro, raios, cubo e calota) fundido numa única geometria
 * metálica. Eixo da roda = X; face externa voltada para +X.
 * style: 'turbine' (esportivo), 'hubcap' (sedã), 'spoke' (conversível).
 */
function rimGeometry(style, r) {
  const key = `${style}|${r}`;
  let g = _rimCache.get(key);
  if (g) return g;
  const parts = [];
  const add = (geo, x, y, z, rx, ry, rz, sx, sy, sz) => {
    const c = geo.clone();
    composeMatrix(x, y, z, rx, ry, rz, sx, sy, sz, _m);
    c.applyMatrix4(_m);
    for (const n of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(n)) c.deleteAttribute(n);
    parts.push(c.index ? c.toNonIndexed() : c);
  };
  const disc = new THREE.CylinderGeometry(1, 1, 1, 24, 1).rotateZ(Math.PI / 2);
  const ring = new THREE.TorusGeometry(1, 0.06, 6, 28).rotateY(Math.PI / 2);
  const box = new THREE.BoxGeometry(1, 1, 1);
  add(disc, 0.1, 0, 0, 0, 0, 0, 0.02, r * 0.62, r * 0.62);
  add(ring, 0.125, 0, 0, 0, 0, 0, 1, r * 0.64, r * 0.64);
  if (style === 'hubcap') {
    add(disc, 0.122, 0, 0, 0, 0, 0, 0.03, r * 0.5, r * 0.5);
    add(ring, 0.14, 0, 0, 0, 0, 0, 1, r * 0.36, r * 0.36);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      add(box, 0.138, Math.sin(a) * r * 0.43, Math.cos(a) * r * 0.43, -a, 0, 0, 0.012, 0.012, r * 0.12);
    }
  } else {
    const n = style === 'turbine' ? 5 : 8;
    const wid = style === 'turbine' ? r * 0.2 : r * 0.05;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      add(box, 0.12, Math.sin(a) * r * 0.32, Math.cos(a) * r * 0.32, -a, 0, 0, 0.035, wid, r * 0.56);
    }
  }
  add(disc, 0.15, 0, 0, 0, 0, 0, 0.04, r * 0.16, r * 0.16);
  g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  disc.dispose(); ring.dispose(); box.dispose();
  g.computeVertexNormals();
  g.userData.shared = true;
  _rimCache.set(key, g);
  return g;
}

/**
 * Especificações. Coordenadas do perfil: [z, y] (frente = +z).
 * cabin: vão da cabine recortado na carroceria (portas o fecham).
 * seats: quadril (hipY), inclinação do encosto (recline, rad).
 */
export const SPECS = {
  sports: {
    model: 'Neon GT', category: 'Esportivo',
    length: 4.45, width: 1.86, height: 1.24, wheelBase: 2.5, track: 1.56, wheelRadius: 0.33, floorY: 0.36,
    profile: [[-2.22, 0.3], [-2.22, 0.8], [-1.3, 0.87], [0.95, 0.87], [1.95, 0.68], [2.24, 0.52], [2.22, 0.3]],
    green: [[-1.28, 0.86], [-0.55, 1.2], [0.15, 1.22], [0.98, 0.86]],
    roof: { z: -0.2, len: 0.72, y: 1.22 },
    cabin: { z0: -0.66, z1: 0.64, y0: 0.36, y1: 0.8, sideZ0: -0.72, sideZ1: 0.7 },
    doors: [{ id: 'driver', side: 1, z0: -0.72, z1: 0.7, seat: 'driver' }, { id: 'passenger', side: -1, z0: -0.72, z1: 0.7, seat: 'passenger' }],
    seats: [
      { id: 'driver', x: 0.4, hipY: 0.44, z: 0.05, recline: 0.55, driver: true },
      { id: 'passenger', x: -0.4, hipY: 0.44, z: 0.05, recline: 0.55 },
    ],
    wheel: { y: 0.9, z: 0.42, tilt: 1.15 }, dashZ: 0.74,
    exhaust: [0.5, -0.5],
    popups: true,
    handling: {
      mass: 1250, engineForce: 9200, brakeForce: 14500, handbrakeForce: 5200, engineBrake: 1500,
      maxSpeed: 62, reverseSpeed: 9, steerMax: 0.58, steerSpeed: 3.4, steerReturn: 5.0, steerSpeedFalloff: 0.045,
      grip: 1.12, handbrakeGrip: 0.42, corneringFront: 9.5, corneringRear: 10.5, drag: 0.36, rolling: 11,
      inertiaScale: 1.0, stability: 0.55,
      suspension: { freq: 2.5, damping: 0.62, travel: 0.06 }, rollGain: 0.018, pitchGain: 0.01,
      gears: [0, 13, 22, 31, 40, 50, 62], idleRpm: 850, redline: 7200, cylinders: 8, enginePitch: 1.0,
    },
  },
  convertible: {
    model: 'Sunset Classic', category: 'Conversível',
    length: 4.6, width: 1.82, height: 1.2, wheelBase: 2.65, track: 1.52, wheelRadius: 0.33, floorY: 0.46,
    profile: [[-2.3, 0.3], [-2.3, 0.84], [-1.5, 0.89], [-1.4, 0.8], [-0.9, 0.8], [-0.86, 0.46], [0.62, 0.46], [0.74, 0.9], [2.1, 0.78], [2.3, 0.56], [2.3, 0.3]],
    green: null,
    roof: null,
    cabin: null,
    doors: [{ id: 'driver', side: 1, z0: -0.84, z1: 0.6, seat: 'driver', open: true }, { id: 'passenger', side: -1, z0: -0.84, z1: 0.6, seat: 'passenger', open: true }],
    seats: [
      { id: 'driver', x: 0.4, hipY: 0.62, z: -0.25, recline: 0.3, driver: true },
      { id: 'passenger', x: -0.4, hipY: 0.62, z: -0.25, recline: 0.3 },
      { id: 'rear', x: 0, hipY: 0.92, z: -1.15, recline: 0.15, rear: true },
    ],
    wheel: { y: 1.0, z: 0.22, tilt: 1.05 }, dashZ: 0.5,
    exhaust: [0.45, -0.45],
    handling: {
      mass: 1360, engineForce: 7300, brakeForce: 12500, handbrakeForce: 5000, engineBrake: 1300,
      maxSpeed: 52, reverseSpeed: 8, steerMax: 0.55, steerSpeed: 2.6, steerReturn: 4.0, steerSpeedFalloff: 0.04,
      grip: 1.0, handbrakeGrip: 0.45, corneringFront: 8.5, corneringRear: 9.5, drag: 0.42, rolling: 12,
      inertiaScale: 1.1, stability: 0.7,
      suspension: { freq: 1.75, damping: 0.42, travel: 0.08 }, rollGain: 0.034, pitchGain: 0.018,
      gears: [0, 12, 21, 30, 41, 52], idleRpm: 750, redline: 6000, cylinders: 8, enginePitch: 0.85,
    },
  },
  sedan: {
    model: 'Palm Sedan', category: 'Sedã',
    length: 4.95, width: 1.86, height: 1.42, wheelBase: 2.8, track: 1.54, wheelRadius: 0.34, floorY: 0.42,
    profile: [[-2.46, 0.33], [-2.46, 0.93], [-1.5, 0.96], [1.25, 0.96], [2.42, 0.89], [2.48, 0.62], [2.46, 0.33]],
    green: [[-1.52, 0.95], [-0.98, 1.4], [0.78, 1.42], [1.27, 0.95]],
    roof: { z: -0.1, len: 1.78, y: 1.42 },
    cabin: { z0: -0.84, z1: 0.84, y0: 0.42, y1: 0.9, sideZ0: -0.9, sideZ1: 0.9 },
    doors: [
      { id: 'driver', side: 1, z0: 0.0, z1: 0.9, seat: 'driver' },
      { id: 'passenger', side: -1, z0: 0.0, z1: 0.9, seat: 'passenger' },
      { id: 'rearLeft', side: 1, z0: -0.9, z1: -0.02, seat: 'rearLeft' },
      { id: 'rearRight', side: -1, z0: -0.9, z1: -0.02, seat: 'rearRight' },
    ],
    seats: [
      // Banco mais baixo: olhos a ~1,21 m (teto interno ~1,40 m) na câmera interna.
      { id: 'driver', x: 0.38, hipY: 0.5, z: 0.25, recline: 0.35, driver: true },
      { id: 'passenger', x: -0.38, hipY: 0.5, z: 0.25, recline: 0.35 },
      { id: 'rearLeft', x: 0.4, hipY: 0.56, z: -0.72, recline: 0.3, rear: true },
      { id: 'rearRight', x: -0.4, hipY: 0.56, z: -0.72, recline: 0.3, rear: true },
    ],
    wheel: { y: 1.0, z: 0.6, tilt: 1.15 }, dashZ: 0.98,
    exhaust: [-0.55],
    handling: {
      mass: 1620, engineForce: 6900, brakeForce: 12000, handbrakeForce: 4800, engineBrake: 1400,
      maxSpeed: 45, reverseSpeed: 7.5, steerMax: 0.52, steerSpeed: 2.2, steerReturn: 3.6, steerSpeedFalloff: 0.035,
      grip: 1.05, handbrakeGrip: 0.5, corneringFront: 8.0, corneringRear: 10.0, drag: 0.48, rolling: 14,
      inertiaScale: 1.2, stability: 0.9,
      suspension: { freq: 1.4, damping: 0.38, travel: 0.1 }, rollGain: 0.045, pitchGain: 0.024,
      gears: [0, 13, 25, 35, 45], idleRpm: 700, redline: 5200, cylinders: 6, enginePitch: 0.75,
    },
  },
};
// PROMPT 12 — NEON MOTOR COMPANY: nove modelos GLB adicionais (mesmo formato de especificação).
Object.assign(SPECS, NEON_SPECS);

/**
 * Perfil com o "cockpit" aberto: a borda superior desce até o assoalho entre
 * z0 e z1 (parte central da carroceria). As laterais mantêm a linha de cintura.
 */
function withCockpit(points, z0, z1, floor) {
  const out = [];
  let state = 0;
  const yAt = (a, b, z) => a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (state !== 1) out.push(p);
    const q = points[i + 1];
    if (!q) break;
    if (state === 0 && q[0] > p[0] && p[0] <= z0 && q[0] > z0) {
      out.push([z0, yAt(p, q, z0)], [z0, floor]);
      state = 1;
    }
    if (state === 1 && q[0] > p[0] && q[0] >= z1) {
      out.push([z1, floor], [z1, yAt(p, q, z1)]);
      state = 2;
    }
  }
  return out;
}

function profileShape(points, wheelBase, wheelRadius, cabin = null) {
  const s = new THREE.Shape();
  const arch = wheelRadius + 0.07;
  const zr = -wheelBase / 2, zf = wheelBase / 2;
  const yb = points[0][1];
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  // Borda inferior com caixas de roda (de frente para trás).
  s.lineTo(zf + arch, yb);
  s.absarc(zf, wheelRadius, arch, 0, Math.PI, false);
  s.lineTo(zr + arch, yb);
  s.absarc(zr, wheelRadius, arch, 0, Math.PI, false);
  s.lineTo(points[0][0], points[0][1]);
  // Vão da cabine: o recorte atravessa a largura (assoalho, teto do vão e
  // paredes viram superfícies internas); as portas fecham as laterais.
  if (cabin) {
    const h = new THREE.Path();
    h.moveTo(cabin.z0, cabin.y0);
    h.lineTo(cabin.z0, cabin.y1);
    h.lineTo(cabin.z1, cabin.y1);
    h.lineTo(cabin.z1, cabin.y0);
    h.lineTo(cabin.z0, cabin.y0);
    s.holes.push(h);
  }
  return s;
}

function extrudeSide(shape, width, bevel = 0.05) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

function polyShape(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/** Agrupa peças por material e devolve meshes fundidos. */
class PartCollector {
  constructor() { this.map = new Map(); }
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.clone();
    composeMatrix(x, y, z, rx, ry, rz, sx, sy, sz, _m);
    g.applyMatrix4(_m);
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(g);
  }
  build(parent, { shadow = true } = {}) {
    const meshes = [];
    for (const [mat, list] of this.map) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadow && !mat.userData.noShadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.map.clear();
    return meshes;
  }
}

export class VehicleFactory {
  constructor(lib) {
    this.lib = lib;
    this.m = {
      rubber: new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.85 }),
      rim: new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.25, metalness: 0.9 }),
      chrome: lib.m.chrome,
      black: new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.6, metalness: 0.2 }),
      trimBlack: new THREE.MeshStandardMaterial({ color: 0x0c0c0f, roughness: 0.4, metalness: 0.3 }),
      // Vidro semitransparente: interior e motorista visíveis de fora.
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x1b2a3a, roughness: 0.04, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.6,
        transparent: true, opacity: 0.45, depthWrite: false,
      }),
      amber: new THREE.MeshStandardMaterial({ color: 0xc87a10, emissive: 0xff9a20, emissiveIntensity: 0.3, roughness: 0.2 }),
      seat: new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.7 }),
      seatDark: new THREE.MeshStandardMaterial({ color: 0x3a3236, roughness: 0.75 }),
      interior: new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.8 }),
      gauge: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.55, 0.85), toneMapped: false }),
    };
    for (const k of ['seat', 'seatDark', 'interior', 'gauge', 'glass']) this.m[k].userData.noShadow = true;
    for (const mat of Object.values(this.m)) mat.userData.shared = true;
    this._plateCount = 0;
    this._paintCache = new Map();
    // Modelos GLB da NEON MOTOR COMPANY (carregados de forma assíncrona antes do mapa).
    this.neon = new NeonModelLibrary();
  }

  /** Pintura compartilhada (detalhes como faixas). */
  paint(hex) {
    let mat = this._paintCache.get(hex);
    if (!mat) {
      mat = new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.45, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.12 });
      mat.userData.shared = true;
      this._paintCache.set(hex, mat);
    }
    return mat;
  }

  /**
   * Descarta os recursos próprios de um veículo (geometrias fundidas, materiais
   * de pintura/luzes, textura da placa). Recursos compartilhados são mantidos.
   */
  dispose(vehicle) {
    vehicle.root.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.userData.shared) o.geometry.dispose();
      for (const mat of [].concat(o.material)) {
        if (mat.userData.shared || mat === this.lib.m.contactShadow) continue;
        mat.map?.dispose();
        mat.dispose();
      }
    });
    vehicle.root.removeFromParent();
    if (vehicle.collision && vehicle.colliderId) vehicle.collision.remove(vehicle.colliderId);
  }

  /** Carrega os GLBs da NEON MOTOR COMPANY (uma vez; o jogo aguarda antes de montar o mapa). */
  preloadNeon() {
    return this.neon.preload();
  }

  create(type, { id, color, stripe = null, plate = null } = {}) {
    if (SPECS[type]?.neon) {
      const nb = SPECS[type];
      if (this.neon.has(type)) {
        const spec = { ...nb, type, handling: structuredClone(nb.handling), seats: nb.seats.map((x) => ({ ...x })) };
        return buildNeonVehicle(this, this.neon, type, spec, { id, color: color ?? nb.color, stripe, plate, Vehicle, plateTexture: licensePlateTexture });
      }
      // GLB indisponível (falha de rede/arquivo): usa o carro procedural da mesma família.
      console.warn(`[NEON MOTOR] modelo ${type} não carregado; usando ${nb.family}`);
      type = nb.family;
    }
    const base = SPECS[type];
    const spec = { ...base, type, handling: { ...base.handling } };
    const root = new THREE.Group();
    root.name = id;
    const body = new THREE.Group();
    body.name = `${id}:body`;
    root.add(body);
    const P = new PartCollector();
    const I = new PartCollector(); // interior (não projeta sombra)
    const M = this.m;
    // Materiais próprios do veículo: pintura (danos) e luzes (freio, ré, faróis).
    const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.12 });
    const mats = {
      paint,
      headlight: new THREE.MeshStandardMaterial({ color: 0xf4f6ff, emissive: 0xfff2d6, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.3 }),
      taillight: new THREE.MeshStandardMaterial({ color: 0x8a0f18, emissive: 0xff2030, emissiveIntensity: 0.45, roughness: 0.2 }),
      reverse: new THREE.MeshStandardMaterial({ color: 0xd8dce4, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.15 }),
    };
    const hw = spec.width / 2, hl = spec.length / 2;
    const fy = spec.floorY;

    // --- Carroceria (com vão da cabine) e chassi.
    const BEVEL = 0.06;
    if (spec.cabin) {
      // Centro com o cockpit aberto do assoalho até o vidro; laterais (com o
      // vão das portas) mantêm a linha de cintura. Cabine aberta por dentro.
      const sideT = 0.16;
      const center = extrudeSide(profileShape(withCockpit(spec.profile, spec.cabin.z0, spec.cabin.z1, fy), spec.wheelBase, spec.wheelRadius), spec.width - sideT * 2, BEVEL);
      P.add(center, paint);
      center.dispose();
      const hole = { z0: spec.cabin.sideZ0, z1: spec.cabin.sideZ1, y0: spec.cabin.y0, y1: spec.cabin.y1 };
      for (const sx of [-1, 1]) {
        const side = extrudeSide(profileShape(spec.profile, spec.wheelBase, spec.wheelRadius, hole), sideT, BEVEL);
        P.add(side, paint, sx * (hw - sideT / 2));
        side.dispose();
      }
    } else {
      const bodyGeo = extrudeSide(profileShape(spec.profile, spec.wheelBase, spec.wheelRadius), spec.width, BEVEL);
      P.add(bodyGeo, paint);
      bodyGeo.dispose();
    }
    const chassisTop = Math.min(fy, 0.4);
    P.add(BOX, M.black, 0, (0.3 + chassisTop) / 2, 0, 0, 0, 0, spec.width - 0.3, chassisTop - 0.3, spec.length - 0.7);
    for (const z of [-spec.wheelBase / 2, spec.wheelBase / 2]) P.add(BOX, M.black, 0, 0.5, z, 0, 0, 0, spec.width - 0.12, 0.3, 0.9);

    // --- Cabine envidraçada + teto + colunas.
    if (spec.green) {
      const gw = spec.width - 0.24;
      const gGeo = extrudeSide(polyShape(spec.green), gw, 0.03);
      P.add(gGeo, M.glass);
      gGeo.dispose();
      P.add(BOX, paint, 0, spec.roof.y + 0.01, spec.roof.z, 0, 0, 0, gw + 0.04, 0.045, spec.roof.len);
      const g = spec.green;
      const aLen = Math.hypot(g[3][0] - g[2][0], g[3][1] - g[2][1]);
      const aAng = Math.atan2(g[2][1] - g[3][1], g[3][0] - g[2][0]);
      const cLen = Math.hypot(g[1][0] - g[0][0], g[1][1] - g[0][1]);
      const cAng = -Math.atan2(g[1][1] - g[0][1], g[1][0] - g[0][0]);
      for (const sx of [-1, 1]) {
        P.add(BOX, paint, sx * (gw / 2 - 0.02), (g[2][1] + g[3][1]) / 2, (g[2][0] + g[3][0]) / 2, aAng, 0, 0, 0.07, 0.06, aLen);
        P.add(BOX, paint, sx * (gw / 2 - 0.02), (g[0][1] + g[1][1]) / 2, (g[0][0] + g[1][0]) / 2, cAng, 0, 0, 0.07, 0.06, cLen);
        if (type === 'sedan') P.add(BOX, paint, sx * (gw / 2 + 0.005), (g[0][1] + spec.roof.y) / 2, -0.03, 0, 0, 0, 0.05, spec.roof.y - g[0][1], 0.09);
      }
    }

    // --- Interior: assoalho, bancos, painel, console, instrumentos.
    const cabZ0 = spec.cabin ? spec.cabin.z0 : spec.doors[0].z0;
    const cabZ1 = spec.cabin ? spec.cabin.z1 : spec.doors[0].z1;
    const floorTop = fy + (spec.cabin ? BEVEL : 0);
    I.add(BOX, M.interior, 0, floorTop + 0.012, (cabZ0 + cabZ1) / 2, 0, 0, 0, spec.width - 0.36, 0.024, cabZ1 - cabZ0 - 0.14);
    const seatMat = type === 'sports' ? M.seatDark : M.seat;
    for (const s of spec.seats) {
      const w = s.rear && type === 'convertible' ? spec.width - 0.5 : 0.52;
      const cushionY = s.hipY - 0.1;
      I.add(BOX, seatMat, s.x, cushionY, s.z + 0.02, 0, 0, 0, w, 0.12, 0.5);
      I.add(BOX, seatMat, s.x, s.hipY + 0.24, s.z - 0.24 - Math.sin(s.recline) * 0.2, -s.recline * 0.8, 0, 0, w, 0.62, 0.12);
      if (!s.rear) I.add(BOX, seatMat, s.x, s.hipY + 0.62, s.z - 0.33 - Math.sin(s.recline) * 0.4, -s.recline * 0.8, 0, 0, 0.26, 0.16, 0.1);
      if (cushionY - 0.06 > floorTop + 0.03) I.add(BOX, M.interior, s.x, (floorTop + cushionY - 0.06) / 2, s.z, 0, 0, 0, w * 0.8, cushionY - 0.06 - floorTop, 0.4);
    }
    const driverSeat = spec.seats.find((s) => s.driver);
    let gaugeY, gaugeZ;
    if (spec.cabin) {
      // Painel = topo interno do cofre (entre o fim do cockpit e o para-brisa),
      // com a face voltada ao motorista e o quadro de instrumentos sobre ele.
      const top = spec.green[3][1] + BEVEL + 0.01;
      const wallZ = spec.cabin.z1 - BEVEL;
      const cz1 = spec.green[3][0] - 0.02;
      I.add(BOX, M.interior, 0, top + 0.008, (wallZ + cz1) / 2, 0, 0, 0, spec.width - 0.36, 0.016, cz1 - wallZ);
      I.add(BOX, M.interior, 0, (floorTop + 0.25 + top) / 2, wallZ - 0.012, 0, 0, 0, spec.width - 0.36, top - floorTop - 0.25, 0.024);
      I.add(BOX, M.interior, 0, (floorTop + top) / 2, wallZ - 0.2, 0, 0, 0, 0.22, top - floorTop - 0.05, 0.36);
      I.add(BOX, M.trimBlack, driverSeat.x, top + 0.055, wallZ + 0.06, 0, 0, 0, 0.42, 0.1, 0.16);
      gaugeY = top + 0.055;
      gaugeZ = wallZ - 0.025;
    } else {
      const dashTop = spec.wheel.y + 0.16;
      const dashY = dashTop - 0.1;
      I.add(BOX, M.interior, 0, dashY, spec.dashZ, 0, 0, 0, spec.width - 0.26, 0.2, 0.32);
      I.add(BOX, M.interior, 0, (floorTop + dashY) / 2, spec.dashZ - 0.25, 0, 0, 0, 0.22, dashY - floorTop, 0.5);
      gaugeY = dashY + 0.06;
      gaugeZ = spec.dashZ - 0.185;
    }
    I.add(BOX, M.gauge, driverSeat.x, gaugeY, gaugeZ, -0.35, 0, 0, 0.32, 0.08, 0.008);
    I.add(BOX, M.trimBlack, driverSeat.x, gaugeY, gaugeZ + 0.005, -0.35, 0, 0, 0.36, 0.11, 0.004);

    // Volante com pivô próprio (gira com o esterçamento).
    const wheelPivot = new THREE.Group();
    wheelPivot.position.set(driverSeat.x, spec.wheel.y, spec.wheel.z);
    wheelPivot.rotation.x = -spec.wheel.tilt;
    const steering = new THREE.Group();
    wheelPivot.add(steering);
    {
      // Aro, raios e cubo fundidos (1 draw call); coluna separada (não gira).
      const W = new PartCollector();
      W.add(new THREE.TorusGeometry(0.17, 0.02, 6, 20), M.black, 0, 0, 0, Math.PI / 2, 0, 0);
      W.add(BOX, M.black, 0, 0, 0, 0, 0, 0, 0.3, 0.025, 0.04);
      W.add(BOX, M.black, 0, 0, 0.07, 0, 0, 0, 0.04, 0.025, 0.16);
      W.add(CYL, M.black, 0, 0, 0, 0, 0, 0, 0.05, 0.05, 0.05);
      W.build(steering, { shadow: false });
      const column = new THREE.Mesh(CYL, M.trimBlack);
      column.scale.set(0.025, 0.36, 0.025);
      column.position.y = -0.18;
      wheelPivot.add(column);
    }
    body.add(wheelPivot);

    // --- Retrovisores, faixa lateral.
    for (const sx of [-1, 1]) {
      const mz = (spec.green ? spec.green[3][0] : spec.dashZ + 0.1) - 0.12;
      const my = (spec.green ? spec.green[3][1] : 0.9) + 0.06;
      P.add(BOX, paint, sx * (hw + 0.09), my, mz, 0, 0, 0, 0.16, 0.09, 0.14);
      P.add(BOX, M.chrome, sx * (hw + 0.09), my, mz - 0.075, 0, 0, 0, 0.13, 0.07, 0.01);
    }
    if (stripe) {
      const stripeMat = this.paint(stripe);
      for (const sx of [-1, 1]) {
        // Faixa fora do vão das portas (as portas recebem o trecho delas).
        const d = spec.doors.find((dd) => dd.side === sx && !dd.id.startsWith('rear'));
        P.add(BOX, stripeMat, sx * (hw + 0.005), 0.62, (d.z1 + hl - 0.45) / 2, 0, 0, 0, 0.01, 0.07, hl - 0.45 - d.z1);
        P.add(BOX, stripeMat, sx * (hw + 0.005), 0.62, (-hl + 0.45 + d.z0) / 2, 0, 0, 0, 0.01, 0.07, d.z0 + hl - 0.45);
      }
    }

    // --- Luzes, para-choques e detalhes por modelo.
    const lights = { head: [], tail: [] };
    const popups = [];
    if (type === 'sports') {
      P.add(BOX, M.trimBlack, 0, 0.38, hl + 0.02, 0, 0, 0, spec.width - 0.1, 0.16, 0.12);
      for (let i = 0; i < 4; i++) P.add(BOX, M.trimBlack, 0, 0.5 + i * 0.035, hl + 0.025, 0, 0, 0, 0.9, 0.012, 0.04);
      for (const sx of [-1, 1]) P.add(BOX, M.amber, sx * 0.7, 0.42, hl + 0.06, 0, 0, 0, 0.26, 0.08, 0.04);
      P.add(BOX, mats.taillight, 0, 0.66, -hl - 0.01, 0, 0, 0, spec.width - 0.25, 0.14, 0.04);
      for (const sx of [-1, 1]) P.add(BOX, mats.reverse, sx * 0.3, 0.52, -hl - 0.012, 0, 0, 0, 0.2, 0.06, 0.03);
      P.add(BOX, M.trimBlack, 0, 0.38, -hl - 0.02, 0, 0, 0, spec.width - 0.1, 0.16, 0.12);
      for (let i = 0; i < 5; i++) {
        const t = (i + 0.5) / 5;
        const z = -1.28 + t * 0.73, y = 0.88 + t * 0.3;
        P.add(BOX, M.trimBlack, 0, y + 0.02, z, -0.39, 0, 0, spec.width - 0.32, 0.025, 0.07);
      }
      P.add(BOX, paint, 0, 1.0, -hl + 0.22, 0, 0, 0, spec.width - 0.1, 0.035, 0.32);
      for (const sx of [-1, 1]) P.add(BOX, M.trimBlack, sx * 0.65, 0.93, -hl + 0.25, 0, 0, 0, 0.05, 0.14, 0.12);
      // Faróis escamoteáveis: tampas na cor da carroceria que se erguem com os faróis ligados.
      const hoodAng = Math.atan2(0.87 - 0.68, 1.95 - 0.95);
      for (const sx of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * 0.55, 0.69, 1.47);
        pivot.rotation.x = hoodAng;
        const lid = new THREE.Mesh(BOX, paint);
        lid.scale.set(0.48, 0.09, 0.34);
        lid.position.set(0, 0.045, 0.17);
        const lamp = new THREE.Mesh(BOX, mats.headlight);
        lamp.scale.set(0.4, 0.07, 0.01);
        lamp.position.set(0, 0.045, 0.345);
        lid.castShadow = true;
        lamp.castShadow = false;
        pivot.add(lid, lamp);
        body.add(pivot);
        popups.push({ pivot, closed: hoodAng, open: hoodAng - 1.25 });
        lights.head.push({ x: sx * 0.55, y: 0.8, z: hl - 0.4 });
      }
    } else if (type === 'sedan') {
      P.add(BOX, M.chrome, 0, 0.44, hl + 0.05, 0, 0, 0, spec.width + 0.04, 0.16, 0.14);
      P.add(BOX, M.chrome, 0, 0.44, -hl - 0.05, 0, 0, 0, spec.width + 0.04, 0.16, 0.14);
      P.add(BOX, M.trimBlack, 0, 0.72, hl + 0.01, 0, 0, 0, 0.8, 0.2, 0.03);
      for (let i = 0; i < 5; i++) P.add(BOX, M.chrome, -0.32 + i * 0.16, 0.72, hl + 0.02, 0, 0, 0, 0.02, 0.2, 0.03);
      for (const sx of [-1, 1]) {
        P.add(BOX, mats.headlight, sx * 0.55, 0.74, hl + 0.015, 0, 0, 0, 0.18, 0.13, 0.03);
        P.add(BOX, mats.headlight, sx * 0.76, 0.74, hl + 0.015, 0, 0, 0, 0.18, 0.13, 0.03);
        P.add(BOX, M.amber, sx * 0.62, 0.56, hl + 0.02, 0, 0, 0, 0.36, 0.07, 0.03);
        P.add(BOX, mats.taillight, sx * 0.68, 0.74, -hl - 0.01, 0, 0, 0, 0.42, 0.16, 0.03);
        P.add(BOX, mats.reverse, sx * 0.68, 0.62, -hl - 0.01, 0, 0, 0, 0.42, 0.07, 0.03);
        // Friso cromado lateral (dividido nas portas).
        P.add(BOX, M.chrome, sx * (hw + 0.01), 0.5, 1.72, 0, 0, 0, 0.02, 0.05, 1.5);
        P.add(BOX, M.chrome, sx * (hw + 0.01), 0.5, -1.72, 0, 0, 0, 0.02, 0.05, 1.5);
        lights.head.push({ x: sx * 0.65, y: 0.74, z: hl });
      }
    } else if (type === 'convertible') {
      P.add(BOX, M.chrome, 0, 0.42, hl + 0.04, 0, 0, 0, spec.width, 0.12, 0.12);
      P.add(BOX, M.chrome, 0, 0.42, -hl - 0.04, 0, 0, 0, spec.width, 0.12, 0.12);
      for (const sx of [-1, 1]) {
        P.add(BOX, mats.headlight, sx * 0.62, 0.64, hl + 0.01, 0, 0, 0, 0.34, 0.12, 0.03);
        P.add(BOX, mats.taillight, sx * 0.62, 0.68, -hl - 0.01, 0, 0, 0, 0.4, 0.12, 0.03);
        P.add(BOX, mats.reverse, sx * 0.3, 0.6, -hl - 0.012, 0, 0, 0, 0.14, 0.06, 0.03);
        // Painéis fixos atrás das portas (contorno do cockpit).
        P.add(BOX, paint, sx * (hw - 0.05), 0.85, -1.15, 0, 0, 0, 0.1, 0.1, 0.62);
        lights.head.push({ x: sx * 0.62, y: 0.64, z: hl });
      }
      // Para-brisa com moldura cromada.
      P.add(BOX, M.glass, 0, 1.1, 0.78, -0.55, 0, 0, spec.width - 0.3, 0.42, 0.015);
      P.add(BOX, M.chrome, 0, 1.3, 0.67, -0.55, 0, 0, spec.width - 0.26, 0.03, 0.03);
      for (const sx of [-1, 1]) P.add(BOX, M.chrome, sx * (hw - 0.16), 1.1, 0.78, -0.55, 0, 0, 0.03, 0.46, 0.03);
      // Tampa do porta-malas da capota recolhida.
      P.add(BOX, M.interior, 0, 0.83, -1.5, 0, 0, 0, spec.width - 0.4, 0.06, 0.18);
    }
    // Escapamento.
    for (const ex of spec.exhaust) P.add(CYL, M.chrome, ex, 0.33, -hl - 0.05, Math.PI / 2, 0, 0, 0.045, 0.18, 0.045);
    // Frisos cromados na linha de cintura (esportivo e conversível), fora das portas.
    if (type !== 'sedan') {
      const d = spec.doors[0];
      for (const sx of [-1, 1]) {
        P.add(BOX, M.chrome, sx * (hw + 0.006), 0.47, (d.z1 + hl - 0.8) / 2, 0, 0, 0, 0.012, 0.025, hl - 0.8 - d.z1);
        P.add(BOX, M.chrome, sx * (hw + 0.006), 0.47, (-hl + 0.8 + d.z0) / 2, 0, 0, 0, 0.012, 0.025, d.z0 + hl - 0.8);
      }
    }

    // --- Portas articuladas (dobradiça na borda dianteira).
    const doors = [];
    for (const d of spec.doors) {
      const pivot = new THREE.Group();
      pivot.name = `${id}:door:${d.id}`;
      const len = d.z1 - d.z0;
      pivot.position.set(d.side * (hw + 0.004), 0, d.z1);
      const y0 = d.open ? 0.36 : spec.cabin.y0 - 0.005;
      const y1 = d.open ? 0.92 : spec.cabin.y1 + 0.005;
      const t = d.open ? 0.1 : 0.06;
      const panel = new THREE.Mesh(BOX, paint);
      panel.scale.set(t, y1 - y0, len - 0.012);
      panel.position.set(-d.side * t / 2, (y0 + y1) / 2, -len / 2);
      panel.castShadow = true;
      panel.receiveShadow = true;
      pivot.add(panel);
      if (stripe) {
        const st = new THREE.Mesh(BOX, this.paint(stripe));
        st.scale.set(0.01, 0.07, len - 0.012);
        st.position.set(d.side * 0.005, 0.62, -len / 2);
        pivot.add(st);
      }
      body.add(pivot);
      const seat = spec.seats.find((s) => s.id === d.seat);
      doors.push({
        id: d.id, side: d.side, seat: d.seat, pivot, open: 0, target: 0,
        // Ponto de entrada (no chão, ao lado da porta) e ponto no vão (soleira).
        entry: new THREE.Vector3(d.side * (hw + 0.62), 0, (d.z0 + d.z1) / 2 + 0.05),
        sill: new THREE.Vector3(d.side * (hw - 0.12), 0, seat ? seat.z + 0.1 : (d.z0 + d.z1) / 2),
      });
    }

    // --- Placas.
    const plateText = plate || `NC-${(1986 + this._plateCount * 37) % 9000 + 1000}`;
    this._plateCount++;
    const plateMat = new THREE.MeshStandardMaterial({ map: licensePlateTexture(plateText), roughness: 0.5 });
    const rearG = new THREE.PlaneGeometry(0.42, 0.21).rotateY(Math.PI).translate(0, 0.52, -hl - 0.08);
    const frontG = new THREE.PlaneGeometry(0.42, 0.21).translate(0, 0.36, hl + 0.1);
    const plates = new THREE.Mesh(mergeGeometries([rearG, frontG], false), plateMat);
    rearG.dispose(); frontG.dispose();
    plates.name = `${id}:plates`;
    body.add(plates);

    P.build(body);
    const detail = I.build(body, { shadow: false });
    detail.push(wheelPivot);

    // --- Rodas com pivôs próprios (suspensão + esterçamento + giro).
    const wheels = [];
    const r = spec.wheelRadius;
    const rimGeo = rimGeometry({ sports: 'turbine', sedan: 'hubcap', convertible: 'spoke' }[type] ?? 'spoke', r);
    for (const [sx, sz, steer, wid] of [[1, 1, true, 'fl'], [-1, 1, true, 'fr'], [1, -1, false, 'rl'], [-1, -1, false, 'rr']]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * spec.track / 2, r, sz * spec.wheelBase / 2);
      const spin = new THREE.Group();
      pivot.add(spin);
      const tire = new THREE.Mesh(TIRE, M.rubber);
      tire.scale.set(0.24, r, r);
      const rim = new THREE.Mesh(rimGeo, M.rim);
      if (sx < 0) rim.rotation.y = Math.PI;
      for (const o of [tire, rim]) { o.castShadow = true; o.receiveShadow = true; spin.add(o); }
      root.add(pivot);
      wheels.push({ id: wid, pivot, spin, steer, radius: r, side: sx, front: sz > 0, baseY: r, local: new THREE.Vector3(sx * spec.track / 2, 0, sz * spec.wheelBase / 2) });
    }
    // Sombra de contato (plano escuro suave sob o carro; não projeta sombra).
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(spec.width + 0.7, spec.length + 0.8).rotateX(-Math.PI / 2), this.lib.m.contactShadow);
    contact.position.y = 0.015;
    contact.renderOrder = 1;
    contact.name = `${id}:contactShadow`;
    root.add(contact);

    const v = new Vehicle({ id, type, root, body, wheels, spec, lights, doors, steering, popups, mats });
    // Aparência de origem (dados simples): permite recriar o mesmo carro a partir de um salvamento.
    v.appearance = { color, stripe, plate };
    // Interior e volante: ocultados a distância (LOD simples, menos draw calls).
    v.detail = detail;
    return v;
  }
}
