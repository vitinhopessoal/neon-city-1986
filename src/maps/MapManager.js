import { TriangleMap } from './TriangleMap.js';
import { LoadingOverlay } from '../ui/LoadingOverlay.js';

/**
 * Carrega o cenário local e mantém seu estado disponível ao salvamento.
 */
export class MapManager {
  constructor(game, uiRoot) {
    this.game = game;
    this.registry = new Map();
    this.active = null;
    this.activeId = null;
    this.loading = false;
    this.pending = null;
    this.overlay = new LoadingOverlay(uiRoot);
  }

  register(def) {
    this.registry.set(def.id, def);
  }

  list() {
    return [...this.registry.values()];
  }

  get defaultId() {
    return this.registry.keys().next().value;
  }

  async activate(id) {
    if (this.loading) return false;
    if (id === this.activeId) return true;
    const def = this.registry.get(id);
    if (!def) throw new Error(`Mapa não registrado: ${id}`);
    const game = this.game;
    this.loading = true;
    game.mapLoading = true;
    this.overlay.show(def.label, 'manifest');
    try {
      const map = new TriangleMap({ id: def.id, manifestUrl: def.manifestUrl, scene: game.scene, renderer: game.renderer });
      this.pending = map;
      try {
        await map.load((phase, f) => this.overlay.progress(phase, f));
      } catch (err) {
        map.unload();
        throw err;
      }
      const env = map;
      game.renderer.compile(game.scene, game.camera);
      const prev = this.active;
      env.setVisible(true);
      this.active = env;
      this.activeId = id;
      game.onMapActivated(env, def);
      if (prev && prev !== env) {
        prev.unload();
      }
      this.overlay.hide();
      return true;
    } catch (err) {
      console.error('[MapManager]', err);
      this.overlay.error(def.label, err.message);
      setTimeout(() => this.overlay.hide(), 6000);
      game.hud?.toast(`Falha ao carregar ${def.label}`, 4);
      return false;
    } finally {
      this.pending = null;
      this.loading = false;
      game.mapLoading = false;
    }
  }
}
