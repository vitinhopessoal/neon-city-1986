/**
 * Configuração central do jogo.
 * Todos os parâmetros ajustáveis (sensibilidade, velocidades, câmera, gráficos)
 * ficam aqui para facilitar o balanceamento nas próximas etapas.
 */
export const CONFIG = {
  /** Único cenário jogável; os recursos permanecem locais e fora do build. */
  map: {
    id: 'vice-city',
    label: 'VICE CITY',
    type: 'triangles',
    manifestUrl: '/dev-maps/vice-city/manifest.json',
  },

  input: {
    /** Radianos por pixel de movimento do mouse. */
    mouseSensitivity: 0.0022,
    invertY: false,
  },

  player: {
    radius: 0.34,
    height: 1.8,
    eyeHeight: 1.64,
    walkSpeed: 3.3,
    runSpeed: 7.4,
    wadeSpeedMultiplier: 0.5,
    groundAcceleration: 22,
    groundDeceleration: 16,
    airAcceleration: 5,
    turnSpeed: 11,
    jumpSpeed: 6.6,
    gravity: 21,
    maxFallSpeed: 40,
    stepHeight: 0.36,
    coyoteTime: 0.12,
    jumpBufferTime: 0.14,
    // Natação (PROMPT 11): profundidade que tira o pé do chão, flutuação e velocidades.
    swimDepth: 1.3,
    swimFloat: 1.22,
    swimSpeed: 2.0,
    swimFastSpeed: 3.1,
    swimAcceleration: 5,
    climbReach: 2.4,
  },

  /**
   * Protagonista 3D importado (gerado por tools/protagonist/build-protagonist.mjs).
   * model: 'glb' usa o protagonista importado pelo usuário (padrão).
   * Se o GLB falhar ao carregar, o jogo volta sozinho para o original.
   * Teste: ?player=original | ?player=glb na URL, ou F9 (somente em desenvolvimento).
   */
  protagonist: {
    model: 'glb',
    url: `${import.meta.env.BASE_URL}models/protagonist/protagonist.glb`,
    devToggle: import.meta.env.DEV,
  },

  /**
   * Arsenal (src/weapons). grantAll: protótipo com todas as armas no
   * inventário; targetRange: área de tiro de testes (somente em desenvolvimento).
   */
  /**
   * Simulação urbana (src/traffic, src/pedestrians, src/city).
   * density: 'off' | 'low' | 'medium' | 'high' (ou ?density= na URL).
   */
  city: {
    density: 'medium',
    profiles: {
      low: { vehicles: 5, peds: 10 },
      medium: { vehicles: 9, peds: 18 },
      high: { vehicles: 14, peds: 28 },
    },
    // Faixa de distância (m) do jogador para surgir/reciclar agentes.
    range: { min: 70, max: 175 },
    importedRange: { min: 45, max: 115 },
    // Até esta distância os carros da IA usam a física completa.
    physicsNear: 55,
    // Além desta distância da câmera, carros do trânsito usam o impostor (1 malha).
    impostorDistance: 48,
    parkChance: 0.12,
    // Densidade por região (ruas e áreas de pedestres).
    roadWeights: { ocean_ave: 1.0, flamingo_e: 0.55, flamingo_w: 0.45, coral_st: 0.4 },
    pedRegionWeights: { promenade: 1.0, beach: 0.75, ocean_ave: 0.85, flamingo_e: 0.95, flamingo_w: 0.6, coral_st: 0.4, extra: 0.6 },
    // Navegação do cenário importado vem do próprio manifesto.
    pedestrianPaths: {},
  },

  weapons: {
    grantAll: true,
    startWith: 'brenten',
    targetRange: false,
    rangeSpots: {},
  },

  /** Propriedades e residências (PROMPT 07). */
  properties: {
    /** Dormir até esta hora (0–23). */
    wakeHour: 7,
    /** Carro inicial do protagonista (id estável do mapa) e vaga onde ele fica numa nova partida. */
    starterVehicle: 'veh_vento_white',
    starterSpot: { x: -75, z: -79, heading: 0 },
  },

  /** Interiores (PROMPT 06). ?interiors=open ignora os horários. */
  interiors: {
    ignoreHours: false,
    /** Constrói o interior quando o jogador chega a esta distância da porta (m). */
    preloadDistance: 45,
    /** Libera interiores não ativos além desta distância (m). */
    unloadDistance: 120,
  },

  camera: {
    fovThirdPerson: 60,
    fovFirstPerson: 72,
    runFovBoost: 5,
    near: 0.08,
    far: 2600,
    transitionDuration: 0.32,
    thirdPerson: {
      distance: 4.3,
      runDistance: 4.9,
      minDistance: 0.7,
      pivotHeight: 1.55,
      shoulderOffset: 0.38,
      // Mira com arma: câmera sobre o ombro, mais perto.
      aimDistance: 1.85,
      aimShoulder: 0.62,
      aimPivotHeight: 1.6,
      collisionRadius: 0.22,
      followSharpnessXZ: 14,
      followSharpnessY: 7,
      pitchMin: -0.85,
      pitchMax: 1.15,
      defaultPitch: 0.18,
    },
    firstPerson: {
      pitchMin: -1.45,
      pitchMax: 1.45,
      forwardOffset: 0.16,
      bobWalk: 0.022,
      bobRun: 0.038,
      swayRun: 0.012,
    },
  },

  /** Presets de qualidade gráfica (selecionáveis na tela inicial ou com a tecla G). */
  graphics: {
    defaultPreset: 'medium',
    adaptiveResolution: true,
    presets: {
      low: {
        label: 'BAIXA',
        maxPixelRatio: 1.0,
        minPixelRatio: 0.65,
        shadows: true,
        shadowMapSize: 1024,
        shadowExtent: 70,
        bloom: false,
        pointLights: false,
        drawDistance: 900,
        // Prompt 02: detalhe de superfície, densidade decorativa e animações.
        surfaceDetail: false,
        decorDensity: 0.4,
        roadDecals: false,
        ambient: false,
        anisotropy: 2,
        oceanDetail: 0,
      },
      medium: {
        label: 'MÉDIA',
        maxPixelRatio: 1.5,
        minPixelRatio: 0.75,
        shadows: true,
        shadowMapSize: 2048,
        shadowExtent: 90,
        bloom: false,
        pointLights: true,
        drawDistance: 1600,
        surfaceDetail: true,
        decorDensity: 0.75,
        roadDecals: true,
        ambient: true,
        anisotropy: 4,
        oceanDetail: 1,
      },
      high: {
        label: 'ALTA',
        maxPixelRatio: 2.0,
        minPixelRatio: 1.0,
        shadows: true,
        shadowMapSize: 4096,
        shadowExtent: 110,
        bloom: true,
        pointLights: true,
        drawDistance: 2400,
        surfaceDetail: true,
        decorDensity: 1,
        roadDecals: true,
        ambient: true,
        anisotropy: 8,
        oceanDetail: 1,
      },
    },
  },

  audio: {
    masterVolume: 0.7,
  },

  debug: {
    /** Exibe FPS e estatísticas (alternar com a tecla ` ). */
    showStats: false,
    /** Expõe o jogo em window.__NEON__ para inspeção/testes no modo dev. */
    exposeGlobal: import.meta.env.DEV,
  },
};
