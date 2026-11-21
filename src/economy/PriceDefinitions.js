/**
 * Valores da economia (balanceamento inicial — ajustáveis).
 * Unidade: 1 = um dólar fictício ($). O jogo não usa centavos, então o dólar
 * inteiro já é a menor unidade e todas as operações são com inteiros.
 */
export const ECONOMY = {
  /** Saldo de uma NOVA partida (não é concedido de novo ao carregar). */
  startingMoney: 2500,
  /** Teto da carteira (o HUD mostra 8 dígitos). */
  maxMoney: 99999999,
  /** Quantas transações recentes ficam no histórico salvo. */
  historySize: 60,
};

/** Origens válidas de recompensas (missões, entregas etc. — etapas futuras). */
export const REWARD_SOURCES = ['mission', 'delivery', 'job', 'business', 'race', 'service', 'event', 'refund', 'dev'];

export const PRICES = {
  properties: {
    sunset_apartment: 0,
    palm_residence: 12000,
    azure_condo: 35000,
    ocean_crest_villa: 95000,
  },
};
