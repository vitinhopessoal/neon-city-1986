/**
 * Gerencia teclado, mouse e Pointer Lock.
 * As teclas são mapeadas para "ações", permitindo remapeamento futuro
 * (ex.: entrar em veículos, atacar) sem alterar os sistemas consumidores.
 */
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  toggleCamera: ['KeyV'],
  toggleHelp: ['KeyH'],
  toggleHUD: ['F3'],
  toggleStats: ['Backquote'],
  cycleQuality: ['KeyG'],
  toggleMute: ['KeyM'],
  toggleMap: ['F8'],
  toggleNavigation: ['KeyN'],
  togglePlayerModel: ['F9'],
  toggleCityDebug: ['F10'],
  cycleTime: ['KeyT'],
  gameMenu: ['KeyP'],
  inventory: ['KeyI'],
  // Veículos.
  interact: ['KeyE'],
  handbrake: ['Space'],
  recover: ['KeyR'],
  horn: ['KeyQ'],
  // Armas (a pé). R também é "recover" no carro: os contextos são exclusivos.
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  reload: ['KeyR'],
  holster: ['KeyX'],
  quickSelect: ['Tab'],
  weaponNext: ['WheelDown'],
  weaponPrev: ['WheelUp'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  weapon4: ['Digit4'],
  weapon5: ['Digit5'],
  weapon6: ['Digit6'],
  weapon7: ['Digit7'],
  weapon8: ['Digit8'],
};

/**
 * Descrição central das ações (documentação e textos da interface).
 * context: 'pé' | 'carro' | 'global'. Mudar uma tecla em DEFAULT_BINDINGS
 * atualiza automaticamente o HUD (via bindingLabel).
 */
export const ACTION_INFO = {
  toggleHUD: { context: 'global', label: 'Mostrar/ocultar painéis extras da HUD' },
  toggleNavigation: { context: 'global', label: 'Mapa local / mapa geral' },
  forward: { context: 'pé/carro', label: 'Andar para frente / acelerar' },
  back: { context: 'pé/carro', label: 'Andar para trás / frear e ré' },
  left: { context: 'pé/carro', label: 'Esquerda / esterçar à esquerda' },
  right: { context: 'pé/carro', label: 'Direita / esterçar à direita' },
  run: { context: 'pé', label: 'Correr' },
  jump: { context: 'pé', label: 'Pular' },
  handbrake: { context: 'carro', label: 'Freio de mão' },
  interact: { context: 'pé/carro', label: 'Entrar / sair do veículo' },
  recover: { context: 'carro', label: 'Recuperar veículo preso' },
  horn: { context: 'carro', label: 'Buzina' },
  toggleCamera: { context: 'global', label: 'Alternar 1ª / 3ª pessoa' },
  toggleHelp: { context: 'global', label: 'Mostrar/ocultar ajuda' },
  toggleStats: { context: 'global', label: 'Estatísticas de desempenho' },
  cycleQuality: { context: 'global', label: 'Perfil gráfico (baixo/médio/alto)' },
  toggleMute: { context: 'global', label: 'Som liga/desliga' },
  cycleTime: { context: 'global', label: 'Horário (manhã/pôr do sol/noite)' },
  gameMenu: { context: 'global', label: 'Menu do jogo (salvar, carregar, propriedades, inventário)' },
  inventory: { context: 'global', label: 'Consultar inventário' },
  toggleMap: { context: 'global (dev)', label: 'Alternar mapa de testes' },
  togglePlayerModel: { context: 'global (dev)', label: 'Alternar protagonista (GLB / original)' },
  toggleCityDebug: { context: 'global (dev)', label: 'Depuração do trânsito e pedestres' },
  fire: { context: 'pé (armado)', label: 'Disparar' },
  aim: { context: 'pé (armado)', label: 'Mirar' },
  reload: { context: 'pé (armado)', label: 'Recarregar' },
  holster: { context: 'pé', label: 'Guardar / sacar arma' },
  quickSelect: { context: 'pé', label: 'Seleção rápida de armas (segurar)' },
  weaponNext: { context: 'pé', label: 'Próxima arma' },
  weaponPrev: { context: 'pé', label: 'Arma anterior' },
  weapon1: { context: 'pé', label: 'Arma 1 (Bren Ten)' },
  weapon2: { context: 'pé', label: 'Arma 2 (S&W 645)' },
  weapon3: { context: 'pé', label: 'Arma 3 (S&W 4503)' },
  weapon4: { context: 'pé', label: 'Arma 4 (Ithaca 37 Stakeout)' },
  weapon5: { context: 'pé', label: 'Arma 5 (MAC-10)' },
  weapon6: { context: 'pé', label: 'Arma 6 (MAC-11)' },
  weapon7: { context: 'pé', label: 'Arma 7 (KG-99)' },
  weapon8: { context: 'pé', label: 'Arma 8 (carabinas Colt)' },
};

const KEY_NAMES = {
  Space: 'ESPAÇO', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓',
  ArrowLeft: '←', ArrowRight: '→', Escape: 'ESC', Enter: 'ENTER',
  Mouse0: 'MOUSE ESQ.', Mouse2: 'MOUSE DIR.', WheelUp: 'RODA ↑', WheelDown: 'RODA ↓', Tab: 'TAB',
};

/** Nome curto de uma tecla (KeyW → W, Space → ESPAÇO). */
export function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** Rótulo da tecla principal de uma ação (para textos do HUD). */
export function bindingLabel(action, bindings = DEFAULT_BINDINGS) {
  const codes = bindings[action];
  return codes && codes.length ? keyName(codes[0]) : '?';
}

/** Detecta códigos usados por mais de uma ação (conflitos de contexto). */
export function bindingConflicts(bindings = DEFAULT_BINDINGS) {
  const byCode = new Map();
  for (const [a, codes] of Object.entries(bindings)) for (const c of codes) byCode.set(c, [...(byCode.get(c) || []), a]);
  return [...byCode.entries()].filter(([, acts]) => acts.length > 1).map(([code, acts]) => ({ code, actions: acts }));
}

const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote', 'F3', 'F8', 'F9', 'Tab']);

/** Ações de interface que funcionam também fora da jogabilidade (ex.: tela inicial). */
const GLOBAL_ACTIONS = new Set(['toggleHUD', 'toggleMap', 'togglePlayerModel', 'toggleCityDebug', 'toggleStats', 'cycleQuality', 'toggleMute', 'toggleHelp', 'cycleTime']);
/** Teclas sem ação padrão útil no navegador, bloqueadas mesmo com o jogo inativo. */
const ALWAYS_PREVENT = new Set(['F3', 'F8', 'F9', 'F10']);

export class InputManager {
  constructor(element, bindings = DEFAULT_BINDINGS) {
    this.element = element;
    this.bindings = bindings;
    this.enabled = false;

    this._down = new Set();
    this._pressed = new Set();
    this._codeToActions = new Map();
    for (const [action, codes] of Object.entries(bindings)) {
      for (const code of codes) {
        if (!this._codeToActions.has(code)) this._codeToActions.set(code, []);
        this._codeToActions.get(code).push(action);
      }
    }

    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pointerLocked = false;
    this._lockListeners = new Set();

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    this._onLockError = this._onLockError.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onContextMenu = (e) => { if (this.pointerLocked) e.preventDefault(); };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockError);
    // Botões e roda do mouse viram "códigos" (Mouse0, Mouse2, WheelUp...) e
    // só contam com o cursor travado no jogo (cliques em menus não disparam).
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('contextmenu', this._onContextMenu);
  }

  _press(code) {
    this._down.add(code);
    const actions = this._codeToActions.get(code);
    if (actions) for (const a of actions) if (this.enabled || GLOBAL_ACTIONS.has(a)) this._pressed.add(a);
  }

  _onMouseDown(e) {
    if (!this.pointerLocked || !this.enabled) return;
    this._press(`Mouse${e.button}`);
  }

  _onMouseUp(e) {
    this._down.delete(`Mouse${e.button}`);
  }

  _onWheel(e) {
    if (!this.pointerLocked || !this.enabled || Math.abs(e.deltaY) < 1) return;
    const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
    this._press(code);
    this._down.delete(code); // roda: só borda de subida
  }

  /** Solicita o Pointer Lock. Deve ser chamado dentro de um gesto do usuário. */
  requestPointerLock() {
    if (this.pointerLocked || !this.element.requestPointerLock) return;
    try {
      const result = this.element.requestPointerLock({ unadjustedMovement: false });
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          /* navegador recusou (ex.: ESC recente); o usuário pode clicar de novo */
        });
      }
    } catch {
      /* alguns navegadores não aceitam opções */
      try { this.element.requestPointerLock(); } catch { /* ignorado */ }
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  onPointerLockChange(fn) {
    this._lockListeners.add(fn);
    return () => this._lockListeners.delete(fn);
  }

  /** Ação mantida pressionada. */
  isDown(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this._down.has(c)) return true;
    return false;
  }

  /** Ação pressionada neste quadro (borda de subida). */
  wasPressed(action) {
    return this._pressed.has(action);
  }

  /** Retorna e zera o deslocamento acumulado do mouse. */
  consumeMouseDelta(out) {
    out.x = this.mouseDX;
    out.y = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  /** Limpa as bordas de subida; chamar ao final de cada quadro. */
  endFrame() {
    this._pressed.clear();
  }

  clearAll() {
    this._down.clear();
    this._pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  _onKeyDown(e) {
    if ((PREVENT_DEFAULT.has(e.code) && this.enabled) || ALWAYS_PREVENT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    // Atalhos do sistema (Win+G, Win+Shift+S, Alt+Tab...) não devem acionar o jogo.
    if (e.metaKey || e.altKey || e.code.startsWith('Meta') || e.code.startsWith('Alt')) return;
    this._down.add(e.code);
    const actions = this._codeToActions.get(e.code);
    if (actions) {
      for (const a of actions) if (this.enabled || GLOBAL_ACTIONS.has(a)) this._pressed.add(a);
    }
  }

  _onKeyUp(e) {
    this._down.delete(e.code);
  }

  _onMouseMove(e) {
    if (!this.pointerLocked || !this.enabled) return;
    // Descarta picos absurdos que alguns navegadores emitem ao travar o cursor.
    const dx = Math.abs(e.movementX) > 400 ? 0 : e.movementX;
    const dy = Math.abs(e.movementY) > 400 ? 0 : e.movementY;
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  _onBlur() {
    this.clearAll();
  }

  _onLockChange() {
    this.pointerLocked = document.pointerLockElement === this.element;
    if (!this.pointerLocked) {
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
    for (const fn of this._lockListeners) fn(this.pointerLocked);
  }

  _onLockError() {
    this.pointerLocked = false;
    for (const fn of this._lockListeners) fn(false);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockError);
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('contextmenu', this._onContextMenu);
    this._lockListeners.clear();
  }
}
