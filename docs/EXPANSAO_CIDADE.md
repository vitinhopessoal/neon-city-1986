# Expansão da cidade e navegação

## Entrega

Lantern Point prolonga o cenário costeiro 160 m ao norte de Sunset Beach,
sem tela de carregamento na divisa. É um layout procedural novo, construído
com os geradores existentes e sem incorporar modelos, texturas ou posições
dos pacotes GTA. Os nomes, estabelecimentos e composição foram definidos
para esta expansão.

| Elemento | Antes | Agora |
|---|---:|---:|
| Extensão jogável norte–sul | 340 m | 500 m |
| Área retangular delimitada | 88.400 m² | 130.000 m² |
| Definições de trechos viários | 4 | 8 |
| Cruzamentos | 2 | 6 |
| Faixas de pedestres | 9 | 23 |
| Entradas de construção, incluindo pontos de ônibus | 45 | 62 |

Novos locais: Lantern Suites, Beacon House, Afterglow Cafe, Signal Radio,
Night Owl Video e Lantern Gardens. A expansão acrescenta 16 prédios/casas/lojas,
um ponto de ônibus, uma torre de salva-vidas e três acessos à praia.

Os edifícios, veículos estacionados, ruas e spawn inicial de Sunset Beach
foram mantidos. A antiga parede e as barreiras ao norte foram deslocadas ao
novo limite em Z = -330. Lantern Lane e Beacon Street têm cruzamentos com
PARE em todos os acessos e barreiras nas pontas ocidentais externas.

## Explorar

Inicie como antes com `npm run dev`. Do spawn no calçadão, siga para o norte
(Z decrescente). A divisa entre os bairros fica em Z = -170. Também é possível
usar a Ocean Avenue ou Coral Street de carro. O HUD identifica o bairro atual.

O minimapa aparece à esquerda. **N** alterna mapa local / mapa geral. A seta
ciano indica o jogador e sua orientação; pontos dourados indicam marcos.
O norte permanece para cima e a escala de 50 m adapta-se ao zoom. As plantas
das construções são esquemáticas; o mapa não calcula uma rota GPS.

Mapas de teste importados também usam o painel quando fornecem bounds e roads
no manifesto; sem esses dados ele fica oculto. F8 continua alternando os mapas
de desenvolvimento, sem conflito com a tecla N.

## Integração

| Arquivo | Responsabilidade |
|---|---|
| `src/world/districts/LanternPoint.js` | Construções, praça, superfícies, spawns e decoração do novo bairro |
| `src/world/districts/CoastalCity.js` | Composição dos dois bairros, lajes recortadas, cruzamentos e litoral compartilhado |
| `src/world/World.js` | Carregamento da composição, limites e consulta do bairro |
| `src/world/CityGenerator.js` | Fundo distante deslocado para fora do novo limite norte |
| `src/world/RoadGenerator.js` | Prioridade das superfícies sobrepostas, como caminhos da praça |
| `src/traffic/TrafficManager.js` | Limites totais para a rede de trânsito |
| `src/config.js` | Caminhos de pedestres no litoral ampliado e na praça |
| `src/ui/Minimap.js` | Desenho Canvas2D derivado dos dados da cidade, atualização até 10 Hz |
| `src/core/Game.js` | Navegação e mudança do nome do bairro durante a exploração |
| `src/core/InputManager.js` | Tecla N para o mapa |
| `src/styles/main.css` | Painel de navegação e posicionamento do HUD |

Os bairros são gerados juntos, compartilhando geometria fundida, vegetação
instanciada, rede de colisões e rede viária. Isso evita duplicar o oceano,
as ruas e os limites na divisa. O identificador de mapa `sunset-beach` continua
compatível com a seleção existente. O spawn inicial continua no bairro original.

## Verificação e limites

`npm run test:city` executa oito testes: preservação dos dados existentes,
altura de todas as faixas de circulação dentro dos limites, alcance das rotas
entre os bairros, abertura da antiga divisa e fechamento do novo limite,
prioridade dos caminhos da praça, construção dos novos modelos e liberação
das pistas, identificação do bairro e desenho do minimapa nos dois modos e
em manifestos importados. As texturas e o Canvas são substituídos nesses
testes; eles não validam a aparência dos pixels nem o comportamento WebGL.

O build de produção foi gerado com sucesso. A inspeção visual e o teste manual
de direção no navegador ficaram pendentes porque o controle do navegador foi
interrompido ao não conseguir confirmar a URL. Não foi medido o FPS da expansão.

Esta entrega mantém os dois bairros em memória. Carregamento por regiões,
novos tipos de terreno, pontes, interiores, missões e navegação por rotas não
foram implementados. Os pacotes GTA compactados continuam fora do build.
O protagonista fornecido pelo usuário foi posteriormente restaurado como
padrão, conforme [PROTAGONISTA.md](PROTAGONISTA.md).
