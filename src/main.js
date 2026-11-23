import './styles/main.css';
import './styles/pause-menu.css';
import { Game } from './core/Game.js';

const canvas = document.getElementById('game-canvas');
const uiRoot = document.getElementById('ui-root');

function showFatal(err) {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.innerHTML = `<h2>Não foi possível iniciar NEON CITY: 1986</h2><p>${String(err?.message || err)}</p><p>Verifique se o navegador suporta WebGL 2.</p>`;
  uiRoot.appendChild(box);
}

try {
  const game = new Game({ canvas, uiRoot });
  game.init().catch(showFatal);
} catch (err) {
  showFatal(err);
}
