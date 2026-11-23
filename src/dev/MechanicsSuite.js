import { applyPerformance } from '../vehicles/customization/VehiclePerformance.js';
import { defaultConfig } from '../vehicles/customization/CustomizationCatalog.js';
import { drivetrainFor } from '../vehicles/mechanics/drivetrains.js';

/**
 * Mecânica veicular no JOGO REAL: entra no carro com E e dirige com as teclas de verdade
 * (W/S/A/D, Espaço, Shift, Z/X, B) através do InputManager; lê física, HUD e áudio.
 * Pista: Ocean Avenue, faixa norte x 25,75 (livre de z −300 a 169), trânsito suspenso
 * durante a bateria (exceto no teste de trânsito). Uso: await __NEON_TEST__.mechanicsSuite()
 */
export async function runMechanicsSuite(T) {
  const g = window.__NEON__, vm = g.vehicles, F = g.world.vehicleFactory;
  const results = [];
  const integrityLog = [];
  const rec = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok, detail }); const pv = vm.playerVehicle; if (pv) integrityLog.push(id + ':' + Math.round(pv.damage.integrity)); };
  const errors = [];
  const oldErr = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); oldErr.apply(console, a); };
  const tm = g.city?.traffic, savedMax = tm?.maxAgents;
  if (tm) { tm.maxAgents = 0; for (const a of [...tm.agents]) tm._release(a); }
  const PM = g.city?.police;
  const hooks = PM ? { report: PM.report, crime: PM.crime } : null;
  if (PM) { PM.report = () => 0; PM.crime = () => 0; }
  if (vm.state !== 'ON_FOOT') { vm.interaction.forceExit(); T.fastSim(0.5); }
  const savedMode = vm.transmissionMode;
  if (vm.transmissionMode !== 'automatic') vm.toggleTransmission(null);
  const LANE_X = 25.75;
  const groundAt = (x, z) => g.mapEnv.collision.getGroundHeight(x, z, 0.1, 0.3);
  const hud = vm.hud, refs = hud.refs;
  const kmh = (v) => Math.abs(v.physics.vLong) * 3.6;
  const drain = () => { const e = hud.lastEvents.slice(); hud.lastEvents.length = 0; return e; };
  const stopCar = (v) => { T.hold(['KeyS'], 0.1); v.physics.vx = v.physics.vz = v.physics.vLong = v.physics.vLat = 0; v.physics.yawRate = 0; T.fastSim(0.3); };
  const place = (v, z, heading = 0, x = LANE_X) => {
    v.setPose(x, groundAt(x, z), z, heading); v.physics.syncFromRoot(); v.physics.wake(); T.fastSim(0.1);
  };
  function spawn(type, id) {
    const old = vm.list.find((v) => v.id === id);
    if (old) { vm.removeVehicle(old); F.dispose(old); }
    const v = F.create(type, { id, plate: 'MECH' });
    (g.properties.garage.group || g.scene).add(v.root);
    v.setPose(LANE_X - 6, groundAt(LANE_X - 6, -280), -280, 0);
    v.attachCollider(g.mapEnv.collision);
    vm.addVehicle(v);
    return v;
  }
  function drive(type, id) {
    if (vm.state !== 'ON_FOOT') { vm.interaction.forceExit(); T.fastSim(0.6); }
    const v = spawn(type, id);
    T.enterVehicle(v.id);
    place(v, -280);
    T.fastSim(0.3);
    drain();
    return v;
  }
  const hudText = () => ({ gear: refs.gear.textContent, mode: refs.mode.textContent, feedback: refs.feedback.textContent, show: refs.feedback.classList.contains('show') });
  const hudRefresh = () => { hud._timer = 0; hud.update(0.05); };

  // ---------------------------------------------------------------- sedã esportivo (RWD)
  let v = drive('sports', 'mech_sports');
  hudRefresh();
  rec('X1', 'Módulo ativo e painel mecânico sem guias de controles', v.physics.powertrain && v.physics.powertrainActive && hud.el.classList.contains('has-pt') && hudText().mode === 'AUT' && !hud.el.querySelector('.veh-keys'),
    `powertrain ${!!v.physics.powertrain} · ativo ${v.physics.powertrainActive} · painel ${hud.el.classList.contains('has-pt')} · modo ${hudText().mode} · tração ${v.physics.powertrain?.drivetrain.layout}`);

  // Acelerar (W) com trocas automáticas.
  const gears = new Set(); let maxRpm = 0, cutSeen = false;
  T.down('KeyW');
  for (let i = 0; i < 60; i++) { T.fastSim(0.1); gears.add(v.physics.gear); maxRpm = Math.max(maxRpm, v.physics.rpm); if (v.physics.powertrainFrame?.shifting && v.physics.powertrainFrame.driveForceN === 0) cutSeen = true; }
  T.up('KeyW');
  hudRefresh();
  const evA = drain();
  const p = v.physics.powertrain.profile;
  rec('X2', 'Acelerar: motor, RPM e marchas automáticas', kmh(v) > 100 && gears.has(1) && gears.has(3) && maxRpm <= p.engine.redlineRpm + 1 && String(v.physics.gear) === hudText().gear,
    `${kmh(v).toFixed(0)} km/h em 6 s · marchas ${[...gears].join(',')} · RPM máx ${maxRpm.toFixed(0)}/${p.engine.redlineRpm} · painel "${hudText().gear}"`);
  rec('X3', 'Trocas com interrupção de força', cutSeen && evA.filter((e) => e.type === 'shift_complete').length >= 3,
    `${evA.filter((e) => e.type === 'shift_complete').length} trocas · corte observado ${cutSeen}`);

  // Frear (S): ABS no limite, sem travar.
  let lock = false, abs = false; const z0 = v.physics.z, v0 = kmh(v);
  T.down('KeyS');
  for (let i = 0; i < 120 && v.physics.vLong > 0.3; i++) { T.fastSim(1 / 20); lock ||= v.physics.brakeLock.front; abs ||= v.physics.absActive; }
  T.up('KeyS');
  const dist = v.physics.z - z0;
  rec('X4', 'Frear com ABS', kmh(v) < 3 && !lock && dist > 10, `${v0.toFixed(0)} → ${kmh(v).toFixed(0)} km/h em ${dist.toFixed(1)} m · ABS atuou ${abs} · travou ${lock}`);

  // Virar (A/D): direção sensível à velocidade.
  place(v, -260); stopCar(v); v.physics.vz = v.physics.vLong = 25; T.down('KeyW'); T.fastSim(0.2);
  const steerFast = (() => { T.down('KeyD'); T.fastSim(0.6); const s = Math.abs(v.physics.steerAngle); T.up('KeyD'); return s; })();
  T.up('KeyW'); const fastKmh = kmh(v);
  stopCar(v); const h0 = v.physics.heading; T.down('KeyW'); T.down('KeyA'); T.fastSim(1.5); const steerSlow = Math.abs(v.physics.steerAngle); T.up('KeyA'); T.up('KeyW');
  rec('X5', 'Virar: menos esterço em alta', steerSlow > steerFast * 1.3 && Math.abs(v.physics.heading - h0) > 0.2, `esterço em baixa ${steerSlow.toFixed(3)} rad · a ${fastKmh.toFixed(0)} km/h ${steerFast.toFixed(3)} rad · guinada ${(v.physics.heading - h0).toFixed(2)} rad`);

  // Ré (S parado).
  place(v, -250); stopCar(v); T.down('KeyS'); T.fastSim(2.5); T.up('KeyS'); hudRefresh();
  rec('X6', 'Ré pelo S', v.physics.gear === 'R' && v.physics.vLong < -1 && hudText().gear === 'R', `marcha ${v.physics.gear} · ${v.physics.vLong.toFixed(1)} m/s · painel ${hudText().gear}`);
  stopCar(v);

  // Câmbio manual (B), Z/X, avaliação da troca.
  T.fastTap('KeyB'); hudRefresh();
  const manual = v.physics.powertrain.snapshot().mode === 'manual' && hudText().mode === 'MAN';
  place(v, -280); stopCar(v); drain();
  T.down('KeyW'); T.fastSim(0.5); T.fastTap('KeyX'); T.fastSim(0.5);
  const g2 = v.physics.gear;
  const ideal = v.physics.powertrain.upshiftRpms[1];
  for (let i = 0; i < 400 && v.physics.rpm < ideal - 40; i++) T.fastSim(1 / 60);
  T.fastTap('KeyX'); T.fastSim(0.05); hudRefresh();
  const fbPerfect = hudText();
  T.fastSim(0.6); T.up('KeyW');
  const evM = drain();
  // Reduzir só depois de frear: em alta, a redução que estouraria o giro é recusada (testado à parte).
  T.fastTap('KeyZ'); T.fastSim(0.1);
  const refused = drain().some((e) => e.type === 'shift_rejected' && e.reason === 'would_overrev') || v.physics.gear === 2;
  T.hold(['KeyS'], 1.2); T.fastTap('KeyZ'); T.fastSim(0.6);
  const afterDown = v.physics.gear;
  rec('X7', 'Câmbio manual com B, X/Z e aviso de troca', manual && g2 === 2 && afterDown === 2 && refused && evM.some((e) => e.type === 'shift_quality' && e.quality === 'early') && evM.some((e) => e.type === 'shift_quality' && e.quality === 'perfect') && fbPerfect.feedback === 'TROCA PERFEITA',
    `modo ${hudText().mode} · X→${g2} · trocas ${evM.filter((e) => e.type === 'shift_quality').map((e) => e.quality).join(',')} · painel "${fbPerfect.feedback}" · Z em alta recusado ${refused} · Z após frear→${afterDown}`);

  // Neutro: parado, Z de 1ª → N; W só sobe o giro.
  stopCar(v); if (v.physics.powertrain.snapshot().gear !== 1) { v.controls.selectGear = 1; T.fastSim(0.4); delete v.controls.selectGear; }
  T.fastTap('KeyZ'); T.fastSim(0.5);
  const gN = v.physics.gear; const zN = v.physics.z;
  T.down('KeyW'); T.fastSim(1); const rpmN = v.physics.rpm; T.up('KeyW');
  rec('X8', 'Neutro', gN === 'N' && Math.abs(v.physics.z - zN) < 0.1 && rpmN > p.engine.idleRpm * 2, `marcha ${gN} · deslocamento ${(v.physics.z - zN).toFixed(2)} m · giro em neutro ${rpmN.toFixed(0)}`);
  T.fastTap('KeyX'); T.fastSim(0.5);
  T.fastTap('KeyB'); // volta ao automático

  // Largada: Espaço + W parado; soltar o Espaço.
  place(v, -280); stopCar(v); drain();
  // O giro sobe devagar ao preparar: soltar o freio de mão com a luz verde (faixa boa) dá largada perfeita.
  T.down('Space'); T.down('KeyW');
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) { T.fastSim(1 / 30); hudRefresh(); ready = refs.launch.classList.contains('ready'); }
  T.fastSim(0.15); hudRefresh();
  const staged = v.physics.powertrainFrame.staged && refs.launch.classList.contains('ready') && Math.abs(v.physics.vLong) < 0.05;
  const rpmStaged = v.physics.rpm;
  T.up('Space'); T.fastSim(0.4); hudRefresh();
  const launch = drain().find((e) => e.type === 'launch');
  T.up('KeyW');
  rec('X9', 'Preparação de largada e aviso', staged && launch?.quality === 'good' && hudText().feedback === 'LARGADA PERFEITA' && v.physics.vLong > 2, `preparado ${staged} a ${rpmStaged.toFixed(0)} RPM · largada ${launch?.quality} · painel "${hudText().feedback}" · ${kmh(v).toFixed(0)} km/h após 0,4 s`);

  // Nitro (Shift) a ~110 km/h: compara com e sem.
  const runNitro = (on) => {
    place(v, -280); stopCar(v); v.damage.repair(); v.physics.powertrain.awardNitrous(1);
    const int0 = v.damage.integrity;
    // Acima de ~140 km/h o motor (e não a aderência) limita: é ali que o nitro rende.
    v.physics.vz = v.physics.vLong = 40; v.controls.selectGear = 5; T.fastSim(0.4); delete v.controls.selectGear;
    const n0 = v.physics.powertrainFrame.nitrousFraction;
    T.down('KeyW'); if (on) T.down('ShiftLeft');
    T.fastSim(1.0); hudRefresh();
    const active = v.physics.powertrainFrame.nitrousActive, bar = refs.nitro.parentElement.parentElement.classList.contains('active'), aud = vm.audio.target?.nitro;
    T.fastSim(1.0);
    T.up('ShiftLeft'); T.up('KeyW');
    return { speed: kmh(v), used: n0 - v.physics.powertrainFrame.nitrousFraction, active, bar, aud, dmg: int0 - v.damage.integrity, gear: v.physics.gear };
  };
  const off = runNitro(false), on = runNitro(true);
  rec('X10', 'Nitro: mais aceleração, consumo e painel', on.speed > off.speed + 3 && off.speed > 140 && on.used > 0.3 && on.active && on.bar && off.used <= 0 && !off.dmg && !on.dmg,
    `a partir de 144 km/h em 5ª: sem ${off.speed.toFixed(0)} km/h · com ${on.speed.toFixed(0)} km/h (dano ${off.dmg}/${on.dmg}) · consumo ${(on.used * 100).toFixed(0)}% em 2 s · barra ativa ${on.bar} · som ${on.aud}`);

  // Freio de mão em curva.
  place(v, -260); stopCar(v); v.physics.vz = v.physics.vLong = 18; T.fastSim(0.1);
  T.down('Space'); T.down('KeyA'); T.fastSim(0.6);
  const rearLock = v.physics.brakeLock.rear, yaw = Math.abs(v.physics.yawRate), skid = v.physics.skid;
  T.up('Space'); T.up('KeyA'); stopCar(v);
  rec('X11', 'Freio de mão trava a traseira', rearLock && yaw > 0.3 && skid > 0.3, `traseira travada ${rearLock} · guinada ${yaw.toFixed(2)} rad/s · derrapagem ${skid.toFixed(2)}`);

  // Melhorias da oficina no carro em uso.
  const pk0 = Math.max(...v.physics.powertrain.profile.engine.torqueCurve.map((x) => x[1]));
  const cfg = { ...defaultConfig(v), engine: 3, trans: 2, nitro: 2 };
  applyPerformance(v, cfg); v.custom = cfg; T.fastSim(0.1);
  const prof = v.physics.powertrain.profile, pk1 = Math.max(...prof.engine.torqueCurve.map((x) => x[1]));
  rec('X12', 'Melhorias: motor, câmbio e kit de nitro reconfiguram o módulo', pk1 > pk0 * 1.3 && prof.nitrous.torqueBoostFraction === 0.7 && prof.transmission.forwardRatios[0] > 0,
    `torque máx ${pk0.toFixed(0)} → ${pk1.toFixed(0)} N·m · nitro +${(prof.nitrous.torqueBoostFraction * 100).toFixed(0)}% · 1ª ${prof.transmission.forwardRatios[0].toFixed(1)}:1`);
  applyPerformance(v, defaultConfig(v)); v.custom = null;

  // Colisão e dano preservados.
  place(v, -280); stopCar(v); const integ0 = v.damage.integrity;
  v.setPose(LANE_X, groundAt(LANE_X, 150), 150, 0); v.physics.syncFromRoot(); v.physics.vz = v.physics.vLong = 25; T.fastSim(3);
  rec('X13', 'Colisão e dano continuam', v.damage.integrity < integ0, `integridade ${integ0.toFixed(0)} → ${v.damage.integrity.toFixed(0)} ao bater no limite do mapa`);
  v.damage.repair?.();

  // Câmera (V) e saída (E).
  const cam0 = g.cameras.modeLabel; T.fastTap('KeyV'); T.fastSim(0.2); const cam1 = g.cameras.modeLabel; T.fastTap('KeyV'); T.fastSim(0.2);
  place(v, -280); stopCar(v); T.fastTap('KeyE'); for (let i = 0; i < 200 && vm.state !== 'ON_FOOT'; i++) T.fastSim(1 / 30);
  T.fastSim(0.2);
  rec('X14', 'Câmera e saída do carro', cam0 !== cam1 && vm.state === 'ON_FOOT' && v.physics.gear === 'P' && !hud.visible && !v.controls.nitrous, `câmera ${cam0} → ${cam1} · estado ${vm.state} · marcha ${v.physics.gear} · painel visível ${hud.visible}`);

  // ---------------------------------------------------------------- outros carros
  const rows = [];
  for (const type of ['palm_compact', 'azure_gtr', 'neon_phantom']) {
    const c = drive(type, `mech_${type}`);
    hudRefresh();
    const turboRow = !refs.turboRow.hidden;
    T.down('KeyW'); let t100 = null; let maxBoost = 0;
    for (let t = 0; t < 14; t += 0.1) { T.fastSim(0.1); maxBoost = Math.max(maxBoost, c.physics.powertrainFrame?.boost ?? 0); if (t100 === null && kmh(c) >= 100) t100 = t + 0.1; }
    T.up('KeyW');
    rows.push({ type, layout: c.physics.powertrain.drivetrain.layout, t100, turboRow, maxBoost, audioBoost: vm.audio.target?.boost ?? 0 });
    vm.interaction.forceExit(); T.fastSim(0.5);
  }
  const by = Object.fromEntries(rows.map((r) => [r.type, r]));
  rec('X15', 'Carros diferentes: FWD, AWD turbo, RWD central', by.palm_compact.layout === 'FWD' && by.azure_gtr.layout === 'AWD' && by.neon_phantom.layout === 'RWD'
    && by.azure_gtr.turboRow && !by.palm_compact.turboRow && by.azure_gtr.maxBoost > 0.6 && by.azure_gtr.t100 < by.palm_compact.t100,
    rows.map((r) => `${r.type} ${r.layout} 0-100 ${r.t100 ? r.t100.toFixed(1) : '>14'} s${r.turboRow ? ` turbo ${r.maxBoost.toFixed(2)}` : ''}`).join(' · '));

  // Moto: física própria, sem módulo.
  const bike = spawn('palm_rider_125', 'mech_bike');
  T.enterVehicle(bike.id); T.fastSim(0.3); hudRefresh();
  rec('X16', 'Motos mantêm a física própria', !bike.physics.powertrain && !hud.el.classList.contains('has-pt'), `módulo ${!!bike.physics.powertrain} · painel de câmbio ${hud.el.classList.contains('has-pt')}`);
  vm.interaction.forceExit(); T.fastSim(0.6);
  vm.removeVehicle(bike); F.dispose(bike);

  // Passo fixo: mesmo trajeto com quadros de 1/30 e 1/144 s.
  const traj = (dt) => {
    const c = drive('ocean_coupe', 'mech_fixed');
    T.down('KeyW'); for (let i = 0; i < Math.round(3 / dt); i++) T.sim(dt, dt); T.up('KeyW');
    const r = { z: c.physics.z, v: c.physics.vLong };
    vm.interaction.forceExit(); T.fastSim(0.5);
    return r;
  };
  const o = g.renderer.render; g.renderer.render = function () {};
  let a30, a144;
  try { a30 = traj(1 / 30); a144 = traj(1 / 144); } finally { g.renderer.render = o; }
  rec('X17', 'Passo físico fixo (1/30 vs 1/144 s por quadro)', a30.v > 5 && Math.abs(a30.z - a144.z) < 0.6 && Math.abs(a30.v - a144.v) < 0.3, `posição ${a30.z.toFixed(2)} vs ${a144.z.toFixed(2)} m · velocidade ${a30.v.toFixed(2)} vs ${a144.v.toFixed(2)} m/s`);

  // Trânsito: volta a circular no modelo arcade.
  if (tm) tm.maxAgents = savedMax;
  T.fastPlace(LANE_X - 10, -40, 0); T.fastSim(10);
  const agents = tm?.agents || [];
  const before = new Map(agents.map((a) => [a, a.v.root.position.clone()]));
  T.fastSim(3);
  const moving = agents.filter((a) => before.has(a) && a.v.root.position.distanceTo(before.get(a)) > 3).length;
  rec('X18', 'Trânsito intacto (sem módulo nos carros da IA)', agents.length > 0 && moving > 0 && agents.every((a) => !a.v.physics?.powertrainActive), `${agents.length} carros · ${moving} andaram mais de 3 m em 3 s · módulo ativo em ${agents.filter((a) => a.v.physics?.powertrainActive).length}`);

  // Limpeza.
  for (const id of ['mech_sports', 'mech_palm_compact', 'mech_azure_gtr', 'mech_neon_phantom', 'mech_bike', 'mech_fixed']) {
    const x = vm.list.find((q) => q.id === id);
    if (x) { vm.removeVehicle(x); F.dispose(x); }
  }
  if (vm.transmissionMode !== savedMode) vm.toggleTransmission(null);
  if (PM && hooks) { PM.report = hooks.report; PM.crime = hooks.crime; }
  console.error = oldErr;
  rec('X19', 'Console sem erros', errors.length === 0 && vm.powertrainErrors.length === 0, errors.length ? errors.slice(0, 2).join(' | ') : `nenhum erro · falhas de módulo ${vm.powertrainErrors.length}`);
  return { passed: results.filter((r) => r.ok).length, total: results.length, results, integrityLog, layouts: Object.fromEntries(['sports', 'palm_compact', 'azure_gtr', 'neon_phantom'].map((t) => [t, drivetrainFor(t).layout])) };
}
