// Parâmetros próprios da polícia fictícia de Neon City (NCPD). Nenhum valor
// vem de arquivos de outros jogos (PROMPT 08: a dependência anterior de
// dados extraídos foi removida deste módulo).
/** Velocidade máxima de giro do corpo de um policial a pé (rad/s). */
export const HEADING_RATE = 7;
/** Multas fictícias (limitadas ao saldo) aplicadas pela economia central. */
export const FINES = { busted: 100, wasted: 50 };
// speed: velocidade-alvo das viaturas (m/s) por nível — 36 a 144 km/h; curvas reduzem automaticamente.
export const RESPONSE_LEVELS = [
  { units: 1, tier: 'patrol', speed: 10, range: 55, escape: 30, helicopter: false, roadblock: false },
  { units: 1, tier: 'patrol', speed: 20, range: 65, escape: 30, helicopter: false, roadblock: false },
  { units: 2, tier: 'patrol', speed: 28, range: 75, escape: 35, helicopter: false, roadblock: false },
  { units: 3, tier: 'vice', speed: 32, range: 85, escape: 40, helicopter: true, roadblock: false },
  { units: 4, tier: 'swat', speed: 34, range: 90, escape: 45, helicopter: true, roadblock: true },
  { units: 5, tier: 'federal', speed: 38, range: 100, escape: 50, helicopter: true, roadblock: true },
  { units: 6, tier: 'army', speed: 40, range: 110, escape: 60, helicopter: true, roadblock: true },
];

export const UNIFORMS = {
  patrol: { top: 0xb9c9b9, pants: 0x344c3e, cap: 0x364a3e, health: 65, damage: 7, interval: 1.1, armor: 0, label: 'NCPD' },
  vice: { top: 0xe6bcce, pants: 0xd8e5de, cap: null, health: 80, damage: 8, interval: 0.8, armor: 0.1, label: 'NCPD VICE' },
  swat: { top: 0x1d2938, pants: 0x202c3a, cap: 0x172235, health: 95, damage: 8, interval: 0.45, armor: 0.45, label: 'NCPD TÁTICO' },
  federal: { top: 0x152334, pants: 0x1b2433, cap: null, health: 100, damage: 9, interval: 0.4, armor: 0.35, label: 'NCB' },
  army: { top: 0x5b6940, pants: 0x444e31, cap: 0x596841, health: 110, damage: 10, interval: 0.38, armor: 0.5, label: 'GUARDA' },
};

// Referências próprias de massa e velocidade das viaturas fictícias (balanceamento
// relativo sobre a física existente; não substituem a física automotiva).
export const VEHICLE_REFERENCE = {
  patrol: { name: 'NCPD CRUISER', mass: 1550, maxKmh: 195 },
  vice: { name: 'NCPD INTERCEPTOR', mass: 1450, maxKmh: 205 },
  swat: { name: 'NCPD TÁTICO', mass: 3600, maxKmh: 165 },
  federal: { name: 'NCB SUV', mass: 3100, maxKmh: 170 },
  army: { name: 'GUARDA TRANSPORTE', mass: 7800, maxKmh: 150 },
};

export function responseFor(level) {
  return RESPONSE_LEVELS[Math.max(0, Math.min(6, Math.floor(level) || 0))];
}

export function canUseFirearms(level, threatened) {
  return level >= 2 || threatened;
}
