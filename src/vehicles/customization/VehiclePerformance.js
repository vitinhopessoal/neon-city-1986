import { PARTS, UPGRADES, partOption } from './CustomizationCatalog.js';
import { SPECS } from '../VehicleFactory.js';

/**
 * Desempenho real: recalcula o `spec.handling` do veículo a partir do manuseio
 * de FÁBRICA do modelo (SPECS) e das peças instaladas. Multiplicadores
 * moderados preservam a identidade de cada carro (o NEON GT continua mais
 * rápido e ágil que o PALM SEDAN mesmo com tudo instalado nos dois).
 * Só o objeto de manuseio DESTE veículo é alterado (cópia própria).
 */
const deepCopy = (h) => ({ ...h, suspension: { ...h.suspension }, gears: [...h.gears] });

export function collectPerf(cfg) {
  const p = { engine: 1, maxSpeed: 1, brake: 1, grip: 1, cornering: 1, steerSpeed: 1, stability: 0, roll: 1, pitch: 1, gearing: 1, resist: 1, mass: 0, enginePitch: 1 };
  const add = (perf) => {
    if (!perf) return;
    for (const [k, v] of Object.entries(perf)) {
      if (k === 'stability' || k === 'mass') p[k] += v;
      else p[k] *= v;
    }
  };
  for (const cat of Object.keys(PARTS)) add(partOption(cat, cfg[cat])?.perf);
  for (const [k, u] of Object.entries(UPGRADES)) add(u.levels[cfg[k] | 0]?.perf);
  return p;
}

/** Manuseio resultante (sem aplicar) — usado também pela prévia das barras. */
export function computeHandling(type, cfg) {
  const base = SPECS[type]?.handling;
  if (!base) return null;
  const h = deepCopy(base);
  const p = collectPerf(cfg);
  h.mass = base.mass + p.mass;
  // Força do motor acompanha a massa extra (blindagem) para não "punir" demais.
  h.engineForce = base.engineForce * p.engine * (h.mass / base.mass) ** 0.5;
  h.maxSpeed = base.maxSpeed * p.maxSpeed;
  const top = base.gears[base.gears.length - 1];
  h.gears = base.gears.map((g, i) => (i === base.gears.length - 1 ? g * p.maxSpeed : Math.min(g * p.gearing * p.maxSpeed, top * p.maxSpeed)));
  h.brakeForce = base.brakeForce * p.brake * (h.mass / base.mass);
  h.grip = base.grip * p.grip;
  h.corneringFront = base.corneringFront * p.cornering;
  h.corneringRear = base.corneringRear * p.cornering;
  h.steerSpeed = base.steerSpeed * p.steerSpeed;
  h.stability = Math.max(0.2, Math.min(1.0, base.stability + p.stability));
  h.rollGain = base.rollGain * p.roll;
  h.pitchGain = base.pitchGain * p.pitch;
  h.enginePitch = base.enginePitch * p.enginePitch;
  h.suspension.travel = base.suspension.travel * (p.roll < 1 ? 0.85 : 1);
  // Kit de nitro (mecânica veicular): lido pelo câmbio/motor a partir do manuseio vivo.
  const kit = UPGRADES.nitro?.levels[cfg.nitro | 0]?.nitro || UPGRADES.nitro?.levels[0]?.nitro;
  if (kit) { h.nitroBoost = kit.boost; h.nitroDrain = kit.drain; }
  return { handling: h, resist: p.resist };
}

/** Aplica ao veículo: manuseio próprio + resistência no sistema de danos existente. */
export function applyPerformance(vehicle, cfg) {
  const r = computeHandling(vehicle.type, cfg);
  if (!r) return false;
  // Substitui os valores no objeto de manuseio DO VEÍCULO (a física lê vehicle.spec.handling).
  const H = vehicle.spec.handling;
  Object.assign(H, r.handling);
  if (vehicle.damage) vehicle.damage.resistance = r.resist;
  return true;
}

/**
 * Indicadores 0–100 derivados dos parâmetros reais do controlador arcade.
 * Escalas fixas (iguais para todos os carros) permitem comparar modelos.
 */
export function statsFor(type, cfg) {
  const r = computeHandling(type, cfg);
  if (!r) return null;
  const h = r.handling;
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
  const corner = (h.corneringFront + h.corneringRear) / 2;
  return {
    speed: clamp((h.maxSpeed / 75) * 100),
    accel: clamp(((h.engineForce / h.mass) / 10.5) * 100),
    brake: clamp(((h.brakeForce / h.mass) / 16) * 100),
    control: clamp(((h.grip * corner * (0.6 + h.stability * 0.6)) / 16) * 100),
    resist: clamp((1.25 - r.resist) * 80),
  };
}
