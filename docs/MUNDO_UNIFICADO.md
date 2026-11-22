# Mundo unificado — Sunset Beach + TEST CITY

Os dois mapas agora são **um só mundo**. O TEST CITY (mapa original de testes, gerado por
`npm run build:testmap`) virou o **bairro oeste** de Sunset Beach. Não há tela de carregamento entre
eles: dá para ir a pé, de carro ou de moto pela Flamingo Street.

```
 x  -388 … -172   TEST CITY (216 x 216 m, 16 quarteirões, parque com colina)
 x  -172 … -150   corredor da Flamingo Street (pórtico "TEST CITY", calçadas, muretas)
 x  -150 …  110   Sunset Beach + Lantern Point (sem mudanças nos prédios e nas ruas internas)
```

## Como foi feito (sem reconstruir nada)

- **GLB intacto**: o mesmo `test-city.glb` (cópia idêntica, conferida por SHA-256) é carregado de
  `public/maps/test-city/` e só **transladado** 280 m para oeste (e 2 cm para baixo, para o asfalto
  do Sunset não piscar sobre o chão do GLB). Sem escala, sem rotação, sem editar o arquivo.
  `npm run build:testmap` agora grava o mapa em `dev-maps/` **e** em `public/maps/`.
- **Anexo, não troca de mapa** (`src/maps/TestCityAnnex.js`): o `ImportedMap` ganhou o modo `attach`.
  Nele, as colisões do GLB entram no `CollisionSystem` do mundo e o campo de alturas entra no `Terrain`
  como relevo anexado. Também ficam no mundo as superfícies dos passos, as ruas e cruzamentos do
  manifesto (mesma `RoadNetwork`), as pegadas dos prédios (radar) e o nome do bairro no HUD.
- **Ligação** (`src/world/districts/TestCityLink.js`): a Flamingo Street, que antes terminava num
  "ROAD CLOSED" em x = -150, segue até o cruzamento da rua Z100 do TEST CITY. O trânsito usa um único
  grafo: carros entram e saem do bairro pela mesma rua.
- **Limites**: muros nos outros três lados do TEST CITY. A borda leste tem uma passagem de 24 m e o
  corredor tem paredes laterais. A parede oeste do Sunset ganhou a mesma passagem, que fica fechada
  se o GLB não carregar.
- **Área jogável** com vários retângulos (`src/utils/bounds.js`): trânsito, pedestres, polícia e radar
  usam a união Sunset + corredor + TEST CITY, sem liberar o espaço vazio entre eles.

### O que mudou no Sunset Beach

| Item | Antes | Agora |
|---|---|---|
| Flamingo Street oeste | terminava fechada em x = -150 (seguia como fundo até -420) | segue até o TEST CITY (x = -175) |
| Cavaletes "ROAD CLOSED" da Flamingo | existiam | removidos (a rua é a ligação) |
| Calçadas de fundo a oeste | iam até x = -420, fora da área jogável | param em x = -150 |
| Silhuetas de prédios distantes a oeste | sobre a área que o bairro ocupa | omitidas nessa área |
| Chão de fundo | uma placa única | a mesma placa, com um vão sob o TEST CITY |

Prédios, interiores, vagas, decoração e o ponto de partida do Sunset Beach não mudaram (teste
`npm run test:merged`).

### O que foi omitido do GLB ao anexar (o arquivo não muda)

- As **paredes invisíveis** do mapa isolado (grupo `BOUNDS`): o mundo tem as próprias.
- **8 barreiras de concreto** da borda leste, na largura da passagem.
- **29 postes** que o gerador do mapa de testes colocou 2,5 m **dentro da pista**, na saída dos
  cruzamentos. No mapa isolado ninguém passava ali em velocidade. No mundo unificado, um sedã a
  80 km/h na Flamingo Street batia no primeiro deles (dano de 45%). Os outros postes, nas calçadas,
  continuam.

## Jogo

- O HUD mostra **TEST CITY** ao entrar no bairro; o radar desenha as duas áreas, as ruas e os prédios.
- Trânsito, pedestres, polícia (viaturas surgem nas ruas do bairro), salvamento e a **Sala de teste**
  (interior do TEST CITY) funcionam no bairro oeste.
- **F8** (só em `npm run dev`): leva o protagonista (a pé) de um bairro ao outro. O TEST CITY
  **isolado** continua disponível para testes de mapa no seletor "MAPA (DEV)" da tela inicial e em
  `?map=test-city`.

## Testes executados

- **No jogo** `await __NEON_TEST__.mergedSuite()`: **21/21 em três rodadas seguidas**. A bateria cobre:
  - mapa único;
  - GLB inteiro (48 216 triângulos visíveis e 2 119 colisores após as omissões);
  - posição sem sobreposição e nomes dos bairros;
  - atravessar a pé (x -135 → -202);
  - limites do corredor e do bairro;
  - colina de 4,48 m e superfícies (grama, calçada, asfalto);
  - prédios sólidos;
  - carro Sunset → TEST CITY (x -110 → -227 em 8 s, a 97 km/h, sem dano) e volta (x -300 → -93 em 11 s);
  - rotas de trânsito nos dois sentidos;
  - carros de trânsito no bairro (9 de 9 após 25 s na última rodada);
  - pedestres (697 nós, 18 pessoas) e viaturas da polícia surgindo no bairro;
  - radar, Sala de teste e salvar/carregar no bairro (desvio de 0,00 m);
  - F8;
  - TEST CITY isolado preservado;
  - console sem erros.
- **Node** `npm run test:merged`: 7/7. A bateria verifica:
  - Sunset intacto, salvo a ponta da Flamingo;
  - nenhuma laje sobre o bairro;
  - grafo único com rotas de ida e volta;
  - união de limites;
  - relevo anexado;
  - filtro dos postes;
  - GLB idêntico ao gerado.
- **Regressões no jogo**:
  - NEON MOTOR (carros): 153/153.
  - NEON MOTORCYCLES: 157/157.
  - OCEAN DRIVE: 45/45.
  - NEON RADIO: 32/32 rodando sozinho.
  - Rodando o rádio logo depois da bateria dos barcos, na mesma página, dá 31/32, tanto **antes** quanto
    depois da junção. A bateria dos barcos deixa o jogador no mar, longe do trânsito, e o teste
    "rádio dos NPCs" não encontra carro. O teste também passou a ignorar motos, que não têm rádio.
- **Node**: city 8, merged 7, assets 2, hud 6, police 20, ai 9, ocean 5, customs 3, destruction 10,
  neon 4, radio 6, moto 5 (todos passando). Build de produção OK.

## Desempenho (medido no Chrome sob automação: valores absolutos altos, comparar em pares)

| Vista | Quadro com o TEST CITY | Sem o TEST CITY | Chamadas de desenho |
|---|---|---|---|
| Sunset Beach olhando para oeste | 27–36 ms | 22–25 ms | 801 (602 sem) |
| Dentro do TEST CITY | 40–42 ms | 32–37 ms | 2 115 (1 970 sem) |

O bairro soma 103 malhas (29 instanciadas) e 48 mil triângulos. A carga do GLB (~1,4 MB) roda em
paralelo com os modelos dos carros e das motos. Anexar ao mundo leva ~45 ms.

## Limitações conhecidas

- O TEST CITY usa os materiais próprios do GLB: à noite as janelas e os postes do bairro não acendem
  como os do Sunset Beach.
- As ruas do bairro mantêm os nomes técnicos do manifesto (X0, Z100…). Não há vagas de estacionamento
  nem carros estacionados próprios: os carros chegam pelo trânsito.
- Fora dos dois bairros, o espaço entre eles (norte e sul do corredor) continua fechado.

Capturas: `docs/screenshots/mundo-unificado/` (vista aérea, pórtico na Flamingo Street, jogo no TEST CITY).
