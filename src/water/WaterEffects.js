import * as THREE from 'three';

/**
 * Esteira, espuma e respingos com POOL fixo (InstancedMesh única, sem
 * alocação por quadro). Cada partícula é um quadrado deitado na superfície
 * (espuma) ou um floco que sobe e cai (respingo); a opacidade vai na cor da
 * instância (mistura aditiva). Partículas antigas são reaproveitadas.
 */
const MAX = 240;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function foamTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  // Mancha cheia e macia (sem miolo vazado), salpicada de bolhas discretas.
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.32)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 26;
    g.fillStyle = `rgba(255,255,255,${(0.05 + Math.random() * 0.12).toFixed(3)})`;
    g.beginPath(); g.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 0.8 + Math.random() * 1.8, 0, 6.3); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

export class WaterEffects {
  constructor(scene) {
    this.scene = scene;
    this.built = false;
    this.p = [];
    this.next = 0;
    this.live = 0;
    this.stats = { spawned: 0, reused: 0, max: MAX };
  }

  _build() {
    if (this.built || typeof document === 'undefined') return this.built;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({ map: foamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'water-effects';
    for (let i = 0; i < MAX; i++) {
      this.p.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 1, s1: 2, rot: 0, spray: false, a: 1 });
      _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    this.scene.add(this.mesh);
    this.built = true;
    return true;
  }

  setVisible(v) { if (this.mesh) this.mesh.visible = v; }

  /** Espuma deitada (esteira/proa): tamanho inicial→final, duração e intensidade. */
  foam(x, z, s0, s1, life, a = 0.6, vx = 0, vz = 0) {
    return this._spawn(x, 0, z, vx, 0, vz, s0, s1, life, a, false);
  }

  /** Respingo (sobe e cai). */
  spray(x, y, z, vx, vy, vz, size = 0.5, life = 0.7, a = 0.8) {
    return this._spawn(x, y, z, vx, vy, vz, size, size * 1.6, life, a, true);
  }

  _spawn(x, y, z, vx, vy, vz, s0, s1, life, a, spray) {
    if (!this._build()) return null;
    const p = this.p[this.next];
    if (p.on) this.stats.reused++;
    this.next = (this.next + 1) % MAX;
    Object.assign(p, { on: true, x, y, z, vx, vy, vz, age: 0, life, s0, s1, a, spray, rot: Math.random() * 6.28 });
    this.stats.spawned++;
    return p;
  }

  update(dt, surface) {
    if (!this.built) return;
    let live = 0;
    for (let i = 0; i < MAX; i++) {
      const p = this.p[i];
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.on = false;
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        this.mesh.setColorAt(i, _c.setRGB(0, 0, 0));
        continue;
      }
      live++;
      const t = p.age / p.life;
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.vx *= Math.exp(-dt * 1.5); p.vz *= Math.exp(-dt * 1.5);
      const s = p.s0 + (p.s1 - p.s0) * Math.sqrt(t);
      let y;
      if (p.spray) {
        p.vy -= 9.8 * dt;
        p.y += p.vy * dt;
        const sy = surface.height(p.x, p.z);
        if (p.y < sy) { p.y = sy; p.vy = 0; }
        y = p.y;
        _e.set(-Math.PI / 2 + 0.6, p.rot, 0);
      } else {
        y = surface.height(p.x, p.z) + 0.04;
        _e.set(-Math.PI / 2, 0, p.rot);
      }
      _q.setFromEuler(_e);
      _m.compose(_p.set(p.x, y, p.z), _q, _s.set(s, s, s));
      this.mesh.setMatrixAt(i, _m);
      const k = p.a * (1 - t) * Math.min(1, p.age * 8);
      this.mesh.setColorAt(i, _c.setRGB(k, k, k * 0.98));
    }
    this.live = live;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
