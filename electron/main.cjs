'use strict';
/**
 * NEON CITY: 1986 — aplicativo desktop (Electron).
 *
 * Carrega o build de produção (dist/) por um protocolo próprio "app://neon-city/",
 * em vez de file://. Assim os módulos ES funcionam e o jogo tem uma origem fixa,
 * e os saves (IndexedDB/localStorage) persistem entre execuções no perfil do usuário.
 *
 * O jogo em si não muda: é o mesmo código do navegador.
 */
const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'app';
const HOST = 'neon-city';
const DIST = path.join(__dirname, '..', 'dist');
// npm run desktop:dev → abre o servidor do Vite (com o harness de desenvolvimento).
const DEV_URL = process.env.NEON_DEV_URL || '';

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Uma única instância: abrir o atalho de novo só traz a janela para frente.
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function serveDist() {
  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    // Nunca serve nada fora de dist/.
    if (file !== DIST && !file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    title: 'NEON CITY: 1986',
    backgroundColor: '#1a0b2e',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  // Teclas do app: F11 tela cheia, Ctrl+Shift+I ferramentas (só em desenvolvimento).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
    if (DEV_URL && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
  });

  // Links externos abrem no navegador do sistema; a janela do jogo nunca navega para fora.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const ok = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(`${SCHEME}://${HOST}/`);
    if (!ok) e.preventDefault();
  });

  win.loadURL(DEV_URL || `${SCHEME}://${HOST}/index.html`);
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  if (!DEV_URL) serveDist();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
