# Interface do Vice City

Abra o jogo com `npm run dev -- --host 127.0.0.1` e acesse
<http://127.0.0.1:5173/?time=morning>.

## Minimapa

O radar retangular fica fixo no canto inferior esquerdo. Sua imagem vem dos
64 arquivos `radar00.txd` a `radar63.txd`, extraídos da cópia local do
`gta3.img`. O atlas original tem 1024 × 1024 pixels e fica apenas em
`dev-maps/vice-city/radar/atlas.png`, fora do Git e do build de produção.
A apresentação usa tons cinza, seta do jogador, indicação do norte, escala,
veículos e marcadores que realmente existem no jogo. A barra verde reflete a saúde.

A calibração usa os limites nativos de −2000 a +2000 e a mesma mudança de eixos
da cidade, `(X,Y,Z) GTA → (X,Z,−Y) Three.js`. A ordem dos blocos e esses limites
foram conferidos no código de [CRadar do reVC](https://github.com/mrxenginner/reVC/blob/miami/src/core/Radar.cpp).
As posições reais da rua inicial em Ocean Drive e da ponte com pisos
sobrepostos foram verificadas contra os pixels de rua do atlas. O radar é uma
projeção horizontal; as colisões e a seleção de pisos continuam tridimensionais.

Para extrair novamente o radar e atualizar os manifestos existentes:

```powershell
python tools/vice-city/radar.py
```

`convert.py` também gera o radar automaticamente. Os hashes dos 64 blocos de
origem ficam em `radar/provenance.json`. A renderização usa Canvas2D a 10 Hz,
sem desenhar uma segunda cena Three.js. `N` alterna a vista local e geral.

## Mapa completo e destino

**P → MAPA** abre o atlas original em cores, com a cidade inteira e a posição
real do jogador. Clique para marcar um destino; arraste para mover o mapa e
use a roda ou os botões +/− para ampliar. **Mapa inteiro** restaura o enquadramento;
**Minha posição** aproxima o jogador. O botão direito, Delete ou **Remover destino**
apaga a marcação. Também é possível usar as setas, +/−, Home e Enter no mapa.

O destino aparece em roxo no mapa e no minimapa. Fora do alcance do radar,
uma seta na borda indica a direção. A distância é horizontal e em linha reta;
não há cálculo de trajeto pelas ruas ou instruções de conversão. A marcação
persiste por mapa no localStorage (`neoncity.waypoint.vice-city`).

## Velocímetro

O painel compacto aparece no canto inferior direito ao entrar em carro ou moto
e desaparece ao sair. O mostrador grande mostra o RPM, a faixa vermelha e a
marcha, com velocidade digital em km/h. O mostrador pequeno indica turbo nos
carros equipados com esse módulo ou a porcentagem do acelerador nos demais.
As leituras usam os valores atuais da física do veículo. Integridade e nitro
continuam disponíveis em barras discretas; não há manual permanente na HUD.

Uma PALM RIDER 125 e dois carros aparecem em posições verificadas no chão real
perto do ponto inicial do Vice City.

## Menu P

`P` abre as opções e pausa a simulação. `P`, `ESC` ou **RETOMAR** fecham o menu.
O menu também funciona na tela inicial após o carregamento do cenário.

As cinco categorias são:

- **Controles:** sensibilidade do mouse, câmera vertical invertida e atalhos.
- **Jogabilidade:** norte fixo no radar, área visível e alternância de câmera.
- **Gráficos:** perfil de qualidade e informações do perfil aplicado.
- **Áudio:** volume geral, música, rádio, vozes, efeitos, ambiente e silêncio.
- **Acessibilidade:** tamanho do texto dos manuais, destaque de alto contraste
  no radar, contraste da interface e redução de animações da interface.

As preferências da interface usam `neoncity.interface.preferences` no
localStorage. A qualidade e os volumes mantêm o armazenamento já usado pelo
jogo. **Restaurar padrões** redefine essas opções sem apagar a partida.

A navegação lateral oferece o mapa completo, salvamento/carregamento,
inventário/propriedades, manuais e estatísticas reais da sessão. Os controles
de caminhada, veículos, armas e rádio ficam em **MANUAIS**. Os antigos cartões
de instruções, avisos de teclas, cartões de localização, guias permanentes de
veículos e armas e o aviso central do mouse foram retirados da tela de jogo.
Os comandos estão nos manuais. F3 não restaura esses painéis.

## Verificação

```powershell
node --test tools/hud/radar-menu.test.mjs tools/hud/status.test.mjs tools/test-map/coastal-city.test.mjs
npm run test:interface
npm run test:desktop
npm run test:vice
npm run build
```

Os testes cobrem orientação do radar, calibração em posições reais, imagem
importada sem metadados de ruas, persistência e validação de preferências,
estado de pausa e liberação dos controles, remoção do painel F3, status da HUD,
compatibilidade do minimapa, colisões e recuperação de saves.
