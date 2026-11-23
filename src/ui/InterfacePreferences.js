export const INTERFACE_DEFAULTS = Object.freeze({ sensitivity: 50, invertY: false, northUp: false, zoom: 1, helpSize: 'normal', colorBlind: 'off', highContrast: false, reduceMotion: false });
const KEY = 'neoncity.interface.preferences';
export function sanitizePreferences(raw = {}) {
  const value = { ...INTERFACE_DEFAULTS };
  if (!raw || typeof raw !== 'object') return value;
  for (const key of ['invertY', 'northUp', 'highContrast', 'reduceMotion']) if (typeof raw[key] === 'boolean') value[key] = raw[key];
  for (const [key, min, max] of [['sensitivity', 5, 100], ['zoom', 0.5, 2]]) if (Number.isFinite(raw[key])) value[key] = Math.max(min, Math.min(max, raw[key]));
  if (['small', 'normal', 'large'].includes(raw.helpSize)) value.helpSize = raw.helpSize;
  if (['off', 'contrast'].includes(raw.colorBlind)) value.colorBlind = raw.colorBlind;
  return value;
}
export function loadInterfacePreferences() {
  try { return sanitizePreferences(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return { ...INTERFACE_DEFAULTS }; }
}
export function saveInterfacePreferences(value) {
  try { localStorage.setItem(KEY, JSON.stringify(sanitizePreferences(value))); } catch { /* storage may be unavailable */ }
}
