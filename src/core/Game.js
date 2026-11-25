import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from '../config.js';
import { Time } from './Time.js';
import { InputManager } from './InputManager.js';
import { World } from '../world/World.js';
import { Player } from '../player/Player.js';
import { WeaponManager } from '../weapons/WeaponManager.js';
import { CitySimulation } from '../city/CitySimulation.js';
import { CameraManager } from '../camera/CameraManager.js';
import { HUD } from '../ui/HUD.js';
import { Minimap } from '../ui/Minimap.js';
import { StartScreen } from '../ui/StartScreen.js';
import { AudioManager } from '../audio/AudioManager.js';
import { BODY_LAYER, HEAD_LAYER, ARMS_LAYER } from '../player/CharacterModel.js';
import { MapManager } from '../maps/MapManager.js';
import { TIME_ORDER, TIME_PRESETS } from '../world/Environment.js';
import { VehicleManager } from '../vehicles/VehicleManager.js';
import { InteriorManager } from '../interiors/InteriorManager.js';
import { EconomyManager } from '../economy/EconomyManager.js';
import { InventoryManager } from '../inventory/InventoryManager.js';
import { PropertyManager } from '../properties/PropertyManager.js';
import { SaveManager } from '../save/SaveManager.js';
import { GameMenu } from '../ui/GameMenu.js';
import { VehicleCustomizationManager } from '../vehicles/customization/VehicleCustomizationManager.js';
import { WaterManager } from '../water/WaterManager.js';
import { BoatManager } from '../boats/BoatManager.js';
import { RadioManager } from '../audio/radio/RadioManager.js';

const QUALITY_KEY = 'neoncity.quality';

function loadQuality() {
  try {
    const url = new URLSearchParams(location.search).get('quality');
    if (url && CONFIG.graphics.presets[url]) return url;
    const saved = localStorage.getItem(QUALITY_KEY);
    if (saved && CONFIG.graphics.presets[saved]) return saved;
  } catch { /* armazenamento indisponível */ }
  return CONFIG.graphics.defaultPreset;
}

function saveQuality(key) {
  try { localStorage.setItem(QUALITY_KEY, key); } catch { /* ignorado */ }
}

/**
 * Orquestra renderer, mundo, jogador, câmeras, HUD, áudio e o loop principal.
 */
export class Game {
  constructor({ canvas, uiRoot }) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.qualityKey = loadQuality();
    this.quality = { ...CONFIG.graphics.presets[this.qualityKey] };
    this.state = 'loading'; // loading -> title -> intro -> playing
    this.time = new Time();
    this._rafId = 0;
    this._mouse = { x: 0, y: 0 };
    this._focus = new THREE.Vector3();
    this._perf = { lowTime: 0, highTime: 0 };
    this._audioInfo = { shoreDistance: 0, inWater: false, cameraRight: 0 };
    this._hintCooldown = 0;
  }

  async init() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Estatísticas acumuladas por quadro (inclui sombras e passes de pós-processamento).
    renderer.info.autoReset = false;
    this.renderer = renderer;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fovThirdPerson, window.innerWidth / window.innerHeight, CONFIG.camera.near, this.quality.drawDistance + 400);
    this.camera.layers.enable(HEAD_LAYER);
    this.camera.layers.enable(BODY_LAYER);
    this.camera.layers.enable(ARMS_LAYER);

    this.input = new InputManager(this.canvas);
    this.hud = new HUD(this.uiRoot);
    this.minimap = new Minimap(this.hud.el);
    this.audio = new AudioManager(CONFIG.audio.masterVolume);
    this.startScreen = new StartScreen(this.uiRoot, {
      presets: CONFIG.graphics.presets,
      current: this.qualityKey,
      onStart: () => this.newGame(),
      onContinue: () => this.continueGame(),
      onLoadSlot: (slot) => this.loadFromTitle(slot),
      listSlots: () => this.save.list(),
      onQuality: (k) => this.setQuality(k),
    });

    // Yield for the loading screen without depending on foreground-only rAF.
    await new Promise((r) => setTimeout(r, 0));

    // Ambiente compartilhado (céu, sol, névoa). O cenário vem do mapa ativo.
    this.world = new World({ scene: this.scene, renderer, quality: this.quality });
    // Objeto quebrado (cidade procedural ou mapa ativo): som, evento urbano e crime.
    this._onPropBreak = record => {
      const p = record.position;
      this.city?.events.emit('propBreak', { x: p.x, y: p.y, z: p.z, id: record.id, material: record.profile.material });
      if (record.breakSource === 'player') this.city?.events.emit('crime', { source: 'player', severity: 1, x: p.x, y: p.y, z: p.z });
      const distance = this.camera.position.distanceTo(p);
      this.weapons?.audio.impact(record.profile.material, distance);
    };
    this.world.destruction.onBreak = this._onPropBreak;
    this.world.build();
    // NEON MOTOR COMPANY (PROMPT 12): os nove GLBs carregam em paralelo com o restante da inicialização.
    this._neonLoad = this.world.vehicleFactory.preloadNeon();
    // NEON MOTORCYCLES (PROMPT 15): seis GLBs de motos, também em paralelo.
    this._motoLoad = this.world.vehicleFactory.preloadMotos();
    // Horário inicial: ?time=morning|sunset|night (padrão: pôr do sol).
    const t = new URLSearchParams(location.search).get('time');
    if (t && t !== 'sunset' && TIME_PRESETS[t]) this.world.setTimeOfDay(t);

    this.player = new Player({ scene: this.scene, world: this.world, config: CONFIG.player });
    this._loadProtagonist();
    this.cameras = new CameraManager(this.camera, this.world.collision, CONFIG.camera, CONFIG.input.mouseSensitivity);
    this.cameras.invertY = CONFIG.input.invertY;
    this.cameras.attachPlayer(this.player, CONFIG.player.eyeHeight);
    this.cameras.onModeChange = () => this.hud.setCameraMode(this.cameras.modeLabel);
    // Sistema automotivo (módulo independente; recebe os veículos do mapa ativo).
    this.vehicles = new VehicleManager(this);
    this.hud.setCameraMode(this.cameras.modeLabel);
    // Arsenal (módulo independente; só atua a pé).
    this.weapons = new WeaponManager(this);
    // Simulação urbana: trânsito, pedestres e eventos.
    this.city = new CitySimulation(this);
    this.minimap.police = this.city.police;
    // Economia central e inventário (PROMPT 07): o saldo continua em PlayerStatus, alterado só pela economia.
    this.economy = new EconomyManager(this.player.status);
    this.inventory = new InventoryManager(this);
    // Interiores exploráveis (portas, NPCs, comércio, áudio e iluminação próprios).
    this.interiors = new InteriorManager(this);
    // Propriedades, garagens e salvamento (usam o sistema de interiores existente).
    this.properties = new PropertyManager(this);
    this.save = new SaveManager(this);
    // NEON CUSTOMS (PROMPT 10): personalização visual e mecânica dos veículos.
    this.customs = new VehicleCustomizationManager(this);
    // OCEAN DRIVE (PROMPT 11): mar navegável, ilhas, marinas, barcos e natação.
    this.water = new WaterManager(this);
    this.boats = new BoatManager(this, this.water);
    // NEON RADIO NETWORK (PROMPT 14): rádio nos veículos, barcos, lojas e casas; notícias por eventos.
    this.radio = new RadioManager(this);
    this.radio.attachEvents(this.city?.events);
    this.playTime = 0;
    this.menuOpen = false;
    this.qualityPresets = CONFIG.graphics.presets;
    this.gameMenu = new GameMenu(this, this.uiRoot);
    this.minimap.markers = () => [...this.properties.markers(), ...(this.boats?.markers() || [])];
    this.player.status.setTimePreset(this.world.timeOfDay);

    // Vice City completo é o único mapa, inclusive ao abrir URLs antigas.
    this.maps = new MapManager(this, this.uiRoot);
    this.maps.register(CONFIG.map);

    this.player.events.footstep = (surface, run, foot, wading) => this.audio.footstep(surface, run, wading);
    this.player.events.land = (impact, surface) => {
      this.audio.land(impact, surface);
      if (this.state === 'playing' && impact > 10) this.player.status.damage((impact - 10) * 4);
    };
    this.player.events.jump = () => this.audio.jump();

    this.input.onPointerLockChange((locked) => this.hud.setPointerLocked(locked, this.state === 'playing'));
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.pointerLocked) this.input.requestPointerLock();
      this.audio.start();
    });
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.time.reset(); });

    this._setupComposer();
    this.time.reset();
    this._loop = this._loop.bind(this);
    this._rafId = requestAnimationFrame(this._loop);

    // Modelos dos veículos prontos antes do posicionamento seguro no Vice City.
    await this._neonLoad;
    const neonLib = this.world.vehicleFactory.neon;
    if (neonLib.errors.length) console.warn('[NEON MOTOR]', neonLib.errors);
    await this._motoLoad;
    const motoLib = this.world.vehicleFactory.moto;
    if (motoLib.errors.length) console.warn('[NEON MOTORCYCLES]', motoLib.errors);
    this.loadStats = { ...(this.loadStats || {}), motoMs: motoLib.loadMs, motoModels: motoLib.templates.size };
    this.loadStats = { ...(this.loadStats || {}), neonMotorMs: neonLib.loadMs, neonMotorModels: neonLib.templates.size };
    if (!await this.maps.activate(CONFIG.map.id)) {
      this.startScreen.showMessage('Vice City não carregou. Confira os arquivos locais em dev-maps/vice-city/ e recarregue a página.');
      throw new Error('Vice City indisponível. Confira dev-maps/vice-city/manifest.json e execute npm run dev.');
    }
    // Finaliza a carga do personagem antes de liberar a tela inicial.
    await this.protagonistLoad;
    // Compila shaders antes do primeiro quadro jogável para evitar travadas.
    this.renderer.compile(this.scene, this.camera);

    this.state = 'title';
    // Tempo até a tela inicial ficar pronta (desde o início da navegação), para diagnóstico.
    this.loadStats = { ...(this.loadStats || {}), titleReadyMs: Math.round(performance.now()), worldBuildMs: Math.round(this.world.stats.buildMs || 0) };
    this.startScreen.setReady();
    this.save.latest().then((l) => this.startScreen.setSaveInfo(l)).catch(() => this.startScreen.setSaveInfo(null));

    // import.meta.env.DEV literal permite ao bundler remover este bloco (e o harness) do build.
    if (import.meta.env.DEV && CONFIG.debug.exposeGlobal) {
      window.__NEON__ = this;
      import('../dev/TestHarness.js').then(({ createTestHarness }) => { window.__NEON_TEST__ = createTestHarness(this); });
    }
  }

  _setupComposer() {
    if (this.composer) {
      for (const pass of this.composer.passes) pass.dispose?.();
      this.composer.dispose();
      this.composer = null;
      this.bloomPass = null;
    }
    if (!this.quality.bloom) return;
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const strength = this.world?.environment?.preset?.bloom ?? 0.55;
    const threshold = this.world?.environment?.preset?.bloomThreshold ?? 0.92;
    this.bloomPass = new UnrealBloomPass(size.clone().multiplyScalar(0.5), strength, 0.45, threshold);
    composer.addPass(this.bloomPass);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  /**
   * Chamado pelo MapManager quando um mapa fica ativo: troca colisões e
   * regras do ambiente, reposiciona o jogador no spawn seguro e atualiza o HUD.
   * Personagem, animações, controles, câmeras e HUD são preservados.
   */
  onMapActivated(env, def) {
    this.vehicles?.onMapActivated(env);
    this.city?.onMapActivated(env);
    this.interiors?.onMapActivated(env);
    this.properties?.onMapActivated(env);
    this.customs?.onMapActivated(env);
    this.water?.onMapActivated(env);
    this.boats?.onMapActivated(env);
    this.mapEnv = env;
    if (env.destruction && env.destruction !== this.world.destruction) env.destruction.onBreak = this._onPropBreak;
    this.player.setEnvironment(env);
    this.cameras.setCollision(env.collision);
    const sp = env.spawnPoint;
    this.player.spawn(sp);
    this.cameras.yaw = sp.yaw;
    this.cameras.pitch = CONFIG.camera.thirdPerson.defaultPitch;
    if (this.cameras.cinematic.active) {
      this.cameras.setCinematic(new THREE.Vector3(sp.x, sp.y, sp.z - 28), 85, 75);
    }
    this.hud.setDistrict(env.label);
    this._districtId = null;
    this.minimap.setEnvironment(env);
    if (this.state === 'playing') {
      this.hud.location(env.label, 'NEON CITY · 1986', 3.5);
    }
  }

  /**
   * Nova partida (PROMPT 07): saldo inicial, inventário padrão, apartamento
   * inicial. O jogador começa no spawn seguro do Vice City.
   */
  newGame() {
    if (this.state !== 'title' || this.mapLoading) return;
    this.economy.newGame();
    this.inventory.newGame();
    this.interiors?.save?.reset();
    this.properties.newGame();
    this.boats?.newGame();
    this.radio?.newGame();
    this.save.newGameId();
    this.playTime = 0;
    this.player.status.setHealth(100);
    this.player.status.setWanted(0);
    this.start(() => {
      this.save.autosave('Nova partida');
    });
  }

  /** Continuar: último salvamento válido (autosave ou manual). */
  async continueGame() {
    const latest = await this.save.latest();
    if (!latest) { this.startScreen.setSaveInfo(null); return; }
    await this.loadFromTitle(latest.slot);
  }

  async loadFromTitle(slot) {
    if (this.state !== 'title') return { ok: false };
    this.startScreen.setBusy(true);
    const r = await this.save.load(slot);
    this.startScreen.setBusy(false);
    if (!r.ok) { this.startScreen.showMessage(r.msg); return r; }
    this.start(() => { if (r.warnings?.length) this.hud.toast(r.warnings[0], 4); });
    return r;
  }

  /** Carregar durante o jogo (menu P). */
  async loadGame(slot) {
    const r = await this.save.load(slot);
    return r;
  }

  /** Inicia o jogo a partir da tela de título (gesto do usuário). */
  start(onPlaying = null) {
    if (this.state !== 'title' || this.mapLoading) return;
    this.audio.start();
    this.input.requestPointerLock();
    this.startScreen.hide();
    this.state = 'intro';
    this.cameras.beginIntro(1.7, () => {
      this.state = 'playing';
      this.input.enabled = true;
      this.hud.setPointerLocked(this.input.pointerLocked, true);
      onPlaying?.();
    });
    this.hud.show();
    this.hud.location(this.mapEnv?.label || CONFIG.map.label, 'NEON CITY · 1986', 4.5);
  }

  setQuality(key) {
    if (!CONFIG.graphics.presets[key]) return;
    this.qualityKey = key;
    Object.assign(this.quality, CONFIG.graphics.presets[key]);
    saveQuality(key);
    if (!this.renderer) return;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    if (this.world) {
      this.world.environment.setShadowQuality(this.quality);
      this.world.environment.setDrawDistance(this.quality.drawDistance);
      this.world.applyQuality(this.quality);
      this.world.environment.skyUniforms.uCloudOctaves.value = key === 'low' ? 3 : 5;
    }
    this.camera.far = this.quality.drawDistance + 400;
    this.camera.updateProjectionMatrix();
    this._setupComposer();
    this.resize();
  }

  /** Alterna manhã -> pôr do sol -> noite (teste visual; sem ciclo contínuo). */
  cycleTime() {
    const cur = this.world.timeOfDay;
    const next = TIME_ORDER[(TIME_ORDER.indexOf(cur) + 1) % TIME_ORDER.length];
    this.setTimeOfDay(next);
    this.hud.toast(`Horário: ${TIME_PRESETS[next].label}`);
  }

  setTimeOfDay(name) {
    if (!this.world.setTimeOfDay(name)) return;
    this.player?.status.setTimePreset(name);
    if (this.bloomPass) {
      this.bloomPass.strength = this.world.environment.preset.bloom;
      this.bloomPass.threshold = this.world.environment.preset.bloomThreshold ?? 0.92;
    }
  }

  cycleQuality() {
    const keys = Object.keys(CONFIG.graphics.presets);
    const next = keys[(keys.indexOf(this.qualityKey) + 1) % keys.length];
    this.setQuality(next);
    this.hud.toast(`Qualidade gráfica: ${this.quality.label}`);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
    }
  }

  /** Resolução adaptável: reduz o pixel ratio se o FPS cair por alguns segundos. */
  _adaptResolution(dt) {
    if (!CONFIG.graphics.adaptiveResolution || this.state !== 'playing') return;
    const fps = this.time.fps;
    const p = this._perf;
    // FPS implausivelmente baixo = aba em segundo plano/limitada pelo navegador: ignora.
    if (fps < 12 || document.hidden) { p.lowTime = 0; p.highTime = 0; return; }
    const maxPR = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
    const minPR = Math.min(this.quality.minPixelRatio, maxPR);
    if (fps < 42) { p.lowTime += dt; p.highTime = 0; } else if (fps > 57) { p.highTime += dt; p.lowTime = 0; } else { p.lowTime = 0; p.highTime = 0; }
    if (p.lowTime > 3 && this.pixelRatio > minPR + 0.01) {
      this.pixelRatio = Math.max(minPR, this.pixelRatio - 0.15);
      p.lowTime = 0;
      this.resize();
    } else if (p.highTime > 8 && this.pixelRatio < maxPR - 0.01) {
      this.pixelRatio = Math.min(maxPR, this.pixelRatio + 0.1);
      p.highTime = 0;
      this.resize();
    }
  }

  /** Protagonista importado (GLB) com fallback automático para o original. */
  _loadProtagonist() {
    const P = CONFIG.protagonist;
    const q = new URLSearchParams(location.search).get('player');
    const mode = q === 'original' || q === 'glb' ? q : P.model;
    this.protagonistLoad = mode === 'glb'
      ? this.player.loadProtagonistModel(P.url).then((ok) => {
        this.loadStats = { ...(this.loadStats || {}), protagonistMs: this.player.visual?.loadMs ?? null, protagonist: this.player.modelStatus };
        return ok;
      })
      : Promise.resolve(false);
  }

  _handleGlobalKeys() {
    const i = this.input;
    if (i.wasPressed('toggleCityDebug') && import.meta.env.DEV && this.city) {
      this.city.toggleDebug().then((on) => this.hud.toast(on ? 'Depuração da cidade: ligada (F10)' : 'Depuração da cidade: desligada'));
    }
    if (i.wasPressed('togglePlayerModel') && CONFIG.protagonist.devToggle) {
      if (this.player.visual) {
        const m = this.player.setModelMode(this.player.modelMode === 'glb' ? 'original' : 'glb');
        this.hud.toast(m === 'glb' ? 'Protagonista: modelo 3D importado' : 'Protagonista: personagem original');
      } else {
        this.hud.toast(`Modelo 3D indisponível (${this.player.modelStatus})`);
      }
    }
    if (i.wasPressed('gameMenu') && ['playing', 'title'].includes(this.state) && !this.interiors?.ui.open) this.gameMenu.toggle('settings');
    if (i.wasPressed('inventory') && this.state === 'playing' && !this.interiors?.ui.open) this.gameMenu.toggle('inv');
    if (i.wasPressed('toggleCamera') && this.state === 'playing') this.cameras.toggle();
    if (i.wasPressed('toggleHelp') && this.state === 'playing') this.gameMenu.show('manuals');
    if (i.wasPressed('toggleNavigation') && this.state === 'playing') this.minimap.toggle();
    if (i.wasPressed('toggleStats') && this.state === 'playing') this.gameMenu.show('stats');
    if (i.wasPressed('cycleQuality')) this.cycleQuality();
    if (i.wasPressed('cycleTime') && this.state !== 'loading') this.cycleTime();
    if (i.wasPressed('toggleMute')) this.hud.toast(this.audio.toggleMute() ? 'Som desativado' : 'Som ativado');
  }

  _loop(now) {
    if (this._loopPaused) return;
    this._rafId = requestAnimationFrame(this._loop);
    const dt = this.time.update(now);
    this.step(dt);
  }

  /** Um quadro completo de simulação + render (também usado em testes automatizados). */
  step(dt) {
    const elapsed = this.time.elapsed;

    // 1) Entrada
    this.input.consumeMouseDelta(this._mouse);
    // A tela de pausa é opaca: mantém o último quadro e suspende a simulação.
    if (this.menuOpen) {
      this.input.endFrame();
      return;
    }
    if (this.state === 'playing') {
      // Roleta de armas aberta: o mouse aponta a fatia em vez de girar a câmera.
      if (this.weapons?.wheel?.open) this.weapons.wheel.pointer(this._mouse.x, this._mouse.y);
      else this.cameras.applyLook(this._mouse.x, this._mouse.y);
      this.playTime += dt;
    }
    this._handleGlobalKeys();
    if (this.menuOpen) { this.input.endFrame(); return; }

    // 2) Jogador (física + animação) — controle suspenso durante troca de mapa.
    // Veículos: estados de entrada/saída antes do personagem (bloqueiam o controle a pé).
    // Interiores antes dos veículos: decidem a prioridade da tecla E (porta de prédio × porta de carro).
    this.interiors?.preUpdate(dt, this.input);
    this.customs?.preUpdate(dt, this.input);
    this.boats?.preUpdate(dt, this.input);
    this.vehicles.preUpdate(dt, this.input);
    this.weapons?.preUpdate(dt, this.input);
    this.player.update(dt, this.input, this.cameras.yaw, this.state === 'playing' && !this.mapLoading && this.vehicles.interaction.onFoot);
    this.city?.update(dt);
    this.vehicles.update(dt, this.input);
    this.city?.postUpdate(dt);

    // 3) Mundo e câmera
    this._focus.copy(this.player.visualPosition);
    this.world.update(dt, elapsed, this._focus, this.camera);
    this.mapEnv?.updateVisibility?.(this.player.visualPosition, dt);
    // Destroços e objetos quebrados do mapa ativo (voltam ao lugar longe do jogador).
    const mapDestruction = this.mapEnv?.destruction;
    if (mapDestruction && mapDestruction !== this.world.destruction) mapDestruction.update(dt, this.player.visualPosition);
    // Água e barcos depois do oceano: a física usa o mesmo uTime do quadro desenhado.
    this.water?.update(dt, this.camera);
    this.boats?.update(dt);
    this.radio?.update(dt, this.input);
    this.cameras.update(dt);
    this.customs?.cameraTick(dt);
    this.boats?.cameraTick(dt);
    this.weapons?.update(dt, this.input);
    this.interiors?.update(dt);
    this.properties?.update(dt);

    // 4) Áudio e HUD
    const c = this.player.controller;
    if (this.state === 'playing' && !this.mapLoading) this.player.status.update(dt);
    this.hud.status.update(this.player.status, this.weapons?.def, this.weapons?.drawn && !this.player.inVehicleMode);
    if (this.state === 'playing' || this.state === 'intro') {
      const district = this.mapEnv?.getDistrictAt?.(c.position.x, c.position.z);
      const districtId = district?.id || this.maps.activeId;
      if (districtId !== this._districtId) {
        const previous = this._districtId;
        this._districtId = districtId;
        this.hud.setDistrict(district?.name || this.mapEnv.label);
        if (previous && district && this.state === 'playing') this.hud.location(district.name, 'NEON CITY / 1986', 3.5);
      }
      this.minimap.update(dt, c.position, this.player.model.root.rotation.y, this.player.status);
    }
    const ai = this._audioInfo;
    ai.shoreDistance = (this.mapEnv || this.world).distanceToShore(c.position.x, c.position.z);
    ai.inWater = c.wading;
    ai.cameraRight = Math.cos(this.cameras.yaw);
    this.audio.update(dt, ai);
    if (this.state === 'playing' && c.boundaryHint) {
      if (!this._hintCooldown || this._hintCooldown <= 0) {
        this.hud.toast(c.boundaryHint === 'water' ? (this.mapEnv?.seaOpen ? 'Limite da baía — mar aberto proibido além das boias' : 'Águas profundas — volte para a areia') : `Área bloqueada — ${this.mapEnv?.label || 'o bairro'} termina aqui`);
        this._hintCooldown = 3;
      }
    }
    if (this._hintCooldown > 0) this._hintCooldown -= dt;

    // 5) Render
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.hud.update(dt);
    this._adaptResolution(dt);
    this.input.endFrame();
  }

  dispose() {
    cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();
    this.minimap.dispose();
    this.audio.dispose();
    this.composer?.dispose();
    this.world.lib.dispose();
    this.world.destruction.dispose();
    this.city?.occupants.dispose();
    this.city?.police.dispose();
    this.renderer.dispose();
  }
}
