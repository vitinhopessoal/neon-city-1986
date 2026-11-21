/**
 * SUNSET BEACH — primeiro bairro de Neon City.
 *
 * Layout (X = leste/oceano, Z = sul):
 *   x -150 … -76   quarteirões oeste (Coral Trust, residenciais, Palm Park)
 *   x  -76 … -64   Coral Street (N-S)
 *   x  -64 …  18   quarteirões leste (hotéis na Ocean Avenue)
 *   x   18 …  38   Ocean Avenue (avenida principal, 4 faixas + estacionamento)
 *   x   38 …  54   calçadão (pavers + palmeiras)
 *   x   54 … 110   praia (areia seca até ~84, depois água rasa)
 *   z   -6 …   6   Flamingo Street (E-W) — cruza Coral Street e encontra a avenida
 *
 * Este arquivo contém apenas DADOS de layout. A construção é feita pelo
 * CityGenerator, que poderá carregar outros bairros com o mesmo formato.
 */

const HALF_PI = Math.PI / 2;
export const FACE_EAST = HALF_PI;   // fachada local +Z -> mundo +X
export const FACE_WEST = -HALF_PI;  // fachada -> mundo -X
export const FACE_SOUTH = 0;        // fachada -> mundo +Z
export const FACE_NORTH = Math.PI;  // fachada -> mundo -Z

export const SUNSET_BEACH = {
  id: 'sunset_beach',
  name: 'SUNSET BEACH',
  bounds: { minX: -150, maxX: 110, minZ: -170, maxZ: 170 },
  visibleBounds: { minX: -420, maxX: 260, minZ: -420, maxZ: 420 },

  roads: [
    { id: 'ocean_ave', name: 'Ocean Avenue', start: { x: 28, z: -420 }, end: { x: 28, z: 420 }, lanesPerDirection: 2, laneWidth: 3.5, medianWidth: 1.0, parkingWidth: 2.5, speedLimit: 13.4 },
    { id: 'flamingo_e', name: 'Flamingo Street', start: { x: 18, z: 0 }, end: { x: -64, z: 0 }, lanesPerDirection: 1, laneWidth: 3.8, medianWidth: 0.4, parkingWidth: 2.0, speedLimit: 11.2 },
    { id: 'flamingo_w', name: 'Flamingo Street', start: { x: -76, z: 0 }, end: { x: -420, z: 0 }, lanesPerDirection: 1, laneWidth: 3.8, medianWidth: 0.4, parkingWidth: 2.0, speedLimit: 11.2 },
    { id: 'coral_st', name: 'Coral Street', start: { x: -70, z: -420 }, end: { x: -70, z: 420 }, lanesPerDirection: 1, laneWidth: 3.8, medianWidth: 0.4, parkingWidth: 2.0, speedLimit: 11.2 },
  ],

  intersections: [
    { id: 'int_ocean_flamingo', x: 28, z: 0, roads: ['ocean_ave'], control: 'signal', radius: 6 },
    { id: 'int_coral_flamingo', x: -70, z: 0, roads: ['coral_st', 'flamingo_e', 'flamingo_w'], control: 'stop', radius: 6 },
  ],

  crosswalks: [
    { id: 'cw_ocean_n', roadId: 'ocean_ave', t: 410.5, stopLine: 'forward' },
    { id: 'cw_ocean_s', roadId: 'ocean_ave', t: 429.5, stopLine: 'backward' },
    { id: 'cw_ocean_mid_n', roadId: 'ocean_ave', t: 350 },
    { id: 'cw_ocean_mid_s', roadId: 'ocean_ave', t: 515 },
    { id: 'cw_flamingo_ocean', roadId: 'flamingo_e', t: 4, stopLine: 'backward' },
    { id: 'cw_coral_n', roadId: 'coral_st', t: 410.5, stopLine: 'forward' },
    { id: 'cw_coral_s', roadId: 'coral_st', t: 429.5, stopLine: 'backward' },
    { id: 'cw_flamingo_coral_e', roadId: 'flamingo_e', t: 78.5, stopLine: 'forward' },
    { id: 'cw_flamingo_coral_w', roadId: 'flamingo_w', t: 3.5, stopLine: 'backward' },
  ],

  /** Lajes elevadas (calçadas/quarteirões) — topo em y = 0.15. */
  slabs: [
    { id: 'block_ne', minX: -64, maxX: 18, minZ: -420, maxZ: -6 },
    { id: 'block_se', minX: -64, maxX: 18, minZ: 6, maxZ: 420 },
    { id: 'block_nw', minX: -420, maxX: -76, minZ: -420, maxZ: -6 },
    { id: 'block_sw', minX: -420, maxX: -76, minZ: 6, maxZ: 420 },
    { id: 'boardwalk', minX: 38, maxX: 54, minZ: -420, maxZ: 420, material: 'pavers', tile: 2.4, surface: 'pavers', curbs: { n: false, s: false, w: true, e: false } },
  ],

  /** Gramados e estacionamento sobre as lajes. */
  overlays: [
    { minX: -11, maxX: 12.5, minZ: 84, maxZ: 116, material: 'overlayAsphalt', tile: 6, surface: 'asphalt' },
    { minX: -140, maxX: -84, minZ: 82, maxZ: 120, material: 'overlayGrass', tile: 4, surface: 'grass' },
    { minX: -1, maxX: 11, minZ: -18, maxZ: -9, material: 'overlayGrass', tile: 4, surface: 'grass' },
    { minX: -40, maxX: -18, minZ: -150, maxZ: -20, material: 'overlayGrass', tile: 4, surface: 'grass' },
    { minX: -40, maxX: -32, minZ: 23, maxZ: 160, material: 'overlayGrass', tile: 4, surface: 'grass' },
    // Gramado comum atrás das casas da Zona D.
    { minX: -121, maxX: -103.2, minZ: 28, maxZ: 80, material: 'overlayGrass', tile: 4, surface: 'grass' },
  ],

  buildings: [
    // Quarteirão NE — frente para a Ocean Avenue.
    { id: 'bld_ocean_club', type: 'oceanClub', name: 'Ocean Club', x: -2, z: -135, rotY: FACE_EAST },
    { id: 'bld_sunset_palace', type: 'sunsetPalace', name: 'Sunset Palace', x: -1.5, z: -90, rotY: FACE_EAST },
    { id: 'bld_neon_diner', type: 'neonDiner', name: 'Neon Diner', x: 4, z: -55, rotY: FACE_EAST },
    { id: 'bld_coconut_threads', type: 'coconutThreads', name: 'Coconut Threads', x: 4, z: -28, rotY: FACE_EAST },
    { id: 'bld_ne_filler_n', type: 'filler', name: 'Marina Suites', x: 4.5, z: -164, rotY: FACE_EAST, w: 11, d: 16, floors: 3, style: 'eyebrow', exposedSides: ['right'] },
    // Quarteirão SE.
    { id: 'bld_blue_wave', type: 'blueWave', name: 'Blue Wave', x: -0.5, z: 25, rotY: FACE_EAST },
    { id: 'bld_tropical_nights', type: 'tropicalNights', name: 'Tropical Nights', x: -1.5, z: 55, rotY: FACE_EAST },
    { id: 'bld_se_filler_a', type: 'filler', name: 'Seashell Arcade', x: 4.5, z: 75, rotY: FACE_EAST, w: 14, d: 16, floors: 2, shop: true, sign: { text: 'Arcade', color: '#45f3ff', style: 'block' } },
    { id: 'bld_sunny_mart', type: 'sunnyMart', name: 'Sunny Mart', x: -20, z: 100, rotY: FACE_EAST },
    { id: 'bld_flamingo_arms', type: 'flamingoArms', name: 'Flamingo Arms', x: 0, z: 140, rotY: FACE_EAST },
    { id: 'bld_se_filler_s', type: 'filler', name: 'Pelican House', x: 4.5, z: 163, rotY: FACE_EAST, w: 11, d: 16, floors: 3, style: 'porthole', exposedSides: ['left'] },
    { id: 'bld_se_filler_lot', type: 'filler', name: 'Lot Annex', x: -20, z: 124, rotY: FACE_EAST, w: 12, d: 16, floors: 2, shop: true, sign: { text: 'Video', color: '#ff6fd0', style: 'block' } },

    // Fundos dos quarteirões leste — frente para Coral Street (oeste).
    { id: 'bld_e_back_1', type: 'filler', x: -51, z: -150, rotY: FACE_WEST, w: 22, d: 16, floors: 4, style: 'ribbon', blade: { text: 'HOTEL', color: '#ff6fd0' } },
    { id: 'bld_e_back_2', type: 'filler', x: -51, z: -115, rotY: FACE_WEST, w: 24, d: 16, floors: 3, style: 'eyebrow' },
    { id: 'bld_e_back_3', type: 'filler', x: -51, z: -80, rotY: FACE_WEST, w: 22, d: 16, floors: 3, style: 'porthole', sign: { text: 'Deco Laundry', color: '#ffe95a' } },
    { id: 'bld_e_back_4', type: 'filler', x: -51, z: -44, rotY: FACE_WEST, w: 24, d: 16, floors: 2, shop: true },
    { id: 'bld_e_back_5', type: 'filler', x: -51, z: -18, rotY: FACE_WEST, w: 14, d: 16, floors: 2, shop: true, exposedSides: ['left'], sign: { text: 'Pizza', color: '#ff6f3d', style: 'block' } },
    { id: 'bld_e_back_6', type: 'filler', x: -51, z: 19, rotY: FACE_WEST, w: 16, d: 16, floors: 3, style: 'ribbon', exposedSides: ['right'] },
    { id: 'bld_e_back_7', type: 'filler', x: -51, z: 52, rotY: FACE_WEST, w: 24, d: 16, floors: 3, style: 'balcony' },
    { id: 'bld_e_back_8', type: 'filler', x: -51, z: 88, rotY: FACE_WEST, w: 22, d: 16, floors: 2, shop: true },
    { id: 'bld_e_back_9', type: 'filler', x: -51, z: 125, rotY: FACE_WEST, w: 24, d: 16, floors: 4, style: 'porthole', blade: { text: 'MOTEL', color: '#ffe95a' } },
    { id: 'bld_e_back_10', type: 'filler', x: -51, z: 158, rotY: FACE_WEST, w: 18, d: 16, floors: 3 },

    // Quarteirão NW.
    { id: 'bld_coral_trust', type: 'coralTrust', name: 'Coral Trust Building', x: -93.6, z: -40, rotY: FACE_EAST },
    { id: 'bld_nw_1', type: 'filler', x: -90, z: -82, rotY: FACE_EAST, w: 24, d: 18, floors: 4, style: 'eyebrow', blade: { text: 'APTS', color: '#45f3ff' } },
    { id: 'bld_nw_2', type: 'filler', x: -90, z: -118, rotY: FACE_EAST, w: 26, d: 18, floors: 3, style: 'ribbon' },
    { id: 'bld_nw_3', type: 'filler', x: -90, z: -155, rotY: FACE_EAST, w: 18, d: 18, floors: 3, style: 'porthole' },
    { id: 'bld_nw_flamingo', type: 'filler', x: -125, z: -19, rotY: FACE_SOUTH, w: 22, d: 16, floors: 3, shop: true, exposedSides: ['left'], sign: { text: 'Records', color: '#ff6fd0' } },
    { id: 'bld_nw_back', type: 'filler', x: -132, z: -70, rotY: FACE_EAST, w: 30, d: 20, floors: 5, style: 'eyebrow' },
    // Quarteirão SW.
    { id: 'bld_sw_flamingo', type: 'filler', x: -125, z: 19, rotY: FACE_NORTH, w: 22, d: 16, floors: 2, shop: true, sign: { text: 'Surf Shop', color: '#45f3ff' } },
    { id: 'bld_sw_3', type: 'filler', x: -90, z: 138, rotY: FACE_EAST, w: 24, d: 18, floors: 3, style: 'porthole' },
    { id: 'bld_sw_4', type: 'filler', x: -90, z: 162, rotY: FACE_EAST, w: 14, d: 18, floors: 2, shop: true },
    { id: 'bld_sw_back', type: 'filler', x: -132, z: 55, rotY: FACE_EAST, w: 28, d: 20, floors: 4, style: 'balcony', massing: 'setback' },

    // Zona B — comércio de rua na Flamingo Street (vitrines, toldos, letreiros).
    { id: 'shop_cafe_brisa', type: 'shop', variant: 'cafe', name: 'Café Brisa', sign: 'Café Brisa', x: -37.5, z: -16, rotY: FACE_SOUTH, w: 9, d: 10 },
    { id: 'shop_palmetto_drugs', type: 'shop', variant: 'pharmacy', name: 'Palmetto Drugs', sign: 'Palmetto Drugs', x: -28, z: -16, rotY: FACE_SOUTH, w: 8, d: 10 },
    { id: 'shop_seabreeze_barber', type: 'shop', variant: 'barber', name: 'Seabreeze Barber', sign: 'Seabreeze', sub: 'BARBER SHOP', x: -19, z: -16, rotY: FACE_SOUTH, w: 8.5, d: 10, floors: 2 },
    { id: 'shop_polar_swirl', type: 'shop', variant: 'icecream', name: 'Polar Swirl', sign: 'Polar Swirl', x: -9.5, z: -16, rotY: FACE_SOUTH, w: 8, d: 10, exposedSides: ['right'] },
    { id: 'shop_spin_cycle', type: 'shop', variant: 'laundry', name: 'Spin Cycle', sign: 'Spin Cycle', sub: 'LAUNDROMAT', x: -37, z: 16, rotY: FACE_NORTH, w: 9, d: 10, exposedSides: ['right'] },
    { id: 'shop_tropic_travel', type: 'shop', variant: 'travel', name: 'Tropic Travel', sign: 'Tropic Travel', x: -28, z: 16, rotY: FACE_NORTH, w: 8, d: 10, floors: 2 },
    { id: 'shop_wax_wave', type: 'shop', variant: 'records', name: 'Wax Wave Records', sign: 'Wax Wave', blade: 'RECORDS', x: -19.5, z: 16, rotY: FACE_NORTH, w: 8.5, d: 10 },

    // Zona D — casas tropicais em lotes murados, voltadas para a Coral Street.
    { id: 'house_coral_16', type: 'house', style: 'bungalow', name: 'Casa 16 Coral St', x: -91, z: 16, rotY: FACE_EAST, lotW: 14, lotD: 24, paletteIndex: 0, garage: 'right', walls: { left: true, right: true, back: true } },
    { id: 'house_coral_30', type: 'house', style: 'mimo', name: 'Casa 30 Coral St', x: -91, z: 30, rotY: FACE_EAST, lotW: 14, lotD: 24, paletteIndex: 0, garage: 'left', walls: { left: true, right: false, back: true } },
    { id: 'house_coral_44', type: 'house', style: 'bungalow', name: 'Casa 44 Coral St', x: -91, z: 44, rotY: FACE_EAST, lotW: 14, lotD: 24, paletteIndex: 1, garage: 'left', doorU: 1.4, walls: { left: true, right: false, back: true } },
    { id: 'house_coral_58', type: 'house', style: 'mimo', name: 'Casa 58 Coral St', x: -91, z: 58, rotY: FACE_EAST, lotW: 14, lotD: 24, paletteIndex: 1, garage: 'right', walls: { left: true, right: false, back: true } },
    { id: 'house_coral_72', type: 'house', style: 'bungalow', name: 'Casa 72 Coral St', x: -91, z: 72, rotY: FACE_EAST, lotW: 14, lotD: 24, paletteIndex: 2, garage: null, walls: { left: true, right: false, back: true } },

    // Mobiliário urbano construído com o kit.
    { id: 'bus_stop_ocean', type: 'busStop', name: 'Ponto de ônibus — Ocean Ave', x: 14.6, z: -21.5, rotY: FACE_EAST },
  ],

  /** Estacionamento do Sunny Mart: vagas perpendiculares (dados reutilizáveis). */
  parkingLot: {
    id: 'lot_sunny_mart',
    minX: -11, maxX: 12.5, minZ: 84, maxZ: 116,
    rows: [
      { x0: -11, depth: 5.4, facing: 1 },   // junto à loja, frente para +X
      { x0: 12.5, depth: 5.4, facing: -1 }, // junto à calçada, frente para -X
    ],
    stallWidth: 2.8,
  },

  spawnPoints: [
    { id: 'spawn_boardwalk', x: 46, y: 0.15, z: 30, yaw: 0, label: 'Calçadão de Sunset Beach' },
    { id: 'spawn_beach', x: 70, y: 0.1, z: -10, yaw: -HALF_PI, label: 'Praia' },
    { id: 'spawn_diner', x: 15, y: 0.15, z: -55, yaw: HALF_PI, label: 'Neon Diner' },
  ],

  vehicles: [
    // NEON GT (esportivo, branco-pérola) — em frente aos hotéis Blue Wave / Tropical Nights.
    { id: 'veh_vento_white', type: 'sports', color: 0xf2eee6, stripe: 0xff5fa8, x: 36.75, z: 42, heading: Math.PI, plate: 'NEON 86' },
    // SUNSET CLASSIC (conversível, azul-claro) — na Ocean Avenue, diante do Sunset Palace.
    { id: 'veh_riviera_teal', type: 'convertible', color: 0x9ccfe8, x: 19.25, z: -86, heading: 0, plate: 'SUN 1986' },
    // PALM SEDAN (sedã, bege metálico) — estacionamento do Sunny Mart.
    { id: 'veh_regent_blue', type: 'sedan', color: 0xd6c29a, x: -8.4, z: 93.8, heading: -HALF_PI, plate: 'PALM 455' },
    { id: 'veh_vento_red', type: 'sports', color: 0xd8283a, stripe: 0xffffff, x: -30, z: -4.8, heading: -HALF_PI, plate: 'HOT 808' },
    { id: 'veh_regent_champagne', type: 'sedan', color: 0xe6d3a8, x: 19.25, z: 72, heading: 0, plate: 'NC 1234' },
    { id: 'veh_riviera_white', type: 'convertible', color: 0xf2efe6, x: 9.9, z: 105.0, heading: HALF_PI, plate: 'BEACH 7' },
  ],

  lifeguardTowers: [
    { id: 'lifeguard_north', x: 72, z: -40, colors: { hut: 0xff9fc0, stripe: 0x3fc1b0, roof: 0xfff4e0 } },
    { id: 'lifeguard_south', x: 74, z: 102, colors: { hut: 0xffd36a, stripe: 0xff6f4f, roof: 0x3fc1b0 } },
  ],

  /** Linha de boias da área de banho (água ~0,5 m de profundidade). */
  buoys: { x: 104, from: -160, to: 160, step: 16 },

  /** Pranchas de surfe: junto às torres de salva-vidas e na areia. */
  surfboards: [
    { x: 68.6, z: -36.2, rot: 0.3, lean: 0.14, color: 0xff5fa8 },
    { x: 68.9, z: -35.4, rot: 0.1, lean: 0.1, color: 0x45c9d8 },
    { x: 69.2, z: -34.6, rot: -0.2, lean: 0.16, color: 0xffd36a },
    { x: 70.6, z: 106.1, rot: -0.2, lean: 0.12, color: 0x7d5ba6 },
    { x: 71.0, z: 106.9, rot: 0.15, lean: 0.15, color: 0xff7a3d },
    { x: 66.5, z: 26.5, rot: 1.2, mode: 'flat', color: 0x3fc1b0 },
    { x: 77.5, z: -100.5, rot: -0.6, mode: 'flat', color: 0xff5fa8 },
    { x: 64.2, z: 140.4, rot: 0.2, lean: 0.12, color: 0xfdf6ee },
  ],

  /** Aberturas no muro baixo entre calçadão e praia (acessos). */
  beachAccess: [-130, -62, -20, 18, 66, 132],
};
