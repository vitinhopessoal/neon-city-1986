import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Animações ambientes centralizadas (baratas e controladas por perfil):
 *  - bandeiras ondulando (todas numa única malha; onda no vertex shader)
 *  - placas penduradas balançando (pivôs individuais)
 *  - exaustores girando nas coberturas (uma InstancedMesh)
 *  - boias balançando na linha de arrebentação (uma InstancedMesh)
 * Água, palmeiras e neon já têm animação própria (Ocean, PalmGenerator,
 * NeonSignSystem). Objetos distantes da câmera não são atualizados e o perfil
 * BAIXO congela todas as animações deste sistema.
 */
const FLAG_UNIFORMS = { uFlagTime: { value: 0 }, uFlagAmp: { value: 1 } };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _axis = new THREE.Vector3(0, 1, 0);

export class AmbientSystem {
  constructor(lib, parent, quality) {
    this.lib = lib;
    this.parent = parent;
    this.enabled = quality.ambient !== false;
    this.flags = [];
    this.swings = [];
    this.fans = [];
    this.updateRadius = 140;
  }

  /**
   * Bandeira presa a um mastro (x, z = base do mastro). rot = direção da bandeira.
   * pole: false usa um mastro já existente (ex.: torres de salva-vidas);
   * colors: [cima, baixo] desenha uma bandeira lisa bicolor em vez da textura.
   */
  addFlag(x, y, z, rot = 0, { height = 5.2, w = 1.3, h = 0.85, pole = true, colors = null } = {}) {
    this.flags.push({ x, y, z, rot, height, w, h, pole, colors, phase: (x * 0.37 + z * 0.73) % 6.28 });
  }

  /** Boia flutuante (balança com as ondas). */
  addBuoy(x, y, z, color = 0xff4f3a) {
    if (!this.buoys) this.buoys = [];
    this.buoys.push({ x, y, z, color });
  }

  /** Objeto que balança em torno do próprio eixo X local (placas penduradas). */
  addSwing(object, amp = 0.12, speed = 1.6, axis = 'z') {
    this.swings.push({ object, amp, speed, axis, phase: (object.id * 1.37) % 6.28, base: object.rotation[axis] });
  }

  addFan(position, radius = 0.4) {
    this.fans.push({ position: position.clone(), radius, angle: Math.random() * 6.28, speed: 3 + Math.random() * 3 });
  }

  build(collision) {
    // --- Bandeiras: malhas com atributos de onda (texturizadas e bicolores); mastros fundidos.
    if (this.flags.length) {
      const textured = [], plain = [], poleGeos = [];
      this.flags.forEach((f, idx) => {
        const g = new THREE.PlaneGeometry(f.w, f.h, 10, 4);
        g.translate(f.w / 2 + 0.05, f.height - f.h / 2 - 0.15, 0);
        const n = g.attributes.position.count;
        const wave = new Float32Array(n), phase = new Float32Array(n);
        const pos = g.attributes.position;
        for (let i = 0; i < n; i++) { wave[i] = (pos.getX(i) - 0.05) / f.w; phase[i] = f.phase; }
        g.setAttribute('aWave', new THREE.BufferAttribute(wave, 1));
        g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
        if (f.colors) {
          const col = new Float32Array(n * 3);
          const top = new THREE.Color(f.colors[0]), bot = new THREE.Color(f.colors[1] ?? f.colors[0]);
          const mid = f.height - f.h / 2 - 0.15;
          for (let i = 0; i < n; i++) { const c = pos.getY(i) >= mid ? top : bot; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
          g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        }
        g.rotateY(f.rot);
        g.translate(f.x, f.y, f.z);
        (f.colors ? plain : textured).push(g);
        if (f.pole) {
          const pg = new THREE.CylinderGeometry(0.045, 0.06, f.height, 8);
          pg.translate(f.x, f.y + f.height / 2, f.z);
          poleGeos.push(pg);
          const ball = new THREE.SphereGeometry(0.09, 8, 6);
          ball.translate(f.x, f.y + f.height + 0.05, f.z);
          poleGeos.push((ball.index ? ball.toNonIndexed() : ball));
          collision?.addCylinder({ id: `flag_${idx}`, ownerId: 'ambient', x: f.x, z: f.z, radius: 0.1, minY: f.y - 0.2, maxY: f.y + f.height, cameraBlocker: false });
        }
      });
      const waveShader = (shader) => {
        shader.uniforms.uFlagTime = FLAG_UNIFORMS.uFlagTime;
        shader.uniforms.uFlagAmp = FLAG_UNIFORMS.uFlagAmp;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uFlagTime;\nuniform float uFlagAmp;\nattribute float aWave;\nattribute float aPhase;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            {
              float t = uFlagTime * 3.6 + aPhase;
              float k = aWave * uFlagAmp;
              // Deslocamento perpendicular ao pano (normal já em espaço do mundo na geometria).
              float wv = sin(t - aWave * 5.5) * 0.16 * k + sin(t * 1.7 - aWave * 9.0) * 0.05 * k;
              transformed.x += normal.x * wv;
              transformed.z += normal.z * wv;
              transformed.y += sin(t * 0.8 - aWave * 3.0) * 0.04 * k;
            }`);
      };
      const keep = (extra) => (list) => list.map((g) => {
        const c = g.index ? g.toNonIndexed() : g;
        for (const n of Object.keys(c.attributes)) if (!['position', 'normal', 'uv', ...extra].includes(n)) c.deleteAttribute(n);
        return c;
      });
      const makeFlags = (geos, mat, name, extra) => {
        mat.onBeforeCompile = waveShader;
        mat.customProgramCacheKey = () => `neon-flag-wave-${name}`;
        const mesh = new THREE.Mesh(mergeGeometries(keep(['aWave', 'aPhase', ...extra])(geos), false), mat);
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        mesh.name = `ambient:${name}`;
        this.parent.add(mesh);
        return mesh;
      };
      if (textured.length) this.flagMesh = makeFlags(textured, new THREE.MeshStandardMaterial({ map: this.lib.textures.flag, side: THREE.DoubleSide, roughness: 0.85 }), 'flags', []);
      if (plain.length) this.plainFlagMesh = makeFlags(plain, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }), 'lifeguardFlags', ['color']);
      if (poleGeos.length) {
        const poles = new THREE.Mesh(mergeGeometries(keep([])(poleGeos), false), this.lib.solid(0xdfe3ea, 0.3, 0.8));
        poles.castShadow = true;
        poles.name = 'ambient:flagPoles';
        this.parent.add(poles);
      }
    }

    // --- Boias: esfera + topo, cores por instância; balanço no vertex shader.
    if (this.buoys?.length) {
      const body = new THREE.SphereGeometry(0.3, 12, 8);
      body.scale(1, 0.85, 1);
      const cap = new THREE.CylinderGeometry(0.06, 0.08, 0.35, 8).translate(0, 0.35, 0);
      const geo = mergeGeometries([body.index ? body.toNonIndexed() : body, cap.index ? cap.toNonIndexed() : cap], false);
      body.dispose(); cap.dispose();
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 });
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uFlagTime = FLAG_UNIFORMS.uFlagTime;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uFlagTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            {
              float ph = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.37;
              float bob = sin(uFlagTime * 1.25 + ph) * 0.07 + sin(uFlagTime * 2.1 + ph * 1.7) * 0.025;
              transformed.y += bob;
              transformed.x += position.y * sin(uFlagTime * 1.1 + ph) * 0.18;
              transformed.z += position.y * cos(uFlagTime * 0.9 + ph) * 0.12;
            }`);
      };
      mat.customProgramCacheKey = () => 'neon-buoy-bob';
      const im = new THREE.InstancedMesh(geo, mat, this.buoys.length);
      const m = new THREE.Matrix4(), c = new THREE.Color();
      this.buoys.forEach((b, i) => {
        m.makeTranslation(b.x, b.y, b.z);
        im.setMatrixAt(i, m);
        im.setColorAt(i, c.set(b.color));
      });
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = false;
      im.name = 'ambient:buoys';
      this.parent.add(im);
      this.buoyMesh = im;
    }

    // --- Exaustores giratórios (pás em cruz) numa InstancedMesh.
    if (this.fans.length) {
      const parts = [];
      for (let i = 0; i < 4; i++) {
        const b = new THREE.BoxGeometry(0.9, 0.02, 0.16);
        b.translate(0.45, 0, 0);
        b.rotateY((i / 4) * Math.PI * 2);
        b.rotateX(0.0);
        parts.push(b);
      }
      const hub = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8);
      parts.push((hub.index ? hub.toNonIndexed() : hub));
      const geo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      this.fanMesh = new THREE.InstancedMesh(geo, this.lib.m.darkMetal, this.fans.length);
      this.fanMesh.name = 'ambient:fans';
      this.fanMesh.castShadow = false;
      this._writeFans(true);
      this.parent.add(this.fanMesh);
    }
  }

  _writeFans(all, camPos = null) {
    const r2 = this.updateRadius * this.updateRadius;
    this.fans.forEach((f, i) => {
      if (!all && camPos && camPos.distanceToSquared(f.position) > r2) return;
      _q.setFromAxisAngle(_axis, f.angle);
      _s.setScalar(f.radius / 0.9 * 1.0);
      _m.compose(f.position, _q, _s);
      this.fanMesh.setMatrixAt(i, _m);
    });
    this.fanMesh.instanceMatrix.needsUpdate = true;
    if (all) this.fanMesh.computeBoundingSphere();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    FLAG_UNIFORMS.uFlagAmp.value = enabled ? 1 : 0.25;
  }

  update(dt, elapsed, camera) {
    if (!this.enabled) return;
    FLAG_UNIFORMS.uFlagTime.value = elapsed;
    const cam = camera.position;
    const r2 = this.updateRadius * this.updateRadius;
    for (const s of this.swings) {
      s.object.getWorldPosition(_p);
      if (cam.distanceToSquared(_p) > r2) continue;
      s.object.rotation[s.axis] = s.base + Math.sin(elapsed * s.speed + s.phase) * s.amp + Math.sin(elapsed * s.speed * 2.3 + s.phase) * s.amp * 0.25;
    }
    if (this.fanMesh) {
      for (const f of this.fans) f.angle += f.speed * dt;
      this._writeFans(false, cam);
    }
  }
}
