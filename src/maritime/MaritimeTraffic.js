/**
 * Tráfego marítimo por IA: rotas de waypoints fechadas pela baía (longe dos
 * píeres e com folga das ilhas) e uma máquina de estados simples por barco:
 *   CRUISE  segue a rota em velocidade de cruzeiro
 *   YIELD   reduz por barco/nadador/jogador à frente
 *   STOP    obstáculo muito perto: corta o motor
 *   REVERSE preso (sem avançar): ré por ~2 s e retoma
 *   DETOUR  obstáculo PARADO bloqueando: ré curta e contorno pelo lado livre
 *   WAIT    parada programada num waypoint (pesca, mirante)
 *   FAR     longe da câmera: simulação simplificada (sem colisão/espuma)
 * Usa a MESMA física de embarcação do jogador (BoatPhysics), só o "piloto" muda.
 */
export const AI_STATES = { CRUISE: 'cruise', YIELD: 'yield', STOP: 'stop', REVERSE: 'reverse', DETOUR: 'detour', WAIT: 'wait', FAR: 'far' };

export const ROUTES = {
  bay_loop: { type: 'cruiser', cruise: 0.55, pts: [[178, -150], [250, -112], [350, -95], [385, 15], [300, 62], [222, 38], [180, -40]], waits: { 3: 6 } },
  lighthouse: { type: 'yacht', cruise: 0.5, pts: [[185, -262], [330, -305], [470, -290], [482, -185], [365, -182], [228, -205]], waits: { 2: 10 } },
  coast: { type: 'fisher', cruise: 0.6, pts: [[182, 140], [186, 20], [178, -205], [196, -312], [215, -205], [212, 20], [205, 140]], waits: { 3: 12 } },
  buoys: { type: 'jetski', cruise: 0.45, pts: [[205, -62], [222, -80], [205, -98], [188, -80]], waits: {} },
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const FAR = 260;

export class MaritimeTraffic {
  constructor(mgr) {
    this.mgr = mgr;
    this.list = [];
    this.stats = { near: 0, far: 0, states: {} };
  }

  spawnAll() {
    let k = 0;
    for (const [rid, r] of Object.entries(ROUTES)) {
      const p0 = r.pts[0], p1 = r.pts[1];
      const heading = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
      const boat = this.mgr.spawn(r.type, { id: `ai_${rid}`, x: p0[0], z: p0[1], heading, owner: 'ai', name: AI_NAMES[k++ % AI_NAMES.length] });
      boat.ai = { route: r, rid, i: 1, state: AI_STATES.CRUISE, wait: 0, stuck: 0, rev: 0, lastProg: 0, blockT: 0, detour: 0, side: 1 };
      this.list.push(boat);
    }
  }

  update(dt, camPos, obstacles) {
    let near = 0, far = 0;
    const st = this.stats.states;
    for (const k of Object.keys(st)) st[k] = 0;
    for (const b of this.list) {
      if (b.sinking || b.driver) continue;
      const a = b.ai, P = b.phys, R = a.route.pts;
      const tgt = R[a.i];
      const dx = tgt[0] - P.x, dz = tgt[1] - P.z, dist = Math.hypot(dx, dz);
      const dc = Math.hypot(P.x - camPos.x, P.z - camPos.z);
      if (dist < 14) {
        const w = a.route.waits[a.i];
        a.i = (a.i + 1) % R.length;
        if (w) { a.state = AI_STATES.WAIT; a.wait = w; }
      }
      const desired = Math.atan2(dx, dz);
      const err = wrap(desired - P.heading);
      const cruise = a.route.cruise;
      // Longe da câmera: simplificado (velocidade ao longo do rumo, sem colisão).
      if (dc > FAR && a.state !== AI_STATES.WAIT) {
        far++;
        a.state = AI_STATES.FAR;
        const v = P.spec.maxSpeed * cruise * 0.85;
        P.yawRate = Math.max(-0.5, Math.min(0.5, err * 0.8));
        P.vx = Math.sin(P.heading) * v; P.vz = Math.cos(P.heading) * v;
        P.coarse(dt);
        st.far = (st.far || 0) + 1;
        continue;
      }
      near++;
      if (a.state === AI_STATES.FAR) a.state = AI_STATES.CRUISE;
      let throttle = cruise * (1 - Math.min(0.6, Math.abs(err) * 0.5));
      let block = Infinity;
      if (a.state === AI_STATES.WAIT) {
        a.wait -= dt;
        throttle = 0;
        if (a.wait <= 0) a.state = AI_STATES.CRUISE;
      } else if (a.state === AI_STATES.REVERSE) {
        a.rev -= dt;
        throttle = -0.6;
        if (a.rev <= 0) { a.state = AI_STATES.CRUISE; a.stuck = 0; }
      } else {
        // Obstáculos no cone à frente (outros barcos, jogador, nadador).
        const sh = Math.sin(P.heading), ch = Math.cos(P.heading);
        let blocker = null;
        const fwd = P.forwardSpeed;
        const look = 32 + Math.max(0, fwd) * 2.5; // alcance cresce com a velocidade (distância de parada)
        for (const o of obstacles) {
          if (o.boat === b) continue;
          const ox = o.x - P.x, oz = o.z - P.z;
          const ahead = ox * sh + oz * ch;
          if (ahead < 0 || ahead > look) continue;
          const side = Math.abs(ox * ch - oz * sh);
          if (side < P.spec.width / 2 + (o.r || 2) + 2.5) { const d = ahead - P.spec.length / 2 - (o.r || 2); if (d < block) { block = d; blocker = o; } }
        }
        // Obstáculo parado bloqueando por muito tempo: contorna pelo lado mais livre.
        const still = blocker && !(blocker.boat && blocker.boat.phys.speed > 0.6);
        if (a.detour > 0) {
          a.detour -= dt;
          if (block > 3) block = Infinity; // durante o contorno só para em emergência
        } else if (still && block < look) {
          a.blockT += dt;
          if (a.blockT > 4) {
            a.detour = 20; a.blockT = 0; a.detourStart = 20;
            a.detourObj = { boat: blocker.boat || null, x: blocker.x, z: blocker.z, r: blocker.r || 2 };
            a.detourHeading = Math.atan2(tgt[0] - P.x, tgt[1] - P.z);
            const ox = blocker.x - P.x, oz = blocker.z - P.z;
            a.side = (ox * ch - oz * sh) > 0 ? -1 : 1; // obstáculo a bombordo → contorna por boreste (e vice-versa)
          }
        } else a.blockT = Math.max(0, a.blockT - dt);
        // Velocidade segura até o obstáculo; acima dela, ré proporcional (barco não tem freio).
        const vSafe = Math.max(0, (block - 5) * 0.45);
        if (block < 6) { a.state = AI_STATES.STOP; throttle = fwd > 0.3 ? -0.9 : 0; }
        else if (block < look) {
          a.state = AI_STATES.YIELD;
          throttle = fwd > vSafe + 0.5 ? -Math.min(1, (fwd - vSafe) / 3) : Math.min(throttle, 0.12 + Math.min(1, (block - 6) / 30) * 0.3);
        } else a.state = AI_STATES.CRUISE;
        // Preso (colidiu e não avança): ré curta.
        if (a.state === AI_STATES.CRUISE && throttle > 0.2 && P.speed < 0.6) { a.stuck += dt; if (a.stuck > 2.5) { a.state = AI_STATES.REVERSE; a.rev = 2; } }
        else a.stuck = Math.max(0, a.stuck - dt);
      }
      // Contorno: ~2 s de ré com o leme invertido (abre espaço e aponta a proa para o lado livre), depois avança desviando.
      let steerErr = err, backing = false;
      if (a.detour > 0 && a.detourObj) {
        // Contorno guiado pela posição do obstáculo: abre folga lateral, segue paralelo e só volta à rota quando ele fica para trás.
        const o = a.detourObj, ox = (o.boat ? o.boat.phys.x : o.x) - P.x, oz = (o.boat ? o.boat.phys.z : o.z) - P.z;
        const ahead = ox * Math.sin(a.detourHeading) + oz * Math.cos(a.detourHeading);
        const lat = Math.abs(ox * Math.cos(a.detourHeading) - oz * Math.sin(a.detourHeading));
        const clear = P.spec.width / 2 + o.r + 3;
        if (ahead < -(P.spec.length / 2 + o.r + 1)) a.detour = 0; // já passou
        // Emergência pela distância real e pelo ângulo em relação à proa (o cone largo de detecção travaria o contorno).
        const rel = Math.abs(wrap(Math.atan2(ox, oz) - P.heading));
        backing = a.detourStart - a.detour < 2.2 || (Math.hypot(ox, oz) < P.spec.length / 2 + o.r + 1 && rel < 0.7);
        steerErr = lat < clear ? wrap(a.detourHeading + a.side * 1.35 - P.heading) : wrap(a.detourHeading - P.heading);
      }
      if (a.detour > 0) { a.state = AI_STATES.DETOUR; throttle = backing ? -0.5 : Math.abs(steerErr) > 0.5 ? 0.22 : 0.45; }
      P.input.throttle = throttle;
      P.input.steer = backing ? 0 : a.state === AI_STATES.REVERSE ? -Math.sign(err) * 0.6 : Math.max(-1, Math.min(1, steerErr * 1.6));
      st[a.state] = (st[a.state] || 0) + 1;
    }
    this.stats.near = near;
    this.stats.far = far;
  }
}

const AI_NAMES = ['BLUE LAGOON', 'MISS FLAMINGO', 'SALT & NEON', 'TIDE RUNNER', 'CORAL QUEEN'];
