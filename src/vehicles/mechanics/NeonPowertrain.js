import { createNeonAdapter } from './neon-adapter.mjs';

/**
 * Explicit opt-in after VehicleManager has created vehicle.physics.
 * factoryHandling must come from immutable SPECS[type].handling, not the live
 * upgraded vehicle.spec.handling. No global factory presets are mutated.
 */
export function attachNeonPowertrain(vehicle, { factoryHandling, ...options } = {}) {
  if (!vehicle?.physics || typeof vehicle.physics.setPowertrain !== 'function') {
    return { ok: false, error: { code: 'PHYSICS_NOT_READY', message: 'Attach after vehicle.physics exists' } };
  }
  const created = createNeonAdapter({ handling: vehicle.spec.handling, factoryHandling,
    spec: vehicle.spec, ...options });
  if (!created.ok) return created;
  const attached = vehicle.physics.setPowertrain(created.value);
  return attached.ok ? created : attached;
}

export function detachNeonPowertrain(vehicle) {
  return vehicle?.physics?.setPowertrain(null) ?? {
    ok: false, error: { code: 'PHYSICS_NOT_READY', message: 'No vehicle.physics' },
  };
}
