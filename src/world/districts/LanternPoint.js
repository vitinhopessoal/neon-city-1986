import { FACE_EAST, FACE_WEST, FACE_SOUTH, FACE_NORTH } from './SunsetBeach.js';
import { SIDEWALK_HEIGHT as Y } from '../RoadGenerator.js';

// Original layout: the beach avenues continue into a compact northern district.
export const LANTERN_POINT = {
  id: 'lantern_point', name: 'LANTERN POINT',
  bounds: { minX: -150, maxX: 110, minZ: -330, maxZ: -170 },
  buildings: [
    { id: 'lp_beacon_house', name: 'Beacon House', type: 'filler', x: 3, z: -313, rotY: FACE_EAST, w: 19, d: 19, floors: 5, style: 'ribbon', massing: 'setback', blade: { text: 'BEACON', color: '#ffb347' } },
    { id: 'lp_horizon', name: 'Horizon Court', type: 'filler', x: -50, z: -313, rotY: FACE_WEST, w: 19, d: 18, floors: 4, style: 'balcony' },
    { id: 'lp_lantern_suites', name: 'Lantern Suites', type: 'filler', x: 3, z: -267, rotY: FACE_EAST, w: 22, d: 19, floors: 6, style: 'eyebrow', massing: 'setback', blade: { text: 'LANTERN', color: '#45f3ff' } },
    { id: 'lp_tide_court', name: 'Tide Court', type: 'filler', x: 3, z: -235, rotY: FACE_EAST, w: 22, d: 19, floors: 3, style: 'porthole' },
    { id: 'lp_radio', name: 'Signal Radio', type: 'shop', variant: 'records', sign: 'Signal Radio', sub: 'RECORDS & REPAIRS', x: -50, z: -267, rotY: FACE_WEST, w: 17, d: 17, floors: 2 },
    { id: 'lp_corner', name: 'Beacon Market', type: 'shop', variant: 'pharmacy', sign: 'Beacon Market', x: -50, z: -234, rotY: FACE_WEST, w: 17, d: 17 },
    { id: 'lp_cafe', name: 'Afterglow Cafe', type: 'shop', variant: 'cafe', sign: 'Afterglow', sub: 'COFFEE / ALL NIGHT', x: -14, z: -222, rotY: FACE_SOUTH, w: 14, d: 14 },
    { id: 'lp_travel', name: 'Lantern Travel', type: 'shop', variant: 'travel', sign: 'Lantern Travel', x: -14, z: -274, rotY: FACE_NORTH, w: 14, d: 13 },
    { id: 'lp_south_hotel', name: 'Amber Rooms', type: 'filler', x: 3, z: -184, rotY: FACE_EAST, w: 16, d: 19, floors: 3, style: 'balcony', sign: { text: 'Amber Rooms', color: '#ffb347' } },
    { id: 'lp_south_store', name: 'Night Owl Video', type: 'shop', variant: 'records', sign: 'Night Owl', sub: 'VIDEO CLUB', x: -50, z: -184, rotY: FACE_WEST, w: 15, d: 17 },
    { id: 'lp_west_1', name: 'Juniper Apartments', type: 'filler', x: -91, z: -314, rotY: FACE_EAST, w: 18, d: 18, floors: 3, style: 'eyebrow' },
    { id: 'lp_west_2', name: 'Beacon Terrace', type: 'house', style: 'mimo', x: -94, z: -268, rotY: FACE_EAST, lotW: 22, lotD: 28, paletteIndex: 2, garage: 'left', walls: { left: true, right: true, back: true } },
    { id: 'lp_west_3', name: 'Lantern Bungalow', type: 'house', style: 'bungalow', x: -94, z: -236, rotY: FACE_EAST, lotW: 22, lotD: 28, paletteIndex: 1, garage: 'right', walls: { left: true, right: true, back: true } },
    { id: 'lp_west_4', name: 'Garden Rooms', type: 'filler', x: -91, z: -184, rotY: FACE_EAST, w: 16, d: 18, floors: 2, style: 'porthole' },
    { id: 'lp_west_5', name: 'Northlight Apartments', type: 'filler', x: -130, z: -313, rotY: FACE_SOUTH, w: 20, d: 18, floors: 4, style: 'ribbon' },
    { id: 'lp_west_6', name: 'Lantern Workshop', type: 'shop', variant: 'laundry', sign: 'Lantern Works', x: -130, z: -184, rotY: FACE_NORTH, w: 19, d: 16 },
    { id: 'lp_bus_stop', name: 'Lantern Point Transit', type: 'busStop', x: 14.6, z: -248, rotY: FACE_EAST },
  ],
  overlays: [
    { minX: -40, maxX: -25, minZ: -273, maxZ: -223, material: 'overlayGrass', tile: 4, surface: 'grass' },
    { minX: -146, maxX: -116, minZ: -277, maxZ: -219, material: 'overlayGrass', tile: 4, surface: 'grass' },
    { minX: -146, maxX: -116, minZ: -250, maxZ: -246, material: 'pavers', tile: 2.4, surface: 'pavers', priority: 3, y: Y + 0.008 },
    { minX: -133, maxX: -129, minZ: -277, maxZ: -219, material: 'pavers', tile: 2.4, surface: 'pavers', priority: 3, y: Y + 0.012 },
  ],
  spawnPoints: [
    { id: 'spawn_lantern', x: 46, y: Y, z: -248, yaw: 0, label: 'Lantern Point' },
    { id: 'spawn_lantern_garden', x: -131, y: Y, z: -248, yaw: 0, label: 'Lantern Gardens' },
  ],
};

export function decorateLanternPoint({ props, palms, plants, batcher, world, net }) {
  let id = 0;
  const palm = (x, z) => palms.push({ id: `lp_palm_${id++}`, x, y: Y, z, rot: id * 1.7, scale: 0.9 + (id % 4) * 0.06, variant: id % 4 });
  for (const z of [-317, -270, -244, -224, -183]) {
    palm(16.6, z); palm(40.4, z); palm(51.6, z - 4);
    palm(-78.7, z); palm(-61.3, z);
    props.place('lamp', 17.2, Y, z + 6, Math.PI / 2);
    props.place('lamp', 38.9, Y, z + 6, -Math.PI / 2);
    props.place('lamp', -77, Y, z + 6, Math.PI / 2);
    props.place('bench', 49.6, Y, z, Math.PI / 2);
    props.place('bin', 49.8, Y, z + 2);
  }
  for (const z of [-205, -290]) {
    props.streetSign(16.5, Y, z - 7.4, 'OCEAN AVE', Math.PI / 2, z === -205 ? 'LANTERN LN' : 'BEACON ST');
    props.streetSign(-62.6, Y, z - 7.4, 'CORAL ST', Math.PI / 2, z === -205 ? 'LANTERN LN' : 'BEACON ST');
    // All approaches use the same all-way-stop rule as the traffic graph.
    for (const x of [28, -70]) {
      const hw = net.roads.get(x === 28 ? 'ocean_ave' : 'coral_st').width / 2;
      props.trafficSign('stop', x - hw - 1.3, Y, z - 13, Math.PI);
      props.trafficSign('stop', x + hw + 1.3, Y, z + 13, 0);
      props.trafficSign('stop', x - hw - 6, Y, z + 7.4, Math.PI / 2);
      if (x === -70) props.trafficSign('stop', x + hw + 6, Y, z - 7.4, -Math.PI / 2);
    }
    for (const x of [-139, -116, -40, -16]) {
      props.place('lamp', x, Y, z - 7.5, 0);
      palm(x, z + 9);
    }
    // Close only the outer west endpoints, never the connection to Sunset Beach.
    for (let k = 0; k < 4; k++) props.barricade(batcher, -148.8, 0, z - 4.5 + k * 3, Math.PI / 2, 2.7);
    props.trafficSign('closed', -147, Y, z + 7.5, Math.PI / 2);
  }
  for (const [x, z] of [[-142, -272], [-120, -272], [-142, -224], [-120, -224]]) {
    palm(x, z);
    plants.push({ type: 'flowers', x: x + 2, y: Y, z, scale: 1, rot: 0 });
  }
  for (const z of [-261, -235]) {
    props.place('bench', -134, Y, z, Math.PI / 2);
    props.place('bench', -126, Y, z, -Math.PI / 2);
    props.place('lamp', -131, Y, z, 0);
    plants.push({ type: 'tree', x: -143, y: Y, z, scale: 1.05, rot: z });
    plants.push({ type: 'shrub', x: -119, y: Y, z, scale: 1.1, rot: 0 });
  }
  props.streetSign(-131, Y, -219, 'LANTERN GARDENS', Math.PI, 'BEACON ST');
  world.addPOI({ id: 'lp_gardens', type: 'landmark', label: 'Lantern Gardens', x: -131, y: Y, z: -248 });
  for (const z of [-320, -260, -180]) {
    palm(59, z);
    props.place('umbrellaTeal', 73, world.terrain.getHeight(73, z), z, 0);
    props.place('lounger', 75, world.terrain.getHeight(75, z), z + 1.5, Math.PI / 2);
  }
}
