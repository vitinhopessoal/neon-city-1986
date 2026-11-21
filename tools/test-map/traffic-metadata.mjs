/**
 * Metadados OPCIONAIS de trânsito para o TEST CITY (manifest.json):
 * ruas (eixos do grid), cruzamentos com placa PARE e faixas de pedestres.
 * O modelo 3D importado não é alterado; manifestos antigos sem estes campos
 * continuam válidos (o trânsito simplesmente não é ativado).
 *
 * Uso direto (só atualiza o manifesto existente):
 *   node tools/test-map/traffic-metadata.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function trafficMetadata({ streets = [-100, -50, 0, 50, 100], bound = 108 } = {}) {
  const end = bound - 4;
  const road = (id, start, endP) => ({ id, name: id.toUpperCase(), start, end: endP, lanesPerDirection: 1, laneWidth: 3.4, medianWidth: 0.4, parkingWidth: 0, speedLimit: 10 });
  const roads = [];
  for (const s of streets) {
    roads.push(road(`x${s}`, { x: -end, z: s }, { x: end, z: s })); // rua ao longo de X (z = s)
    roads.push(road(`z${s}`, { x: s, z: -end }, { x: s, z: end })); // rua ao longo de Z (x = s)
  }
  const intersections = [];
  for (const sx of streets) for (const sz of streets) {
    intersections.push({ id: `tc_${sx}_${sz}`, x: sx, z: sz, roads: [`x${sz}`, `z${sx}`], control: 'stop', radius: 6 });
  }
  // Faixas de pedestres nos cruzamentos internos (uma em cada acesso).
  const crosswalks = [];
  const inner = streets.filter((s) => Math.abs(s) < bound - 20);
  for (const sx of inner) for (const sz of inner) {
    for (const d of [-8.5, 8.5]) {
      crosswalks.push({ id: `cw_x${sz}_${sx}_${d > 0 ? 'e' : 'w'}`, roadId: `x${sz}`, t: sx + end + d, length: 3.2 });
      crosswalks.push({ id: `cw_z${sx}_${sz}_${d > 0 ? 's' : 'n'}`, roadId: `z${sx}`, t: sz + end + d, length: 3.2 });
    }
  }
  return { roads, intersections, crosswalks };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dev-maps', 'test-city', 'manifest.json');
  const m = JSON.parse(readFileSync(file, 'utf8'));
  Object.assign(m, trafficMetadata({ bound: m.bounds?.maxX ?? 108 }));
  writeFileSync(file, JSON.stringify(m, null, 2));
  console.log(`Manifesto atualizado: ${m.roads.length} ruas, ${m.intersections.length} cruzamentos, ${m.crosswalks.length} faixas de pedestres.`);
}
