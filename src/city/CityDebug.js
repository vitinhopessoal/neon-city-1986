import * as THREE from 'three';

/**
 * Depuração visual da simulação urbana (somente desenvolvimento; carregado
 * por import dinâmico, fora do build público):
 * - segmentos de faixa (ciano), conversões (amarelo), sumidouros (vermelho);
 * - rede de pedestres (rosa) e faixas de pedestres (branco);
 * - marcador colorido sobre cada carro conforme o estado da IA;
 * - painel de texto com contagens e tempos de atualização.
 */
const STATE_COLORS = {
  CRUISING: 0x3fff7a, FOLLOWING: 0x3fd0ff, BRAKING: 0xffb03f, STOPPED: 0xff3f3f, WAITING_SIGNAL: 0xff3f9f,
  TURNING: 0xfff03f, YIELDING: 0xb07aff, AVOIDING: 0xff7a3f, PARKING: 0xffffff, PARKED: 0x777777, PULLING_OUT: 0xdddddd, RECOVERING: 0x000000,
};

export class CityDebug {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'cityDebug';
    game.scene.add(this.group);
    this.markers = [];
    this.markerGeo = new THREE.OctahedronGeometry(0.35);
    this.panel = document.createElement('div');
    this.panel.style.cssText = 'position:absolute;right:22px;top:64px;padding:8px 10px;font:11px/1.35 monospace;color:#fff;background:rgba(20,10,36,.78);border:1px solid #ff4fb8;border-radius:6px;white-space:pre;pointer-events:none;z-index:5';
    this.panel.className = 'hud-city-debug';
    (game.hud?.el || game.uiRoot || document.body).appendChild(this.panel);
  }

  rebuild(city) {
    for (const o of [...this.group.children]) { o.geometry?.dispose(); this.group.remove(o); }
    this.markers = [];
    const g = city.traffic.graph;
    if (!g) return;
    const line = (pts, color, y = 0.25) => {
      const arr = [];
      for (let i = 1; i < pts.length; i++) arr.push(pts[i - 1].x, y, pts[i - 1].z, pts[i].x, y, pts[i].z);
      return { arr, color };
    };
    const buckets = new Map();
    const push = ({ arr, color }) => { if (!buckets.has(color)) buckets.set(color, []); buckets.get(color).push(...arr); };
    for (const s of g.segments) push(line(s.path.points, s.sink ? 0xff3030 : 0x3ff0ff));
    for (const c of g.connectors) push(line(c.path.points, 0xfff03f));
    const peds = city.peds;
    for (const n of peds.nodes) for (const l of n.links) {
      if (l.to < n.i) continue;
      const o = peds.nodes[l.to];
      push({ arr: [n.x, n.y + 0.3, n.z, o.x, o.y + 0.3, o.z], color: l.cw ? 0xffffff : 0xff4fb8 });
    }
    for (const [color, arr] of buckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }));
      ls.renderOrder = 10;
      ls.frustumCulled = false;
      this.group.add(ls);
    }
  }

  update(city) {
    const T = city.traffic;
    while (this.markers.length < T.agents.length) {
      const m = new THREE.Mesh(this.markerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
      m.renderOrder = 11;
      this.group.add(m);
      this.markers.push(m);
    }
    this.markers.forEach((m, i) => {
      const a = T.agents[i];
      m.visible = !!a;
      if (!a) return;
      const p = a.v.root.position;
      m.position.set(p.x, p.y + 2.4, p.z);
      m.material.color.setHex(STATE_COLORS[a.state] ?? 0xffffff);
      m.scale.setScalar(a.mode === 'phys' ? 1.2 : 0.7);
    });
    if ((this._t = (this._t || 0) + 1) % 15) return;
    const s = city.summary();
    const t = s.traffic, p = s.peds;
    const occupants = s.occupants;
    this.panel.textContent = [
        `POLÍCIA ${s.police.phase} | viaturas ${s.police.units} | agentes ${s.police.officers} | helicóptero ${s.police.helicopter ? 'sim' : 'não'}`,
        `  papéis ${(s.police.roles || []).join(', ') || '—'} | crimes ${s.police.crimes?.reported ?? 0} (dedup ${s.police.crimes?.deduped ?? 0}, sem testemunha ${s.police.crimes?.unwitnessed ?? 0})`,
      `CIDADE (dev) — densidade ${s.density}`,
      `ocupantes ${occupants.count} / ${Object.entries(occupants.states).map(([state, count]) => `${state}:${count}`).join(' ')} | saídas ${occupants.exited} | entradas ${occupants.entered}`,
      `carros ${t.agents}/${t.max} · física ${t.modes.phys} · cinemático ${t.modes.kin} · pool ${t.pool}`,
      `estados ${Object.entries(t.states).map(([k, v]) => `${k}:${v}`).join(' ')}`,
      `IA carros ${t.aiMs} ms · pedestres ${p.aiMs} ms`,
      `pedestres ${p.peds}/${p.max} · ${Object.entries(p.states).map(([k, v]) => `${k}:${v}`).join(' ')}`,
      `travessias ${p.crossings} · fugas ${p.flee} · sustos ${p.startled} · atropelados ${p.knocked}`,
      `vagas: estacionaram ${t.parked} · saíram ${t.pulledOut} · recuperações ${t.recoveries}`,
      `rede: ${t.graph?.segments} trechos · ${t.graph?.connectors} conversões · ${p.nodes} nós a pé`,
    ].join('\n');
  }

  dispose() {
    for (const o of this.group.children) { o.geometry?.dispose(); o.material?.dispose(); }
    this.group.removeFromParent();
    this.markerGeo.dispose();
    this.panel.remove();
  }
}
