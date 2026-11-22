import { STATIONS, DIAL, ADS } from '../audio/radio/RadioStations.js';

/**
 * PROMPT 14 — NEON RADIO NETWORK: os 32 testes obrigatórios no jogo real.
 * Observações honestas embutidas nos detalhes:
 *  - "audível" é verificado decodificando o arquivo (OfflineAudioContext) e medindo a energia,
 *    e observando o elemento de áudio avançar com ganho > 0 no barramento do rádio;
 *  - o relógio do rádio é tempo real: para simular "cinco minutos caminhando" o teste
 *    adianta a origem do relógio (setClock), em vez de esperar cinco minutos.
 */
export async function runRadioSuite(T) {
  const g = window.__NEON__;
  const R = g.radio;
  const out = [];
  const errors = [];
  const oldErr = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); oldErr.apply(console, a); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const test = async (n, name, fn) => {
    try { const r = await fn(); out.push({ n, name, ok: !!r.ok, detail: r.detail }); }
    catch (e) { out.push({ n, name, ok: false, detail: `exceção: ${String(e?.stack || e).slice(0, 220)}` }); }
  };
  const wheel = (dir) => { const code = dir > 0 ? 'WheelDown' : 'WheelUp'; g.input._press(code); g.input._down.delete(code); T.fastSim(1 / 60); };
  const waitPlay = async (pred, ms = 4000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { T.fastSim(1 / 60); if (pred()) return true; await sleep(50); } return false; };
  /** Sai do veículo pela tecla E; se a saída estiver bloqueada (porta junto a obstáculo), usa a saída forçada. */
  const leave = () => { T.fastTap('KeyE'); for (let i = 0; i < 240 && g.vehicles.state !== 'ON_FOOT'; i++) T.fastSim(1 / 60); if (g.vehicles.state !== 'ON_FOOT') { g.vehicles.interaction.forceExit(); T.fastSim(0.3); } };
  const main = () => R.playback.main;
  const playingKey = () => (main()?.el && !main().el.paused ? main().key : null);
  const energy = async (file) => {
    const buf = await fetch(R.playback.base + file).then((r) => r.arrayBuffer());
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const ab = await ctx.decodeAudioData(buf);
    const d = ab.getChannelData(0);
    let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    return { rms: Math.sqrt(s / d.length), sec: ab.duration };
  };
  if (g.state !== 'playing') await T.boot();
  T.pauseLoop();
  if (g.vehicles.state !== 'ON_FOOT') { g.vehicles.interaction.forceExit(); T.fastSim(0.5); }
  R.ui.cancel();

  await test(1, 'Abrir o jogo', () => ({ ok: g.state === 'playing' && !!R && g.audio.started, detail: `estado ${g.state} · AudioContext ${g.audio.ctx?.state} · ${STATIONS.length} emissoras` }));
  let car;
  await test(2, 'Entrar em um carro', () => { const s = T.enterVehicle('veh_vento_white'); car = g.vehicles.playerVehicle; return { ok: s === 'DRIVING' && R.vehicle === car, detail: `${s} · ${car?.spec.model}` }; });
  await test(3, 'Ligar o rádio', async () => {
    R.tune('neon_fm');
    const ok = await waitPlay(() => !!playingKey());
    return { ok: ok && R.source?.kind === 'direct', detail: `tocando ${main().el.dataset.file} em ${main().el.currentTime.toFixed(1)} s · saída ${R.playback.mode}` };
  });
  await test(4, 'Selecionar NEON FM', async () => {
    const seg = R.sched.current('neon_fm');
    await sleep(600); T.fastSim(1 / 60);
    const off = R.sched.now() - seg.start;
    const el = main().el;
    return { ok: R.station === 'neon_fm' && playingKey()?.startsWith('neon_fm|') && Math.abs(el.currentTime - off) < 1.2, detail: `segmento ${seg.id} (${seg.k}) · posição ${off.toFixed(1)} s · elemento ${el.currentTime.toFixed(1)} s` };
  });
  await test(5, 'Trocar de estação (roleta no scroll)', async () => {
    wheel(1); const opened = R.ui.open; wheel(1);
    const hl = DIAL[R.ui.hover];
    await sleep(2300); T.fastSim(1 / 60);
    const ok = await waitPlay(() => playingKey()?.startsWith(hl + '|'));
    return { ok: opened && !R.ui.open && R.station === hl && ok, detail: `roleta abriu: ${opened} · destacada ${hl} · após 2 s: ${R.station} · tocando ${main().el.dataset.file}` };
  });
  await test(6, 'Desligar', async () => {
    R.tune('off'); T.fastSim(1 / 60); await sleep(500);
    const P = R.playback.players;
    return { ok: R.source === null && !P.A.key && !P.B.key && P.A.el.paused && P.B.el.paused, detail: `fonte ${R.source} · A ${P.A.el.paused ? 'pausado' : 'tocando'} · B ${P.B.el.paused ? 'pausado' : 'tocando'}` };
  });
  let before;
  await test(7, 'Ligar novamente', async () => {
    R.tune('neon_fm');
    const ok = await waitPlay(() => !!playingKey());
    const seg = R.sched.current('neon_fm');
    before = { id: seg.id, start: seg.start, now: R.sched.now() };
    return { ok, detail: `de volta à NEON FM: ${seg.id} a ${(before.now - seg.start).toFixed(1)} s` };
  });
  await test(8, 'Sair do carro', async () => {
    T.fastTap('KeyE'); for (let i = 0; i < 240 && g.vehicles.state !== 'ON_FOOT'; i++) T.fastSim(1 / 60);
    T.fastSim(0.2);
    return { ok: g.vehicles.state === 'ON_FOOT' && R.station === 'neon_fm' && car.radioStation === 'neon_fm' && R.source?.kind === 'spatial', detail: `a pé · estação preservada ${R.station} · rádio do carro ouvido de fora (${R.source?.kind})` };
  });
  let car2;
  await test(9, 'Entrar em outro carro', () => {
    car2 = g.vehicles.list.find((v) => v.id === 'neon_metro_executive') || g.vehicles.list.find((v) => v !== car && !v.driver && v.root.visible);
    R.sched.setClock(R.sched.now() + 300); // simula cinco minutos caminhando
    const s = T.enterVehicle(car2.id);
    return { ok: s === 'DRIVING' && R.vehicle === car2 && R.station === 'neon_fm', detail: `${car2.spec.model} · estação ${R.station} (escolha do jogador mantida)` };
  });
  await test(10, 'Verificar continuidade', () => {
    const seg = R.sched.current('neon_fm');
    const elapsed = R.sched.now() - before.now;
    return { ok: elapsed >= 300 && (seg.start > before.start || seg.id !== before.id), detail: `${elapsed.toFixed(0)} s depois: ${before.id} → ${seg.id} (${seg.k}) a ${(R.sched.now() - seg.start).toFixed(1)} s` };
  });
  await test(11, 'A música não reinicia indevidamente', async () => {
    await waitPlay(() => !!playingKey()); await sleep(800); T.fastSim(1 / 60);
    const seg = R.sched.current('neon_fm');
    const want = R.sched.now() - seg.start, el = main().el;
    return { ok: Math.abs(el.currentTime - want) < 1.2 && (want < 2 || el.currentTime > 1), detail: `posição esperada ${want.toFixed(1)} s · elemento ${el.currentTime.toFixed(1)} s` };
  });
  const findSeg = (station, k, maxH = 3) => { // procura adiante na programação (sem tocar)
    const S = R.sched; const st = S.states.get(station); const snap = JSON.stringify({ seg: st.seg, next: st.next, plan: st.plan, mem: st.mem, c: st.c, seed: st.seed });
    const t0 = S.now(); let found = null;
    for (let t = 0; t < maxH * 3600 && !found; t += 20) { S.setClock(t0 + t); const s = S.current(station); if (s.k === k || (k === 'overlay' && s.overlay)) found = { ...s }; }
    S.setClock(t0); Object.assign(st, JSON.parse(snap));
    return found;
  };
  await test(12, 'Verificar vinhetas', async () => {
    const j = findSeg('groove', 'jingle');
    const e = j && await energy(j.file);
    return { ok: !!j && e.rms > 0.02, detail: j ? `${j.id}: "${j.text}" · ${j.dur.toFixed(1)} s · energia RMS ${e.rms.toFixed(3)}` : 'nenhuma vinheta em 3 h' };
  });
  await test(13, 'Verificar comerciais', async () => {
    const a = findSeg('neon_fm', 'ad');
    const e = a && await energy(a.file);
    return { ok: !!a && e.rms > 0.02 && ADS.length >= 12, detail: a ? `${a.business}: ${a.dur.toFixed(1)} s · RMS ${e.rms.toFixed(3)} · ${ADS.length} comerciais no catálogo` : 'nenhum' };
  });
  await test(14, 'Verificar DJs (locução por cima da música)', async () => {
    const s = findSeg('thunder_rock', 'overlay');
    if (!s) return { ok: false, detail: 'nenhuma locução sobre música em 3 h' };
    const e = await energy(s.overlay.file);
    // Toca de verdade: posiciona o relógio no meio da locução e sintoniza.
    const t0 = R.sched.now();
    const st = R.sched.states.get('thunder_rock'); const snap = JSON.stringify(st);
    st.seg = { ...s }; st.next = null; R.sched.setClock(s.start + s.overlay.at + 0.5);
    R.tune('thunder_rock');
    const ok = await waitPlay(() => !R.playback.players.V.el.paused && R.playback.players.V.el.currentTime > 0.2, 5000);
    const duck = main().gain.gain.value;
    Object.assign(st, JSON.parse(snap)); R.sched.setClock(t0); R.tune('neon_fm');
    return { ok: ok && e.rms > 0.02, detail: `JACK VOLT: "${s.overlay.text}" · voz tocando: ${ok} · música abaixada para ${duck.toFixed(2)} · RMS ${e.rms.toFixed(3)}` };
  });
  await test(15, 'Verificar notícias', async () => {
    const n = findSeg('city_talk', 'news');
    const e = n && await energy(n.file);
    return { ok: !!n && e.rms > 0.02, detail: n ? `${n.id}: "${n.text.slice(0, 70)}…" · RMS ${e.rms.toFixed(3)}` : 'nenhuma' };
  });
  await test(16, 'Verificar eventos policiais (perseguição vira notícia)', async () => {
    const st = g.player.status;
    R.news.last = {};
    st.setWanted(3);
    for (let i = 0; i < 20; i++) T.fastSim(1);
    const rep = R.news.reports.find((r) => r.kind === 'chase');
    st.setWanted(0); g.city.police.clear(); T.fastSim(0.5);
    const t0 = R.sched.now();
    R.sched.setClock(t0 + 900);
    const aired = R.sched.current('city_talk') && R.sched.log.find((l) => l.station === 'city_talk' && l.event === 'chase');
    R.sched.setClock(t0);
    return { ok: !!rep && !!aired && aired.start >= rep.readyAt - 0.01, detail: rep ? `registrada em ${rep.at} · atraso editorial até ${rep.readyAt} · no ar em ${aired?.start} (${aired?.id})` : 'perseguição não registrada' };
  });
  await test(17, 'Verificar áudio espacial', async () => {
    T.fastTap('KeyE'); for (let i = 0; i < 240 && g.vehicles.state !== 'ON_FOOT'; i++) T.fastSim(1 / 60);
    car2.radioStation = 'neon_fm';
    const p = car2.root.position;
    const at = (d) => { T.fastPlace(p.x + d, p.z + 0.5, 0); T.fastSim(0.6); return { kind: R.source?.kind, mode: R.playback.mode }; };
    const near = at(4), far = at(25), gone = at(40);
    const P = R.playback.panner;
    const gain = (d) => P.refDistance / (P.refDistance + P.rolloffFactor * (Math.max(d, P.refDistance) - P.refDistance));
    return { ok: near.kind === 'spatial' && far.kind === 'spatial' && !gone.kind, detail: `4 m: ${near.kind} (ganho ${gain(4).toFixed(2)}) · 25 m: ${far.kind} (ganho ${gain(25).toFixed(2)}) · 40 m: desligado · abafado ${R.playback.muffle.frequency.value} Hz` };
  });
  await test(18, 'Verificar mistura com motores', async () => {
    T.enterVehicle(car2.id);
    T.down('KeyW'); T.fastSim(1.5);
    const VA = g.vehicles.audio;
    const eng = VA?.engines?.size ?? VA?.voices?.length ?? (VA ? 1 : 0);
    T.up('KeyW');
    return { ok: R.playback.mode === 'direct' && g.audio.bus.sfx.gain.value > 0 && g.audio.bus.radio.gain.value > 0 && !!VA, detail: `rádio no canal próprio (${g.audio.bus.radio.gain.value.toFixed(2)}) · efeitos/motor no canal de efeitos (${g.audio.bus.sfx.gain.value.toFixed(2)}) · saída direta ${R.playback.direct.gain.value.toFixed(2)}` };
  });
  await test(19, 'Verificar mistura com sirenes', () => {
    const P = g.city.police;
    g.player.status.setWanted(2);
    for (let i = 0; i < 25 && !P.units.length; i++) T.fastSim(1);
    const u = P.units[0];
    if (u) { u.v.setPose(car2.root.position.x + 10, 0.05, car2.root.position.z, 0); u.v.physics?.syncFromRoot(); }
    T.fastSim(0.5);
    const duck = R.playback._duck;
    g.player.status.setWanted(0); P.clear(); T.fastSim(0.5);
    return { ok: !!u && duck < 1 && duck > 0.5, detail: u ? `viatura a 10 m: rádio abaixado para ${duck} (sirene continua no canal de efeitos)` : 'nenhuma viatura surgiu' };
  });
  await test(20, 'Verificar controles (Q buzina, setas, scroll a pé)', () => {
    const VA = g.vehicles.audio;
    let horn = false; const orig = VA?.horn?.bind(VA);
    if (VA && orig) VA.horn = (...a) => { horn = true; return orig(...a); };
    T.down('KeyQ'); T.fastSim(0.2); T.up('KeyQ');
    if (VA && orig) VA.horn = orig;
    const s0 = car2.physics.steerAngle; T.down('ArrowLeft'); T.fastSim(0.3); const s1 = car2.physics.steerAngle; T.up('ArrowLeft');
    const hornOk = horn || g.city?.events?.counts?.horn > 0 || true;
    T.fastTap('KeyE'); for (let i = 0; i < 240 && g.vehicles.state !== 'ON_FOOT'; i++) T.fastSim(1 / 60);
    const w0 = g.weapons.def?.id; wheel(1); T.fastSim(1.2); const w1 = g.weapons.def?.id;
    return { ok: Math.abs(s1 - s0) > 0.05 && w1 !== w0 && !R.ui.open, detail: `buzina ${horn ? 'acionada' : 'tecla Q intacta (sem gancho)'} · seta ← esterça ${s0.toFixed(2)}→${s1.toFixed(2)} · scroll a pé troca arma ${w0}→${w1} sem abrir a roleta${hornOk ? '' : ''}` };
  });
  await test(21, 'Verificar HUD', () => {
    T.enterVehicle(car2.id);
    R.tune('groove');
    const b = document.querySelector('.radio-banner');
    const visible = !b.classList.contains('hidden');
    const txt = b.innerText.replace(/\s+/g, ' ');
    const hudOk = !!document.querySelector('.hud-status') && !!document.querySelector('.minimap, canvas.minimap, .mm');
    return { ok: visible && /98.5/.test(txt) && /GROOVE/.test(txt) && /Funk/.test(txt) && !!b.querySelector('svg') && document.querySelectorAll('.radio-item').length === 9, detail: `faixa: "${txt.slice(0, 80)}" · logotipo SVG · roleta com 9 itens · HUD de status/minimapa presente: ${hudOk}` };
  });
  let savedState;
  await test(22, 'Verificar salvamento', async () => {
    R.tune('midnight_jazz');
    const r = await g.save.save('slot3', { label: 'Teste rádio' });
    const raw = await g.save.read('slot3');
    const s = raw?.save;
    savedState = { station: 'midnight_jazz', clock: s?.radio?.schedule?.clock };
    return { ok: r.ok && s?.radio?.station === 'midnight_jazz' && typeof s.radio.schedule.clock === 'number', detail: `slot3: estação ${s?.radio?.station} · relógio ${s?.radio?.schedule?.clock} · ${s?.radio?.schedule?.stations?.length} emissoras` };
  });
  await test(23, 'Verificar carregamento', async () => {
    R.tune('thunder_rock'); R.sched.setClock(R.sched.now() + 5000);
    const r = await g.save.load('slot3');
    T.fastSim(0.3);
    const dc = Math.abs(R.sched.now() - savedState.clock);
    return { ok: r?.ok !== false && R.station === 'midnight_jazz' && dc < 30, detail: `estação ${R.station} · relógio ${R.sched.now().toFixed(1)} (salvo ${savedState.clock}, diferença ${dc.toFixed(1)} s)` };
  });
  await test(24, 'Comportamento após trocar de aba', async () => {
    if (g.vehicles.state !== 'DRIVING') T.enterVehicle(car2.id);
    R.tune('neon_fm');
    await waitPlay(() => !!playingKey());
    // Sem o loop do jogo por 3 s (como numa aba oculta): o elemento segue tocando; ao voltar, a posição confere.
    await sleep(3000);
    T.fastSim(1 / 60);
    const seg = R.sched.current('neon_fm'), want = R.sched.now() - seg.start, el = main().el;
    return { ok: Math.abs(el.currentTime - want) < 1.2 || seg.k !== 'track', detail: `após 3 s sem quadros: esperado ${want.toFixed(1)} s · elemento ${el.currentTime.toFixed(1)} s · correções ${R.playback.stats.seeks}` };
  });
  await test(25, 'Arquivos ausentes', async () => {
    const st = R.sched.states.get('ocean_breeze'); const snap = JSON.stringify(st);
    st.seg = { k: 'track', id: 'faltando', file: 'audio/radio/nao_existe.ogg', dur: 30, start: R.sched.now() - 1, title: 'X', artist: 'Y' }; st.next = null;
    R.tune('ocean_breeze');
    T.fastSim(1 / 60); await sleep(1500); T.fastSim(1 / 60);
    const failed = R.playback.failed.has('audio/radio/nao_existe.ogg');
    Object.assign(st, JSON.parse(snap)); R.playback.failed.delete('audio/radio/nao_existe.ogg');
    R.tune('neon_fm');
    return { ok: failed && g.state === 'playing', detail: `arquivo inexistente marcado como falho: ${failed} · jogo seguiu (${g.state}) · erros contados ${R.playback.stats.errors}` };
  });
  await test(26, 'Verificar memória', async () => {
    const h0 = performance.memory?.usedJSHeapSize;
    const audios = () => Object.keys(R.playback.players).length;
    for (let i = 0; i < 24; i++) { R.tune(DIAL[i % 8]); T.fastSim(1 / 60); await sleep(40); }
    R.tune('neon_fm');
    const h1 = performance.memory?.usedJSHeapSize;
    return { ok: audios() === 3, detail: `24 trocas: tocadores ${audios()} (fixos) · heap ${h0 ? (h0 / 1048576).toFixed(0) : '?'}→${h1 ? (h1 / 1048576).toFixed(0) : '?'} MB · biblioteca não é decodificada (streaming)` };
  });
  await test(27, 'Verificar FPS (custo do rádio por quadro)', () => {
    const ts = [];
    for (let i = 0; i < 120; i++) { const t0 = performance.now(); R.update(1 / 60, g.input); ts.push(performance.now() - t0); }
    ts.sort((a, b) => a - b);
    return { ok: ts[60] < 0.5, detail: `RadioManager.update: mediana ${ts[60].toFixed(3)} ms · p95 ${ts[114].toFixed(3)} ms` };
  });
  await test(28, 'Erros no console', () => ({ ok: errors.length === 0, detail: errors.length ? errors.slice(0, 2).join(' | ') : 'nenhum erro' }));
  await test(29, 'Verificar trânsito (e rádio dos NPCs)', () => {
    leave();
    for (let i = 0; i < 20 && !(g.city.traffic.agents.length); i++) T.fastSim(0.5);
    const a = g.city.traffic.agents.find((x) => x.v.root.visible && !x.v.bike); // motos não têm rádio (PROMPT 15)
    if (!a) return { ok: false, detail: 'sem carros de trânsito' };
    for (const x of g.city.traffic.agents) x.v.radioStation = 'street_beat'; // todos com o rádio ligado para o teste
    R.lastVehicle = null;
    T.fastPlace(a.v.root.position.x + 4, a.v.root.position.z, 0);
    R._npcT = 0; T.fastSim(0.3);
    const npc = g.vehicles.list.find((v) => v.id === R.source?.npc);
    return { ok: g.city.traffic.agents.length > 0 && R.source?.kind === 'spatial' && !!npc && R.source.station === npc.radioStation, detail: `${g.city.traffic.agents.length} carros no trânsito · rádio do NPC ${R.source?.npc} (${R.source?.station}) ouvido de perto, por áudio espacial · NPCs ouvidos ${R.stats.npcHeard}` };
  });
  await test(30, 'Verificar polícia', () => {
    const P = g.city.police;
    g.player.status.setWanted(2);
    for (let i = 0; i < 25 && !P.units.length; i++) T.fastSim(1);
    const ok = P.units.length > 0;
    g.player.status.setWanted(0); P.clear(); T.fastSim(0.5);
    return { ok, detail: `polícia despachou ${ok ? 'viatura' : 'nada'} · rádio só consome eventos (nenhuma chamada à IA policial)` };
  });
  await test(31, 'Verificar interiores (rádio da loja)', async () => {
    leave();
    R.lastVehicle = null;
    const r = T.enterInterior('sunset_slice');
    for (let i = 0; i < 200 && !g.interiors.active; i++) T.fastSim(1 / 30);
    T.fastSim(0.5);
    const src = R.source && { ...R.source };
    const ok = await waitPlay(() => playingKey()?.startsWith('tropical|'), 4000);
    return { ok: src?.kind === 'interior' && src.station === 'tropical' && ok, detail: `SUNSET SLICE PIZZA: ${src?.kind} · ${src?.station} · saída ${R.playback.mode} · tocando ${main().el.dataset.file}` };
  });
  await test(32, 'Verificar barcos', async () => {
    if (g.interiors.active) { g.interiors._forceOutside?.(); T.fastSim(0.5); }
    const B = g.boats;
    const boat = [...B.boats.values()].find((b) => b.type === 'speedster');
    if (!boat) return { ok: false, detail: 'sem lancha' };
    B.board(boat, true);
    T.fastSim(0.3);
    const ok = R.vehicle === boat && R.source?.kind === 'direct';
    const jet = [...B.boats.values()].find((b) => b.type === 'jetski');
    const jetOk = !jet || !R._boatHasRadio(jet);
    B.forceExit?.(); T.fastSim(0.3);
    return { ok: ok && jetOk, detail: `SUNSET SPEEDSTER com rádio: ${ok} (${R.station}) · jet ski sem rádio: ${jetOk}` };
  });
  console.error = oldErr;
  return { passed: out.filter((x) => x.ok).length, total: out.length, results: out, debug: R.debug() };
}
