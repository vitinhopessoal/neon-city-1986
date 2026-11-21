import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Protagonista procedural: "Leo Navarro", moda casual de Miami nos anos 80
 * (camiseta clara, blazer leve em tom pastel com mangas puxadas, calça
 * de linho e tênis brancos). Modelo hierárquico com pivôs nas articulações.
 *
 * Frente do personagem: +Z local. Esquerda: +X.
 * Camadas: a cabeça (e cabelo/pescoço) fica na camada HEAD_LAYER para poder
 * ser ocultada da câmera em primeira pessoa sem perder a sombra.
 */
export const HEAD_LAYER = 1;
export const BODY_LAYER = 2;
/** Braços: ocultos da câmera em primeira pessoa (cruzariam a visão ao correr), mas com sombra. */
export const ARMS_LAYER = 3;

const COLORS = {
  skin: 0xc98d68,
  hair: 0x2a1c16,
  shirt: 0xf4efe6,
  jacket: 0x9ee3d3,
  jacketLining: 0x6fbfb0,
  pants: 0xe4dccb,
  belt: 0x5a3d2b,
  shoe: 0xf6f6f2,
  sole: 0xcfc6b4,
  stripe: 0xff6fa8,
  eye: 0x1c1410,
  lip: 0xa8604f,
};

function mat(color, roughness = 0.75, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

export function buildCharacter() {
  const M = {
    skin: mat(COLORS.skin, 0.62),
    skinHead: mat(COLORS.skin, 0.62),
    hair: mat(COLORS.hair, 0.55),
    shirt: mat(COLORS.shirt, 0.85),
    jacket: new THREE.MeshStandardMaterial({ color: COLORS.jacket, roughness: 0.7, side: THREE.DoubleSide }),
    lining: mat(COLORS.jacketLining, 0.8),
    pants: mat(COLORS.pants, 0.85),
    belt: mat(COLORS.belt, 0.5),
    shoe: mat(COLORS.shoe, 0.55),
    sole: mat(COLORS.sole, 0.9),
    stripe: mat(COLORS.stripe, 0.6),
    eye: mat(COLORS.eye, 0.3),
    lip: mat(COLORS.lip, 0.6),
    watch: mat(0xd9c58a, 0.3, 0.8),
  };

  const headMeshes = [];
  const bodyMeshes = [];
  const mesh = (geo, material, parent, x = 0, y = 0, z = 0, head = false) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    (head ? headMeshes : bodyMeshes).push(m);
    return m;
  };
  const pivot = (name, parent, x, y, z) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  const root = new THREE.Group();
  root.name = 'player';
  const hips = pivot('hips', root, 0, 0.95, 0);

  // Quadril / calça.
  mesh(new RoundedBoxGeometry(0.34, 0.2, 0.22, 3, 0.07), M.pants, hips, 0, -0.03, 0);
  mesh(new RoundedBoxGeometry(0.345, 0.05, 0.225, 2, 0.02), M.belt, hips, 0, 0.07, 0);
  mesh(new THREE.BoxGeometry(0.05, 0.035, 0.01), M.watch, hips, 0, 0.07, 0.115);

  // Tronco (camiseta + blazer aberto na frente).
  const spine = pivot('spine', hips, 0, 0.08, 0);
  const chest = pivot('chest', spine, 0, 0.0, 0);
  const torsoProfile = [
    [0.0, 0.0], [0.15, 0.0], [0.155, 0.08], [0.162, 0.2], [0.18, 0.32], [0.19, 0.39], [0.16, 0.45], [0.08, 0.5], [0.0, 0.51],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const shirtGeo = new THREE.LatheGeometry(torsoProfile, 18);
  shirtGeo.scale(1, 1, 0.66);
  mesh(shirtGeo, M.shirt, chest, 0, -0.02, 0);
  const jacketProfile = [
    [0.165, -0.1], [0.17, 0.05], [0.175, 0.2], [0.195, 0.33], [0.205, 0.4], [0.18, 0.46], [0.1, 0.505],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const jacketGeo = new THREE.LatheGeometry(jacketProfile, 20, 0.42, Math.PI * 2 - 0.84);
  jacketGeo.scale(1.02, 1, 0.72);
  mesh(jacketGeo, M.jacket, chest, 0, -0.02, 0);
  // Lapelas.
  for (const s of [-1, 1]) {
    const lapel = mesh(new THREE.BoxGeometry(0.06, 0.26, 0.012), M.lining, chest, s * 0.068, 0.33, 0.128);
    lapel.rotation.set(-0.12, 0, s * 0.32);
    const lapel2 = mesh(new THREE.BoxGeometry(0.035, 0.32, 0.01), M.jacket, chest, s * 0.075, 0.13, 0.122);
    lapel2.rotation.set(-0.02, s * 0.25, 0);
  }
  // Ombreiras sutis (anos 80).
  for (const s of [-1, 1]) {
    const pad = mesh(new THREE.SphereGeometry(0.075, 12, 8), M.jacket, chest, s * 0.19, 0.42, 0);
    pad.scale.set(1.15, 0.7, 1.05);
  }

  // Pescoço e cabeça.
  const neck = pivot('neck', chest, 0, 0.49, 0.0);
  mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.1, 12), M.skinHead, neck, 0, 0.03, 0, true);
  const head = pivot('head', neck, 0, 0.09, 0.01);
  const skull = mesh(new THREE.SphereGeometry(0.108, 20, 16), M.skinHead, head, 0, 0.08, 0, true);
  skull.scale.set(0.95, 1.12, 1.02);
  const jaw = mesh(new RoundedBoxGeometry(0.15, 0.09, 0.14, 3, 0.04), M.skinHead, head, 0, 0.015, 0.025, true);
  jaw.rotation.x = 0.12;
  const nose = mesh(new THREE.ConeGeometry(0.02, 0.055, 8), M.skinHead, head, 0, 0.07, 0.112, true);
  nose.rotation.x = Math.PI / 2 - 0.25;
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.028, 10, 8), M.skinHead, head, s * 0.103, 0.075, -0.005, true);
    ear.scale.set(0.45, 1, 0.8);
    const eyeWhite = mesh(new THREE.SphereGeometry(0.017, 10, 8), M.shirt, head, s * 0.038, 0.098, 0.096, true);
    eyeWhite.scale.set(1, 0.7, 0.6);
    mesh(new THREE.SphereGeometry(0.0095, 8, 6), M.eye, head, s * 0.038, 0.098, 0.1055, true);
    const brow = mesh(new THREE.BoxGeometry(0.042, 0.011, 0.014), M.hair, head, s * 0.04, 0.123, 0.104, true);
    brow.rotation.z = s * -0.12;
  }
  mesh(new THREE.BoxGeometry(0.045, 0.008, 0.01), M.lip, head, 0, 0.025, 0.1, true);
  // Cabelo: calota inclinada para trás (testa livre) + topete volumoso + costeletas.
  const hairCap = mesh(new THREE.SphereGeometry(0.118, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), M.hair, head, 0, 0.098, -0.012, true);
  hairCap.scale.set(1.02, 1.05, 1.08);
  hairCap.rotation.x = -0.5;
  const quiff = mesh(new RoundedBoxGeometry(0.17, 0.075, 0.13, 3, 0.03), M.hair, head, 0, 0.195, 0.03, true);
  quiff.rotation.x = -0.3;
  const back = mesh(new THREE.SphereGeometry(0.1, 14, 10), M.hair, head, 0, 0.07, -0.05, true);
  back.scale.set(1.02, 0.95, 0.8);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.014, 0.055, 0.03), M.hair, head, s * 0.101, 0.07, 0.025, true);

  // Braços: blazer no braço, manga puxada até o antebraço, mão.
  const arms = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const shoulder = pivot(`shoulder${side}`, chest, s * 0.205, 0.41, 0);
    mesh(new THREE.CapsuleGeometry(0.058, 0.2, 4, 10), M.jacket, shoulder, 0, -0.14, 0);
    const elbow = pivot(`elbow${side}`, shoulder, 0, -0.285, 0);
    mesh(new THREE.CylinderGeometry(0.058, 0.054, 0.1, 10), M.jacket, elbow, 0, -0.03, 0);
    mesh(new THREE.TorusGeometry(0.052, 0.012, 6, 12), M.lining, elbow, 0, -0.08, 0).rotation.x = Math.PI / 2;
    mesh(new THREE.CapsuleGeometry(0.041, 0.16, 4, 10), M.skin, elbow, 0, -0.15, 0);
    if (side === 'L') mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.025, 12), M.watch, elbow, 0, -0.225, 0);
    const wrist = pivot(`wrist${side}`, elbow, 0, -0.255, 0);
    mesh(new RoundedBoxGeometry(0.045, 0.1, 0.085, 2, 0.02), M.skin, wrist, 0, -0.05, 0.005);
    const thumb = mesh(new THREE.CapsuleGeometry(0.014, 0.035, 3, 6), M.skin, wrist, s * -0.005, -0.04, 0.05);
    thumb.rotation.x = 0.5;
    arms[side] = { shoulder, elbow, wrist };
  }

  // Pernas.
  const legs = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const hip = pivot(`hip${side}`, hips, s * 0.095, -0.05, 0);
    mesh(new THREE.CapsuleGeometry(0.078, 0.3, 4, 10), M.pants, hip, 0, -0.21, 0);
    const knee = pivot(`knee${side}`, hip, 0, -0.42, 0);
    mesh(new THREE.CapsuleGeometry(0.064, 0.3, 4, 10), M.pants, knee, 0, -0.2, -0.005);
    const ankle = pivot(`ankle${side}`, knee, 0, -0.4, 0);
    mesh(new RoundedBoxGeometry(0.11, 0.085, 0.27, 3, 0.035), M.shoe, ankle, 0, -0.035, 0.05);
    mesh(new RoundedBoxGeometry(0.115, 0.03, 0.28, 2, 0.012), M.sole, ankle, 0, -0.072, 0.05);
    mesh(new THREE.BoxGeometry(0.004, 0.03, 0.12), M.stripe, ankle, s * 0.056, -0.03, 0.04);
    legs[side] = { hip, knee, ankle };
  }

  for (const m of headMeshes) m.layers.set(HEAD_LAYER);
  for (const m of bodyMeshes) m.layers.set(BODY_LAYER);
  const armMeshes = [];
  for (const side of ['L', 'R']) {
    arms[side].shoulder.traverse((o) => {
      if (o.isMesh) { o.layers.set(ARMS_LAYER); armMeshes.push(o); }
    });
  }

  return {
    root,
    joints: { hips, spine, chest, neck, head, arms, legs },
    headMeshes,
    bodyMeshes,
    armMeshes,
    materials: M,
    dispose() {
      root.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
      Object.values(M).forEach((mm) => mm.dispose());
    },
  };
}
