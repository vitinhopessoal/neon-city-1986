// Heading-up circular radar drawn from the same layout as the playable world.
// Canvas2D adds no WebGL draw calls; refresh is limited to ten times a second.
export class Minimap {
  constructor(parent) {
    this.el = document.createElement('div');
    this.el.className = 'hud-minimap';
    this.el.innerHTML = '<canvas width="408" height="408" aria-label="Mapa da cidade: ruas, pontos de interesse e jogador"></canvas><div class="minimap-caption"><span>N / NORTE</span><span data-map-mode>N: MAPA GERAL</span></div>';
    parent.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.caption = this.el.querySelector('[data-map-mode]');
    this.overview = false;
    this.timer = 0;
    if (typeof Image !== 'undefined') {
      this.frame = new Image();
      this.frame.onload = () => { this.timer = 0; };
      this.frame.src = `${import.meta.env?.BASE_URL || './'}hud/vice/radardisc.png`;
    }
  }

  setEnvironment(env) {
    this.env = env;
    // Área jogável completa: bairros anexados (TEST CITY) entram no mesmo radar.
    this.bounds = env.playBounds || env.bounds || env.manifest?.bounds;
    this.roads = env.roads?.roads ? [...env.roads.roads.values()] : (env.manifest?.roads || []);
    this.buildings = env.districts?.flatMap(d => d.buildings || []) || [];
    this.overlays = env.districts?.flatMap(d => d.overlays || []) || [];
    this.regions = env.districts?.flatMap(d => d.regions || [d]) || [];
    this.el.hidden = !this.bounds || !this.roads.length || !this.ctx;
    this.timer = 0;
  }

  toggle() {
    this.overview = !this.overview;
    this.caption.textContent = this.overview ? 'N: MAPA LOCAL' : 'N: MAPA GERAL';
    this.timer = 0;
  }

  update(dt, position, yaw) {
    if (this.el.hidden || !this.env) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const ctx = this.ctx, size = 204, b = this.bounds;
    const range = this.overview ? Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 50 : 220;
    const scale = size / range;
    const cx = this.overview ? (b.minX + b.maxX) / 2 : position.x;
    const cz = this.overview ? (b.minZ + b.maxZ) / 2 : position.z;
    const x = v => size / 2 + (v - cx) * scale;
    const y = v => size / 2 + (v - cz) * scale;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#72b9cf'; ctx.fillRect(0, 0, size, size);
    const rotation = this.overview ? 0 : Math.PI + yaw;
    ctx.translate(size / 2, size / 2); ctx.rotate(rotation); ctx.translate(-size / 2, -size / 2);
    ctx.save();
    ctx.beginPath();
    for (const r of b.rects || [b]) ctx.rect(x(r.minX), y(r.minZ), (r.maxX - r.minX) * scale, (r.maxZ - r.minZ) * scale);
    ctx.clip();
    ctx.fillStyle = '#075537'; ctx.fillRect(-size, -size, size * 3, size * 3);
    for (const d of this.env.districts || []) {
      if (!d.annex) continue;
      // Bairro anexado: quadra de asfalto (o chão do GLB é asfalto entre as calçadas).
      ctx.fillStyle = '#5f6b6e';
      ctx.fillRect(x(d.bounds.minX), y(d.bounds.minZ), (d.bounds.maxX - d.bounds.minX) * scale, (d.bounds.maxZ - d.bounds.minZ) * scale);
    }
    if (!this.env.isImported) {
      ctx.fillStyle = '#d4c78e'; ctx.fillRect(x(54), -size * 3, (110 - 54) * scale, size * 7);
      ctx.fillStyle = '#72b9cf'; ctx.fillRect(x(93), -size * 3, size * 6, size * 7);
      ctx.fillStyle = '#e5dfc1'; ctx.fillRect(x(38), -size * 3, 16 * scale, size * 7);
    }
    for (const o of this.overlays) {
      ctx.fillStyle = o.surface === 'grass' ? '#276d48' : '#dce9dd';
      ctx.fillRect(x(o.minX), y(o.minZ), (o.maxX - o.minX) * scale, (o.maxZ - o.minZ) * scale);
    }
    ctx.strokeStyle = '#f7fff5'; ctx.lineCap = 'butt';
    for (const r of this.roads) {
      ctx.lineWidth = Math.max(2, (r.width || 12) * scale);
      ctx.beginPath(); ctx.moveTo(x(r.start.x), y(r.start.z)); ctx.lineTo(x(r.end.x), y(r.end.z)); ctx.stroke();
    }
    for (const building of this.buildings) {
      const w = building.lotW || building.w || 18, d = building.lotD || building.d || 18;
      ctx.save(); ctx.translate(x(building.x), y(building.z)); ctx.rotate(-(building.rotY || 0));
      ctx.fillStyle = '#dceada';
      ctx.fillRect(-w * scale / 2, -d * scale / 2, w * scale, d * scale); ctx.restore();
    }
    for (const poi of this.env.pois || []) {
      if (poi.type !== 'landmark') continue;
      ctx.fillStyle = '#ffd083'; ctx.beginPath(); ctx.arc(x(poi.x), y(poi.z), 2.8, 0, Math.PI * 2); ctx.fill();
    }
    if (this.overview) {
      ctx.font = 'bold 8px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#f0e8d8';
      for (const region of this.regions) {
        const rb = region.bounds;
        ctx.fillText(region.name, x(region.labelX ?? -20), y((rb.minZ + rb.maxZ) / 2));
      }
    }
    ctx.restore();
    // Marcadores de propriedades (PROMPT 07): residência própria, à venda, garagem.
    for (const m of this.markers?.() || []) {
      const mx = x(m.x), my = y(m.z);
      ctx.save(); ctx.translate(mx, my); ctx.rotate(-rotation);
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#10151c';
      if (m.kind === 'home') {
        ctx.fillStyle = '#5dff9c'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(6, 0); ctx.lineTo(4, 0); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.lineTo(-4, 0); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (m.kind === 'sale') {
        ctx.fillStyle = '#ffe95a'; ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#10151c'; ctx.font = '900 8px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 0.5);
      } else if (m.kind === 'marina') {
        ctx.fillStyle = '#2fd3c6'; ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#10151c'; ctx.font = '900 7px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('M', 0, 0.5);
      } else if (m.kind === 'boat') {
        ctx.fillStyle = '#45f3ff'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (m.kind === 'garage') {
        ctx.fillStyle = '#45a0ff'; ctx.fillRect(-4.5, -4.5, 9, 9); ctx.strokeRect(-4.5, -4.5, 9, 9);
        ctx.fillStyle = '#fff'; ctx.font = '900 7px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('G', 0, 0.5);
      }
      ctx.restore();
    }
    for (const contact of this.police?.radarContacts() || []) {
      ctx.fillStyle = Math.sin(this.police.time * 8) > 0 ? '#ff3c65' : '#4c9fff';
      ctx.strokeStyle = '#10151c'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x(contact.x), y(contact.z), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // Pointer uses the character/vehicle heading (+Z local), not camera orbit.
    ctx.save(); ctx.translate(x(position.x), y(position.z)); ctx.rotate(Math.PI - yaw);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#101a18'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.restore(); // Circular clipping and rotating map.
    if (this.frame?.complete && this.frame.naturalWidth) ctx.drawImage(this.frame, 0, 0, size, size);
    const nx = size / 2 + Math.sin(rotation) * 90, ny = size / 2 - Math.cos(rotation) * 90;
    ctx.fillStyle = '#071412'; ctx.beginPath(); ctx.arc(nx, ny, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#bde7ed'; ctx.font = '900 15px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', nx, ny + 1);
  }

  dispose() { this.el.remove(); }
}
