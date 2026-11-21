import { ImportedMap } from './ImportedMap.js';
import { LoadingOverlay } from '../ui/LoadingOverlay.js';

/**
 * Registro e alternância de mapas.
 *  - 'procedural': Sunset Beach (gerado pelo World; fica em memória quando oculto)
 *  - 'imported'  : mapas GLB de teste (descarregados ao sair)
 *
 * A troca só acontece depois que o novo mapa carregou com sucesso; em caso
 * de erro, o mapa atual permanece ativo.
 */
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

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

  async activate(id) {
    if (this.loading) return false;
    if (id === this.activeId) return true;
    const def = this.registry.get(id);
    if (!def) throw new Error(`Mapa não registrado: ${id}`);
    const game = this.game;
    this.loading = true;
    game.mapLoading = true;
    this.overlay.show(def.label, def.type === 'procedural' ? 'procedural' : 'manifest');
    let env = null;
    try {
      if (def.type === 'procedural') {
        await nextFrame();
        await nextFrame();
        env = game.world.ensureSunsetBeach();
      } else {
        const map = new ImportedMap({ id: def.id, manifestUrl: def.manifestUrl, scene: game.scene, renderer: game.renderer });
        this.pending = map;
        try {
          await map.load((phase, f) => this.overlay.progress(phase, f));
        } catch (err) {
          map.unload();
          throw err;
        }
        env = map;
        game.renderer.compile(game.scene, game.camera);
      }
      const prev = this.active;
      env.setVisible(true);
      this.active = env;
      this.activeId = id;
      game.onMapActivated(env, def);
      if (prev && prev !== env) {
        if (prev.isImported) prev.unload();
        else prev.setVisible(false);
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

  /** Alterna entre o mapa procedural e o primeiro mapa importado (atalho de dev). */
  toggle() {
    const imported = this.list().find((d) => d.type === 'imported');
    if (!imported) return Promise.resolve(false);
    return this.activate(this.activeId === imported.id ? 'sunset-beach' : imported.id);
  }
}
