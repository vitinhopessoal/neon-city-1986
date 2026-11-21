import * as THREE from 'three';
import { clamp } from '../utils/math.js';

/**
 * Integridade do veículo (100% → 0%) a partir da velocidade normal de impacto.
 *  - abaixo de ~11 km/h: sem dano (encostar devagar não estraga o carro)
 *  - leve / moderado / forte crescem de forma não linear
 * Efeitos visuais: pintura fosca e mais escura (riscos/sujeira), para-choque
 * que cede no lado atingido, farol apagado após batida frontal forte e
 * fumaça leve em estado crítico (via VehicleEffects). Abaixo de 50% o
 * desempenho cai moderadamente (motor e velocidade máxima).
 * Destruição total não faz parte desta etapa.
 */
const SAFE_IMPACT = 3.0;   // m/s (~11 km/h)

export class VehicleDamage {
  constructor(vehicle) {
    this.v = vehicle;
    this.integrity = 100;
    this.lastImpact = 0;
    this.cooldown = 0;
    this.frontHits = 0;
    this.rearHits = 0;
    const paint = vehicle.mats.paint;
    this._baseColor = paint ? paint.color.clone() : new THREE.Color(1, 1, 1);
    this._baseRough = paint ? paint.roughness : 0.3;
    this._baseClear = paint ? paint.clearcoat : 1;
  }

  /** Fator de desempenho (1 = intacto; mínimo 0,6). */
  get performance() {
    return this.integrity >= 50 ? 1 : 0.6 + 0.4 * (this.integrity / 50);
  }

  get critical() {
    return this.integrity < 30;
  }

  /** Classifica a intensidade (para áudio/câmera). */
  static severity(impact) {
    if (impact < SAFE_IMPACT) return 'none';
    if (impact < 7) return 'light';
    if (impact < 14) return 'moderate';
    return 'heavy';
  }

  /**
   * Aplica dano por impacto. impact = velocidade normal (m/s); localNz > 0 = frente.
   * Retorna o dano aplicado (pontos de integridade).
   */
  applyImpact(impact, localNz = 0) {
    if (impact < SAFE_IMPACT || this.cooldown > 0) return 0;
    const massK = this.v.spec.handling.mass / 1400;
    // resistance: melhoria de resistência (NEON CUSTOMS) — nunca torna o carro indestrutível (mín. 0,7).
    const dmg = clamp(Math.pow(impact - SAFE_IMPACT, 1.35) * 1.1 * massK, 0, 45) * Math.max(0.7, this.resistance ?? 1);
    this.integrity = Math.max(0, this.integrity - dmg);
    this.lastImpact = impact;
    this.cooldown = 0.25; // evita contar o mesmo contato várias vezes
    if (localNz > 0.5) this.frontHits += dmg; else if (localNz < -0.5) this.rearHits += dmg;
    this._applyVisuals();
    return dmg;
  }

  repair() {
    this.integrity = 100;
    this.frontHits = this.rearHits = 0;
    this._applyVisuals();
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
  }

  _applyVisuals() {
    const k = 1 - this.integrity / 100;
    const paint = this.v.mats.paint;
    if (paint) {
      paint.color.copy(this._baseColor).multiplyScalar(1 - k * 0.32);
      paint.roughness = this._baseRough + k * 0.5;
      paint.clearcoat = this._baseClear * (1 - k * 0.85);
    }
    // Para-choques/carroceria cedendo no lado atingido (pivô da carroceria).
    const body = this.v.body;
    body.userData.dentFront = clamp(this.frontHits / 60, 0, 1);
    body.userData.dentRear = clamp(this.rearHits / 60, 0, 1);
    // Farol frontal danificado em batidas frontais fortes.
    this.v.headlightBroken = this.frontHits > 35;
  }
}
