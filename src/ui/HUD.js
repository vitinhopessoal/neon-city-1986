/**
 * HUD minimalista com estética retrô dos anos 80.
 * Exibe: nome do jogo, bairro, modo de câmera, guia de controles,
 * mensagens de contexto (limites) e estatísticas de desenvolvimento.
 */
import { bindingLabel as K } from '../core/InputManager.js';
import { StatusHUD } from './StatusHUD.js';

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = document.createElement('div');
    this.el.className = 'hud hidden hud-extras-hidden';
    this.extrasHidden = true;
    this.el.innerHTML = `
      <div class="hud-logo">
        <span class="hud-logo-main">NEON CITY</span><span class="hud-logo-year">1986</span>
      </div>
      <div class="hud-district">
        <div class="hud-district-label">BAIRRO</div>
        <div class="hud-district-name" data-ref="district">SUNSET BEACH</div>
      </div>
      <div class="hud-camera" data-ref="cameraBox">
        <span class="hud-camera-key">V</span>
        <span class="hud-camera-label">CÂMERA</span>
        <span class="hud-camera-mode" data-ref="camera">3ª PESSOA</span>
      </div>
      <div class="hud-help" data-ref="help">
        <div class="hud-help-title">CONTROLES</div>
        <div data-ref="helpFoot">
          <div><kbd>${K('forward')}</kbd><kbd>${K('left')}</kbd><kbd>${K('back')}</kbd><kbd>${K('right')}</kbd> mover</div>
          <div><kbd>${K('run')}</kbd> correr</div>
          <div><kbd>${K('jump')}</kbd> pular</div>
          <div><kbd>${K('interact')}</kbd> entrar no carro</div>
          <div><kbd>1</kbd>–<kbd>8</kbd> armas · <kbd>${K('holster')}</kbd> sacar/guardar · <kbd>${K('quickSelect')}</kbd> seleção</div>
          <div><kbd>MOUSE ESQ.</kbd> atirar · <kbd>MOUSE DIR.</kbd> mirar · <kbd>${K('reload')}</kbd> recarregar</div>
        </div>
        <div data-ref="helpCar" style="display:none">
          <div><kbd>${K('forward')}</kbd> acelerar · <kbd>${K('back')}</kbd> frear / ré</div>
          <div><kbd>${K('left')}</kbd><kbd>${K('right')}</kbd> direção</div>
          <div><kbd>${K('handbrake')}</kbd> freio de mão · <kbd>${K('horn')}</kbd> buzina</div>
          <div><kbd>${K('interact')}</kbd> sair · <kbd>${K('recover')}</kbd> recuperar</div>
        </div>
        <div><kbd>MOUSE</kbd> câmera</div>
        <div><kbd>${K('toggleCamera')}</kbd> 1ª / 3ª pessoa</div>
        <div><kbd>ESC</kbd> liberar o mouse · <kbd>${K('toggleHUD')}</kbd> ocultar painéis extras</div>
        <div class="hud-help-minor"><kbd>${K('cycleQuality')}</kbd> gráficos · <kbd>${K('cycleTime')}</kbd> horário · <kbd>${K('toggleMute')}</kbd> som · <kbd>${K('toggleHelp')}</kbd> ocultar ajuda</div>
      </div>
      <div class="hud-toast" data-ref="toast"></div>
      <div class="hud-prompt" data-ref="prompt"></div>
      <div class="hud-location" data-ref="location"></div>
      <div class="hud-stats" data-ref="stats"></div>
      <div class="hud-crosshair" data-ref="crosshair"></div>
      <div class="hud-lock" data-ref="lock">
        <div class="hud-lock-inner">
          <div class="hud-lock-title">CLIQUE PARA CONTROLAR A CÂMERA</div>
          <div class="hud-lock-sub">O mouse está livre · teclado continua ativo</div>
        </div>
      </div>
    `;
    root.appendChild(this.el);
    this.status = new StatusHUD(this.el);
    this.refs = {};
    for (const n of this.el.querySelectorAll('[data-ref]')) this.refs[n.dataset.ref] = n;
    this._toastTimer = 0;
    this._locationTimer = 0;
    this._statsTimer = 0;
    this._mode = null;
    this.showStats = false;
  }

  show() {
    this.el.classList.remove('hidden');
  }

  setCameraMode(label) {
    if (this._mode === label) return;
    this._mode = label;
    this.refs.camera.textContent = label;
    this.refs.cameraBox.classList.remove('pulse');
    void this.refs.cameraBox.offsetWidth;
    this.refs.cameraBox.classList.add('pulse');
    this.refs.crosshair.classList.toggle('visible', label.startsWith('1'));
  }

  /** Indicação de interação (ex.: PRESSIONE E PARA ENTRAR); null oculta. */
  setPrompt(html) {
    if (this._prompt === html) return;
    this._prompt = html;
    if (html) this.refs.prompt.innerHTML = html;
    this.refs.prompt.classList.toggle('visible', !!html);
  }

  /** Ajuda contextual: 'foot' (a pé) ou 'vehicle' (dirigindo). */
  setHelpMode(mode) {
    this.refs.helpFoot.style.display = mode === 'vehicle' ? 'none' : '';
    this.refs.helpCar.style.display = mode === 'vehicle' ? '' : 'none';
    // O painel de ajuda sobe para não cobrir o velocímetro.
    this.refs.help.classList.toggle('vehicle', mode === 'vehicle');
  }

  setDistrict(name) {
    this.refs.district.textContent = name;
  }

  toggleHelp() {
    this.refs.help.classList.toggle('collapsed');
  }

  /** F3 hides auxiliary panels; the reference's primary HUD and radar stay on. */
  toggleExtras() {
    this.extrasHidden = !this.extrasHidden;
    this.el.classList.toggle('hud-extras-hidden', this.extrasHidden);
    return !this.extrasHidden;
  }

  setPointerLocked(locked, started) {
    this.refs.lock.classList.toggle('visible', !locked && started);
  }

  /** Mensagem temporária no centro inferior. */
  toast(text, seconds = 2.2) {
    this.refs.toast.textContent = text;
    this.refs.toast.classList.add('visible');
    this._toastTimer = seconds;
  }

  /** Cartão de localização grande (ao entrar no bairro). */
  location(title, subtitle, seconds = 4) {
    this.refs.location.innerHTML = `<div class="loc-sub">${subtitle}</div><div class="loc-title">${title}</div>`;
    this.refs.location.classList.add('visible');
    this._locationTimer = seconds;
  }

  update(dt, stats) {
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.refs.toast.classList.remove('visible');
    }
    if (this._locationTimer > 0) {
      this._locationTimer -= dt;
      if (this._locationTimer <= 0) this.refs.location.classList.remove('visible');
    }
    this.refs.stats.classList.toggle('visible', this.showStats);
    if (this.showStats && stats) {
      this._statsTimer -= dt;
      if (this._statsTimer <= 0) {
        this._statsTimer = 0.25;
        this.refs.stats.textContent =
          `FPS ${stats.fps.toFixed(0)} · ${stats.ms.toFixed(1)} ms\n` +
          `draw calls ${stats.calls} · tris ${(stats.triangles / 1000).toFixed(0)}k\n` +
          `pixel ratio ${stats.pixelRatio.toFixed(2)} · qualidade ${stats.quality}\n` +
          `pos ${stats.pos.x.toFixed(1)}, ${stats.pos.y.toFixed(2)}, ${stats.pos.z.toFixed(1)} · ${stats.surface}\n` +
          `vel ${stats.speed.toFixed(1)} m/s · ${stats.state}` +
          (stats.map ? `\nmapa ${stats.map}` : '');
      }
    }
  }
}
