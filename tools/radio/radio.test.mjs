import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CATALOG, STATIONS, ADS, NEWS, TALKS, DIAL, stationLogo } from '../../src/audio/radio/RadioStations.js';
import { RadioScheduler } from '../../src/audio/radio/RadioScheduler.js';

const files = () => [...CATALOG.tracks, ...CATALOG.voice, ...CATALOG.jingles, ...CATALOG.ads, ...CATALOG.news, ...CATALOG.leads, ...CATALOG.talks, ...CATALOG.stings];
const clock = () => { const c = { t: 0 }; c.now = () => c.t; return c; };

test('catálogo: oito emissoras + OFF, arquivos reais, durações e licenças', () => {
  assert.equal(STATIONS.length, 8);
  assert.equal(DIAL.length, 9);
  assert.ok(DIAL.includes('off'));
  for (const e of files()) {
    assert.ok(existsSync(join('public', e.file)), `arquivo ${e.file}`);
    assert.ok(e.duration > 0.3, `duração ${e.file}`);
    assert.ok(e.license && e.license.length > 20, `licença ${e.file}`);
  }
  for (const s of STATIONS) {
    if (s.talkFormat) continue;
    assert.ok(s.tracks.length >= 4, `${s.name}: músicas`);
    assert.ok(s.voice.filter((v) => v.kind === 'intro').length === s.tracks.length, `${s.name}: apresentação de cada faixa`);
    assert.ok(new Set(s.voice.map((v) => v.text)).size >= 25, `${s.name}: falas variadas`);
    assert.ok(s.jingles.length >= 3, `${s.name}: vinhetas`);
    assert.ok(stationLogo(s.id).startsWith('<svg'), 'logotipo');
  }
  assert.ok(ADS.length >= 12 && NEWS.length >= 20 && TALKS.length >= 6);
});

test('catálogo: duração registrada confere com o arquivo (ffprobe), amostra por emissora', { skip: !process.env.LOCALAPPDATA }, () => {
  const fp = join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-9.0.2-full_build', 'bin', 'ffprobe.exe');
  if (!existsSync(fp)) return;
  for (const s of STATIONS) {
    const e = s.tracks[0] || s.jingles[0];
    const d = +execFileSync(fp, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join('public', e.file)]).toString().trim();
    assert.ok(Math.abs(d - e.duration) < 0.05, `${e.file}: ${d} vs ${e.duration}`);
  }
});

test('continuidade: a emissora segue no tempo real (não recomeça ao voltar) e não depende do relógio acelerado', () => {
  const c = clock();
  const S = new RadioScheduler({ now: c.now });
  S.reset(42);
  const a = S.current('neon_fm');
  const offA = S.now() - a.start;
  c.t += 1000 * 60; // um minuto
  const b = S.current('neon_fm');
  if (b === a) assert.ok(Math.abs((S.now() - b.start) - (offA + 60)) < 1e-6, 'mesma faixa, 60 s adiante');
  c.t += 1000 * 300; // mais cinco minutos fora do carro
  const d = S.current('neon_fm');
  assert.ok(d.start > a.start, 'em outro ponto da programação');
  // Começa no meio, não do zero.
  const fresh = new RadioScheduler({ now: c.now });
  fresh.reset(7);
  const f = fresh.current('groove');
  assert.ok(fresh.now() - f.start > 0, 'nova partida começa no meio de um segmento');
});

test('programação: 3 horas por emissora sem repetir faixa seguida, com DJ, vinhetas e comerciais', () => {
  const c = clock();
  const S = new RadioScheduler({ now: c.now });
  S.logCap = 10000;
  S.reset(99);
  c.t += 3 * 3600 * 1000;
  for (const st of STATIONS) S.current(st.id);
  for (const st of STATIONS) {
    const log = S.log.filter((l) => l.station === st.id);
    assert.ok(log.length > 40, `${st.name}: ${log.length} segmentos em 3 h`);
    const kinds = new Set(log.map((l) => l.k));
    assert.ok(kinds.has('ad') && kinds.has('jingle') && kinds.has('voice'), `${st.name}: ${[...kinds]}`);
    if (!st.talkFormat) {
      assert.ok(kinds.has('track'));
      const tracks = log.filter((l) => l.k === 'track').map((l) => l.id);
      for (let i = 1; i < tracks.length; i++) assert.notEqual(tracks[i], tracks[i - 1], `${st.name}: faixa repetida em seguida`);
      // Comercial nunca interrompe música: só começa quando o segmento anterior termina (sequencial).
      for (let i = 1; i < log.length; i++) assert.ok(Math.abs(log[i].start - (log[i - 1].start + log[i - 1].dur)) < 0.02, 'segmentos encadeados (início registrado com 2 casas)');
    } else {
      assert.ok(kinds.has('news') && kinds.has('talk'), 'CITY TALK com notícias e programas');
    }
  }
});

test('notícias: evento real vira notícia na CITY TALK após o atraso editorial, sem repetir em sequência', () => {
  const c = clock();
  const S = new RadioScheduler({ now: c.now });
  S.reset(5);
  const t0 = S.now();
  assert.ok(S.enqueue('city_talk', { type: 'news', kind: 'chase', at: t0, readyAt: t0 + 40 }));
  assert.equal(S.enqueue('city_talk', { type: 'news', kind: 'chase', at: t0, readyAt: t0 + 40 }), false, 'não empilha a mesma notícia');
  S.enqueue('neon_fm', { type: 'react', kind: 'police', event: 'chase', at: t0, readyAt: t0 + 8 });
  c.t += 15 * 60 * 1000;
  S.current('city_talk'); S.current('neon_fm');
  const chase = S.log.find((l) => l.station === 'city_talk' && l.event === 'chase');
  assert.ok(chase, 'notícia da perseguição foi ao ar');
  assert.ok(chase.start >= t0 + 40, 'respeitou o atraso editorial');
  assert.ok(chase.id.startsWith('news_chase'), chase.id);
  const lead = S.log[S.log.indexOf(chase) - 1];
  assert.equal(lead.k, 'lead', 'chamada de plantão antes da notícia');
  assert.ok(S.log.some((l) => l.station === 'neon_fm' && l.event === 'chase'), 'DJ reagiu à perseguição');
  const news = S.log.filter((l) => l.station === 'city_talk' && l.k === 'news').map((l) => l.id);
  for (let i = 1; i < news.length; i++) assert.notEqual(news[i], news[i - 1]);
});

test('persistência: salvar e carregar mantém a emissora no mesmo ponto', () => {
  const c = clock();
  const S = new RadioScheduler({ now: c.now });
  S.reset(11);
  c.t += 777000;
  const before = Object.fromEntries(STATIONS.map((s) => { const seg = S.current(s.id); return [s.id, { id: seg.id, off: S.now() - seg.start }]; }));
  const data = JSON.parse(JSON.stringify(S.serialize()));
  assert.ok(!JSON.stringify(data).includes('AudioNode'));
  const c2 = clock(); c2.t = 99999999;
  const R = new RadioScheduler({ now: c2.now });
  R.reset(1);
  assert.ok(R.deserialize(data));
  for (const s of STATIONS) {
    const seg = R.current(s.id);
    assert.equal(seg.id, before[s.id].id, `${s.id}: mesmo segmento`);
    assert.ok(Math.abs((R.now() - seg.start) - before[s.id].off) < 1e-3, `${s.id}: mesmo ponto`);
  }
});
