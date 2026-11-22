# NEON CITY: 1986 — Controles

O mapeamento de teclas fica centralizado em `src/core/InputManager.js`:

- `DEFAULT_BINDINGS`: ação → teclas (`KeyboardEvent.code`).
- `ACTION_INFO`: descrição e contexto de cada ação.
- `bindingLabel(ação)`: rótulo usado pelo HUD. Trocar uma tecla em `DEFAULT_BINDINGS` atualiza a ajuda, o painel do carro e a indicação de interação.
- `bindingConflicts()`: lista teclas usadas por mais de uma ação.

## A pé

| Tecla | Ação |
|---|---|
| W / ↑ | Andar para frente |
| S / ↓ | Andar para trás |
| A / ← | Esquerda |
| D / → | Direita |
| Shift | Correr |
| Espaço | Pular |
| E | Entrar no veículo (perto da porta, até 1,5 m) ou no estabelecimento (porta a até 1,9 m, de frente) — vale o mais próximo |
| Mouse | Olhar / orbitar a câmera |
| 1–8 | Selecionar arma (8 alterna entre as duas carabinas) |
| Roda do mouse | Próxima / anterior arma |
| TAB (segurar) | Roleta de armas: mova o mouse até a arma (ou use a roda / 1–8) e solte o TAB (ou clique) para equipar; "Desarmado" guarda a arma. O tempo desacelera enquanto ela está aberta |
| X | Sacar / guardar arma |
| Mouse esq. | Disparar (segurar nas automáticas) |
| Mouse dir. | Mirar (sobre o ombro / alinhar a mira em 1ª pessoa) |
| R | Recarregar (só com arma sacada) |

## Dentro de estabelecimentos

| Tecla | Ação |
|---|---|
| E | Interagir com o ponto indicado no aviso: falar, pedir, abrir/fechar porta, sentar/levantar, comer, chamar elevador, sair |
| 1–9 | Escolher opção no painel de diálogo/compra (com o painel aberto não troca de arma) |
| E / Esc | Fechar o painel |
| W A S D / Shift | Andar e correr normalmente (sem dirigir dentro) |

Sentado, em transição de porta/elevador ou com o painel aberto, não é possível mirar nem disparar.

## NEON CUSTOMS (personalização)

| Entrada | Ação |
|---|---|
| Mouse (arrastar no cenário) | Girar a câmera ao redor do carro |
| Roda do mouse | Aproximar / afastar |
| Botões FRENTE, TRASEIRA, LATERAL, RODAS, INTERIOR, LIVRE | Ângulos predefinidos |
| Clique numa opção | Prévia (não cobra) · COMPRAR confirma · CANCELAR PRÉVIA restaura |
| Esc ou SAIR DA OFICINA | Sair (prévia não comprada é descartada) |

## Dirigindo

| Tecla | Ação |
|---|---|
| W / ↑ | Acelerar (freia antes, se estiver em ré) |
| S / ↓ | Frear; parado, engata a ré |
| A / ← · D / → | Esterçar |
| Espaço | Freio de mão |
| Q | Buzina |
| R | Recuperar veículo preso (só quando necessário; intervalo de 8 s) |
| E | Sair do veículo (abaixo de 7 km/h) · na vaga rosa da NEON CUSTOMS, parado: personalizar |
| Mouse | Olhar ao redor (volta sozinho para trás do carro) |

## Pilotando um barco (OCEAN DRIVE)

| Tecla | Ação |
|---|---|
| W / ↑ | Acelerar |
| S / ↓ | Ré; andando para a frente, funciona como freio (hélice invertida) |
| A / ← · D / → | Leme (o barco inclina na curva) |
| Shift | Potência extra (+12% de empuxo) |
| Q | Buzina marítima |
| V | Câmera de perseguição ↔ visão do piloto |
| Mouse | Orbitar a câmera (volta para trás do barco após ~2 s parado) |
| E | Sair do barco (abaixo de 14 km/h): desce no píer, praia ou ilha se houver chão ao lado; senão, cai na água nadando |

## Nadando

| Tecla | Ação |
|---|---|
| W A S D | Nadar (2,0 m/s) |
| Shift | Nadar rápido (3,1 m/s) |
| Espaço | Junto a um píer ou convés baixo: subir para fora da água (também com água no peito) |
| E | Perto do casco de um barco: embarcar |

Na água não há pulo nem armas. O nado começa onde o fundo passa de 1,3 m e termina quando o pé volta a tocar o chão (1,18 m).

## Em qualquer contexto

| Tecla | Ação |
|---|---|
| V | Alternar 1ª / 3ª pessoa (a pé ou no carro) |
| P | Menu do jogo: salvar, carregar, propriedades, inventário, configurações (pausa o jogo) |
| I | Consultar inventário |
| H | Mostrar/ocultar ajuda |
| G | Perfil gráfico (baixo → médio → alto) |
| T | Horário (manhã → pôr do sol → noite) |
| M | Som liga/desliga |
| ` | Estatísticas de desempenho |
| F8 | Alternar mapa de testes (somente em desenvolvimento) |
| F9 | Alternar protagonista: modelo 3D importado / personagem original (somente em desenvolvimento) |
| F10 | Depuração do trânsito e pedestres: rede, estados e contadores (somente em desenvolvimento) |
| Esc | Liberar o mouse (navegador) |

## Conflitos verificados

- **Espaço** = pular (a pé) e freio de mão (dirigindo). Os contextos são exclusivos: dirigindo, o controle a pé fica bloqueado. Não é conflito real.
- **Q** (buzina) não é usada por nenhuma outra ação.
- **R** = recarregar (a pé, com arma sacada) e recuperar veículo (dirigindo). Contextos exclusivos: sem arma sacada, R não recarrega; no carro, o controle de combate fica desativado.
- **H** continua sendo a ajuda; por isso sacar/guardar arma usa **X**. **TAB** estava livre e virou a roleta de armas (o padrão do navegador é bloqueado só com o jogo ativo).
- Atalhos com Win/Alt/Meta são ignorados (não disparam ações do jogo).
- **E** perto de uma porta de prédio e de uma porta de carro ao mesmo tempo: a mais próxima vence (o aviso na tela mostra qual será acionada). Testado com o carro a 1,44 m × porta a 1,30 m (prédio) e com o carro a 1,46 m × porta a 1,60 m (carro).
- **P** e **I** estavam livres; com o painel de diálogo de um estabelecimento aberto elas não abrem o menu. Com o menu aberto, **P**/**Esc** o fecham.
- **E** perto do totem de uma garagem própria: abre o painel da garagem (vence a interação mais próxima, como nas portas).
- **1–9** com o painel de diálogo aberto escolhem opções e não chegam ao seletor de armas (o evento é consumido antes do jogo).
- Após entrar ou sair do carro há um intervalo de 0,6 s antes de E ser aceito de novo, para que toques repetidos não reentrem nem saiam sem querer.
- **E** perto de um barco atracado, do quiosque MARINA STORAGE, da loja da marina ou de um ponto de interesse marítimo: vence a interação mais próxima (mesma regra das portas). Pilotando um barco, E só sai do barco (portas de carros e prédios não reagem).
- **W/S/A/D** pilotando um barco movem só o barco; o personagem fica sentado (sem conflito com a caminhada).
- **V** no barco usa o mesmo alternador de câmera do jogo (3ª pessoa ↔ 1ª pessoa), aplicado à câmera náutica.
- **Espaço** nadando não pula: só sobe em píeres/conveses próximos.

## Parâmetros de URL (desenvolvimento)

- `?quality=low|medium|high`: perfil gráfico inicial.
- `?time=morning|sunset|night`: horário inicial.
- `?map=test-city`: começa no mapa de testes.
- `?player=original|glb`: escolhe o protagonista (padrão: modelo 3D importado, com fallback automático).
- `?interiors=open`: ignora os horários de funcionamento (todos os estabelecimentos abertos).

## Rádio (NEON RADIO NETWORK)

| Tecla | Ação | Contexto |
|---|---|---|
| Scroll do mouse | Abre a roleta de rádios e passa para a próxima/anterior emissora (inclui RADIO OFF). Após 2 s sem mexer, a roleta some e a emissora destacada toca | dentro de carros e lanchas |
| Scroll do mouse | Troca de arma (sem mudança) | a pé |

As setas continuam esterçando, Q continua sendo a buzina e o scroll a pé continua trocando de arma.
Os volumes de geral, música, rádio, vozes, efeitos e ambiente ficam em **P → Configurações**.
