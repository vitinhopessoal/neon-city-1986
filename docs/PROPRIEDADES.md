# NEON CITY: 1986 — Propriedades, economia, inventário, garagens e salvamento (PROMPT 07)

Todos os nomes de imóveis, marcas e itens são fictícios e originais.

## 1. Diagnóstico inicial

| Sistema | Antes | Decisão |
|---|---|---|
| Dinheiro | `PlayerStatus.money` (inteiro; `spendMoney` recusa saldo insuficiente); escrito diretamente pelos interiores | O valor continua armazenado ali, porque o HUD e os testes leem esse campo. Toda escrita passa a ir pela nova `EconomyManager` |
| Inventário | `WeaponInventory` do arsenal (armas, munição carregada e reserva) | É usado diretamente, sem cópia. Roupas, chaves e objetos são dados simples à parte |
| Persistência | `localStorage` só para a qualidade gráfica e para as compras dos estabelecimentos (`neoncity.save.interiors`) | Novo salvamento em IndexedDB. Os dados antigos são copiados intactos para `legacy.interiors` antes de qualquer nova partida |
| Portas e interiores | Sistema do PROMPT 06 (transição, colisão, luz, áudio, interações) | Reaproveitado. As residências são interiores com um "portão" de compra |
| Veículos | Carros do mapa com id estável (`veh_vento_white`…); carros do trânsito com ids reciclados (`traffic_N`) | Garagens reaproveitam os mesmos objetos e a mesma física |
| Relógio | `PlayerStatus.minutes` (1 minuto de jogo por segundo) e presets visuais manhã/pôr do sol/noite | Dormir usa os dois. Não há relógio paralelo |
| Menu | Tela inicial só com INICIAR JOGO e a qualidade gráfica | A tela foi ampliada e ganhou um menu de jogo (P) |

Testes existentes de referência: 49/49 antes e 49/49 depois.

## 2. Arquitetura

```
src/economy/    PriceDefinitions.js (saldo inicial $2.500, preços)  EconomyManager.js (carteira, transações, histórico)
src/save/       SaveSchema.js (versão, validação)  SaveMigration.js  SaveManager.js (IndexedDB, fila, slots, restauração)
src/inventory/  InventoryDefinitions.js  InventoryManager.js  StorageManager.js (armários)
src/properties/ PropertyDefinitions.js (4 imóveis)  PropertyFurniture.js (móveis residenciais)
                PropertyManager.js (registro, posse, compra, interações, radar)  PropertyGarage.js
src/ui/GameMenu.js (menu P)
```

Os módulos sugeridos `PropertyRegistry`, `PropertyOwnership`, `PropertyInteraction`, `PropertyInterior` e `TransactionManager` foram incorporados aos arquivos acima para não criar arquivos redundantes:
- registro, posse e interações ficam no `PropertyManager`;
- os interiores usam o `InteriorManager`;
- as transações ficam no `EconomyManager`.

Não há dependências circulares: as definições recebem o gerenciador por injeção (`createPropertyDefs(pm)`).

## 3. Sistema de propriedades

Cada imóvel tem: id estável, nome, tipo, localização, preço, estado de posse, entrada e saída (a porta do sistema de interiores), interior, garagem (opcional, com capacidade), recursos, ponto de salvamento e estado de desbloqueio (a chave `key_<id>` no inventário).

| Imóvel | Tipo | Prédio / local | Preço | Garagem | Status |
|---|---|---|---|---|---|
| SUNSET APARTMENT | Apartamento simples (inicial) | bld_nw_1 (prédio "APTS"), Coral Street | grátis na nova partida | — | **Implementado e testado** |
| PALM RESIDENCE | Casa residencial | house_coral_16 (bangalô com garagem), Coral Street | $12.000 | 1 carro (entrada da casa) | **Implementado e testado** |
| AZURE CONDO | Apartamento de luxo, vista para a cidade | lp_lantern_suites (torre de 6 andares), Lantern Point | $35.000 | 2 carros (vagas de rua reservadas) | **Implementado e testado** |
| OCEAN CREST VILLA | Alto padrão, terraço com piscina e vista do mar | lp_west_3 (lote 22×28 m), Lantern Point | $95.000 | 3 carros (entrada da casa + vaga de rua) | **Implementado e testado** |

Lantern Point é o bairro ao norte, no mesmo mapa costeiro. O prédio que caberia para o condomínio em Sunset Beach limitaria o interior a 10 m de largura.

Os tipos "intermediário", "casa com garagem", "cobertura" e "mansão" estão previstos no campo `property.kind`; criar um novo imóvel é só acrescentar uma definição.

**Interiores** (estilo low-poly premium, com componentes reutilizados e identidade própria em cada um):
- **Sunset Apartment**: entrada; sala com TV de tubo animada, sofá, mesa de centro, luminária e ventilador de teto com pás girando; cozinha compacta (bancada, pia, fogão, geladeira, mesa para dois); banheiro com porta; quarto com porta, cama, criados com abajur, guarda-roupa e janela com persianas; escrivaninha com telefone (ponto de salvamento); armário de aço; pôsteres e planta.
- **Palm Residence**: sala ampla com dois sofás e TV, cozinha integrada com ilha e banquetas, mesa de jantar, banheiro, quarto de casal, armário, escrivaninha e painel da garagem.
- **Azure Condo**: piso tipo mármore, **janela panorâmica de 10,5 m com o horizonte urbano**, sofá em L, piano, jukebox, cozinha aberta com ilha, jantar para seis, suíte com cama king e vista do mar, banheiro com banheira e console de entrada.
- **Ocean Crest Villa**: saguão, salão, jantar para seis, cozinha gourmet, suíte master, banheiro com banheira e box, escritório com estantes e dois armários, **terraço com piscina animada, espreguiçadeiras, palmeiras e vista do mar**, separado por parede de vidro com porta de correr.

**Compra**: imóveis à venda têm uma placa discreta "À VENDA $…" ao lado da porta. O aviso mostra "NOME · $PREÇO · PRESSIONE E PARA VISUALIZAR" e abre a ficha (nome, tipo, preço, descrição, recursos, garagem, local, situação), depois a confirmação. A compra exige:
- imóvel disponível;
- saldo suficiente (o preço é cobrado uma única vez; o id de transação deduplica cliques repetidos e há trava contra reentrada);
- registro da posse e da chave, remoção da placa, toast e autosave.

## 4. Economia

- `balance`, `canAfford`, `spend(n, motivo, { txId })`, `earn`, `reward(origem, n, motivo, txId)`.
- Valores inteiros. O dólar inteiro é a menor unidade do jogo, que não tem centavos. Nunca há saldo negativo e o teto é 99.999.999.
- Histórico das últimas 60 transações, salvo junto da partida.
- `reward` aceita origens previstas (missão, entrega, trabalho, negócio, corrida, serviço, evento) para as etapas futuras.
- **Teste somente em dev**: `__NEON_TEST__.grantMoney(n)` existe apenas no harness, que é removido do build público. Não há comando de dinheiro no jogo publicado.
- Os interiores do PROMPT 06 também passaram a cobrar pela economia central.
- O saldo inicial ($2.500, configurável em `PriceDefinitions.js`) é criado somente em **Novo jogo**; carregar uma partida não o concede de novo.

## 5. Inventário

- Categorias: armas e munição (o inventário **real** do arsenal), roupas, chaves, objetos e especiais.
- As roupas e eletrônicos comprados nos estabelecimentos aparecem no inventário a partir do registro de compras, sem duplicar.
- Só dados serializáveis vão para o save.
- **Armário** (em cada residência): guardar e retirar armas (a munição do pente vai junto) e munição de 30 em 30, respeitando o máximo de cada tipo.
  - Cada transferência valida antes de alterar; uma arma não pode estar no inventário e num armário ao mesmo tempo.
  - Teste: munição de pistola com você + no armário = 172 antes e 172 depois; guardar duas vezes e retirar duas vezes foram recusados.
- **Guarda-roupa**: lista as roupas possuídas e registra a escolha.
  - **Customização visual: Parcialmente implementado.** O GLB do protagonista tem uma única roupa (uma textura, sem peças separadas). A escolha é salva e fica pronta para variantes compatíveis do modelo, mas o personagem não muda de aparência.
- **Consulta**: menu P → Inventário, tecla I, ou "Consultar inventário" no armário.

## 6. Garagens

- Cada garagem tem: id, propriedade, capacidade, baias (vagas marcadas em azul no chão), totem com luz verde (o ponto de interação) e veículos guardados.
- **Guardar**:
  1. Estacione na vaga, desça do carro e use o totem.
  2. O sistema confere a posse do imóvel, a capacidade e se o carro já está guardado.
  3. Registra modelo, cor base, faixa, placa e integridade **antes** de retirar o carro do mundo; se a remoção falhar, o registro é desfeito.
  4. Autosave.
- **Retirar**: confere a disponibilidade, procura uma vaga livre e segura (sem carros, paredes ou o jogador por perto) e restaura cor e integridade. Carros do mapa voltam como o **mesmo objeto**; carros vindos do trânsito ganham um id persistente próprio (`own_…`) e são recriados pela fábrica.
- **Trânsito**: as vagas de rua usadas como baias ficam reservadas, então a IA não estaciona nelas. Nenhuma baia fica sobre faixa de rolamento, e o comportamento dos motoristas não foi alterado.
- Os ids são estáveis e independem do modelo, então NEON GT, SUNSET CLASSIC, PALM SEDAN e modelos futuros usam o mesmo sistema.

## 7. Salvamento

- **IndexedDB** (banco `neoncity`, store `saves`). Se estiver indisponível, usa `localStorage` (cada save tem cerca de 2,6 KB) e, em último caso, memória.
- Slots: **autosave** separado e **3 slots manuais**. Cada slot mostra data, horário do jogo, local, dinheiro e tempo de jogo.
- **Fila única**: nunca há duas gravações simultâneas.
- **Atômico**: o snapshot é validado antes de gravar. Numa única transação o conteúdo anterior vira `<slot>.bak` e o novo é gravado; o resultado é relido e conferido antes da confirmação na tela.
- **Conteúdo**: versão do esquema, id da partida, data, mapa, local, tempo de jogo, posição e orientação, vida, interior onde o jogador estava, horário, economia, inventário completo, propriedades e armários, garagens, carros do jogador no mundo, compras dos estabelecimentos, missões (vazio, preparado para o futuro) e preferências (qualidade, câmera).
- Nada do Three.js é salvo: um verificador recusa funções, objetos com protótipo e ciclos.
- **Autosave** em momentos seguros, nunca a cada quadro nem durante transições ou ao entrar e sair de veículos: nova partida, compra de imóvel, guardar ou retirar carro, ao acordar e ao sair de uma residência própria.
- **Manual**: no ponto de salvamento de cada residência ou pelo menu P. Sobrescrever pede confirmação. O autosave nunca grava num slot manual.

## 8. Carregamento

1. Migra (esquema versionado; formatos desconhecidos e versões mais novas são recusados, sem inventar migração) e valida tipos, campos obrigatórios, números, ids, referências, posições e duplicatas.
2. Carrega o mapa e aguarda ficar pronto. Se o mapa salvo estiver indisponível, faz uma recuperação segura em Sunset Beach.
3. Restaura nesta ordem: economia, inventário, compras dos estabelecimentos, propriedades e armários, garagens e veículos, horário (preset coerente e minuto exato), vida e jogador.
4. O jogador nunca é posicionado antes do mapa e nunca dentro de paredes (busca piso livre em anéis; em último caso, usa o ponto de spawn).

Um save inválido mostra a mensagem e os demais slots continuam intactos.

**Menu principal**: NOVO JOGO, **CONTINUAR** (último salvamento válido, desabilitado sem save), **CARREGAR JOGO** (lista de slots) e CONFIGURAÇÕES (qualidade gráfica).

**Menu do jogo (P)**: Voltar ao jogo, Salvar, Carregar, Propriedades (catálogo com estado, preço, local, garagem e recursos), Inventário e Configurações. A simulação fica **pausada** enquanto o menu está aberto.

**Radar**: casa verde = residência própria; círculo amarelo com $ = à venda; quadrado azul com G = garagem.

## 9–11. Arquivos

**Criados**:
- `src/economy/PriceDefinitions.js`, `src/economy/EconomyManager.js`
- `src/save/SaveSchema.js`, `src/save/SaveMigration.js`, `src/save/SaveManager.js`
- `src/inventory/InventoryDefinitions.js`, `src/inventory/InventoryManager.js`, `src/inventory/StorageManager.js`
- `src/properties/PropertyDefinitions.js`, `src/properties/PropertyFurniture.js`, `src/properties/PropertyManager.js`, `src/properties/PropertyGarage.js`
- `src/ui/GameMenu.js`
- `docs/PROPRIEDADES.md`, `docs/screenshots/propriedades/`

**Modificados** (incrementais):

| Arquivo | Alteração |
|---|---|
| `core/Game.js` | criação dos módulos; `newGame`, `continueGame`, `loadFromTitle`, `loadGame`; pausa com menu aberto; tempo de jogo; teclas P e I |
| `config.js` | bloco `properties` (hora de acordar, carro inicial e sua vaga) |
| `core/InputManager.js` | ações `gameMenu` (P) e `inventory` (I), sem conflitos (teste de HUD verde) |
| `ui/StartScreen.js` | Novo jogo, Continuar, Carregar, mensagens |
| `ui/Minimap.js` | marcadores de propriedades |
| `interiors/InteriorManager.js` | definições extras, portão de compra, interações externas (totens), porta recuada para casas, `enterImmediately`, eventos de entrada e saída, compras pela economia, ambiente do céu atenuado dentro |
| `interiors/InteriorDefinitions.js` | `innerDoor`/`tvScreen` exportados (reuso); portas de vidro |
| `interiors/InteriorPersistence.js` | `replace` e `reset` |
| `interiors/InteriorAudio.js` | ambiência residencial e som de salvamento |
| `vehicles/VehicleFactory.js` | guarda a aparência de origem (cor, faixa, placa) no veículo |
| `styles/main.css` | menus e painéis |
| `dev/TestHarness.js` | `grantMoney`, `toDoor` (somente dev) |

## 12. Testes executados (Chrome, servidor dev)

| # | Teste | Resultado |
|---|---|---|
| 1–3 | Jogo inicia, Sunset Beach carrega, TEST CITY funciona | OK. Na TEST CITY: sem imóveis, sala de teste acessível, save e load identificam o mapa |
| 4–8 | Caminhar, correr, pular, câmeras, tecla V | OK (3,07 m/s; 7,03 m/s; pulo de 1,01 m; 3ª → 1ª → 3ª) |
| 9–10 | Entrar e sair da residência | OK nos 4 imóveis (0 sólidos sobrepostos; contenção nas 4 direções) |
| 11 | Cama | OK (18:40 → 07:01, céu de manhã, vida 100, autosave) |
| 12 | Guarda-roupa | OK (abre e registra a escolha; sem troca visual, ver acima) |
| 13 | Armazenamento | OK (armas e munição conservadas, duplicatas recusadas) |
| 14–16 | Saldo exibido, recebido e descontado | OK ($2.500 → +$15.000 → −$12.000 = $5.500; histórico correto) |
| 17–18 | Compra válida e compra sem saldo | OK (sem saldo: "Saldo insuficiente…", dinheiro inalterado) |
| 19 | Propriedade comprada permanece | OK (após recarregar a página e carregar o save) |
| 20–23 | Guardar e retirar carro, sem duplicação, integridade preservada | OK (mesmo objeto, 1 exemplar na cena, 62% → 62%, 34% → 34%) |
| 24–28 | Inventário, dinheiro, propriedades, veículos e horário salvos | OK (round-trip completo após recarregar a página) |
| 29–31 | Salvamento manual, autosave e slots independentes | OK (autosave não alterou o Slot 1) |
| 32 | Carregamento restaura o estado | OK (Slot 2 com carro na garagem; troca para o Slot 1 em jogo devolveu o carro à rua e reverteu as posses) |
| 33 | Saves inválidos | OK (tipos errados, versão futura e formato desconhecido recusados; demais slots intactos; mapa inexistente recuperado em Sunset Beach) |
| 34–35 | 1ª e 3ª pessoa | OK |
| 36 | Veículos | OK (dois carros andaram 15–20 m e deram ré; o sedã do Sunny Mart está de frente para a parede, não é regressão) |
| 37–38 | Trânsito e pedestres | OK (9 carros, 16 pedestres ativos) |
| 39 | Arsenal | OK (disparo: pente de 10 → 9) |
| 40 | Estabelecimentos | OK (pizzaria acessível) |
| 41 | Console | sem erros |
| 42 | Desempenho | OK (seção 13) |

Testes automatizados existentes: 49/49. `vite build` sem erros.

## 13. Desempenho

| Medida | Valor |
|---|---|
| Render na rua (frente da Palm Residence) | mínimo 5,8 / mediana 7,7 ms, 552 draw calls |
| Render no Sunset Apartment | mínimo 2,3 / mediana 4,5 ms, 90 draw calls |
| `PropertyManager.update` | 0,002 ms por quadro |
| Radar com marcadores | 0,12 ms por quadro (já atualizava 10×/s) |
| Gravar um slot (validar + IndexedDB + reler) | 20 ms; save de 2,6 KB |
| Carregar um slot (mesmo mapa) | 13 ms |
| Construção de um interior residencial | 8,7–12,1 mil triângulos; carregado só perto da porta |

Os interiores dos imóveis seguem o carregamento seletivo do PROMPT 06 (construídos a até 45 m, liberados além de 120 m). Os marcadores de garagem são 1 grupo leve.

## 14. Problemas encontrados e corrigidos

1. **Guardar carro travava no meio**: `physics.speed` só tem getter. O carro sumia do mundo, mas não era registrado como oculto, e ao retirar nascia um segundo exemplar invisível. Corrigido; agora sempre se reaproveita o objeto original dos carros do mapa.
2. **Trocar de mapa apagava as garagens**: os registros são preservados enquanto o mapa ativo não tem a garagem, e salvos assim.
3. **Cor gravada já escurecida pelo dano**: agora grava a cor base e mantém a base do sistema de danos sincronizada.
4. **Aviso duplicado** "E PRESSIONE E PARA DORMIR": corrigido.
5. **Layouts com móveis bloqueando portas** (aparador, mesa de jantar, chuveiro) e armários cobrindo janelas: corrigidos antes dos testes.

## 15. Pendências

- Troca visual de roupa: depende de variantes do GLB ou de roupas com rig.
- Mapa geral completo com marcadores: o radar já os mostra e os dados ficam disponíveis via `properties.markers()`.
- Áudio dos imóveis: não ouvido na automação, porque o AudioContext fica suspenso sem gesto real.
- Missões: o save tem o campo `missions` e a economia tem `reward()`, sem um sistema de missões nesta etapa.

## 16. Capturas

`docs/screenshots/propriedades/`: 01 Sunset Apartment · 02 Palm Residence · 03 Azure Condo (janela panorâmica) · 04 Ocean Crest Villa (terraço e piscina; capturado antes do ajuste da porta de vidro).

## 17. Recomendações para a próxima etapa

- Atrelar a polícia (PROMPT 08) à economia, para multas pela `EconomyManager`, e ao save, sem apagar propriedades na prisão.
- Na personalização (PROMPT 10), estender o registro do carro (`recordOf`) com as peças e atualizar `appearance.color` e a cor base do sistema de danos.
- Nos barcos (PROMPT 11), seguir o mesmo modelo de garagem, com id persistente e registro antes da remoção.
