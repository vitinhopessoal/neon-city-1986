# NEON MOTORCYCLES (PROMPT 15)

Seis motocicletas originais, modeladas por código no **Blender 5.3** (`tools/blender/neon_moto`) e integradas ao
mesmo sistema de veículos do jogo: física, câmera, danos, trânsito, polícia, garagens, saves e NEON CUSTOMS.
Nenhum modelo, textura, som ou logotipo de terceiros: todas as formas, nomes e cores são próprios.

## Os modelos

| Moto | Categoria | Motor | Visual | Triângulos | LOD | 0→4 s | Vel. máx. (pista) |
|---|---|---|---|---|---|---|---|
| PALM RIDER 125 | Básica | monocilíndrico | vermelha/branca, banco simples, guidão reto, rodas raiadas | 9 354 | 2 765 | 56 km/h | 103 km/h |
| COAST STREET 250 | Básica | bicilíndrico | azul/prata, banco duplo com alça cromada, escapes duplos | 10 290 | 3 048 | 65 km/h | 119 km/h |
| MIDNIGHT REBEL 750 | Custom | V2 | preta/dourada, guidão puxado, rodas douradas, comandos avançados | 17 798 | 5 338 | 73 km/h | 132 km/h |
| IRON SERPENT 1100 | Custom (chopper) | V2 grande | vinho/preta, garfo longo, guidão ape, encosto (sissy bar) | 15 998 | 4 742 | 71 km/h | 133 km/h |
| NEON BLADE 900R | Esportiva | 4 em linha | branca/vermelha/azul, carenagem integral, faróis retangulares duplos | 16 090 | 4 820 | 117 km/h | 197 km/h |
| PHANTOM X1000 | Esportiva (superbike) | 4 em linha | preta/dourada, carenagem angulosa, rodas douradas | 15 786 | 4 726 | 131 km/h | 218 km/h |

Metas do prompt: básicas 6–12 mil, customs 10–18 mil, esportivas 12–22 mil triângulos (todas dentro). A "vel. máx." é a
maior medida na pista de testes de ~430 m (as esportivas não chegam ao limite de 223/252 km/h nessa distância; o teste
confere que nunca passam do limite). Folhas de render (6 vistas): `docs/screenshots/neon-moto/*.jpg`.

Arquivos: `assets-src/motorcycles/*.blend` (fonte editável), `public/models/motorcycles/*.glb` e `*_lod1.glb`.
Hierarquia de cada GLB: `MotorcycleRoot` → `Frame`, `Engine`, `FuelTank`, `Seat`, `Exhaust`, `Bodywork`, `Lights`,
`Plate_R`, `FrontFork` (pivô na caixa de direção, inclinado pelo rake) → `FrontForkMesh`, `FrontWheel` (`Tire_F`, `Rim_F`),
`Grip_L/R`; `Swingarm` (pivô da balança) → `SwingarmMesh`, `RearWheel` (`Tire_R`, `Rim_R`); âncoras `Rider_Hip`, `Peg_L/R`.
Animações no GLB: `Steer`, `Suspension`, `FrontWheel_Spin`, `RearWheel_Spin`.

## Pilotando (protagonista visível, sem esconder)

- **Montar**: perto do lado esquerdo, o aviso mostra "PRESSIONE E PARA MONTAR". O protagonista vai até a moto, segura o
  guidão e passa a perna direita por cima do banco. **Descer**: E abaixo de 7 km/h (ele sai pelo lado livre).
- **Mãos nas manoplas** (IK de dois ossos); o guidão gira no eixo de direção e uma mão avança enquanto a outra recua.
  O tronco inclina o mínimo necessário para o braço do modelo GLB alcançar o guidão.
- **Pés nas pedaleiras** em movimento; **parado, o pé esquerdo vai ao chão** e a moto pende levemente para esse lado.
  Em bancos altos (esportivas) o quadril desliza alguns centímetros para o lado do pé, como na vida real.
- **Postura por estilo** (medida no jogo): básicas ~18–19° à frente, customs reclinadas/retas com pés à frente,
  esportivas 45–48° deitadas sobre o tanque.
- **Curvas**: a moto inclina pelo ângulo de equilíbrio (atan(v·ω/g)), limitado por modelo (23° na chopper, até 44° na
  superbike), e o corpo inteiro do piloto acompanha; nas esportivas o tronco "pendura" um pouco mais e a cabeça compensa
  parte da inclinação (olhar no horizonte).

Controles: W/S/A/D, E, V (câmera), Q (buzina), R (recuperar), Espaço (freio traseiro). Ver `docs/CONTROLES.md`.

## Física (`MotorcyclePhysics` estende `VehiclePhysics`)

O modelo de bicicleta dos carros já é o de uma moto; a extensão acrescenta:

- solo sob as duas rodas (arfagem pelo desnível, sem rolagem lateral);
- inclinação com taxa por categoria (básicas 2,6 rad/s, customs 2,0, esportivas 3,2);
- **equilíbrio arcade**: a guinada segue a geometria da direção, limitada pela aderência e pela inclinação máxima, e o
  deslizamento lateral é amortecido. Sem isso, uma troca brusca de direção a ~60 km/h fazia a chopper rodar (encontrado
  no teste isolado e corrigido). O freio traseiro (Espaço) ainda permite derrapar;
- a moto nunca cai sozinha: parada fica em pé com o piloto e, sem piloto, descansa no cavalete lateral;
- ré só "empurrando com os pés" (até ~1,4 m/s), e só depois de parar.

`MotorcycleAnimation` (estende `VehicleAnimation`): inclinação da raiz em torno do contato dos pneus, garfo girando no
eixo de direção, compressão do garfo ao frear/aterrissar, balança acompanhando o desnível, rodas girando (freio traseiro
trava a traseira), farol, lanterna e luz de freio.

## Integração com o resto do jogo

- **Trânsito**: as motos entram no mesmo sorteio dos carros (pesos por zona): básicas comuns, customs menos frequentes,
  esportivas raras (peso total 0,170 / 0,065 / 0,030; esportivas ×2,2 no bairro nobre e nas boates). Usam a IA de
  trânsito existente (sem IA separada). Pilotos NPC com pose de pilotagem (pernas abertas até as pedaleiras, mãos no
  guidão, pé no chão parado); no modo cinemático distante a moto também inclina nas curvas.
- **Vitrine**: uma de cada estacionada em Sunset Beach, duas por vaga: básicas nas ruas internas, customs perto das
  boates e esportivas perto dos hotéis.
- **Polícia**: montar/descer não altera o nível de procurado (testado 1 → 1 → 1); a polícia aborda pela "porta" da moto.
- **Garagens e saves**: genéricos (testado guardar/retirar uma moto personalizada e salvar/carregar as seis).
- **NEON CUSTOMS**: só onde há ponto de montagem — pintura e acabamento, faróis/lanternas e as melhorias mecânicas
  (motor, freios, transmissão, suspensão, resistência). Rodas, pneus, altura, peças de carroceria, película, interior e
  faixas ficam nas opções originais.
- **Rádio**: motos não têm rádio; o scroll não abre a roleta enquanto se pilota (a regra do zoom a pé não muda).
- **Áudio**: o motor procedural existente ganhou pulsação por tipo — monocilíndrico "toc-toc", bicilíndrico, V2
  irregular, 4 em linha liso e agudo — e buzina mais aguda nas motos. O som dos carros não mudou.
- **Danos**: o mesmo sistema dos carros (integridade, pintura que escurece, farol quebrado).
- **LOD**: além de 45 m da câmera a moto troca para a malha única dizimada (~30% dos triângulos).

## Correção encontrada durante os testes (não era das motos)

Ao medir quadros escuros, entrar num **carro** também gerava ~7 quadros totalmente pretos (e andar a pé, 1): em
algumas poses do protagonista GLB uma normal virava vetor nulo, `normalize(0)` dava NaN e o bloom espalhava o NaN
pela tela inteira. Corrigido no shader do material do protagonista (normal nula → valor seguro). Depois: 0 quadros
escuros em 270 quadros por veículo (carro e motos).

## Testes executados

- **In-game** `await __NEON_TEST__.motoSuite()`: 25 testes por moto (modelo e LOD, hierarquia, dimensões, triângulos,
  rodas no chão, cavalete, aviso de montar, montar com E, mãos no guidão, pé no chão parada, pés nas pedaleiras,
  postura do estilo, aceleração, velocidade máxima, inclinação à direita/esquerda, endireitar, corpo acompanhando, garfo
  e rodas, freio + suspensão, ré só parada, colisão e danos, câmeras, áudio sem rádio, desmontar + cavalete + procurado
  mantido) + 7 globais (frequência no trânsito, pilotos NPC, vitrine, personalização limitada, garagem, salvamento,
  console sem erros). Resultado: **157/157** em três execuções consecutivas com o código final (lotes validados
  antes: básicas 51/51, customs 51/51 após ajuste dos pedais da chopper, esportivas 51/51).
- **Node** `npm run test:moto`: 5/5 (especificações, GLB/LOD, integração, NEON CUSTOMS, física isolada).
- **Regressões**: NEON MOTOR (carros) 153/153, OCEAN DRIVE (barcos) 45/45, NEON RADIO 32/32; Node: neon 4, rádio 6,
  city 8, assets 2, hud 6, police 20, ai 9, ocean 5, customs 3, destruction 10 — todos passando; build de produção OK.
  Interior (pizzaria) entra/sai, protagonista anda/corre e a HUD aparece normalmente.

Medidas do piloto no jogo (distância entre o osso do GLB e a âncora do modelo): quadril 0,5–10 cm, pulsos 11–14 cm das
manoplas (o pulso fica antes da palma), tornozelos 7–11 cm das pedaleiras.

## Capturas do jogo

`docs/screenshots/neon-moto/game/`: parada com o pé no chão (Palm Rider), pilotando a Coast Street, a Midnight Rebel
e a Iron Serpent, postura esportiva (Neon Blade), curva inclinada (Phantom), piloto NPC no trânsito e a câmera de jogo
com HUD.

## Limitações conhecidas

- A moto não derruba o piloto em colisões (o prompt pede equilíbrio arcade sem quedas constantes); batidas causam dano.
- O jogador pilota sozinho: a garupa existe no modelo (banco duplo), mas passageiros não foram implementados.
- O cavalete lateral é uma peça fixa recolhida; estacionada, a moto apenas pende para o lado dele.
- No modo cinemático distante do trânsito a inclinação é estimada pela curva da rota (sem física).
