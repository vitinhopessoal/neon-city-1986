import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parsePedStats(text) {
  const result = {};
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const fields = line.split('#')[0].trim().split(/\s+/);
    if (!fields[0]?.startsWith('STAT_')) continue;
    const values = fields.slice(1).map(Number);
    if (values.length !== 9 || values.some(v => !Number.isFinite(v))) throw new Error(`Invalid pedstat: ${fields[0]}`);
    const [fleeDistance, headingRate, fear, temper, lawfulness, unusedAppeal, attack, defense, flags] = values;
    result[fields[0]] = { fleeDistance, headingRate, fear, temper, lawfulness, attack, defense, flags };
  }
  if (!Object.keys(result).length) throw new Error('No pedstats found');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output = 'src/city/data/PedStats.js'] = process.argv.slice(2);
  if (!input) throw new Error('Pass the extracted data/pedstats.dat as input');
  const bytes = readFileSync(input);
  const stats = parsePedStats(bytes.toString('utf8'));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `// Converted from the user-supplied Vice City data/pedstats.dat.\n// Parameter data only; no engine or decision-making code is contained here.\nexport const PED_STATS_SOURCE_SHA256 = '${createHash('sha256').update(bytes).digest('hex')}';\nexport const PED_STATS = ${JSON.stringify(stats, null, 2)};\n`);
  console.log(`Converted ${Object.keys(stats).length} pedestrian profiles`);
}
