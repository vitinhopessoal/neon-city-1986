import { NEON_DEFS } from './NeonMotor.js';

/**
 * NEON MOTOR COMPANY — um exemplar de cada modelo estacionado em Sunset Beach
 * (veículos do MAPA, como os demais estacionados: entram em env.vehicles, então
 * garagens, saves e posse funcionam igual). Populares nas ruas residenciais,
 * intermediários nas avenidas comerciais e os esportivos perto dos hotéis/boates.
 *
 * As vagas vêm do RoadNetwork (world.parkingSpots). A escolha é determinística:
 * para cada modelo, a vaga livre mais próxima da âncora da sua categoria,
 * respeitando distância mínima entre os carros e áreas reservadas.
 */
const ANCHORS = {
  luxo: [{ x: 36, z: 48 }, { x: 30, z: 0 }, { x: 36, z: -30 }],          // hotéis do calçadão / boates
  intermediario: [{ x: 19, z: 60 }, { x: 19, z: -60 }, { x: 0, z: 20 }],   // Ocean Avenue (comércio)
  popular: [{ x: -20, z: 80 }, { x: -30, z: -20 }, { x: -10, z: 120 }],   // ruas internas (residencial)
};
const RESERVED = [{ x: -75, z: -79, r: 8 }, { x: 46, z: 30, r: 8 }, { x: 19.3, z: -268, r: 10 }, { x: -75, z: -234, r: 8 }];

export function placeNeonShowcase(world) {
  const factory = world.vehicleFactory;
  const spots = (world.parkingSpots || []).filter((s) => !s.occupied && !s.reservedBy);
  const used = [];
  const placed = [];
  const counters = { luxo: 0, intermediario: 0, popular: 0 };
  for (const d of NEON_DEFS) {
    if (!factory.neon.has(d.type)) continue;
    const anchor = ANCHORS[d.category][counters[d.category]++ % 3];
    let best = null, bd = Infinity;
    for (const s of spots) {
      if (s.occupied || s.reservedBy) continue;
      if (RESERVED.some((r) => Math.hypot(s.x - r.x, s.z - r.z) < r.r)) continue;
      if (used.some((u) => Math.hypot(u.x - s.x, u.z - s.z) < 9)) continue;
      if (world.vehicles.some((v) => Math.hypot(v.root.position.x - s.x, v.root.position.z - s.z) < 7)) continue;
      const dd = Math.hypot(s.x - anchor.x, s.z - anchor.z);
      if (dd < bd) { bd = dd; best = s; }
    }
    if (!best) continue;
    const id = `neon_${d.type}`;
    const v = factory.create(d.type, { id, plate: d.plate });
    world.groups.vehicles.add(v.root);
    const y = world.collision.getGroundHeight(best.x, best.z, 1.0, 1.5);
    v.setPose(best.x, Number.isFinite(y) ? y : 0, best.z, best.heading);
    v.attachCollider(world.collision);
    world.vehicles.push(v);
    world.registerEntity({ id, type: 'vehicle', subtype: d.type, name: v.spec.model, data: v });
    best.occupied = true;
    best.reservedBy = 'neon_showcase';
    used.push(best);
    placed.push({ id, type: d.type, x: +best.x.toFixed(2), z: +best.z.toFixed(2) });
  }
  world.neonShowcase = placed;
  return placed;
}
