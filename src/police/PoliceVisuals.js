import * as THREE from 'three';
import { PedestrianRenderer, randomLook } from '../pedestrians/PedestrianRenderer.js';
import { UNIFORMS, VEHICLE_REFERENCE } from './PoliceRules.js';

const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler();
const position = new THREE.Vector3(), scale = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
export const officerPose = () => ({ thighL: 0, thighR: 0, kneeL: 0, kneeR: 0, armL: 0, armR: 0, elbowL: 0, elbowR: 0, armOut: 0, bob: 0, twist: 0, headYaw: 0, headPitch: 0, lean: 0, sit: 0, lie: 0, footPitch: 0 });

export function officerLook(tier, serial) {
  const uniform = UNIFORMS[tier], look = randomLook();
  return { ...look, style: 'police', height: 1, width: 1, chest: 1, hairVol: 0.9,
    longHair: false, female: false, glasses: tier === 'federal' || tier === 'vice',
    top: uniform.top, sleeve: uniform.top, forearm: tier === 'patrol' ? look.skin : uniform.top,
    pants: uniform.pants, thigh: uniform.pants, shin: uniform.pants, shoes: 0x141619,
    skirt: undefined, hair: serial % 3 ? 0x302218 : 0x111111 };
}

/** Uniformed walking/seated officers share one body renderer and six accessory
 * instance batches. Population is capped; no new mesh is allocated per shot. */
export class PoliceOfficers {
  constructor(scene, capacity = 16) {
    this.body = new PedestrianRenderer(scene, capacity);
    this.body.group.name = 'police-officers';
    this.capacity = capacity;
    this.accessories = new THREE.Group(); this.accessories.name = 'police-equipment'; scene.add(this.accessories);
    this.meshes = {};
    const create = (name, geometry, color) => {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.65 });
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
      for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, zero);
      this.accessories.add(mesh); this.meshes[name] = mesh;
    };
    create('cap', new THREE.CylinderGeometry(0.13, 0.13, 0.1, 10), 0xffffff);
    create('brim', new THREE.BoxGeometry(0.19, 0.025, 0.17), 0x1e2927);
    create('badge', new THREE.SphereGeometry(0.035, 6, 4).scale(1, 1.2, 0.2), 0xe4c777);
    create('gun', new THREE.BoxGeometry(0.07, 0.08, 0.3), 0x222832);
    create('grip', new THREE.BoxGeometry(0.06, 0.13, 0.08), 0x181a20);
    create('flash', new THREE.SphereGeometry(0.12, 5, 3), 0xffd875);
    this.meshes.flash.material.emissive.setHex(0xffb52d);
    this.meshes.flash.material.emissiveIntensity = 3;
  }

  applyLook(officer) {
    this.body.applyLook(officer.slot, officer.look);
    this.meshes.cap.setColorAt(officer.slot, new THREE.Color(UNIFORMS[officer.tier].cap ?? 0x333333));
    this.meshes.cap.instanceColor.needsUpdate = true;
  }

  hide(slot) {
    this.body.hide(slot);
    for (const mesh of Object.values(this.meshes)) { mesh.setMatrixAt(slot, zero); mesh.instanceMatrix.needsUpdate = true; }
  }

  write(officer) {
    const { slot, pose, tier } = officer, uniform = UNIFORMS[tier];
    this.body.write(slot, officer, pose);
    const baseY = officer.y + pose.bob - pose.sit * 0.47;
    const put = (name, x, y, z, sx = 1, sy = 1, sz = 1, visible = true) => {
      const mesh = this.meshes[name];
      if (visible) {
        const sin = Math.sin(officer.yaw), cos = Math.cos(officer.yaw);
        position.set(officer.x + x * cos + z * sin, baseY + y, officer.z - x * sin + z * cos);
        quaternion.setFromEuler(euler.set(0, officer.yaw, 0)); scale.set(sx, sy, sz);
        mesh.setMatrixAt(slot, matrix.compose(position, quaternion, scale));
      } else mesh.setMatrixAt(slot, zero);
      mesh.instanceMatrix.needsUpdate = true;
    };
    const alive = officer.health > 0, aiming = officer.aiming && alive;
    put('cap', 0, 1.85, 0, 1, tier === 'swat' || tier === 'army' ? 1.7 : 1, 1, alive && uniform.cap !== null);
    put('brim', 0, 1.82, 0.12, 1, 1, 1, alive && uniform.cap !== null);
    put('badge', -0.085, 1.43, 0.15, 1, 1, 1, alive && pose.sit < 0.5);
    put('gun', 0.13, aiming ? 1.4 : 0.88, aiming ? 0.52 : 0.13, 1, 1, tier === 'patrol' || tier === 'vice' ? 1 : 1.8, alive && pose.sit < 0.5);
    put('grip', 0.13, aiming ? 1.32 : 0.82, aiming ? 0.43 : 0.11, 1, 1, 1, alive && pose.sit < 0.5);
    put('flash', 0.13, 1.4, 0.72, 1, 0.5, 1.6, officer.flash > 0);
  }

  dispose() {
    this.body.dispose(); this.accessories.removeFromParent();
    for (const mesh of Object.values(this.meshes)) { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); }
  }
}

export function createPoliceVehicle(game, tier, serial) {
  const uniform = UNIFORMS[tier], ref = VEHICLE_REFERENCE[tier];
  const type = tier === 'vice' ? 'sports' : 'sedan';
  const v = game.world.vehicleFactory.create(type, {
    id: `police_${serial}`, color: tier === 'patrol' ? 0xf3f3e6 : tier === 'vice' ? 0x4eaeb0 : tier === 'army' ? 0x4a5634 : 0x171f2c,
    stripe: tier === 'patrol' ? 0x22796e : null, plate: `VC ${String(serial).padStart(4, '0')}`,
  });
  v.police = true; v.spec.model = uniform.label; v.spec.category = 'Viatura';
  const handling = v.spec.handling;
  // Preserve the reference mass ratios without transplanting incompatible forces.
  const massRatio = Math.min(1.8, ref.mass / handling.mass);
  handling.mass *= massRatio; handling.engineForce *= massRatio * 1.3; handling.brakeForce *= massRatio * 1.25;
  handling.maxSpeed = Math.min(55, ref.maxKmh / 3.6);
  handling.steerSpeed *= 1.25;
  const kit = new THREE.Group(); kit.name = 'police-kit'; v.body.add(kit);
  v.policeKit = kit;
  const box = (w, h, d, x, y, z, color, emissive = false) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: emissive ? color : 0x000000 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); kit.add(mesh); return mesh;
  };
  const roof = v.spec.height + 0.09;
  box(1.3, 0.08, 0.3, 0, roof, -0.15, 0x181e25);
  v.policeRed = box(0.48, 0.16, 0.28, 0.37, roof + 0.11, -0.15, 0xfc2840, true);
  v.policeBlue = box(0.48, 0.16, 0.28, -0.37, roof + 0.11, -0.15, 0x308bff, true);
  if (tier === 'swat' || tier === 'army') {
    // Armored utility body on the same tested wheel/chassis/door rig.
    box(1.72, 0.52, 1.65, 0, 1.5, -0.7, uniform.pants);
    box(1.35, 0.18, 0.1, 0, 1.65, 0.17, 0x263849);
  }
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 256, 96);
  ctx.fillStyle = tier === 'patrol' ? '#174e46' : '#f4edca'; ctx.font = `900 ${Math.min(48, Math.floor(236 / Math.max(1, uniform.label.length * 0.62)))}px Arial`;
  ctx.textAlign = 'center'; ctx.fillText(uniform.label, 128, 62);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  v.policeTexture = texture;
  for (const side of [-1, 1]) {
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.52), material);
    label.rotation.y = side * Math.PI / 2; label.position.set(side * (v.spec.width / 2 + 0.025), 0.77, -0.1); kit.add(label);
  }
  v.npcSeats = new Set();
  return v;
}

export function disposePoliceVehicle(v, factory) {
  // The factory already knows which chassis/glass/wheel resources are shared.
  factory.dispose(v);
}

export function createHelicopter(scene) {
  const root = new THREE.Group(); root.name = 'police-helicopter';
  const body = new THREE.MeshStandardMaterial({ color: 0xe2e5dc, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x18352e, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x396f91, metalness: 0.35, roughness: 0.2 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); root.add(m); return m; };
  add(new THREE.SphereGeometry(1, 12, 8).scale(1.2, 1.1, 2.1), body, 0, 0, 0);
  add(new THREE.SphereGeometry(1, 10, 6).scale(1.06, 0.75, 1.1), glass, 0, 0.15, 1.2);
  add(new THREE.BoxGeometry(0.35, 0.35, 4.1), dark, 0, 0.2, -3.3);
  add(new THREE.BoxGeometry(0.12, 1.4, 0.95), dark, 0, 0.75, -5);
  const rotor = add(new THREE.BoxGeometry(9.4, 0.04, 0.22), dark, 0, 1.3, 0);
  const rotor2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 9.4), dark); rotor.add(rotor2);
  const tail = add(new THREE.BoxGeometry(0.06, 1.6, 0.13), dark, 0.28, 0.75, -5);
  for (const x of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.055, 0.055, 3.8, 6).rotateX(Math.PI / 2), dark, x, -1.35, 0);
    add(new THREE.BoxGeometry(0.08, 0.6, 0.08), dark, x, -1.0, -0.5);
  }
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xf8f2c8, transparent: true, opacity: 0.055, side: THREE.DoubleSide, depthWrite: false });
  const beam = add(new THREE.ConeGeometry(9, 32, 18, 1, true).translate(0, -16, 0), beamMat, 0, -0.8, 0.7);
  scene.add(root);
  return { root, rotor, tail, beam, health: 320, phase: 0, fire: 2 };
}

export class PoliceAudio {
  constructor(audio) { this.audio = audio; }
  update(dt, distance, active) {
    const { ctx, master } = this.audio;
    if (!ctx || !master) return;
    if (!this.osc && active) {
      this.gain = ctx.createGain(); this.gain.gain.value = 0; this.gain.connect(master);
      this.osc = ctx.createOscillator(); this.osc.type = 'triangle'; this.osc.frequency.value = 650; this.osc.connect(this.gain); this.osc.start();
      // Varredura da sirene por LFO nativo (antes: frequência reagendada a cada quadro).
      this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 5 / (2 * Math.PI);
      this.lfoGain = ctx.createGain(); this.lfoGain.gain.value = 240; this.lfo.connect(this.lfoGain).connect(this.osc.frequency); this.lfo.start();
    }
    this.time = (this.time || 0) + dt;
    if (this.osc) {
      const g = active ? Math.max(0, 1 - distance / 130) * 0.075 : 0;
      if (Math.abs(g - (this._g ?? -1)) > 0.003) { this._g = g; this.gain.gain.cancelScheduledValues(ctx.currentTime); this.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.1); }
    }
  }
  /** Rotor do helicóptero: pulso grave sintetizado, atenuado pela distância (0 sem helicóptero). */
  rotor(dt, distance) {
    const { ctx, master } = this.audio;
    if (!ctx || !master) return;
    const active = Number.isFinite(distance) && distance < 160;
    if (!this.rOsc && active) {
      this.rGain = ctx.createGain(); this.rGain.gain.value = 0; this.rGain.connect(master);
      this.rOsc = ctx.createOscillator(); this.rOsc.type = 'sawtooth'; this.rOsc.frequency.value = 46;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      this.rLfo = ctx.createOscillator(); this.rLfo.frequency.value = 11; const lg = ctx.createGain(); lg.gain.value = 0.5;
      this.rAmp = ctx.createGain(); this.rAmp.gain.value = 0.5; this.rLfo.connect(lg).connect(this.rAmp.gain);
      this.rOsc.connect(lp).connect(this.rAmp).connect(this.rGain); this.rOsc.start(); this.rLfo.start();
    }
    if (!this.rOsc) return;
    const g = active ? Math.max(0, 1 - distance / 160) * 0.09 : 0;
    if (Math.abs(g - (this._rg ?? -1)) > 0.004) { this._rg = g; this.rGain.gain.cancelScheduledValues(ctx.currentTime); this.rGain.gain.setTargetAtTime(g, ctx.currentTime, 0.2); }
  }
  dispose() { this.osc?.stop(); this.osc?.disconnect(); this.gain?.disconnect(); this.rOsc?.stop(); this.rLfo?.stop(); this.rGain?.disconnect(); this.lfo?.stop(); }
}
