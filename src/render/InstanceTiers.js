import * as THREE from 'three';

/**
 * LOD por distância para objetos instanciados (palmeiras, vegetação).
 * Cada faixa ("tier") é uma InstancedMesh própria com geometria/sombra
 * diferentes; a cada deslocamento relevante da câmera as instâncias são
 * redistribuídas entre as faixas e a esfera envolvente de cada faixa é
 * recalculada — assim o recorte por frustum (câmera e luz de sombra) passa
 * a funcionar, o que não acontece com uma única InstancedMesh do bairro todo.
 *
 * tiers: [{ geometry, material, castShadow, maxDist, customDepthMaterial? }]
 * items: [{ matrix: Matrix4, pos: Vector3, color?: Color, attrs?: { nome: valor } }]
 */
const _c = new THREE.Color();

export class InstanceTiers {
  constructor(parent, tiers, items, { attrNames = [], name = 'instances', receiveShadow = true } = {}) {
    this.items = items;
    this.active = items.length;
    this.attrNames = attrNames;
    this.tiers = tiers.map((t, i) => {
      const geo = t.geometry.clone();
      const attrs = {};
      for (const a of attrNames) {
        attrs[a] = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, items.length)), 1);
        geo.setAttribute(a, attrs[a]);
      }
      const mesh = new THREE.InstancedMesh(geo, t.material, Math.max(1, items.length));
      mesh.count = 0;
      mesh.castShadow = !!t.castShadow;
      mesh.receiveShadow = receiveShadow;
      if (t.customDepthMaterial) mesh.customDepthMaterial = t.customDepthMaterial;
      mesh.name = `${name}:tier${i}`;
      if (items.some((it) => it.color)) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, items.length) * 3), 3);
      parent.add(mesh);
      return { ...t, mesh, attrs };
    });
    this._last = new THREE.Vector3(1e9, 0, 1e9);
    this._timer = 0;
    this.meshes = this.tiers.map((t) => t.mesh);
  }

  /** Considera apenas as primeiras `n` instâncias (densidade do perfil gráfico). */
  setActive(n) {
    this.active = Math.max(0, Math.min(this.items.length, n));
    this._last.set(1e9, 0, 1e9);
  }

  /** Redistribui as instâncias se a câmera andou mais de 4 m (ou forçado). */
  update(camPos, force = false) {
    if (!force && camPos.distanceToSquared(this._last) < 16) return false;
    this._last.copy(camPos);
    const counts = this.tiers.map(() => 0);
    const last = this.tiers.length - 1;
    for (let i = 0; i < this.active; i++) {
      const it = this.items[i];
      const d = camPos.distanceTo(it.pos);
      let ti = last;
      for (let k = 0; k < last; k++) if (d < this.tiers[k].maxDist) { ti = k; break; }
      const t = this.tiers[ti];
      const j = counts[ti]++;
      t.mesh.setMatrixAt(j, it.matrix);
      if (t.mesh.instanceColor && it.color) t.mesh.setColorAt(j, it.color);
      for (const a of this.attrNames) t.attrs[a].array[j] = it.attrs?.[a] ?? 0;
    }
    for (let k = 0; k < this.tiers.length; k++) {
      const m = this.tiers[k].mesh;
      m.count = counts[k];
      m.visible = counts[k] > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      for (const a of this.attrNames) this.tiers[k].attrs[a].needsUpdate = true;
      if (counts[k] > 0) m.computeBoundingSphere();
    }
    return true;
  }

  setTierDistance(k, d) {
    if (this.tiers[k]) this.tiers[k].maxDist = d;
    this._last.set(1e9, 0, 1e9);
  }

  dispose() {
    for (const t of this.tiers) {
      t.mesh.removeFromParent();
      t.mesh.geometry.dispose();
    }
  }
}

void _c;
