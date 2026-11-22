import { SUNSET_BEACH } from './SunsetBeach.js';
import { decorateSunsetBeach } from './SunsetBeachDecor.js';
import { LANTERN_POINT, decorateLanternPoint } from './LanternPoint.js';
import { TEST_CITY_LINK } from './TestCityLink.js';

// Build connected districts in one pass: one road graph, one coast and outer
// boundary, shared vegetation pools. Internal district borders stay traversable.
export function createCoastalCity({ testCityLink = false } = {}) {
  const roads = [], intersections = [], crosswalks = [];
  for (const [key, z, name] of [['lantern', -205, 'Lantern Lane'], ['beacon', -290, 'Beacon Street']]) {
    for (const [suffix, startX, endX] of [['e', 18, -64], ['w', -76, -420]]) {
      const id = `${key}_${suffix}`;
      roads.push({ id, name, start: { x: startX, z }, end: { x: endX, z }, lanesPerDirection: 1, laneWidth: 3.8, medianWidth: 0.4, parkingWidth: 2, speedLimit: 9 });
      crosswalks.push({ id: `cw_${id}`, roadId: id, t: suffix === 'e' ? 4 : 3.5 });
      if (suffix === 'e') crosswalks.push({ id: `cw_${id}_coral`, roadId: id, t: 78.5 });
    }
    for (const [roadId, x] of [['ocean_ave', 28], ['coral_st', -70]]) {
      intersections.push({ id: `int_${key}_${roadId}`, x, z, roads: [roadId, `${key}_e`, ...(x === -70 ? [`${key}_w`] : [])], control: 'stop', radius: 6 });
      for (const offset of [-9.5, 9.5]) crosswalks.push({ id: `cw_${key}_${roadId}_${offset < 0 ? 'n' : 's'}`, roadId, t: 420 + z + offset, stopLine: offset < 0 ? 'forward' : 'backward' });
    }
  }
  const slabs = SUNSET_BEACH.slabs.map(s => ({ ...s, ...(s.id.startsWith('block_') && s.minZ < -170 ? { minZ: -170 } : {}) }));
  for (const [i, [minZ, maxZ]] of [[-420, -296], [-284, -211], [-199, -170]].entries()) {
    slabs.push({ id: `lp_block_e_${i}`, minX: -64, maxX: 18, minZ, maxZ });
    slabs.push({ id: `lp_block_w_${i}`, minX: -420, maxX: -76, minZ, maxZ });
  }
  const district = {
    ...SUNSET_BEACH,
    id: 'coastal_city',
    bounds: { ...SUNSET_BEACH.bounds, minZ: LANTERN_POINT.bounds.minZ },
    regions: [LANTERN_POINT, SUNSET_BEACH],
    roads: [...SUNSET_BEACH.roads, ...roads],
    intersections: [...SUNSET_BEACH.intersections, ...intersections],
    crosswalks: [...SUNSET_BEACH.crosswalks, ...crosswalks],
    slabs,
    buildings: [...SUNSET_BEACH.buildings, ...LANTERN_POINT.buildings],
    overlays: [...SUNSET_BEACH.overlays, ...LANTERN_POINT.overlays],
    spawnPoints: [...SUNSET_BEACH.spawnPoints, ...LANTERN_POINT.spawnPoints],
    beachAccess: [...SUNSET_BEACH.beachAccess, -308, -248, -184],
    buoys: { ...SUNSET_BEACH.buoys, from: -320 },
    lifeguardTowers: [...SUNSET_BEACH.lifeguardTowers, { id: 'lifeguard_lantern', x: 72, z: -238, colors: { hut: 0x70c8d1, stripe: 0xffc66d, roof: 0xfff4e0 } }],
    decorate(ctx) {
      // Keep existing decoration positions and seeded random sequence stable.
      decorateSunsetBeach({ ...ctx, district: SUNSET_BEACH });
      decorateLanternPoint(ctx);
      ctx.props.place('stall', 47.2, 0.15, -100);
      ctx.props.place('stall', 47.2, 0.15, -224);
    },
  };
  return testCityLink ? withTestCityLink(district) : district;
}

/**
 * Prepara Sunset Beach para receber o TEST CITY a oeste: a Flamingo Street
 * termina na borda do novo bairro, as calçadas de fundo (que antes seguiam
 * até x = -420, fora da área jogável) param no limite oeste e o corredor
 * ganha calçadas. Prédios, ruas e decoração dentro do Sunset não mudam.
 */
function withTestCityLink(d) {
  const L = TEST_CITY_LINK;
  const west = d.bounds.minX;
  const roads = d.roads.map((r) => (r.id === 'flamingo_w' ? { ...r, end: { x: L.roadEndX, z: r.end.z } } : r));
  const slabs = d.slabs.map((s) => (s.minX < west && s.maxZ > L.ground.minZ && s.minZ < L.ground.maxZ ? { ...s, minX: west } : s));
  slabs.push({ id: 'tc_link_n', minX: L.roadEndX, maxX: west, minZ: -L.opening, maxZ: -6 });
  slabs.push({ id: 'tc_link_s', minX: L.roadEndX, maxX: west, minZ: 6, maxZ: L.opening });
  // Faixas fora da área jogável, dos dois lados do corredor: canteiros (antes, asfalto nu do chão do GLB).
  const k = L.corridor;
  slabs.push({ id: 'tc_link_fill_n', minX: k.minX, maxX: west, minZ: L.ground.minZ, maxZ: -L.opening - 0.5 });
  slabs.push({ id: 'tc_link_fill_s', minX: k.minX, maxX: west, minZ: L.opening + 0.5, maxZ: L.ground.maxZ });
  const overlays = [...d.overlays,
    { minX: k.minX + 1.5, maxX: west - 1.5, minZ: L.ground.minZ + 1.5, maxZ: -L.opening - 2, material: 'overlayGrass', tile: 4, surface: 'grass' },
    { minX: k.minX + 1.5, maxX: west - 1.5, minZ: L.opening + 2, maxZ: L.ground.maxZ - 1.5, material: 'overlayGrass', tile: 4, surface: 'grass' }];
  return { ...d, roads, slabs, overlays, link: L };
}
