// NEON RADIO NETWORK — gera a biblioteca de áudio do rádio (offline, sem rede).
//   node tools/radio/build-radio.mjs [--force] [--only=music|voice|jingles|ads|news|talk]
// Saídas: public/audio/radio/** (.ogg Opus) e src/audio/radio/radio-catalog.json (durações reais via ffprobe).
// Requer: ffmpeg/ffprobe (variável FFMPEG_DIR ou PATH) e Windows (vozes SAPI) para as falas.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { composeTrack, composeSting, composeBed } from './synth.mjs';
import { STATIONS, VOICES, ADS, NEWS, TALK, NEWS_LEAD } from './content.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUB = join(ROOT, 'public', 'audio', 'radio');
const TMP = join(tmpdir(), 'neon-radio-build');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
const CATALOG = join(ROOT, 'src', 'audio', 'radio', 'radio-catalog.json');
mkdirSync(TMP, { recursive: true });
mkdirSync(PUB, { recursive: true });

function findFfmpeg() {
  const cands = [process.env.FFMPEG_DIR, join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-9.0.2-full_build', 'bin')].filter(Boolean);
  for (const c of cands) if (existsSync(join(c, 'ffmpeg.exe'))) return { ff: join(c, 'ffmpeg.exe'), fp: join(c, 'ffprobe.exe') };
  return { ff: 'ffmpeg', fp: 'ffprobe' };
}
const { ff: FF, fp: FP } = findFfmpeg();
const ffmpeg = (args) => execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const duration = (file) => +(+execFileSync(FP, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()).toFixed(3);
/** Arquivo existente mas inválido (geração interrompida): apaga para gerar de novo. */
const valid = (file) => { if (!existsSync(file)) return false; try { return duration(file) > 0; } catch { rmSync(file, { force: true }); return false; } };
const rel = (f) => relative(join(ROOT, 'public'), f).replace(/\\/g, '/');
const ensureDir = (f) => mkdirSync(dirname(f), { recursive: true });

const LIC_MUSIC = 'Original NEON CITY: composição algorítmica (tools/radio/synth.mjs), criada para o projeto.';
const LIC_VOICE = 'Texto original NEON CITY; voz gerada localmente com a síntese de fala do Windows (Microsoft Maria/Zira Desktop). Uso no projeto; confirmar os termos da Microsoft antes de distribuição comercial.';
const prev = existsSync(CATALOG) ? JSON.parse(readFileSync(CATALOG, 'utf8')) : null;
const cat = { version: 1, generatedAt: new Date().toISOString(), licenses: { music: LIC_MUSIC, voice: LIC_VOICE }, stations: [], tracks: [], voice: [], jingles: [], ads: [], news: [], leads: [], talks: [], stings: [] };
const want = (k) => !ONLY || ONLY === k;
const seedOf = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

// ------------------------------------------------------------------ música
function wavToOgg(wavBuf, out, { kbps = 64, mono = false } = {}) {
  const w = join(TMP, 'tmp.wav');
  writeFileSync(w, wavBuf);
  ensureDir(out);
  ffmpeg(['-i', w, ...(mono ? ['-ac', '1'] : []), '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', out]);
}
for (const st of STATIONS) {
  cat.stations.push({ id: st.id, name: st.name, freq: st.freq, genre: st.genre, style: st.style, dj: st.dj, djName: st.djName, colors: st.colors, slogan: st.slogan });
  if (!st.tracks.length) continue;
  st.tracks.forEach((tr, i) => {
    const id = `${st.id}_t${i + 1}`;
    const out = join(PUB, st.id, 'music', `${id}.ogg`);
    let info = prev?.tracks.find((t) => t.id === id)?.meta;
    if (want('music') && (FORCE || !valid(out))) {
      const t0 = Date.now();
      const r = composeTrack(st.style, seedOf(id));
      info = { ...r.info, stats: r.mixer.stats() };
      wavToOgg(r.mixer.wav(), out, { kbps: 64 });
      console.log(`música ${id} ${info.seconds}s ${Date.now() - t0}ms`);
    }
    if (existsSync(out)) cat.tracks.push({ id, station: st.id, title: tr.title, artist: tr.artist, file: rel(out), duration: duration(out), license: LIC_MUSIC, meta: info });
  });
}

// ------------------------------------------------------------------ vozes (TTS)
const jobs = [];
const voiceItems = [];
function addVoice(id, persona, text, out, extra) {
  const P = VOICES[persona];
  jobs.push({ id, voice: P.voice, rate: P.rate, text });
  voiceItems.push({ id, persona, text, out, ...extra });
}
for (const st of STATIONS) {
  for (const [kind, list] of Object.entries(st.lines)) list.forEach((text, i) => addVoice(`${st.id}_${kind}_${i + 1}`, st.dj, text, join(PUB, st.id, 'voice', `${st.id}_${kind}_${i + 1}.ogg`), { group: 'voice', station: st.id, dj: st.dj, kind, index: i, track: kind === 'intro' ? `${st.id}_t${i + 1}` : undefined }));
  for (const [kind, list] of Object.entries(st.linesEn || {})) list.forEach((text, i) => addVoice(`${st.id}_${kind}_en${i + 1}`, `${st.dj}En`, text, join(PUB, st.id, 'voice', `${st.id}_${kind}_en${i + 1}.ogg`), { group: 'voice', station: st.id, dj: st.dj, kind, index: 100 + i, lang: 'en' }));
  st.ids.forEach((text, i) => addVoice(`${st.id}_id_${i + 1}`, 'announcer', text, null, { group: 'jingle', station: st.id, index: i }));
}
ADS.forEach((a) => addVoice(a.id, a.voice, a.text, null, { group: 'ad', ad: a }));
NEWS.forEach((n, i) => addVoice(`news_${n.kind}_${i + 1}`, 'frank', n.text, join(PUB, 'city_talk', 'news', `news_${n.kind}_${i + 1}.ogg`), { group: 'news', kind: n.kind }));
NEWS_LEAD.forEach((t, i) => addVoice(`news_lead_${i + 1}`, 'frank', t, join(PUB, 'city_talk', 'news', `news_lead_${i + 1}.ogg`), { group: 'lead' }));
TALK.forEach((tk) => tk.lines.forEach(([who, text], i) => addVoice(`${tk.id}_${i + 1}`, who, text, null, { group: 'talkline', talk: tk.id, order: i })));

const rawDir = join(TMP, 'tts');
if (want('voice') || want('jingles') || want('ads') || want('news') || want('talk')) {
  const todo = jobs.filter((j) => FORCE || !existsSync(join(rawDir, `${j.id}.wav`)));
  if (todo.length) {
    const jf = join(TMP, 'jobs.json');
    writeFileSync(jf, JSON.stringify(todo), 'utf8');
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'tools', 'radio', 'tts.ps1'), '-Jobs', jf, '-OutDir', rawDir]).toString();
    console.log(out.trim());
  }
}

/** Personas: tom (asetrate), ritmo preservado (atempo), equalização e compressão. */
function voiceFilter(persona) {
  const P = VOICES[persona];
  const p = P.pitch;
  const pitch = p !== 1 ? `asetrate=${Math.round(22050 * p)},aresample=22050,atempo=${(1 / p).toFixed(4)},` : '';
  const eq = {
    warm: 'highpass=f=90,lowpass=f=7800,equalizer=f=220:t=q:w=1:g=2',
    bright: 'highpass=f=110,lowpass=f=9000,equalizer=f=3000:t=q:w=1:g=3',
    gritty: 'highpass=f=120,lowpass=f=7000,equalizer=f=1800:t=q:w=1:g=4',
    news: 'highpass=f=120,lowpass=f=7500,equalizer=f=2500:t=q:w=1:g=2',
    promo: 'highpass=f=80,lowpass=f=9500,equalizer=f=150:t=q:w=1:g=3',
    phone: 'highpass=f=320,lowpass=f=3400,equalizer=f=1500:t=q:w=1:g=4',
  }[P.eq];
  return `${pitch}${eq},acompressor=threshold=0.12:ratio=3:attack=5:release=120,alimiter=limit=0.89`;
}
function processVoice(item, out) {
  const raw = join(rawDir, `${item.id}.wav`);
  if (!existsSync(raw)) return false;
  ensureDir(out);
  if (FORCE || !valid(out)) ffmpeg(['-i', raw, '-af', `${voiceFilter(item.persona)},apad=pad_dur=0.25`, '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', out]);
  return true;
}
const voiceWav = (item) => {
  const out = join(TMP, 'proc', `${item.id}.wav`);
  ensureDir(out);
  if (FORCE || !valid(out)) ffmpeg(['-i', join(rawDir, `${item.id}.wav`), '-af', voiceFilter(item.persona), '-ar', '44100', '-ac', '1', out]);
  return out;
};

for (const it of voiceItems.filter((v) => v.group === 'voice')) {
  if (want('voice') && !processVoice(it, it.out)) continue;
  if (existsSync(it.out)) cat.voice.push({ id: it.id, station: it.station, dj: it.dj, kind: it.kind, index: it.index, track: it.track, lang: it.lang || 'pt', text: it.text, file: rel(it.out), duration: duration(it.out), license: LIC_VOICE });
}
for (const it of voiceItems.filter((v) => v.group === 'news')) {
  if (want('news')) processVoice(it, it.out);
  if (existsSync(it.out)) cat.news.push({ id: it.id, kind: it.kind, text: it.text, file: rel(it.out), duration: duration(it.out), license: LIC_VOICE });
}
for (const it of voiceItems.filter((v) => v.group === 'lead')) {
  if (want('news')) processVoice(it, it.out);
  if (existsSync(it.out)) cat.leads.push({ id: it.id, text: it.text, file: rel(it.out), duration: duration(it.out), license: LIC_VOICE });
}

// ------------------------------------------------------------------ vinhetas (voz + sting)
for (const st of STATIONS) {
  const styleFor = st.style === 'talk' ? 'electro' : st.style;
  for (const it of voiceItems.filter((v) => v.group === 'jingle' && v.station === st.id)) {
    const out = join(PUB, st.id, 'jingles', `${it.id}.ogg`);
    if (want('jingles') && (FORCE || !valid(out)) && existsSync(join(rawDir, `${it.id}.wav`))) {
      const sting = join(TMP, `sting_${it.id}.wav`);
      writeFileSync(sting, composeSting(styleFor, seedOf(it.id), 3.4).wav());
      const v = voiceWav(it);
      ensureDir(out);
      ffmpeg(['-i', sting, '-i', v, '-filter_complex', '[1:a]adelay=350|350,volume=1.35,aformat=channel_layouts=stereo,asplit=2[v1][v2];[0:a][v1]sidechaincompress=threshold=0.08:ratio=4:attack=20:release=300[d];[d][v2]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.9', '-ac', '2', '-c:a', 'libopus', '-b:a', '48k', out]);
    }
    if (existsSync(out)) cat.jingles.push({ id: it.id, station: st.id, text: it.text, file: rel(out), duration: duration(out), license: `${LIC_MUSIC} ${LIC_VOICE}` });
  }
  // Sting curto sem voz (separador entre blocos).
  const so = join(PUB, st.id, 'jingles', `${st.id}_sting.ogg`);
  if (want('jingles') && (FORCE || !existsSync(so))) wavToOgg(composeSting(styleFor, seedOf(`${st.id}_sting`), 2.6).wav(), so, { kbps: 48 });
  if (existsSync(so)) cat.stings.push({ id: `${st.id}_sting`, station: st.id, file: rel(so), duration: duration(so), license: LIC_MUSIC });
}

// ------------------------------------------------------------------ comerciais (voz + trilha)
for (const it of voiceItems.filter((v) => v.group === 'ad')) {
  const out = join(PUB, 'ads', `${it.id}.ogg`);
  if (want('ads') && (FORCE || !valid(out)) && existsSync(join(rawDir, `${it.id}.wav`))) {
    const v = voiceWav(it);
    const vd = duration(v);
    const bed = join(TMP, `bed_${it.id}.wav`);
    writeFileSync(bed, composeBed(it.ad.bed, seedOf(it.id), vd + 2.5).wav());
    ensureDir(out);
    ffmpeg(['-i', bed, '-i', v, '-filter_complex', `[0:a]volume=0.45,atrim=0:${(vd + 2.2).toFixed(2)},afade=t=out:st=${(vd + 1.2).toFixed(2)}:d=1[b];[1:a]adelay=700|700,volume=1.3,aformat=channel_layouts=stereo,asplit=2[v1][v2];[b][v1]sidechaincompress=threshold=0.05:ratio=6:attack=15:release=250[d];[d][v2]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.9`, '-ac', '2', '-c:a', 'libopus', '-b:a', '48k', out]);
  }
  if (existsSync(out)) cat.ads.push({ id: it.id, business: it.id.replace(/^ad_|_\d+$/g, ''), text: it.ad.text, file: rel(out), duration: duration(out), license: `${LIC_MUSIC} ${LIC_VOICE}` });
}

// ------------------------------------------------------------------ programas de conversa (CITY TALK)
for (const tk of TALK) {
  const out = join(PUB, 'city_talk', 'talk', `${tk.id}.ogg`);
  const items = voiceItems.filter((v) => v.group === 'talkline' && v.talk === tk.id).sort((a, b) => a.order - b.order);
  if (want('talk') && (FORCE || !valid(out)) && items.every((i) => existsSync(join(rawDir, `${i.id}.wav`)))) {
    const wavs = items.map(voiceWav);
    const list = join(TMP, `talk_${tk.id}.txt`);
    const gap = join(TMP, 'gap.wav');
    if (!existsSync(gap)) ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.45', gap]);
    writeFileSync(list, wavs.flatMap((w) => [`file '${w.replace(/\\/g, '/')}'`, `file '${gap.replace(/\\/g, '/')}'`]).join('\n'));
    const joined = join(TMP, `talk_${tk.id}.wav`);
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
    const jd = duration(joined);
    const bed = join(TMP, `talkbed_${tk.id}.wav`);
    writeFileSync(bed, composeBed('soft', seedOf(tk.id), jd + 2).wav());
    ensureDir(out);
    ffmpeg(['-i', bed, '-i', joined, '-filter_complex', `[0:a]volume=0.12,atrim=0:${(jd + 1).toFixed(2)},afade=t=out:st=${jd.toFixed(2)}:d=1[b];[1:a]adelay=400|400[v];[b][v]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.9`, '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', out]);
  }
  if (existsSync(out)) cat.talks.push({ id: tk.id, title: tk.title, file: rel(out), duration: duration(out), license: `${LIC_MUSIC} ${LIC_VOICE}` });
}

// ------------------------------------------------------------------ catálogo
const missing = [...cat.tracks, ...cat.voice, ...cat.jingles, ...cat.ads, ...cat.news, ...cat.leads, ...cat.talks, ...cat.stings].filter((e) => !existsSync(join(ROOT, 'public', e.file)));
if (missing.length) throw new Error(`Arquivos ausentes no catálogo: ${missing.map((m) => m.file).join(', ')}`);
ensureDir(CATALOG);
writeFileSync(CATALOG, JSON.stringify(cat, null, 1) + '\n');
const sum = (l) => l.reduce((s, e) => s + e.duration, 0);
console.log(`CATALOGO músicas ${cat.tracks.length} (${(sum(cat.tracks) / 60).toFixed(1)} min) · falas ${cat.voice.length} · vinhetas ${cat.jingles.length} + ${cat.stings.length} stings · comerciais ${cat.ads.length} · notícias ${cat.news.length} + ${cat.leads.length} chamadas · programas ${cat.talks.length}`);
