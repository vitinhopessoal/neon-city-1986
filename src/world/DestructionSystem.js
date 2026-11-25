import * as THREE from 'three';

// Arcade durability: gameplay values, independent of real material strengths.
export const BREAKABLE_PROFILES = {
  lamp: { hp: 85, speed: 5, material: 'metal' },
  bench: { hp: 40, speed: 3, material: 'wood' },
  hydrant: { hp: 65, speed: 4, material: 'metal', water: true },
  bin: { hp: 30, speed: 2.5, material: 'metal' },
  parkingMeter: { hp: 30, speed: 2.5, material: 'metal' },
  lounger: { hp: 22, speed: 2, material: 'wood' },
  umbrellaPink: { hp: 20, speed: 2, material: 'wood' },
  umbrellaTeal: { hp: 20, speed: 2, material: 'wood' },
  umbrellaSun: { hp: 20, speed: 2, material: 'wood' },
  planter: { hp: 55, speed: 4, material: 'concrete' },
  bush: { hp: 15, speed: 2, material: 'wood' },
  newsBox: { hp: 35, speed: 3, material: 'metal' },
  bollard: { hp: 60, speed: 4.5, material: 'metal' },
  stall: { hp: 45, speed: 3, material: 'wood' },
  streetSign: { hp: 30, speed: 3, material: 'metal' },
  trafficSign: { hp: 30, speed: 3, material: 'metal' },
  signal: { hp: 100, speed: 6, material: 'metal' },
  phoneBooth: { hp: 65, speed: 4, material: 'glass' },
  // Vice City (objetos do mapa convertido). mass: kg para a perda de velocidade do
  // veículo; fling: fração do empurrão nos destroços (postes tombam, caixas voam);
  // rider: pesado o bastante para derrubar o piloto de uma moto em alta velocidade.
  streetLamp: { hp: 85, speed: 5, material: 'metal', mass: 180, fling: 0.4, rider: true },
  pole: { hp: 95, speed: 6, material: 'wood', mass: 260, fling: 0.3, rider: true },
  viceBollard: { hp: 60, speed: 4.5, material: 'metal', mass: 70, fling: 0.7, rider: true },
  viceBench: { hp: 40, speed: 3, material: 'wood', mass: 70, fling: 0.7, rider: true },
  viceHydrant: { hp: 65, speed: 4, material: 'metal', water: true, mass: 120, fling: 0.6, rider: true },
  viceBin: { hp: 30, speed: 2.5, material: 'metal', mass: 25, fling: 1 },
  viceMeter: { hp: 30, speed: 2.5, material: 'metal', mass: 25, fling: 0.8 },
  viceNews: { hp: 35, speed: 3, material: 'metal', mass: 35, fling: 0.9 },
  mailbox: { hp: 50, speed: 4, material: 'metal', mass: 80, fling: 0.6, rider: true },
  vicePhone: { hp: 65, speed: 4, material: 'glass', mass: 150, fling: 0.5, rider: true },
  viceSign: { hp: 30, speed: 3, material: 'metal', mass: 30, fling: 0.7 },
  box: { hp: 10, speed: 1.2, material: 'wood', mass: 8, fling: 1.1 },
  barrel: { hp: 30, speed: 2.5, material: 'metal', mass: 40, fling: 0.9 },
  barrier: { hp: 15, speed: 1.5, material: 'wood', mass: 15, fling: 1 },
  dumpster: { hp: 120, speed: 7, material: 'metal', mass: 400, fling: 0.25, rider: true },
  table: { hp: 30, speed: 2.5, material: 'wood', mass: 30, fling: 0.9 },
  viceLounger: { hp: 22, speed: 2, material: 'wood', mass: 15, fling: 1 },
  pot: { hp: 45, speed: 3.5, material: 'concrete', mass: 90, fling: 0.6, rider: true },
  smallTree: { hp: 70, speed: 4.5, material: 'wood', mass: 150, fling: 0.45, rider: true },
};

const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3(), _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion(), _stepQ = new THREE.Quaternion();

/** Retain original construction pieces as centered fragments for later animation. */
export function fracturePart(geometry, material) {
  const g = geometry.clone();
  g.computeBoundingBox();
  const center = g.boundingBox.getCenter(new THREE.Vector3());
  const half = g.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  g.translate(-center.x, -center.y, -center.z);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return { geometry: g, material, center, half };
}

export class DestructionSystem {
  constructor(parent, collision, { maxFragments = 180, maxJets = 6, lifetime = 14, random = Math.random, respawn = null } = {}) {
    this.parent = parent;
    this.collision = collision;
    this.root = new THREE.Group();
    this.root.name = 'street-destruction';
    parent.add(this.root);
    this.records = new Map();
    this.fragments = [];
    this.jets = [];
    this.shaking = new Set();
    this.ownedGeometries = new Set();
    this.maxFragments = Math.max(1, maxFragments);
    this.maxJets = Math.max(1, maxJets);
    this.lifetime = lifetime;
    this.random = random;
    this.time = 0;
    this.brokenCount = 0;
    this.onBreak = null;
    /** { delay (s), distance (m) }: objeto quebrado volta quando ninguém está olhando (mundo aberto). */
    this.respawn = respawn;
    this.broken = new Set();
    this._respawnTimer = 0;
    this.waterMaterial = new THREE.PointsMaterial({ color: 0x9ce9ff, size: 0.095, transparent: true, opacity: 0.8, depthWrite: false });
  }

  register({ id, type, matrix, colliders = [], bindings = [], fragments = [], object = null, onBreak = null }) {
    const profile = BREAKABLE_PROFILES[type];
    if (!profile) return null; // Buildings, trees and map boundaries never opt in.
    if (this.records.has(id)) throw new Error(`Duplicate destructible: ${id}`);
    const record = { id, type, profile, hp: profile.hp, broken: false, matrix: matrix.clone(), colliders, bindings, fragments, object, onBreak, shake: 0 };
    matrix.decompose(_pos, _quat, _scale);
    record.position = _pos.clone();
    this.records.set(id, record);
    for (const collider of colliders) {
      collider.destructible = record;
      // Estado original, para restore() quando o objeto volta ao mapa.
      collider.restoreSolid ??= collider.solid;
      collider.restoreWalkable ??= collider.walkable;
    }
    return record;
  }

  registerObject(id, type, object, colliders, onBreak = null) {
    if (!BREAKABLE_PROFILES[type]) return null;
    object.updateWorldMatrix(true, true);
    const inverse = object.matrixWorld.clone().invert();
    const pieces = [];
    object.traverse(child => {
      if (!child.isMesh || child.isInstancedMesh) return;
      const geometry = child.geometry.clone().applyMatrix4(_mat.multiplyMatrices(inverse, child.matrixWorld));
      const part = fracturePart(geometry, child.material);
      geometry.dispose();
      this.ownedGeometries.add(part.geometry);
      pieces.push(part);
    });
    const worldBounds = new THREE.Box3().setFromObject(object);
    const hitbox = this.createHitbox(id, worldBounds, new THREE.Matrix4());
    return this.register({ id, type, object, colliders: [...colliders, hitbox], matrix: object.matrixWorld, fragments: pieces, onBreak });
  }

  createHitbox(id, bounds, matrix) {
    const box = bounds.clone().applyMatrix4(matrix);
    const collider = this.collision.addAABB({ id: `${id}_damage`, ownerId: id, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z,
      minY: box.min.y, maxY: box.max.y, solid: false, walkable: false, cameraBlocker: false });
    collider.raycastOnly = true;
    return collider;
  }

  addBinding(id, mesh, index) {
    const record = this.records.get(id);
    if (record) {
      record.bindings.push({ mesh, index, secondary: true });
      if (record.broken) this._hideBinding({ mesh, index });
    }
  }

  damageCollider(collider, { damage, direction = UP, point = null, force = 2 } = {}) {
    const record = collider?.destructible;
    if (!record || this.records.get(record.id) !== record || record.broken || !Number.isFinite(damage) || damage <= 0) return false;
    record.hp = Math.max(0, record.hp - damage);
    if (record.hp <= 0) this._break(record, direction, force, point);
    else {
      record.shake = 0.22;
      this.shaking.add(record);
    }
    return true;
  }

  /** Called BEFORE the OBB solver pushes the vehicle out of a prop. */
  vehicleContact(contact, physics) {
    const record = contact.collider.destructible;
    if (!record || this.records.get(record.id) !== record) return true;
    if (record.broken) return false;
    const rx = contact.px - physics.x, rz = contact.pz - physics.z;
    const vx = physics.vx + physics.yawRate * rz;
    const vz = physics.vz - physics.yawRate * rx;
    const closing = -(vx * contact.nx + vz * contact.nz);
    const profile = record.profile;
    // Colisor só para veículos (objeto sem COL própria): nunca vira parede.
    if (contact.collider.vehicleOnly) {
      if (closing < 0.5) return false;
    } else if (closing < profile.speed) return true;
    record.breakSource = physics.v?.driver === 'player' ? 'player' : 'vehicle';
    this.damageCollider(contact.collider, {
      damage: record.hp, direction: { x: vx, y: 0.25, z: vz }, force: Math.min(10, closing * 0.6),
    });
    // Perda de momento em vez do impulso de uma parede: proporcional à massa do
    // objeto (caixa quase nada; um poste freia uma moto bem mais que um carro).
    const mass = physics.H?.mass;
    const keep = profile.mass && mass ? Math.max(0.55, mass / (mass + profile.mass * 0.5)) : 0.94;
    physics.vx *= keep; physics.vz *= keep;
    if (profile.rider) physics.propHit = Math.max(physics.propHit || 0, closing);
    return false;
  }

  _hideBinding(binding) {
    binding.mesh.setMatrixAt(binding.index, HIDDEN);
    binding.mesh.instanceMatrix.needsUpdate = true;
  }

  _break(record, direction, force) {
    record.broken = true;
    record.hp = 0;
    record.shake = 0;
    this.shaking.delete(record);
    this.brokenCount++;
    record.brokenAt = this.time;
    this.broken.add(record);
    for (const collider of record.colliders) {
      collider.solid = false;
      collider.walkable = false;
      this.collision.remove(collider.id);
    }
    for (const binding of record.bindings) this._hideBinding(binding);
    if (record.object) record.object.visible = false;
    const dir = new THREE.Vector3(direction.x || 0, 0, direction.z || 0);
    if (dir.lengthSq() < 0.01) dir.set(0.8, 0, 0.6);
    dir.normalize();
    const fling = record.profile.fling ?? 1;
    force *= fling;
    record.matrix.decompose(_pos, _quat, _scale);
    // Geometry is shared with fragment templates; only the active meshes exist.
    for (const part of record.fragments.slice(0, 32)) {
      while (this.fragments.length >= this.maxFragments) this._removeFragment(0);
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.position.copy(part.center).applyMatrix4(record.matrix);
      mesh.quaternion.copy(_quat);
      mesh.scale.copy(_scale);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = `debris:${record.id}`;
      this.root.add(mesh);
      const rnd = () => this.random() - 0.5;
      // Objetos pesados (fling < 1: postes, árvores) tombam para o lado da batida em vez de voar.
      const loose = Math.min(1, fling);
      const velocity = new THREE.Vector3(dir.x * force + rnd() * 2.6 * loose, (1.4 + this.random() * 2.3) * loose, dir.z * force + rnd() * 2.6 * loose);
      const spin = new THREE.Vector3(dir.z * 2 + rnd() * 2.5 * loose, rnd() * 2 * loose, -dir.x * 2 + rnd() * 2.5 * loose);
      this.fragments.push({ mesh, velocity, spin, half: part.half.clone().multiply(_scale), baseScale: _scale.clone(), age: 0, resting: false });
    }
    if (record.profile.water) this._waterJet(record.position);
    if (record.type === 'planter') {
      // Planted shrubs are separate render instances; do not leave them floating.
      for (const child of this.records.values()) {
        if (child.type !== 'bush' || child.broken || child.position.y < record.position.y + 0.3) continue;
        if (Math.hypot(child.position.x - record.position.x, child.position.z - record.position.z) < 0.8) this._break(child, direction, force);
      }
    }
    record.onBreak?.(record);
    this.onBreak?.(record);
  }

  _waterJet(position) {
    if (this.jets.length >= this.maxJets) this._removeJet(0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96 * 3), 3));
    const mesh = new THREE.Points(geo, this.waterMaterial);
    mesh.position.copy(position).addScaledVector(UP, 0.1);
    mesh.frustumCulled = false;
    mesh.name = 'broken-hydrant-water';
    this.root.add(mesh);
    this.jets.push({ mesh, age: 0 });
  }

  /** Reconstrói um objeto quebrado (colisões, instâncias visíveis, durabilidade). */
  restore(record) {
    if (!record.broken || this.records.get(record.id) !== record) return false;
    record.broken = false;
    record.hp = record.profile.hp;
    this.broken.delete(record);
    for (const collider of record.colliders) {
      collider.solid = collider.restoreSolid ?? true;
      collider.walkable = collider.restoreWalkable ?? false;
      this.collision._insert(collider);
    }
    for (const binding of record.bindings) {
      binding.mesh.setMatrixAt(binding.index, record.matrix);
      binding.mesh.instanceMatrix.needsUpdate = true;
    }
    if (record.object) record.object.visible = true;
    return true;
  }

  _respawnBroken(delta, focus) {
    if (!this.respawn || !focus || !this.broken.size) return;
    this._respawnTimer -= delta;
    if (this._respawnTimer > 0) return;
    this._respawnTimer = 1;
    const { delay = 90, distance = 150 } = this.respawn;
    for (const record of this.broken) {
      if (this.time - record.brokenAt < delay) continue;
      const p = record.position;
      if ((p.x - focus.x) ** 2 + (p.z - focus.z) ** 2 < distance * distance) continue;
      this.restore(record);
    }
  }

  update(dt, focus = null) {
    if (!this.parent.visible) return; // Pause effects while a different map is active.
    const delta = Math.min(0.1, Math.max(0, dt));
    this.time += delta;
    this._respawnBroken(delta, focus);
    for (const record of this.shaking) {
      record.shake = Math.max(0, record.shake - delta);
      const k = Math.sin(record.shake * 90) * record.shake * 0.08;
      record.matrix.decompose(_pos, _quat, _scale);
      _stepQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), k);
      _quat.multiply(_stepQ);
      _mat.compose(_pos, _quat, _scale);
      for (const b of record.bindings) if (!b.secondary) {
        b.mesh.setMatrixAt(b.index, _mat); b.mesh.instanceMatrix.needsUpdate = true;
      }
      if (record.object) {
        // Street props are direct children of the untransformed world prop group.
        record.object.quaternion.copy(_quat);
      }
      if (record.shake === 0) this.shaking.delete(record);
    }
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i];
      f.age += delta;
      if (f.age >= this.lifetime) { this._removeFragment(i); continue; }
      if (!f.resting) {
        const steps = Math.max(1, Math.ceil(delta * 60)), h = delta / steps;
        for (let j = 0; j < steps; j++) {
          f.velocity.y -= 12 * h;
          f.mesh.position.addScaledVector(f.velocity, h);
          _stepQ.setFromEuler(new THREE.Euler(f.spin.x * h, f.spin.y * h, f.spin.z * h));
          f.mesh.quaternion.multiply(_stepQ);
          f.mesh.updateMatrix();
          const e = f.mesh.matrix.elements;
          // Exact vertical extent of the rotated local bounding box, not a sphere.
          const extent = Math.abs(e[1]) * f.half.x / f.baseScale.x + Math.abs(e[5]) * f.half.y / f.baseScale.y + Math.abs(e[9]) * f.half.z / f.baseScale.z;
          // Chão sob o destroço (o Vice City fica a ~6-20 m de altura, não em y = 0).
          const floor = this.collision.getGroundHeight(f.mesh.position.x, f.mesh.position.z, f.mesh.position.y, 0.25);
          if (f.mesh.position.y < floor + extent) {
            f.mesh.position.y = floor + extent;
            f.velocity.y = Math.abs(f.velocity.y) * 0.22;
            f.velocity.x *= 0.65; f.velocity.z *= 0.65;
            f.spin.multiplyScalar(0.65);
            if (f.velocity.lengthSq() < 0.08 && f.spin.lengthSq() < 0.06) f.resting = true;
          }
        }
      }
      // Retire debris gradually without changing any shared world material.
      const shrink = Math.min(1, Math.max(0.001, (this.lifetime - f.age) / 2));
      f.mesh.scale.copy(f.baseScale).multiplyScalar(shrink);
    }
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const jet = this.jets[i];
      jet.age += delta;
      if (jet.age >= 10) { this._removeJet(i); continue; }
      const attr = jet.mesh.geometry.attributes.position;
      const pressure = Math.min(1, (10 - jet.age) / 2);
      for (let p = 0; p < attr.count; p++) {
        const age = (jet.age + p * 0.017) % 1.25;
        const a = p * 2.39996;
        const spread = 0.4 + (p % 7) * 0.12;
        attr.setXYZ(p, Math.cos(a) * age * spread, Math.max(0, (7.5 * pressure + p % 5 * 0.2) * age - 5 * age * age), Math.sin(a) * age * spread);
      }
      attr.needsUpdate = true;
    }
  }

  _removeFragment(index) {
    this.fragments[index].mesh.removeFromParent();
    this.fragments.splice(index, 1);
  }

  _removeJet(index) {
    const jet = this.jets[index];
    jet.mesh.removeFromParent(); jet.mesh.geometry.dispose();
    this.jets.splice(index, 1);
  }

  dispose() {
    while (this.fragments.length) this._removeFragment(0);
    while (this.jets.length) this._removeJet(0);
    for (const record of this.records.values()) for (const c of record.colliders) delete c.destructible;
    this.records.clear(); this.shaking.clear(); this.broken.clear();
    for (const g of this.ownedGeometries) g.dispose();
    this.ownedGeometries.clear();
    this.waterMaterial.dispose(); this.root.removeFromParent();
  }
}
