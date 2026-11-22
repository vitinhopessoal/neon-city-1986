import * as THREE from 'three';
import { NEON_DEFS, trafficWeights, TRAFFIC_BASE } from '../vehicles/models/NeonMotor.js';
import { PARTS, isCompatible, defaultConfig } from '../vehicles/customization/CustomizationCatalog.js';
import { partSummary } from '../vehicles/customization/VehicleAppearance.js';

/**
 * PROMPT 12 — NEON MOTOR COMPANY: validação no JOGO REAL dos nove modelos.
 * Para cada carro: carregamento, surgimento, colisões, entrada, saída, aceleração,
 * frenagem, curvas, câmeras, rodas, faróis, danos, garagem, salvamento,
 * personalização e trânsito IA; ao final, ausência de erros no console.
 * Pista: Ocean Avenue (faixa norte x 25,75; livre de z −300 até o limite do mapa em z 169), trânsito suspenso durante a bateria.
 */
export async function runNeonMotorSuite(T, { types = NEON_DEFS.map((d) => d.type), saveLoad = true } = {}) {
  const g = window.__NEON__;
  const vm = g.vehicles;
  const F = g.world.vehicleFactory;
  const errors = [];
  const oldErr = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); oldErr.apply(console, a); };
  const results = {};
  const metrics = {};
  const tm = g.city?.traffic;
  const savedMax = tm?.maxAgents;
  const kmh = (ms) => Math.round(ms * 3.6);
  // Sonda baixa: o colisor do carro é "andável" e não pode ser confundido com o chão.
  const groundAt = (x, z) => g.mapEnv.collision.getGroundHeight(x, z, 0.1, 0.3); // só superfícies até 0,4 m (asfalto/calçada)
  // Trânsito fora da pista de testes.
  if (tm) { tm.maxAgents = 0; for (const a of [...tm.agents]) tm._release(a); }
  if (vm.state !== 'ON_FOOT') { vm.interaction.forceExit(); T.fastSim(0.5); }
  const PM = g.city?.police;
  const policeHooks = PM ? { report: PM.report, crime: PM.crime } : null;
  if (PM) { PM.report = () => 0; PM.crime = () => 0; }
  const LANE_X = 25.75; // faixa norte da Ocean Avenue (x 28 é o canteiro central)
  // Área de espera dos carros já testados (outra faixa, longe da pista e da fila do salvamento).
  const HOLD = { x: 22.25, z: 2 };
  /** Estaciona na primeira vaga livre da área de espera (duas colunas, sem empilhar carros). */
  function park(o) {
    for (const x of [HOLD.x, HOLD.x - 3.5]) for (let z = HOLD.z; z < 160; z += 7) {
      if (vm.list.some((q) => q !== o && q.root.visible && Math.hypot(q.root.position.x - x, q.root.position.z - z) < 4)) continue;
      o.setPose(x, groundAt(x, z), z, 0); o.physics?.syncFromRoot(); return;
    }
  }

  function spawn(type, id, x, z, heading = 0) {
    const old = vm.list.find((v) => v.id === id);
    if (old) { vm.removeVehicle(old); F.dispose(old); }
    const v = F.create(type, { id, plate: 'TEST' });
    (g.properties.garage.group || g.scene).add(v.root);
    v.setPose(x, groundAt(x, z), z, heading);
    v.attachCollider(g.mapEnv.collision);
    vm.addVehicle(v);
    return v;
  }
  const rec = (type, k, ok, detail) => { (results[type] ||= []).push({ test: k, ok: !!ok, detail }); };
  /** Zera o nível de procurado: a bateria entra em carros alheios e bate em paredes várias vezes,
   *  o que (corretamente) atrai a polícia e terminaria em prisão no meio de um teste. */
  function calmPolice() {
    const P = g.city?.police;
    if (!P) return;
    P.clear();
    if (g.state === 'busted' || g.state === 'wasted') g.state = 'playing';
    P.crimes?.reset?.();
    P._wanted = 0;
    P.lastSeen = -Infinity;
    g.player.status.setWanted(0);
    g.player.status.setHealth(100); // cada batida de teste fere o motorista (recurso existente): sem isto ele morre na 2ª rodada
    g.player.status.searching = false;
  }
  /** Freia até parar (sem engatar a ré) e puxa o freio de mão. */
  function stopCar(v) {
    for (let i = 0; i < 600 && Math.abs(v.physics.vLong) > 0.3; i++) {
      const k = v.physics.vLong > 0 ? 'KeyS' : 'KeyW';
      T.down(k); T.fastSim(1 / 60); T.up(k);
    }
    T.hold(['Space'], 0.4);
    T.fastSim(0.3);
  }

  for (const type of types) {
    const d = NEON_DEFS.find((e) => e.type === type);
    const m = (metrics[type] = { name: d.name, category: d.category });
    const id = `nmtest_${type}`;
    let v;
    try {
      // 1) Carregamento.
      const tpl = F.neon.templates.get(type);
      let tris = 0;
      tpl?.scene.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
      m.triangles = Math.round(tris);
      rec(type, 'Carregamento', !!tpl, tpl ? `GLB ${d.file}.glb · ${m.triangles} triângulos` : 'GLB ausente');
      calmPolice();
      // Pista livre: nenhum outro veículo visível no corredor de testes.
      for (const o of vm.list) {
        const p = o.root.position;
        if (o.id !== id && o.root.visible && Math.abs(p.x - LANE_X) < 2.5 && p.z > -300 && p.z < 170) { park(o); }
      }
      // 2) Surgimento.
      v = spawn(type, id, LANE_X, -290, 0);
      T.fastSim(0.3);
      const y0 = v.root.position.y;
      const overlap = g.mapEnv.collision.resolveOBB({ x: v.root.position.x, z: v.root.position.z, rot: v.heading, hx: v.spec.width / 2, hz: v.spec.length / 2 }, y0, v.spec.height * 0.9, 0.32, v.id, [], 1);
      rec(type, 'Surgimento', v.physics && v.animation && v.damage && v.neon && overlap === 0, `y ${y0.toFixed(2)} · física/animação/danos · sobreposições ${overlap}`);
      // 4) Entrada.
      const st = T.enterVehicle(id);
      const seated = vm.playerVehicle === v;
      // Cabeça abaixo do teto: vértices do protagonista JÁ DEFORMADOS pela pose sentada
      // (o bounding box padrão de malha com esqueleto fica na pose de repouso).
      T.fastSim(0.6);
      const pm = g.player.modelMode === 'glb' && g.player.visual ? g.player.visual.root : g.player.model.root;
      pm.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(pm, true);
      const headTop = box.max.y - v.root.position.y;
      const roofOut = d.body.rear === 'roadster' ? Infinity : d.body.roofY;
      m.headTop = +headTop.toFixed(3);
      m.roofY = d.body.roofY;
      rec(type, 'Entrada', st === 'DRIVING' && seated && headTop < roofOut - 0.025, `estado ${st} · topo da cabeça ${headTop.toFixed(3)} m · teto ${Number.isFinite(roofOut) ? roofOut.toFixed(2) + ' (forro ' + (roofOut - 0.03).toFixed(2) + ')' : 'aberto (conversível)'}`);
      // 9) Câmeras (perseguição e interna).
      T.fastSim(0.5);
      const camD = g.camera.position.distanceTo(v.root.position);
      T.fastTap('KeyV'); T.fastSim(0.4);
      const camIn = g.camera.position.clone();
      const local = v.root.worldToLocal(camIn.clone());
      const inside = Math.abs(local.x) < v.spec.width / 2 && local.y < (d.body.rear === 'roadster' ? 2 : d.body.roofY) && local.y > d.dims.floorY;
      T.fastTap('KeyV'); T.fastSim(0.3);
      rec(type, 'Câmeras', camD > 4 && camD < 14 && inside, `perseguição ${camD.toFixed(1)} m · interna (${local.x.toFixed(2)}, ${local.y.toFixed(2)}, ${local.z.toFixed(2)})`);
      // 6) Aceleração (5 s) + 10) rodas girando.
      const spin0 = v.wheels[0].spin.rotation.x;
      T.hold(['KeyW'], 5);
      const v5 = v.physics.vLong;
      m.speed5s = kmh(v5);
      const spun = Math.abs(v.wheels[0].spin.rotation.x - spin0) > 10;
      T.hold(['KeyW'], 4); // 9 s no total: a reta acaba no limite do mapa (z 169)
      m.speed9s = kmh(v.physics.vLong);
      rec(type, 'Aceleração', v5 > 12, `${m.speed5s} km/h em 5 s · ${m.speed9s} km/h em 9 s`);
      // 7) Frenagem.
      const vb = v.physics.vLong;
      T.hold(['KeyS'], 1.0);
      const dropBrake = vb - v.physics.vLong;
      m.brake1s = +(dropBrake).toFixed(1);
      rec(type, 'Frenagem', dropBrake > 6, `perdeu ${dropBrake.toFixed(1)} m/s em 1 s (de ${kmh(vb)} km/h)`);
      stopCar(v);
      // 8) Curvas (volta ao início da reta, 12 m/s, A por 2 s).
      v.setPose(LANE_X, groundAt(LANE_X, -250), -250, 0); v.physics.syncFromRoot(); v.physics.wake();
      T.hold(['KeyW'], 2.2);
      const h0 = v.physics.heading;
      for (const c of ['KeyW', 'KeyA']) T.down(c);
      T.fastSim(0.5);
      const steerFront = v.wheels.filter((w) => w.steer).every((w) => Math.abs(w.pivot.rotation.y) > 0.05) && v.wheels.filter((w) => !w.steer).every((w) => Math.abs(w.pivot.rotation.y) < 1e-6);
      const swRot = v.steeringWheel ? Math.abs(v.steeringWheel.rotation.y) : 0;
      T.fastSim(1.5);
      for (const c of ['KeyW', 'KeyA']) T.up(c);
      const turned = v.physics.heading - h0;
      m.turn2s = +turned.toFixed(2);
      rec(type, 'Curvas', turned > 0.5, `giro ${turned.toFixed(2)} rad em 2 s (esquerda) · rolagem ${v.animation.roll.toFixed(3)} rad`);
      stopCar(v);
      // 10) Rodas: giro, esterçamento só na dianteira, pneus no chão, volante acompanha.
      v.root.updateMatrixWorld(true);
      const wp = new THREE.Vector3();
      T.fastSim(1.0); // suspensão assenta depois da frenagem
      v.root.updateMatrixWorld(true);
      let gapMax = 0;
      for (const w of v.wheels) { w.pivot.getWorldPosition(wp); gapMax = Math.max(gapMax, Math.abs(wp.y - w.radius - groundAt(wp.x, wp.z))); }
      const touch = gapMax < 0.06;
      rec(type, 'Rodas', spun && steerFront && swRot > 0.2 && touch, `giro ${spun ? 'sim' : 'não'} · esterçamento dianteiro ${steerFront ? 'sim' : 'não'} · volante ${swRot.toFixed(2)} rad · pneu-chão máx. ${(gapMax * 100).toFixed(1)} cm`);
      // 11) Faróis (e escamoteáveis): carro reparado (farol quebrado não acende, como previsto).
      v.damage.repair(); v.headlightBroken = false;
      v.headlightsOn = true;
      v.animation.update(1.2, true);
      const lampOn = v.mats.headlight.emissiveIntensity;
      const pop = v.popups.length ? v.popups.every((p) => p.pivot.rotation.x < -0.6) : true;
      v.headlightsOn = false;
      v.animation.update(1.2, true);
      const lampOff = v.mats.headlight.emissiveIntensity;
      const popClosed = v.popups.length ? v.popups.every((p) => p.pivot.rotation.x > -0.25) : true;
      rec(type, 'Faróis', lampOn > 2 && lampOff < 0.5 && pop && popClosed, `farol ${lampOff.toFixed(2)}→${lampOn.toFixed(2)}${v.popups.length ? ` · escamoteáveis abrem/fecham (${v.popups.length})` : ''} · lanterna de freio ${v.mats.taillight.emissiveIntensity.toFixed(2)}`);
      // 3) Colisões + 12) danos: parede temporária à frente, o jogador acelera até ~45 km/h e bate.
      calmPolice();
      const wallZ = -150;
      const wall = g.mapEnv.collision.addBox({ id: 'nm_test_wall', cx: LANE_X, cz: wallZ + 0.5, hx: 4, hz: 0.5, rotation: 0, minY: 0, maxY: 3, tags: ['test'] });
      v.setPose(LANE_X, groundAt(LANE_X, -185), -185, 0); v.physics.syncFromRoot(); v.physics.wake();
      v.damage.repair();
      const integ0 = v.damage.integrity;
      let maxFront = -Infinity, peak = 0, pedal = true, vTop = 0;
      const drivingAtStart = vm.state === 'DRIVING' && vm.playerVehicle === v;
      const seen = new Set();
      T.down('KeyW');
      for (let i = 0; i < 420; i++) {
        if (pedal && v.physics.vLong >= 12.5) { T.up('KeyW'); pedal = false; }
        T.fastSim(1 / 60);
        peak = Math.max(peak, v.physics.impact || 0); vTop = Math.max(vTop, v.physics.vLong);
        seen.add(`${g.state}:${vm.state}:${vm.interaction.state}:${vm.interaction.vehicle?.id === v.id}`);
        maxFront = Math.max(maxFront, v.physics.z + v.spec.length / 2 * Math.cos(v.physics.heading));
      }
      T.up('KeyW');
      const integ1 = v.damage.integrity;
      stopCar(v);
      g.mapEnv.collision.remove(wall.id || 'nm_test_wall');
      const stopped = maxFront <= wallZ + 0.15 && maxFront > wallZ - 1.5;
      rec(type, 'Colisões', stopped && peak > 5, `frente parou em z ${maxFront.toFixed(2)} (parede em ${wallZ}) · impacto ${peak.toFixed(1)} m/s · vel. máx. ${kmh(vTop)} km/h · dirigindo ${drivingAtStart ? 'sim' : vm.state}`);
      rec(type, 'Danos', integ1 < integ0, `integridade ${integ0}→${integ1.toFixed(1)} · rugosidade da pintura ${v.mats.paint.roughness.toFixed(2)}`);
      // 5) Saída.
      T.fastTap('KeyE');
      for (let i = 0; i < 240 && vm.state !== 'ON_FOOT'; i++) T.fastSim(1 / 60);
      const pp = g.player.controller.position;
      const lp = v.root.worldToLocal(pp.clone());
      const outside = Math.abs(lp.x) > v.spec.width / 2 - 0.05 || Math.abs(lp.z) > v.spec.length / 2;
      rec(type, 'Saída', vm.state === 'ON_FOOT' && outside, `estado ${vm.state} · jogador a ${lp.x.toFixed(2)} m do eixo do carro`);
      // 15) Personalização (peça compatível por categoria; outra instância do modelo não muda).
      const cfg = { ...defaultConfig(v), paint: 'ocean_blue' };
      const picked = [];
      for (const cat of ['wheels', 'tires', 'bumper', 'skirts', 'spoiler', 'hood', 'exhaust', 'lights', 'tint', 'interior']) {
        const opt = PARTS[cat]?.options.find((o, i) => i > 0 && isCompatible(cat, o.id, type, cfg));
        if (opt) { cfg[cat] = typeof PARTS[cat].options[0].id === 'number' ? opt.id : opt.id; picked.push(`${cat}:${opt.id}`); }
      }
      // Melhorias mecânicas são níveis (0..3), não peças.
      Object.assign(cfg, { engine: 2, trans: 1, brakes: 1, susp: 1 });
      picked.push('motor 2', 'transmissão 1', 'freios 1', 'suspensão 1');
      v.damage.repair(); // o dano escurece a pintura: a cor é conferida no carro reparado
      const other = vm.list.find((o) => o.type === type && o !== v);
      const otherColor = other?.mats.paint.color.getHex();
      const before = { maxSpeed: v.spec.handling.maxSpeed };
      g.customs.applyConfig(v, cfg);
      const parts = partSummary(v);
      const paintOk = v.mats.paint.color.getHex() === 0x1f5fa8;
      const otherOk = !other || other.mats.paint.color.getHex() === otherColor;
      rec(type, 'Personalização', paintOk && otherOk && parts.length > 0, `${picked.length} opções (${picked.slice(0, 5).join(', ')}…) · peças ${parts.length} · outra instância intacta ${otherOk ? 'sim' : 'não'} · vmax ${before.maxSpeed}→${v.spec.handling.maxSpeed.toFixed(1)}`);
      // 13) Garagem (Azure Condo, baia de rua): guarda e retira o mesmo carro com as peças.
      const P = g.properties;
      const G = P.garage;
      const gar = G.garages.get('garage_condo');
      let gOk = false, gDetail = 'garagem indisponível';
      if (gar) {
        P.owned.add(gar.prop.id);
        for (const r of [...gar.vehicles]) gar.vehicles.splice(gar.vehicles.indexOf(r), 1);
        const bay = gar.bays[0];
        // Baias livres (carros de testes anteriores vão para a área de espera).
        for (const o of vm.list) {
          if (o !== v && o.root.visible && gar.bays.some((b) => Math.hypot(o.root.position.x - b.x, o.root.position.z - b.z) < 5)) { park(o); }
        }
        v.damage.repair();
        v.setPose(bay.x, groundAt(bay.x, bay.z), bay.z, bay.heading);
        T.fastPlace(bay.x + 4, bay.z, 0);
        T.fastSim(0.2);
        const s = G.store('garage_condo');
        const hiddenNow = !vm.list.includes(v);
        T.fastPlace(bay.x + 9, bay.z + 9, 0);
        const pid = s.rec?.pid;
        const r = s.ok ? G.retrieve('garage_condo', pid) : { ok: false, msg: 'não guardou' };
        const nv = r.vehicle;
        const copies = vm.list.filter((o) => (o.persistId || o.id) === pid).length;
        gOk = s.ok && hiddenNow && r.ok && nv?.type === type && copies === 1 && nv.custom?.paint === 'ocean_blue' && partSummary(nv).length === parts.length;
        gDetail = `${s.msg} → ${r.msg} · cópias ${copies} · peças ${nv ? partSummary(nv).length : 0}/${parts.length}`;
        if (nv) { v = nv; park(v); }
      }
      rec(type, 'Garagem', gOk, gDetail);
      // 16) Trânsito IA: o modelo entra no trânsito existente e anda na faixa.
      if (tm) {
        tm.maxAgents = 1;
        const tv = F.create(type, { id: `traffic_nm_${type}`, plate: 'SB TEST' });
        tm.group.add(tv.root);
        const orig = tm._acquire;
        tm._acquire = () => tv;
        T.fastPlace(LANE_X - 60, 60, 0);
        let agent = null;
        for (let k = 0; k < 40 && !agent; k++) { agent = tm._trySpawn(g.player.controller.position); }
        tm._acquire = orig;
        let moved = 0, stateSeen = '';
        if (agent) {
          const p0 = tv.root.position.clone();
          T.fastSim(6);
          moved = tv.root.position.distanceTo(p0);
          stateSeen = agent.state;
        }
        rec(type, 'Trânsito IA', !!agent && (moved > 8 || /stop|wait|yield|queue|light|follow/i.test(String(stateSeen))), agent ? `andou ${moved.toFixed(1)} m em 6 s · estado ${stateSeen}` : 'não surgiu');
        if (agent) tm._release(agent);
        tm.maxAgents = 0;
      }
    } catch (e) {
      rec(type, 'Exceção', false, String(e?.stack || e).slice(0, 300));
    }
  }

  // 14) Salvamento: os nove carros (personalizados) no mundo → save → load.
  if (saveLoad) {
    const owned = [];
    let i = 0;
    for (const type of types) {
      let v = vm.list.find((o) => o.type === type && (o.persistId || o.id).startsWith('nmtest_'));
      if (!v) continue;
      const z = -120 + i * 9; i++;
      v.setPose(LANE_X, groundAt(LANE_X, z), z, 0); v.physics.syncFromRoot();
      g.properties.garage.owned.add(v.persistId || v.id);
      owned.push({ type, pid: v.persistId || v.id, z, paint: v.custom?.paint });
    }
    T.fastPlace(LANE_X - 8, -80, 0);
    const sv = await g.save.save('slot3');
    // Bagunça o estado: some com os carros e recarrega.
    for (const o of owned) { const v = vm.list.find((x) => (x.persistId || x.id) === o.pid); if (v) v.setPose(LANE_X, 0, 400, 0); }
    const ld = await g.save.load('slot3');
    T.fastSim(0.5);
    for (const o of owned) {
      const copies = vm.list.filter((x) => (x.persistId || x.id) === o.pid);
      const v = copies[0];
      const ok = sv?.ok !== false && copies.length === 1 && v.type === o.type && Math.abs(v.root.position.z - o.z) < 1.5 && v.custom?.paint === o.paint;
      rec(o.type, 'Salvamento', ok, `save ${sv?.ok !== false ? 'ok' : sv?.msg} · load ${ld?.ok !== false ? 'ok' : ld?.msg} · cópias ${copies.length} · z ${v ? v.root.position.z.toFixed(1) : '-'} · pintura ${v?.custom?.paint}`);
    }
  }

  // Pesos do trânsito (10 000 sorteios por zona, sem criar veículos).
  const dist = {};
  for (const [x, z, zone] of [[-30, 60, 'residential'], [19, 40, 'commercial'], [36, 40, 'nightlife'], [10, -250, 'rich']]) {
    const w = trafficWeights(x, z);
    const tot = w.reduce((s, e) => s + e[1], 0);
    dist[zone] = Object.fromEntries(w.map(([t, k]) => [t, +(100 * k / tot).toFixed(1)]));
  }
  if (tm) tm.maxAgents = savedMax;
  if (PM && policeHooks) { PM.report = policeHooks.report; PM.crime = policeHooks.crime; calmPolice(); }
  console.error = oldErr;
  // 17) Console.
  for (const type of types) rec(type, 'Console sem erros', errors.length === 0, errors.length ? errors.slice(0, 2).join(' | ') : 'nenhum erro');
  const flat = Object.entries(results).flatMap(([t, l]) => l.map((r) => ({ type: t, ...r })));
  return { passed: flat.filter((r) => r.ok).length, total: flat.length, results, metrics, trafficDistribution: dist, errors };
}
