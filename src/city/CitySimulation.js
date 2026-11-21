import { CONFIG } from '../config.js';
import { UrbanEvents } from './UrbanEvents.js';
import { TrafficManager } from '../traffic/TrafficManager.js';
import { PedestrianManager } from '../pedestrians/PedestrianManager.js';
import { VehicleOccupants } from '../traffic/VehicleOccupants.js';
import { PoliceManager } from '../police/PoliceManager.js';

/**
 * Simulação urbana: eventos + trânsito + pedestres. Ordem no Game.step:
 *   update(dt)     — antes da física dos veículos (IA decide os comandos);
 *   postUpdate(dt) — depois da física (progresso nas rotas, pedestres).
 * Densidade: CONFIG.city.density ou ?density=off|low|medium|high.
 * Depuração (somente desenvolvimento): F10 mostra rede, rotas e estados.
 */
export class CitySimulation {
  constructor(game) {
    this.game = game;
    const q = new URLSearchParams(location.search).get('density');
    if (q && (q === 'off' || CONFIG.city.profiles[q])) CONFIG.city.density = q;
    this.enabled = CONFIG.city.density !== 'off';
    this.events = new UrbanEvents();
    this.traffic = new TrafficManager(game, this.events);
    this.peds = new PedestrianManager(game, this.events);
    this.occupants = new VehicleOccupants(game, Math.max(...Object.values(CONFIG.city.profiles).map(p => p.vehicles)) * 3);
    this.police = new PoliceManager(game, this.events);
    for (const event of ['gunshot', 'propBreak', 'collision', 'horn']) this.events.on(event, e => this.occupants.perceive(e));
    this.debug = null;
  }

  onMapActivated(env) {
    this.traffic.onMapActivated(env);
    if (this.enabled) this.peds.onMapActivated(env, this.traffic);
    this.occupants.onMapActivated(env);
    this.police.onMapActivated(env, this.traffic.graph);
    this.debug?.rebuild(this);
  }

  update(dt) {
    this.events.update(dt);
    this.police.update(dt);
    if (!this.enabled) return;
    this.traffic.update(dt);
  }

  postUpdate(dt) {
    this.police.postUpdate(dt);
    if (!this.enabled) return;
    this.traffic.postUpdate(dt);
    this.peds.update(dt);
    this.occupants.update(dt);
    this.debug?.update(this);
  }

  /** Alterna as ferramentas de depuração (carregadas só em desenvolvimento). */
  async toggleDebug() {
    if (!import.meta.env.DEV) return false;
    if (!this.debug) {
      const { CityDebug } = await import('./CityDebug.js');
      this.debug = new CityDebug(this.game);
      this.debug.rebuild(this);
      return true;
    }
    this.debug.dispose();
    this.debug = null;
    return false;
  }

  summary() {
    return { density: CONFIG.city.density, traffic: this.traffic.summary(), peds: this.peds.summary(), occupants: this.occupants.summary(), police: this.police.summary(), events: { ...this.events.counts } };
  }
}
