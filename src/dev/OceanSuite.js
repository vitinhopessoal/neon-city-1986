/**
 * Bateria dos 45 testes obrigatórios do PROMPT 11 (OCEAN DRIVE), executada
 * DENTRO do jogo real (mesmo loop, mesma física, mesmas entradas de teclado
 * simuladas pelo TestHarness). Só existe em desenvolvimento.
 * Uso no console: await __NEON_TEST__.oceanSuite()
 * Cada teste mede algo concreto e devolve { n, name, ok, detail }.
 */
import { ROUTES } from '../maritime/MaritimeTraffic.js';
import { BOATS } from '../boats/BoatDefinitions.js';
import { ISLANDS } from '../maritime/MaritimeLocations.js';

const r2 = (v) => Math.round(v * 100) / 100;

export async function runOceanSuite(T) {
  const g = T.game, B = g.boats, W = g.water, S = W.surface;
  const c = g.player.controller;
  const results = [];
  const errors = [];
  const onErr = (e) => errors.push(String(e.message || e));
  const oldErr = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); oldErr.apply(console, a); };
  window.addEventListener('error', onErr);
  const test = async (n, name, fn) => {
    let ok = false, detail = '';
    try { const r = await fn(); ok = !!r.ok; detail = r.detail ?? ''; } catch (e) { ok = false; detail = `EXCEÇÃO: ${e.message}`; }
    results.push({ n, name, ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  };
  const place = (x, z, yaw = 0, y = null) => {
    if (B.aboard) B.forceExit();
    const gy = y ?? c.collision.getGroundHeight(x, z, 3, 4);
    c.teleport(x, gy, z, yaw);
    if (c.swimming) c._setSwimming(false);
    g.player.visualPosition.copy(c.position);
    g.cameras.third.initialized = false;
    T.fastSim(0.3);
  };
  const faceCam = (dirYaw) => { g.cameras.yaw = dirYaw + Math.PI; }; // câmera atrás, frente = dirYaw
  const boardAt = (id, x, z, h) => { const b = B.boats.get(id); if (B.aboard !== b) { if (B.aboard) B.forceExit(); B.board(b, true); } b.phys.place(x, z, h); B._sync(b); T.fastSim(0.2); return b; };
  T.pauseLoop();
  // Estado inicial reprodutível (permite rodar a bateria várias vezes na mesma sessão).
  if (B.aboard) B.forceExit();
  for (const b of B.boats.values()) {
    b.hp = b.maxHp; b.sinking = 0; B._applyDamageLook(b);
    if (b.home) { b.anchor = b.home; b.phys.place(b.home.x, b.home.z, b.home.heading); B._sync(b); }
    if (b.ai) { const p = b.ai.route.pts; b.phys.place(p[0][0], p[0][1], Math.atan2(p[1][0] - p[0][0], p[1][1] - p[0][1])); Object.assign(b.ai, { i: 1, state: 'cruise', wait: 0, stuck: 0, blockT: 0, detour: 0 }); B._sync(b); }
  }

  // ------------------------------------------------------------ 1–7 base
  await test(1, 'O jogo inicia', () => ({ ok: g.state === 'playing', detail: `estado ${g.state}` }));
  await test(2, 'Sunset Beach carrega', () => ({ ok: g.maps.activeId === 'sunset-beach' && g.world.sunsetBuilt && W.ready && g.mapEnv.seaOpen, detail: `água pronta em ${W.stats.buildMs} ms · ${W.stats.colliders} colisores marítimos` }));
  await test(3, 'TEST CITY continua funcionando', async () => {
    await g.maps.activate('test-city');
    for (let i = 0; i < 300 && g.mapLoading; i++) await new Promise((r) => setTimeout(r, 50));
    const sp = g.mapEnv.spawnPoint; T.fastPlace(sp.x, sp.z, 0);
    const p0 = c.position.clone(); faceCam(0); T.hold(['KeyW'], 1);
    const moved = c.position.distanceTo(p0);
    const det = { mapa: g.mapEnv.label, andou: r2(moved), agua: W.active, barcos: B.active, nadando: c.swimming };
    await g.maps.activate('sunset-beach');
    for (let i = 0; i < 300 && g.mapLoading; i++) await new Promise((r) => setTimeout(r, 50));
    return { ok: det.mapa === 'TEST CITY' && moved > 1.5 && !det.agua && !det.barcos && !det.nadando && g.mapEnv.seaOpen, detail: det };
  });
  await test(4, 'O protagonista caminha', () => { place(60, -150); faceCam(Math.PI / 2); const p0 = c.position.clone(); T.hold(['KeyW'], 1.2); const v = c.horizontalSpeed; return { ok: c.position.distanceTo(p0) > 2.5 && v > 2.5 && v < 4, detail: `vel ${r2(v)} m/s` }; });
  await test(5, 'O protagonista corre', () => { place(60, -150); faceCam(0); T.hold(['KeyW', 'ShiftLeft'], 1.2); return { ok: c.horizontalSpeed > 6, detail: `vel ${r2(c.horizontalSpeed)} m/s` }; });
  await test(6, 'O protagonista pula', () => { place(60, -150); T.fastTap('Space'); const vy = c.velocity.y, air = !c.grounded; T.fastSim(1); return { ok: vy > 3 && air && c.grounded, detail: `vy ${r2(vy)}` }; });
  await test(7, 'As câmeras funcionam', () => {
    place(60, -150); const m0 = g.cameras.mode; T.fastTap('KeyV'); T.fastSim(0.6); const m1 = g.cameras.mode; const p1 = g.camera.position.clone();
    T.fastTap('KeyV'); T.fastSim(0.6); const p2 = g.camera.position.clone();
    return { ok: m0 !== m1 && g.cameras.mode === m0 && p1.distanceTo(p2) > 1 && Number.isFinite(p2.x), detail: `${m0}→${m1}→${g.cameras.mode}` };
  });

  // ------------------------------------------------------------ 8–11 marina
  await test(8, 'O jogador chega à marina', () => { place(62, -120); faceCam(Math.PI / 2); T.hold(['KeyW', 'ShiftLeft'], 3.5); const where = W.placeAt(c.position.x, c.position.z); return { ok: where === 'SUNSET MARINA', detail: `${where} · x ${r2(c.position.x)}` }; });
  await test(9, 'A marina possui colisões', () => {
    const near = c.collision.queryCircle(110, -121.6, 0.5, []).filter((k) => k.tags?.includes('maritime')).length;
    place(73, -127); faceCam(Math.PI); T.hold(['KeyW'], 2.5); // anda para o escritório (z −131,5 a −136,5)
    return { ok: near > 0 && c.position.z > -131.6, detail: `colisores no píer ${near} · parou em z ${r2(c.position.z)} (parede do escritório em −131,5)` };
  });
  await test(10, 'O jogador acessa o píer', () => { place(64, -120); faceCam(Math.PI / 2); T.hold(['KeyW'], 4); return { ok: c.position.y > 0.45 && c.position.x > 72 && !c.swimming, detail: `y ${r2(c.position.y)} · x ${r2(c.position.x)}` }; });
  await test(11, 'A embarcação está posicionada corretamente', () => {
    const b = B.boats.get('moored_sunset_1'); T.fastSim(1);
    const P = b.phys, surf = S.height(P.x, P.z), depth = S.depth(P.x, P.z);
    const hits = c.collision.queryCircle(P.x, P.z, 0.9, []).filter((k) => k.solid && k.tags?.includes('maritime') && k.maxY > -1).length;
    return { ok: Math.abs(P.y - surf) < 0.35 && depth > b.spec.draft + 0.3 && hits === 0, detail: `y−sup ${r2(P.y - surf)} · prof ${r2(depth)} · sobreposições ${hits}` };
  });

  // ------------------------------------------------------------ 12–25 pilotagem
  await test(12, 'O jogador entra no barco', () => {
    const b = B.boats.get('moored_sunset_1'); b.phys.place(b.anchor.x, b.anchor.z, b.anchor.heading); B._sync(b);
    place(115.5, -119.2, Math.PI, 0.55); T.fastSim(0.3);
    const prompt = document.querySelector('.hud-prompt')?.textContent || '';
    T.fastTap('KeyE'); T.fastSim(0.8);
    return { ok: B.aboard === b && !!g.player.external, detail: `prompt "${prompt.trim()}"` };
  });
  await test(13, 'O controle muda corretamente', () => {
    const b = B.aboard; if (!b) return { ok: false, detail: 'fora do barco' };
    const p0 = c.position.clone(); T.hold(['KeyW'], 0.5);
    const det = { externo: !!g.player.external, armas: g.weapons.onFoot, carroSuprimido: g.vehicles.interaction.suppressed, acelerador: r2(b.phys.throttle), hud: document.querySelector('.boat-hud')?.classList.contains('visible') };
    return { ok: det.externo && !det.armas && det.carroSuprimido && det.acelerador > 0.3 && det.hud && c.position.distanceTo(p0) < 6, detail: det };
  });
  let speedAt = 0;
  await test(14, 'O barco acelera', () => { const b = boardAt('moored_sunset_1', 190, -200, Math.PI / 2); T.hold(['KeyW'], 5); speedAt = b.phys.forwardSpeed; return { ok: speedAt > 18, detail: `${Math.round(speedAt * 3.6)} km/h em 5 s` }; });
  await test(15, 'O barco freia', () => {
    const b = B.aboard, P = b.phys; const v0 = P.forwardSpeed; T.fastSim(1); const coast = v0 - P.forwardSpeed;
    const v1 = P.forwardSpeed; T.hold(['KeyS'], 1); const brake = v1 - P.forwardSpeed;
    return { ok: brake > coast * 1.3 && brake > 2, detail: `queda 1 s solto ${r2(coast)} m/s · com S ${r2(brake)} m/s` };
  });
  await test(16, 'O barco faz ré', () => { const b = boardAt('moored_sunset_1', 220, -200, Math.PI / 2); T.hold(['KeyS'], 3); return { ok: b.phys.forwardSpeed < -1.5, detail: `${r2(b.phys.forwardSpeed)} m/s` }; });
  await test(17, 'O barco vira', () => { const b = boardAt('moored_sunset_1', 220, -200, Math.PI / 2); const h0 = b.phys.heading; T.hold(['KeyW', 'KeyA'], 3); const dh = b.phys.heading - h0; let roll = b.phys.roll; T.hold(['KeyW', 'KeyD'], 3); return { ok: dh > 1 && b.phys.heading < h0 + dh && roll < -0.02, detail: `giro ${r2(dh)} rad em 3 s · inclinação ${r2(roll)} rad` }; });
  let idleY = [];
  await test(18, 'O barco flutua', () => { const b = boardAt('moored_sunset_1', 230, -150, 0); T.fastSim(2); idleY = []; let maxErr = 0; for (let i = 0; i < 300; i++) { T.fastSim(1 / 60); const e = Math.abs(b.phys.y - S.height(b.phys.x, b.phys.z)); maxErr = Math.max(maxErr, e); idleY.push(b.phys.y); } return { ok: maxErr < 0.3 && b.phys.submerged > 0, detail: `erro máx. de linha d'água ${r2(maxErr)} m` }; });
  await test(19, 'O barco reage às ondas', () => {
    const b = B.aboard; const ys = [], ss = [], pr = [];
    for (let i = 0; i < 360; i++) { T.fastSim(1 / 60); ys.push(b.phys.y); ss.push(S.height(b.phys.x, b.phys.z)); pr.push(Math.abs(b.phys.pitch) + Math.abs(b.phys.roll)); }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length; const my = mean(ys), ms = mean(ss);
    let cov = 0, vy = 0, vs = 0; for (let i = 0; i < ys.length; i++) { cov += (ys[i] - my) * (ss[i] - ms); vy += (ys[i] - my) ** 2; vs += (ss[i] - ms) ** 2; }
    const corr = cov / Math.sqrt(vy * vs), amp = Math.max(...ys) - Math.min(...ys);
    return { ok: corr > 0.6 && amp > 0.05 && Math.max(...pr) > 0.005, detail: `amplitude ${r2(amp)} m · correlação com a onda ${r2(corr)} · arfagem/balanço máx. ${r2(Math.max(...pr))} rad` };
  });
  await test(20, 'O barco não afunda indevidamente', () => { const b = boardAt('moored_sunset_1', 200, 60, Math.PI); let low = Infinity; T.down('KeyW'); for (let i = 0; i < 1200; i++) { T.fastSim(1 / 60); low = Math.min(low, b.phys.y - S.height(b.phys.x, b.phys.z)); if (i === 600) T.down('KeyA'); } T.up('KeyW'); T.up('KeyA'); return { ok: low > -b.spec.draft, detail: `menor altura relativa ${r2(low)} m (calado ${b.spec.draft})` }; });
  await test(21, 'O barco não voa', () => { const b = boardAt('moored_sunset_1', 200, 60, Math.PI); let air = 0, hi = -Infinity; T.down('KeyW'); for (let i = 0; i < 900; i++) { T.fastSim(1 / 60); if (b.phys.airborne) air++; hi = Math.max(hi, b.phys.y - S.height(b.phys.x, b.phys.z)); } T.up('KeyW'); return { ok: air / 900 < 0.03 && hi < 0.8, detail: `no ar ${Math.round((air / 900) * 100)}% · altura máx. ${r2(hi)} m` }; });
  await test(22, 'O rastro de espuma funciona', () => { const fx = W.effects; const s0 = fx.stats.spawned; const b = boardAt('moored_sunset_1', 200, 60, Math.PI); T.hold(['KeyW'], 4); return { ok: fx.stats.spawned - s0 > 20 && fx.live > 10 && fx.live <= fx.stats.max, detail: `${fx.stats.spawned - s0} partículas · ${fx.live} vivas (pool ${fx.stats.max})` }; });
  await test(23, 'O áudio funciona', () => {
    g.audio.start(); const A = B.audio; A.start(B.aboard);
    if (!A.n) return { ok: false, detail: 'sem AudioContext' };
    A._lastAutomate.eng = -1; A.update(0.016, { ...B.aboard.phys, spec: B.aboard.spec, forwardSpeed: 0, throttle: 0, submerged: 1, airborne: false, yawRate: 0 }); const idle = A._lastAutomate.eng;
    A.update(0.016, { ...B.aboard.phys, spec: B.aboard.spec, forwardSpeed: 25, throttle: 1, submerged: 1, airborne: false, yawRate: 0 }); const full = A._lastAutomate.eng;
    A.horn(true); const horn = A.hornOn; A.horn(false); A.splash(1); A.impact(5); A.ambient(0.8);
    return { ok: full > idle * 1.8 && horn && !!A.amb, detail: `motor ${Math.round(idle)}→${Math.round(full)} Hz · buzina · respingo · impacto · marulho (contexto ${g.audio.ctx.state})` };
  });
  await test(24, 'A câmera acompanha', () => { const b = boardAt('moored_sunset_1', 200, 60, Math.PI); T.hold(['KeyW'], 3); const P = b.phys; const cam = g.camera.position; const dx = cam.x - P.x, dz = cam.z - P.z; const behind = dx * Math.sin(P.heading) + dz * Math.cos(P.heading); const d = Math.hypot(dx, dz); return { ok: behind < -3 && d < 20 && cam.y > S.level + 0.8, detail: `distância ${r2(d)} m · atrás ${r2(-behind)} m · altura ${r2(cam.y)}` }; });
  await test(25, 'A tecla V funciona', () => {
    const b = B.aboard; T.fastTap('KeyV'); T.fastSim(0.5); b.root.updateWorldMatrix(true, false);
    const eye = b.root.localToWorld(b.root.position.clone().set(b.spec.seat.x, b.spec.eye, b.spec.seat.z));
    const d1 = g.camera.position.distanceTo(eye); T.fastTap('KeyV'); T.fastSim(0.8); b.root.updateWorldMatrix(true, false); const eye2 = b.root.localToWorld(b.root.position.clone().set(b.spec.seat.x, b.spec.eye, b.spec.seat.z)); const d2 = g.camera.position.distanceTo(eye2);
    return { ok: d1 < 0.6 && d2 > 4, detail: `piloto: ${r2(d1)} m do olho · perseguição: ${r2(d2)} m` };
  });

  // ------------------------------------------------------------ 26–31 colisão, desembarque, ilha
  await test(26, 'O barco colide com obstáculos', () => { const b = boardAt('moored_sunset_1', 172, -282, -Math.PI / 2); b.hp = b.maxHp; B._applyDamageLook(b); let minBow = Infinity, contacts = 0; b.phys.lastImpact = 0; T.down('KeyW'); for (let i = 0; i < 300; i++) { T.fastSim(1 / 60); minBow = Math.min(minBow, b.phys.x - b.spec.length / 2); if (b.phys.contacts.length) contacts++; } if (b.phys.lastImpact > 1.2) contacts++; T.up('KeyW'); return { ok: minBow > 133 && contacts > 0, detail: `proa parou em x ${r2(minBow)} (ponta do píer de Azure Docks em x 134)` }; });
  await test(27, 'A integridade responde a impactos', () => { const b = B.aboard; T.fastSim(0.3); const hud = document.querySelector('.boat-hud [data-ref="hp"]')?.textContent; return { ok: b.hp < b.maxHp && b.hp > 0, detail: `casco ${Math.round(b.hp)}/${b.maxHp} · HUD ${hud}` }; });
  const coral = ISLANDS[0], dock = () => W.docks.coral_island;
  await test(28, 'O jogador aproxima-se de um píer', () => {
    const b = B.aboard; b.hp = b.maxHp; const d = dock();
    const sx = d.x + Math.cos(coral.pier.side) * 40, sz = d.z + Math.sin(coral.pier.side) * 40;
    boardAt(b.id, sx, sz, Math.atan2(d.x - sx, d.z - sz));
    let best = Infinity;
    for (let i = 0; i < 60 * 25; i++) {
      const P = b.phys; const dist = Math.hypot(d.x - P.x, d.z - P.z); best = Math.min(best, dist);
      const err = Math.atan2(Math.sin(Math.atan2(d.x - P.x, d.z - P.z) - P.heading), Math.cos(Math.atan2(d.x - P.x, d.z - P.z) - P.heading));
      P.input.throttle = dist > 12 ? 0.6 : dist > 4 ? 0.2 : -0.3; P.input.steer = Math.max(-1, Math.min(1, err * 1.5));
      g.boats.update(1 / 60); // piloto automático do teste (mesma física e colisões)
      if (dist < 4 && P.speed < 1) break;
    }
    b.phys.input.throttle = 0; T.fastSim(1);
    return { ok: best < 5 && b.phys.speed < 2, detail: `chegou a ${r2(best)} m do ponto de atracação · vel ${r2(b.phys.speed)} m/s` };
  });
  await test(29, 'O jogador desembarca', () => { T.fastTap('KeyE'); T.fastSim(0.8); return { ok: !B.aboard && !c.swimming && c.position.y > S.level, detail: `y ${r2(c.position.y)} · ${W.placeAt(c.position.x, c.position.z)}` }; });
  await test(30, 'O jogador caminha pela ilha', () => {
    const toC = Math.atan2(coral.x - c.position.x, coral.z - c.position.z); faceCam(toC); const p0 = c.position.clone();
    T.hold(['KeyW'], 9); // atravessa o píer (20 m) e entra na trilha da ilha
    const onIsland = Math.hypot(c.position.x - coral.x, c.position.z - coral.z) < coral.r && S.seabed(c.position.x, c.position.z) > S.level;
    return { ok: onIsland && c.position.distanceTo(p0) > 6 && !c.swimming && c.position.y > S.level, detail: `andou ${r2(c.position.distanceTo(p0))} m · chão ${r2(c.position.y)} m · ${W.placeAt(c.position.x, c.position.z)}` };
  });
  await test(31, 'O jogador retorna ao barco', () => {
    const b = B.boats.get('moored_sunset_1'); const P = b.phys;
    // Volta pelo eixo do píer até a ponta e só então vai ao costado do barco.
    const pa = coral.pier.side, d = dock(); const end = { x: d.x + Math.sin(pa) * 3.2, z: d.z - Math.cos(pa) * 3.2 };
    for (let i = 0; i < 60 && Math.hypot(end.x - c.position.x, end.z - c.position.z) > 1.5; i++) { faceCam(Math.atan2(end.x - c.position.x, end.z - c.position.z)); T.hold(['KeyW', 'ShiftLeft'], 0.25); }
    for (let i = 0; i < 80 && !B._candidates().some((k) => k.label.includes(b.name)); i++) { faceCam(Math.atan2(P.x - c.position.x, P.z - c.position.z)); T.hold(['KeyW', 'ShiftLeft'], 0.25); }
    T.fastTap('KeyE'); T.fastSim(0.8);
    return { ok: B.aboard === b, detail: B.aboard ? 'de volta ao leme' : `não embarcou (dist ${r2(Math.hypot(P.x - c.position.x, P.z - c.position.z))})` };
  });

  // ------------------------------------------------------------ 32–34 IA
  await test(32, 'A IA marítima navega', () => {
    if (B.aboard) B.forceExit(); place(60, -60); /* em terra: fora das rotas */
    const L = B.traffic.list; const start = L.map((b) => ({ x: b.phys.x, z: b.phys.z, i: b.ai.i }));
    g.camera.position.set(300, 40, -100); // câmera no centro da baía: todos perto (simulação completa)
    const waited = new Set(); const path = L.map(() => 0); let prev = L.map((b) => [b.phys.x, b.phys.z]); for (let k = 0; k < 20 * 60; k++) { g.camera.position.set(300, 40, -100); g.water.update(1 / 60, g.camera); g.boats.update(1 / 60); L.forEach((b, i) => { if (b.ai.state === 'wait') waited.add(i); path[i] += Math.hypot(b.phys.x - prev[i][0], b.phys.z - prev[i][1]); prev[i] = [b.phys.x, b.phys.z]; }); }
    const moved = path; void start;
    return { ok: moved.every((m, i) => m > 40 || (waited.has(i) && m > 10)), detail: `parada programada: ${[...waited].length} barco(s) · percurso em 20 s: ${moved.map((m) => Math.round(m)).join(' / ')} m · estados ${JSON.stringify(B.traffic.stats.states)}` };
  });
  await test(33, 'A IA evita obstáculos', () => {
    const ai = B.boats.get('ai_bay_loop'); const P = ai.phys; const R = ai.ai.route.pts;
    // Trecho reto e longo da rota (178,−150 → 250,−112, ~81 m), já em velocidade de cruzeiro.
    const h = Math.atan2(R[1][0] - R[0][0], R[1][1] - R[0][1]); P.place(R[0][0], R[0][1], h); P.vx = Math.sin(h) * 10; P.vz = Math.cos(h) * 10; ai.ai.i = 1;
    const blocker = B.boats.get('moored_sunset_1'); blocker.phys.place(P.x + Math.sin(h) * 50, P.z + Math.cos(h) * 50, h + Math.PI / 2); B._sync(blocker);
    ai.ai.state = 'cruise'; ai.ai.wait = 0; let seen = new Set(), minD = Infinity, hit = 0;
    for (let k = 0; k < 12 * 60; k++) { g.camera.position.set(P.x, 30, P.z); blocker.phys.place(blocker.phys.x, blocker.phys.z, blocker.phys.heading); g.boats.update(1 / 60); seen.add(ai.ai.state); minD = Math.min(minD, Math.hypot(P.x - blocker.phys.x, P.z - blocker.phys.z)); if (P.contacts.some((k) => k.collider.ownerId === blocker.id)) hit++; }
    const bx = blocker.phys.x, bz = blocker.phys.z; let passed = false, detoured = false;
    for (let k = 0; k < 25 * 60 && !passed; k++) { g.camera.position.set(P.x, 30, P.z); blocker.phys.place(bx, bz, blocker.phys.heading); g.boats.update(1 / 60); if (ai.ai.detour > 0) detoured = true; if (P.contacts.some((q) => q.collider.ownerId === blocker.id)) hit++; passed = (P.x - bx) * Math.sin(h) + (P.z - bz) * Math.cos(h) > 8; }
    return { ok: (seen.has('yield') || seen.has('stop')) && hit === 0 && minD > ai.spec.length / 2 + blocker.spec.width / 2 && detoured && passed, detail: `estados ${[...seen].join(',')} · menor distância entre centros ${r2(minD)} m (contato em ~${r2(ai.spec.length / 2 + blocker.spec.width / 2)} m) · colisões ${hit} · contornou: ${detoured && passed ? 'sim' : 'não'}` };
  });
  await test(34, 'O tráfego marítimo não atravessa ilhas', () => {
    let worst = Infinity, where = '';
    for (const r of Object.values(ROUTES)) for (let i = 0; i < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[(i + 1) % r.pts.length];
      for (let t = 0; t <= 1; t += 0.01) { const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; const d = S.depth(x, z) - BOATS[r.type].draft; if (d < worst) { worst = d; where = `${Math.round(x)},${Math.round(z)}`; } }
    }
    let dyn = Infinity; for (const b of B.traffic.list) dyn = Math.min(dyn, S.depth(b.phys.x, b.phys.z) - b.spec.draft);
    return { ok: worst > 0.5 && dyn > 0.2, detail: `folga mínima sob a quilha nas rotas ${r2(worst)} m (${where}) · agora ${r2(dyn)} m` };
  });

  // ------------------------------------------------------------ 35–37 economia/persistência
  let pid = null;
  await test(35, 'O armazenamento funciona', () => {
    for (const r of [...B.owned.values()]) { const wb = B._worldBoat(r.pid); if (wb) B._despawn(wb); }
    B.owned.clear(); T.grantMoney(30000); const m0 = g.economy.balance();
    const buy = B.buy('fisher'); pid = [...B.owned.keys()][0];
    const l = B.launch(pid); const wb = B._worldBoat(pid); const s = B.store(pid); const l2 = B.launch(pid);
    return { ok: buy.ok && m0 - g.economy.balance() === BOATS.fisher.price && l.ok && !!wb && s.ok && l2.ok, detail: `${buy.msg} · ${l.msg} · ${s.msg}` };
  });
  let savedPos = null;
  await test(36, 'O salvamento funciona', async () => {
    const wb = B._worldBoat(pid); wb.phys.place(185, -95, 1.2); B._sync(wb); savedPos = { x: wb.phys.x, z: wb.phys.z };
    const res = await g.save.save('slot3', { label: 'Teste OCEAN DRIVE' });
    const back = await g.save.backend.get('slot3');
    const rec = back?.boats?.owned.find((r) => r.pid === pid);
    return { ok: res.ok && rec?.location === 'world' && Math.abs(rec.x - 185) < 0.5, detail: `slot3 · ${back?.boats?.owned.length} barco(s) · ${JSON.stringify(rec)}` };
  });
  await test(37, 'O carregamento restaura a embarcação', async () => {
    B.store(pid); B.owned.clear(); const before = B.boats.size;
    const r = await g.save.load('slot3'); T.fastSim(0.5);
    const wb = B._worldBoat(pid);
    return { ok: r.ok !== false && !!wb && Math.hypot(wb.phys.x - savedPos.x, wb.phys.z - savedPos.z) < 1 && [...B.boats.values()].filter((b) => b.record).length === 1, detail: `${wb ? `${wb.name} em ${r2(wb.phys.x)}, ${r2(wb.phys.z)}` : 'ausente'} · barcos ${before}→${B.boats.size}` };
  });

  // ------------------------------------------------------------ 38–45 regressão
  await test(38, 'O trânsito terrestre continua funcionando', () => { place(60, -100); /* areia: fora da pista, os carros não param pelo jogador */ const A = g.city.traffic.agents; const p0 = new Map(A.filter((a) => a.v).map((a) => [a, a.v.root.position.clone()])); let moved = 0, t = 0; for (; t < 15 && moved === 0; t += 1) { T.fastSim(1); moved = [...p0].filter(([a, p]) => a.v.root.position.distanceTo(p) > 3).length; } /* parados em sinal/PARE são normais */ return { ok: A.length > 0 && moved > 0, detail: `${A.length} carros · ${moved} em movimento após ${t} s · ${A.map((a) => a.state + '/' + a.reason).join(', ')}` }; });
  await test(39, 'A polícia continua funcionando', () => { const P = g.city.police; place(30, -100); for (let i = 0; i < 3; i++) P.report('attackCop', `t${i}`, c.position.clone(), null); T.fastSim(3); const lvl = g.player.status.wanted; const units = P.units.length; g.player.status.setWanted(0); T.fastSim(1); return { ok: lvl >= 1 && units > 0, detail: `${lvl}★ · ${units} viatura(s)` }; });
  await test(40, 'O arsenal continua funcionando', () => { place(30, -100); const Wm = g.weapons; const id = Wm.inv.defs.find((d) => d.id !== 'fist' && d.id !== 'unarmed')?.id; Wm.select(id); T.fastSim(1.2); const e = Wm.selected; const l0 = e.loaded; Wm.cooldown = 0; Wm._tryFire(true); return { ok: Wm.onFoot && e.loaded === l0 - 1, detail: `${e.def.name}: ${l0}→${e.loaded}` }; });
  await test(41, 'Os interiores continuam funcionando', () => { const r = T.enterInterior('sunset_slice'); const ok = r.state === 'inside' && r.active === 'sunset_slice'; g.interiors._forceOutside(); T.fastSim(0.5); return { ok: ok && g.interiors.state === 'outside', detail: JSON.stringify(r) }; });
  await test(42, 'As propriedades continuam funcionando', () => { const P = g.properties; T.grantMoney(15000); const had = P.owns('palm_residence'); const r = had ? { ok: true, msg: 'já possuía' } : P.buy('palm_residence'); const page = P.garagePage(P.def('palm_residence')); return { ok: r.ok && P.owns('palm_residence') && P.defs.length === 4 && /Garagem/.test(page.who) && P.markers().some((m) => m.kind === 'home'), detail: `${r.msg} · garagem: ${page.who}` }; });
  await test(43, 'A economia continua funcionando', () => { const E = g.economy; const m0 = E.balance(); const a = E.spend(10, 'teste', { txId: 'ocean_suite_tx' }); const b = E.spend(10, 'teste', { txId: 'ocean_suite_tx' }); return { ok: a.ok && b.duplicate && E.balance() === m0 - 10, detail: `cobrado uma vez (txId repetido ignorado) · saldo ${E.balance()}` }; });
  await test(44, 'Não existem erros críticos no console', () => ({ ok: errors.length === 0, detail: errors.length ? errors.slice(0, 3).join(' | ') : 'nenhum erro durante a bateria' }));
  await test(45, 'O desempenho permanece aceitável', () => {
    place(80, -120); g.camera.position.set(80, 3, -120);
    const t = []; for (let i = 0; i < 180; i++) { const t0 = performance.now(); W.update(1 / 60, g.camera); B.update(1 / 60); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b);
    const fr = []; for (let i = 0; i < 40; i++) { const t0 = performance.now(); T.sim(1 / 60); fr.push(performance.now() - t0); }
    fr.sort((a, b) => a - b);
    return { ok: t[90] < 1 && t[171] < 2.5, detail: `água+barcos: mediana ${r2(t[90])} ms, p95 ${r2(t[171])} ms · quadro completo (com render) mediana ${r2(fr[20])} ms · ${B.boats.size} barcos, ${W.effects.live} partículas, NPCs ${B.npcs.stats.active}` };
  });

  console.error = oldErr;
  window.removeEventListener('error', onErr);
  if (B.aboard) B.forceExit();
  const passed = results.filter((r) => r.ok).length;
  return { passed, total: results.length, results };
}
