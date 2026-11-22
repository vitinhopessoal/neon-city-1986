import { laneRoute } from '../city/Navigation.js';
import { boundsContains } from '../utils/bounds.js';

/**
 * Mundo unificado (Sunset Beach + TEST CITY): testes no jogo real.
 * Uso (dev): await __NEON_TEST__.mergedSuite()
 */
export async function runMergedWorldSuite(T) {
  const g = T.game, w = g.world, tc = w.testCity;
  const results = [];
  const rec = (id, name, ok, detail) => results.push({ id, name, ok: !!ok, detail });
  const errors = [];
  const oldErr = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); oldErr.apply(console, a); };
  const c = g.player.controller;
  const off = tc?.link.offset || { x: 0, z: 0 };
  const L = tc?.link;
  const district = (x, z) => w.getDistrictAt(x, z)?.name || null;
  const groundAt = (x, z) => g.mapEnv.collision.getGroundHeight(x, z, w.terrain.getHeight(x, z) + 0.6, 0.6);
  const placeAt = (x, z, camYaw) => {
    c.teleport(x, groundAt(x, z), z, camYaw + Math.PI);
    g.player.visualPosition.copy(c.position);
    g.cameras.yaw = camYaw;
    g.cameras.third.initialized = false;
    T.fastSim(0.4);
  };
  // Direção da câmera que faz W andar para (dx, dz).
  const yawFor = (dx, dz) => {
    let best = 0, bestDot = -Infinity;
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      placeAt(-100, 60, yaw);
      const a = c.position.clone();
      T.hold(['KeyW'], 0.6);
      const d = c.position.clone().sub(a);
      const dot = d.x * dx + d.z * dz;
      if (dot > bestDot) { bestDot = dot; best = yaw; }
    }
    return best;
  };
  if (g.vehicles.playerVehicle) g.vehicles.interaction.forceExit();
  if (g.interiors.active) { g.interiors._forceOutside(); T.fastSim(0.3); }

  // M1) Um único mundo: TEST CITY anexado ao Sunset Beach (sem troca de mapa).
  rec('M1', 'Mapa único', g.maps.activeId === 'sunset-beach' && tc?.ready && tc.map.root.parent === w.groups.static && g.mapEnv === w,
    `mapa ativo ${g.maps.activeId} · anexado ${tc?.ready} · bairros ${w.districts.map((d) => d.name || d.id).join(' + ')}`);
  // M2) GLB carregado inteiro: triângulos, colisores e campo de alturas.
  const st = tc?.stats || {};
  rec('M2', 'GLB do TEST CITY', st.triangles > 45000 && st.colliders?.total > 1500 && tc.map.heightField,
    `${st.triangles} triângulos · ${st.colliders?.total} colisores · omitidos ${st.colliders?.omitted} (paredes do mapa isolado, barreiras da passagem e postes dentro da pista) · ${st.fileBytes} bytes · anexar ${st.attachMs} ms`);
  // M3) Posição: TEST CITY a oeste, sem sobrepor o Sunset Beach.
  const b = tc?.bounds, sb = w.bounds;
  rec('M3', 'Posição sem sobreposição', b && b.maxX <= sb.minX - 20 && b.minZ < 0 && b.maxZ > 0,
    `TEST CITY x ${b?.minX}…${b?.maxX}, z ${b?.minZ}…${b?.maxZ} · Sunset Beach x ${sb.minX}…${sb.maxX}`);
  // M4) Nome do bairro no HUD/radar.
  rec('M4', 'Bairros identificados', district(off.x, off.z + 15) === 'TEST CITY' && district(-100, 0) === 'SUNSET BEACH',
    `(${off.x}, ${off.z + 15}) → ${district(off.x, off.z + 15)} · (-100, 0) → ${district(-100, 0)}`);

  // M5) A pé: do Sunset Beach até o TEST CITY pela calçada do corredor.
  const west = yawFor(-1, 0), north = yawFor(0, -1);
  placeAt(-135, -8, west);
  T.down('ShiftLeft'); T.hold(['KeyW'], 9); T.up('ShiftLeft');
  T.fastSim(0.3);
  const walkX = c.position.x;
  rec('M5', 'Atravessar a pé', walkX < L.corridor.minX - 5 && district(c.position.x, c.position.z) === 'TEST CITY',
    `de x -135 até x ${walkX.toFixed(1)} (z ${c.position.z.toFixed(1)}) · bairro ${district(c.position.x, c.position.z)}`);
  // M6) Limites: parede lateral do corredor e paredes do TEST CITY seguram o jogador.
  placeAt(-160, -8, north);
  T.down('ShiftLeft'); T.hold(['KeyW'], 4); T.up('ShiftLeft');
  const zc = c.position.z;
  placeAt(b.minX + 8, 0, west);
  T.down('ShiftLeft'); T.hold(['KeyW'], 4); T.up('ShiftLeft');
  const xw = c.position.x;
  placeAt(off.x + 30, b.minZ + 8, north);
  T.down('ShiftLeft'); T.hold(['KeyW'], 4); T.up('ShiftLeft');
  const zn = c.position.z;
  rec('M6', 'Limites fechados', zc > -12.2 && xw > b.minX && zn > b.minZ,
    `corredor z ${zc.toFixed(2)} (parede -12) · oeste x ${xw.toFixed(2)} (limite ${b.minX}) · norte z ${zn.toFixed(2)} (limite ${b.minZ})`);
  // M7) Relevo do GLB: colina do parque (até 4,5 m) sob o jogador.
  const hx = off.x + 75, hz = off.z + 75;
  placeAt(hx + 3, hz + 3, west);
  T.fastSim(1);
  rec('M7', 'Colina do parque', c.position.y > 3.6 && c.position.y < 4.8 && Math.abs(w.terrain.getHeight(hx, hz) - 4.48) < 0.2,
    `terreno ${w.terrain.getHeight(hx, hz).toFixed(2)} m no topo · jogador y ${c.position.y.toFixed(2)} após 1 s`);
  // M8) Superfícies (passos/pneus) vindas do GLB e do Sunset Beach.
  const sGrass = w.getSurface(hx + 3, hz + 3), sSlab = w.getSurface(off.x - 75 + 5, off.z - 75 + 5), sRoad = w.getSurface(off.x, off.z + 0.5), sLink = w.getSurface(-160, -9);
  rec('M8', 'Superfícies', sGrass === 'grass' && sSlab === 'concrete' && sRoad === 'asphalt' && sLink === 'concrete',
    `parque ${sGrass} · calçada ${sSlab} · rua ${sRoad} · corredor ${sLink}`);
  // M9) Prédios do GLB com colisão sólida no mundo unificado.
  const fp = tc.map.footprints.find((f) => f.h > 10);
  const solid = fp && w.collision.queryCircle(fp.x, fp.z, 0.5).some((k) => k.solid && k.maxY > 8);
  rec('M9', 'Prédios sólidos', solid && tc.map.footprints.length > 20, `${tc.map.footprints.length} prédios · ${fp?.id} em (${fp?.x.toFixed(1)}, ${fp?.z.toFixed(1)}) bloqueia: ${solid}`);

  // M10) De carro: Flamingo Street (Sunset) → cruzamento Z100 → rua X0 do TEST CITY.
  const v = g.vehicles.list.find((x) => !x.bike && x.spec.family !== 'boat' && x.type === 'sedan') || g.vehicles.list.find((x) => !x.bike);
  v.setPose(-110, 0, -2.1, -Math.PI / 2); v.physics.syncFromRoot();
  const state = T.enterVehicle(v.id);
  // Pista livre (sem trânsito) para medir só a geometria da ligação.
  const tm0 = g.city.traffic, savedMax = tm0.maxAgents;
  tm0.maxAgents = 0;
  for (const a of [...tm0.agents]) tm0._release(a);
  // Veículos deixados na pista (rodadas anteriores, carros abandonados) saem do caminho; o carro começa consertado.
  let cleared = 0;
  for (const o of g.vehicles.list) {
    const p = o.root.position;
    if (o === v || p.x > -95 || p.x < -320 || Math.abs(p.z) > 6) continue;
    o.setPose(-120 + cleared * 7, 0, 320, 0); o.physics?.syncFromRoot(); cleared++;
  }
  v.damage.repair();
  v.setPose(-110, 0, -2.1, -Math.PI / 2); v.physics.syncFromRoot();
  const int0 = v.damage.integrity;
  // Registra o que o carro atingir (diagnóstico do dano).
  const hits = [];
  T.down('KeyW');
  for (let i = 0; i < 160; i++) {
    T.fastSim(1 / 20);
    const ph = v.physics;
    if (ph.impact > 1) hits.push(`${ph.contacts.slice(0, 2).map((c) => `${c.collider.ownerId || c.collider.id}@${c.px.toFixed(0)},${c.pz.toFixed(0)}`).join('+')} ${ph.impact.toFixed(1)} m/s`);
  }
  T.up('KeyW');
  const carX = v.root.position.x, carZ = v.root.position.z, carV = v.physics.speed;
  T.down('KeyS');
  for (let i = 0; i < 60; i++) {
    T.fastSim(1 / 20);
    const ph = v.physics;
    if (ph.impact > 1) hits.push(`freando: ${ph.contacts.slice(0, 2).map((c) => `${c.collider.ownerId || c.collider.id}@${c.px.toFixed(0)},${c.pz.toFixed(0)}`).join('+')} ${ph.impact.toFixed(1)} m/s`);
  }
  T.up('KeyS');
  const int1 = v.damage.integrity;
  const hitInfo = hits.length ? ` (bateu em ${hits.slice(0, 3).join('; ')})` : '';
  rec('M10', 'Atravessar de carro', state === 'DRIVING' && carX < -190 && Math.abs(carZ) < 6 && int0 - int1 < 1,
    `${v.type}: x -110 → ${carX.toFixed(1)} em 8 s (z ${carZ.toFixed(1)}, ${(carV * 3.6).toFixed(0)} km/h) · dano ${(int0 - int1).toFixed(1)}${hitInfo} · bairro ${district(carX, carZ)}`);
  // M11) Dirigir de volta (leste) até o Sunset Beach.
  v.setPose(-300, 0, 2.1, Math.PI / 2); v.physics.syncFromRoot();
  T.hold(['KeyW'], 11);
  const backX = v.root.position.x;
  T.hold(['KeyS'], 3);
  const int2 = v.damage.integrity;
  g.vehicles.interaction.forceExit();
  T.fastSim(0.5);
  tm0.maxAgents = savedMax;
  rec('M11', 'Voltar de carro', backX > -150 && district(backX, v.root.position.z) === 'SUNSET BEACH' && int1 - int2 < 1, `x -300 → ${backX.toFixed(1)} em 11 s · dano ${(int1 - int2).toFixed(1)} · bairro ${district(backX, v.root.position.z)}`);

  // M12) Rede viária única: ruas do TEST CITY e ligação com a Flamingo Street.
  const graph = g.city.traffic.graph;
  const tcSegs = graph.segments.filter((s) => s.road.id.startsWith('tc_'));
  const inbound = graph.segments.find((s) => s.road.id === 'flamingo_w' && s.to === L.junction);
  const deep = tcSegs.find((s) => s.road.id === 'tc_x-50' && s.path.points[0].x < off.x - 40);
  const route = inbound && deep ? laneRoute(inbound, deep) : null;
  const outbound = graph.segments.find((s) => s.road.id === 'flamingo_w' && s.from === L.junction);
  const routeBack = outbound && deep ? laneRoute(deep, outbound) : null;
  rec('M12', 'Trânsito ligado', tcSegs.length > 60 && route?.length > 1 && routeBack?.length > 1,
    `${tcSegs.length} trechos do TEST CITY · rota Flamingo → X-50: ${route?.length ?? 0} trechos · volta: ${routeBack?.length ?? 0}`);
  // M13) Carros de trânsito circulam dentro do TEST CITY.
  const tm = g.city.traffic;
  placeAt(off.x + 10, off.z + 8, west);
  T.fastSim(25);
  const agentsIn = tm.agents.filter((a) => tc.contains(a.v.root.position.x, a.v.root.position.z));
  rec('M13', 'Carros no TEST CITY', agentsIn.length >= 2, `${agentsIn.length} de ${tm.agents.length} carros de trânsito dentro do TEST CITY após 25 s`);
  // M14) Pedestres: rede de calçadas e pedestres no bairro.
  const PM = g.city.peds;
  const nodesIn = PM.nodes.filter((n) => tc.contains(n.x, n.z)).length;
  const pedsIn = PM.peds.filter((p) => tc.contains(p.x, p.z)).length;
  rec('M14', 'Pedestres no TEST CITY', nodesIn > 100 && pedsIn >= 2, `${nodesIn} nós de calçada · ${pedsIn} pedestres no bairro`);
  // M15) Polícia: pontos de aparição nas ruas do TEST CITY.
  const pol = g.city.police;
  const sp = pol._spawnPoint({ x: off.x + 10, z: off.z + 8 })?.pos;
  rec('M15', 'Polícia no TEST CITY', sp && tc.contains(sp.x, sp.z) && boundsContains(w.playBounds, sp.x, sp.z), sp ? `viatura surgiria em (${sp.x.toFixed(1)}, ${sp.z.toFixed(1)})` : 'nenhum ponto');
  // M16) Radar: área jogável unida e prédios do TEST CITY.
  const mm = g.minimap;
  let mmOk = true;
  try { mm.timer = 0; mm.update(0.2, c.position, 0); } catch (e) { mmOk = false; }
  rec('M16', 'Radar', mmOk && mm.bounds.rects?.length === 3 && mm.buildings.length >= w.districts[0].buildings.length + 20 && mm.roads.length === w.roads.roads.size,
    `${mm.bounds.rects?.length} áreas · ${mm.roads.length} ruas · ${mm.buildings.length} prédios desenhados`);
  // M17) Interior de teste do TEST CITY continua acessível no bairro.
  const ir = T.enterInterior('test_room');
  const ext = g.interiors.exteriors.find((e) => e.def.id === 'test_room');
  const inOk = ir.active === 'test_room';
  g.interiors._forceOutside(); T.fastSim(0.5);
  rec('M17', 'Sala de teste', inOk && tc.contains(ext.poi.x, ext.poi.z), `porta em (${ext?.poi.x.toFixed(1)}, ${ext?.poi.z.toFixed(1)}) · entrou: ${ir.active}`);
  // M18) Salvamento: posição no TEST CITY volta igual.
  placeAt(off.x - 20, off.z + 3, west);
  const before = c.position.clone();
  const sv = await g.save.save('slot3');
  placeAt(-100, 60, west);
  const ld = await g.save.load('slot3');
  T.fastSim(0.5);
  const dSave = c.position.distanceTo(before);
  rec('M18', 'Salvar/carregar no TEST CITY', sv?.ok !== false && ld?.ok !== false && dSave < 0.6, `save ${sv?.ok !== false ? 'ok' : sv?.msg} · load ${ld?.ok !== false ? 'ok' : ld?.msg} · desvio ${dSave.toFixed(2)} m`);
  // M19) F8 (dev): leva de um bairro ao outro no mesmo mapa.
  placeAt(-100, 60, west);
  const t1 = g.travelBetweenDistricts();
  const d1 = district(c.position.x, c.position.z);
  const t2 = g.travelBetweenDistricts();
  const d2 = district(c.position.x, c.position.z);
  rec('M19', 'F8 entre bairros', t1 && t2 && d1 === 'TEST CITY' && d2 === 'SUNSET BEACH' && g.maps.activeId === 'sunset-beach', `F8 → ${d1} → ${d2} (mapa ${g.maps.activeId})`);
  // M20) O TEST CITY isolado (ferramenta de dev) continua funcionando e a volta mantém o bairro.
  const okIso = await g.maps.activate('test-city');
  const iso = g.mapEnv;
  const isoOk = okIso && iso.isImported && iso.collision !== w.collision && iso.bounds.minX === -108;
  const okBack = await g.maps.activate('sunset-beach');
  T.fastSim(0.5);
  rec('M20', 'TEST CITY isolado preservado', isoOk && okBack && g.mapEnv === w && tc.ready && w.collision.colliders.has('tc_bound_west') && !w.collision.colliders.has('bound_west_link'),
    `isolado: ${okIso ? 'ok' : 'falhou'} (limites ±108, colisão própria) · volta ao mundo: ${okBack ? 'ok' : 'falhou'}`);

  console.error = oldErr;
  rec('M21', 'Console sem erros', errors.length === 0, errors.length ? errors.slice(0, 2).join(' | ') : 'nenhum erro');
  return { passed: results.filter((r) => r.ok).length, total: results.length, results, errors };
}
