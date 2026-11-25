import { defineConfig } from 'vite';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';

/**
 * Serve a pasta dev-maps/ em /dev-maps/ SOMENTE no servidor de desenvolvimento.
 * Mapas de teste e conteúdo externo ficam isolados dos recursos do jogo e
 * nunca entram no build de produção (dist/).
 */
function devMapsPlugin() {
  const root = resolve(process.cwd(), 'dev-maps');
  const types = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg' };
  return {
    name: 'neon-city-dev-maps',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev-maps', (req, res, next) => {
        try {
          const rel = decodeURIComponent((req.url || '/').split('?')[0]);
          const file = resolve(root, `.${rel}`);
          // VC resources remain local even when a development tunnel is active.
          const privateRoot = resolve(root, 'vice-city').toLowerCase();
          const privatePackage = resolve(root, 'vice-city-converted.zip').toLowerCase();
          if (file.toLowerCase() === privateRoot || file.toLowerCase().startsWith(privateRoot + sep) || file.toLowerCase() === privatePackage) {
            const host = new URL(`http://${req.headers.host || 'invalid'}`).hostname;
            if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
              res.statusCode = 403;
              return res.end('Local map only');
            }
          }
          if (file !== root && !file.startsWith(root + sep)) {
            res.statusCode = 403;
            return res.end('Forbidden');
          }
          const st = statSync(file, { throwIfNoEntry: false });
          if (!st || !st.isFile()) {
            res.statusCode = 404;
            return res.end('Not found');
          }
          // Validadores (ETag/Last-Modified): o navegador guarda os ~130 MB do mapa no cache
          // e, nas próximas aberturas, só revalida — recebe 304 sem baixar nada de novo.
          // Se o arquivo for reconvertido, tamanho/data mudam e o ETag força o download.
          const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
          res.setHeader('ETag', etag);
          res.setHeader('Last-Modified', st.mtime.toUTCString());
          res.setHeader('Cache-Control', 'no-cache');
          const inm = req.headers['if-none-match'];
          const ims = req.headers['if-modified-since'];
          if ((inm && inm.split(',').some(t => t.trim() === etag))
            || (!inm && ims && Math.floor(st.mtimeMs / 1000) <= Math.floor(Date.parse(ims) / 1000))) {
            res.statusCode = 304;
            return res.end();
          }
          res.setHeader('Content-Type', types[extname(file).toLowerCase()] || 'application/octet-stream');
          res.setHeader('Content-Length', st.size);
          if (req.method === 'HEAD') return res.end();
          createReadStream(file).pipe(res);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

function thirdPartyNoticesPlugin() {
  return {
    name: 'neon-city-third-party-notices',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD-PARTY-NOTICES.txt',
        source: 'Three.js — licença da biblioteca distribuída com o jogo\n\n'
          + readFileSync(resolve(process.cwd(), 'node_modules/three/LICENSE'), 'utf8'),
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  base: './',
  // Inclui o protagonista do usuário tanto no servidor local quanto no build.
  publicDir: 'public',
  plugins: [devMapsPlugin(), thirdPartyNoticesPlugin()],
  server: {
    port: 5173,
    open: false,
    // Escuta só em loopback (padrão "localhost"); o cloudflared encaminha a partir da própria máquina.
    // Túnel temporário (Cloudflare Quick Tunnel): libera SOMENTE este hostname, mantendo a
    // proteção de host do Vite para todos os outros. Remova esta linha ao encerrar o teste.
    allowedHosts: ['pools-subdivision-petersburg-attacks.trycloudflare.com'],
    fs: {
      // Padrões do Vite + itens que nunca devem ser servidos: pacotes compactados na raiz
      // (ex.: o mod de terceiros) e a configuração local de ferramentas (.claude/).
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/*.{zip,rar,7z}', '**/.claude/**', '**/tools/vice-city-local/**', '**/dev-maps/vice-city/**'],
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Separa o Three.js em um chunk próprio (melhor cache entre versões do jogo).
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
}));
