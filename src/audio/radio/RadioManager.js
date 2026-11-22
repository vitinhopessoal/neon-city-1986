import { STATIONS, STATION_BY_ID, DIAL } from './RadioStations.js';
import { RadioScheduler } from './RadioScheduler.js';
import { RadioNews } from './RadioNews.js';
import { RadioPlayback } from './RadioPlayback.js';
import { RadioUI } from './RadioUI.js';

/**
 * NEON RADIO NETWORK (PROMPT 14) — integra o rádio ao mundo, sem um segundo sistema de áudio:
 * usa o AudioContext e os barramentos do AudioManager (canal "rádio").
 *
 * Fontes (uma por vez, um único receptor ativo):
 *  - dentro do carro ou de uma lancha com rádio: saída direta, estação do veículo;
 *  - dentro de uma loja/casa com rádio configurado: saída de interior;
 *  - a pé: o último carro do jogador (até 30 m) ou o carro de NPC mais próximo com rádio
 *    ligado (até 12 m), por áudio espacial atenuado.
 * Controles: scroll do mouse DENTRO de veículos abre a roleta (a pé o scroll segue nas armas).
 */
const NPC_WEIGHTS = { neon_fm: 3, groove: 2, thunder_rock: 2, street_beat: 2, ocean_breeze: 2, tropical: 2, city_talk: 1, midnight_jazz: 1, off: 2 };
const NO_RADIO_BOATS = new Set(['jetski']);

export class RadioManager {
  constructor(game) {
    this.game = game;
    this.sched = new RadioScheduler();
    this.sched.reset();
    this.news = new RadioNews(game, this.sched);
    this.playback = new RadioPlayback(game.audio, import.meta.env?.BASE_URL ?? '/');
    this.playback.onEnded = () => this._sync();
    this.ui = new RadioUI(game.hud.el);
    this.ui.onSelect = (id) => this.tune(id);
    this.station = 'neon_fm';        // última escolha do jogador
    this.vehicle = null;             // veículo/barco em que o jogador está
    this.lastVehicle = null;         // último veículo do jogador (rádio ouvido de fora)
    this.source = null;              // { kind, station, pos? }
    this.stats = { tunes: 0, enters: 0, npcHeard: 0 };
    this._npcT = 0;
    this._npc = null;
  }

  attachEvents(events) { this.news.attach(events); }

  /** Nova partida: programação recomeça de um ponto qualquer (não da 1ª faixa). */
  newGame() {
    this.sched.reset();
    this.station = 'neon_fm';
    this.lastVehicle = null;
  }

  /** Sintoniza (roleta ou código). 'off' desliga o rádio do veículo atual. */
  tune(id) {
    if (!DIAL.includes(id)) return false;
    this.station = id;
    if (this.vehicle) this.vehicle.radioStation = id;
    this.stats.tunes++;
    // A fonte direta passa a ser a nova estação já neste quadro (sem tocar a anterior por um instante).
    if (this.vehicle) this.source = id === 'off' ? null : { kind: 'direct', station: id };
    this.ui.showStation(id, this._nowText(id));
    this._sync();
    return true;
  }

  _nowText(id) {
    if (id === 'off') return '';
    const seg = this.sched.current(id);
    if (!seg) return '';
    if (seg.k === 'track') return `♪ ${seg.title} — ${seg.artist}`;
    if (seg.k === 'talk') return `No ar: ${seg.title}`;
    if (seg.k === 'news' || seg.k === 'lead') return 'Notícias';
    if (seg.k === 'ad') return 'Intervalo comercial';
    return STATION_BY_ID.get(id)?.djName ? `Com ${STATION_BY_ID.get(id).djName}` : '';
  }

  /** Emissora de um veículo: NPC ganha uma estação própria; carro do jogador usa a última escolha. */
  stationOf(v) {
    if (!v) return 'off';
    if (v.radioStation === undefined) {
      if (v.driver === 'ai' || String(v.id).startsWith('traffic')) {
        const tot = Object.values(NPC_WEIGHTS).reduce((a, b) => a + b, 0);
        let r = (Math.abs([...String(v.id)].reduce((h, c) => (h * 33 + c.charCodeAt(0)) | 0, 5381)) % 1000) / 1000 * tot;
        v.radioStation = 'off';
        for (const [k, w] of Object.entries(NPC_WEIGHTS)) { r -= w; if (r <= 0) { v.radioStation = k; break; } }
      } else v.radioStation = this.station;
    }
    return v.radioStation;
  }

  _boatHasRadio(b) { return b && !NO_RADIO_BOATS.has(b.type || b.spec?.id); }

  update(dt, input) {
    const g = this.game;
    this.news.update(dt);
    this.sched.context.timeOfDay = g.world?.timeOfDay === 'morning' ? 'morning' : g.world?.timeOfDay === 'night' ? 'night' : g.world?.timeOfDay === 'sunset' ? 'sunset' : 'afternoon';
    const playing = g.state === 'playing' && !g.mapLoading;
    // --- Veículo atual (carro dirigido ou barco com rádio).
    // Motos não têm rádio (PROMPT 15): a roleta não aparece e o scroll fica livre.
    const car = g.vehicles?.state === 'DRIVING' && !g.vehicles.playerVehicle?.spec?.bike ? g.vehicles.playerVehicle : null;
    const boat = !car && g.boats?.aboard && this._boatHasRadio(g.boats.aboard) ? g.boats.aboard : null;
    const veh = playing ? (car || boat) : null;
    if (veh !== this.vehicle) {
      if (this.vehicle && !veh) this.lastVehicle = this.vehicle;
      this.vehicle = veh;
      this.ui.cancel();
      if (veh) {
        this.stats.enters++;
        this.station = this.stationOf(veh);
        this.ui.showStation(this.station, this._nowText(this.station));
      }
    }
    // --- Roleta: scroll só dentro de veículos.
    if (veh && input) {
      if (input.wasPressed('radioNext')) this.ui.scroll(1, this.station);
      if (input.wasPressed('radioPrev')) this.ui.scroll(-1, this.station);
    }
    this.ui.update(dt);
    // --- Fonte de áudio.
    let src = null;
    const A = g.interiors?.active;
    if (veh) src = this.station !== 'off' ? { kind: 'direct', station: this.station } : null;
    else if (playing && A && g.interiors.state !== 'exiting' && A.def.audio?.radio) src = { kind: 'interior', station: A.def.audio.radio };
    else if (playing && !A) {
      const p = g.player.visualPosition || g.player.controller.position;
      const lv = this.lastVehicle;
      if (lv && lv.root.visible && lv.radioStation && lv.radioStation !== 'off' && lv.root.position.distanceTo(p) < 30) src = { kind: 'spatial', station: lv.radioStation, pos: lv.root.position };
      else {
        this._npcT -= dt;
        if (this._npcT <= 0) { this._npcT = 0.5; this._npc = this._nearestNpc(p); }
        const n = this._npc;
        if (n && n.root.visible && n.root.position.distanceTo(p) < 12) { const s = this.stationOf(n); if (s !== 'off') src = { kind: 'spatial', station: s, pos: n.root.position, npc: n.id }; }
      }
    }
    if (src?.npc && this.source?.npc !== src.npc) this.stats.npcHeard++;
    this.source = src;
    // --- Sirene próxima: abaixa um pouco o rádio (os efeitos continuam audíveis).
    let duck = 1;
    const units = g.city?.police?.units;
    if (units?.length && this.vehicle) {
      const p = this.vehicle.root?.position || this.vehicle.group?.position;
      for (const u of units) if (p && u.v?.root && u.v.root.position.distanceTo(p) < 40) { duck = 0.7; break; }
    }
    if (!g.audio?.ctx || !g.audio.started) return;
    this.playback.setDuck(duck);
    if (src) this.playback.setListener(g.camera);
    this._sync();
  }

  _nearestNpc(p) {
    let best = null, bd = 12;
    for (const v of this.game.vehicles?.list || []) {
      if (v.driver !== 'ai' || !v.root.visible || v.spec?.bike) continue;
      const d = v.root.position.distanceTo(p);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  _sync() {
    const src = this.source;
    if (!src || !this.game.audio?.ctx) { this.playback.stop(); return; }
    const seg = this.sched.current(src.station);
    const next = this.sched.upcoming(src.station);
    this.playback.setOutput(src.kind, src.pos);
    this.playback.sync(src.station, seg, next, () => this.sched.now());
    if (this.vehicle) this.ui.setNowPlaying(this._nowText(src.station));
  }

  // ---------------------------------------------------------------- persistência
  serialize() {
    return { v: 1, station: this.station, schedule: this.sched.serialize() };
  }

  deserialize(data) {
    if (!data) return false;
    if (DIAL.includes(data.station)) this.station = data.station;
    this.sched.deserialize(data.schedule);
    this.lastVehicle = null;
    return true;
  }

  debug() {
    const now = this.sched.now();
    return {
      now: +now.toFixed(2), station: this.station, source: this.source && { kind: this.source.kind, station: this.source.station },
      stations: STATIONS.map((s) => { const seg = this.sched.current(s.id); return { id: s.id, k: seg.k, item: seg.title || seg.id, at: +(now - seg.start).toFixed(1), of: seg.dur }; }),
      playback: this.playback.debug(), news: { ...this.news.stats, reports: this.news.reports.slice(-5) }, ui: this.ui.stats, stats: this.stats,
    };
  }
}
