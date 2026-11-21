import { SAVE_VERSION } from './SaveSchema.js';

/**
 * Migrações entre versões do esquema. Cada entrada converte da versão N para
 * N+1 e devolve um objeto NOVO (o original nunca é alterado nem apagado).
 * Formatos desconhecidos não são "adivinhados": retornam erro e o slot é
 * preservado intacto no armazenamento.
 */
const MIGRATIONS = {
  // 1: (s) => ({ ...s, saveVersion: 2, novoCampo: padrão }),
};

export function migrateSave(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'conteúdo vazio ou corrompido' };
  let v = raw.saveVersion;
  if (!Number.isSafeInteger(v)) return { ok: false, error: 'formato desconhecido (sem saveVersion)' };
  if (v > SAVE_VERSION) return { ok: false, error: `salvamento de uma versão mais nova do jogo (v${v})` };
  let s = raw;
  const applied = [];
  while (v < SAVE_VERSION) {
    const fn = MIGRATIONS[v];
    if (!fn) return { ok: false, error: `sem migração conhecida da versão ${v}` };
    s = fn(structuredClone(s));
    applied.push(`${v}→${v + 1}`);
    v = s.saveVersion;
  }
  return { ok: true, save: s, applied };
}
