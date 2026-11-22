# Mecânica veicular (motor, câmbio, largada, nitro, tração e freios)

Integração do pacote `Mecanica-Veicular-entrega.zip` nos 12 carros jogáveis, com as partes que o
pacote deixou só documentadas completadas por código autoral do Neon City. Todo o código é JavaScript
próprio: o jogo não usa nenhum executável, modelo, textura, som ou dado de outro jogo. Os números de
cada carro foram escolhidos e calibrados nos testes do próprio jogo.

## O que mudou ao dirigir

- **Motor**: cada carro tem uma curva de torque (motores de torque baixo nos V8, de giro alto nos
  4 cilindros e no V12). O RPM acompanha as rodas, há limitador no corte e freio-motor através da
  marcha: as marchas curtas seguram mais, e o automático segura menos que o manual.
- **Câmbio automático e manual**: as relações mudam de verdade a força nas rodas. Cada troca corta a
  força por 0,16–0,32 s, conforme o modelo. Há neutro e ré.
- **Largada**: com o carro parado, segure **ESPAÇO + W**. O giro sobe devagar e a luz LARGADA do painel
  fica verde na faixa boa; solte o ESPAÇO nesse momento. O painel avisa se a largada foi perfeita, com
  giro baixo ou com giro alto.
- **Aviso de troca** (manual): TROCA PERFEITA perto do ponto ideal (a interrupção cai ~45%), TROCA CEDO
  ou TROCA TARDE. A luz TROCA do conta-giros acende no ponto ideal.
- **Nitro**: segure SHIFT com o pedal no fundo. O tanque esvazia em 5–7,7 s, conforme o kit, e o painel
  mostra a reserva.
  - **Recarga**: dirigindo acima de ~80 km/h, derrapando de lado ou saindo da oficina (enche o tanque).
  - **Onde rende**: em marchas curtas a força já passa do limite dos pneus, então o nitro rende mais em
    velocidade, quando o limite é o motor.
- **Turbo** (BAY CITY 100 e AZURE GTR): a pressão sobe com atraso acima de ~3000 RPM, aparece no painel
  e no som (assobio) e alivia com um "psst" ao soltar o pedal.
- **Temperatura**: bater no limitador, usar nitro e giro alto aquecem o motor. Superaquecido, ele perde
  30% da força e o nitro bloqueia até esfriar.
- **Tração e pneus**:
  - **Peso nos eixos**: o peso passa para trás ao acelerar e para a frente ao frear.
  - **Limite por eixo**: cada eixo motriz tem o seu limite de aderência; o que passar disso faz a roda patinar.
  - **Patinação**: a roda patina com inércia própria; o motor sobe de giro e o asfalto fica marcado.
  - **Curvas**: acelerar ou frear forte numa curva tira aderência lateral (círculo de atrito).
- **Tração por carro**: há modelos FWD, RWD e AWD, com centro de gravidade, altura e viés de freio próprios.
  - **FWD**: os compactos sobem de frente quando passam do limite.
  - **RWD**: os muscle cars soltam a traseira.
  - **AWD**: o AZURE GTR, integral e turbo, é o que sai mais forte.
- **Assistências** (luzes TCS e ABS no painel):
  - **Automático**: controle de tração completo.
  - **Manual**: controle "esportivo", que deixa escorregar ~1,5 m/s.
  - **Pedal de freio**: tem ABS, freia no limite do pneu sem travar.
  - **Freio de mão**: trava as traseiras de verdade.
- **Direção**: continua a do jogo, sensível à velocidade (menos esterço em alta). O núcleo do pacote
  também calcula uma direção, mas ela não é aplicada, para não esterçar duas vezes.

## Controles (no carro)

| Tecla | Ação |
|---|---|
| W / S | Acelerar / frear; parado, S engata a ré |
| A / D | Esterçar |
| ESPAÇO | Freio de mão · parado + W: preparar largada |
| SHIFT | Nitro (segurar) |
| B | Câmbio automático ↔ manual (preferência salva) |
| X / Z | Subir / reduzir marcha no manual. Parado, Z engata N e depois R; em R, o S dá ré e o W volta à 1ª |
| Q · R · V · E | Buzina · recuperar · câmera · sair (sem mudança) |

SHIFT (correr) e X (guardar arma) são usados só a pé; no carro viram nitro e marcha, como já acontecia
com o R. O painel do carro e a ajuda (H) mostram as teclas.

## Oficina (NEON CUSTOMS → Performance)

As melhorias existentes valem para a mecânica nova, sem recalcular duas vezes:

| Melhoria | Efeito |
|---|---|
| Motor | Aumenta o torque da curva |
| Transmissão | Encurta as relações (mais força em cada marcha) |
| Freios | Aumentam a força de frenagem, até o limite do pneu |
| Suspensão | Aderência e estabilidade |
| Blindagem | Massa |

A calibração parte sempre do carro de fábrica (`SPECS`).

Nova categoria **Nitro** (só carros; motos não aceitam):

| Kit | Preço | Torque extra | Duração do tanque cheio |
|---|---|---|---|
| Garrafa de série | – | +35% | 5 s |
| Kit Street | $1.400 | +50% | 6,3 s |
| Kit Competição | $3.200 | +70% | 7,7 s |

O kit fica salvo com as outras peças.

## Quem calcula o quê

| Parte | Onde |
|---|---|
| Curva de torque, RPM, limitador, freio-motor, câmbio, corte, N/R, largada, nitro, turbo, calor | `src/vehicles/mechanics/controller.mjs`: núcleo do pacote + turbo, calor e troca avaliada (autorais) |
| Conversão do manuseio do Neon (faixas em m/s → relações), calibração por potência, regras do jogo (recarga do nitro, largada, automático que pula marchas, conversor) | `src/vehicles/mechanics/neon-adapter.mjs` |
| Tração, peso, centro de gravidade, curva de torque e turbo de cada carro | `src/vehicles/mechanics/drivetrains.js` |
| Transferência de carga, limite por eixo, patinação com inércia, TCS, ABS, freio de mão, círculo de atrito, direção, colisões, solo | `src/vehicles/VehiclePhysics.js` (passo fixo de 1/120 s, interpolação visual mantida) |
| Painel, sons, teclas, oficina | `VehicleHUD.js`, `VehicleAudio.js`, `InputManager.js`/`VehicleController.js`, `customization/*` |

O módulo é anexado quando o jogador liga o motor de um carro (`VehicleManager.attachPowertrain`) e
fica com o carro: o câmbio e a reserva de nitro continuam quando ele volta. Carros do trânsito e da
polícia (`driver` 'ai'/'police') seguem no modelo arcade original, inclusive um carro do jogador
que a IA venha a dirigir. Motos e barcos mantêm a física própria.

### Calibração

As faixas de marcha do Neon (`handling.gears`, em m/s) viram reduções totais: no fim de cada faixa o
motor chega ao corte. O torque máximo dá ao carro a mesma potência de pico do modelo arcade de
fábrica, com a força da 1ª nunca abaixo da força de fábrica. Resultado medido em pista reta
(`node --test tools/vehicles/mechanics-neon.test.mjs` e bateria no jogo):

- **Aceleração**: os 0–100 km/h ficam perto dos antigos. O AWD sai mais rápido; os RWD potentes são
  limitados pelo pneu traseiro.
- **Velocidade máxima**: agora é o fim da última marcha, o mesmo `maxSpeed` da ficha. Antes o modelo
  arcade ficava ~10% abaixo dela.
- **Frenagem**: fica no limite do pneu (100→0 em ~34–48 m). O modelo antigo freava acima da aderência.

## Testes

- `npm run test:mechanics`: 34 testes em três arquivos.
  - Núcleo do pacote (13).
  - Integração do pacote (6), adaptada à tração nova e às motos.
  - Testes novos do Neon (15): todos os carros, motor, freio-motor, trocas, N/R, ré, largada, nitro,
    turbo, calor, tração FWD/RWD/AWD, ABS e freio de mão, direção, oficina, trânsito arcade e passo
    fixo em 30/60/144 quadros por segundo.
- No jogo, `await __NEON_TEST__.mechanicsSuite()`: 19 testes com as teclas de verdade.
  - **Dirigir**: entrar, acelerar, trocas, frear, virar, ré, manual com B/X/Z, neutro, largada pela luz verde e nitro.
  - **Físicas**: freio de mão, oficina, colisão e dano, câmera e saída.
  - **Outros veículos**: três carros diferentes, moto sem módulo.
  - **Sistema**: passo fixo, trânsito intacto e console sem erros.

## Limitações conhecidas

- **Suspensão**: a transferência de carga entra na aderência, mas a suspensão vertical continua visual
  (`VehicleAnimation`). Não há mola progressiva, barra estabilizadora nem transferência lateral por roda.
- **Diferencial**: não há diferencial físico; a divisão AWD é fixa.
- **Pneus**: a patinação é por eixo, não por roda.
- **Inércias**: são estimadas.
- **Calibração**: a sensação foi ajustada por medições do próprio jogo. Não houve comparação com
  telemetria de outro jogo, e os números do pacote não são calibrações recuperadas.
- **Teclado**: o pedal no teclado é quase tudo ou nada. Por isso há controle de tração no automático e
  uma rampa de giro na preparação de largada.
- **Massa**: a massa extra da blindagem não recalcula a inércia de guinada, limitação anterior a esta integração.
- **Nitro**: a reserva não é salva no arquivo de jogo; o kit, sim.

Capturas: `docs/screenshots/mecanica/` (painel com nitro e turbo a 153 km/h; preparação de largada com a luz verde).
