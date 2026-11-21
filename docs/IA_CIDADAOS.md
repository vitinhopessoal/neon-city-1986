# IA de cidadãos e ocupantes de veículos

## O que veio do material fornecido

O arquivo `GTA-VC.rar` fornecido pelo usuário tem 218.505.205 bytes e 268
entradas, incluindo diretórios. A listagem confirmou `gta-vc.exe`, arquivos
de dados e `data/main.scm` compilado. Não foram encontrados arquivos-fonte
`.c`, `.cpp`, `.h`, `.hpp`, `.js`, `.cs` ou `.lua` no pacote.
Nenhum executável do jogo ou instalador foi executado.

`data/pedstats.dat` foi lido e convertido em 40 perfis para
`src/city/data/PedStats.js`. O conversor valida nove campos numéricos de cada
registro. A informação de aparência/atratividade não é usada nem exportada.
O hash no módulo identifica o texto local usado pelo conversor, após extração
em UTF-8, e não o arquivo RAR completo.

| Parâmetro de origem | Integração nesta entrega |
|---|---|
| Distância de fuga | Extensão solicitada para a rota de fuga na rede própria |
| Taxa de mudança de direção | Suavização da orientação ao caminhar |
| Medo | Sensibilidade a tiros, danos próximos e arma apontada |
| Temperamento | Irritação, gesto de protesto, frequência e impaciência da buzina |
| Respeito às regras | Distância de seguimento e comportamento diante do amarelo |
| Flag de pânico com armas | Sensibilidade adicional ao ouvir disparos |
| Força de ataque, fraqueza defensiva e outras flags | Preservadas como dados; sem aplicação a combate nesta entrega |

`pedgrp.dat` foi consultado para entender a separação de grupos por região.
Seus identificadores de modelos não foram usados: não correspondem aos modelos
procedurais deste jogo. Os caminhos do GTA também não são caminhos válidos para
a cidade atual. As rotas continuam derivadas de Ocean Avenue, Coral Street,
Lantern Lane, Beacon Street e demais vias/calçadas realmente construídas.

Isso é reaproveitamento de parâmetros fornecidos pelo usuário, acompanhado
de uma implementação compatível com Three.js. Não houve extração do código
do executável, cópia de um motor de IA completo ou execução do `main.scm`.

## Pedestres a pé

Cada cidadão recebe um `CitizenBrain`, um perfil coerente com seu estilo,
características individuais de passada e sociabilidade, fadiga, atenção, medo,
irritação e uma memória limitada às oito ocorrências recentes, por até 30 s.

Os estímulos têm alcance. Arma apontada exige visão desobstruída e orientação
do jogador para o pedestre. Sons podem ser percebidos sem linha de visão,
com intensidade reduzida. O medo varia por perfil, decai com o tempo e não é
um estado global compartilhado por toda a população. Eventos repetidos em
intervalos muito curtos são filtrados.

Ao terminar uma caminhada, o pedestre escolhe entre continuar, ir a um ponto
de interesse alcançável, conversar com alguém próximo ou procurar um banco.
Conversas têm orientação do corpo, gestos e movimentos da cabeça. Rotas para
pontos de interesse são buscas na rede de calçadas, sem saltar componentes
desconectados. A visita termina no acesso externo: não há entrada em interiores.

O sistema anterior de atravessar na faixa, esperar semáforo/brecha, desviar,
fugir, cair após atropelamento e se levantar foi preservado. Caminhada, corrida,
conversa e direção usam animação procedural; nenhuma animação IFP foi convertida.

## Motoristas e passageiros

Cada carro de trânsito recebe um motorista visível, com possibilidade de
passageiro no banco dianteiro. O primeiro carro com assento disponível inclui
passageiro; nos demais, a chance é 35%. As pessoas seguem a transformação da
carroceria, incluindo suspensão, inclinação e posição real do assento. Braços
do motorista acompanham o esterçamento; cabeças têm movimento de observação.
Ocupantes sentados são ocultados quando o carro usa seu impostor distante.

Motoristas mantêm personalidade e memória. Planejam destinos na rede de
faixas e seguem trajetos alcançáveis entre cruzamentos. Continuam usando
IDM, comandos da mesma física do jogador, semáforos, PARE, preferência em
conversões, travessias ocupadas, buzina, vagas e recuperação de congestionamento.
Uma batida forte pode gerar frenagem e abandono do veículo depois de parar.

Ao estacionar:

1. Verificam porta, espaço, obstáculos, água e ligação até a calçada.
2. Abrem a porta, interpolam do assento até o ponto de saída e se levantam.
3. Caminham pela rede existente, podendo esperar para atravessar.
4. Retornam, reservam o assento, entram, sentam e fecham a porta.
5. O carro só sai quando os ocupantes retornaram e há espaço para incorporar
   à faixa. Se não houver uma saída segura, a pessoa permanece sentada.

Uma pessoa fora do carro não desaparece quando o jogador assume o veículo
estacionado. Assentos ainda ocupados são reservados para evitar duas pessoas
no mesmo lugar. Passageiros que permanecem sentados podem continuar no carro
quando o jogador assume o volante. Trocar o mapa libera os slots da população
anterior para evitar duplicação. Pessoas e carros são reciclados com limites
de população; o estado não é persistido entre recarregamentos.

## Limites desta implementação

Não é uma reprodução exata de Vice City. Não foram implementados nesta entrega
polícia/procura, facções de gangues, combate de NPCs, missões de ambulância,
rotinas de todas as profissões, assalto a carros ocupados ou reprodução dos
scripts e das animações originais. Os 40 registros importados não significam
que 40 profissões completas estejam implementadas. Perfis não associados a um
visual/atividade atual permanecem disponíveis como dados para novas funções.

Não há consciência, modelo de linguagem ou serviço externo: decisões são regras,
estados, memória temporária e busca em grafos. Veículos/pessoas evitam situações
inválidas pelas regras existentes, sem garantia de navegação perfeita em toda
configuração futura de mapa. Saídas sem caminho seguro não são forçadas.

## Arquivos e testes

| Arquivo | Responsabilidade |
|---|---|
| `tools/ai/import-pedstats.mjs` | Validação e conversão da tabela fornecida |
| `src/city/data/PedStats.js` | Perfis de parâmetros convertidos |
| `src/city/CitizenBrain.js` | Percepção, memória, emoção e seleção de atividade |
| `src/city/Navigation.js` | Caminhos alcançáveis para calçadas e faixas de veículos |
| `src/pedestrians/PedestrianManager.js` | Decisão e navegação dos pedestres a pé |
| `src/pedestrians/PedestrianRenderer.js` | Animação articulada e transformação relativa a assentos |
| `src/traffic/VehicleOccupants.js` | Pessoas nos carros, saída, caminhada e retorno |
| `src/traffic/TrafficVehicleAI.js` | Personalidade, cérebro do motorista e trajetória planejada |
| `src/traffic/TrafficManager.js` | Destinos, circulação, estacionamento e reações |
| `src/vehicles/VehicleInteraction.js` | Proteção dos assentos ocupados durante interação do jogador |

`npm run test:ai` executa nove testes: importação, perfis/sentidos, memória e
recuperação do medo, motivos e alcance das rotas, transformações dos ocupantes,
ciclo de sair/voltar, bloqueio seguro, apropriação de carro vazio sem apagar o
motorista anterior e simulação de 20 segundos da cidade completa com física,
pedestres, motoristas, passageiros, tiro e colisão forte. O diagnóstico F10
inclui contagens e estados dos ocupantes.

Os testes de simulação usam os módulos reais, com Canvas2D substituído para
rodar sem navegador. Eles verificam estados, posições, matrizes e integrações,
sem validar pixels, qualidade visual, som ou FPS. O build e as demais suítes
de cidade, destruição, protagonista e armas também devem passar.
