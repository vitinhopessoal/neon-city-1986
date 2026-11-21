/**
 * Catálogo de itens não-arma (roupas, chaves, objetos, especiais). Armas e
 * munição usam os identificadores reais do arsenal (WeaponDefinitions).
 * As roupas e eletrônicos vendidos nos estabelecimentos (PROMPT 06) usam os
 * mesmos ids aqui.
 */
export const CATEGORIES = {
  weapons: 'ARMAS', ammo: 'MUNIÇÃO', clothes: 'ROUPAS', keys: 'CHAVES', items: 'OBJETOS', special: 'ITENS ESPECIAIS',
};

export const CLOTHES = {
  traje_padrao: { label: 'Traje de sempre (paletó pastel e camiseta)', model: 'glb' },
  jaqueta_pastel: { label: 'Jaqueta pastel de linho' },
  camisa_havaiana: { label: 'Camisa estampada de palmeiras' },
  oculos_aviador: { label: 'Óculos de sol aviador' },
  tenis_branco: { label: 'Tênis branco de lona' },
};

export const ITEMS = {
  walkman: { label: 'Toca-fitas portátil "Volt Walk"' },
  boombox: { label: 'Rádio portátil "Coastline 2000"' },
  vcr: { label: 'Videocassete "Nova VX-4"' },
  telefone: { label: 'Telefone sem fio "Breeze"' },
  vector64: { label: 'Computador doméstico "Vector 64"' },
  fita: { label: 'Fita cassete virgem C-60' },
  pilhas: { label: 'Pilhas Volt (4 un.)' },
  protetor: { label: 'Protetor solar FPS 15' },
};

/** Chaves de imóveis: key_<id da propriedade>. */
export const keyLabel = (propName) => `Chave — ${propName}`;
