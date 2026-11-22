/**
 * Junção dos mapas: o TEST CITY (GLB original de testes, 216 x 216 m) passa a
 * ser um bairro a OESTE de Sunset Beach, no mesmo mundo. O modelo é apenas
 * transladado (sem escala, sem rotação, arquivo GLB intacto).
 *
 * Ligação: a Flamingo Street (z = 0) segue para oeste, atravessa um corredor
 * de 22 m e encontra a rua X0 do TEST CITY no cruzamento da rua Z100.
 *
 *   x  -388 … -172   TEST CITY (limites do manifesto, deslocados)
 *   x  -172 … -150   corredor da Flamingo Street (|z| < 12)
 *   x  -150 …  110   Sunset Beach / Lantern Point (inalterados)
 */
const OFFSET = { x: -280, y: -0.02, z: 0 }; // y: 2 cm abaixo do asfalto do Sunset (sem z-fighting)
const HALF = 108;        // manifest.bounds (±108)
const GROUND_HALF = 130; // GROUND_streets do GLB (260 m)
const OPENING = 12;      // meia largura da passagem (rua de 12 m + calçadas)

export const TEST_CITY_LINK = {
  id: 'test_city',
  name: 'TEST CITY',
  manifestUrl: `${import.meta.env?.BASE_URL || './'}maps/test-city/manifest.json`,
  offset: OFFSET,
  half: HALF,
  opening: OPENING,
  /** Área jogável do bairro (coordenadas do mundo). */
  rect: { minX: OFFSET.x - HALF, maxX: OFFSET.x + HALF, minZ: OFFSET.z - HALF, maxZ: OFFSET.z + HALF },
  /** Chão do GLB (maior que a área jogável): o chão do Sunset ganha um vão aqui. */
  ground: { minX: OFFSET.x - GROUND_HALF, maxX: OFFSET.x + GROUND_HALF, minZ: OFFSET.z - GROUND_HALF, maxZ: OFFSET.z + GROUND_HALF },
  /** Corredor entre o limite oeste do Sunset (x = -150) e o TEST CITY. */
  corridor: { minX: OFFSET.x + HALF, maxX: -150, minZ: -OPENING, maxZ: OPENING },
  /** A Flamingo Street termina na borda da rua Z100 do TEST CITY (x local 100 ± 5). */
  roadEndX: OFFSET.x + 105,
  /** Cruzamento do TEST CITY que recebe a Flamingo Street. */
  junction: 'tc_100_0',
  /** Prefixo dos ids de ruas/cruzamentos do TEST CITY na rede viária do mundo. */
  prefix: 'tc_',
};
