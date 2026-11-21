import { SIDEWALK_HEIGHT } from '../RoadGenerator.js';
import { createRng } from '../../utils/math.js';

/**
 * Regras de decoração específicas de Sunset Beach: palmeiras, postes,
 * bancos, guarda-sóis, placas e semáforos. Usa sementes fixas para que o
 * bairro seja sempre idêntico (identificadores estáveis).
 */
const Y = SIDEWALK_HEIGHT;
const HALF_PI = Math.PI / 2;

function nearAny(v, list, r) {
  for (const x of list) if (Math.abs(v - x) < r) return true;
  return false;
}

export function decorateSunsetBeach({ district, props, palms, plants = [], signals, batcher, rng, world }) {
  const b = district.bounds;
  const crossZ = [-70, 95, -9.5, 9.5, 0];
  const accessZ = district.beachAccess;

  // ---------------------------------------------------------------- palmeiras
  let palmId = 0;
  const palm = (x, z, y = Y, scale = null) => {
    palms.push({
      id: `palm_${palmId++}`, x, y, z, rot: rng.range(0, Math.PI * 2), scale: scale ?? rng.range(0.85, 1.15), variant: rng.int(0, 3),
    });
  };
  const palmNear = (x, z, r) => palms.some((p) => Math.hypot(p.x - x, p.z - z) < r);

  // Calçadão: fileira junto ao meio-fio e fileira junto ao muro.
  for (let z = b.minZ + 6; z <= b.maxZ - 6; z += 15) {
    if (!nearAny(z, crossZ, 4.5)) palm(40.4, z);
  }
  for (let z = b.minZ + 13; z <= b.maxZ - 6; z += 15) {
    if (!nearAny(z, accessZ, 4)) palm(51.6, z);
  }
  // Calçada oeste da avenida (entre os postes).
  for (const z of [-146, -122, -98, -74, -50, -26, 46, 70, 94, 118, 142]) palm(16.6, z);
  // Praça na esquina NE.
  palm(3, -15, Y, 1.05);
  palm(8.5, -11, Y, 0.9);
  // Flamingo Street.
  for (const x of [-20, -44]) palm(x, -8.6);
  for (const x of [-8, -32, -56]) palm(x, 8.6);
  for (const x of [-104, -132]) palm(x, -8.6);
  for (const x of [-98, -128]) palm(x, 8.6);
  // Coral Street.
  for (const z of [-140, -100, -64, -24, 30, 90, 120, 150]) palm(-78.7, z);
  for (const z of [-126, -86, -50, -14, 44, 104, 134, 160]) palm(-61.3, z);
  // Praia: grupos naturais perto do calçadão.
  for (const [x, z] of [[58, -150], [60.5, -147], [58.5, -104], [62, -100], [59, -48], [57.5, 4], [60, 8], [58, 48], [61, 52], [59, 84], [58, 118], [61.5, 122], [58.5, 152]]) {
    palm(x, z, world.terrain.getHeight(x, z) - 0.05);
  }
  // Palm Park.
  for (const [x, z] of [[-130, 88], [-120, 112], [-108, 92], [-98, 110], [-90, 86], [-136, 116]]) palm(x, z);

  // --------------------------------------------------------------- iluminação
  const lamp = (x, z, rot) => {
    let zz = z;
    if (palmNear(x, zz, 3)) zz += 5;
    props.place('lamp', x, Y, zz, rot);
  };
  for (let z = b.minZ + 12; z <= b.maxZ - 8; z += 24) {
    if (!nearAny(z, [0], 12)) lamp(17.2, z, HALF_PI);
  }
  for (let z = b.minZ + 24; z <= b.maxZ - 8; z += 24) {
    if (!nearAny(z, [0, 7.6], 9)) lamp(38.9, z, -HALF_PI);
  }
  for (const x of [-8, -33, -56, -95, -120, -142]) lamp(x, -7.0, 0);
  for (const x of [-20, -45, -90, -115, -140]) lamp(x, 7.0, Math.PI);
  for (let z = b.minZ + 15; z <= b.maxZ - 8; z += 26) {
    if (!nearAny(z, [0], 11)) lamp(-77.0, z, HALF_PI);
    if (!nearAny(z + 13, [0], 11) && z + 13 < b.maxZ - 6) lamp(-63.0, z + 13, -HALF_PI);
  }
  props.place('lamp', 0.5, Y, 85.5, Math.PI);
  props.place('lamp', 0.5, Y, 114.5, 0);

  // --------------------------------------------------- bancos, lixeiras, etc.
  for (let z = b.minZ + 20; z <= b.maxZ - 10; z += 30) {
    if (nearAny(z, accessZ, 5)) continue;
    props.place('bench', 49.6, Y, z, HALF_PI);
    props.place('bin', 49.8, Y, z + 1.6);
  }
  for (let z = b.minZ + 34; z <= b.maxZ - 10; z += 30) {
    if (nearAny(z, crossZ, 5)) continue;
    props.place('bench', 42.4, Y, z, -HALF_PI);
  }
  props.place('bench', 5, Y, -16.5, Math.PI);
  props.place('bench', 1, Y, -10.5, 0);
  props.place('bin', 10.5, Y, -16.8);
  for (const [x, z, r] of [[-125, 100, 0], [-112, 100, Math.PI], [-102, 118, -HALF_PI], [-132, 102, HALF_PI]]) props.place('bench', x, Y, z, r);
  props.place('bin', -118, Y, 98);
  for (const z of [-128, -56, 28, 64, 135]) props.place('bin', 16.8, Y, z);
  for (const [x, z] of [[15.6, -92], [15.6, 52], [-62.5, -32], [-77.5, 45], [-14, 8.4], [11.5, -8.4]]) props.place('hydrant', x, Y, z);
  props.place('newsBox', 15.8, Y, -46.8, HALF_PI);
  props.place('newsBox', 15.8, Y, -46.1, HALF_PI);
  props.place('newsBox', 13.8, Y, 112, HALF_PI);
  props.phoneBooth(batcher, 15.6, Y, -41.2, HALF_PI);
  props.phoneBooth(batcher, 13.9, Y, 117.4, HALF_PI);
  // Jardineiras com arbustos.
  for (const [x, z] of [[14.2, -118], [14.2, -64], [15, 40], [15, 88], [-5, -150], [-98, -12]]) {
    props.place('planter', x, Y, z);
    props.place('bush', x, Y + 0.55, z, rng.range(0, 6), 0.75);
  }
  for (const [x, z] of [[-120, 85], [-95, 118], [-138, 104], [-104, 84]]) props.place('bush', x, Y, z, rng.range(0, 6), 1.2);
  // Estacionamento: batentes.
  const lot = district.parkingLot;
  const nStalls = Math.floor((lot.maxZ - lot.minZ) / lot.stallWidth);
  for (let k = 0; k < nStalls; k++) {
    const z = lot.minZ + (k + 0.5) * lot.stallWidth;
    props.place('wheelStop', -10.3, Y, z, HALF_PI);
    props.place('wheelStop', 11.8, Y, z, HALF_PI);
  }

  // --------------------------------------------------------------------- praia
  const towers = district.lifeguardTowers.map((t) => [t.x, t.z]);
  const umbrellaTypes = ['umbrellaPink', 'umbrellaTeal', 'umbrellaSun'];
  let placed = 0;
  for (let i = 0; i < 120 && placed < 20; i++) {
    const x = rng.range(64, 81);
    const z = rng.range(b.minZ + 8, b.maxZ - 8);
    if (nearAny(z, accessZ, 5)) continue;
    if (towers.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 12)) continue;
    if (palmNear(x, z, 4)) continue;
    const y = world.terrain.getHeight(x, z);
    props.place(umbrellaTypes[placed % 3], x, y, z, rng.range(0, 6));
    props.place('lounger', x - 0.9, y, z + 1.3, HALF_PI + rng.range(-0.15, 0.15));
    if (rng.chance(0.7)) props.place('lounger', x - 0.9, y, z - 0.2, HALF_PI + rng.range(-0.15, 0.15));
    if (rng.chance(0.6)) props.place('towel', x + 2.2, y, z + rng.range(-1, 1), HALF_PI + rng.range(-0.4, 0.4));
    placed++;
  }

  // ------------------------------------------------------ vegetação ornamental
  // Gerador próprio: não altera a sequência aleatória usada pelo restante da decoração.
  const vr = createRng(5151);
  const plant = (type, x, z, scale = 1, y = Y) => plants.push({ type, x, y, z, scale, rot: vr.range(0, Math.PI * 2) });
  // Praça da esquina NE (gramado x -1..11, z -18..-9).
  for (const [x, z] of [[-0.3, -17.3], [10.3, -17.4], [-0.3, -9.7], [5.5, -17.6], [10.4, -13.5]]) plant('flowers', x, z, 0.85);
  for (const [x, z] of [[1.8, -13], [9.6, -9.9]]) plant('agave', x, z, 1.0);
  // Palm Park: canteiros floridos, arbustos e árvores.
  for (const [x, z] of [[-116, 88], [-92, 100], [-128, 109]]) plant('tree', x, z, vr.range(1.0, 1.25));
  for (const [x, z] of [[-118, 96], [-106, 104], [-114, 108], [-102, 96], [-126, 94], [-134, 110], [-100, 88], [-88, 112], [-138, 86], [-86, 92]]) {
    plant(vr.chance(0.6) ? 'flowers' : 'shrub', x, z, vr.range(0.9, 1.3));
  }
  for (const [x, z] of [[-110, 97], [-121, 106], [-96, 114], [-131, 98]]) plant('agave', x, z, vr.range(0.9, 1.2));
  // Faixas verdes internas dos quarteirões leste.
  for (const z of [32, 58, 84, 112, 140]) {
    plant('tree', -36 + vr.range(-1.2, 1.2), z, vr.range(0.95, 1.2));
    plant('shrub', -33.2, z + 7, vr.range(0.9, 1.2));
    plant(vr.chance(0.5) ? 'flowers' : 'agave', -38.8, z + 12, vr.range(0.8, 1.1));
  }
  for (const z of [-32, -60, -88, -118, -140]) {
    plant('tree', -29 + vr.range(-4, 4), z, vr.range(0.95, 1.25));
    plant('shrub', -21 + vr.range(-1, 1), z - 8, vr.range(1.0, 1.4));
    plant(vr.chance(0.5) ? 'flowers' : 'shrub', -37 + vr.range(-1, 1), z - 12, vr.range(0.9, 1.2));
    plant('agave', -24 + vr.range(-2, 2), z + 9, vr.range(0.9, 1.2));
  }
  // Quintais atrás das casas (gramado comum).
  for (const [x, z] of [[-108, 34], [-115, 50], [-109, 63], [-116, 76]]) plant('tree', x, z, vr.range(1.05, 1.3));
  for (const [x, z] of [[-105, 44], [-119, 40], [-106, 72], [-119, 60]]) plant('shrub', x, z, vr.range(1.0, 1.4));
  // Calçadão: agaves junto ao muro, ao lado dos acessos à praia.
  for (const a of accessZ) for (const s of [-1, 1]) plant('agave', 52.9, a + s * 3.4, vr.range(0.8, 1.05));

  // ------------------------------------------- parquímetros (Ocean Avenue)
  // A cada duas vagas, na borda da calçada; evita postes, palmeiras, placas,
  // lixeiras, hidrantes e o ponto de ônibus (consulta às colisões existentes).
  const col = world.collision;
  const freeAt = (x, z, r) => !palmNear(x, z, 1.3) && col.queryCircle(x, z, r).every((c) => !c.solid || c.maxY <= Y + 0.3);
  for (let z = b.minZ + 14; z <= b.maxZ - 10; z += 12.4) {
    if (nearAny(z, crossZ, 6) || Math.abs(z) < 16) continue;
    for (const x of [17.55, 38.45]) if (freeAt(x, z, 1.0)) props.place('parkingMeter', x, Y, z, x < 28 ? HALF_PI : -HALF_PI);
  }

  // ---------------------------------------------------------------- sinalização
  props.streetSign(16.5, Y, -7.4, 'OCEAN AVE', HALF_PI, 'FLAMINGO ST');
  props.streetSign(-62.6, Y, -7.4, 'CORAL ST', HALF_PI, 'FLAMINGO ST');
  props.streetSign(-77.4, Y, 7.4, 'CORAL ST', HALF_PI, 'FLAMINGO ST');
  props.trafficSign('stop', -77.6, Y, -11.5, Math.PI);
  props.trafficSign('stop', -62.4, Y, 11.5, 0);
  props.trafficSign('stop', -57.5, Y, -7.6, HALF_PI);
  props.trafficSign('stop', -82.5, Y, 7.6, -HALF_PI);
  props.trafficSign('speed', 17.4, Y, -104, Math.PI);
  props.trafficSign('speed', 39.0, Y, 128, 0);
  props.trafficSign('ped', 17.4, Y, -76.5, Math.PI);
  props.trafficSign('ped', 39.0, Y, -63.5, 0);
  props.trafficSign('ped', 17.4, Y, 88.5, Math.PI);
  props.trafficSign('ped', 39.0, Y, 101.5, 0);
  props.trafficSign('parking', 13.6, Y, 82.4, HALF_PI);

  // Semáforos do cruzamento Ocean Ave x Flamingo St.
  signals.push({
    id: 'int_ocean_flamingo',
    poles: [
      { x: 16.6, y: Y, z: -7.6, rot: 0, armLength: 9, group: 'ns', heads: [0.62, 0.86] },
      { x: 39.4, y: Y, z: 7.6, rot: Math.PI, armLength: 9, group: 'ns', heads: [0.6, 0.84] },
      { x: 16.6, y: Y, z: 7.6, rot: HALF_PI, armLength: 6, group: 'ew', heads: [0.62, 0.9] },
    ],
  });
}
