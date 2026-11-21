import * as THREE from 'three';

/**
 * Grafo de faixas para a IA de trânsito, derivado do RoadNetwork existente
 * (as mesmas ruas, faixas, cruzamentos e faixas de pedestres usadas pelos
 * geradores visuais). Nada de "qualquer superfície plana é rua".
 *
 * - Segmentos: trechos de faixa entre cruzamentos (sentido de circulação,
 *   mão direita/EUA), com linha de parada antes de cada cruzamento.
 * - Conectores: curvas suaves (Bézier cúbica) dentro do cruzamento ligando
 *   uma faixa de chegada a uma de saída (reto, direita, esquerda). Esquerda
 *   sai da faixa interna, direita da externa; sem retorno em U, exceto em
 *   ruas sem saída dentro do mapa.
 * - Pontas abertas além dos limites do mapa viram "sumidouros" (o veículo é
 *   reciclado longe do jogador).
 */
const _v = new THREE.Vector3();

export class Path {
  constructor(points) {
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + points[i].distanceTo(points[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }

  /** Ponto e direção a uma distância s do início. */
  sample(s, outP, outDir) {
    const c = this.cum, P = this.points;
    s = Math.max(0, Math.min(this.length, s));
    let i = 1;
    while (i < c.length - 1 && c[i] < s) i++;
    const seg = c[i] - c[i - 1] || 1;
    const k = (s - c[i - 1]) / seg;
    if (outP) outP.lerpVectors(P[i - 1], P[i], k);
    if (outDir) outDir.subVectors(P[i], P[i - 1]).normalize();
    return outP;
  }

  /** Projeção aproximada de um ponto (distância ao longo e afastamento lateral). */
  project(p) {
    let best = Infinity, bestS = 0;
    const P = this.points;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      const abx = b.x - a.x, abz = b.z - a.z;
      const l2 = abx * abx + abz * abz || 1;
      let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2;
      t = Math.max(0, Math.min(1, t));
      const x = a.x + abx * t, z = a.z + abz * t;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) { best = d; bestS = this.cum[i - 1] + Math.sqrt(l2) * t; }
    }
    return { s: bestS, dist: Math.sqrt(best) };
  }
}

function bezier(p0, p1, p2, p3, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(new THREE.Vector3(
      u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      0.02,
      u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z,
    ));
  }
  return out;
}

export class LaneGraph {
  /**
   * @param {RoadNetwork} net
   * @param {{minX,maxX,minZ,maxZ}} bounds limites jogáveis (pontas além viram sumidouros)
   */
  constructor(net, bounds, { signals = [] } = {}) {
    this.net = net;
    this.bounds = bounds;
    this.segments = [];
    this.connectors = [];
    this.nodes = new Map(); // intersectionId -> { node, approaches: [], exits: [] }
    this.signals = new Map(signals.map((s) => [s.id, s]));
    this._build();
  }

  _build() {
    const net = this.net;
    for (const n of net.intersections.values()) this.nodes.set(n.id, { node: n, approaches: [], exits: [] });
    // Segmentos por faixa, cortados nos cruzamentos que a rua atravessa ou toca.
    for (const road of net.roads.values()) {
      const cuts = [];
      for (const n of net.intersections.values()) {
        const pr = net.project(road, n.x, n.z);
        if (Math.abs(pr.s) > road.width / 2 + 2) continue;
        // Cruzamento ao longo da rua (ou logo depois das pontas).
        if (pr.t < -n.radius - 14 || pr.t > road.length + n.radius + 14) continue;
        const half = Math.max(n.radius, this._crossHalfWidth(n, road) + 1.0);
        cuts.push({ t0: pr.t - half, t1: pr.t + half, id: n.id });
      }
      cuts.sort((a, b) => a.t0 - b.t0);
      // Intervalos livres [a, b] ao longo da rua.
      const spans = [];
      let a = 0, aNode = null;
      for (const c of cuts) {
        if (c.t1 <= 0) { aNode = c.id; a = Math.max(a, c.t1); continue; }
        if (c.t0 >= road.length) { spans.push({ a, b: road.length, aNode, bNode: c.id }); a = road.length + 1; break; }
        if (c.t0 > a + 2) spans.push({ a, b: c.t0, aNode, bNode: c.id });
        a = c.t1;
        aNode = c.id;
      }
      if (a < road.length - 2) spans.push({ a, b: road.length, aNode, bNode: null });
      for (const lane of road.lanes) {
        if (lane.type !== 'drive') continue;
        for (const sp of spans) {
          const pts = [];
          const n = Math.max(2, Math.ceil((sp.b - sp.a) / 8));
          for (let i = 0; i <= n; i++) {
            const t = sp.a + ((sp.b - sp.a) * i) / n;
            pts.push(net.pointAt(road, t, lane.offset, new THREE.Vector3(), 0.02));
          }
          if (!lane.forward) pts.reverse();
          const from = lane.forward ? sp.aNode : sp.bNode;
          const to = lane.forward ? sp.bNode : sp.aNode;
          const seg = {
            id: `${lane.id}_${Math.round(sp.a)}`, road, lane, path: new Path(pts),
            from, to, out: [], speedLimit: road.speedLimit,
            dir: lane.forward ? { x: road.dir.x, z: road.dir.z } : { x: -road.dir.x, z: -road.dir.z },
            laneIndex: lane.index, lanesPerDirection: road.lanesPerDirection,
            crosswalks: [], sink: false, idx: this.segments.length,
          };
          // Faixas de pedestres sobre este trecho (posição ao longo do segmento).
          for (const cw of net.crosswalks) {
            if (cw.roadId !== road.id) continue;
            const s = lane.forward ? cw.t - sp.a : sp.b - cw.t;
            if (s > 0 && s < seg.path.length) seg.crosswalks.push({ id: cw.id, s, half: cw.length / 2 + 0.6 });
          }
          // Ponta final sem cruzamento e fora dos limites: sumidouro.
          const end = pts[pts.length - 1];
          if (!to && !this._inside(end, 25)) seg.sink = true;
          this.segments.push(seg);
          if (to) this.nodes.get(to)?.approaches.push(seg);
          if (from) this.nodes.get(from)?.exits.push(seg);
        }
      }
    }
    // Conectores dentro de cada cruzamento.
    for (const { node, approaches, exits } of this.nodes.values()) {
      for (const inSeg of approaches) {
        for (const outSeg of exits) {
          if (outSeg.road === inSeg.road && outSeg.lane.forward !== inSeg.lane.forward) continue; // U
          const turn = this._turn(inSeg.dir, outSeg.dir);
          if (turn === 'u') continue;
          // Regras de faixa: esquerda pela interna, direita pela externa.
          const inner = inSeg.laneIndex === 0, outer = inSeg.laneIndex === inSeg.lanesPerDirection - 1;
          if (turn === 'left' && !inner) continue;
          if (turn === 'right' && !outer) continue;
          if (turn === 'left' && outSeg.laneIndex !== 0) continue;
          if (turn === 'right' && outSeg.laneIndex !== outSeg.lanesPerDirection - 1) continue;
          if (turn === 'straight' && outSeg.laneIndex !== inSeg.laneIndex && outSeg.lanesPerDirection === inSeg.lanesPerDirection) continue;
          this._connect(inSeg, outSeg, node, turn);
        }
      }
    }
    // Ruas sem saída dentro do mapa: retorno em U para não prender veículos.
    for (const seg of this.segments) {
      if (seg.to || seg.sink) continue;
      const end = seg.path.points[seg.path.points.length - 1];
      let best = null, bd = 1e9;
      for (const o of this.segments) {
        if (o.road !== seg.road || o.lane.forward === seg.lane.forward || o.from) continue;
        const d = o.path.points[0].distanceTo(end);
        if (d < bd && d < 20) { bd = d; best = o; }
      }
      if (best) this._connect(seg, best, null, 'u');
      else seg.sink = true;
    }
    // Índice espacial simples para spawn/consulta.
    this.totalLength = this.segments.reduce((s, g) => s + g.path.length, 0);
  }

  _crossHalfWidth(n, road) {
    let w = 0;
    for (const rid of n.roads) {
      const r = this.net.roads.get(rid);
      if (r && r !== road) w = Math.max(w, r.width / 2);
    }
    // Interseção em T: a rua que termina aqui não está na lista do nó.
    for (const r of this.net.roads.values()) {
      if (r === road) continue;
      const pr = this.net.project(r, n.x, n.z);
      if (Math.abs(pr.s) < r.width / 2 + 2 && pr.t > -n.radius - 14 && pr.t < r.length + n.radius + 14) w = Math.max(w, r.width / 2);
    }
    return w || n.radius;
  }

  _inside(p, margin = 0) {
    const b = this.bounds;
    return !b || (p.x > b.minX - margin && p.x < b.maxX + margin && p.z > b.minZ - margin && p.z < b.maxZ + margin);
  }

  _turn(a, b) {
    const cross = a.x * b.z - a.z * b.x;
    const dot = a.x * b.x + a.z * b.z;
    if (dot > 0.7) return 'straight';
    if (dot < -0.7) return 'u';
    // Sistema: +X à esquerda de quem olha para +Z (cross > 0 = esquerda).
    return cross > 0 ? 'right' : 'left';
  }

  _connect(inSeg, outSeg, node, turn) {
    const p0 = inSeg.path.points[inSeg.path.points.length - 1];
    const p3 = outSeg.path.points[0];
    const d = p0.distanceTo(p3);
    const k = turn === 'straight' ? d / 3 : d * 0.55;
    const p1 = _v.set(p0.x + inSeg.dir.x * k, 0, p0.z + inSeg.dir.z * k).clone();
    const p2 = new THREE.Vector3(p3.x - outSeg.dir.x * k, 0, p3.z - outSeg.dir.z * k);
    const pts = bezier(p0, p1, p2, p3, turn === 'straight' ? 4 : 10);
    const con = {
      id: `${inSeg.id}>${outSeg.id}`, from: inSeg, to: outSeg, node, turn, path: new Path(pts),
      speedLimit: turn === 'straight' ? inSeg.speedLimit : turn === 'u' ? 3.5 : 6.5, idx: this.connectors.length,
    };
    this.connectors.push(con);
    inSeg.out.push(con);
    return con;
  }

  /** Grupo de semáforo de uma aproximação (ns = eixo Z, ew = eixo X). */
  signalGroup(seg) {
    return Math.abs(seg.dir.z) > Math.abs(seg.dir.x) ? 'ns' : 'ew';
  }

  /** Estado do controle no fim de um segmento: 'green' | 'yellow' | 'red' | 'stop' | 'free'. */
  controlAt(seg) {
    if (!seg.to) return 'free';
    const n = this.nodes.get(seg.to)?.node;
    if (!n) return 'free';
    if (n.control === 'signal') {
      const sig = this.signals.get(n.id);
      if (!sig) return 'stop';
      return sig.getState(this.signalGroup(seg));
    }
    if (n.control === 'stop') return 'stop';
    return 'free';
  }

  /** Segmento mais próximo de um ponto (para colocar veículos existentes na rede). */
  nearestSegment(p, maxDist = 4) {
    let best = null, bd = maxDist, bs = 0;
    for (const seg of this.segments) {
      const pr = seg.path.project(p);
      if (pr.dist < bd) { bd = pr.dist; best = seg; bs = pr.s; }
    }
    return best ? { seg: best, s: bs, dist: bd } : null;
  }

  stats() {
    const turns = {};
    for (const c of this.connectors) turns[c.turn] = (turns[c.turn] || 0) + 1;
    return {
      segments: this.segments.length,
      connectors: this.connectors.length,
      turns,
      sinks: this.segments.filter((s) => s.sink).length,
      deadEnds: this.segments.filter((s) => !s.to && !s.sink && !s.out.length).length,
      lengthKm: +(this.totalLength / 1000).toFixed(2),
      intersections: this.nodes.size,
    };
  }
}
