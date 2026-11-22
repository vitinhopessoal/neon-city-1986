import * as THREE from 'three';
import { MOTO_DEFS, MOTO_SPECS, motoTrafficWeights } from '../vehicles/models/NeonMoto.js';
import { trafficWeights } from '../vehicles/models/NeonMotor.js';
import { PARTS, UPGRADES, isCompatible, defaultConfig } from '../vehicles/customization/CustomizationCatalog.js';
import { partSummary } from '../vehicles/customization/VehicleAppearance.js';

/**
 * PROMPT 15 — NEON MOTORCYCLES: validação no JOGO REAL. 25 testes por moto
 * (modelo, montagem, pose do piloto, física, inclinação, freio, ré, danos,
 * câmeras, áudio, rádio, desmontagem e polícia) + testes globais (trânsito com
 * pilotos NPC, vitrine, garagem, salvamento, personalização, LOD, console).
 * Pista: Ocean Avenue (faixa norte x 25,75), trânsito e polícia suspensos.
 */
const TRI_RANGE = { basica: [6000, 12000], custom: [10000, 18000], esportiva: [12000, 22000] };
const LOPE = { single: 0.45, twin: 0.25, vtwin: 0.7, vtwin_big: 0.7, inline4: 0.06 };

export async function runMotoSuite(T, { types = MOTO_DEFS.map((d) => d.type), globals = true } = {}) {
  const g = window.__NEON__;
  const vm = g.vehicles;
  const F = g.world.vehicleFactory;
  const errors = [];
  const oldErr = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 220)); oldErr.apply(console, a); };
  const results = {};
  const metrics = {};
  const rec = (type, k, ok, detail) => { (results[type] ||= []).push({ test: k, ok: !!ok, detail }); };
  const kmh = (ms) => Math.round(ms * 3.6);
  const groundAt = (x, z) => g.mapEnv.collision.getGroundHeight(x, z, 0.1, 0.3);
  const W = new THREE.Vector3(), W2 = new THREE.Vector3();
  const wp = (o, out = new THREE.Vector3()) => { o.updateWorldMatrix(true, false); return o.getWorldPosition(out); };
  const tm = g.city?.traffic;
  const savedMax = tm?.maxAgents;
  if (tm) { tm.maxAgents = 0; for (const a of [...tm.agents]) tm._release(a); }
  if (vm.state !== 'ON_FOOT') { vm.interaction.forceExit(); T.fastSim(0.5); }
  const PM = g.city?.police;
  const policeHooks = PM ? { report: PM.report, crime: PM.crime } : null;
  if (PM) { PM.report = () => 0; PM.crime = () => 0; }
  const LANE_X = 25.75;
  function calmPolice() {
    const P = g.city?.police;
    if (!P) return;
    P.clear();
    if (g.state === 'busted' || g.state === 'wasted') g.state = 'playing';
    P.crimes?.reset?.();
    P._wanted = 0;
    P.lastSeen = -Infinity;
    g.player.status.setWanted(0);
    g.player.status.setHealth(100);
    g.player.status.searching = false;
  }
  function clearLane(keep) {
    let z = 4;
    for (const o of vm.list) {
      const p = o.root.position;
      if (o === keep || !o.root.visible) continue;
      if (Math.abs(p.x - LANE_X) < 2.5 && p.z > -305 && p.z < 170) { o.setPose(18.75, groundAt(18.75, z), z, 0); o.physics?.syncFromRoot(); z += 6; }
    }
  }
  function spawn(type, id, x, z, heading = 0) {
    const old = vm.list.find((v) => v.id === id);
    if (old) { vm.removeVehicle(old); F.dispose(old); }
    const v = F.create(type, { id, plate: 'MC TEST' });
    (g.properties.garage.group || g.scene).add(v.root);
    v.setPose(x, groundAt(x, z), z, heading);
    v.attachCollider(g.mapEnv.collision);
    vm.addVehicle(v);
    return v;
  }
  /** Reposiciona a moto (dirigida) na pista, parada. */
  function place(v, z, heading = 0) {
    const ph = v.physics;
    const y = groundAt(LANE_X, z);
    ph.x = ph.px = LANE_X; ph.z = ph.pz = z; ph.y = ph.py = y; ph.heading = ph.pheading = heading;
    ph.vx = ph.vz = ph.vy = ph.yawRate = ph.vLong = ph.vLat = 0; ph.steerAngle = 0; ph.acc = 0; ph.lean = 0;
    v.syncCollider(LANE_X, y, z, heading);
    v.animation.update(0, true);
    ph.wake();
  }
  function speedUp(v, target, maxSec = 8) {
    T.down('KeyW');
    for (let i = 0; i < maxSec * 60 && v.physics.vLong < target; i++) T.fastSim(1 / 60);
    T.up('KeyW');
  }
  function stopBike(v) {
    for (let i = 0; i < 600 && Math.abs(v.physics.vLong) > 0.3; i++) {
      const k = v.physics.vLong > 0 ? 'KeyS' : 'KeyW';
      T.down(k); T.fastSim(1 / 60); T.up(k);
    }
    T.fastSim(0.4);
  }
  const glbBone = (n) => (g.player.visual && g.player.modelMode === 'glb' ? g.player.visual.bone(n) : null);

  for (const type of types) {
    const d = MOTO_DEFS.find((e) => e.type === type);
    const spec = MOTO_SPECS[type];
    const H = d.handling;
    const m = (metrics[type] = { name: d.name, category: d.category });
    const id = `mctest_${type}`;
    let v;
    try {
      calmPolice();
      clearLane(null);
      // 1) Modelo GLB + LOD carregados.
      const tpl = F.moto.templates.get(type);
      let tris = 0, lodTris = 0;
      tpl?.scene.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
      tpl?.lod?.traverse((o) => { if (o.isMesh) lodTris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
      m.triangles = Math.round(tris); m.lodTriangles = Math.round(lodTris);
      v = spawn(type, id, LANE_X, -280, 0);
      T.fastSim(0.2);
      // LOD: longe da câmera troca para a malha única dizimada.
      const camSave = g.camera.position.clone();
      g.camera.position.set(v.root.position.x + 80, 20, v.root.position.z);
      vm._lodTimer = 0; vm._lod(1, null);
      const farOk = v.lodMesh?.visible === true && v.body.visible === false;
      g.camera.position.copy(camSave).set(v.root.position.x - 3, 2, v.root.position.z);
      vm._lodTimer = 0; vm._lod(1, null);
      const nearOk = v.lodMesh?.visible === false && v.body.visible === true;
      rec(type, '01 Modelo e LOD', !!tpl && !!tpl.lod && farOk && nearOk, `GLB ${d.file}.glb ${m.triangles} tri · LOD ${m.lodTriangles} tri · troca a 45 m ${farOk && nearOk ? 'ok' : 'falhou'}`);
      // 2) Hierarquia: garfo, balança, duas rodas e âncoras do piloto.
      const A = v.riderAnchors;
      const hier = v.fork && v.swingarm && v.wheels.length === 2 && v.wheels[0].spin.children[0].name.startsWith('Tire') && ['Rider_Hip', 'Peg_L', 'Peg_R', 'Grip_L', 'Grip_R'].every((n) => A[n]);
      rec(type, '02 Hierarquia', hier, `garfo ${!!v.fork} · balança ${!!v.swingarm} · rodas ${v.wheels.length} · âncoras ${Object.keys(A).join(', ')}`);
      // 3) Dimensões (caixa envolvente real vs especificação).
      v.root.updateMatrixWorld(true);
      const prevRot = v.root.rotation.z; v.root.rotation.z = 0; v.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(v.body, true);
      v.root.rotation.z = prevRot; v.root.updateMatrixWorld(true);
      const len = box.max.z - box.min.z, hgt = box.max.y - v.root.position.y;
      rec(type, '03 Dimensões', Math.abs(len - spec.length) / spec.length < 0.12 && Math.abs(hgt - spec.height) < 0.2, `comprimento ${len.toFixed(2)}/${spec.length} m · altura ${hgt.toFixed(2)}/${spec.height} m`);
      // 4) Triângulos na meta da categoria.
      const [t0, t1] = TRI_RANGE[d.category];
      rec(type, '04 Triângulos', tris >= t0 && tris <= t1 && lodTris < tris * 0.45, `${m.triangles} (meta ${t0}–${t1}) · LOD ${m.lodTriangles}`);
      // 5) Rodas apoiadas no chão.
      let gap = 0;
      for (const w of v.wheels) { wp(w.spin, W); gap = Math.max(gap, Math.abs(W.y - w.radius - groundAt(W.x, W.z))); }
      rec(type, '05 Rodas no chão', gap < 0.04, `folga máx. ${(gap * 100).toFixed(1)} cm`);
      // 6) Estacionada: apoiada no cavalete lateral (inclinada para a esquerda).
      const stand = v.root.rotation.z;
      rec(type, '06 Cavalete lateral', Math.abs(stand - v.standLean) < 0.01, `inclinação ${stand.toFixed(3)} rad (cavalete ${v.standLean})`);
      // 7) Aviso "MONTAR" junto ao ponto de montagem.
      const e = v.getEntryPoints().find((p) => p.id === 'driver');
      T.fastPlace(e.position.x, e.position.z, 0);
      T.fastSim(0.3);
      const prompt = g.hud.refs.prompt.textContent || '';
      rec(type, '07 Aviso de montar', /MONTAR/.test(prompt) && g.hud.refs.prompt.classList.contains('visible'), `"${prompt.trim()}"`);
      // 8) Montar com E: estado DRIVING, pose de pilotagem e quadril sobre o banco.
      g.player.status.setWanted(1);
      const wanted0 = g.player.status.wanted;
      const st = T.enterVehicle(id);
      T.fastSim(0.4);
      const an = g.player.animator;
      const hipW = wp(glbBone('hips') || g.player.model.joints.hips, new THREE.Vector3());
      const hipA = wp(A.Rider_Hip, W2);
      const hipErr = hipW.distanceTo(hipA);
      m.hipError = +hipErr.toFixed(3);
      const visibleRider = g.player.modelMode === 'glb' ? g.player.visual.visible : g.player.model.root.visible;
      rec(type, '08 Montar (E)', st === 'DRIVING' && vm.playerVehicle === v && !!an.seatRide && visibleRider && hipErr < 0.12, `estado ${st} · protagonista visível ${visibleRider} · quadril a ${(hipErr * 100).toFixed(1)} cm do banco`);
      // 9) Mãos nas manoplas (pulsos do GLB vs manoplas do guidão).
      const wl = wp(glbBone('wristL') || g.player.model.joints.arms.L.wrist, new THREE.Vector3());
      const wr = wp(glbBone('wristR') || g.player.model.joints.arms.R.wrist, new THREE.Vector3());
      const gl = wp(A.Grip_L, new THREE.Vector3()), gr = wp(A.Grip_R, new THREE.Vector3());
      const dl = wl.distanceTo(gl), dr = wr.distanceTo(gr);
      m.handError = +Math.max(dl, dr).toFixed(3);
      rec(type, '09 Mãos no guidão', dl < 0.15 && dr < 0.15, `esq. ${(dl * 100).toFixed(1)} cm · dir. ${(dr * 100).toFixed(1)} cm das manoplas`);
      // 10) Parada: pé esquerdo no chão (equilíbrio), direito na pedaleira.
      place(v, -280);
      T.fastSim(0.8);
      const al = wp(glbBone('ankleL') || g.player.model.joints.legs.L.ankle, new THREE.Vector3());
      const footY = al.y - groundAt(al.x, al.z);
      rec(type, '10 Pé no chão parada', an.rideState.footDown > 0.9 && footY < 0.2, `apoio ${an.rideState.footDown.toFixed(2)} · tornozelo esq. a ${(footY * 100).toFixed(0)} cm do chão`);
      // 11) Em movimento: os dois pés nas pedaleiras.
      speedUp(v, 8);
      T.fastSim(0.5);
      const fl = wp(glbBone('ankleL') || g.player.model.joints.legs.L.ankle, new THREE.Vector3());
      const fr = wp(glbBone('ankleR') || g.player.model.joints.legs.R.ankle, new THREE.Vector3());
      const pl = wp(A.Peg_L, new THREE.Vector3()), pr = wp(A.Peg_R, new THREE.Vector3());
      const dfl = fl.distanceTo(pl), dfr = fr.distanceTo(pr);
      m.footError = +Math.max(dfl, dfr).toFixed(3);
      rec(type, '11 Pés nas pedaleiras', an.rideState.footDown < 0.1 && dfl < 0.2 && dfr < 0.2, `esq. ${(dfl * 100).toFixed(1)} cm · dir. ${(dfr * 100).toFixed(1)} cm · apoio ${an.rideState.footDown.toFixed(2)}`);
      // 12) Postura do estilo: esportiva deitada, básica ereta, custom/chopper reclinada.
      const sp = an.pose.spinePitch;
      const styleOk = d.category === 'esportiva' ? sp > 0.6 : d.category === 'basica' ? sp > -0.05 && sp < 0.42 : sp < 0.3;
      rec(type, '12 Postura do estilo', styleOk, `${d.rider.style}: tronco ${(sp * 57.3).toFixed(0)}° (+ = à frente)`);
      // 13) Aceleração (0 → 4 s).
      place(v, -290);
      T.down('KeyW'); T.fastSim(4); T.up('KeyW');
      m.v4s = kmh(v.physics.vLong);
      rec(type, '13 Aceleração', m.v4s > 30, `${m.v4s} km/h em 4 s`);
      // 14) Velocidade máxima: nunca acima da especificação (pista de ~430 m).
      let vTop = v.physics.vLong;
      T.down('KeyW');
      for (let i = 0; i < 1200 && v.physics.z < 130; i++) { T.fastSim(1 / 60); vTop = Math.max(vTop, v.physics.vLong); }
      T.up('KeyW');
      m.vTop = kmh(vTop);
      stopBike(v);
      rec(type, '14 Velocidade máxima', vTop <= H.maxSpeed * 1.02 && vTop > H.maxSpeed * 0.55, `${m.vTop} km/h (máx. ${kmh(H.maxSpeed)})`);
      // 15–18) Inclinação nas curvas (direita, esquerda), retorno e piloto acompanhando.
      const lean = (key) => {
        place(v, -290);
        speedUp(v, 13);
        let peak = 0, rollErr = 0;
        T.down(key);
        for (let i = 0; i < 24; i++) {
          T.fastSim(1 / 60);
          const z = v.root.rotation.z;
          if (Math.abs(z) > Math.abs(peak)) peak = z;
          rollErr = Math.max(rollErr, Math.abs(g.player.model.root.rotation.z - z));
        }
        T.up(key);
        const other = key === 'KeyD' ? 'KeyA' : 'KeyD';
        T.down(other); T.fastSim(0.25); T.up(other);
        T.fastSim(1.6);
        return { peak, rollErr, after: v.root.rotation.z, kmh: kmh(v.physics.vLong) };
      };
      const R = lean('KeyD'), L = lean('KeyA');
      m.leanRight = +R.peak.toFixed(3); m.leanLeft = +L.peak.toFixed(3);
      rec(type, '15 Inclina à direita', R.peak > 0.12 && R.peak <= H.leanMax + 1e-3, `pico ${(R.peak * 57.3).toFixed(1)}° (máx. ${(H.leanMax * 57.3).toFixed(0)}°)`);
      rec(type, '16 Inclina à esquerda', L.peak < -0.12 && L.peak >= -H.leanMax - 1e-3, `pico ${(L.peak * 57.3).toFixed(1)}°`);
      rec(type, '17 Endireita na reta', Math.abs(R.after) < 0.06 && Math.abs(L.after) < 0.06, `após a curva ${(R.after * 57.3).toFixed(1)}° / ${(L.after * 57.3).toFixed(1)}° a ${L.kmh} km/h`);
      rec(type, '18 Corpo acompanha', R.rollErr < 0.02 && L.rollErr < 0.02 && Math.abs(an.pose.headRoll) < 0.5, `diferença moto × piloto ${(Math.max(R.rollErr, L.rollErr) * 57.3).toFixed(2)}° · cabeça compensa`);
      // 19) Garfo esterça no eixo de direção e as rodas giram.
      place(v, -280);
      speedUp(v, 3);
      const spin0 = v.wheels[0].spin.rotation.x, spinR0 = v.wheels[1].spin.rotation.x;
      T.down('KeyD'); T.fastSim(0.35);
      const forkY = v.fork.rotation.y;
      T.up('KeyD');
      T.fastSim(0.3);
      const spun = Math.abs(v.wheels[0].spin.rotation.x - spin0) > 1 && Math.abs(v.wheels[1].spin.rotation.x - spinR0) > 1;
      rec(type, '19 Garfo e rodas', forkY < -0.05 && spun, `garfo ${(forkY * 57.3).toFixed(1)}° (direita) · rodas girando ${spun}`);
      // 20) Freio: luz de freio, garfo comprime e para em distância curta.
      place(v, -290);
      speedUp(v, 14);
      const z0 = v.physics.z, v0 = v.physics.vLong;
      let lamp = 0, comp = 0;
      T.down('KeyS');
      for (let i = 0; i < 400 && v.physics.vLong > 0.3; i++) { T.fastSim(1 / 60); lamp = Math.max(lamp, v.mats.taillight.emissiveIntensity); comp = Math.max(comp, v.animation.forkComp); }
      T.up('KeyS');
      const dist = v.physics.z - z0;
      m.brake = { from: kmh(v0), dist: +dist.toFixed(1) };
      rec(type, '20 Freio e suspensão', lamp > 2 && comp > 0.004 && dist < 30, `${kmh(v0)}→0 km/h em ${dist.toFixed(1)} m · luz de freio ${lamp.toFixed(1)} · garfo comprimiu ${(comp * 100).toFixed(1)} cm`);
      // 21) Ré só com a moto parada e em velocidade de "empurrar".
      place(v, -280);
      speedUp(v, 8);
      let minBefore = Infinity, stoppedAt = -1, minV = 0;
      T.down('KeyS');
      for (let i = 0; i < 360; i++) {
        T.fastSim(1 / 60);
        const vl = v.physics.vLong;
        if (stoppedAt < 0) { minBefore = Math.min(minBefore, vl); if (vl < 0.35) stoppedAt = i; }
        minV = Math.min(minV, vl);
      }
      T.up('KeyS');
      stopBike(v);
      rec(type, '21 Ré só parada', stoppedAt >= 0 && minBefore > -0.1 && minV < -0.3 && -minV <= H.reverseSpeed * 1.1, `freou até parar antes da ré · ré máx. ${(-minV).toFixed(2)} m/s (limite ${H.reverseSpeed})`);
      // 22) Danos: parede temporária à frente a ~40 km/h.
      calmPolice();
      const wallZ = -200;
      const wall = g.mapEnv.collision.addBox({ id: 'mc_test_wall', cx: LANE_X, cz: wallZ + 0.5, hx: 4, hz: 0.5, rotation: 0, minY: 0, maxY: 3, tags: ['test'] });
      place(v, -240);
      v.damage.repair();
      const i0 = v.damage.integrity;
      let peak = 0, pedal = true, maxFront = -Infinity;
      T.down('KeyW');
      for (let i = 0; i < 400; i++) {
        if (pedal && v.physics.vLong >= 11) { T.up('KeyW'); pedal = false; }
        T.fastSim(1 / 60);
        peak = Math.max(peak, v.physics.impact || 0);
        maxFront = Math.max(maxFront, v.physics.z + spec.length / 2);
      }
      T.up('KeyW');
      g.mapEnv.collision.remove(wall.id || 'mc_test_wall');
      const i1 = v.damage.integrity;
      stopBike(v);
      rec(type, '22 Colisão e danos', i1 < i0 && maxFront < wallZ + 0.2 && g.player.status.health > 0 && vm.state === 'DRIVING', `impacto ${peak.toFixed(1)} m/s · integridade ${i0}→${i1.toFixed(1)} · frente em ${maxFront.toFixed(2)} (parede ${wallZ}) · piloto ${g.player.status.health.toFixed(0)} HP`);
      // 23) Câmeras: perseguição e primeira pessoa (V).
      calmPolice();
      g.player.status.setWanted(1);
      place(v, -280);
      T.fastSim(0.6);
      const camD = g.camera.position.distanceTo(v.root.position);
      T.fastTap('KeyV'); T.fastSim(0.4);
      const lc = v.root.worldToLocal(g.camera.position.clone());
      T.fastTap('KeyV'); T.fastSim(0.3);
      // Olhos do piloto: acima do quadril; nas esportivas o tronco deitado leva a cabeça para sobre o tanque.
      const fpOk = Math.abs(lc.x) < 0.3 && lc.y > d.rider.hipY + 0.3 && lc.y < d.rider.hipY + 1.0 && Math.abs(lc.z - d.rider.hipZ) < 0.75;
      rec(type, '23 Câmeras', camD > 3 && camD < 12 && fpOk, `perseguição ${camD.toFixed(1)} m · 1ª pessoa (${lc.x.toFixed(2)}, ${lc.y.toFixed(2)}, ${lc.z.toFixed(2)})`);
      // 24) Áudio próprio do motor + sem rádio na moto.
      const voice = vm.audio.voice;
      const scrolls0 = g.radio?.stats?.enters ?? 0;
      T.fastTap('WheelDown'); T.fastSim(0.1);
      const radioOff = g.radio ? g.radio.vehicle === null && !g.radio.ui.open && (g.radio.stats?.enters ?? 0) === scrolls0 : true;
      const lopeOk = voice && Math.abs(voice.lope - LOPE[d.style.engine]) < 1e-6 && voice.horn[0] >= 420;
      rec(type, '24 Áudio e sem rádio', lopeOk && radioOff, `motor ${d.style.engine} · pulsação ${voice?.lope} · buzina ${voice?.horn?.join('/')} Hz · ${H.cylinders} cil. · rádio ${radioOff ? 'ausente (roleta não abre)' : 'ATIVO'}`);
      // 25) Desmontar (E) parado: protagonista ao lado, moto no cavalete, procurado mantido.
      const wRiding = g.player.status.wanted;
      T.fastTap('KeyE');
      for (let i = 0; i < 240 && vm.state !== 'ON_FOOT'; i++) T.fastSim(1 / 60);
      T.fastSim(1.6);
      const pp = g.player.controller.position;
      const lp = v.root.worldToLocal(pp.clone());
      const side = Math.hypot(lp.x, lp.z - spec.seats[0].z);
      const wAfter = g.player.status.wanted;
      rec(type, '25 Desmontar', vm.state === 'ON_FOOT' && side > 0.5 && side < 1.8 && Math.abs(v.root.rotation.z - v.standLean) < 0.02 && !g.player.animator.seatRide && wanted0 >= 1 && wRiding >= 1 && wAfter >= 1,
        `estado ${vm.state} · a ${side.toFixed(2)} m da moto · cavalete ${v.root.rotation.z.toFixed(3)} · procurado ${wanted0}→${wRiding}→${wAfter}`);
      calmPolice();
    } catch (err) {
      rec(type, 'Exceção', false, String(err?.stack || err).slice(0, 300));
      if (vm.state !== 'ON_FOOT') { vm.interaction.forceExit(); T.fastSim(0.3); }
    }
  }

  const global = [];
  const grec = (k, ok, detail) => global.push({ test: k, ok: !!ok, detail });
  if (globals) {
    calmPolice();
    // G1) Trânsito: básicas comuns, customs menos, esportivas raras (pesos por zona).
    const dist = {};
    let order = true;
    for (const [x, z, zone] of [[-30, 60, 'residential'], [19, 40, 'commercial'], [36, 40, 'nightlife'], [10, -250, 'rich']]) {
      const w = [...trafficWeights(x, z), ...motoTrafficWeights(zone)];
      const tot = w.reduce((s, e) => s + e[1], 0);
      const cat = { basica: 0, custom: 0, esportiva: 0 };
      for (const [t, k] of w) { const md = MOTO_DEFS.find((e) => e.type === t); if (md) cat[md.category] += 100 * k / tot; }
      dist[zone] = Object.fromEntries(Object.entries(cat).map(([k, val]) => [k, +val.toFixed(1)]));
    }
    const base = motoTrafficWeights(null);
    const sum = (c) => base.filter(([t]) => MOTO_DEFS.find((e) => e.type === t).category === c).reduce((s, e) => s + e[1], 0);
    order = sum('basica') > sum('custom') && sum('custom') > sum('esportiva');
    grec('G1 Frequência no trânsito', order, `peso básicas ${sum('basica').toFixed(3)} > customs ${sum('custom').toFixed(3)} > esportivas ${sum('esportiva').toFixed(3)} · % por zona ${JSON.stringify(dist)}`);
    // G2) Piloto NPC no trânsito: moto com IA existente + ocupante com pose de pilotagem.
    if (tm) {
      const npc = [];
      for (const type of ['palm_rider_125', 'midnight_rebel_750', 'neon_blade_900r']) {
        let agent = null, tv = null, tries = 0;
        // Surgimento aleatório no grafo: se o trecho termina num ponto de saída em menos de 1 s,
        // o trânsito recicla a moto antes da leitura — tenta outro trecho (até 4 vezes).
        while (tries++ < 4) {
          tm.maxAgents = 1;
          tv = F.create(type, { id: `traffic_mc_${type}_${tries}`, plate: 'SB MOTO' });
          tm.group.add(tv.root);
          const orig = tm._acquire;
          tm._acquire = () => tv;
          T.fastPlace(LANE_X - 60, 60, 0);
          agent = null;
          for (let k = 0; k < 40 && !agent; k++) agent = tm._trySpawn(g.player.controller.position);
          tm._acquire = orig;
          if (!agent) break;
          tv._p0 = tv.root.position.clone();
          T.fastSim(1.0);
          if (tm.agents.includes(agent)) break;
        }
        let moved = 0, ride = false, hipErr = 9, peakLean = 0;
        if (agent) {
          const p0 = tv._p0;
          // Pose lida com o agente ativo (lida 1 s após surgir).
          const actor = g.city.occupants.actors.find((a) => a.vehicle === tv && a.seat.driver);
          ride = !!actor?.seat.ride && actor.pose.spread > 0.1 && actor.pose.thighL > 0.5;
          if (actor) {
            tv.body.updateWorldMatrix(true, false);
            const hip = new THREE.Vector3(actor.x, actor.y + 0.95 * actor.look.height - 0.47, actor.z).applyMatrix4(tv.body.matrixWorld);
            hipErr = hip.distanceTo(wp(tv.riderAnchors.Rider_Hip, W));
          }
          for (let k = 0; k < 50 && tm.agents.includes(agent); k++) { T.fastSim(0.1); peakLean = Math.max(peakLean, Math.abs(tv.root.rotation.z)); }
          moved = tv.root.position.distanceTo(p0);
          if (tm.agents.includes(agent)) tm._release(agent);
        }
        npc.push({ type, agent: !!agent, moved: +moved.toFixed(1), ride, hipErr: +hipErr.toFixed(3), lean: +peakLean.toFixed(2) });
        tm.maxAgents = 0;
      }
      grec('G2 Pilotos NPC', npc.every((n) => n.agent && n.ride && n.hipErr < 0.08 && n.moved > 5), npc.map((n) => `${n.type}: andou ${n.moved} m · pose ${n.ride} · quadril ${(n.hipErr * 100).toFixed(1)} cm · inclinação máx. ${n.lean} rad`).join(' | '));
    }
    // G3) Vitrine: uma de cada estacionada no mapa.
    const show = g.world.motoShowcase || [];
    grec('G3 Vitrine em Sunset Beach', show.length === MOTO_DEFS.length && show.every((s) => vm.list.some((v) => v.id === s.id)), show.map((s) => `${s.type} (${s.x}, ${s.z})`).join(' · '));
    // G4) Personalização: só categorias com ponto de montagem.
    const t = 'neon_blade_900r';
    const blocked = ['wheels', 'tires', 'ride', 'bumper', 'skirts', 'spoiler', 'hood', 'exhaust', 'tint', 'interior'].filter((c) => PARTS[c]).every((c) => PARTS[c].options.every((o, i) => i === 0 ? isCompatible(c, o.id, t) : !isCompatible(c, o.id, t)));
    const lightsOk = PARTS.lights.options.slice(1).some((o) => isCompatible('lights', o.id, t));
    const v = vm.list.find((o) => o.id === `mctest_${t}`) || vm.list.find((o) => o.type === t);
    let custOk = false, custDetail = 'moto ausente';
    if (v) {
      v.damage.repair();
      const vmax0 = v.spec.handling.maxSpeed;
      const cfg = { ...defaultConfig(v), paint: 'sunset_pink', finish: 'pearl', lights: PARTS.lights.options.find((o, i) => i > 0 && isCompatible('lights', o.id, t))?.id || 'stock', engine: 2, brakes: 1, susp: 1, armor: 1 };
      g.customs.applyConfig(v, cfg);
      custOk = v.mats.paint.color.getHex() === 0xf06fa8 && partSummary(v).length === 0 && v.spec.handling.maxSpeed > vmax0;
      custDetail = `pintura rosa ${v.mats.paint.color.getHex().toString(16)} · peças de carroceria ${partSummary(v).length} · vmax ${vmax0}→${v.spec.handling.maxSpeed.toFixed(1)} · paint2 ${isCompatible('paint2', null, t)}`;
    }
    grec('G4 Personalização limitada', blocked && lightsOk && custOk && !isCompatible('paint2', null, t) && Object.keys(UPGRADES).length >= 5, custDetail);
    // G5) Garagem: guarda e retira uma moto personalizada.
    const P = g.properties, G = P.garage, gar = G.garages.get('garage_condo');
    let gOk = false, gDetail = 'garagem indisponível';
    if (gar && v) {
      P.owned.add(gar.prop.id);
      for (const r of [...gar.vehicles]) gar.vehicles.splice(gar.vehicles.indexOf(r), 1);
      const bay = gar.bays[0];
      for (const o of vm.list) if (o !== v && o.root.visible && gar.bays.some((b) => Math.hypot(o.root.position.x - b.x, o.root.position.z - b.z) < 5)) { o.setPose(18.75, groundAt(18.75, 100), 100, 0); o.physics?.syncFromRoot(); }
      v.setPose(bay.x, groundAt(bay.x, bay.z), bay.z, bay.heading);
      T.fastPlace(bay.x + 4, bay.z, 0);
      T.fastSim(0.2);
      const s = G.store('garage_condo');
      const hidden = !vm.list.includes(v);
      T.fastPlace(bay.x + 9, bay.z + 9, 0);
      const r = s.ok ? G.retrieve('garage_condo', s.rec?.pid) : { ok: false, msg: 'não guardou' };
      const nv = r.vehicle;
      gOk = s.ok && hidden && r.ok && nv?.type === t && nv.bike && nv.custom?.paint === 'sunset_pink' && nv.physics?.constructor?.name === 'MotorcyclePhysics';
      gDetail = `${s.msg} → ${r.msg} · tipo ${nv?.type} · pintura ${nv?.custom?.paint} · física ${nv?.physics?.constructor?.name}`;
    }
    grec('G5 Garagem', gOk, gDetail);
    // G6) Salvamento: motos no mundo → save → load (posição e tipo preservados).
    const owned = [];
    let i = 0;
    for (const type of types) {
      const o = vm.list.find((x) => x.type === type && (x.persistId || x.id).startsWith('mctest_')) || vm.list.find((x) => x.type === type && x.id.startsWith('mctest_'));
      if (!o) continue;
      const z = -120 + i * 6; i++;
      o.setPose(LANE_X, groundAt(LANE_X, z), z, 0); o.physics.syncFromRoot();
      g.properties.garage.owned.add(o.persistId || o.id);
      owned.push({ type, pid: o.persistId || o.id, z });
    }
    T.fastPlace(LANE_X - 8, -80, 0);
    const sv = await g.save.save('slot3');
    for (const o of owned) { const x = vm.list.find((q) => (q.persistId || q.id) === o.pid); if (x) x.setPose(LANE_X, 0, 400, 0); }
    const ld = await g.save.load('slot3');
    T.fastSim(0.5);
    const sres = owned.map((o) => {
      const copies = vm.list.filter((x) => (x.persistId || x.id) === o.pid);
      const x = copies[0];
      return { type: o.type, ok: copies.length === 1 && x.type === o.type && x.bike && Math.abs(x.root.position.z - o.z) < 1.5 && Math.abs(x.root.rotation.z - x.standLean) < 0.02, z: x ? +x.root.position.z.toFixed(1) : null };
    });
    grec('G6 Salvamento', sv?.ok !== false && ld?.ok !== false && sres.length === types.length && sres.every((r) => r.ok), `save ${sv?.ok !== false ? 'ok' : sv?.msg} · load ${ld?.ok !== false ? 'ok' : ld?.msg} · ${sres.filter((r) => r.ok).length}/${sres.length} motos no lugar, no cavalete`);
  }
  if (tm) tm.maxAgents = savedMax;
  if (PM && policeHooks) { PM.report = policeHooks.report; PM.crime = policeHooks.crime; calmPolice(); }
  console.error = oldErr;
  grec('G7 Console sem erros', errors.length === 0, errors.length ? errors.slice(0, 2).join(' | ') : 'nenhum erro');
  const flat = [...Object.entries(results).flatMap(([t, l]) => l.map((r) => ({ type: t, ...r }))), ...global.map((r) => ({ type: 'global', ...r }))];
  return { passed: flat.filter((r) => r.ok).length, total: flat.length, results, global, metrics, errors };
}
