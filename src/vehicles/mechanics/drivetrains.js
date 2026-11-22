/**
 * Personalidade mecânica de cada carro jogável (dados autorais do Neon City).
 *
 * layout       tração: FWD (dianteira), RWD (traseira) ou AWD (integral, awdFront = parte dianteira)
 * frontWeight  fração do peso sobre o eixo dianteiro (posição do centro de gravidade)
 * cgHeight     altura do centro de gravidade (m): define a transferência de carga ao acelerar/frear
 * torqueShape  forma da curva de torque: 'flat' (V8 de baixa rotação), 'balanced', 'peaky' (giro alto)
 * shiftSeconds tempo de corte de força em cada troca
 * brakeBias    fração da frenagem no eixo dianteiro
 * turbo        opcional: pressão extra com atraso (boostFraction, spoolRpm, spool/decay por segundo)
 *
 * Os números não vêm de nenhum jogo: foram escolhidos para dar caráter a cada modelo
 * (compactos de tração dianteira, muscle cars traseiros, o GT integral turbo, o motor
 * central do NEON PHANTOM) e calibrados nos testes de pista do próprio jogo.
 */
export const DEFAULT_DRIVETRAIN = Object.freeze({
  layout: 'RWD', awdFront: 0.45, frontWeight: 0.52, cgHeight: 0.52, torqueShape: 'balanced',
  shiftSeconds: 0.25, brakeBias: 0.64, turbo: null,
});

export const DRIVETRAINS = Object.freeze({
  sports: { layout: 'RWD', frontWeight: 0.48, cgHeight: 0.46, torqueShape: 'balanced', shiftSeconds: 0.18, brakeBias: 0.62 },
  convertible: { layout: 'RWD', frontWeight: 0.55, cgHeight: 0.52, torqueShape: 'flat', shiftSeconds: 0.27, brakeBias: 0.66 },
  sedan: { layout: 'RWD', frontWeight: 0.56, cgHeight: 0.56, torqueShape: 'flat', shiftSeconds: 0.32, brakeBias: 0.67 },
  palm_compact: { layout: 'FWD', frontWeight: 0.62, cgHeight: 0.52, torqueShape: 'peaky', shiftSeconds: 0.28, brakeBias: 0.68 },
  bay_city_100: {
    layout: 'FWD', frontWeight: 0.61, cgHeight: 0.5, torqueShape: 'peaky', shiftSeconds: 0.24, brakeBias: 0.68,
    turbo: { boostFraction: 0.3, spoolRpm: 3000, spoolPerSecond: 1.6, decayPerSecond: 4.5 },
  },
  coast_wagon: { layout: 'FWD', frontWeight: 0.6, cgHeight: 0.57, torqueShape: 'balanced', shiftSeconds: 0.3, brakeBias: 0.68 },
  metro_executive: { layout: 'RWD', frontWeight: 0.54, cgHeight: 0.55, torqueShape: 'flat', shiftSeconds: 0.3, brakeBias: 0.66 },
  ocean_coupe: { layout: 'RWD', frontWeight: 0.53, cgHeight: 0.5, torqueShape: 'flat', shiftSeconds: 0.24, brakeBias: 0.65 },
  sunset_touring: { layout: 'RWD', frontWeight: 0.56, cgHeight: 0.58, torqueShape: 'flat', shiftSeconds: 0.32, brakeBias: 0.67 },
  neon_phantom: { layout: 'RWD', frontWeight: 0.43, cgHeight: 0.44, torqueShape: 'peaky', shiftSeconds: 0.16, brakeBias: 0.6 },
  azure_gtr: {
    layout: 'AWD', awdFront: 0.4, frontWeight: 0.56, cgHeight: 0.48, torqueShape: 'peaky', shiftSeconds: 0.18, brakeBias: 0.63,
    turbo: { boostFraction: 0.34, spoolRpm: 3200, spoolPerSecond: 2.0, decayPerSecond: 5 },
  },
  midnight_vortex: { layout: 'RWD', frontWeight: 0.5, cgHeight: 0.46, torqueShape: 'balanced', shiftSeconds: 0.2, brakeBias: 0.62 },
});

/** Curvas de torque relativas: [fração da faixa idle→redline, fração do torque máximo]. */
export const TORQUE_SHAPES = Object.freeze({
  flat: [[0, 0.62], [0.2, 0.9], [0.45, 1], [0.75, 0.9], [1, 0.7]],
  balanced: [[0, 0.48], [0.25, 0.8], [0.55, 1], [0.82, 0.92], [1, 0.68]],
  peaky: [[0, 0.38], [0.3, 0.66], [0.62, 0.95], [0.82, 1], [1, 0.78]],
});

export function drivetrainFor(type) {
  return { ...DEFAULT_DRIVETRAIN, ...(DRIVETRAINS[type] || {}) };
}

/** Garrafa de nitro de série: usada quando o veículo não tem kit da oficina. */
export const STOCK_NITROUS = Object.freeze({ boost: 0.35, drain: 0.2 });
