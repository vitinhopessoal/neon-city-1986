import { StatusHUD } from './StatusHUD.js';

/** Gameplay status and brief interactions only. Manuals live in the P menu. */
export class HUD {
  constructor(root) {
    this.root = root; this.el = document.createElement('div'); this.el.className = 'hud hidden';
    this.el.innerHTML = `<div class="hud-toast" data-ref="toast"></div>
      <div class="hud-prompt" data-ref="prompt"></div>
      <div class="hud-location" data-ref="location"></div>
      <div class="hud-crosshair" data-ref="crosshair"></div>`;
    root.appendChild(this.el); this.status = new StatusHUD(this.el);
    this.refs = {}; for (const node of this.el.querySelectorAll('[data-ref]')) this.refs[node.dataset.ref] = node;
    this._toastTimer = 0; this._locationTimer = 0;
  }
  show() { this.el.classList.remove('hidden'); }
  setCameraMode(label) { this._mode = label; this.refs.crosshair.classList.toggle('visible', label.startsWith('1')); }
  setDistrict(name) { this.district = name; }
  setHelpMode(mode) { this.helpMode = mode; }
  setPointerLocked(locked) { this.pointerLocked = locked; }
  setPrompt(html) {
    if (this._prompt === html) return; this._prompt = html;
    if (html) this.refs.prompt.innerHTML = html;
    this.refs.prompt.classList.toggle('visible', !!html);
  }
  toast(text, seconds = 2.2) {
    this.refs.toast.textContent = text; this.refs.toast.classList.add('visible'); this._toastTimer = seconds;
  }
  location(title, subtitle, seconds = 4) {
    this.refs.location.innerHTML = `<div class="loc-sub">${subtitle}</div><div class="loc-title">${title}</div>`;
    this.refs.location.classList.add('visible'); this._locationTimer = seconds;
  }
  update(dt) {
    if (this._toastTimer > 0 && (this._toastTimer -= dt) <= 0) this.refs.toast.classList.remove('visible');
    if (this._locationTimer > 0 && (this._locationTimer -= dt) <= 0) this.refs.location.classList.remove('visible');
  }
}
