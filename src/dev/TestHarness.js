/**
 * Utilitário de testes (apenas no modo dev, exposto em window.__NEON_TEST__).
 * Permite simular entrada real (eventos de teclado no InputManager) e avançar
 * a simulação em passos fixos, independentemente da taxa de quadros do
 * navegador — útil para testes automatizados de movimento, colisão e câmera.
 */
export function createTestHarness(game) {
  const T = {
    game,
    down: (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })),
    up: (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })),
    /** Avança a simulação por `sec` segundos em passos de `dt`. */
    sim(sec, dt = 1 / 60) {
      const n = Math.round(sec / dt);
      for (let i = 0; i < n; i++) {
        game.time.elapsed += dt;
        game.time.fps = 60;
        game.step(dt);
      }
    },
    tap(code) {
      T.down(code);
      T.sim(1 / 60);
      T.up(code);
    },
    /** Teleporta o jogador para (x, z) no nível do chão, com a câmera olhando para camYaw. */
    place(x, z, camYaw = 0) {
      const c = game.player.controller;
      const col = game.player.controller.collision;
      const base = game.mapEnv?.heightField ? game.mapEnv.heightField.sample(x, z) : 0;
      const y = col.getGroundHeight(x, z, base + 0.2, 0.2);
      c.teleport(x, y, z, camYaw + Math.PI);
      game.player.visualPosition.copy(c.position);
      game.cameras.yaw = camYaw;
      game.cameras.third.initialized = false;
      T.sim(0.4);
    },
    pos: () => game.player.position.toArray().map((v) => +v.toFixed(2)),
    /** Colisores sólidos que bloqueiam câmera e contêm o ponto. */
    insideSolids(p) {
      const col = game.player.controller.collision;
      return [...col.colliders.values()]
        .filter((k) => k.cameraBlocker && k.solid && p.y > k.minY && p.y < k.maxY && col._containsPoint(k, p.x, p.z, 0))
        .map((k) => k.id);
    },
    /**
     * Enquadramentos fixos para capturas comparativas (antes/depois).
     * Posiciona a câmera independentemente do jogador e renderiza um quadro.
     */
    spots: {
      avenida: [[30, 6, 75], [18, 9, -40]],
      hoteis: [[44, 3.2, -62], [4, 11, -112]],
      comercial: [[-4, 3.2, 3], [-55, 4.5, -3]],
      residencial: [[-74, 5, 34], [-112, 3, 64]],
      orla: [[80, 3.2, -78], [58, 2.5, 20]],
      horizonte: [[66, 3, 0], [400, 0, -80]],
      carro: [[31.8, 1.7, 47.5], [36.75, 0.7, 42]],
      noite_avenida: [[24, 4, 20], [16, 6, -60]],
      parque: [[-80, 4, 120], [-115, 1, 98]],
      // TEST CITY (relativos ao spawn em 0, 0, 15).
      tc_rua: [[0, 2, 15], [0, 2, -25]],
      tc_alto: [[30, 32, 50], [0, 0, 0]],
    },
    photo(name, extra = {}) {
      const [p, t] = typeof name === 'string' ? T.spots[name] : name;
      T.pauseLoop();
      document.querySelector('.start-screen')?.style.setProperty('display', 'none');
      const hud = document.querySelector('.hud');
      if (hud) hud.style.display = extra.hud ? '' : 'none';
      const cam = game.camera;
      cam.position.set(p[0], p[1], p[2]);
      cam.lookAt(t[0], t[1], t[2]);
      cam.fov = extra.fov ?? 60;
      cam.updateProjectionMatrix();
      cam.layers.enableAll();
      game.world.updateLOD?.(cam.position, true);
      const draw = () => {
        game.world.environment.update(0, game.time.elapsed, game.player.visualPosition.clone().set(p[0], 0, p[2]), cam);
        game.renderer.info.reset();
        if (game.composer) game.composer.render(0); else game.renderer.render(game.scene, cam);
        return { calls: game.renderer.info.render.calls, ktris: Math.round(game.renderer.info.render.triangles / 1000) };
      };
      // Renderiza dentro de requestAnimationFrame para o navegador compor o quadro (capturas confiáveis).
      return new Promise((resolve) => requestAnimationFrame(() => { draw(); requestAnimationFrame(() => resolve(draw())); }));
    },
    /**
     * Benchmark reprodutível de renderização: mesmas câmeras, `frames` quadros
     * por ponto, tempo medido com gl.finish() (inclui sombras e pós-processamento).
     * Retorna percentis do tempo de quadro, FPS equivalente, draw calls e triângulos.
     */
    async benchmark({ spots = ['avenida', 'hoteis', 'comercial', 'residencial', 'orla', 'horizonte', 'carro'], frames = 24, warmup = 3 } = {}) {
      const gl = game.renderer.getContext();
      const out = {};
      const all = [];
      for (const name of spots) {
        await T.photo(name);
        const render = () => { game.renderer.info.reset(); if (game.composer) game.composer.render(0); else game.renderer.render(game.scene, game.camera); };
        for (let i = 0; i < warmup; i++) render();
        const times = [];
        for (let i = 0; i < frames; i++) {
          gl.finish();
          const a = performance.now();
          render();
          gl.finish();
          times.push(performance.now() - a);
        }
        times.sort((x, y) => x - y);
        all.push(...times);
        const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
        const info = game.renderer.info.render;
        out[name] = { p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), min: +times[0].toFixed(1), fps50: +(1000 / q(0.5)).toFixed(1), calls: info.calls, ktris: Math.round(info.triangles / 1000) };
      }
      all.sort((x, y) => x - y);
      const q = (p) => all[Math.min(all.length - 1, Math.floor(p * all.length))];
      out._total = { frames: all.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), fpsMedian: +(1000 / q(0.5)).toFixed(1), fpsLow1: +(1000 / q(0.99)).toFixed(1) };
      const mem = game.renderer.info.memory;
      out._memory = { geometries: mem.geometries, textures: mem.textures, programs: game.renderer.info.programs.length, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null };
      return out;
    },
    /** Simulação sem renderizar cada passo (testes longos não estouram o tempo). */
    fastSim(sec, dt = 1 / 60) {
      const o = game.renderer.render;
      game.renderer.render = function () {};
      try { T.sim(sec, dt); } finally { game.renderer.render = o; }
    },
    fastPlace(x, z, yaw = 0) {
      const o = game.renderer.render;
      game.renderer.render = function () {};
      try { T.place(x, z, yaw); } finally { game.renderer.render = o; }
    },
    fastTap(code) {
      T.down(code);
      T.fastSim(1 / 60);
      T.up(code);
    },
    /** Renderiza um quadro real da câmera do jogo (para capturas). */
    frame() {
      document.querySelector('.start-screen')?.style.setProperty('display', 'none');
      return new Promise((r) => requestAnimationFrame(() => { T.sim(1 / 60); requestAnimationFrame(() => { T.sim(1 / 60); r(); }); }));
    },
    vehicle: (id) => game.vehicles.list.find((v) => v.id === id),
    /** Coloca o jogador junto à porta do motorista e entra (E) até assumir o volante. */
    enterVehicle(id) {
      const v = T.vehicle(id);
      v.root.updateMatrixWorld();
      const e = v.getEntryPoints().find((p) => p.id === 'driver');
      T.fastPlace(e.position.x + (e.position.x - v.root.position.x) * 0.15, e.position.z + (e.position.z - v.root.position.z) * 0.15, 0);
      T.fastSim(0.7);
      T.fastTap('KeyE');
      for (let i = 0; i < 300 && game.vehicles.state !== 'DRIVING'; i++) T.fastSim(1 / 60);
      return game.vehicles.state;
    },
    /** Mantém teclas pressionadas por `sec` segundos (simulação rápida). */
    hold(codes, sec) {
      for (const c of codes) T.down(c);
      T.fastSim(sec);
      for (const c of codes) T.up(c);
    },
    /** Pausa o loop do navegador (para capturas determinísticas). */
    pauseLoop() {
      cancelAnimationFrame(game._rafId);
      game._loopPaused = true;
    },
    resumeLoop() {
      if (!game._loopPaused) return;
      game._loopPaused = false;
      game.time.reset();
      game._rafId = requestAnimationFrame(game._loop);
    },
    // ------------------------------------------------ interiores (PROMPT 06)
    /** Vai até a porta do estabelecimento e entra com E (fluxo real de entrada). */
    enterInterior(id) {
      const I = game.interiors;
      if (I.active) { I._forceOutside(); T.fastSim(0.2); }
      const e = I.exteriors.find((x) => x.def.id === id);
      T.fastPlace(e.poi.x + e.normal.x * 1.2, e.poi.z + e.normal.z * 1.2, e.bld.rotY);
      T.fastSim(0.2);
      T.fastTap('KeyE');
      T.fastSim(1.2);
      return { state: I.state, active: I.active?.def.id };
    },
    /** Posiciona o jogador em coordenadas locais do interior ativo (lyaw local). */
    interiorAt(lx, lz, ly = 0, lyaw = Math.PI) {
      const I = game.interiors, A = I.active;
      const p = A.L(lx, ly + 0.3, lz);
      I._place(p, lyaw + A.ext.bld.rotY);
      game.player.releaseExternalPose(p.clone(), lyaw + A.ext.bld.rotY);
      T.fastSim(0.3);
      return T.pos();
    },
    /**
     * Câmera livre dentro do interior ativo (coordenadas locais) mantendo um
     * laço de renderização curto — necessário para capturas com o loop pausado.
     */
    interiorView(cam, tgt, { hud = false, fov = 62, ms = 1600 } = {}) {
      const I = game.interiors, A = I.active;
      const c = A.L(...cam), t = A.L(...tgt);
      const hudEl = document.querySelector('.hud');
      if (hudEl) hudEl.style.display = hud ? '' : 'none';
      const cm = game.camera;
      let info;
      const draw = () => {
        cm.position.copy(c); cm.lookAt(t); cm.fov = fov; cm.updateProjectionMatrix();
        I._applyLighting(A);
        game.renderer.info.reset();
        if (game.composer) game.composer.render(0); else game.renderer.render(game.scene, cm);
        info = { calls: game.renderer.info.render.calls, ktris: Math.round(game.renderer.info.render.triangles / 1000) };
      };
      const id = (T._viewId = (T._viewId || 0) + 1);
      const loop = () => { if (T._viewId !== id) return; draw(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      return new Promise((r) => setTimeout(() => r(info), ms));
    },
    /** Câmera livre em coordenadas do mundo, com o mesmo laço curto de renderização. */
    worldView(p, t, { ms = 1600 } = {}) {
      const cm = game.camera;
      const id = (T._viewId = (T._viewId || 0) + 1);
      const loop = () => { if (T._viewId !== id) return; cm.position.set(...p); cm.lookAt(...t); cm.updateProjectionMatrix(); if (game.composer) game.composer.render(0); else game.renderer.render(game.scene, cm); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      return new Promise((r) => setTimeout(r, ms));
    },
    stopView() { T._viewId = (T._viewId || 0) + 1; const h = document.querySelector('.hud'); if (h) h.style.display = ''; },
    async interiorShot(id, cam, tgt, o) {
      T.stopView();
      const I = game.interiors;
      if (I.active?.def.id !== id) T.enterInterior(id);
      T.fastSim(0.6);
      const A = I.active;
      return T.interiorView(cam || [A.W * 0.38, 2.5, A.D / 2 - 0.7], tgt || [-A.W * 0.12, 0.9, -A.D / 2 + 2], o);
    },
    /** SOMENTE DESENVOLVIMENTO: recompensa de teste pela interface de economia (não existe no build público). */
    grantMoney(n) { return game.economy.reward('dev', n, 'Teste (dev)'); },
    /** Vai até a porta de um imóvel/estabelecimento sem entrar. */
    toDoor(id, k = 1.2) {
      const e = game.interiors.exteriors.find((x) => x.def.id === id);
      T.fastPlace(e.poi.x + e.normal.x * k, e.poi.z + e.normal.z * k, e.bld.rotY);
      T.fastSim(0.3);
      return document.querySelector('.hud-prompt')?.innerText;
    },
    /** Inicia a partida sem clique (sem capturar o mouse) e pausa o loop. */
    /** PROMPT 11: os 45 testes obrigatórios do OCEAN DRIVE no jogo real. */
    async oceanSuite() {
      const { runOceanSuite } = await import('./OceanSuite.js');
      return runOceanSuite(T);
    },
    async boot() {
      for (let i = 0; i < 60 && game.state !== 'title'; i++) await new Promise((r) => setTimeout(r, 250));
      game.start();
      await new Promise((r) => setTimeout(r, 600));
      T.pauseLoop();
      T.fastSim(2.2);
      return game.state;
    },
  };
  return T;
}
