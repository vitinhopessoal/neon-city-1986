# Arsenal (PROMPT 04)

Sistema de armas modular em `src/weapons/`. Os modelos 3D são representações
visuais estilizadas, apenas da silhueta externa. Os números de jogabilidade
foram definidos para equilíbrio e não reproduzem dados técnicos.

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `WeaponDefinitions.js` | Dados das 9 armas, categorias de munição e notas históricas. |
| `WeaponModels.js` | Modelos procedurais "low-poly premium": perfis laterais extrudados com chanfro, materiais PBR compartilhados e peças animadas (ferrolho, carregador, bomba, manejo). |
| `WeaponInventory.js` | Armas possuídas, munição carregada por arma e reserva por categoria. |
| `WeaponManager.js` | Entrada, estados (guardada, sacando, pronta, guardando), mira, disparo, recarga, veículos, coldre, 1ª e 3ª pessoa. |
| `WeaponView.js` | Arma na mão ou no coldre (3ª pessoa) e vista em 1ª pessoa com mãos; animação das peças e clarão. |
| `WeaponBallistics.js` | Raios contra os colisores do mapa, o terreno e os alvos; material do impacto. |
| `WeaponEffects.js` | Pools fixos: partículas aditivas e com alfa, cápsulas, marcas de impacto e traçantes. |
| `WeaponAudio.js` | Sons sintetizados (Web Audio): disparo por categoria, recarga, vazio, equipar, impactos e cápsulas. |
| `WeaponHUD.js` | Painel de munição, retículo dinâmico, marcador de acerto e seleção rápida. |
| `TargetRange.js` | Área de tiro, somente em desenvolvimento: silhuetas, placas de aço, latas e marcos de distância. |

Integrações:

- `PlayerAnimator`: camada armada (pronta, mira, recuo, recarga).
- `ProtagonistModel`: IK da mão de apoio.
- `Player`: orientação do corpo ao mirar e pontos de fixação.
- `ThirdPersonCamera` e `CameraManager`: câmera sobre o ombro e recuo.
- `InputManager`: botões e roda do mouse.

## Armas

| Slot | Arma | Modo | Carregador | Triângulos | Observação histórica |
|---|---|---|---|---|---|
| 1 | Bren Ten | semiautomática | 10 | 792 | 1983–1986: coerente. |
| 2 | S&W 645 | semiautomática | 8 | 820 | 1985: coerente. |
| 3 | S&W 4503 | semiautomática | 8 | 852 | **Divergência:** a série 4500 de 3ª geração só chegou por volta de 1988–1989. Mantida como pedido; alternativa de época: S&W 469 ou 659. |
| 4 | Ithaca 37 Stakeout | bomba, 8 projéteis | 5 | 948 | Coerente. |
| 5 | MAC-10 | automática (900/min) | 30 | 808 | Coerente. |
| 6 | MAC-11 | automática (1100/min) | 32 | 808 | Menor, cadência maior, menos dano. |
| 7 | KG-99 | semiautomática | 20 | 1076 | Versão semiautomática; não é variante automática. |
| 8 | Colt Carbine A1 | automática (720/min) | 30 | 1164 | Inspirada na linha de carabinas Colt de coronha retrátil do início dos anos 80. Nomenclatura aproximada. |
| 8 | Colt Sporter Carbine | semiautomática | 20 | 1204 | Inspirada nas carabinas civis "Sporter" de meados dos anos 80. Nomenclatura aproximada. A tecla 8 alterna entre as duas carabinas. |

## Controles

| Tecla | Ação | Contexto |
|---|---|---|
| 1–8 | Selecionar e sacar a arma | a pé |
| Roda do mouse | Próxima / anterior | a pé |
| TAB (segurar) | Seleção rápida | a pé |
| X | Sacar / guardar | a pé |
| Mouse esq. | Disparar (segurar nas automáticas) | a pé, arma sacada |
| Mouse dir. | Mirar (câmera sobre o ombro; em 1ª pessoa, alinha a mira) | a pé, arma sacada |
| R | Recarregar | a pé, arma sacada (no carro, R continua sendo "recuperar veículo") |

- **H:** continua sendo a ajuda. Por isso, sacar e guardar a arma usa X.
- **Tab:** estava livre.
- **Veículos:** ao entrar, a arma é guardada e a munição e a seleção são
  preservadas. Ao sair, a arma volta à mão. Não há disparos de dentro do carro
  nesta etapa.

## Comportamento

- **Mira em 3ª pessoa:** o raio sai da câmera pelo retículo, a partir da
  altura do jogador. Se algo bloqueia entre o cano e o alvo, o impacto fica no
  obstáculo, então não se atira através de paredes.
- **Dispersão:** soma a base da arma, o movimento, o pulo e o acúmulo por
  disparo (bloom). Mirar reduz a dispersão.
- **Dano:** cai até 40% entre a distância de queda e o alcance da arma.
- **Recarga:** pistolas, compactas e carabinas trocam o carregador (com
  liberação do ferrolho quando estava vazia). A escopeta recarrega cartucho a
  cartucho e pode interromper a recarga para atirar. Atirar com o carregador
  vazio dá um clique e inicia a recarga automática.
- **Efeitos:** clarão, brasas e fumaça; cápsulas ejetadas para a direita (a
  escopeta solta o cartucho por baixo ao bombear); poeira, lascas e faíscas por
  material (concreto, asfalto, metal, madeira, vidro, areia, terra, água);
  marcas que somem em 20 s; traçantes ocasionais. Tudo usa pools fixos.

## Medições (Chrome, `quality=medium`, máquina com CPU em 83–100% por carga externa)

- Arma visível: +10 draw calls (malhas e sombra) e cerca de +2 mil triângulos.
- Efeitos ativos: +2 draw calls.
- O tempo de quadro mediano ficou dentro do ruído da medição (29–41 ms nas
  mesmas condições).
- Cadência medida em 60 quadros/s: MAC-10 15/s, MAC-11 19/s, Colt A1 12/s.
- Limpeza: depois de 22 s, 0 partículas, 0 cápsulas e 0 marcas ativas.

## Pendências

- Sem disparo de dentro de veículos (previsto para etapa futura).
- Sem NPCs armados (fora do escopo deste prompt).
- Impactos não danificam veículos nem cenário (só efeitos).
- O material do impacto é inferido pelo nome do colisor. Vidro só aparece em
  colisores identificados como vidro ou vitrine.
- A malha do protagonista é fundida (braço junto ao tronco). Com braços muito
  levantados, a axila ainda estica um pouco. As "pontes" entre mão e quadril
  foram removidas no pipeline.
- No modelo original (fallback), a mão de apoio usa só a pose, sem IK.
