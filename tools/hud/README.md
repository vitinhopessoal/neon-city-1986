# HUD de referência

A HUD usa `models/fonts.txd` e `models/hud.txd` do `GTA-VC.rar`
fornecido pelo usuário. Os ícones vêm dos TXDs de armas em `models/gta3.img`.
Somente os PNGs selecionados ficam em `public/hud/vice/`; o RAR, IMG, DIR
e os TXDs de trabalho ficam em `tools/ai-reference-temp/`, fora do build.
O extrator converte DXT1/DXT3 sem dependências e ajusta o fundo dos ícones
para rosa/roxo, conforme a imagem enviada.

Depois de extrair os TXDs para a pasta de trabalho:

```powershell
python tools/hud/extract-hud.py tools/ai-reference-temp/hud
node --test tools/hud/status.test.mjs tools/hud/radar-menu.test.mjs
npm run build
```

- `P`: abre opções, manuais, mapa completo e estatísticas. F3 não restaura mais
  painéis ou instruções sobre a cena.
- `N`: alterna radar local e mapa geral. O radar local gira com o personagem.
- `X` e seleção de armas continuam funcionando; o ícone mostra a arma sacada ou o punho.
- `player.status`: saúde, carteira, relógio e nível de procurado, independentes da interface.
  `damage`, `setHealth`, `addMoney`, `spendMoney` e `setWanted` são os pontos de integração.
- Quedas fortes e colisões do carro do jogador reduzem saúde. Disparos e
  atropelamentos cometidos pelo jogador aumentam as estrelas. A perda de
  contato com a polícia permite reduzir o nível de procurado;
  a perseguição e a busca são controladas agora pelo módulo `src/police/`.
- A carteira inicia em $660, sem recompensas inventadas. Não há ainda lojas,
  missões ou salvamento da carteira. Polícia e morte agora usam um
  ressurgimento após três segundos, com taxa na carteira e arsenal preservado.
- O relógio avança um minuto por segundo de jogo ativo. `T` sincroniza o
  relógio com o preset de iluminação escolhido; a iluminação continua manual.

Os indicadores ficam no alto à direita. O minimapa agora é retangular, fixo no
canto inferior esquerdo, com as 64 texturas originais de radar convertidas para
`dev-maps/vice-city/radar/atlas.png`. Esses novos recursos ficam fora do Git e
do build. Veja `docs/INTERFACE_VICE_CITY.md` para calibração e opções do menu.
