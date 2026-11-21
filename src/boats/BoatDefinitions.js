/**
 * Embarcações originais de NEON CITY (nomes, formas e números próprios).
 * Unidades SI: m, kg, N, m/s. Frente do casco = +Z local; y = 0 na linha d'água.
 *  thrust     força máxima da hélice      maxSpeed  velocidade de cruzeiro máxima
 *  turn       taxa de giro (rad/s) em velocidade de manobra
 *  lateral    amortecimento lateral (quanto o casco "derrapa")
 *  bank       inclinação nas curvas       planing  empino da proa ao planar
 *  draft      calado (casco abaixo d'água) freeboard altura do convés
 *  seat       quadril do piloto (y acima da linha d'água) · eye: altura dos olhos
 */
export const BOATS = {
  speedster: {
    id: 'speedster', name: 'SUNSET SPEEDSTER', kind: 'Lancha esportiva', price: 18000,
    length: 7.2, width: 2.5, draft: 0.42, freeboard: 0.75, height: 1.6, mass: 1500,
    thrust: 15500, maxSpeed: 27, reverse: 0.32, turn: 1.15, lateral: 2.6, bank: 0.2, planing: 0.07,
    hp: 100, colors: { hull: 0xf4f1ea, stripe: 0x2a7bff, deck: 0xf2e6d0 }, seat: { x: -0.45, y: 0.68, z: -0.6 }, eye: 1.3,
    wake: 1.0, engine: { base: 48, range: 150, voice: 'sawtooth' },
  },
  cruiser: {
    id: 'cruiser', name: 'OCEAN RUNNER', kind: 'Lancha de cabine', price: 42000,
    length: 10.5, width: 3.3, draft: 0.65, freeboard: 1.05, height: 2.9, mass: 5200,
    thrust: 33000, maxSpeed: 20, reverse: 0.3, turn: 0.72, lateral: 3.2, bank: 0.11, planing: 0.05,
    hp: 160, colors: { hull: 0xeaf2f6, stripe: 0x2fb8d8, deck: 0xd9c8a4 }, seat: { x: -0.6, y: 1.28, z: -0.5 }, eye: 1.9,
    wake: 1.5, engine: { base: 36, range: 95, voice: 'sawtooth' },
  },
  fisher: {
    id: 'fisher', name: 'PALM FISHER', kind: 'Barco de pesca', price: 12000,
    length: 8.4, width: 2.9, draft: 0.55, freeboard: 0.95, height: 2.7, mass: 3300,
    thrust: 16500, maxSpeed: 14, reverse: 0.4, turn: 0.85, lateral: 3.8, bank: 0.09, planing: 0.035,
    hp: 140, colors: { hull: 0xf6f0d8, stripe: 0x2f8f55, deck: 0xe8e2d0 }, seat: { x: 0, y: 1.25, z: -0.95 }, eye: 1.9,
    wake: 1.2, engine: { base: 30, range: 70, voice: 'square' },
  },
  jetski: {
    id: 'jetski', name: 'NEON WAVE', kind: 'Jet ski retrô', price: 6500,
    length: 3.0, width: 1.15, draft: 0.22, freeboard: 0.45, height: 1.2, mass: 420,
    thrust: 5600, maxSpeed: 23, reverse: 0.25, turn: 2.3, lateral: 2.0, bank: 0.42, planing: 0.06,
    hp: 60, colors: { hull: 0xff4fd8, stripe: 0x45f3ff, deck: 0x1a1424 }, seat: { x: 0, y: 0.68, z: -0.35 }, eye: 1.3,
    wake: 0.6, engine: { base: 70, range: 210, voice: 'square' },
  },
  yacht: {
    id: 'yacht', name: 'AZURE YACHT', kind: 'Iate', price: 160000,
    length: 17, width: 4.8, draft: 1.1, freeboard: 1.6, height: 6.2, mass: 26000,
    thrust: 120000, maxSpeed: 15, reverse: 0.25, turn: 0.38, lateral: 4.5, bank: 0.05, planing: 0.02,
    hp: 320, colors: { hull: 0xf8f8fa, stripe: 0x1d4f8f, deck: 0xc8a878 }, seat: { x: -0.7, y: 4.31, z: 0.9 }, eye: 4.95,
    wake: 2.2, engine: { base: 26, range: 55, voice: 'sawtooth' },
  },
  patrol: {
    id: 'patrol', name: 'NCPD HARBOR', kind: 'Patrulha (base marítima)', price: 0, police: true,
    length: 8.0, width: 2.8, draft: 0.5, freeboard: 0.95, height: 2.6, mass: 3000,
    thrust: 22000, maxSpeed: 24, reverse: 0.35, turn: 0.95, lateral: 3.0, bank: 0.14, planing: 0.05,
    hp: 200, colors: { hull: 0xf2f4f8, stripe: 0x1d3a6e, deck: 0x9aa4ae }, seat: { x: 0, y: 1.2, z: -0.6 }, eye: 1.85,
    wake: 1.2, engine: { base: 38, range: 110, voice: 'sawtooth' },
  },
};

/** Modelos à venda na loja da marina (a patrulha não é vendida). */
export const SHOP_ORDER = ['jetski', 'fisher', 'speedster', 'cruiser', 'yacht'];

/** Registro serializável de um barco do jogador (sem nenhum objeto Three.js). */
export function boatRecord(type, pid, extra = {}) {
  return { pid, type, name: BOATS[type].name, hp: BOATS[type].hp, location: 'storage', slip: null, ...extra };
}
