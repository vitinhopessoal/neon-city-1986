# NEON CITY: 1986 — NEON CUSTOMS (PROMPT 10)

Personalização automotiva original: peças, nomes, cores e interface próprios, sem marcas reais.

## 1. Diagnóstico inicial

| Item | Encontrado | Consequência |
|---|---|---|
| Geometria | `VehicleFactory` gera tudo proceduralmente. A carroceria é fundida por material (`PartCollector`); rodas, portas e volante têm pivôs próprios | as peças novas são malhas extras num grupo `custom-parts` do corpo |
| Materiais | pintura e luzes são materiais **próprios** do carro; vidro, bancos, painel, aros, borracha e faixas são **compartilhados** | antes de tingir, clono só no carro personalizado; a cidade nunca muda |
| Física | `VehiclePhysics` lê `vehicle.spec.handling` (cópia por carro), mas `handling.suspension` era um objeto compartilhado entre carros do mesmo modelo | o desempenho é recalculado a partir dos `SPECS` de fábrica numa cópia profunda por carro |
| Suspensão | a animação controla a altura da carroceria (`body.position.y`) | a altura personalizada entra como deslocamento (`rideOffset`) |
| Danos | `VehicleDamage` (integridade, escurecimento da pintura a partir de uma cor base) | resistência como multiplicador (mínimo 0,7); a cor base é sincronizada com a pintura |
| Oficina | SUNSET AUTO WORKS (PROMPT 06), interior a pé | a NEON CUSTOMS virou **seção especializada** dela, sem estabelecimento duplicado |
| Economia, garagens, save | `EconomyManager`, `PropertyGarage`, `SaveManager` (PROMPT 07) | reutilizados |

Riscos de regressão registrados: material compartilhado mutável, suspensão compartilhada, E dentro do carro (sair × personalizar), colisor com altura alterada.

## 2. Arquitetura

```
src/vehicles/customization/
  CustomizationCatalog.js        peças, cores, acabamentos, melhorias, preços, compatibilidade, saneamento
  VehicleAppearance.js           peças 3D e materiais (isolamento por carro, cache de geometrias)
  VehiclePerformance.js          manuseio real recalculado + barras derivadas dos parâmetros
  VehicleCustomizationManager.js vaga de entrada, sessão, prévia, transação, câmera, baia, persistência
  CustomizationUI.js             interface
```

`CustomizationDefinitions`, `Compatibility`, `Preview`, `Transaction` e `Persistence` ficaram incorporados aos arquivos acima para evitar arquivos redundantes. Nada do Three.js é persistido: o veículo guarda `vehicle.custom`, um objeto simples com ids estáveis.

## 3. Oficina

- **Na rua**: vaga rosa pintada na faixa de estacionamento em frente à SUNSET AUTO WORKS (reservada, o trânsito não para nela) e letreiro **NEON CUSTOMS** na fachada.
- Ao parar na vaga dirigindo, aparece **PRESSIONE E PARA PERSONALIZAR · NEON CUSTOMS**.
- **Baia**: o MESMO carro é levado, com transição curta, a uma baia interna com plataforma de anel neon, faixas rosa/azul/violeta, parede de rodas expostas, bancada e ferramentas, armários coloridos, elevador estilizado, recepção, letreiro retrô e o mecânico **Rico**. Música e ambiente da oficina tocam.
- A baia reaproveita o sistema de interiores: mundo externo oculto, luz própria, NPC.
- **Ao sair**: o carro volta à vaga, com a posição livre verificada.
  - Até o carro se afastar 6 m, o E volta a ser "sair do veículo" (correção de um bloqueio encontrado no teste).
  - A prévia não comprada é descartada.
  - Autosave.

## 4–6. Categorias, peças e compatibilidade

| Categoria | Opções (preço) | NEON GT | SUNSET CLASSIC | PALM SEDAN |
|---|---|---|---|---|
| Pintura | 10 cores (Branco Miami, Azul Oceano, Rosa Sunset, Vermelho Coral, Preto Midnight, Amarelo Tropical, Verde Jade, Prata Chrome, Violeta Neon, Bege Clássico) × sólida $250 / metálica $500 / perolizada $750 / fosca $400 | ✓ | ✓ | ✓ |
| Pintura secundária | faixas $300: recolore as faixas de fábrica ou cria faixas centrais em capô, teto e tampa | ✓ | ✓ | ✓ |
| Rodas | cinco raios $700 · multirraios $750 · disco $650 · clássica cromada $800 · malha $850 · aço $400 | cinco raios, multi, disco, cromada, malha | cinco raios, multi, cromada, aço | todas |
| Pneus | esportivo $450 · perfil baixo $550 · alta aderência $650 | ✓ | esportivo, aderência | ✓ |
| Altura | rebaixada / esportiva / elevada $900 | rebaixada, esportiva | rebaixada, esportiva | todas (elevada só aqui) |
| Para-choques | esportivo $800 · aerodinâmico $950 · retrô $850 | esportivo, aero | esportivo, retrô | todos |
| Saias laterais | esportiva $550 · aerodinâmica $700 | ✓ | esportiva | ✓ |
| Aerofólio | discreto $450 · esportivo $650 · asa retrô $900 | todos | discreto | discreto, esportivo |
| Capô | esportivo $600 · com entradas de ar $700 | ✓ | esportivo | ✓ |
| Escapamento | esportivo $450 · duplo $700 (ronco mais grave) | ✓ | ✓ | ✓ |
| Faróis/lanternas | fumê $350 · âmbar retrô $300 | ✓ | ✓ | ✓ |
| Película | transparente $200 · leve (original) · média $250 · escura $350 (opacidade máxima 0,74; visão interna preservada) | ✓ | ✓ | ✓ |
| Interior | couro vermelho / caramelo / azul $500 (bancos e painel modelados) | ✓ | ✓ | ✓ |
| Motor | Street $1.500 · Sport $3.000 · Performance $4.500 | ✓ | ✓ | ✓ |
| Freios | Melhorado $800 · Esportivo $1.200 | ✓ | ✓ | ✓ |
| Transmissão | Ajustada $1.000 · Esportiva $2.000 | ✓ | ✓ | ✓ |
| Suspensão esportiva | Firme $900 · Competição $1.600 | ✓ | ✓ | ✓ |
| Resistência | Reforçada $1.200 · Blindagem leve $2.400 | ✓ | ✓ | ✓ |
| Reparos | $3 por ponto de integridade; preserva todas as peças | ✓ | ✓ | ✓ |

**Regras entre peças**: a asa retrô não combina com o para-choque retrô. Peças incompatíveis aparecem desabilitadas com o motivo, e uma peça incompatível vinda de um save é descartada.

Todas as peças são **geometrias 3D** geradas a partir das medidas reais de cada modelo (perfil lateral, entre-eixos, bitola, posição do escape). O aerofólio assenta na tampa traseira, as saias acompanham o comprimento entre as rodas e o capô fica antes do para-brisa. As geometrias são cacheadas por modelo e estilo.

## 7. Alterações de física (manuseio real)

Multiplicadores moderados sobre o manuseio **de fábrica do modelo**, aplicados só no objeto `spec.handling` daquele carro:

| Peça | Efeito |
|---|---|
| Motor | força ×1,12 / ×1,25 / ×1,4; velocidade máxima ×1,04 / ×1,08 / ×1,12 |
| Transmissão | força ×1,04 / ×1,08; marchas mais curtas |
| Freios | força de frenagem ×1,15 / ×1,3 |
| Pneus | aderência ×1,04–1,10; força lateral ×1,04–1,10 |
| Suspensão | rolagem ×0,8 / ×0,65; estabilidade +0,08 / +0,15; resposta da direção maior |
| Altura | estabilidade ±; colisor ajustado |
| Aerofólio | estabilidade +0,04 / +0,06; arrasto leve |
| Escape | força ×1,02–1,03 e ronco mais grave (`enginePitch`) |
| Resistência | dano ×0,85 / ×0,7 (nunca indestrutível), com massa extra |

**Medido no jogo** (mesmo trecho da Ocean Ave, 3 s acelerando a partir do repouso):
- NEON GT de fábrica: 29,1 m, 72 km/h;
- NEON GT com motor Sport + transmissão esportiva + pneus de aderência: **38,8 m, 94 km/h**.

As **barras** (velocidade, aceleração, frenagem, controle, resistência) são calculadas dos parâmetros reais, em escalas fixas para todos os modelos. Com tudo instalado nos dois, o NEON GT continua mais rápido que o PALM SEDAN (teste automatizado).

## 8. Prévia

Clicar numa opção aplica a mudança visual na hora e mostra nas barras a diferença em verde (melhora) ou vermelho (piora). Nada é cobrado ou salvo. **Cancelar prévia** volta ao instalado (teste: cor e acabamento exatos); **sair da oficina** descarta toda prévia não comprada.

## 9. Economia

Compras passam pela `EconomyManager`: preço conferido, compatibilidade validada, sem saldo negativo e cobrança única. O id de transação vale por sessão, e o botão fica desabilitado durante a compra, então cliques repetidos não cobram duas vezes.

Teste: seis peças custaram exatamente $6.350; comprar de novo a mesma peça devolve "Já instalado".

## 10–11. Garagens e persistência

O registro do carro na garagem e no save (`recordOf`) inclui `custom`: pintura e acabamento, faixas, rodas, pneus, altura, para-choques, saias, aerofólio, capô, escape, faróis, película, interior, os cinco níveis mecânicos e a integridade.

Ao retirar ou carregar, a configuração é **saneada e reaplicada**: aparência, física e colisor. Carros vindos do trânsito ganham id persistente próprio ao serem personalizados, e personalizar um carro o torna seu.

Teste: guardar na garagem da Palm Residence → salvar → **recarregar a página** → carregar → retirar. Voltaram azul metálico, 5 cm mais baixo, aros de cinco raios, motor de 12.420 N e aderência de 1,232, em um único exemplar.

## 12–13. Arquivos

**Criados**:
- `src/vehicles/customization/CustomizationCatalog.js`, `VehicleAppearance.js`, `VehiclePerformance.js`, `VehicleCustomizationManager.js`, `CustomizationUI.js`
- `tools/vehicles/customization.test.mjs`
- `docs/NEON_CUSTOMS.md`, `docs/screenshots/customs/`

**Modificados** (incrementais):

| Arquivo | Alteração |
|---|---|
| `vehicles/VehicleAnimation.js` | soma `rideOffset` à altura da carroceria |
| `vehicles/VehicleDamage.js` | multiplicador `resistance` (mínimo 0,7) |
| `vehicles/VehicleManager.js` | `inputLocked` durante a sessão |
| `vehicles/VehicleInteraction.js` | o E dentro do carro respeita `suppressed` |
| `vehicles/VehicleFactory.js` | guarda `appearance` (já do PROMPT 07) |
| `properties/PropertyGarage.js` | `custom` no registro e reaplicação |
| `core/Game.js` | criação, mapa, `preUpdate` e câmera |
| `styles/main.css` | interface |
| `package.json` | `test:customs` |

## 14. Testes executados

| # | Teste | Resultado |
|---|---|---|
| 1–4 | Abrir o jogo, entrar no NEON GT, ir à vaga, entrar na personalização | OK (aviso, transição, carro na baia, mecânico) |
| 5 | Girar a câmera | OK: predefinições frente, traseira, lateral, rodas, interior e livre; arrastar e roda do mouse; nunca entra na carroceria nem sai da baia |
| 6–9 | Pintura: prévia, cancelar, comprar | OK (prévia sem cobrança; restauração exata; $500) |
| 10–13 | Rodas, suspensão, aerofólio, motor | OK (peças visíveis; −5 cm; motor 9.200 → 11.500 N) |
| 14 | Comparar desempenho | OK (aceleração 70 → 88, velocidade 83 → 89) |
| 15–17 | Sair, dirigir, mudança real | OK (29,1 m → 38,8 m em 3 s) |
| 18–23 | Guardar, salvar, recarregar, carregar, retirar, conferir | OK (todas as peças e a física voltaram; um exemplar) |
| 24–25 | Integridade e colisões | OK (resistência no sistema de danos; colisor acompanha a altura) |
| 26 | Desempenho | OK (0,7 ms por troca de peça; memória estável após 90 prévias) |
| 27 | Console | sem erros |
| — | SUNSET CLASSIC | OK (perolizado com iridescência 0,85, rodas cromadas, para-choque retrô com faróis de neblina, aerofólio discreto, interior caramelo, freios 12.500 → 16.250 N; asa e disco recusados) |
| — | PALM SEDAN | OK (+5 cm, faixas criadas, aerofólio esportivo, escape duplo, película escura, rolagem 0,045 → 0,036, estabilidade 0,90 → 0,97; asa recusada) |
| — | Outros carros do mesmo modelo | inalterados (pintura, vidro e aros compartilhados intactos) |

**Automatizados** (`npm run test:customs`, 3/3): compatibilidade, saneamento, desempenho e identidade, peças no modelo, materiais compartilhados intactos, sem acúmulo de malhas, cancelar restaura, resistência integrada. O projeto passa nos 58 testes e o build não tem erros.

## 15. Desempenho

- Trocar uma peça (com reconstrução das malhas do grupo de peças): 0,7 ms em média.
- Geometrias de peças e aros são cacheadas por modelo/estilo; materiais de acabamento são compartilhados e imutáveis.
- Só as cópias necessárias são feitas por carro (vidro, bancos, painel, faixas).
- Memória estável após 90 prévias seguidas (945 geometrias, 147 texturas antes e depois).

## 16–17. Bugs encontrados e corrigidos

1. Carro **invisível na baia**: o grupo de veículos do mapa era ocultado junto com o mundo. O carro passa a ficar na cena durante a sessão e volta ao grupo original.
2. Carro **sem acelerar após sair**: a física ficava dormindo. Agora é reacordada no retorno.
3. **Não era possível descer do carro na vaga** depois de personalizar (o E reabria a oficina). A vaga fica bloqueada até o carro se afastar.
4. Suspensão compartilhada entre carros do mesmo modelo: evitada com cópia profunda do manuseio por carro.

## 18. Pendências reais

- **Volante e detalhes decorativos do interior**: só a cor dos bancos e do painel é personalizável.
- **Faróis**: mudam a cor e a emissão das lentes; o foco de luz real do farol continua o mesmo.
- **Câmera**: limitada por caixas (baia e carroceria), sem colisão fina com objetos da baia.
- **Áudio do escape**: muda só o tom do motor existente, sem gravações novas. Não foi ouvido na automação (o AudioContext fica suspenso sem gesto real).
- **Mecânica "trocar a pintura para perder estrelas"**: não implementada, como pedido.

Capturas: `docs/screenshots/customs/` — 01 baia com o carro original · 02 NEON GT personalizado · 03 PALM SEDAN na vaga em frente à oficina.
