import { radarProjection } from './Minimap.js';
import { formatMapDistance } from './Waypoint.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class MapViewport {
  constructor(bounds) { this.bounds = bounds; this.reset(); }
  reset() { this.zoom = 1; this.center = { x: (this.bounds.minX + this.bounds.maxX) / 2, z: (this.bounds.minZ + this.bounds.maxZ) / 2 }; }
  projection(width, height) { return radarProjection({ x: 0, z: 0 }, 0, { width, height, bounds: this.bounds, center: this.center, zoom: this.zoom }); }
  constrain() {
    this.center.x = clamp(this.center.x, this.bounds.minX, this.bounds.maxX);
    this.center.z = clamp(this.center.z, this.bounds.minZ, this.bounds.maxZ);
  }
  pan(dx, dy, width, height) {
    const scale = this.projection(width, height).scale;
    this.center.x -= dx / scale; this.center.z -= dy / scale; this.constrain();
  }
  zoomAt(factor, x, y, width, height) {
    const before = this.projection(width, height).unproject(x, y);
    this.zoom = clamp(this.zoom * factor, 1, 10);
    const after = this.projection(width, height).unproject(x, y);
    this.center.x += before.x - after.x; this.center.z += before.z - after.z; this.constrain();
  }
}

/** Paused, full-screen map. Click coordinates and radar markers share one projection. */
export class WorldMapView {
  constructor(minimap, container) {
    this.minimap = minimap;
    this.viewport = new MapViewport(minimap.mapData?.bounds || minimap.bounds);
    this.el = document.createElement('div'); this.el.className = 'world-map-view';
    this.el.innerHTML = `<canvas tabindex="0" role="img" aria-label="Mapa interativo do Vice City"></canvas>
      <div class="world-map-toolbar" aria-label="Controles do mapa">
        <button data-map-action="zoom-in" aria-label="Aproximar mapa">+</button>
        <button data-map-action="zoom-out" aria-label="Afastar mapa">−</button>
        <button data-map-action="fit">Mapa inteiro</button><button data-map-action="player">Minha posição</button>
        <button data-map-action="clear">Remover destino</button>
      </div>
      <div class="world-map-status"><strong data-map-destination role="status"></strong><span data-map-coordinates></span></div>
      <div class="world-map-help">CLIQUE: MARCAR DESTINO <span>ARRASTE: MOVER · RODA: ZOOM · BOTÃO DIREITO: REMOVER</span></div>`;
    container.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.destination = this.el.querySelector('[data-map-destination]');
    this.coordinates = this.el.querySelector('[data-map-coordinates]');
    this.clearButton = this.el.querySelector('[data-map-action="clear"]');
    this.cursor = { ...this.viewport.center };
    this.drag = null;
    const point = event => { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const p = point(event); this.drag = { ...p, moved: false };
      this.canvas.setPointerCapture?.(event.pointerId); this.canvas.focus(); event.preventDefault();
    });
    this.canvas.addEventListener('pointermove', event => {
      const p = point(event);
      if (this.drag) {
        const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
        if (Math.hypot(dx, dy) > 3) this.drag.moved = true;
        if (this.drag.moved) { this.viewport.pan(dx, dy, this.width, this.height); this.drag.x = p.x; this.drag.y = p.y; }
      }
      this.cursor = this.viewport.projection(this.width, this.height).unproject(p.x, p.y); this.render();
    });
    this.canvas.addEventListener('pointerup', event => {
      if (!this.drag) return;
      if (!this.drag.moved) {
        const p = point(event); this.cursor = this.viewport.projection(this.width, this.height).unproject(p.x, p.y);
        this.invalidSelection = !this.minimap.setWaypoint(this.cursor);
      }
      this.drag = null; this.canvas.releasePointerCapture?.(event.pointerId); this.render();
    });
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; });
    this.canvas.addEventListener('contextmenu', event => { event.preventDefault(); this.invalidSelection = false; this.minimap.clearWaypoint(); });
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault(); const p = point(event);
      this.viewport.zoomAt(Math.exp(-event.deltaY * 0.0015), p.x, p.y, this.width, this.height); this.render();
    }, { passive: false });
    this.el.addEventListener('click', event => {
      const button = event.target.closest('[data-map-action]'); if (!button) return;
      const action = button.dataset.mapAction;
      if (action === 'zoom-in' || action === 'zoom-out') this.viewport.zoomAt(action === 'zoom-in' ? 1.5 : 1 / 1.5, this.width / 2, this.height / 2, this.width, this.height);
      if (action === 'fit') this.viewport.reset();
      if (action === 'player') { this.viewport.center = { ...(minimap.position || minimap.env.spawnPoint) }; this.viewport.zoom = 5; this.viewport.constrain(); }
      if (action === 'clear') minimap.clearWaypoint();
      this.invalidSelection = false;
      this.cursor = { ...this.viewport.center }; this.render();
    });
    this.unsubscribe = minimap.subscribe(() => this.render());
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this.el);
    this.resize();
  }
  resize() {
    const rect = this.el.getBoundingClientRect();
    this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.pixelRatio); this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.render();
  }
  render() {
    if (this.disposed || !this.width) return;
    this.minimap.draw(this.canvas, true, { colored: true, pixelRatio: this.pixelRatio, center: this.viewport.center, zoom: this.viewport.zoom, crosshair: this.cursor });
    const waypoint = this.minimap.waypoint;
    this.destination.textContent = this.invalidSelection ? 'ESCOLHA UM PONTO DENTRO DOS LIMITES DO MAPA' : waypoint ? `◆ DESTINO · ${formatMapDistance(this.minimap.waypointDistance)} EM LINHA RETA` : 'CLIQUE NO MAPA PARA MARCAR SEU DESTINO';
    this.coordinates.textContent = `X ${this.cursor.x.toFixed(0)} · Z ${this.cursor.z.toFixed(0)} · ${this.viewport.zoom.toFixed(1)}×`;
    this.clearButton.disabled = !waypoint;
  }
  handleKey(event) {
    const movement = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[event.code];
    if (movement) { this.viewport.pan(...movement, this.width, this.height); this.cursor = { ...this.viewport.center }; }
    else if (['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(event.code)) this.viewport.zoomAt(['Equal', 'NumpadAdd'].includes(event.code) ? 1.5 : 1 / 1.5, this.width / 2, this.height / 2, this.width, this.height);
    else if (event.code === 'Home') { this.viewport.reset(); this.cursor = { ...this.viewport.center }; }
    else if (event.code === 'Delete' || event.code === 'Backspace') { this.invalidSelection = false; this.minimap.clearWaypoint(); }
    else if (event.code === 'Enter' && event.target === this.canvas) this.invalidSelection = !this.minimap.setWaypoint(this.cursor);
    else return false;
    this.render(); return true;
  }
  dispose() { this.disposed = true; this.drag = null; this.resizeObserver.disconnect(); this.unsubscribe(); }
}
