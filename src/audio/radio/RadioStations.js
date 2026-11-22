import CATALOG from './radio-catalog.json' with { type: 'json' };

/**
 * Registro das emissoras do NEON RADIO NETWORK (dados gerados por tools/radio/build-radio.mjs).
 * Cada emissora: id, nome, frequência, gênero, cores, DJ, biblioteca (músicas, falas,
 * vinhetas) e regras de programação. Inclui o logotipo ORIGINAL em SVG (identidade Neon City).
 */
export const RADIO_OFF = { id: 'off', name: 'RADIO OFF', freq: '', genre: 'Rádio desligado', colors: ['#9aa0b5', '#3a3f55'] };

const byStation = (list) => {
  const m = new Map();
  for (const e of list) { if (!m.has(e.station)) m.set(e.station, []); m.get(e.station).push(e); }
  return m;
};
const TR = byStation(CATALOG.tracks), VO = byStation(CATALOG.voice), JI = byStation(CATALOG.jingles), ST = byStation(CATALOG.stings);

/** Regras por emissora: frequência de intervalos, falas e vinhetas. */
const RULES = {
  neon_fm: { adsEvery: [2, 3], talk: 0.45, jingle: 0.35, overlay: 0.6, volume: 1 },
  groove: { adsEvery: [2, 3], talk: 0.5, jingle: 0.4, overlay: 0.7, volume: 0.95 },
  thunder_rock: { adsEvery: [2, 3], talk: 0.45, jingle: 0.4, overlay: 0.6, volume: 0.9 },
  street_beat: { adsEvery: [2, 3], talk: 0.5, jingle: 0.4, overlay: 0.6, volume: 0.92 },
  ocean_breeze: { adsEvery: [3, 4], talk: 0.4, jingle: 0.3, overlay: 0.55, volume: 1 },
  tropical: { adsEvery: [2, 3], talk: 0.5, jingle: 0.4, overlay: 0.7, volume: 0.95 },
  city_talk: { adsEvery: [3, 4], talk: 1, jingle: 0.3, overlay: 0, volume: 1 },
  midnight_jazz: { adsEvery: [3, 4], talk: 0.4, jingle: 0.3, overlay: 0.5, volume: 1 },
};

export const STATIONS = CATALOG.stations.map((s) => ({
  ...s,
  tracks: TR.get(s.id) || [],
  voice: VO.get(s.id) || [],
  jingles: JI.get(s.id) || [],
  stings: ST.get(s.id) || [],
  rules: RULES[s.id] || RULES.neon_fm,
  talkFormat: s.style === 'talk',
}));
export const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
export const ADS = CATALOG.ads;
export const NEWS = CATALOG.news;
export const LEADS = CATALOG.leads;
export const TALKS = CATALOG.talks;
export const LICENSES = CATALOG.licenses;
export { CATALOG };

/** Ordem da roleta: as oito emissoras + RADIO OFF. */
export const DIAL = [...STATIONS.map((s) => s.id), 'off'];

// ------------------------------------------------------------------ logotipos (SVG original)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const MOTIF = {
  synthwave: (a, b) => `<circle cx="50" cy="44" r="20" fill="url(#g)"/>${[0, 1, 2, 3].map((i) => `<rect x="28" y="${46 + i * 5}" width="44" height="${2 + i * 0.4}" fill="#14061f"/>`).join('')}<path d="M18 66 L50 52 L82 66" stroke="${b}" stroke-width="1.5" fill="none"/>`,
  disco: (a, b) => `<circle cx="50" cy="44" r="18" fill="url(#g)"/>${[-12, -4, 4, 12].map((y) => `<line x1="32" y1="${44 + y}" x2="68" y2="${44 + y}" stroke="#14061f" stroke-width="1.2"/>`).join('')}${[-12, -4, 4, 12].map((x) => `<line x1="${50 + x}" y1="27" x2="${50 + x}" y2="61" stroke="#14061f" stroke-width="1.2"/>`).join('')}<line x1="50" y1="14" x2="50" y2="26" stroke="${b}" stroke-width="2"/>`,
  rock: (a, b) => `<path d="M56 18 L36 48 L50 48 L42 72 L66 38 L52 38 Z" fill="url(#g)" stroke="${b}" stroke-width="1.5"/>`,
  electro: (a, b) => `<rect x="24" y="30" width="52" height="30" rx="5" fill="url(#g)"/><circle cx="37" cy="45" r="8" fill="#14061f"/><circle cx="63" cy="45" r="8" fill="#14061f"/><rect x="44" y="34" width="12" height="5" fill="#14061f"/><path d="M30 30 Q50 18 70 30" stroke="${b}" stroke-width="2" fill="none"/>`,
  soft: (a, b) => `<circle cx="50" cy="40" r="15" fill="url(#g)"/><path d="M18 56 Q30 48 42 56 T66 56 T90 56" stroke="${b}" stroke-width="3" fill="none"/><path d="M14 64 Q26 56 38 64 T62 64 T86 64" stroke="${a}" stroke-width="2" fill="none" opacity="0.8"/>`,
  latin: (a, b) => `<circle cx="64" cy="34" r="11" fill="url(#g)"/><path d="M40 72 Q42 48 38 30" stroke="${b}" stroke-width="3" fill="none"/>${[-60, -20, 20, 60, 100].map((d) => `<path d="M38 30 q${Math.cos(d * Math.PI / 180) * 18} ${Math.sin(d * Math.PI / 180) * 10 - 6} ${Math.cos(d * Math.PI / 180) * 24} ${Math.sin(d * Math.PI / 180) * 16}" stroke="${b}" stroke-width="3" fill="none"/>`).join('')}`,
  talk: (a, b) => `<rect x="42" y="18" width="16" height="30" rx="8" fill="url(#g)"/><path d="M34 40 Q34 58 50 58 Q66 58 66 40" stroke="${b}" stroke-width="3" fill="none"/><line x1="50" y1="58" x2="50" y2="68" stroke="${b}" stroke-width="3"/>`,
  jazz: (a, b) => `<path d="M60 22 a18 18 0 1 0 8 32 a14 14 0 1 1 -8 -32 z" fill="url(#g)"/><circle cx="38" cy="58" r="5" fill="${b}"/><line x1="43" y1="58" x2="43" y2="32" stroke="${b}" stroke-width="2.5"/><path d="M43 32 q8 2 10 10" stroke="${b}" stroke-width="2.5" fill="none"/>`,
  off: (a, b) => `<circle cx="50" cy="44" r="20" fill="none" stroke="${a}" stroke-width="5"/><line x1="36" y1="58" x2="64" y2="30" stroke="${a}" stroke-width="5"/>`,
};

/** Logotipo da emissora (SVG em string). */
export function stationLogo(id) {
  const s = id === 'off' ? RADIO_OFF : STATION_BY_ID.get(id);
  if (!s) return '';
  const [a, b] = s.colors;
  const motif = (MOTIF[s.style] || MOTIF.off)(a, b);
  const label = id === 'off' ? 'OFF' : s.name;
  const fs = label.length > 12 ? 8.5 : label.length > 8 ? 10 : 12;
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`
    + `<circle cx="50" cy="50" r="47" fill="#0d0718" stroke="${a}" stroke-width="3"/>${motif}`
    + `<text x="50" y="${id === 'off' ? 82 : 84}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-style="italic" font-size="${fs}" fill="#fff" stroke="${a}" stroke-width="0.6">${esc(label)}</text>`
    + (s.freq ? `<text x="50" y="94" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="7.5" fill="${b}">${esc(s.freq)} FM</text>` : '')
    + `</svg>`;
}
