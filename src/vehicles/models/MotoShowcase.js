import { MOTO_DEFS } from './NeonMoto.js';

/**
 * NEON MOTORCYCLES — um exemplar de cada moto estacionado em Sunset Beach
 * (veículos do MAPA, como os carros da vitrine: entram em env.vehicles, então
 * montar, garagens, saves e posse funcionam igual). Duas motos por vaga de carro,
 * lado a lado: básicas nas ruas internas, customs perto das boates e esportivas
 * perto dos hotéis do calçadão. Escolha determinística (vaga livre mais próxima
 * da âncora da categoria).
 */
const ANCHORS = { basica: { x: -24, z: 60 }, custom: { x: 30, z: 20 }, esportiva: { x: 36, z: 70 } };
const RESERVED = [{ x: -75, z: -79, r: 8 }, { x: 46, z: 30, r: 8 }, { x: 19.3, z: -268, r: 10 }, { x: -75, z: -234, r: 8 }];

export function placeMotoShowcase(world) {
  const factory = world.vehicleFactory;
  const spots = (world.parkingSpots || []).filter((s) => !s.occupied && !s.reservedBy);
  const placed = [];
  const byCat = {};
  for (const d of MOTO_DEFS) if (factory.moto.has(d.type)) (byCat[d.category] ||= []).push(d);
  for (const [cat, defs] of Object.entries(byCat)) {
    const anchor = ANCHORS[cat];
    let best = null, bd = Infinity;
    for (const s of spots) {
      if (s.occupied || s.reservedBy) continue;
      if (RESERVED.some((r) => Math.hypot(s.x - r.x, s.z - r.z) < r.r)) continue;
      if (world.vehicles.some((v) => Math.hypot(v.root.position.x - s.x, v.root.position.z - s.z) < 6)) continue;
      const dd = Math.hypot(s.x - anchor.x, s.z - anchor.z);
      if (dd < bd) { bd = dd; best = s; }
    }
    if (!best) continue;
    best.occupied = true;
    best.reservedBy = 'moto_showcase';
    // Lado a lado na vaga: deslocamento lateral de ±0,85 m (espaço para montar) (esquerda = (cos h, −sin h)).
    const lx = Math.cos(best.heading), lz = -Math.sin(best.heading);
    defs.forEach((d, i) => {
      const off = (i - (defs.length - 1) / 2) * 1.7;
      const x = best.x + lx * off, z = best.z + lz * off;
      const id = `moto_${d.type}`;
      const v = factory.create(d.type, { id, plate: d.plate });
      world.groups.vehicles.add(v.root);
      const y = world.collision.getGroundHeight(x, z, 1.0, 1.5);
      v.setPose(x, Number.isFinite(y) ? y : 0, z, best.heading);
      v.attachCollider(world.collision);
      world.vehicles.push(v);
      world.registerEntity({ id, type: 'vehicle', subtype: d.type, name: v.spec.model, data: v });
      placed.push({ id, type: d.type, x: +x.toFixed(2), z: +z.toFixed(2) });
    });
  }
  world.motoShowcase = placed;
  return placed;
}
