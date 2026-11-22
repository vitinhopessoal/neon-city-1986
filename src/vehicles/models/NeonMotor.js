import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import DATA from './neon-motor-specs.json' with { type: 'json' };

/**
 * NEON MOTOR COMPANY (PROMPT 12): nove modelos GLB feitos no Blender
 * (tools/blender/neon_motor) e integrados ao MESMO sistema automotivo:
 * o GLB vira um `Vehicle` com a estrutura dos carros procedurais
 * (root → body; rodas com pivô/giro; portas com dobradiça; volante; faróis
 * escamoteáveis; materiais próprios de pintura e luzes). Física, câmera,
 * danos, trânsito, garagens, saves e NEON CUSTOMS continuam os existentes.
 *
 * Medidas: src/vehicles/models/neon-motor-specs.json (mesma fonte do Blender).
 */
export const NEON_DEFS = DATA.vehicles;
export const NEON_FAMILY = Object.fromEntries(NEON_DEFS.map((d) => [d.type, d.family]));
export const NEON_CATEGORY_LABEL = { popular: 'Popular', intermediario: 'Intermediário', luxo: 'Esportivo de luxo' };
const SEAT_DOOR = { Door_FL: 'driver', Door_FR: 'passenger', Door_RL: 'rearLeft', Door_RR: 'rearRight' };
const hex = (s) => parseInt(s.slice(1), 16);

/** Converte uma entrada do JSON numa especificação no formato de SPECS (VehicleFactory). */
function toSpec(d) {
  const D = d.dims, b = d.body;
  const L2 = D.length / 2;
  const deck = b.deckY ?? b.tailTopY;
  // Silhueta lateral aproximada (usada pelas peças do NEON CUSTOMS e por medidas de altura).
  const profile = [
    [-L2, b.bottomY + 0.08], [-L2, b.tailTopY], [b.rearBaseZ, b.rear === 'notch' || b.rear === 'mid' || b.rear === 'roadster' ? deck : b.beltRear],
    [b.cowlZ, b.cowlY], [L2, b.noseTopY], [L2, b.bottomY + 0.08],
  ];
  const roadster = b.rear === 'roadster';
  const rearBase = b.rear === 'mid' ? b.roofRearZ - 0.07 : b.rearBaseZ;
  const green = roadster ? null : [[rearBase, b.rear === 'mid' ? deck : (b.rear === 'notch' ? deck : b.beltRear)], [b.roofRearZ, b.roofY], [b.roofFrontZ, b.roofY], [b.cowlZ, b.cowlY]];
  const doors = [];
  const ids = [['Door_FL', 1, 0], ['Door_FR', -1, 0], ['Door_RL', 1, 1], ['Door_RR', -1, 1]];
  for (const [nm, side, k] of ids) {
    const dz = b.doorZ[k];
    if (!dz) continue;
    doors.push({ id: SEAT_DOOR[nm], node: nm, side, z0: dz[1], z1: dz[0], seat: SEAT_DOOR[nm] });
  }
  return {
    model: d.model, category: NEON_CATEGORY_LABEL[d.category] || d.category, neonCategory: d.category, family: d.family, year: d.year,
    length: D.length, width: D.width, height: D.height, wheelBase: D.wheelBase, track: D.track, wheelRadius: D.wheelRadius, floorY: D.floorY,
    tireWidth: D.tireWidth,
    profile, green,
    roof: roadster ? null : { z: (b.roofFrontZ + b.roofRearZ) / 2, len: Math.abs(b.roofFrontZ - b.roofRearZ), y: b.roofY },
    // Forro interno (teto de 3 cm + folga): a postura do motorista se ajusta a ele, não ao teto externo.
    headroomY: roadster ? null : b.roofY - 0.045,
    cabin: null,
    doors,
    seats: d.seats.map((s) => ({ ...s })),
    wheel: { ...d.wheel }, dashZ: d.wheel.z + 0.17,
    exhaust: d.category === 'luxo' ? [0.45, -0.45] : [-0.45],
    popups: d.style.head === 'popup',
    handling: structuredClone(d.handling),
    neon: true, file: d.file, color: hex(d.color), plate: d.plate, traffic: d.traffic,
  };
}

export const NEON_SPECS = Object.fromEntries(NEON_DEFS.map((d) => [d.type, toSpec(d)]));

/**
 * Zona aproximada de Sunset Beach / Lantern Point para o trânsito escolher modelos:
 * bairro nobre (condomínios ao sul), orla/hotéis e boates (leste), Ocean Avenue
 * (comércio) e ruas internas (residencial). Usado só como multiplicador de peso.
 */
export function neonZoneAt(x, z) {
  if (z < -200) return 'rich';
  if (x > 55) return 'beach';
  if (x > 26) return 'nightlife';
  if (Math.abs(x - 19) < 9) return 'commercial';
  return 'residential';
}

/**
 * Pesos de trânsito: os três procedurais continuam presentes; os populares da
 * NEON MOTOR são frequentes, os intermediários moderados e os esportivos raros.
 * Na zona preferida do modelo o peso é multiplicado por 2,2.
 */
export const TRAFFIC_BASE = [['sedan', 0.14], ['convertible', 0.09], ['sports', 0.07], ...NEON_DEFS.map((d) => [d.type, d.traffic.weight])];
export function trafficWeights(x, z) {
  if (!Number.isFinite(x)) return TRAFFIC_BASE;
  const zone = neonZoneAt(x, z);
  return TRAFFIC_BASE.map(([t, w]) => {
    const d = NEON_DEFS.find((e) => e.type === t);
    return [t, d && d.traffic.zones.includes(zone) ? w * 2.2 : w];
  });
}

// ---------------------------------------------------------------- biblioteca de GLBs
export class NeonModelLibrary {
  constructor() {
    this.templates = new Map();   // type -> { scene, cache }
    this.errors = [];
    this.loadMs = 0;
    this.promise = null;
  }

  get ready() { return this.templates.size === NEON_DEFS.length; }

  has(type) { return this.templates.has(type); }

  /** Carrega os nove GLBs (assíncrono, uma vez). Falhas ficam registradas; o jogo segue com os demais. */
  preload(baseUrl = (import.meta.env?.BASE_URL ?? '/')) {
    if (this.promise) return this.promise;
    const t0 = performance.now();
    this.promise = import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      const loader = new GLTFLoader();
      return Promise.all(NEON_DEFS.map((d) => loader.loadAsync(`${baseUrl}models/vehicles/${d.file}.glb`)
        .then((gltf) => { this.templates.set(d.type, { scene: gltf.scene, animations: gltf.animations, cache: {} }); })
        .catch((e) => { this.errors.push(`${d.file}.glb: ${e?.message || e}`); })));
    }).then(() => { this.loadMs = Math.round(performance.now() - t0); return this; });
    return this.promise;
  }
}

// ---------------------------------------------------------------- materiais por modelo
const SHARED_ROLES = {
  Seat: 'seat', Interior: 'interior', Carpet: 'carpet', Headliner: 'headliner', Rim: 'rim', Wood: 'wood', Vinyl: 'vinyl',
  Chassis: 'chassis', Stripe: 'stripe',
};

function templateMaterial(tpl, mat) {
  const key = `mat:${mat.name}`;
  let m = tpl.cache[key];
  if (!m) {
    m = mat;
    const role = SHARED_ROLES[mat.name] || 'misc';
    m.userData.role = role;
    m.userData.shared = true;
    if (role === 'seat' || role === 'interior' || role === 'carpet' || role === 'headliner') m.userData.noShadow = true;
    tpl.cache[key] = m;
  }
  return m;
}

const SHADOW_CASTERS = new Set(['Paint', 'Chassis', 'Black_Trim', 'Chrome', 'Vinyl', 'Wood']);

/** Funde as malhas dos nós indicados por material (cache por modelo). Devolve [{ geo, mat }]. */
function mergedByMaterial(tpl, key, names) {
  const ck = `merged:${key}`;
  if (tpl.cache[ck]) return tpl.cache[ck];
  tpl.scene.updateMatrixWorld(true);
  const groups = new Map();
  for (const n of names) {
    const root = tpl.scene.getObjectByName(n);
    if (!root) continue;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      const nm = o.material.name;
      if (!groups.has(nm)) groups.set(nm, { mat: o.material, geos: [] });
      groups.get(nm).geos.push(g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]));
    });
  }
  const out = [];
  for (const { mat, geos } of groups.values()) {
    const geo = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    geo.userData.shared = true;
    out.push({ geo, mat });
  }
  tpl.cache[ck] = out;
  return out;
}

/** Geometrias da roda normalizadas para o contrato do NEON CUSTOMS (pneu de largura 1 em X; aro voltado para +X). */
function wheelGeometries(tpl, node, nm, sx, tireWidth) {
  const key = `wheel:${nm}`;
  if (tpl.cache[key]) return tpl.cache[key];
  const collect = (obj) => {
    const out = [];
    obj.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      out.push({ g, mat: o.material });
    });
    return out;
  };
  const tireObj = node.children.find((c) => c.name.startsWith('Tire_'));
  const rimObj = node.children.find((c) => c.name.startsWith('Rim_'));
  const tires = collect(tireObj);
  const rims = collect(rimObj);
  const flip = sx < 0;
  for (const p of [...tires, ...rims]) if (flip) p.g.rotateY(Math.PI);
  const tire = mergeGeometries(tires.map((p) => p.g), false);
  tire.scale(1 / tireWidth, 1, 1);
  const rim = mergeGeometries(rims.map((p) => p.g), true);
  for (const g of [tire, rim]) g.userData.shared = true;
  tires.forEach((p) => p.g.dispose());
  rims.forEach((p) => p.g.dispose());
  const res = { tire, tireMat: tires[0].mat, rim, rimMats: rims.map((p) => p.mat) };
  tpl.cache[key] = res;
  return res;
}

// ---------------------------------------------------------------- montagem do veículo
/**
 * Cria um Vehicle a partir do GLB carregado. `factory` fornece materiais
 * compartilhados (vidro, cromado, borracha...) e utilitários (placa, sombra).
 */
export function buildNeonVehicle(factory, lib, type, spec, { id, color, stripe = null, plate = null, Vehicle, plateTexture }) {
  const tpl = lib.templates.get(type);
  const M = factory.m;
  const root = new THREE.Group();
  root.name = id;
  const body = new THREE.Group();
  body.name = `${id}:body`;
  root.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.12 });
  const mats = {
    paint,
    headlight: new THREE.MeshStandardMaterial({ color: 0xf4f6ff, emissive: 0xfff2d6, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.3 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x8a0f18, emissive: 0xff2030, emissiveIntensity: 0.45, roughness: 0.2 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0xd8dce4, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.15 }),
  };
  const plateText = plate || spec.plate || `NM-${Math.floor(1000 + Math.random() * 8999)}`;
  const tex = plateTexture(plateText);
  tex.flipY = false; // UV do glTF: origem no topo
  tex.needsUpdate = true;
  const plateMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  const stripeMat = stripe != null ? factory.paint(stripe) : null;
  const swap = (m) => {
    switch (m.name) {
      case 'Paint': return paint;
      case 'Headlight': return mats.headlight;
      case 'Taillight': return mats.taillight;
      case 'Reverse': return mats.reverse;
      case 'Glass': return M.glass;
      case 'Chrome': return M.chrome;
      case 'Rubber': return M.rubber;
      case 'Black_Trim': return M.trimBlack;
      case 'Grille': return M.black;
      case 'Amber': return M.amber;
      case 'Gauge': return M.gauge;
      case 'Plate': return plateMat;
      case 'Stripe': return stripeMat || templateMaterial(tpl, m);
      default: return templateMaterial(tpl, m);
    }
  };
  const scene = tpl.scene.clone(true);
  scene.updateMatrixWorld(true);
  const node = (n) => scene.getObjectByName(n);
  const detail = [];
  const take = (n, parent = body) => {
    const o = node(n);
    if (!o) return null;
    parent.add(o); // nós do GLB estão em coordenadas do carro (VehicleRoot na origem)
    return o;
  };
  // Peças fixas fundidas por material (uma vez por modelo; geometria compartilhada entre os
  // carros do mesmo modelo): menos chamadas de desenho que um nó por peça.
  const staticGroup = new THREE.Group();
  staticGroup.name = 'Body';
  for (const p of mergedByMaterial(tpl, 'static', ['Body', 'Windows', 'Lights', 'Chassis'])) staticGroup.add(new THREE.Mesh(p.geo, p.mat));
  body.add(staticGroup);
  for (const n of ['Plate_F', 'Plate_R', 'Hood', 'Trunk', 'Tailgate']) take(n);
  const interior = new THREE.Group();
  interior.name = 'Interior';
  for (const p of mergedByMaterial(tpl, 'interior', ['Interior'])) interior.add(new THREE.Mesh(p.geo, p.mat));
  body.add(interior);
  detail.push(interior);

  // Volante: pivô com a inclinação da coluna; o nó gira em Y local (esterçamento).
  let steering = null;
  const sw = node('SteeringWheel');
  if (sw) {
    const wheelPivot = new THREE.Group();
    wheelPivot.position.copy(sw.position);
    wheelPivot.quaternion.copy(sw.quaternion);
    sw.position.set(0, 0, 0);
    sw.quaternion.identity();
    wheelPivot.add(sw);
    body.add(wheelPivot);
    steering = sw;
    detail.push(wheelPivot);
  }

  // Portas (o nó já está na dobradiça; rotação de repouso = 0).
  const hw = spec.width / 2;
  const doors = [];
  for (const d of spec.doors) {
    const pivot = take(d.node);
    if (!pivot) continue;
    pivot.name = `${id}:door:${d.id}`;
    pivot.traverse((o) => { if (o.name.startsWith('DoorCard_')) detail.push(o); });
    const seat = spec.seats.find((s) => s.id === d.seat);
    doors.push({
      id: d.id, side: d.side, seat: d.seat, pivot, open: 0, target: 0,
      entry: new THREE.Vector3(d.side * (hw + 0.62), 0, (d.z0 + d.z1) / 2 + 0.05),
      sill: new THREE.Vector3(d.side * (hw - 0.12), 0, seat ? seat.z + 0.1 : (d.z0 + d.z1) / 2),
    });
  }

  // Faróis escamoteáveis: fechado = 0, aberto = -1,2 rad (mesmo sentido do modelo no Blender).
  const popups = [];
  for (const n of ['Popup_L', 'Popup_R']) {
    const p = take(n);
    if (p) popups.push({ pivot: p, closed: 0, open: -1.2 });
  }

  // Materiais: troca pelos do jogo (pintura e luzes próprias, compartilhados de fábrica).
  body.traverse((o) => {
    if (!o.isMesh) return;
    const src = (Array.isArray(o.material) ? o.material[0] : o.material).name;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    // Sombra: pintura (carroceria, portas, capô) e, no bloco fixo, chassi, para-choques e frisos. Luzes, vidros,
    // interior e detalhes pequenos não projetam sombra (metade das chamadas no passe de sombra).
    o.castShadow = src === 'Paint' || (o.parent === staticGroup && SHADOW_CASTERS.has(src));
    o.receiveShadow = true;
    o.geometry.userData.shared = true;
  });

  // Rodas no contrato existente: pivô (suspensão/esterçamento) → giro → [pneu, aro].
  const wheels = [];
  const r = spec.wheelRadius;
  for (const [nm, wid, sx, sz] of [['FL', 'fl', 1, 1], ['FR', 'fr', -1, 1], ['RL', 'rl', 1, -1], ['RR', 'rr', -1, -1]]) {
    const wn = node(`Wheel_${nm}`);
    if (!wn) continue;
    const g = wheelGeometries(tpl, wn, nm, sx, spec.tireWidth);
    const pivot = new THREE.Group();
    pivot.position.set(sx * spec.track / 2, r, sz * spec.wheelBase / 2);
    const spin = new THREE.Group();
    pivot.add(spin);
    const tire = new THREE.Mesh(g.tire, M.rubber);
    tire.scale.set(spec.tireWidth, 1, 1);
    const rim = new THREE.Mesh(g.rim, g.rimMats.map(swap));
    if (sx < 0) { rim.rotation.y = Math.PI; tire.rotation.y = Math.PI; }
    // O pneu projeta a sombra da roda; o aro (3 materiais) não precisa.
    tire.castShadow = true;
    for (const o of [tire, rim]) { o.receiveShadow = true; spin.add(o); }
    root.add(pivot);
    wheels.push({ id: wid, pivot, spin, steer: sz > 0, radius: r, side: sx, front: sz > 0, baseY: r, local: new THREE.Vector3(sx * spec.track / 2, 0, sz * spec.wheelBase / 2) });
  }

  // Pontos de luz (efeitos de farol): frente dos faróis/escamoteáveis.
  const lights = { head: [], tail: [] };
  const L2 = spec.length / 2;
  for (const sx of [1, -1]) lights.head.push({ x: sx * (hw - 0.35), y: spec.popups ? spec.profile[4][1] + 0.1 : spec.profile[4][1] - 0.1, z: L2 });

  const contact = new THREE.Mesh(new THREE.PlaneGeometry(spec.width + 0.7, spec.length + 0.8).rotateX(-Math.PI / 2), factory.lib.m.contactShadow);
  contact.position.y = 0.015;
  contact.renderOrder = 1;
  contact.name = `${id}:contactShadow`;
  root.add(contact);

  const v = new Vehicle({ id, type, root, body, wheels, spec, lights, doors, steering, popups, mats });
  v.appearance = { color, stripe, plate: plateText };
  v.detail = detail;
  v.neon = true;
  v.panels = { hood: node('Hood') || null, trunk: node('Trunk') || node('Tailgate') || null };
  return v;
}
