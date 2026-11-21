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
npm run test:hud
npm run build
```

- `F3`: mostra/oculta os painéis auxiliares. Status, radar e mira continuam disponíveis.
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

As posições e proporções usam a referência de 1024×572: indicadores no alto
à direita, radar de aproximadamente 136×114 no canto inferior esquerdo.
