import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import DATA from './neon-moto-specs.json' with { type: 'json' };

/**
 * NEON MOTORCYCLES (PROMPT 15): seis motos originais modeladas no Blender
 * (tools/blender/neon_moto) e integradas ao MESMO sistema de veículos:
 * cada GLB vira um `Vehicle` (root → body) com duas rodas no contrato existente
 * ({ pivot, spin, steer, ... }), uma "porta" virtual do lado esquerdo (ponto de
 * montagem), um assento com os pontos de apoio do piloto (quadril, pedaleiras,
 * manoplas) e materiais próprios de pintura/luzes. Física (MotorcyclePhysics),
 * animação (MotorcycleAnimation), câmera, danos, trânsito, polícia, garagens e
 * saves reutilizam a infraestrutura dos carros.
 *
 * Hierarquia do GLB: MotorcycleRoot / Frame, Engine, FuelTank, Seat, Exhaust,
 * Bodywork, Lights, Plate_R / FrontFork (pivô no eixo de direção; Y local =
 * eixo de direção) → FrontForkMesh, FrontWheel (Tire_F, Rim_F), Grip_L/R /
 * Swingarm (pivô da balança) → SwingarmMesh, RearWheel (Tire_R, Rim_R) /
 * Rider_Hip, Peg_L, Peg_R. Medidas: neon-moto-specs.json (mesma fonte do Blender).
 */
export const MOTO_DEFS = DATA.bikes;
export const MOTO_CATEGORY_LABEL = { basica: 'Motocicleta básica', custom: 'Motocicleta custom', esportiva: 'Motocicleta esportiva' };
const hex = (s) => parseInt(s.slice(1), 16);
// Abertura das pernas (rad) por estilo: o joelho contorna o tanque.
const SPREAD = { upright: 0.17, relaxed: 0.22, chopper: 0.27, sport: 0.2 };
// Quanto o tronco acompanha a inclinação da moto (esportivas "penduram" o corpo).
const HANG = { upright: 0.12, relaxed: 0.08, chopper: 0.06, sport: 0.3 };

/** Converte uma entrada do JSON numa especificação no formato de SPECS (VehicleFactory). */
function toSpec(d) {
  const D = d.dims, R = d.rider;
  const ride = {
    style: R.style, hipY: R.hipY, hipZ: R.hipZ, pegY: R.pegY, pegZ: R.pegZ, pegX: 0.17,
    gripY: R.gripY, gripZ: R.gripZ, gripW: R.gripW, spread: SPREAD[R.style] ?? 0.18, hang: HANG[R.style] ?? 0.1,
  };
  const seats = [{ id: 'driver', driver: true, x: 0, hipY: R.hipY, z: R.hipZ, recline: -R.forward, ride }];
  // Garupa (bancos duplos): registrada, mas não usada pelo trânsito (rear) — pilotos NPC andam sozinhos.
  if (d.seats > 1) seats.push({ id: 'passenger', x: 0, hipY: R.hipY + 0.05, z: R.hipZ - 0.38, recline: 0.05, rear: true });
  return {
    model: d.name, category: MOTO_CATEGORY_LABEL[d.category] || d.category, motoCategory: d.category, family: 'bike', year: d.year, brand: d.brand,
    bike: true,
    length: D.length, width: D.width, height: D.height, wheelBase: D.wheelBase, track: 0,
    wheelRadius: Math.max(D.rF, D.rR), rF: D.rF, rR: D.rR, tireWidth: D.wR, floorY: R.pegY,
    profile: null, green: null, roof: null, headroomY: null, cabin: null,
    doors: [{ id: 'driver', side: 1, seat: 'driver', z0: R.hipZ + 0.35, z1: R.hipZ - 0.25 }],
    seats,
    wheel: null, dashZ: R.gripZ,
    exhaust: [-0.17],
    popups: false,
    handling: structuredClone(d.handling),
    file: d.file, color: hex(d.color), accent: hex(d.accent), plate: d.plate, traffic: d.traffic, style: { ...d.style },
  };
}

export const MOTO_SPECS = Object.fromEntries(MOTO_DEFS.map((d) => [d.type, toSpec(d)]));
export const MOTO_TYPES = MOTO_DEFS.map((d) => d.type);

/**
 * Pesos de trânsito das motos (somados aos dos carros pelo TrafficManager):
 * básicas comuns, customs menos frequentes e esportivas raras; ×2,2 na zona
 * preferida do modelo (mesma função de zona dos carros da NEON MOTOR).
 */
export function motoTrafficWeights(zone, loaded = () => true) {
  return MOTO_DEFS.filter((d) => loaded(d.type)).map((d) => [d.type, zone && d.traffic.zones.includes(zone) ? d.traffic.weight * 2.2 : d.traffic.weight]);
}

// ---------------------------------------------------------------- biblioteca de GLBs
export class MotoModelLibrary {
  constructor() {
    this.templates = new Map();
    this.errors = [];
    this.loadMs = 0;
    this.promise = null;
  }

  get ready() { return this.templates.size === MOTO_DEFS.length; }

  has(type) { return this.templates.has(type); }

  /** Carrega os seis GLBs (e o LOD distante de cada um). Falhas ficam registradas; o jogo segue sem aquele modelo. */
  preload(baseUrl = (import.meta.env?.BASE_URL ?? '/')) {
    if (this.promise) return this.promise;
    const t0 = performance.now();
    this.promise = import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      const loader = new GLTFLoader();
      return Promise.all(MOTO_DEFS.map(async (d) => {
        try {
          const gltf = await loader.loadAsync(`${baseUrl}models/motorcycles/${d.file}.glb`);
          const tpl = { scene: gltf.scene, animations: gltf.animations, cache: {}, lod: null };
          try {
            const lod = await loader.loadAsync(`${baseUrl}models/motorcycles/${d.file}_lod1.glb`);
            tpl.lod = lod.scene;
          } catch (e) {
            this.errors.push(`${d.file}_lod1.glb: ${e?.message || e}`);
          }
          this.templates.set(d.type, tpl);
        } catch (e) {
          this.errors.push(`${d.file}.glb: ${e?.message || e}`);
        }
      }));
    }).then(() => { this.loadMs = Math.round(performance.now() - t0); return this; });
    return this.promise;
  }
}

// ---------------------------------------------------------------- materiais e malhas por modelo
function templateMaterial(tpl, mat) {
  const key = `mat:${mat.name}`;
  let m = tpl.cache[key];
  if (!m) {
    m = mat;
    m.userData.role = 'misc';
    m.userData.shared = true;
    tpl.cache[key] = m;
  }
  return m;
}

/** Funde as malhas dos nós indicados por material (cache por modelo, geometria compartilhada). */
function mergedByMaterial(tpl, key, names, scene = tpl.scene) {
  const ck = `merged:${key}`;
  if (tpl.cache[ck]) return tpl.cache[ck];
  scene.updateMatrixWorld(true);
  const groups = new Map();
  for (const n of names) {
    const root = scene.getObjectByName(n);
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

const SHADOW_CASTERS = new Set(['Paint', 'Chassis', 'Black_Trim', 'Chrome', 'EngineMetal', 'Seat', 'Rubber']);
const STATIC_NODES = ['Frame', 'Engine', 'FuelTank', 'Seat', 'Exhaust', 'Bodywork', 'Lights'];

/**
 * Cria um Vehicle (moto) a partir do GLB carregado. `factory` fornece materiais
 * compartilhados (cromado, borracha, vidro...) e a sombra de contato.
 */
export function buildMotoVehicle(factory, lib, type, spec, { id, color, plate = null, Vehicle, plateTexture }) {
  const tpl = lib.templates.get(type);
  const M = factory.m;
  const root = new THREE.Group();
  root.name = id;
  root.rotation.order = 'YXZ';
  const body = new THREE.Group();
  body.name = `${id}:body`;
  root.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.28, clearcoat: 1.0, clearcoatRoughness: 0.08 });
  const mats = {
    paint,
    headlight: new THREE.MeshStandardMaterial({ color: 0xf4f6ff, emissive: 0xfff2d6, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.3 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x8a0f18, emissive: 0xff2030, emissiveIntensity: 0.45, roughness: 0.2 }),
    reverse: null,
  };
  const plateText = plate || spec.plate || `MC ${Math.floor(100 + Math.random() * 899)}`;
  const tex = plateTexture(plateText);
  tex.flipY = false;
  tex.needsUpdate = true;
  const plateMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  const swap = (m) => {
    switch (m.name) {
      case 'Paint': return paint;
      case 'Headlight': return mats.headlight;
      case 'Taillight': return mats.taillight;
      case 'Glass': return M.glass;
      case 'Chrome': return M.chrome;
      case 'Rubber': return M.rubber;
      case 'Black_Trim': return M.trimBlack;
      case 'Amber': return M.amber;
      case 'Gauge': return M.gauge;
      case 'Plate': return plateMat;
      default: return templateMaterial(tpl, m);
    }
  };
  const scene = tpl.scene.clone(true);
  scene.updateMatrixWorld(true);
  // Índice dos nós ANTES de reparentar (depois de mover o garfo, os filhos saem da cena clonada).
  const nodes = new Map();
  scene.traverse((o) => { if (o.name && !nodes.has(o.name)) nodes.set(o.name, o); });
  const node = (n) => nodes.get(n) || null;

  // Peças fixas (quadro, motor, tanque, banco, escapamento, carenagem, luzes): fundidas por material.
  const staticGroup = new THREE.Group();
  staticGroup.name = 'Body';
  for (const p of mergedByMaterial(tpl, 'static', STATIC_NODES)) staticGroup.add(new THREE.Mesh(p.geo, p.mat));
  body.add(staticGroup);
  const plateNode = node('Plate_R');
  if (plateNode) body.add(plateNode);

  // Garfo (pivô no eixo de direção, já inclinado pelo rake) e balança: nós móveis do GLB.
  const fork = node('FrontFork');
  const swing = node('Swingarm');
  body.add(fork, swing);
  const frontSpin = node('FrontWheel');
  const rearSpin = node('RearWheel');
  // Contrato das rodas: spin.children = [pneu, aro].
  for (const s of [frontSpin, rearSpin]) s.children.sort((a, b) => Number(b.name.startsWith('Tire')) - Number(a.name.startsWith('Tire')));
  const anchors = {};
  for (const n of ['Rider_Hip', 'Peg_L', 'Peg_R', 'Grip_L', 'Grip_R']) {
    const o = node(n);
    if (!o) continue;
    if (n.startsWith('Grip')) anchors[n] = o; // filhos do garfo (giram com o guidão)
    else { body.add(o); anchors[n] = o; }
  }

  body.traverse((o) => {
    if (!o.isMesh) return;
    const src = (Array.isArray(o.material) ? o.material[0] : o.material).name;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    o.castShadow = SHADOW_CASTERS.has(src);
    o.receiveShadow = true;
    o.geometry.userData.shared = true;
  });

  const zF = spec.wheelBase / 2, zR = -spec.wheelBase / 2;
  const wheels = [
    { id: 'fl', pivot: fork, spin: frontSpin, steer: true, radius: spec.rF, side: 0, front: true, baseY: spec.rF, local: new THREE.Vector3(0, 0, zF), base: frontSpin.position.clone() },
    { id: 'rl', pivot: swing, spin: rearSpin, steer: false, radius: spec.rR, side: 0, front: false, baseY: spec.rR, local: new THREE.Vector3(0, 0, zR), base: rearSpin.position.clone() },
  ];

  const lights = { head: [{ x: 0, y: spec.handling ? 0.9 : 0.9, z: spec.length / 2 - 0.2 }], tail: [{ x: 0, y: 0.75, z: -spec.length / 2 + 0.1 }] };

  const contact = new THREE.Mesh(new THREE.PlaneGeometry(spec.width + 0.35, spec.length + 0.5).rotateX(-Math.PI / 2), factory.lib.m.contactShadow);
  contact.position.y = 0.015;
  contact.renderOrder = 1;
  contact.name = `${id}:contactShadow`;
  root.add(contact);

  // LOD distante (malha única dizimada no Blender): troca feita pelo VehicleManager.
  let lodMesh = null;
  if (tpl.lod) {
    lodMesh = new THREE.Group();
    lodMesh.name = `${id}:lod1`;
    for (const p of mergedByMaterial(tpl, 'lod1', ['LOD1'], tpl.lod)) {
      const mesh = new THREE.Mesh(p.geo, swap(p.mat));
      mesh.castShadow = p.mat.name === 'Paint' || p.mat.name === 'Rubber';
      lodMesh.add(mesh);
    }
    lodMesh.visible = false;
    root.add(lodMesh);
  }

  // "Porta" virtual: ponto de montagem do lado esquerdo (+X), sem malha.
  const doors = spec.doors.map((d) => {
    const pivot = new THREE.Group();
    pivot.name = `${id}:mount:${d.id}`;
    body.add(pivot);
    return {
      id: d.id, side: d.side, seat: d.seat, pivot, open: 0, target: 0, virtual: true,
      entry: new THREE.Vector3(d.side * (spec.width / 2 + 0.5), 0, spec.seats[0].z + 0.18),
      sill: new THREE.Vector3(d.side * 0.3, 0, spec.seats[0].z + 0.05),
    };
  });

  const v = new Vehicle({ id, type, root, body, wheels, spec, lights, doors, steering: null, popups: [], mats });
  v.bike = true;
  v.fork = fork;
  v.swingarm = swing;
  v.riderAnchors = anchors;
  v.lodMesh = lodMesh;
  v.appearance = { color, stripe: null, plate: plateText };
  v.detail = [];
  v.panels = { hood: null, trunk: null };
  // Estacionada: apoiada no cavalete lateral (inclinada para a esquerda, lado do cavalete).
  v.standLean = -0.09;
  const setPose = v.setPose.bind(v);
  v.setPose = (x, y, z, heading) => {
    setPose(x, y, z, heading);
    if (!v.driver) { root.rotation.set(0, heading, v.standLean, 'YXZ'); root.updateMatrixWorld(true); }
  };
  return v;
}
