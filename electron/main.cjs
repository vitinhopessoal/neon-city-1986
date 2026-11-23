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
const { app, BrowserWindow, protocol, net, shell, Menu, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { inspectMap, discoverMap, resolveRequest } = require('./local-map.cjs');

const SCHEME = 'app';
const HOST = 'neon-city';
const DIST = path.join(__dirname, '..', 'dist');
// npm run desktop:dev → abre o servidor do Vite (com o harness de desenvolvimento).
const DEV_URL = process.env.NEON_DEV_URL || '';
// Permite testar uma atualização em perfil isolado, sem abrir a partida instalada.
const profileDirectory = app.commandLine.getSwitchValue('user-data-dir');
if (profileDirectory) app.setPath('userData', path.resolve(profileDirectory));

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Uma única instância: abrir o atalho de novo só traz a janela para frente.
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function serveDist(mapRoot) {
  protocol.handle(SCHEME, (req) => {
    const file = resolveRequest(req.url, DIST, mapRoot);
    if (!file) return new Response('Arquivo local não encontrado', { status: 404 });
    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('Arquivo indisponível', { status: 404 }));
  });
}

async function chooseLocalMap() {
  const configFile = path.join(app.getPath('userData'), 'vice-city-folder.json');
  let saved;
  try { saved = JSON.parse(fs.readFileSync(configFile, 'utf8')).directory; } catch {}
  const found = discoverMap({ explicit: process.env.NEON_VICE_CITY_DIR, saved,
    bases: [process.env.PORTABLE_EXECUTABLE_DIR, path.dirname(app.getPath('exe')), app.getAppPath(), process.cwd()],
    userData: app.getPath('userData') });
  if (found) return found;
  while (true) {
    const selection = await dialog.showOpenDialog({ title: 'Selecione a pasta local do Vice City convertido',
      message: 'Escolha a pasta vice-city que contém manifest.json, os setores GLB, colisões e radar. Os arquivos do GTA ficam somente no seu computador.',
      buttonLabel: 'Usar este mapa', properties: ['openDirectory'] });
    if (selection.canceled) return null;
    const root = inspectMap(selection.filePaths[0]);
    if (root) {
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, JSON.stringify({ directory: root }, null, 2));
      return root;
    }
    await dialog.showMessageBox({ type: 'warning', title: 'Mapa incompleto',
      message: 'Essa pasta não contém o Vice City convertido completo.',
      detail: 'Selecione dev-maps/vice-city com manifest.json, setores GLB, arquivos .collision.bin e radar/atlas.png. O maps.rar e a instalação original do GTA precisam ser convertidos antes.' });
  }
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

app.whenReady().then(async () => {
  if (!DEV_URL) {
    const mapRoot = await chooseLocalMap();
    if (!mapRoot) { app.quit(); return; }
    serveDist(mapRoot);
  }
  createWindow();
}).catch(error => { dialog.showErrorBox('Falha ao abrir NEON CITY', error.message); app.quit(); });

app.on('window-all-closed', () => app.quit());
