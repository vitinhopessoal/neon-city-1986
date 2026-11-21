/**
 * Relógio do jogo baseado em performance.now().
 * Fornece deltaTime limitado (evita saltos após troca de aba) e média de FPS.
 */
export class Time {
  constructor() {
    this.delta = 0;
    this.elapsed = 0;
    this.maxDelta = 0.1;
    this.timeScale = 1;
    this._last = performance.now();
    this.frame = 0;

    // Estatísticas de FPS (média móvel).
    this.fps = 60;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this.frameTimeMs = 16.7;
  }

  reset() {
    this._last = performance.now();
  }

  update(now = performance.now()) {
    let raw = (now - this._last) / 1000;
    this._last = now;
    if (raw < 0) raw = 0;

    this.frameTimeMs = this.frameTimeMs * 0.9 + raw * 1000 * 0.1;
    this._fpsAccum += raw;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    this.delta = Math.min(raw, this.maxDelta) * this.timeScale;
    this.elapsed += this.delta;
    this.frame++;
    return this.delta;
  }
}
