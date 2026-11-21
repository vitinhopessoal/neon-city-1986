# NEON CITY: 1986 — versão desktop (Windows)

O jogo roda numa janela própria, sem navegador, empacotado com **Electron**.
É o mesmo código do jogo web: nenhum sistema foi reescrito. O Electron só carrega o build
de produção (`dist/`) por um protocolo interno `app://neon-city/`.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run desktop` | Gera o build e abre o jogo na janela desktop (sem gerar instalador). |
| `npm run desktop:dev` | Abre a janela desktop ligada ao servidor do Vite (HMR, harness de testes, F8/F9/F10, Ctrl+Shift+I). |
| `npm run dist:win` | Gera em `release/` o instalador `NEON-CITY-1986-Setup-<versão>.exe` e o `NEON-CITY-1986-Portable-<versão>.exe`. |
| `npm run icon` | Regera `build/icon.png` (arte procedural original). |

## Na janela do jogo

- **F11**: alterna tela cheia. A janela abre maximizada.
- Saves: ficam no perfil do aplicativo (`%APPDATA%\neon-city-1986`). São **separados** dos saves
  do navegador (`localhost:5173`), porque cada origem tem o próprio IndexedDB.
- Só uma instância por vez: abrir o atalho de novo traz a janela existente para frente.
- Links externos abrem no navegador do sistema; a janela do jogo nunca navega para fora.

## Segurança

- `contextIsolation`, `sandbox` ligados e `nodeIntegration` desligado: o código do jogo não tem acesso ao Node.
- O protocolo `app://` só serve arquivos de dentro de `dist/`.
- `dev-maps/` (TEST CITY) não entra no build nem no executável, como no build web.

## Linux (Linux Mint, Ubuntu e derivados)

As versões Linux são geradas pelo GitHub Actions (`.github/workflows/linux.yml`) numa máquina
Ubuntu e anexadas à Release: rode em **Actions → Build Linux → Run workflow** ou publique uma tag `v*`.
Localmente, num Linux: `npm run dist:linux`. No Windows o AppImage não pode ser gerado, porque o
empacotamento exige links simbólicos.

- **`.deb` (recomendado no Mint)**: dois cliques no arquivo → **Instalar pacote**. Ou, no terminal:
  `sudo apt install ./NEON-CITY-1986-0.1.0-linux-amd64.deb`. O jogo aparece no menu como **NEON CITY 1986**.
  Para remover: `sudo apt remove neon-city-1986`.
- **AppImage (sem instalar)**: botão direito → Propriedades → Permissões → *Permitir executar o arquivo como
  programa*, depois dois cliques. Ou `chmod +x NEON-CITY-1986-0.1.0-linux-x86_64.AppImage && ./NEON-CITY-1986-0.1.0-linux-x86_64.AppImage`.
  Se reclamar de FUSE: `sudo apt install libfuse2t64` (Mint 22) ou `sudo apt install libfuse2` (Mint 21).
- Saves no Linux: `~/.config/neon-city-1986`.
- Placa NVIDIA: use o driver proprietário (Gerenciador de Drivers do Mint) para o WebGL rodar com aceleração.

## Observações

- O executável não é assinado digitalmente. Na primeira execução o Windows SmartScreen pode
  mostrar "O Windows protegeu o computador" → **Mais informações → Executar assim mesmo**.
- O pacote inclui só `dist/`, `electron/`, o ícone e o `package.json` (sem código-fonte nem ferramentas).
