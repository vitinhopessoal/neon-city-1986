# NEON CITY: 1986

## Jogar no Windows (versão desktop)

```bash
npm install
npm run desktop
```

Para gerar o instalador e a versão portátil em `release/`: `npm run dist:win`.
Detalhes em [docs/DESKTOP.md](docs/DESKTOP.md). A versão web continua com `npm run dev`.

## Mundo unificado — Sunset Beach + TEST CITY

Os dois mapas viraram um só: o TEST CITY é o **bairro oeste** de Sunset Beach, ligado pela
Flamingo Street (pórtico "TEST CITY"), sem tela de carregamento. Trânsito, pedestres, polícia,
radar, salvamento e a Sala de teste funcionam nos dois bairros. O GLB original é só transladado
(arquivo intacto). Testes: `npm run test:merged` e `__NEON_TEST__.mergedSuite()`.
Detalhes em [docs/MUNDO_UNIFICADO.md](docs/MUNDO_UNIFICADO.md).

## NEON RADIO NETWORK — rádio nos carros, barcos, lojas e casas

Oito emissoras fictícias (NEON FM, GROOVE, THUNDER ROCK, STREET BEAT, OCEAN BREEZE,
TROPICAL CALIENTE, CITY TALK e MIDNIGHT JAZZ) com programação contínua: ao voltar para a
mesma estação, ela está em outro ponto da grade. Há DJs, vinhetas, comerciais e notícias
que reagem a perseguições e outros eventos. No veículo, o **scroll do mouse** abre a
roleta de rádios; depois de 2 s sem mexer, a estação destacada passa a tocar. Músicas e
vozes são originais, geradas pelo projeto (`npm run build:radio`). Volumes por canal em
**P → Configurações**. Testes: `npm run test:radio` e `__NEON_TEST__.radioSuite()`.
Detalhes em [docs/RADIO.md](docs/RADIO.md).

## NEON MOTORCYCLES — seis motos modeladas no Blender

Duas básicas (PALM RIDER 125, COAST STREET 250), duas customs (MIDNIGHT REBEL 750, IRON SERPENT 1100)
e duas esportivas (NEON BLADE 900R, PHANTOM X1000), geradas por `tools/blender/neon_moto` (.blend + .glb + LOD).
O protagonista monta com **E**, segura o guidão, apoia os pés nas pedaleiras (ou o pé no chão quando para)
e inclina o corpo junto com a moto nas curvas. As motos aparecem no trânsito com pilotos NPC, ficam
estacionadas em Sunset Beach e funcionam com garagens, saves, polícia e NEON CUSTOMS (pintura, luzes e mecânica).

Detalhes em [docs/NEON_MOTOS.md](docs/NEON_MOTOS.md).

## NEON MOTOR COMPANY — nove carros modelados no Blender

PALM COMPACT, BAY CITY 100, COAST WAGON (populares), METRO EXECUTIVE, OCEAN COUPE,
SUNSET TOURING (intermediários), NEON PHANTOM, AZURE GT-R e MIDNIGHT VORTEX (esportivos
de luxo). Um exemplar de cada fica estacionado em Sunset Beach, e os modelos circulam no
trânsito conforme a zona. Todos podem ser dirigidos, personalizados na NEON CUSTOMS e
guardados nas garagens. Fontes `.blend` em `assets-src/vehicles/`, GLBs em
`public/models/vehicles/`, gerador em `tools/blender/neon_motor/` (`npm run build:vehicles`).
Testes: `npm run test:neon` e, no jogo, `__NEON_TEST__.neonMotorSuite()`.
Detalhes em [docs/NEON_MOTOR.md](docs/NEON_MOTOR.md).

## IA de cidadãos, motoristas e passageiros

Pedestres possuem perfis, memória recente de perigos e decisões de caminhar,
visitar locais, observar, conversar, descansar e fugir. Motoristas e passageiros
aparecem nos assentos dos carros. Ao estacionar, podem sair pela porta, andar
pela rede de calçadas e retornar antes de o carro partir. Saídas bloqueadas
mantêm o ocupante no veículo.

Foram convertidos **40 perfis de parâmetros** de `data/pedstats.dat` do RAR
fornecido pelo usuário. A lógica da IA é implementada para este motor Three.js;
não é uma cópia do código-fonte nem de todo o comportamento do GTA Vice City.
O arquivo enviado contém executáveis e scripts compilados, sem os fontes da IA.
As animações continuam procedurais, sem conversão dos clipes IFP do GTA.

**F10** mostra o diagnóstico da cidade em desenvolvimento, incluindo ocupantes
sentados, andando, entrando e saindo. Teste: `npm run test:ai`.
Detalhes em [docs/IA_CIDADAOS.md](docs/IA_CIDADAOS.md).

## Objetos quebráveis

Postes, hidrantes, bancos, barracas, lixeiras, placas, parquímetros,
guarda-sóis, espreguiçadeiras, jardineiras e cabines telefônicas recebem
dano por tiros e se quebram com colisões de veículos suficientemente fortes.
As peças originais se soltam, giram e caem com gravidade. Hidrantes quebrados
soltam água temporariamente. Árvores e palmeiras de tronco grosso permanecem
sólidas. Há duas barracas no calçadão, em Sunset Beach e Lantern Point.

Não é necessário um novo comando: use as armas ou um veículo. Os objetos
quebrados permanecem destruídos até recarregar a página; destroços visuais
desaparecem gradualmente para controlar o custo de renderização.

Teste: `npm run test:destruction`. Detalhes em [docs/DESTRUICAO.md](docs/DESTRUICAO.md).

## Cidade expandida: Sunset Beach e Lantern Point

O mapa jogável agora segue 160 m ao norte até **Lantern Point**, conectado
a Sunset Beach pela Ocean Avenue, Coral Street, calçadão e praia. O bairro
tem duas novas ruas transversais, lojas, residências, hotéis e Lantern Gardens.
O HUD muda o nome do bairro ao atravessar a divisa.

O minimapa mostra ruas, construções e marcos (pontos dourados). **N** alterna
entre o mapa local e a visão geral da cidade, sempre com o norte para cima.
Para chegar ao bairro novo, siga para o norte pela Ocean Avenue ou pelo
calçadão, passando o antigo limite ao norte dos hotéis.

Validação: `npm run test:city`. Detalhes em [docs/EXPANSAO_CIDADE.md](docs/EXPANSAO_CIDADE.md).
As seções de fundação abaixo descrevem a primeira etapa do protótipo.

## Conteúdo da distribuição

O personagem padrão é o protagonista importado pelo usuário, em
`public/models/protagonist/protagonist.glb`, disponível no servidor local e no
build. O personagem procedural é mantido como fallback de carregamento.
Os pacotes GTA na raiz e os mapas de desenvolvimento não fazem parte do build.

O arsenal de nove armas continua disponível: **1–8** seleciona e saca,
**X** saca/guarda e **TAB** (segurar) abre a roleta de armas. A tecla **8** alterna as duas
carabinas. No início a Bren Ten está selecionada e guardada no coldre.

Aventura de ação em mundo aberto ambientada em uma cidade costeira fictícia dos anos 80.
**Etapa atual: Prompt 01**: fundação técnica, o bairro **Sunset Beach**, o protagonista animado e a câmera dupla (1ª/3ª pessoa).

A cidade, as armas, o céu, o oceano e o áudio são procedurais. O protagonista
usa o modelo importado pelo usuário. O jogo não depende de serviços externos.

## Executar

```bash
npm install
npm run dev        # servidor de desenvolvimento em http://localhost:5173
npm run build      # build de produção em dist/
npm run preview    # serve o build de produção
```

Parâmetro opcional: `?quality=low|medium|high`.

## Controles

| Tecla | Ação |
|---|---|
| W A S D | mover (relativo à câmera) |
| Shift | correr |
| Espaço | pular |
| Mouse | câmera (clique no jogo para travar o cursor) |
| V | alternar 1ª / 3ª pessoa |
| Esc | liberar o mouse |
| G | alternar qualidade gráfica |
| M | som liga/desliga |
| H | ocultar/mostrar ajuda |
| ` | estatísticas de desenvolvimento (FPS, draw calls, posição) |
| F8 | (somente `npm run dev`) em jogo: leva o protagonista de Sunset Beach ao bairro TEST CITY e de volta; na tela inicial: alterna para o TEST CITY isolado |

Atalhos combinados com Win/Alt (ex.: Win+G, Win+Shift+S) são ignorados pelo jogo.

A sensibilidade do mouse fica em `src/config.js` (`CONFIG.input.mouseSensitivity`).

## Estrutura

```
src/
  main.js                 ponto de entrada
  config.js               parâmetros centrais (jogador, câmera, gráficos, áudio)
  core/                   Game (loop/orquestração), Time, InputManager
  render/                 MaterialLibrary, StaticBatcher (fusão por material/bloco), texturas procedurais
  physics/                CollisionSystem (caixas orientadas, cilindros, rampas, spatial hash, sphere-cast)
  world/
    World.js              contêiner e registros (entidades, POIs, spawns, faixas de tráfego, vagas)
    CityGenerator.js      constrói um bairro a partir de dados
    districts/            SunsetBeach.js (dados de layout) + SunsetBeachDecor.js (regras de decoração)
    RoadNetwork.js        ruas, faixas com sentido, cruzamentos, faixas de pedestre, vagas
    RoadGenerator.js      asfalto, sinalização horizontal, calçadas com meio-fio
    BuildingGenerator.js  9 arquétipos Art Déco + variações procedurais
    buildings/            BuildingKit (primitivas/colisores locais) e ArtDecoParts (peças)
    PalmGenerator.js      palmeiras instanciadas com vento no shader
    PropGenerator.js      postes, bancos, lixeiras, guarda-sóis, placas, barreiras (instanciados)
    BeachGenerator.js     areia, muro com acessos, torres de salva-vidas com rampa
    Ocean.js              shader de oceano (ondas, espuma, fresnel, brilho do sol)
    Environment.js        céu procedural, sol/sombras, névoa, mapa de ambiente, presets de horário
    NeonSign.js           letreiros neon (CanvasTexture) e cintilação
    TrafficSignals.js     semáforos com ciclo de fases (estado consultável)
    Terrain.js            altura/superfície do terreno
  vehicles/               Vehicle (pivôs de carroceria/rodas, portas, colisor) e VehicleFactory
  player/                 Player, PlayerController (física), PlayerAnimator (procedural), CharacterModel
  camera/                 CameraManager, ThirdPersonCamera, FirstPersonCamera
  audio/                  AudioManager (ondas, brisa, cidade, passos por superfície)
  ui/                     HUD, StartScreen
  dev/                    TestHarness (somente em modo dev: window.__NEON_TEST__)
  styles/main.css
```

## Mapas de teste importados (modo dev)

Sunset Beach continua sendo o mapa do jogo. Para testar o pipeline de importação glTF/GLB:

```bash
npm run build:testmap
```

Gera `dev-maps/test-city/` e a cópia do jogo em `public/maps/test-city/` (conteúdo original): 16 quarteirões, praça elevada com escada e rampa,
colina, prédios girados, galeria com pilotis, beco de 3,5 m e objetos de calibração de escala.

- `http://localhost:5173/?map=test-city` inicia direto no mapa de teste.
- Na tela inicial: seletor "MAPA (DEV)" (TEST CITY isolado). Em jogo, o TEST CITY já é o bairro oeste do mundo; **F8** leva até ele.
- Carregamento com progresso, colisões geradas automaticamente, spawn seguro, descarga completa
  ao sair e mensagens de erro (o mapa atual continua ativo se o novo falhar).
- Nada disso existe no build de produção. Detalhes e convenções em [dev-maps/README.md](dev-maps/README.md).

Arquivos: `src/maps/` (MapManager, ImportedMap, HeightField), `src/ui/LoadingOverlay.js`,
`tools/test-map/` (gerador do mapa, gravador GLB e codificador PNG sem dependências).

## Testes automatizados (modo dev)

Com `npm run dev`, o console do navegador expõe `window.__NEON__` (jogo) e `window.__NEON_TEST__`:

```js
const T = __NEON_TEST__;
T.game.start();               // sai da tela de título
T.sim(2);                     // avança 2 s de simulação em passos fixos
T.place(46, 30, 0);           // teleporta o jogador (x, z, yaw da câmera)
T.down('KeyW'); T.sim(1); T.up('KeyW');
T.tap('KeyV');                // alterna a câmera
T.pos();                      // posição atual
```
