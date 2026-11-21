import * as THREE from 'three';

/**
 * Efeitos automotivos com limites fixos de memória:
 *  - marcas de pneu: InstancedMesh em buffer circular (máx. 360 segmentos),
 *    esmaecem e somem após 14 s
 *  - fumaça leve do capô em estado crítico: Points com 48 partículas
 * Nada é alocado por quadro; atualização das marcas ocorre a cada 0,25 s.
 */
const MAX_MARKS = 360;
const MARK_LIFE = 14;
const SMOKE_N = 48;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class VehicleEffects {
  constructor(scene, lib) {
    this.scene = scene;
    // --- Marcas de pneu.
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.alpha = new Float32Array(MAX_MARKS);
    geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1));
    const mat = new THREE.MeshBasicMaterial({
      color: 0x040405, transparent: true, depthWrite: false, opacity: 0.82,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= vAlpha;');
    };
    mat.customProgramCacheKey = () => 'neon-skidmarks';
    this.marks = new THREE.InstancedMesh(geo, mat, MAX_MARKS);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.marks.name = 'vehicles:skidmarks';
    this.marks.renderOrder = 1;
    scene.add(this.marks);
    this.birth = new Float32Array(MAX_MARKS);
    this.head = 0;
    this.used = 0;
    this.time = 0;
    this._fadeTimer = 0;
    this._last = new Map(); // chave roda -> último ponto

    // --- Fumaça.
    const sg = new THREE.BufferGeometry();
    this.smokePos = new Float32Array(SMOKE_N * 3);
    this.smokeVel = new Float32Array(SMOKE_N * 3);
    this.smokeLife = new Float32Array(SMOKE_N);
    sg.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    this.smoke = new THREE.Points(sg, new THREE.PointsMaterial({
      map: lib.textures.glow, color: 0x8a8a90, size: 1.4, transparent: true, opacity: 0.45, depthWrite: false, sizeAttenuation: true,
    }));
    this.smoke.frustumCulled = false;
    this.smoke.visible = false;
    this.smoke.name = 'vehicles:smoke';
    scene.add(this.smoke);
    this._smokeNext = 0;
    this._smokeIdx = 0;
  }

  /** Adiciona um segmento de marca para a roda (x, y, z = contato com o solo). */
  skid(key, x, y, z, width = 0.27) {
    const last = this._last.get(key);
    if (!last) { this._last.set(key, { x, y, z, t: this.time }); return; }
    const dx = x - last.x, dz = z - last.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.3) return;
    if (len > 2.5 || this.time - last.t > 0.3) { last.x = x; last.y = y; last.z = z; last.t = this.time; return; }
    const i = this.head;
    _p.set((x + last.x) / 2, Math.max(y, last.y) + 0.02, (z + last.z) / 2);
    _q.setFromAxisAngle(_up, Math.atan2(dx, dz));
    _s.set(width, 1, len + 0.05);
    _m.compose(_p, _q, _s);
    this.marks.setMatrixAt(i, _m);
    this.alpha[i] = 1;
    this.birth[i] = this.time;
    this.head = (this.head + 1) % MAX_MARKS;
    this.used = Math.min(MAX_MARKS, this.used + 1);
    this.marks.count = this.used;
    this.marks.instanceMatrix.needsUpdate = true;
    this.marks.geometry.attributes.aAlpha.needsUpdate = true;
    last.x = x; last.y = y; last.z = z; last.t = this.time;
  }

  endSkid(key) {
    this._last.delete(key);
  }

  /** Emite fumaça a partir de um ponto (capô do carro danificado). */
  emitSmoke(x, y, z, rate, dt) {
    this._smokeNext -= dt * rate;
    while (this._smokeNext <= 0) {
      this._smokeNext += 1;
      const i = this._smokeIdx;
      this._smokeIdx = (i + 1) % SMOKE_N;
      this.smokePos[i * 3] = x + (Math.random() - 0.5) * 0.4;
      this.smokePos[i * 3 + 1] = y;
      this.smokePos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
      this.smokeVel[i * 3] = (Math.random() - 0.5) * 0.4;
      this.smokeVel[i * 3 + 1] = 0.9 + Math.random() * 0.6;
      this.smokeVel[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      this.smokeLife[i] = 2.2;
      this.smoke.visible = true;
    }
  }

  update(dt) {
    this.time += dt;
    this._fadeTimer -= dt;
    if (this._fadeTimer <= 0 && this.used > 0) {
      this._fadeTimer = 0.25;
      for (let i = 0; i < this.used; i++) {
        const age = this.time - this.birth[i];
        this.alpha[i] = age > MARK_LIFE ? 0 : Math.min(1, (MARK_LIFE - age) / 4);
      }
      this.marks.geometry.attributes.aAlpha.needsUpdate = true;
    }
    if (this.smoke.visible) {
      let alive = 0;
      for (let i = 0; i < SMOKE_N; i++) {
        if (this.smokeLife[i] <= 0) { this.smokePos[i * 3 + 1] = -999; continue; }
        alive++;
        this.smokeLife[i] -= dt;
        this.smokePos[i * 3] += this.smokeVel[i * 3] * dt;
        this.smokePos[i * 3 + 1] += this.smokeVel[i * 3 + 1] * dt;
        this.smokePos[i * 3 + 2] += this.smokeVel[i * 3 + 2] * dt;
      }
      this.smoke.geometry.attributes.position.needsUpdate = true;
      if (!alive) this.smoke.visible = false;
    }
  }

  setVisible(v) {
    this.marks.visible = v;
    if (!v) this.smoke.visible = false;
  }

  clear() {
    this.used = 0;
    this.head = 0;
    this.marks.count = 0;
    this._last.clear();
    this.smokeLife.fill(0);
    this.smoke.visible = false;
  }
}
