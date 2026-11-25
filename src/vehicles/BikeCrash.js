import * as THREE from 'three';
import { clamp, smoothstep } from '../utils/math.js';

/**
 * Queda do piloto da moto numa batida forte (parede, prédio, carro ou objeto
 * pesado como poste, hidrante ou árvore pequena).
 *
 * O corpo é simulado como um ponto no quadril: sai com o embalo da moto e um
 * pulo para cima, rola no ar (giro para a frente), bate em paredes (ricocheteia
 * em vez de atravessar), cai, desliza e rola no chão até parar deitado. Depois
 * de um instante caído, o personagem se levanta e o controle a pé volta.
 *
 * A pose é aplicada pela pose externa do Player (rotação do corpo inteiro em
 * torno do quadril) e pela camada `crash` do PlayerAnimator (braços e pernas).
 */
/** Velocidade de batida (componente normal, m/s; ~29 km/h) que sempre derruba o piloto. */
export const CRASH_IMPACT = 8;
/** Em alta velocidade (≥ CRASH_SPEED, ~32 km/h) uma batida menos frontal já derruba; raspões não. */
export const CRASH_IMPACT_FAST = 6;
export const CRASH_SPEED = 9;

/** A batida derruba o piloto? hit: componente normal (m/s); speed: velocidade da moto antes dela. */
export function isBikeCrash(hit, speed) {
  return hit >= CRASH_IMPACT || (hit >= CRASH_IMPACT_FAST && speed >= CRASH_SPEED);
}
const G = 9.81;
const HIP = 0.95;        // altura do quadril em pé (raiz do personagem nos pés)
const LIE_HIP = 0.17;    // quadril deitado (metade da espessura do tronco)
const LIE_TIME = 1.2;
const GETUP_TIME = 1.25;
const _off = new THREE.Vector3();
const _root = new THREE.Vector3();

export class BikeCrash {
  /**
   * hip: posição do quadril do piloto no banco; velocity: velocidade da moto antes da batida;
   * normal: direção da batida (do obstáculo para a moto), ou null.
   */
  constructor(collision, { hip, velocity, normal = null, yaw, hipHeight = HIP, ignore = null }) {
    this.collision = collision;
    /** Colisor da própria moto: o corpo sai de cima dela sem ser empurrado de lado. */
    this.ignore = ignore;
    this.hipH = hipHeight;
    this.hip = hip.clone();
    const speed = Math.hypot(velocity.x, velocity.z);
    // O corpo mantém o embalo (o guidão o lança por cima) e sobe com a batida.
    this.vel = new THREE.Vector3(velocity.x * 0.8, clamp(2.2 + speed * 0.13, 2.5, 5.5), velocity.z * 0.8);
    if (normal) {
      // Contra uma parede, o embalo na direção dela vira ricochete curto.
      const vn = this.vel.x * normal.x + this.vel.z * normal.z;
      if (vn < 0) { this.vel.x -= normal.x * vn * 1.15; this.vel.z -= normal.z * vn * 1.15; }
    }
    this.yaw = speed > 0.5 ? Math.atan2(velocity.x, velocity.z) : yaw;
    this.pitch = 0;                      // giro para a frente (rad); deitado de bruços = π/2
    this.spin = clamp(speed * 0.55, 3.5, 11);
    this.roll = 0;
    this.phase = 'fly';
    this.t = 0;
    this.phaseT = 0;
    this.grounded = false;
    this.floor = hip.y - hipHeight;
    this.bounces = 0;
    this.lieFrom = 0;
    this.speed = speed;
    this.done = false;
    this._pos = { x: 0, z: 0 };
  }

  /** Pesos da camada de animação: voando, deitado, levantando. */
  get weights() {
    if (this.phase === 'fly') return { fly: this.grounded ? 0.35 : 1, lie: this.grounded ? 0.65 : 0, getup: 0 };
    if (this.phase === 'lie') return { fly: 0, lie: 1, getup: 0 };
    const k = clamp(this.phaseT / GETUP_TIME, 0, 1);
    const crouch = Math.sin(clamp(k * 1.25, 0, 1) * Math.PI);
    return { fly: 0, lie: Math.max(0, 1 - k * 2.2), getup: crouch, fade: 1 - smoothstep(0.75, 1, k) };
  }

  update(dt) {
    const h = Math.min(dt, 0.05);
    this.t += h;
    this.phaseT += h;
    if (this.phase === 'fly') this._fly(h);
    else if (this.phase === 'lie') {
      if (this.phaseT >= LIE_TIME) {
        // Os pés saem da posição deitada e vão para baixo do quadril enquanto o tronco se endireita.
        this.lieRoot = this.rootPosition(new THREE.Vector3());
        this.phase = 'getup'; this.phaseT = 0; this.lieFrom = this.pitch; this.getupK = 0;
      }
    } else if (this.phase === 'getup') {
      const k = smoothstep(0, 1, clamp(this.phaseT / (GETUP_TIME * 0.7), 0, 1));
      this.getupK = k;
      this.pitch = this.lieFrom * (1 - k);
      this.roll *= 1 - k;
      if (this.phaseT >= GETUP_TIME) { this.done = true; this.hip.y = this.floor + this.hipH; }
    }
    return this.done;
  }

  _fly(h) {
    const col = this.collision, v = this.vel, p = this.hip;
    const steps = Math.max(1, Math.ceil(h / (1 / 120)));
    const s = h / steps;
    for (let i = 0; i < steps; i++) {
      v.y -= G * s;
      p.addScaledVector(v, s);
      // Paredes: o corpo (raio ~0,3 m) não atravessa; perde o embalo contra elas.
      const pos = this._pos;
      pos.x = p.x; pos.z = p.z;
      const bodyLow = p.y - 0.35;
      // A moto (que segue deslizando) não é parede nem chão para o próprio piloto.
      const ig = this.ignore, wasSolid = ig?.solid, wasWalkable = ig?.walkable;
      if (ig) { ig.solid = false; ig.walkable = false; }
      const hit = col.resolveCircle(pos, bodyLow, 0.3, 0.7, 0.2);
      if (hit) {
        let nx = pos.x - p.x, nz = pos.z - p.z;
        const d = Math.hypot(nx, nz);
        if (d > 1e-6) {
          nx /= d; nz /= d;
          const vn = v.x * nx + v.z * nz;
          if (vn < 0) { v.x -= nx * vn * 1.25; v.z -= nz * vn * 1.25; v.x *= 0.6; v.z *= 0.6; this.spin *= 0.5; }
        }
        p.x = pos.x; p.z = pos.z;
      }
      // Chão sob o corpo: superfícies até um pouco acima das costas (meio-fio, teto de carro baixo).
      const g = col.getGroundHeight(p.x, p.z, p.y - LIE_HIP, 0.35);
      if (ig) { ig.solid = wasSolid; ig.walkable = wasWalkable; }
      this.floor = g;
      const rest = g + LIE_HIP;
      if (p.y <= rest) {
        p.y = rest;
        if (v.y < -2.5 && this.bounces < 2) { v.y = -v.y * 0.28; this.bounces++; this.spin *= 0.7; }
        else v.y = 0;
        this.grounded = true;
      } else if (p.y > rest + 0.05) this.grounded = false;
      if (this.grounded) {
        // Desliza e rola no asfalto até parar.
        const sp = Math.hypot(v.x, v.z);
        const k = sp > 0 ? Math.max(0, sp - 7 * s) / sp : 0;
        v.x *= k; v.z *= k;
        this.spin *= Math.exp(-5 * s);
      }
    }
    this.pitch += this.spin * h;
    this.roll = Math.sin(this.t * 7) * 0.25 * Math.min(1, this.spin / 6);
    if (this.grounded) {
      // Termina deitado: de bruços (π/2) ou de costas (−π/2), o mais próximo do giro atual.
      const lying = Math.round((this.pitch - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      this.pitch += (lying - this.pitch) * Math.min(1, h * (this.spin < 2 ? 8 : 2));
      if (Math.hypot(v.x, v.z) < 0.4 && this.spin < 1.5 && Math.abs(v.y) < 0.01) {
        this.pitch = Math.atan2(Math.sin(lying), Math.cos(lying)); // normaliza para (−π, π]
        this.roll = 0;
        this.phase = 'lie';
        this.phaseT = 0;
      }
    }
    if (this.t > 6 && this.phase === 'fly') { this.phase = 'lie'; this.phaseT = 0; this.pitch = Math.PI / 2; }
  }

  /** Raiz do personagem (pés) para o quadril atual girado por pitch/roll em torno dele. */
  rootPosition(out = _root) {
    if (this.phase === 'getup' && this.lieRoot) {
      // Levantando: pés no chão, deslizando até ficarem sob o quadril (o agachar vem da animação).
      const k = this.getupK, r = this.lieRoot;
      return out.set(r.x + (this.hip.x - r.x) * k, r.y + (this.floor - r.y) * k, r.z + (this.hip.z - r.z) * k);
    }
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // Vetor quadril→pés no referencial do corpo girado: −(0, HIP, 0) rodado por pitch (eixo X local).
    _off.set(0, this.hipH * cp, this.hipH * sp);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    out.set(this.hip.x - _off.z * sy, this.hip.y - _off.y, this.hip.z - _off.z * cy);
    return out;
  }

  /** Ponto no chão para devolver o controle a pé (sob o quadril). */
  standPoint(out = new THREE.Vector3()) {
    return out.set(this.hip.x, this.floor, this.hip.z);
  }
}
