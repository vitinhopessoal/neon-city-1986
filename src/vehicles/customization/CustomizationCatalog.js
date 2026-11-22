/**
 * Catálogo NEON CUSTOMS (peças e serviços fictícios, preços ajustáveis).
 * Cada opção: id estável, categoria, nome, descrição, preço, compatibilidade
 * (tipos de veículo), parâmetros visuais e/ou mecânicos. Nada aqui guarda
 * objetos Three.js — só dados.
 *
 * Tipos de veículo existentes: sports (NEON GT), convertible (SUNSET CLASSIC),
 * sedan (PALM SEDAN). Peças sem `types` servem a todos (e a modelos futuros).
 * Os nove modelos da NEON MOTOR COMPANY (PROMPT 12) herdam a compatibilidade
 * da sua família (sports / sedan / convertible) definida em neon-motor-specs.json.
 */
import { NEON_FAMILY } from '../models/NeonMotor.js';
import { MOTO_TYPES } from '../models/NeonMoto.js';

/**
 * Motos (PROMPT 15): só o que tem ponto de montagem no modelo — pintura e acabamento
 * (material próprio), faróis/lanternas (materiais próprios) e as melhorias mecânicas
 * (motor, freios, transmissão, suspensão, resistência). Rodas, pneus, altura, peças de
 * carroceria, película, interior e faixas ficam nas opções originais.
 */
const MOTO_SET = new Set(MOTO_TYPES);
export const BIKE_PART_CATS = new Set(['lights']);
export const isBikeType = (type) => MOTO_SET.has(type);

export const PAINTS = [
  { id: 'miami_white', name: 'Branco Miami', hex: 0xf2eee6 },
  { id: 'ocean_blue', name: 'Azul Oceano', hex: 0x1f5fa8 },
  { id: 'sunset_pink', name: 'Rosa Sunset', hex: 0xf06fa8 },
  { id: 'coral_red', name: 'Vermelho Coral', hex: 0xe0453a },
  { id: 'midnight_black', name: 'Preto Midnight', hex: 0x15151c },
  { id: 'tropical_yellow', name: 'Amarelo Tropical', hex: 0xf4c430 },
  { id: 'jade_green', name: 'Verde Jade', hex: 0x2f9a78 },
  { id: 'chrome_silver', name: 'Prata Chrome', hex: 0xc4c9d1 },
  { id: 'neon_violet', name: 'Violeta Neon', hex: 0x8a4fff },
  { id: 'classic_beige', name: 'Bege Clássico', hex: 0xd9c49a },
];

export const FINISHES = {
  gloss: { name: 'Sólida brilhante', price: 250, material: { metalness: 0.1, roughness: 0.22, clearcoat: 1.0, clearcoatRoughness: 0.08, iridescence: 0 } },
  metallic: { name: 'Metálica', price: 500, material: { metalness: 0.75, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.12, iridescence: 0 } },
  pearl: { name: 'Perolizada', price: 750, material: { metalness: 0.45, roughness: 0.25, clearcoat: 1.0, clearcoatRoughness: 0.05, iridescence: 0.85 } },
  matte: { name: 'Fosca', price: 400, material: { metalness: 0.1, roughness: 0.82, clearcoat: 0, clearcoatRoughness: 1, iridescence: 0 } },
};

const ALL = null;
const opt = (id, name, price, desc, extra = {}) => ({ id, name, price, desc, types: ALL, ...extra });

/** Categorias de peças com opção 'stock' (original) sempre gratuita e compatível. */
export const PARTS = {
  wheels: {
    label: 'Rodas', options: [
      opt('stock', 'Originais', 0, 'Rodas de fábrica do modelo.'),
      opt('fivespoke', 'Esportiva de cinco raios', 700, 'Cinco raios largos em liga leve polida.', { rim: { style: 'fivespoke', finish: 'alloy' } }),
      opt('multispoke', 'Multirraios', 750, 'Doze raios finos, visual de competição.', { rim: { style: 'multispoke', finish: 'alloy' } }),
      opt('disc', 'Disco aerodinâmico', 650, 'Calota fechada de corrida, branca.', { rim: { style: 'disc', finish: 'white' }, types: ['sports', 'sedan'] }),
      opt('chrome', 'Clássica cromada', 800, 'Raios cromados de estrada.', { rim: { style: 'classic', finish: 'chrome' } }),
      opt('mesh', 'Malha esportiva', 850, 'Malha cruzada dourada.', { rim: { style: 'mesh', finish: 'gold' }, types: ['sports', 'sedan'] }),
      opt('steel', 'Roda de aço estilizada', 400, 'Aço pintado com furos, simples e robusta.', { rim: { style: 'steel', finish: 'black' }, types: ['sedan', 'convertible'] }),
    ],
  },
  tires: {
    label: 'Pneus', options: [
      opt('stock', 'Convencional', 0, 'Pneu original.'),
      opt('sport', 'Esportivo', 450, 'Composto mais macio: +5% de aderência.', { tire: { width: 0.26, rimScale: 1.0 }, perf: { grip: 1.05, cornering: 1.04 } }),
      opt('lowpro', 'Perfil baixo', 550, 'Roda maior e flanco baixo: resposta mais rápida.', { tire: { width: 0.25, rimScale: 1.12 }, perf: { grip: 1.04, cornering: 1.06, steerSpeed: 1.05 }, types: ['sports', 'sedan'] }),
      opt('grip', 'Alta aderência', 650, 'Banda larga: +10% de aderência, um pouco mais lento.', { tire: { width: 0.29, rimScale: 1.0 }, perf: { grip: 1.1, cornering: 1.1, maxSpeed: 0.99 } }),
    ],
  },
  ride: {
    label: 'Altura', options: [
      opt('stock', 'Original', 0, 'Altura de fábrica.'),
      opt('low', 'Rebaixada', 900, '5 cm mais baixa: centro de gravidade menor.', { ride: -0.05, perf: { stability: 0.03 } }),
      opt('sport', 'Esportiva', 900, '3,5 cm mais baixa, curso firme.', { ride: -0.035, perf: { stability: 0.02 } }),
      opt('high', 'Elevada', 900, '5 cm mais alta (sedã).', { ride: 0.05, perf: { stability: -0.05 }, types: ['sedan'] }),
    ],
  },
  bumper: {
    label: 'Para-choques', options: [
      opt('stock', 'Original', 0, 'Para-choques de fábrica.'),
      opt('sport', 'Esportivo discreto', 800, 'Lábio dianteiro e saia traseira na cor do carro.', { part: 'bumperSport' }),
      opt('aero', 'Aerodinâmico', 950, 'Splitter largo, defletores laterais e difusor.', { part: 'bumperAero', types: ['sports', 'sedan'] }),
      opt('retro', 'Retrô personalizado', 850, 'Barra cromada com faróis de neblina redondos.', { part: 'bumperRetro', types: ['convertible', 'sedan'] }),
    ],
  },
  skirts: {
    label: 'Saias laterais', options: [
      opt('stock', 'Original', 0, 'Sem saias.'),
      opt('sport', 'Esportiva', 550, 'Saia fina na cor do carro.', { part: 'skirtSport' }),
      opt('aero', 'Aerodinâmica', 700, 'Saia larga com entrada de ar.', { part: 'skirtAero', types: ['sports', 'sedan'] }),
    ],
  },
  spoiler: {
    label: 'Aerofólio', options: [
      opt('none', 'Sem aerofólio', 0, 'Tampa traseira limpa.'),
      opt('lip', 'Discreto', 450, 'Lábio sobre a tampa traseira.', { part: 'spoilerLip' }),
      opt('sport', 'Esportivo', 650, 'Asa média com pedestais: +4% de estabilidade.', { part: 'spoilerSport', perf: { stability: 0.04, maxSpeed: 0.995 }, types: ['sports', 'sedan'] }),
      opt('wing', 'Asa retrô', 900, 'Asa alta com placas laterais (anos 80).', { part: 'spoilerWing', perf: { stability: 0.06, maxSpeed: 0.99 }, types: ['sports'] }),
    ],
  },
  hood: {
    label: 'Capô', options: [
      opt('stock', 'Original', 0, 'Capô de fábrica.'),
      opt('sport', 'Esportivo', 600, 'Ressalto central elevado.', { part: 'hoodSport' }),
      opt('vents', 'Com entradas de ar', 700, 'Duas tomadas de ar estilizadas.', { part: 'hoodVents', types: ['sports', 'sedan'] }),
    ],
  },
  exhaust: {
    label: 'Escapamento', options: [
      opt('stock', 'Original', 0, 'Ponteira de fábrica.'),
      opt('sport', 'Esportivo simples', 450, 'Ponteira oval maior; ronco mais grave.', { part: 'exhaustSport', perf: { engine: 1.02, enginePitch: 0.95 } }),
      opt('dual', 'Duplo', 700, 'Duas ponteiras cromadas; ronco mais grave.', { part: 'exhaustDual', perf: { engine: 1.03, enginePitch: 0.9 } }),
    ],
  },
  lights: {
    label: 'Faróis e lanternas', options: [
      opt('stock', 'Original', 0, 'Lentes de fábrica.'),
      opt('sport', 'Esportivo fumê', 350, 'Lentes escurecidas, luz branca fria.', { lights: { head: 0xdfe8ff, headEmissive: 0xe8f0ff, tail: 0x3a0a10 } }),
      opt('amber', 'Âmbar retrô', 300, 'Luz dianteira âmbar e lanterna vermelho-vivo.', { lights: { head: 0xffd27a, headEmissive: 0xffc060, tail: 0xb0101a } }),
    ],
  },
  tint: {
    label: 'Película dos vidros', options: [
      opt('clear', 'Transparente', 200, 'Vidro claro.', { glass: { opacity: 0.25, color: 0x2a3a4a } }),
      opt('stock', 'Leve (original)', 0, 'Película de fábrica.', { glass: null }),
      opt('medium', 'Média', 250, 'Película média.', { glass: { opacity: 0.6, color: 0x121a24 } }),
      opt('dark', 'Escura', 350, 'Película escura (visibilidade interna preservada).', { glass: { opacity: 0.74, color: 0x080b10 } }),
    ],
  },
  interior: {
    label: 'Interior', options: [
      opt('stock', 'Original', 0, 'Bancos e painel de fábrica.'),
      opt('red', 'Couro vermelho', 500, 'Bancos vermelhos e painel preto.', { interior: { seat: 0xb0202a, dash: 0x1a1a1e } }),
      opt('tan', 'Couro caramelo', 500, 'Bancos caramelo e painel marrom.', { interior: { seat: 0xc08a50, dash: 0x3a2a20 } }),
      opt('blue', 'Azul Miami', 500, 'Bancos azuis e painel claro.', { interior: { seat: 0x2a5fb0, dash: 0xd8d4cc } }),
    ],
  },
};

/** Melhorias mecânicas por nível (0 = original). Multiplicadores sobre o manuseio de fábrica do MODELO. */
export const UPGRADES = {
  engine: { label: 'Motor', levels: [
    { name: 'Original', price: 0 },
    { name: 'Street', price: 1500, perf: { engine: 1.12, maxSpeed: 1.04 } },
    { name: 'Sport', price: 3000, perf: { engine: 1.25, maxSpeed: 1.08 } },
    { name: 'Performance', price: 4500, perf: { engine: 1.4, maxSpeed: 1.12 } },
  ] },
  brakes: { label: 'Freios', levels: [
    { name: 'Original', price: 0 },
    { name: 'Melhorado', price: 800, perf: { brake: 1.15 } },
    { name: 'Esportivo', price: 1200, perf: { brake: 1.3 } },
  ] },
  trans: { label: 'Transmissão', levels: [
    { name: 'Original', price: 0 },
    { name: 'Ajustada', price: 1000, perf: { engine: 1.04, gearing: 0.96 } },
    { name: 'Esportiva', price: 2000, perf: { engine: 1.08, gearing: 0.92 } },
  ] },
  susp: { label: 'Suspensão esportiva', levels: [
    { name: 'Original', price: 0 },
    { name: 'Firme', price: 900, perf: { roll: 0.8, pitch: 0.85, stability: 0.08, cornering: 1.04, steerSpeed: 1.05 } },
    { name: 'Competição', price: 1600, perf: { roll: 0.65, pitch: 0.7, stability: 0.15, cornering: 1.08, steerSpeed: 1.1 } },
  ] },
  armor: { label: 'Resistência', levels: [
    { name: 'Original', price: 0 },
    { name: 'Reforçada', price: 1200, perf: { resist: 0.85, mass: 40 } },
    { name: 'Blindagem leve', price: 2400, perf: { resist: 0.7, mass: 90 } },
  ] },
  // Mecânica veicular: o kit muda o ganho de torque e a duração do tanque (o motor e a tração
  // continuam limitando a força). Comprar ou sair da oficina enche o tanque. Só carros.
  nitro: { label: 'Nitro', carsOnly: true, levels: [
    { name: 'Garrafa de série', price: 0, nitro: { boost: 0.35, drain: 0.2 }, desc: '+35% de torque por 5 s de tanque cheio.' },
    { name: 'Kit Street', price: 1400, nitro: { boost: 0.5, drain: 0.16 }, desc: '+50% de torque por 6,3 s de tanque cheio.' },
    { name: 'Kit Competição', price: 3200, nitro: { boost: 0.7, drain: 0.13 }, desc: '+70% de torque por 7,7 s de tanque cheio; aquece mais o motor.' },
  ] },
};

export const REPAIR_PER_POINT = 3;
export const SECONDARY_PRICE = 300;

/** Configuração de fábrica (nada instalado). */
export function defaultConfig(vehicle) {
  const hex = vehicle?.appearance?.color ?? null;
  const paint = PAINTS.find((p) => p.hex === hex)?.id || null;
  return {
    paint, paintHex: hex, finish: 'gloss', paint2: null,
    wheels: 'stock', tires: 'stock', ride: 'stock', bumper: 'stock', skirts: 'stock', spoiler: 'none',
    hood: 'stock', exhaust: 'stock', lights: 'stock', tint: 'stock', interior: 'stock',
    engine: 0, brakes: 0, trans: 0, susp: 0, armor: 0, nitro: 0,
  };
}

export function partOption(cat, id) {
  return PARTS[cat]?.options.find((o) => o.id === id) || null;
}

/** Compatibilidade: tipo de veículo e regras entre peças. */
export function isCompatible(cat, id, type, cfg = {}) {
  if (cat === 'paint2') return type !== undefined && !MOTO_SET.has(type); // faixas: todos os carros (posição se adapta ao modelo)
  const o = partOption(cat, id);
  if (!o) return false;
  if (MOTO_SET.has(type) && !BIKE_PART_CATS.has(cat)) return o === PARTS[cat].options[0];
  if (o.types && !o.types.includes(type) && !o.types.includes(NEON_FAMILY[type])) return false;
  // Asa alta exige para-choque esportivo/aero (estética coerente) — regra simples documentada.
  if (cat === 'spoiler' && id === 'wing' && cfg.bumper === 'retro') return false;
  if (cat === 'bumper' && id === 'retro' && cfg.spoiler === 'wing') return false;
  return true;
}

/** Saneia uma configuração vinda de um save (ids desconhecidos → original). */
export function sanitizeConfig(raw, vehicle) {
  const base = defaultConfig(vehicle);
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };
  const type = vehicle?.type;
  if (PAINTS.some((p) => p.id === raw.paint)) out.paint = raw.paint;
  if (Number.isSafeInteger(raw.paintHex) && raw.paintHex >= 0 && raw.paintHex <= 0xffffff) out.paintHex = raw.paintHex;
  if (FINISHES[raw.finish]) out.finish = raw.finish;
  out.paint2 = PAINTS.some((p) => p.id === raw.paint2) && !MOTO_SET.has(type) ? raw.paint2 : null;
  for (const cat of Object.keys(PARTS)) if (partOption(cat, raw[cat]) && isCompatible(cat, raw[cat], type, raw)) out[cat] = raw[cat];
  for (const [k, u] of Object.entries(UPGRADES)) if (Number.isSafeInteger(raw[k]) && raw[k] >= 0 && raw[k] < u.levels.length && (!u.carsOnly || !MOTO_SET.has(type) || raw[k] === 0)) out[k] = raw[k];
  return out;
}
