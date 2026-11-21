import * as THREE from 'three';
import { weaponMaterials } from './WeaponModels.js';

/**
 * Área de testes de combate (somente desenvolvimento): silhuetas fictícias
 * com pontos de vida, placas de aço que balançam, latas reativas e marcos de
 * distância. Valida precisão, alcance, dano, cadência, recarga e efeitos sem
 * NPCs. Não cria colisores (não bloqueia o jogador nem altera o mapa).
 */
const _inv = new THREE.Matrix4();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Raio contra caixa local (half extents) de um Object3D sem escala. */
function rayOBB(obj, center, half, origin, dir, maxT) {
  obj.updateWorldMatrix(true, false);
  _inv.copy(obj.matrixWorld).invert();
  _o.copy(origin).applyMatrix4(_inv).sub(center);
  _d.copy(dir).transformDirection(_inv);
  let tmin = 0, tmax = maxT, axis = -1, sign = 1;
  for (let k = 0; k < 3; k++) {
    const o = _o.getComponent(k), d = _d.getComponent(k), h = half.getComponent(k);
    if (Math.abs(d) < 1e-9) { if (o < -h || o > h) return null; continue; }
    let t1 = (-h - o) / d, t2 = (h - o) / d;
    let s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = k; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis < 0) return null;
  _n.set(0, 0, 0).setComponent(axis, sign).transformDirection(obj.matrixWorld);
  return { t: tmin, normal: _n.clone() };
}

function labelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#140a24';
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#ff4fb8';
  g.lineWidth = 4;
  g.strokeRect(3, 3, 122, 58);
  g.fillStyle = '#3ff0ff';
  g.font = 'bold 34px Trebuchet MS, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Contorno estilizado (cabeça + ombros + tronco), original. */
function silhouetteShape(scale = 1) {
  const s = new THREE.Shape();
  const P = (x, y) => [x * scale, y * scale];
  const pts = [P(-0.26, 0), P(0.26, 0), P(0.27, 0.52), P(0.2, 0.66), P(0.08, 0.7), P(0.09, 0.76), P(0.11, 0.86), P(0.06, 0.95), P(-0.06, 0.95), P(-0.11, 0.86), P(-0.09, 0.76), P(-0.08, 0.7), P(-0.2, 0.66), P(-0.27, 0.52)];
  s.moveTo(...pts[0]);
  for (const p of pts.slice(1)) s.lineTo(...p);
  s.closePath();
  return s;
}

export class TargetRange {
  constructor(scene, { x, z, yaw = 0, groundY = 0 }) {
    const M = weaponMaterials();
    this.root = new THREE.Group();
    this.root.name = 'TargetRange';
    this.root.position.set(x, groundY, z);
    this.root.rotation.y = yaw;
    scene.add(this.root);
    this.items = [];
    this.stats = { hits: 0, damage: 0, kills: 0, last: null };
    this._geos = [];
    this._mats = [];

    const panelMat = new THREE.MeshStandardMaterial({ color: 0xf1e6d6, roughness: 0.8, emissive: 0x000000 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xff4fb8, roughness: 0.5, emissive: 0xff4fb8, emissiveIntensity: 0.45 });
    const woodMat = M.walnutDark;
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.35 });
    const canMat = new THREE.MeshStandardMaterial({ color: 0x3ff0ff, metalness: 0.6, roughness: 0.3 });
    this._mats.push(panelMat, rimMat, steelMat, canMat);

    const silGeo = new THREE.ExtrudeGeometry(silhouetteShape(1), { depth: 0.02, bevelEnabled: false });
    silGeo.translate(0, 0, -0.01);
    const rimGeo = new THREE.ExtrudeGeometry(silhouetteShape(1.06), { depth: 0.012, bevelEnabled: false });
    rimGeo.translate(0, -0.03, -0.022);
    const postGeo = new THREE.BoxGeometry(0.05, 1.0, 0.05);
    const baseGeo = new THREE.BoxGeometry(0.5, 0.06, 0.3);
    this._geos.push(silGeo, rimGeo, postGeo, baseGeo);

    // Silhuetas a 8, 15, 25 e 40 m (linha de tiro ao longo de -Z local).
    [[-1.6, -8], [1.4, -15], [-0.8, -25], [1.8, -40]].forEach(([tx, tz], i) => {
      const g = new THREE.Group();
      g.position.set(tx, 0, tz);
      const base = new THREE.Mesh(baseGeo, woodMat);
      base.position.y = 0.03;
      const post = new THREE.Mesh(postGeo, woodMat);
      post.position.y = 0.5;
      const pivot = new THREE.Group();
      pivot.position.y = 0.95;
      const panel = new THREE.Mesh(silGeo, panelMat.clone());
      const rim = new THREE.Mesh(rimGeo, rimMat);
      pivot.add(panel, rim);
      g.add(base, post, pivot);
      for (const m of [base, post, panel, rim]) { m.castShadow = true; m.receiveShadow = true; }
      this.root.add(g);
      this._mats.push(panel.material);
      this.items.push({
        kind: 'silhouette', group: g, pivot, panel, hp: 100, maxHp: 100, down: 0, flash: 0, wobble: 0, wobbleV: 0, reset: 0,
        center: new THREE.Vector3(0, 0.47, 0), half: new THREE.Vector3(0.27, 0.48, 0.02), label: `silhueta ${i + 1}`,
      });
    });

    // Placas de aço (balançam) a 20 m.
    const plateGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.02, 16).rotateX(Math.PI / 2);
    const barGeo = new THREE.BoxGeometry(1.6, 0.05, 0.05);
    const legGeo = new THREE.BoxGeometry(0.05, 1.6, 0.05);
    this._geos.push(plateGeo, barGeo, legGeo);
    const frame = new THREE.Group();
    frame.position.set(4.5, 0, -20);
    const bar = new THREE.Mesh(barGeo, steelMat);
    bar.position.y = 1.6;
    const l1 = new THREE.Mesh(legGeo, steelMat); l1.position.set(-0.78, 0.8, 0);
    const l2 = new THREE.Mesh(legGeo, steelMat); l2.position.set(0.78, 0.8, 0);
    frame.add(bar, l1, l2);
    this.root.add(frame);
    [-0.45, 0.05, 0.5].forEach((px) => {
      const pivot = new THREE.Group();
      pivot.position.set(px, 1.58, 0);
      const plate = new THREE.Mesh(plateGeo, steelMat);
      plate.position.y = -0.38;
      plate.castShadow = true;
      pivot.add(plate);
      frame.add(pivot);
      this.items.push({ kind: 'plate', group: pivot, panel: plate, swing: 0, swingV: 0, center: new THREE.Vector3(0, 0, 0), half: new THREE.Vector3(0.16, 0.16, 0.02), label: 'placa' });
    });

    // Latas sobre um tonel a 12 m.
    const barrelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.9, 14);
    const canGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10);
    this._geos.push(barrelGeo, canGeo);
    const barrel = new THREE.Mesh(barrelGeo, M.parkerized);
    barrel.position.set(-4, 0.45, -12);
    barrel.castShadow = true;
    this.root.add(barrel);
    [-0.12, 0, 0.12].forEach((cx) => {
      const can = new THREE.Mesh(canGeo, canMat);
      const home = new THREE.Vector3(-4 + cx, 0.96, -12);
      can.position.copy(home);
      can.castShadow = true;
      this.root.add(can);
      this.items.push({ kind: 'can', group: can, panel: can, home, vel: new THREE.Vector3(), spin: new THREE.Vector3(), flying: false, respawn: 0, center: new THREE.Vector3(), half: new THREE.Vector3(0.04, 0.06, 0.04), label: 'lata' });
    });

    // Marcos de distância.
    for (const dist of [5, 10, 25, 50]) {
      const tex = labelTexture(`${dist} m`);
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      this._mats.push(mat);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), mat);
      this._geos.push(sign.geometry);
      sign.position.set(-3, 0.9, -dist);
      const post = new THREE.Mesh(postGeo, woodMat);
      post.scale.y = 0.75;
      post.position.set(-3, 0.37, -dist - 0.03);
      this.root.add(sign, post);
      sign.userData.tex = tex;
    }
    this.root.updateMatrixWorld(true);
  }

  /** Interface de WeaponBallistics: alvo mais próximo atingido pelo raio. */
  hit(origin, dir, maxT) {
    let best = null;
    for (const it of this.items) {
      if (it.kind === 'silhouette' && it.down > 0.5) continue;
      if (it.kind === 'can' && it.respawn > 0 && !it.flying) continue;
      const h = rayOBB(it.panel, it.center, it.half, origin, dir, best ? best.t : maxT);
      if (h && (!best || h.t < best.t)) best = { t: h.t, normal: h.normal, target: it, material: it.kind === 'silhouette' ? 'wood' : 'metal' };
    }
    if (best) best.target.onHit = (info) => this._onHit(best.target, info);
    return best;
  }

  _onHit(it, { damage, point, dir }) {
    this.stats.hits++;
    this.stats.damage += damage;
    let kill = false;
    if (it.kind === 'silhouette') {
      // Zona da cabeça vale mais.
      _p.copy(point);
      it.pivot.worldToLocal(_p);
      const head = _p.y > 0.72;
      const dmg = damage * (head ? 2 : 1);
      it.hp -= dmg;
      it.flash = 0.12;
      it.wobbleV -= 2.5 + damage * 0.04;
      if (it.hp <= 0 && it.down === 0) { it.down = 0.001; it.reset = 3; kill = true; this.stats.kills++; }
      this.stats.last = { target: it.label, damage: dmg, head, hp: Math.max(0, it.hp) };
    } else if (it.kind === 'plate') {
      it.swingV -= 4 + damage * 0.08;
      this.stats.last = { target: it.label, damage };
    } else if (it.kind === 'can') {
      it.flying = true;
      it.respawn = 6;
      it.vel.copy(dir).multiplyScalar(3 + damage * 0.08);
      it.vel.y += 2.5;
      it.spin.set(Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10);
      this.stats.last = { target: it.label, damage };
      kill = true;
    }
    return { kill };
  }

  update(dt) {
    for (const it of this.items) {
      if (it.kind === 'silhouette') {
        if (it.flash > 0) {
          it.flash -= dt;
          it.panel.material.emissive.setRGB(it.flash > 0 ? 0.9 : 0, it.flash > 0 ? 0.25 : 0, it.flash > 0 ? 0.6 : 0);
        }
        // Balanço amortecido e queda/retorno.
        it.wobbleV += (-it.wobble * 60 - it.wobbleV * 8) * dt;
        it.wobble += it.wobbleV * dt;
        if (it.down > 0) {
          if (it.reset > 0) {
            it.reset -= dt;
            it.down = Math.min(1, it.down + dt * 4);
          } else {
            it.down = Math.max(0, it.down - dt * 2);
            if (it.down === 0) it.hp = it.maxHp;
          }
        }
        it.pivot.rotation.x = it.wobble * 0.3 - it.down * (Math.PI / 2 - 0.15);
      } else if (it.kind === 'plate') {
        it.swingV += (-it.swing * 25 - it.swingV * 1.6) * dt;
        it.swing += it.swingV * dt;
        it.group.rotation.x = it.swing * 0.5;
      } else if (it.kind === 'can') {
        if (it.flying) {
          it.vel.y -= 9.8 * dt;
          // Velocidade em coordenadas do mundo → local da área (sem escala).
          _d.copy(it.vel).applyQuaternion(_q.copy(this.root.quaternion).invert());
          it.group.position.addScaledVector(_d, dt);
          it.group.rotation.x += it.spin.x * dt;
          it.group.rotation.z += it.spin.z * dt;
          if (it.group.position.y < 0.035) { it.group.position.y = 0.035; it.flying = false; }
        }
        if (it.respawn > 0) {
          it.respawn -= dt;
          if (it.respawn <= 0) { it.group.position.copy(it.home); it.group.rotation.set(0, 0, 0); it.flying = false; }
        }
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => { if (o.userData.tex) o.userData.tex.dispose(); });
    this._geos.forEach((g) => g.dispose());
    this._mats.forEach((m) => m.dispose());
  }
}

const _q = new THREE.Quaternion();
