import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildWeaponModel, cloneWeaponModel } from './WeaponModels.js';

/**
 * Representação visual da arma atual:
 * - modelo de 3ª pessoa preso à mão direita do personagem (GLB ou original),
 *   ou ao coldre (quadril, pistolas/compactas) / costas (armas longas);
 * - cópia em 1ª pessoa diante da câmera (escala reduzida e mais próxima, para
 *   não atravessar paredes);
 * - animação das peças (ferrolho, carregador, bomba, manejo) e clarão.
 * Os modelos são criados sob demanda e reaproveitados (cache por arma).
 */
const FP_SCALE = 0.5;
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
// O modelo aponta para +Z; a câmera olha para -Z.
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

function flashTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.25, 'rgba(255,214,120,0.95)');
  grd.addColorStop(0.6, 'rgba(255,120,40,0.35)');
  grd.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = grd;
  g.translate(s / 2, s / 2);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(-s * 0.06, 0);
    g.lineTo(0, -s * 0.5);
    g.lineTo(s * 0.06, 0);
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, s * 0.22, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class WeaponView {
  constructor(scene) {
    this.scene = scene;
    this.cache = new Map();
    this.current = null;
    this.flashTex = flashTexture();
    this.flashMat = new THREE.MeshBasicMaterial({ map: this.flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flashGeo = (() => {
      const a = new THREE.PlaneGeometry(1, 1);
      const b = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2);
      const c = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
      a.translate(0, 0, 0.5); b.translate(0, 0, 0.5);
      const pos = [];
      for (const g of [a, b, c]) {
        const n = g.toNonIndexed();
        pos.push(n);
      }
      const merged = new THREE.BufferGeometry();
      const arrs = pos.map((g) => g.attributes.position.array);
      const uvs = pos.map((g) => g.attributes.uv.array);
      const total = arrs.reduce((s, a2) => s + a2.length, 0);
      const P = new Float32Array(total), U = new Float32Array((total / 3) * 2);
      let o = 0, ou = 0;
      arrs.forEach((a2, i) => { P.set(a2, o); o += a2.length; U.set(uvs[i], ou); ou += uvs[i].length; });
      merged.setAttribute('position', new THREE.BufferAttribute(P, 3));
      merged.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      pos.forEach((g) => g.dispose());
      a.dispose(); b.dispose(); c.dispose();
      return merged;
    })();
    this.flashT = 0;
    this.triangles = 0;
    // Mãos/antebraços simples para a vista em 1ª pessoa (pele + blazer do protagonista).
    this.armMats = {
      skin: new THREE.MeshStandardMaterial({ color: 0xc28a66, roughness: 0.62 }),
      sleeve: new THREE.MeshStandardMaterial({ color: 0x5f55cf, roughness: 0.75 }),
      cuff: new THREE.MeshStandardMaterial({ color: 0xe9e2f2, roughness: 0.8 }),
      watch: new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.6, roughness: 0.35 }),
    };
    this.armGeos = {
      fist: new RoundedBoxGeometry(0.052, 0.1, 0.09, 2, 0.022),
      thumb: new THREE.CapsuleGeometry(0.014, 0.04, 3, 6),
      fore: new THREE.CapsuleGeometry(0.032, 0.24, 3, 8),
      sleeve: new THREE.CylinderGeometry(0.046, 0.05, 0.22, 10, 1, true),
      cuff: new THREE.CylinderGeometry(0.05, 0.05, 0.035, 10),
      watch: new THREE.CylinderGeometry(0.036, 0.036, 0.02, 10),
    };
  }

  /** Antebraço com mão fechada em `pos`, apontando o cotovelo para `dir` (local da arma). */
  _arm(parent, pos, dir, watch) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const M = this.armMats, G = this.armGeos;
    const fist = new THREE.Mesh(G.fist, M.skin);
    const thumb = new THREE.Mesh(G.thumb, M.skin);
    thumb.position.set(0.03, 0.025, 0.02);
    thumb.rotation.x = 0.9;
    // Antebraço ao longo de "dir".
    const arm = new THREE.Group();
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const fore = new THREE.Mesh(G.fore, M.skin);
    fore.position.y = 0.16;
    const sleeve = new THREE.Mesh(G.sleeve, M.sleeve);
    sleeve.position.y = 0.33;
    const cuff = new THREE.Mesh(G.cuff, M.cuff);
    cuff.position.y = 0.23;
    arm.add(fore, sleeve, cuff);
    if (watch) { const w = new THREE.Mesh(G.watch, M.watch); w.position.y = 0.07; arm.add(w); }
    g.add(fist, thumb, arm);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    parent.add(g);
    return g;
  }

  _fpArms(e, def) {
    const a = e.fp.anchors;
    const right = this._arm(e.fp.root, a.grip.clone().add(new THREE.Vector3(-0.004, 0.0, 0.0)), new THREE.Vector3(-0.35, -0.55, -1), false);
    const sup = a.support.clone();
    const leftDir = def.hold === 'long' ? new THREE.Vector3(0.55, -0.55, -0.9) : new THREE.Vector3(0.7, -0.6, -0.8);
    const left = this._arm(e.fp.root, sup.add(new THREE.Vector3(0.012, -0.01, 0)), leftDir, true);
    left.visible = def.hold === 'long';
    e.fpRight = right;
    e.fpLeft = left;
  }

  /** Mão de apoio em 1ª pessoa (pistolas: só ao mirar). */
  setFPSupport(visible) {
    const e = this.current;
    if (e?.fpLeft) e.fpLeft.visible = e.def.hold === 'long' || visible;
  }

  _flash(model, scale) {
    const f = new THREE.Mesh(this.flashGeo, this.flashMat);
    f.position.copy(model.anchors.muzzle);
    f.scale.setScalar(scale);
    f.visible = false;
    f.frustumCulled = false;
    f.renderOrder = 6;
    model.root.add(f);
    return f;
  }

  /** Seleciona a arma exibida (cria os modelos na primeira vez). */
  setWeapon(def) {
    if (this.current?.def === def) return this.current;
    if (this.current) {
      this.current.tp.root.removeFromParent();
      this.current.fp.root.removeFromParent();
    }
    let e = this.cache.get(def.id);
    if (!e) {
      const tp = buildWeaponModel(def);
      const fp = cloneWeaponModel(tp);
      fp.root.scale.setScalar(FP_SCALE);
      fp.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
      const long = def.hold === 'long';
      e = { def, tp, fp, tpFlash: this._flash(tp, long ? 0.16 : 0.11), fpFlash: this._flash(fp, long ? 0.16 : 0.11) };
      this._fpArms(e, def);
      this.cache.set(def.id, e);
    }
    this.scene.add(e.tp.root);
    this.scene.add(e.fp.root);
    e.tp.root.visible = false;
    e.fp.root.visible = false;
    this.current = e;
    this.triangles = e.tp.triangles;
    return e;
  }

  hide() {
    if (!this.current) return;
    this.current.tp.root.visible = false;
    this.current.fp.root.visible = false;
  }

  /** Posição mundial da boca do cano (modelo visível). */
  muzzleWorld(out, fp = false) {
    const m = fp ? this.current.fp : this.current.tp;
    m.root.updateMatrixWorld(true);
    return out.copy(m.anchors.muzzle).applyMatrix4(m.root.matrixWorld);
  }

  anchorWorld(name, out, fp = false) {
    const m = fp ? this.current.fp : this.current.tp;
    m.root.updateMatrixWorld(true);
    return out.copy(m.anchors[name]).applyMatrix4(m.root.matrixWorld);
  }

  /**
   * Arma de 3ª pessoa: palma (mundo) + orientação (mundo) da arma; com
   * holster (Matrix4 mundo do ponto de coldre) e drawK para a transição.
   */
  placeThird({ visible, palm, quat, holsterMatrix, drawK }) {
    const e = this.current;
    if (!e) return;
    const root = e.tp.root;
    root.visible = visible;
    if (!visible) return;
    // Na mão: a âncora da empunhadura cai na palma.
    _v.copy(e.tp.anchors.grip).applyQuaternion(quat);
    const handPos = _v2.copy(palm).sub(_v);
    if (drawK >= 0.999 || !holsterMatrix) {
      root.position.copy(handPos);
      root.quaternion.copy(quat);
      return;
    }
    // Coldre → mão (curva simples).
    holsterMatrix.decompose(root.position, _q, root.scale);
    root.scale.setScalar(1);
    const k = drawK * drawK * (3 - 2 * drawK);
    root.position.lerp(handPos, k);
    root.position.y += Math.sin(k * Math.PI) * 0.08;
    root.quaternion.slerpQuaternions(_q, quat, k);
  }

  /** Arma em 1ª pessoa diante da câmera. */
  placeFirst({ visible, camera, offset, kick, roll, yawIn = 0 }) {
    const e = this.current;
    if (!e) return;
    const root = e.fp.root;
    root.visible = visible;
    if (!visible) return;
    _v.set(offset.x * FP_SCALE, offset.y * FP_SCALE, offset.z * FP_SCALE).applyQuaternion(camera.quaternion);
    root.position.copy(camera.position).add(_v);
    _e.set(-kick * 0.25, yawIn, roll, 'XYZ');
    _q2.setFromEuler(_e);
    root.quaternion.copy(camera.quaternion).multiply(FLIP).multiply(_q2);
    // A âncora da empunhadura fica no ponto do deslocamento.
    _v.copy(e.fp.anchors.grip).multiplyScalar(FP_SCALE).applyQuaternion(root.quaternion);
    root.position.sub(_v);
  }

  /** Peças animadas e clarão (mesmo estado nos dois modelos). */
  animateParts({ slide = 0, mag = 0, pump = 0, bolt = 0 }, dt) {
    const e = this.current;
    if (!e) return;
    for (const m of [e.tp, e.fp]) {
      const P = m.parts;
      if (P.slide) P.slide.position.z = -slide * (m.recoilTravel || 0.028);
      if (P.mag) { P.mag.position.y = -mag * 0.14; P.mag.visible = mag < 0.97; }
      if (P.pump) P.pump.position.z = -pump * (m.pumpTravel || 0.07);
      if (P.bolt) P.bolt.position.z = -bolt * (m.boltTravel || 0.04);
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { e.tpFlash.visible = false; e.fpFlash.visible = false; }
    }
  }

  flash(strength = 1) {
    const e = this.current;
    if (!e) return;
    this.flashT = 0.05;
    for (const f of [e.tpFlash, e.fpFlash]) {
      f.visible = true;
      f.rotation.z = Math.random() * Math.PI;
      const base = e.def.hold === 'long' ? 0.16 : 0.11;
      f.scale.setScalar(base * (0.8 + Math.random() * 0.5) * strength);
    }
  }

  dispose() {
    for (const e of this.cache.values()) {
      e.tp.root.removeFromParent();
      e.fp.root.removeFromParent();
      e.tp.root.traverse((o) => { if (o.isMesh && o.geometry !== this.flashGeo) o.geometry.dispose(); });
    }
    this.cache.clear();
    this.flashGeo.dispose();
    this.flashMat.dispose();
    this.flashTex.dispose();
  }
}

export const _wv = { _m };
