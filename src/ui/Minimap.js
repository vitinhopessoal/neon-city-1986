import { validateWaypoint, waypointIndicator, formatMapDistance, readWaypoint, storeWaypoint } from './Waypoint.js';

// The same invertible projection serves the radar and clickable world map.
export function radarProjection(position, yaw, { width = 336, height = 180, range = 460, northUp = false, bounds = null, zoom = 1, center = null } = {}) {
  const scale = bounds ? Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxZ - bounds.minZ)) * 0.94 * zoom : width / range;
  const cx = bounds ? (center?.x ?? (bounds.minX + bounds.maxX) / 2) : position.x;
  const cz = bounds ? (center?.z ?? (bounds.minZ + bounds.maxZ) / 2) : position.z;
  const rotation = bounds || northUp ? 0 : Math.PI + yaw;
  const px = width / 2, py = bounds ? height / 2 : height * 0.64;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  return { scale, cx, cz, rotation, px, py,
    project(x, z) { const dx = (x - cx) * scale, dz = (z - cz) * scale;
      return { x: px + dx * cos - dz * sin, y: py + dx * sin + dz * cos }; },
    unproject(x, y) { const dx = (x - px) / scale, dz = (y - py) / scale;
      return { x: cx + dx * cos + dz * sin, z: cz - dx * sin + dz * cos }; },
  };
}

export class Minimap {
  constructor(parent) {
    this.el = document.createElement('div'); this.el.className = 'hud-minimap';
    this.el.innerHTML = '<canvas width="672" height="360" role="img" aria-label="Minimapa do Vice City: ruas reais e jogador"></canvas><div class="minimap-caption"><span data-map-mode>VICE CITY</span><span data-scale>100 m</span></div><div class="minimap-health" role="progressbar" aria-label="Saúde" aria-valuemin="0" aria-valuemax="100"><i></i></div>';
    parent.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas'); this.ctx = this.canvas.getContext('2d');
    this.caption = this.el.querySelector('[data-map-mode]'); this.scaleLabel = this.el.querySelector('[data-scale]');
    this.health = this.el.querySelector('.minimap-health'); this.healthFill = this.el.querySelector('.minimap-health i');
    this.overview = false; this.timer = 0;
    this.waypoint = null; this.listeners = new Set();
    this.settings = { northUp: false, zoom: 1, colorBlind: 'off' };
  }
  configure(settings) { Object.assign(this.settings, settings); this.timer = 0; }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  _notify() { for (const listener of this.listeners) listener(); }
  setWaypoint(point) {
    const valid = validateWaypoint(point, this.mapData?.bounds || this.bounds);
    if (!valid) return false;
    this.waypoint = valid; storeWaypoint(this.env.id || 'vice-city', valid); this.timer = 0; this._notify(); return true;
  }
  clearWaypoint() { this.waypoint = null; storeWaypoint(this.env?.id || 'vice-city', null); this.timer = 0; this._notify(); }
  get waypointDistance() {
    const position = this.position || this.env?.spawnPoint;
    return position && this.waypoint ? Math.hypot(this.waypoint.x - position.x, this.waypoint.z - position.z) : null;
  }
  setEnvironment(env) {
    this.env = env; this.bounds = env.playBounds || env.bounds || env.manifest?.bounds;
    this.roads = env.roads?.roads ? [...env.roads.roads.values()] : (env.manifest?.roads || []);
    this.mapData = env.manifest?.minimap;
    this.waypoint = readWaypoint(env.id || 'vice-city', this.mapData?.bounds || this.bounds);
    this.image = null; this.imageReady = false; this.imageError = false;
    this.el.hidden = !this.bounds || !this.ctx;
    if (this.mapData?.image && typeof Image !== 'undefined') {
      const image = new Image(); this.image = image;
      image.onload = () => { if (this.image === image) { this.imageReady = true; this.timer = 0; this._notify(); } };
      image.onerror = () => { if (this.image === image) this.imageError = true; };
      const base = env.manifestUrl?.slice(0, env.manifestUrl.lastIndexOf('/') + 1) || '';
      image.src = base + this.mapData.image;
    }
    this.timer = 0;
  }
  toggle() {
    this.overview = !this.overview; this.caption.textContent = this.overview ? 'VICE CITY · GERAL' : 'VICE CITY'; this.timer = 0;
  }
  update(dt, position, yaw, status = null) {
    this.position = { x: position.x, z: position.z }; this.yaw = yaw;
    if (status && this.healthFill?.style) {
      this.healthFill.style.width = `${status.health}%`; this.health.setAttribute?.('aria-valuenow', String(status.health));
    }
    if (this.el.hidden || !this.env) return;
    this.timer -= dt; if (this.timer > 0) return; this.timer = 0.1;
    this.draw(this.canvas, this.overview);
  }
  draw(canvas, overview = true, { colored = false, pixelRatio = 2, zoom = 1, center = null, crosshair = null } = {}) {
    const ctx = canvas.getContext('2d'); if (!ctx || !this.bounds) return;
    const width = canvas.width / pixelRatio, height = canvas.height / pixelRatio;
    const position = this.position || this.env.spawnPoint || { x: 0, z: 0 }, yaw = this.yaw ?? 0;
    const projection = radarProjection(position, yaw, { width, height, range: 460 * this.settings.zoom,
      northUp: this.settings.northUp, bounds: overview ? (this.mapData?.bounds || this.bounds) : null, zoom, center });
    const { px, py, rotation, scale, cx, cz } = projection;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colored ? '#80b1d6' : '#374a50'; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    ctx.save(); ctx.translate(px, py); ctx.rotate(rotation); ctx.scale(scale, scale); ctx.translate(-cx, -cz);
    if (this.imageReady) {
      const b = this.mapData.bounds;
      ctx.filter = colored ? 'none' : 'grayscale(1) invert(1) contrast(.8) brightness(.78)';
      ctx.drawImage(this.image, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ); ctx.filter = 'none';
    } else if (this.roads.length) {
      // Fixtures draw their actual graph. No guessed streets when metadata is absent.
      ctx.strokeStyle = '#d4d8d2'; ctx.lineCap = 'butt';
      for (const r of this.roads) {
        ctx.lineWidth = r.width || 12; ctx.beginPath(); ctx.moveTo(r.start.x, r.start.z); ctx.lineTo(r.end.x, r.end.z); ctx.stroke();
      }
    }
    ctx.restore();
    for (const marker of this.markers?.() || []) this._marker(ctx, projection, marker);
    for (const vehicle of this.env.vehicles || []) {
      if (!vehicle.root?.position || Math.hypot(vehicle.root.position.x - position.x, vehicle.root.position.z - position.z) < 3) continue;
      this._marker(ctx, projection, { x: vehicle.root.position.x, z: vehicle.root.position.z, kind: 'vehicle' });
    }
    for (const contact of this.police?.radarContacts() || []) this._marker(ctx, projection, { ...contact, kind: 'police' });
    if (crosshair) {
      const target = projection.project(crosshair.x, crosshair.z);
      ctx.strokeStyle = '#ef81b9a6'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(target.x, 0); ctx.lineTo(target.x, height); ctx.moveTo(0, target.y); ctx.lineTo(width, target.y); ctx.stroke();
    }
    if (this.waypoint) this._drawWaypoint(ctx, projection, position, width, height, overview);
    const player = projection.project(position.x, position.z);
    ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(Math.PI - yaw + rotation);
    ctx.fillStyle = this.settings.colorBlind === 'off' ? '#f5f4ee' : '#ffe35d'; ctx.strokeStyle = '#20202b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    if (!this.imageReady && !this.roads.length) {
      ctx.fillStyle = '#f1f5ef'; ctx.font = '12px Arial'; ctx.textAlign = 'center';
      ctx.fillText(this.imageError ? 'Radar local indisponível' : 'Carregando radar…', width / 2, 24);
    }
    ctx.restore();
    const nx = width - 20, ny = 22;
    ctx.fillStyle = '#14191e'; ctx.beginPath(); ctx.arc(nx, ny, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', nx, ny);
    ctx.save(); ctx.translate(nx, ny); ctx.rotate(rotation); ctx.strokeStyle = '#f2c1e6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(0, -13); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = '#f7f5e9'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(width - 96, height - 12); ctx.lineTo(width - 96, height - 7); ctx.lineTo(width - 16, height - 7); ctx.lineTo(width - 16, height - 12); ctx.stroke();
    if (!overview && this.scaleLabel) this.scaleLabel.textContent = `${Math.round(80 / scale)} m`;
    if (canvas === this.canvas) {
      this.caption.textContent = this.waypoint ? `DESTINO · ${formatMapDistance(this.waypointDistance)}` : this.overview ? 'VICE CITY · GERAL' : 'VICE CITY';
      this.el.classList?.toggle('has-waypoint', !!this.waypoint);
    }
    canvas.setAttribute?.('aria-label', `Mapa fiel do Vice City. Jogador em X ${position.x.toFixed(1)}, Z ${position.z.toFixed(1)}. ${overview ? 'Cidade completa.' : 'Vista local.'}${this.waypoint ? ` Destino em X ${this.waypoint.x.toFixed(1)}, Z ${this.waypoint.z.toFixed(1)}, distância direta ${formatMapDistance(this.waypointDistance)}.` : ''}`);
    return projection;
  }
  _drawWaypoint(ctx, projection, position, width, height, overview) {
    const target = projection.project(this.waypoint.x, this.waypoint.z);
    const origin = projection.project(position.x, position.z);
    const indicator = overview ? { ...target, inside: true, angle: 0 } : waypointIndicator(target, origin, width, height);
    ctx.save(); ctx.translate(indicator.x, indicator.y);
    ctx.fillStyle = '#d16bff'; ctx.strokeStyle = '#241333'; ctx.lineWidth = 3;
    ctx.beginPath();
    if (!indicator.inside) {
      ctx.rotate(indicator.angle); ctx.moveTo(0, -10); ctx.lineTo(7, 6); ctx.lineTo(0, 3); ctx.lineTo(-7, 6);
    } else { ctx.moveTo(0, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.lineTo(-8, 0); }
    ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  _marker(ctx, projection, marker) {
    const p = projection.project(marker.x, marker.z);
    ctx.fillStyle = ({ home: '#91d5ae', sale: '#edcc71', garage: '#81c8dd', marina: '#8bcac6', boat: '#92cfef', police: '#f695b8', vehicle: '#e3e2d8' })[marker.kind] || '#dab0e8';
    ctx.strokeStyle = '#222630'; ctx.lineWidth = 1.5;
    ctx.fillRect(p.x - 4, p.y - 4, 8, 8); ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
    const symbol = ({ home: 'H', sale: '$', garage: 'G', marina: 'M', police: '!' })[marker.kind];
    if (symbol) { ctx.fillStyle = '#182029'; ctx.font = 'bold 7px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(symbol, p.x, p.y + 0.5); }
  }
  dispose() { this.listeners.clear(); this.image = null; this.el.remove(); }
}
