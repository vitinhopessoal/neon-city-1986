// npm run desktop:dev — sobe o Vite (porta 5173) e abre o jogo na janela do Electron
// apontando para o servidor de desenvolvimento (HMR, harness __NEON_TEST__, F8/F9/F10).
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';

const server = await createServer({ server: { port: 5173 } });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`Vite em ${url} — abrindo o Electron`);
const child = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, NEON_DEV_URL: url } });
child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
