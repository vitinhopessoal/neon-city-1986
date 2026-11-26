import * as THREE from 'three';

/**
 * Converte animações da Mixamo (esqueleto "mixamorig", ~33 ossos) para o
 * esqueleto de 17 articulações do protagonista (CharacterModel: hips, spine,
 * chest, neck, head, shoulder/elbow/wrist, hip/knee/ankle).
 *
 * As duas hierarquias têm eixos locais diferentes, então a conversão é feita
 * por orientação no MUNDO: para cada osso, guarda-se uma vez o deslocamento
 * O = (mundo da Mixamo na pose de referência)⁻¹ · (mundo do jogo na mesma pose);
 * em cada quadro, mundo_jogo = mundo_mixamo · O, e depois volta-se para local
 * percorrendo a hierarquia do jogo. A pose de referência é a pose T (de repouso)
 * do arquivo "idle" — no jogo, a mesma pose é obtida girando braços e pernas
 * (que ficam para baixo no repouso) até a direção dos ossos da Mixamo.
 */
export const RIG_MAP = {
  hips: 'Hips', spine: 'Spine', chest: 'Spine2', neck: 'Neck', head: 'Head',
  shoulderL: 'LeftArm', elbowL: 'LeftForeArm', wristL: 'LeftHand',
  shoulderR: 'RightArm', elbowR: 'RightForeArm', wristR: 'RightHand',
  hipL: 'LeftUpLeg', kneeL: 'LeftLeg', ankleL: 'LeftFoot',
  hipR: 'RightUpLeg', kneeR: 'RightLeg', ankleR: 'RightFoot',
};
/** Hierarquia do esqueleto do jogo (pai de cada articulação). */
export const RIG_PARENT = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', elbowL: 'shoulderL', wristL: 'elbowL',
  shoulderR: 'chest', elbowR: 'shoulderR', wristR: 'elbowR',
  hipL: 'hips', kneeL: 'hipL', ankleL: 'kneeL',
  hipR: 'hips', kneeR: 'hipR', ankleR: 'kneeR',
};
export const RIG_JOINTS = Object.keys(RIG_MAP);
/** Ossos cujo segmento (até o filho) aponta para baixo no repouso do jogo. */
const LIMB_CHILD = {
  shoulderL: ['LeftArm', 'LeftForeArm'], elbowL: ['LeftForeArm', 'LeftHand'], wristL: ['LeftHand', 'LeftHandIndex1'],
  shoulderR: ['RightArm', 'RightForeArm'], elbowR: ['RightForeArm', 'RightHand'], wristR: ['RightHand', 'RightHandIndex1'],
  hipL: ['LeftUpLeg', 'LeftLeg'], kneeL: ['LeftLeg', 'LeftFoot'],
  hipR: ['RightUpLeg', 'RightLeg'], kneeR: ['RightLeg', 'RightFoot'],
};
const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/** Osso da Mixamo pelo nome curto (o FBXLoader remove o ":" de "mixamorig:Hips"). */
export function mixamoBone(root, short) {
  return root.getObjectByName('mixamorig' + short) || root.getObjectByName('mixamorig:' + short) || root.getObjectByName(short);
}

/**
 * Referência a partir do objeto do FBX "idle" (sem animação aplicada = pose T).
 * standHips: altura do quadril em pé no jogo (CharacterModel: 0,95 m).
 */
export function buildReference(idleRoot, idleClip, { standHips = 0.95 } = {}) {
  idleRoot.updateMatrixWorld(true);
  const offsets = {};
  const q = new THREE.Quaternion(), w = new THREE.Quaternion();
  for (const joint of RIG_JOINTS) {
    const bone = mixamoBone(idleRoot, RIG_MAP[joint]);
    if (!bone) throw new Error(`Osso da Mixamo ausente: ${RIG_MAP[joint]}`);
    bone.getWorldQuaternion(w);
    // Orientação do osso do jogo na pose T: braços e pernas giram do "para baixo"
    // até a direção do osso equivalente; tronco, cabeça e pés já coincidem.
    q.identity();
    const seg = LIMB_CHILD[joint];
    if (seg) {
      mixamoBone(idleRoot, seg[0]).getWorldPosition(_a);
      mixamoBone(idleRoot, seg[1]).getWorldPosition(_b);
      q.setFromUnitVectors(DOWN, _b.sub(_a).normalize());
    }
    offsets[joint] = w.clone().invert().multiply(q);
  }
  // Escala: altura do quadril em pé (primeiro quadro do idle) → 0,95 m do jogo.
  const hipsTrack = idleClip.tracks.find(t => /Hips\.position$/.test(t.name));
  const srcStand = hipsTrack ? hipsTrack.values[1] : 1;
  return { offsets, scale: standHips / srcStand, standHips, srcStand };
}

/**
 * Clipe do FBX → clipe para o esqueleto do jogo (faixas "hips.quaternion",
 * "hips.position", ...). opts.inPlace remove o avanço horizontal (mantém o
 * balanço); opts.keepRoot guarda o deslocamento horizontal em clip.userData.root.
 */
export function retargetClip(fbxRoot, clip, ref, name, { inPlace = true, fps = 30 } = {}) {
  const mixer = new THREE.AnimationMixer(fbxRoot);
  const action = mixer.clipAction(clip);
  // Sem repetir: o último quadro amostrado é o final do clipe (não volta ao início).
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const bones = {};
  for (const joint of RIG_JOINTS) bones[joint] = mixamoBone(fbxRoot, RIG_MAP[joint]);
  const hips = bones.hips;
  const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(n);
  const quats = Object.fromEntries(RIG_JOINTS.map(j => [j, new Float32Array(n * 4)]));
  const pos = new Float32Array(n * 3);
  const world = {}, local = new THREE.Quaternion(), wq = new THREE.Quaternion(), hp = new THREE.Vector3();
  for (const j of RIG_JOINTS) world[j] = new THREE.Quaternion();
  const raw = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(clip.duration, (i / (n - 1)) * clip.duration);
    times[i] = t;
    mixer.setTime(t);
    fbxRoot.updateMatrixWorld(true);
    for (const j of RIG_JOINTS) world[j].copy(bones[j].getWorldQuaternion(wq)).multiply(ref.offsets[j]);
    for (const j of RIG_JOINTS) {
      const parent = RIG_PARENT[j];
      local.copy(world[j]);
      if (parent) local.premultiply(wq.copy(world[parent]).invert());
      // Mantém o hemisfério contínuo (sem giros de 360° na interpolação).
      const a = quats[j];
      if (i > 0 && local.x * a[(i - 1) * 4] + local.y * a[(i - 1) * 4 + 1] + local.z * a[(i - 1) * 4 + 2] + local.w * a[(i - 1) * 4 + 3] < 0) {
        local.set(-local.x, -local.y, -local.z, -local.w);
      }
      local.toArray(a, i * 4);
    }
    hips.getWorldPosition(hp);
    raw.push(hp.x, hp.y, hp.z);
  }
  // Quadril: escala do personagem da Mixamo para a do jogo; sem avanço no lugar.
  const k = ref.scale;
  const x0 = raw[0], z0 = raw[2], x1 = raw[(n - 1) * 3], z1 = raw[(n - 1) * 3 + 2];
  const root = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const dx = raw[i * 3] - x0, dz = raw[i * 3 + 2] - z0;
    root[i * 2] = dx * k; root[i * 2 + 1] = dz * k;
    const driftX = inPlace ? (x1 - x0) * f : dx, driftZ = inPlace ? (z1 - z0) * f : dz;
    pos[i * 3] = (dx - driftX) * k;
    pos[i * 3 + 1] = raw[i * 3 + 1] * k;
    pos[i * 3 + 2] = (dz - driftZ) * k;
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(fbxRoot);
  const tracks = RIG_JOINTS.map(j => new THREE.QuaternionKeyframeTrack(`${j}.quaternion`, times, quats[j]));
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, pos));
  const out = new THREE.AnimationClip(name, clip.duration, tracks);
  out.userData = { root: { times, values: root }, distance: Math.hypot(x1 - x0, z1 - z0) * k };
  return out;
}
