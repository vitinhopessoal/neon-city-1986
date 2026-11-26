/**
 * Definições das armas do jogo (dados de jogabilidade, não especificações reais).
 *
 * Valores de dano, cadência, alcance, dispersão e capacidade foram escolhidos
 * para equilíbrio e sensação de jogo; não reproduzem dados técnicos. Os
 * modelos 3D (WeaponModels.js) são representações visuais estilizadas,
 * apenas da silhueta externa.
 *
 * Campos:
 *   category     'pistol' | 'shotgun' | 'compact' | 'carbine' (munição compartilhada) | 'melee'
 *   hold         'pistol' (uma mão + apoio) | 'long' (duas mãos, coronha) | 'knife'
 *   mode         'semi' | 'auto' | 'pump' | 'melee' (golpe: range = alcance, hitDelay = contato)
 *   rpm          cadência máxima (disparos por minuto)
 *   damage       dano por projétil; pellets = projéteis por disparo
 *   range        alcance útil (m); o dano cai até 40% entre falloff e range
 *   spread       dispersão base (rad); aimSpread ao mirar; bloom por disparo
 *   recoil       intensidade visual do recuo (câmera e arma)
 *   mag          capacidade do carregador (fictícia); reserveStart munição inicial
 *   reload       duração da recarga (s); shotgun recarrega cartucho a cartucho
 *   sound        perfil sonoro (WeaponAudio)
 *   viewmodel    posição da arma em 1ª pessoa (x, y, z) e na mira
 *   history      nota de coerência histórica (1986)
 */
export const AMMO_TYPES = {
  pistol: { label: 'PISTOLA', max: 180 },
  shotgun: { label: 'ESCOPETA', max: 48 },
  compact: { label: 'COMPACTA', max: 300 },
  carbine: { label: 'CARABINA', max: 240 },
  melee: { label: 'CORPO A CORPO', max: 0 },
};

export const WEAPONS = [
  {
    id: 'brenten', slot: 1, name: 'BREN TEN', category: 'pistol', hold: 'pistol', mode: 'semi',
    rpm: 300, damage: 34, pellets: 1, range: 70, falloff: 25,
    spread: 0.018, aimSpread: 0.004, bloom: 0.012, recoil: 0.75,
    mag: 10, reserveStart: 60, reload: 1.5,
    sound: { body: 150, crack: 2600, decay: 0.32, gain: 0.85 },
    viewmodel: { hip: [0.17, -0.2, -0.46], aim: [0, -0.072, -0.36] },
    history: 'Produzida por Dornaus & Dixon entre 1983 e 1986: coerente com 1986.',
  },
  {
    id: 'sw645', slot: 2, name: 'S&W 645', category: 'pistol', hold: 'pistol', mode: 'semi',
    rpm: 330, damage: 28, pellets: 1, range: 65, falloff: 22,
    spread: 0.015, aimSpread: 0.0035, bloom: 0.01, recoil: 0.65,
    mag: 8, reserveStart: 56, reload: 1.45,
    sound: { body: 135, crack: 2300, decay: 0.3, gain: 0.82 },
    viewmodel: { hip: [0.15, -0.15, -0.34], aim: [0, -0.072, -0.3] },
    history: 'Modelo 645 lançado em 1985: coerente com 1986.',
  },
  {
    id: 'sw4503', slot: 3, name: 'S&W 4503', category: 'pistol', hold: 'pistol', mode: 'semi',
    rpm: 340, damage: 26, pellets: 1, range: 60, falloff: 22,
    spread: 0.013, aimSpread: 0.003, bloom: 0.008, recoil: 0.5,
    mag: 8, reserveStart: 56, reload: 1.35,
    sound: { body: 140, crack: 2450, decay: 0.27, gain: 0.78 },
    viewmodel: { hip: [0.15, -0.15, -0.33], aim: [0, -0.07, -0.29] },
    history: 'DIVERGÊNCIA: a série 4500 de 3ª geração da S&W só chegou ao mercado por volta de 1988–1989 '
      + '(não foi encontrada confirmação de um "4503" em 1986). Mantido como pedido; alternativa de época: S&W 469 ou 659 (2ª geração, início dos anos 80).',
  },
  {
    id: 'ithaca37', slot: 4, name: 'ITHACA 37 STAKEOUT', category: 'shotgun', hold: 'long', mode: 'pump',
    rpm: 70, damage: 14, pellets: 8, range: 32, falloff: 8,
    spread: 0.075, aimSpread: 0.06, bloom: 0.0, recoil: 1.6,
    mag: 5, reserveStart: 30, reload: 0.55, reloadPerRound: true,
    sound: { body: 85, crack: 1500, decay: 0.55, gain: 1.0 },
    viewmodel: { hip: [0.14, -0.15, -0.36], aim: [0, -0.085, -0.32] },
    history: 'Versão "Stakeout" (cano curto, sem coronha) disponível no início dos anos 80: coerente com 1986.',
  },
  {
    id: 'mac10', slot: 5, name: 'MAC-10', category: 'compact', hold: 'pistol', mode: 'auto',
    rpm: 900, damage: 13, pellets: 1, range: 40, falloff: 14,
    spread: 0.035, aimSpread: 0.02, bloom: 0.006, recoil: 0.45, maxBloom: 0.08,
    mag: 30, reserveStart: 150, reload: 1.7,
    sound: { body: 120, crack: 2100, decay: 0.18, gain: 0.7 },
    viewmodel: { hip: [0.14, -0.15, -0.33], aim: [0, -0.075, -0.29] },
    history: 'Projeto de 1970: coerente com 1986.',
  },
  {
    id: 'mac11', slot: 6, name: 'MAC-11', category: 'compact', hold: 'pistol', mode: 'auto',
    rpm: 1100, damage: 10, pellets: 1, range: 34, falloff: 12,
    spread: 0.04, aimSpread: 0.024, bloom: 0.007, recoil: 0.38, maxBloom: 0.09,
    mag: 32, reserveStart: 160, reload: 1.55,
    sound: { body: 150, crack: 2800, decay: 0.14, gain: 0.62 },
    viewmodel: { hip: [0.14, -0.15, -0.32], aim: [0, -0.072, -0.28] },
    history: 'Variante compacta dos anos 70: coerente com 1986.',
  },
  {
    id: 'kg99', slot: 7, name: 'KG-99', category: 'compact', hold: 'pistol', mode: 'semi',
    rpm: 360, damage: 19, pellets: 1, range: 50, falloff: 18,
    spread: 0.02, aimSpread: 0.006, bloom: 0.01, recoil: 0.5,
    mag: 20, reserveStart: 100, reload: 1.6,
    sound: { body: 130, crack: 2500, decay: 0.24, gain: 0.72 },
    viewmodel: { hip: [0.14, -0.15, -0.35], aim: [0, -0.075, -0.31] },
    history: 'Versão semiautomática comercializada em meados dos anos 80: coerente com 1986. Não é uma variante automática.',
  },
  {
    id: 'colt653', slot: 8, name: 'COLT CARBINE A1', category: 'carbine', hold: 'long', mode: 'auto',
    rpm: 720, damage: 24, pellets: 1, range: 110, falloff: 45,
    spread: 0.012, aimSpread: 0.0025, bloom: 0.004, recoil: 0.7, maxBloom: 0.05,
    mag: 30, reserveStart: 120, reload: 2.1,
    sound: { body: 110, crack: 3400, decay: 0.42, gain: 0.9 },
    viewmodel: { hip: [0.13, -0.16, -0.32], aim: [0, -0.098, -0.24] },
    history: 'Inspirada na família de carabinas Colt de coronha retrátil e guarda-mão triangular do início dos anos 80 (linha do "Model 653"). Nomenclatura exata documentada como aproximada.',
  },
  {
    id: 'coltsporter', slot: 8, name: 'COLT SPORTER CARBINE', category: 'carbine', hold: 'long', mode: 'semi',
    rpm: 420, damage: 32, pellets: 1, range: 130, falloff: 60,
    spread: 0.008, aimSpread: 0.0015, bloom: 0.006, recoil: 0.75,
    mag: 20, reserveStart: 100, reload: 2.0,
    sound: { body: 105, crack: 3200, decay: 0.45, gain: 0.88 },
    viewmodel: { hip: [0.13, -0.16, -0.32], aim: [0, -0.098, -0.24] },
    history: 'Inspirada nas carabinas civis semiautomáticas "Sporter" da Colt vendidas em meados dos anos 80. Nomenclatura exata documentada como aproximada.',
  },
];

// Faca (corpo a corpo): sem munição; o golpe usa a animação "Stabbing".
WEAPONS.push({
  id: 'knife', slot: 9, name: 'FACA', category: 'melee', hold: 'knife', mode: 'melee',
  rpm: 70, damage: 60, pellets: 1, range: 1.9, falloff: 1.9, hitDelay: 0.3,
  spread: 0, aimSpread: 0, bloom: 0, recoil: 0,
  mag: 1, reserveStart: 0, reload: 0,
  sound: null,
  viewmodel: { hip: [0.2, -0.2, -0.4], aim: [0.14, -0.17, -0.36] },
  history: 'Faca de combate genérica de lâmina fixa, comum nos anos 80.',
});

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
