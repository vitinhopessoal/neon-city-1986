import * as THREE from 'three';

/**
 * Efeitos de disparo com pools fixos (nenhuma alocação por tiro):
 * - partículas aditivas (faíscas, brasas do clarão) e com alfa (fumaça,
 *   poeira, lascas): dois THREE.Points com shader próprio, 1 draw call cada;
 * - cápsulas ejetadas: InstancedMesh (latão) e cartuchos de escopeta;
 * - marcas de impacto: InstancedMesh de quads com textura, desaparecem;
 * - traçantes: poucos quads esticados, visíveis por alguns quadros.
 * O clarão do cano fica no modelo da arma (WeaponView).
 */
const PARTICLE_VS = `
attribute vec4 aColor;
attribute float aSize;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (420.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FS = `
uniform sampler2D map;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
}`;

function softTexture(size = 64, hard = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(hard ? 0.35 : 0.2, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function decalTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  // Marca: anel claro de reboco/poeira + furo escuro com lascas irregulares.
  const ring = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  ring.addColorStop(0, 'rgba(40,36,34,1)');
  ring.addColorStop(0.18, 'rgba(30,26,24,1)');
  ring.addColorStop(0.3, 'rgba(120,112,104,0.75)');
  ring.addColorStop(1, 'rgba(120,112,104,0)');
  g.fillStyle = ring;
  g.fillRect(0, 0, s, s);
  g.fillStyle = 'rgba(15,12,10,1)';
  g.beginPath();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = 5 + (i % 3) * 2;
    g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class ParticlePool {
  constructor(scene, capacity, blending, texture) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.baseAlpha = new Float32Array(capacity);
    this.next = 0;
    this.active = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, capacity);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, a, size, life, { grow = 0, gravity = 0, drag = 0 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.baseAlpha[i] = a;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = grow;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
  }

  update(dt) {
    let active = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { if (this.col[i * 4 + 3] !== 0) this.col[i * 4 + 3] = 0; continue; }
      active++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const dg = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dg; this.vel[i * 3 + 2] *= dg;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dg - this.gravity[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.col[i * 4 + 3] = this.baseAlpha[i] * (k < 0.6 ? k / 0.6 : 1);
    }
    this.active = active;
    this.points.visible = active > 0;
    if (active > 0 || this._wasActive) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
    }
    this._wasActive = active > 0;
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

const IMPACT_STYLE = {
  concrete: { dust: [0.72, 0.68, 0.62], sparks: 2, chips: 5, decal: [0.9, 0.9, 0.9], decalSize: 0.07 },
  asphalt: { dust: [0.32, 0.3, 0.3], sparks: 3, chips: 3, decal: [0.55, 0.55, 0.55], decalSize: 0.06 },
  metal: { dust: [0.5, 0.5, 0.52], sparks: 10, chips: 0, decal: [1.6, 1.55, 1.5], decalSize: 0.045 },
  wood: { dust: [0.55, 0.38, 0.22], sparks: 0, chips: 7, decal: [0.75, 0.55, 0.4], decalSize: 0.06 },
  glass: { dust: [0.85, 0.92, 1.0], sparks: 1, chips: 8, decal: [1.8, 1.9, 2.0], decalSize: 0.08 },
  sand: { dust: [0.88, 0.78, 0.6], sparks: 0, chips: 6, decal: null, decalSize: 0 },
  dirt: { dust: [0.42, 0.36, 0.24], sparks: 0, chips: 5, decal: null, decalSize: 0 },
  water: { dust: [0.85, 0.95, 1.0], sparks: 0, chips: 9, decal: null, decalSize: 0 },
};

export class WeaponEffects {
  constructor(scene, quality = 'medium') {
    this.scene = scene;
    this.quality = quality;
    const soft = softTexture(64, false);
    const hard = softTexture(32, true);
    this.textures = [soft, hard];
    this.add = new ParticlePool(scene, 256, THREE.AdditiveBlending, hard);
    this.alpha = new ParticlePool(scene, 320, THREE.NormalBlending, soft);

    // Cápsulas (latão) e cartuchos de escopeta (vermelhos).
    this.casings = this._casingPool(48, new THREE.CylinderGeometry(0.0045, 0.0045, 0.021, 6), 0xc9a24a, 0.9, 0.32);
    this.shells = this._casingPool(12, new THREE.CylinderGeometry(0.0095, 0.0095, 0.06, 8), 0xb3262e, 0.1, 0.55);

    // Marcas de impacto.
    this.decalCap = 120;
    this.decalTex = decalTexture();
    this.decalMat = new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.decalMat, this.decalCap);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decals.setColorAt(0, new THREE.Color(1, 1, 1));
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 2;
    scene.add(this.decals);
    this.decalLife = new Float32Array(this.decalCap);
    this.decalSize = new Float32Array(this.decalCap);
    this.decalNext = 0;
    this.decalUsed = 0;
    this._dm = new THREE.Matrix4();
    this._dq = new THREE.Quaternion();
    this._dp = new THREE.Vector3();
    this._ds = new THREE.Vector3();
    this._dc = new THREE.Color();
    this._z = new THREE.Vector3(0, 0, 1);
    this._eu = new THREE.Euler();
    this._spin = new THREE.Quaternion();

    // Traçantes.
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tracers = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this.tracerGeo, this.tracerMat);
      m.visible = false;
      m.frustumCulled = false;
      m.userData.life = 0;
      scene.add(m);
      this.tracers.push(m);
    }
    this._tracerNext = 0;
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this.stats = { impacts: 0 };
  }

  _casingPool(cap, geo, color, metalness, roughness) {
    const mat = new THREE.MeshStandardMaterial({ color, metalness, roughness });
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    this.scene.add(mesh);
    return {
      mesh, cap, next: 0, used: 0,
      p: new Float32Array(cap * 3), v: new Float32Array(cap * 3), r: new Float32Array(cap * 3), w: new Float32Array(cap * 3),
      life: new Float32Array(cap), rest: new Uint8Array(cap),
    };
  }

  /** Clarão: brasas e fumaça saindo da boca do cano. */
  muzzle(pos, dir, strength = 1) {
    const n = Math.round(4 + 4 * strength);
    for (let i = 0; i < n; i++) {
      const s = 2 + Math.random() * 4 * strength;
      this.add.spawn(pos.x, pos.y, pos.z,
        dir.x * s + (Math.random() - 0.5) * 1.2, dir.y * s + (Math.random() - 0.5) * 1.2, dir.z * s + (Math.random() - 0.5) * 1.2,
        1.0, 0.72, 0.35, 0.9, 0.02 + Math.random() * 0.02, 0.06 + Math.random() * 0.08, { drag: 6 });
    }
    const puffs = strength > 1.2 ? 4 : 2;
    for (let i = 0; i < puffs; i++) {
      const s = 0.4 + Math.random() * 0.6;
      this.alpha.spawn(pos.x + dir.x * 0.05, pos.y + dir.y * 0.05, pos.z + dir.z * 0.05,
        dir.x * s + (Math.random() - 0.5) * 0.3, dir.y * s + 0.15 + Math.random() * 0.2, dir.z * s + (Math.random() - 0.5) * 0.3,
        0.78, 0.76, 0.8, 0.28 * strength, 0.06 + Math.random() * 0.05, 0.7 + Math.random() * 0.5, { grow: 0.35 + 0.2 * strength, drag: 2.5, gravity: -0.25 });
    }
  }

  /** Impacto numa superfície (material vindo de WeaponBallistics). */
  impact(point, normal, material = 'concrete', power = 1) {
    const st = IMPACT_STYLE[material] || IMPACT_STYLE.concrete;
    this.stats.impacts++;
    const nx = normal.x, ny = normal.y, nz = normal.z;
    // Poeira / borrifo.
    const dustN = material === 'water' ? 3 : 3;
    for (let i = 0; i < dustN; i++) {
      const s = 0.4 + Math.random() * 0.9;
      this.alpha.spawn(point.x + nx * 0.02, point.y + ny * 0.02, point.z + nz * 0.02,
        nx * s + (Math.random() - 0.5) * 0.6, ny * s + Math.random() * 0.5, nz * s + (Math.random() - 0.5) * 0.6,
        st.dust[0], st.dust[1], st.dust[2], 0.55, 0.05 + Math.random() * 0.05, 0.45 + Math.random() * 0.4, { grow: 0.45, drag: 3.5, gravity: material === 'water' ? 3 : -0.1 });
    }
    // Lascas / fragmentos.
    for (let i = 0; i < st.chips * Math.min(1.5, power); i++) {
      const s = 1.5 + Math.random() * 2.5;
      this.alpha.spawn(point.x, point.y, point.z,
        nx * s + (Math.random() - 0.5) * 2.4, ny * s + Math.random() * 2, nz * s + (Math.random() - 0.5) * 2.4,
        st.dust[0] * 0.8, st.dust[1] * 0.8, st.dust[2] * 0.8, 0.95, 0.012 + Math.random() * 0.012, 0.35 + Math.random() * 0.4, { gravity: 9, drag: 0.6 });
    }
    // Faíscas (metal, asfalto, concreto).
    for (let i = 0; i < st.sparks; i++) {
      const s = 2 + Math.random() * 4;
      this.add.spawn(point.x, point.y, point.z,
        nx * s + (Math.random() - 0.5) * 4, ny * s + Math.random() * 2.5, nz * s + (Math.random() - 0.5) * 4,
        1.0, 0.78, 0.4, 1.0, 0.012 + Math.random() * 0.01, 0.12 + Math.random() * 0.2, { gravity: 8, drag: 1 });
    }
    if (st.decal) this._decal(point, normal, st.decalSize * (0.85 + Math.random() * 0.3), st.decal);
  }

  _decal(point, normal, size, tint) {
    const i = this.decalNext;
    this.decalNext = (this.decalNext + 1) % this.decalCap;
    this.decalUsed = Math.min(this.decalCap, this.decalUsed + 1);
    this.decals.count = this.decalUsed;
    this.decalLife[i] = 20;
    this.decalSize[i] = size;
    this._dq.setFromUnitVectors(this._z, normal);
    this._dq.multiply(this._spin.setFromAxisAngle(this._z, Math.random() * Math.PI * 2));
    this._dp.copy(point).addScaledVector(normal, 0.004);
    this._ds.set(size, size, size);
    this._dm.compose(this._dp, this._dq, this._ds);
    this.decals.setMatrixAt(i, this._dm);
    this.decals.setColorAt(i, this._dc.setRGB(tint[0], tint[1], tint[2]));
    this.decals.instanceMatrix.needsUpdate = true;
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
  }

  /** Cápsula ejetada (pos, velocidade do mundo). */
  eject(pos, vel, shotgun = false) {
    const P = shotgun ? this.shells : this.casings;
    const i = P.next;
    P.next = (P.next + 1) % P.cap;
    P.used = Math.min(P.cap, P.used + 1);
    P.mesh.count = P.used;
    P.p.set([pos.x, pos.y, pos.z], i * 3);
    P.v.set([vel.x, vel.y, vel.z], i * 3);
    P.r.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    P.w.set([(Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30], i * 3);
    P.life[i] = 3.0;
    P.rest[i] = 0;
  }

  /** Traçante entre dois pontos. */
  tracer(from, to) {
    const m = this.tracers[this._tracerNext];
    this._tracerNext = (this._tracerNext + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len < 1.5) return;
    // Começa um pouco à frente da boca e cobre um trecho do caminho.
    const a = Math.min(0.8, len * 0.1);
    const seg = Math.min(len - a, 3 + Math.random() * 3);
    this._v.subVectors(to, from).normalize();
    m.position.copy(from).addScaledVector(this._v, a + seg / 2);
    m.scale.set(0.012, 0.012, seg);
    m.lookAt(this._v2.copy(m.position).add(this._v));
    m.visible = true;
    m.userData.life = 0.045;
  }

  update(dt, groundFn) {
    this.add.update(dt);
    this.alpha.update(dt);
    for (const P of [this.casings, this.shells]) this._updateCasings(P, dt, groundFn);
    // Marcas: somem encolhendo no último segundo.
    let dirty = false;
    for (let i = 0; i < this.decalUsed; i++) {
      if (this.decalLife[i] <= 0) continue;
      this.decalLife[i] -= dt;
      if (this.decalLife[i] < 1) {
        this.decals.getMatrixAt(i, this._dm);
        this._dm.decompose(this._dp, this._dq, this._ds);
        const s = Math.max(0, this.decalLife[i]) * this.decalSize[i];
        this._ds.set(s, s, s);
        this._dm.compose(this._dp, this._dq, this._ds);
        this.decals.setMatrixAt(i, this._dm);
        dirty = true;
      }
    }
    if (dirty) this.decals.instanceMatrix.needsUpdate = true;
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.userData.life -= dt;
      if (t.userData.life <= 0) t.visible = false;
    }
  }

  _updateCasings(P, dt, groundFn) {
    if (P.used === 0) return;
    const m = this._dm;
    let any = false;
    for (let i = 0; i < P.used; i++) {
      if (P.life[i] <= 0) continue;
      any = true;
      P.life[i] -= dt;
      const o = i * 3;
      if (!P.rest[i]) {
        P.v[o + 1] -= 9.8 * dt;
        P.p[o] += P.v[o] * dt; P.p[o + 1] += P.v[o + 1] * dt; P.p[o + 2] += P.v[o + 2] * dt;
        P.r[o] += P.w[o] * dt; P.r[o + 1] += P.w[o + 1] * dt; P.r[o + 2] += P.w[o + 2] * dt;
        const g = groundFn ? groundFn(P.p[o], P.p[o + 2], P.p[o + 1]) : 0;
        if (P.p[o + 1] < g + 0.005) {
          P.p[o + 1] = g + 0.005;
          if (Math.abs(P.v[o + 1]) < 0.8) { P.rest[i] = 1; P.r[o] = Math.PI / 2; }
          P.v[o + 1] = -P.v[o + 1] * 0.35;
          P.v[o] *= 0.5; P.v[o + 2] *= 0.5;
          P.w[o] *= 0.4; P.w[o + 1] *= 0.4; P.w[o + 2] *= 0.4;
        }
      }
      const fade = P.life[i] < 0.4 ? Math.max(0, P.life[i] / 0.4) : 1;
      this._dq.setFromEuler(this._eu.set(P.r[o], P.r[o + 1], P.r[o + 2]));
      this._dp.set(P.p[o], P.p[o + 1], P.p[o + 2]);
      this._ds.set(fade, fade, fade);
      m.compose(this._dp, this._dq, this._ds);
      P.mesh.setMatrixAt(i, m);
    }
    if (any) P.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Quantidade de objetos de efeito vivos (para testes de limpeza). */
  liveCounts() {
    const count = (arr, n) => { let k = 0; for (let i = 0; i < n; i++) if (arr[i] > 0) k++; return k; };
    return {
      additive: this.add.active,
      alpha: this.alpha.active,
      casings: count(this.casings.life, this.casings.used),
      shells: count(this.shells.life, this.shells.used),
      decals: count(this.decalLife, this.decalUsed),
      tracers: this.tracers.filter((t) => t.visible).length,
    };
  }

  dispose() {
    this.add.dispose();
    this.alpha.dispose();
    for (const P of [this.casings, this.shells]) { P.mesh.removeFromParent(); P.mesh.geometry.dispose(); P.mesh.material.dispose(); }
    this.decals.removeFromParent();
    this.decals.geometry.dispose();
    this.decalMat.dispose();
    this.decalTex.dispose();
    for (const t of this.tracers) t.removeFromParent();
    this.tracerGeo.dispose();
    this.tracerMat.dispose();
    this.textures.forEach((t) => t.dispose());
  }
}
