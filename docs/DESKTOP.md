# NEON CITY: 1986 — versão desktop (Windows)

O jogo roda numa janela própria, sem navegador, empacotado com **Electron**.
É o mesmo código do jogo web: nenhum sistema foi reescrito. O Electron só carrega o build
de produção (`dist/`) por um protocolo interno `app://neon-city/`, além do mapa
convertido em uma pasta externa local.

## Vice City local — versão 0.2.5

O instalador e o portátil publicados no GitHub não incluem modelos, texturas,
colisões nem o atlas do GTA. É necessário ter o mapa convertido descrito em
[VICE_CITY_LOCAL.md](VICE_CITY_LOCAL.md). O jogo usa somente esse mapa.

No primeiro uso, selecione a pasta **vice-city** que contém `manifest.json`, os
29 setores `.glb`, os `.collision.bin`, `textures/` e `radar/atlas.png`.
A instalação original e `maps.rar` não são aceitos diretamente pelo executável.
A pasta escolhida fica registrada em `%APPDATA%/neon-city-1986/vice-city-folder.json`.
Se ela for movida ou ficar incompleta, o aplicativo solicita outra seleção.
Cancelar a seleção encerra o aplicativo.

O aplicativo procura automaticamente `dev-maps/vice-city`, `maps/vice-city` ou
`vice-city` ao lado do executável e em até três pastas superiores, além da
pasta de trabalho e de `%APPDATA%/neon-city-1986/maps/vice-city`.
No portátil, a procura usa também a pasta do `.exe` original.
Para escolher explicitamente uma pasta antes de iniciar, use a variável de
ambiente `NEON_VICE_CITY_DIR` com o caminho absoluto do mapa convertido.
O aplicativo não move nem modifica os recursos do GTA.

**P** abre o menu, **MAPA** mostra o atlas em cores e permite marcar um destino.
O minimapa fica fixo à esquerda e o velocímetro compacto aparece à direita
quando o jogador está em carro ou moto. Veja [INTERFACE_VICE_CITY.md](INTERFACE_VICE_CITY.md).

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
- Para uma sessão de teste separada, `--user-data-dir="caminho absoluto"` usa outro
  perfil, sem alterar a partida da instalação principal.
- Links externos abrem no navegador do sistema; a janela do jogo nunca navega para fora.

## Segurança

- `contextIsolation`, `sandbox` ligados e `nodeIntegration` desligado: o código do jogo não tem acesso ao Node.
- O protocolo `app://` serve `dist/` e, somente em `/dev-maps/vice-city/`, a pasta
  local validada. Caminhos fora dessas raízes e links que escapam delas são rejeitados.
- `dev-maps/`, fontes do GTA e ferramentas de conversão não entram no executável.

## Linux (Linux Mint, Ubuntu e derivados)

As versões Linux são geradas pelo GitHub Actions (`.github/workflows/linux.yml`) numa máquina
Ubuntu e anexadas à Release: rode em **Actions → Build Linux → Run workflow** ou publique uma tag `v*`.
Localmente, num Linux: `npm run dist:linux`. No Windows o AppImage não pode ser gerado, porque o
empacotamento exige links simbólicos.

- **`.deb` (recomendado no Mint)**: dois cliques no arquivo → **Instalar pacote**. Ou, no terminal:
  `sudo apt install ./NEON-CITY-1986-0.2.5-linux-amd64.deb`. O jogo aparece no menu como **NEON CITY 1986**.
  Para remover: `sudo apt remove neon-city-1986`.
- **AppImage (sem instalar)**: botão direito → Propriedades → Permissões → *Permitir executar o arquivo como
  programa*, depois dois cliques. Ou `chmod +x NEON-CITY-1986-0.2.5-linux-x86_64.AppImage && ./NEON-CITY-1986-0.2.5-linux-x86_64.AppImage`.
  Se reclamar de FUSE: `sudo apt install libfuse2t64` (Mint 22) ou `sudo apt install libfuse2` (Mint 21).
- Saves no Linux: `~/.config/neon-city-1986`.
- Placa NVIDIA: use o driver proprietário (Gerenciador de Drivers do Mint) para o WebGL rodar com aceleração.

## Observações

- O executável não é assinado digitalmente. Na primeira execução o Windows SmartScreen pode
  mostrar "O Windows protegeu o computador" → **Mais informações → Executar assim mesmo**.
- O pacote inclui só `dist/`, `electron/`, o ícone e o `package.json` (sem código-fonte nem ferramentas).
