import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HEAD_LAYER, BODY_LAYER, ARMS_LAYER } from './CharacterModel.js';

/**
 * Protagonista 3D importado (GLB com pele), gerado por
 * tools/protagonist/build-protagonist.mjs a partir do modelo do usuário.
 *
 * Não tem animações próprias: os ossos têm os mesmos nomes e a mesma
 * hierarquia do personagem provisório (CharacterModel). O PlayerAnimator
 * continua animando o esqueleto provisório (invisível quando este modelo
 * está ativo) e `sync()` copia as rotações para os ossos do GLB a cada
 * quadro. Assim idle, caminhada, corrida, pulo, queda, aterrissagem, curva
 * e a sequência de veículos funcionam sem clipes novos.
 *
 * A malha é dividida em três partes que compartilham o mesmo esqueleto,
 * para que a câmera em primeira pessoa oculte cabeça e braços (camadas)
 * sem perder a sombra, como no personagem provisório.
 */
export const PROTAGONIST_BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR',
  'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR',
];
const HEAD_BONES = ['neck', 'head'];
const ARM_BONES = ['shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR'];

/** Junta do personagem provisório correspondente a cada osso. */
function provisionalJoint(joints, name) {
  const side = name.slice(-1);
  if (name.startsWith('shoulder')) return joints.arms[side].shoulder;
  if (name.startsWith('elbow')) return joints.arms[side].elbow;
  if (name.startsWith('wrist')) return joints.arms[side].wrist;
  if (name.startsWith('hip') && name !== 'hips') return joints.legs[side].hip;
  if (name.startsWith('knee')) return joints.legs[side].knee;
  if (name.startsWith('ankle')) return joints.legs[side].ankle;
  return joints[name];
}

export class ProtagonistModel {
  /** Carrega e valida o GLB; lança erro se faltar algo (o chamador usa o fallback). */
  static async load(url) {
    const t0 = performance.now();
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = new ProtagonistModel(gltf);
    model.loadMs = Math.round(performance.now() - t0);
    return model;
  }

  constructor(gltf) {
    const scene = gltf.scene;
    let skinned = null;
    let rigHolder = null;
    scene.traverse((o) => {
      if (o.isSkinnedMesh && !skinned) skinned = o;
      if (o.userData?.neonRig && !rigHolder) rigHolder = o;
    });
    if (!skinned) throw new Error('GLB do protagonista sem malha com pele (SkinnedMesh)');
    const rig = rigHolder?.userData.neonRig;
    if (!rig || rig.version !== 1) throw new Error('GLB do protagonista sem metadados de rig (neonRig v1)');

    const boneByName = new Map(skinned.skeleton.bones.map((b) => [b.name, b]));
    const missing = PROTAGONIST_BONES.filter((n) => !boneByName.has(n));
    if (missing.length) throw new Error(`GLB do protagonista sem os ossos: ${missing.join(', ')}`);

    this.rig = rig;
    this.root = new THREE.Group();
    this.root.name = 'protagonistGLB';
    this.root.add(scene);
    this.bones = PROTAGONIST_BONES.map((n) => boneByName.get(n));
    this.neutral = PROTAGONIST_BONES.map((n) => new THREE.Vector3().fromArray(rig.neutralLocal[rig.bones.indexOf(n)]));
    /** Elevação aplicada sentado: o quadril do GLB é mais baixo que o do provisório. */
    this.seatLift = 0;
    this._spineAbove = 0.09;
    this._torsoToTop = 0.9;

    // Divide a malha em cabeça / braços / corpo (mesmos atributos e esqueleto).
    const geo = skinned.geometry;
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const headIdx = new Set(HEAD_BONES.map((n) => skinned.skeleton.bones.indexOf(boneByName.get(n))));
    const armIdx = new Set(ARM_BONES.map((n) => skinned.skeleton.bones.indexOf(boneByName.get(n))));
    const vCount = si.count;
    const headW = new Float32Array(vCount), armW = new Float32Array(vCount);
    for (let v = 0; v < vCount; v++) {
      for (let k = 0; k < 4; k++) {
        const b = si.getComponent(v, k), w = sw.getComponent(v, k);
        if (headIdx.has(b)) headW[v] += w;
        if (armIdx.has(b)) armW[v] += w;
      }
    }
    const index = geo.index.array;
    const parts = { head: [], arms: [], body: [] };
    for (let f = 0; f < index.length; f += 3) {
      const a = index[f], b = index[f + 1], c = index[f + 2];
      const h = Math.max(headW[a], headW[b], headW[c]);
      const r = Math.max(armW[a], armW[b], armW[c]);
      (h > 0.5 ? parts.head : r > 0.5 ? parts.arms : parts.body).push(a, b, c);
    }
    const material = skinned.material;
    material.side = THREE.FrontSide;
    // Em algumas poses (sentar, montar, passada) vértices com pesos de ossos opostos ficam com
    // normal nula; normalize(0) gera NaN no pixel e o bloom espalha o NaN pela tela inteira
    // (quadros pretos). Proteção: normal nula vira "para cima" e NaN no fragmento vira frente.
    material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <skinnormal_vertex>',
        '#include <skinnormal_vertex>\n\tif ( dot( objectNormal, objectNormal ) < 1e-12 ) objectNormal = vec3( 0.0, 1.0, 0.0 );');
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n\tif ( any( isnan( normal ) ) || dot( normal, normal ) < 1e-12 ) normal = vec3( 0.0, 0.0, 1.0 );\n\tnonPerturbedNormal = normal;');
    };
    material.customProgramCacheKey = () => 'protagonist-safe-normal';
    this.material = material;
    this.meshes = {};
    this.triangles = index.length / 3;
    const layers = { head: HEAD_LAYER, arms: ARMS_LAYER, body: BODY_LAYER };
    for (const [part, ids] of Object.entries(parts)) {
      const g = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
      g.setIndex(ids);
      const m = new THREE.SkinnedMesh(g, material);
      m.name = `protagonist_${part}`;
      m.bind(skinned.skeleton, skinned.bindMatrix);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // pose varia muito (sentado, correndo); é sempre um só personagem
      m.layers.set(layers[part]);
      skinned.parent.add(m);
      this.meshes[part] = m;
    }
    skinned.parent.remove(skinned);
    this.skeleton = skinned.skeleton;
    /** Alvo da mão esquerda (espaço local da raiz do personagem) e peso. */
    this.leftHand = { local: new THREE.Vector3(), weight: 0 };
    this._ik = {
      s: new THREE.Vector3(), e: new THREE.Vector3(), w: new THREE.Vector3(), t: new THREE.Vector3(),
      a: new THREE.Vector3(), b: new THREE.Vector3(), q: new THREE.Quaternion(), qp: new THREE.Quaternion(),
      qs: new THREE.Quaternion(), qe: new THREE.Quaternion(), x: new THREE.Vector3(1, 0, 0),
    };
  }

  /** Configura a compatibilidade com a pose sentada do personagem provisório. */
  configureSeat(provisionalHipsY) {
    this.seatLift = Math.max(0, provisionalHipsY - this.rig.hipsY);
    const spineY = this.rig.bindPos[this.rig.bones.indexOf('spine')][1];
    this._spineAbove = spineY - this.rig.hipsY;
    this._torsoToTop = this.rig.headTop - spineY;
    // Medidas do braço do GLB (pilotagem de moto: o tronco inclina até as mãos alcançarem o guidão).
    const bp = (n) => new THREE.Vector3().fromArray(this.rig.bindPos[this.rig.bones.indexOf(n)]);
    const sh = bp('shoulderL'), el = bp('elbowL'), wr = bp('wristL');
    this.armReach = sh.distanceTo(el) + el.distanceTo(wr) + 0.078;
    this.shoulderUp = sh.y - this.rig.hipsY;
  }

  /**
   * Inclinação do encosto para este modelo: o tronco é mais longo que o do
   * provisório, então em carros com teto reclina o suficiente para a cabeça
   * caber (headroom = altura do teto acima do quadril; null = sem teto).
   */
  seatRecline(base, headroom) {
    if (headroom === null || headroom === undefined) return base;
    const c = (headroom - 0.085 - this._spineAbove) / this._torsoToTop;
    const need = Math.acos(THREE.MathUtils.clamp(c, 0, 1));
    return Math.min(Math.max(base, need), base + 0.4);
  }

  /** Copia pose e transformação do personagem provisório (já animado). */
  sync(provisional, animator) {
    const r = this.root;
    r.position.copy(provisional.root.position);
    r.quaternion.copy(provisional.root.quaternion);
    const seat = animator.seatBlend || 0;
    if (seat > 0) r.position.y += this.seatLift * seat;
    const j = provisional.joints;
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i];
      const src = provisionalJoint(j, PROTAGONIST_BONES[i]);
      bone.quaternion.copy(src.quaternion);
      bone.position.copy(this.neutral[i]);
    }
    // Deslocamentos do quadril (balanço da caminhada, agachar ao aterrissar).
    const hips = this.bones[0];
    hips.position.x += j.hips.position.x;
    hips.position.z += j.hips.position.z; // clipes da Mixamo (o procedural mantém 0)
    hips.position.y += j.hips.position.y - animator.hipsBaseY;
    // Sentado: os braços do GLB têm outro comprimento e os ombros ficam mais
    // altos; uma IK de dois ossos leva os pulsos até os do esqueleto
    // provisório (que já estão no volante).
    if (seat > 0.01) {
      provisional.root.updateMatrixWorld(true);
      r.updateMatrixWorld(true);
      this._armIK(5, 6, 7, j.arms.L.wrist.getWorldPosition(this._ik.t2 || (this._ik.t2 = new THREE.Vector3())), seat);
      this._armIK(8, 9, 10, j.arms.R.wrist.getWorldPosition(this._ik.t2), seat);
      // Moto (PROMPT 15): pernas do GLB mais curtas — tornozelos levados aos do provisório
      // (pedaleiras ou pé no chão). O joelho dobra para o lado oposto ao cotovelo.
      if (animator.seatRide) {
        this._armIK(11, 12, 13, j.legs.L.ankle.getWorldPosition(this._ik.t2), seat, 1);
        this._armIK(14, 15, 16, j.legs.R.ankle.getWorldPosition(this._ik.t2), seat, 1);
      }
    } else if (this.leftHand.weight > 0.01) {
      // Arma em duas mãos: mão de apoio no guarda-mão/empunhadura (IK).
      r.updateMatrixWorld(true);
      const tw = this._ik.t2 || (this._ik.t2 = new THREE.Vector3());
      tw.copy(this.leftHand.local).applyMatrix4(r.matrixWorld);
      this._armIK(5, 6, 7, tw, this.leftHand.weight);
    }
  }

  /** IK de dois ossos (ombro, cotovelo, pulso — ou quadril, joelho, tornozelo com bend = +1) até `target`. */
  _armIK(si, ei, wi, target, weight, bend = -1) {
    const k = this._ik;
    const sh = this.bones[si], el = this.bones[ei], wr = this.bones[wi];
    sh.getWorldPosition(k.s);
    el.getWorldPosition(k.e);
    wr.getWorldPosition(k.w);
    k.t.copy(target);
    const a = k.s.distanceTo(k.e), b = k.e.distanceTo(k.w);
    const c = THREE.MathUtils.clamp(k.s.distanceTo(k.t), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    // Cotovelo: só gira em X local (mesma convenção do personagem provisório).
    const interior = Math.acos(THREE.MathUtils.clamp((a * a + b * b - c * c) / (2 * a * b), -1, 1));
    k.q.setFromAxisAngle(k.x, bend * (Math.PI - interior));
    el.quaternion.slerp(k.q, weight);
    el.updateMatrixWorld(true);
    // Ombro: menor rotação que leva o pulso até o alvo.
    wr.getWorldPosition(k.w);
    k.a.subVectors(k.w, k.s).normalize();
    k.b.subVectors(k.t, k.s).normalize();
    k.q.setFromUnitVectors(k.a, k.b);
    sh.getWorldQuaternion(k.qs);
    k.qs.premultiply(k.q);
    sh.parent.getWorldQuaternion(k.qp);
    sh.quaternion.slerp(k.qp.invert().multiply(k.qs), weight);
    sh.updateMatrixWorld(true);
  }

  bone(name) {
    const i = PROTAGONIST_BONES.indexOf(name);
    return i >= 0 ? this.bones[i] : this.bones[0];
  }

  get visible() {
    return this.root.visible;
  }

  set visible(v) {
    this.root.visible = v;
  }

  dispose() {
    for (const m of Object.values(this.meshes)) m.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
