# NEON CITY: 1986 — Interiores exploráveis (PROMPT 06)

Todos os nomes, marcas, cardápios, músicas e diálogos são **originais e fictícios**. Não há logotipos, músicas ou arquivos de terceiros.

## 1. Diagnóstico inicial

| Sistema existente | Situação encontrada | Uso nos interiores |
|---|---|---|
| Prédios de Sunset Beach | Geometria fundida em lotes estáticos (poucas draw calls), com colisor sólido por planta. Fachadas e janelas fazem parte do lote | Não foram reconstruídos. O interior é um volume próprio alinhado ao prédio |
| Registro de prédios | `world.districts[].buildings` (id, x, z, rotY, w, d, andares) e POIs `${id}_entrance` | Escolha dos prédios e posição exata da porta |
| Colisão | `CollisionSystem` (caixas giradas, `getGroundHeight` a partir do terreno y = 0) | Colisores do interior, com o piso caminhável em Y = 300 |
| Status | `PlayerStatus`: vida, dinheiro (`spendMoney` recusa saldo insuficiente), relógio do jogo | Reaproveitado para comércio, cura e horários |
| Veículos | `VehicleInteraction` (tecla E, candidato por porta), `VehicleDamage.integrity/repair()` | Arbitragem do E e reparo na oficina |
| Pedestres | `PedestrianRenderer` (instanciado, visual dos anos 80) | Mesmo renderizador para os NPCs internos |
| Áudio | `AudioManager` (WebAudio, buffers de ruído) | Música e ambiência procedurais |
| Salvamento | Não existia | Persistência mínima nova (`localStorage`) |

Abrir fisicamente as fachadas exigiria refazer o lote estático e a colisão de todos os prédios. Isso viola a regra de não reconstruir sem necessidade. Por isso a solução usa **transição curta**: a porta abre, a tela escurece por cerca de 0,25 s e o jogador aparece atrás da mesma porta, dentro do volume interno. **Existe uma transição curta (~0,7 s no total). Não há tela de carregamento.**

## 2. Arquitetura

```
src/interiors/
  InteriorManager.js      registro, fachadas (porta + letreiro), prioridade do E, transições,
                          colisão, iluminação, horários, interações, comércio, sentar,
                          elevador, carregamento seletivo
  InteriorDefinitions.js  10 estabelecimentos + sala de teste (dados, layout, NPCs, diálogos, itens)
  InteriorKit.js          kit modular: casca (piso/paredes/teto/vitrines), porta, mesa, cadeira,
                          banqueta, cabine, sofá, balcão, caixa, prateleira, produtos instanciados,
                          geladeira, TV de tubo, jukebox, planta, arara, luminárias, texturas de texto
  InteriorNPCs.js         NPCs (stand, work, patrol, sit, talk, dance, dj, guard) + navegação A*
  InteriorAudio.js        sequenciador procedural (6 faixas originais) + ambiências + efeitos
  InteriorUI.js           painel de diálogo/compra (1–9, E/Esc)
  InteriorPersistence.js  compras, itens duráveis e locais visitados
```

- **Volume alinhado**: o interior tem o mesmo X/Z e a mesma orientação do prédio real. Suas dimensões são limitadas pela planta (`min(tamanho, planta − 0,8 m)`), e a porta interna fica exatamente atrás da porta da fachada. Ele é construído em Y = 300 (`INTERIOR_ALT`), onde o piso caminhável prevalece sobre o terreno.
- **Vitrines internas** têm persianas iluminadas com a cor do estabelecimento, para nunca mostrar uma rua diferente da real.
- **Novo estabelecimento** (delegacia, farmácia, cinema…): basta acrescentar uma definição com `layout(b, ctx)` e `npcs(inst)` em `InteriorDefinitions.js`, sem alterar o gerenciador.
- **Integração no jogo** (`Game.js`): `interiors.preUpdate` roda **antes** de `vehicles.preUpdate`, para decidir quem usa o E; `interiors.update` roda depois das câmeras; `onMapActivated` troca as fachadas a cada mapa.

## 3–4. Estabelecimentos e localização

Todos ficam em Sunset Beach, na fileira de prédios da rua comercial a leste (x ≈ −59, porta para oeste), mais dois na faixa oeste (x ≈ −81).

| # | Estabelecimento | Prédio | Porta (x, z) | Interior (m) | Horário | Classificação |
|---|---|---|---|---|---|---|
| 1 | SUNSET SLICE PIZZA (pizzaria) | bld_e_back_5 (já tinha neon "Pizza") | −59, −18 | 13 × 14 × 3,6 | 11h–2h | **Completo e testado** |
| 2 | PALM MART (mercado) | bld_e_back_8 | −59, 88 | 20 × 14,5 × 3,8 | 7h–23h | **Completo e testado** |
| 3 | SUNSET AUTO WORKS (oficina) | bld_e_back_10 | −59, 158 | 17 × 14,5 × 5 | 8h–20h | **Completo e testado** |
| 4 | NEON PARADISE (boate) | bld_e_back_7 | −59, 52 | 22 × 14,5 × 4,6 | 18h–5h | **Completo e testado** |
| 5 | ELECTRIC FEVER (discoteca) | bld_e_back_4 | −59, −44 | 22 × 14,5 × 4,4 | 18h30–4h | **Completo e testado** |
| 6 | OCEAN STYLE (roupas) | bld_e_back_6 | −59, 19 | 15 × 13 × 3,6 | 9h–22h | **Parcialmente implementado** (provar roupa no protagonista pendente) |
| 7 | BLUE HORIZON BAR | bld_e_back_2 | −59, −115 | 16 × 13 × 3,4 | 16h–4h | **Completo e testado** |
| 8 | AZURE PALMS HOTEL | bld_e_back_1 (já tinha placa "HOTEL") | −59, −150 | 20 × 14 + 3º andar | 24h | **Completo e testado** |
| 9 | MOONLIGHT DINER (lanchonete) | bld_sw_4 | −81, 162 | 13 × 16 × 3,6 | 24h | **Completo e testado** |
| 10 | VOLTAGE ELECTRONICS | bld_nw_3 | −81, −155 | 16 × 15 × 3,6 | 9h–21h | **Completo e testado** |
| T | SALA DE TESTE (TEST CITY) | prédio próprio (−6, −30), GLB intocado | — | 9 × 8 × 3,4 | 24h | **Completo e testado** |

"Completo e testado" quer dizer que cada um tem entrada, saída, colisão, iluminação, NPCs, diálogos, interação e áudio próprios, todos exercitados no navegador (seção 15).

### Conteúdo por estabelecimento
- **Pizzaria**: balcão com caixa e pizzas, cozinha com forno a lenha (brilho e poça de luz), bancada de preparo, geladeira, cardápio na parede, neon "SLICE OF HEAVEN", 3 cabines e 9 mesas com cadeiras e pendentes. NPCs: atendente Gina, cozinheiro Tony (patrulha), 5 clientes. Interações: falar e pedir, consultar cardápio, geladeira de bebidas. A pizza comprada aparece no balcão e pode ser comida (E).
- **Mercado**: 3 corredores de prateleiras duplas com cerca de 900 produtos instanciados (latas e caixas), parede de geladeiras com garrafas, freezer, carrinhos, 2 caixas, placas de seção e porta do depósito **trancada**. NPCs: caixa Rosa, repositor Beto, 3 clientes. Interações: pegar produtos (cesta), geladeiras, pagar no caixa.
- **Oficina**: elevador automotivo com carro em manutenção, segundo carro aguardando (ambos da fábrica de veículos, apenas decorativos), portão de garagem, faixas no piso, bancada, painel de ferramentas, armários, pneus, rodas na parede, compressor e recepção com cadeiras. NPCs: mecânico Ray, ajudante, recepcionista Lia, cliente sentado. O **reparo usa a integridade real** do veículo do jogador estacionado na vaga em frente.
- **Boate**: pista 6 × 5 com células animadas no ritmo, cabine do DJ com caixas, bar com garrafas e 5 banquetas, lounges, área VIP com corda, espelhos, faixas de neon, fumaça, banheiro com porta e as 2 luzes reais pulsando no BPM. NPCs: DJ Starlight, bartender Kiko, segurança Marcus, 6 dançarinos (3 estilos), convidados.
- **Discoteca**: piso quadriculado colorido animado, globo espelhado com reflexos girando, painéis geométricos, luzes de piso, palco com dançarina, cabine de som, sofás e bar de sucos. Luzes trocam de cor no BPM 122. NPCs: DJ Funky Ray, dançarina, 9 dançarinos, Dora e convidados.
- **Roupas**: manequins na vitrine, 6 araras, prateleiras de roupas dobradas, espelhos, balcão e 3 provadores com **portas de correr**. NPCs: vendedora Vicky, estilista e clientes. Compras são duráveis e únicas.
- **Bar**: balcão de 12 m com 12 banquetas, parede de garrafas com espelho, neon, TV de tubo com programa animado, jukebox, mesas em 3 fileiras e banheiro com porta. NPCs: bartender Sal, garçonete Nina e clientes.
- **Hotel**: saguão com recepção, painel de chaves, colunas, lustre, lounge, tapete, plantas e 2 elevadores. **3º andar** com corredor e portas 303/305 **trancadas** ("Ocupado"). O 304 abre e é o quarto modelo, com cama, criados-mudos com abajur, cômoda com TV, poltrona com assento, janela com persianas e **banheiro com porta** (vaso, pia, espelho, box). O interruptor apaga e acende as luzes; deitar na cama dá +5 de vida. NPCs: recepcionista Claire, mensageiro Teo, hóspedes e camareira (no 3º andar).
- **Lanchonete**: piso quadriculado instanciado, balcão de 10 m com 7 banquetas, cozinha com chapa, cardápio iluminado, 5 cabines, jukebox, máquina de refrigerante e neon de lua. NPCs: garçonete Dolly, cozinheiro Hank, atendente June e clientes.
- **Eletrônicos**: parede com 15 TVs de tubo (tela de teste e programa animados), ilha com 4 rádios portáteis, prateleira de aparelhos, 3 computadores domésticos fictícios com tela verde, balcão e pôster. NPCs: vendedor Max, funcionário e clientes.

## 5. Arquivos criados
- `src/interiors/InteriorManager.js`
- `src/interiors/InteriorDefinitions.js`
- `src/interiors/InteriorKit.js`
- `src/interiors/InteriorNPCs.js`
- `src/interiors/InteriorAudio.js`
- `src/interiors/InteriorUI.js`
- `src/interiors/InteriorPersistence.js`
- `docs/INTERIORES.md` e `docs/screenshots/interiores/*.jpg` (15 capturas)

## 6. Arquivos modificados (alterações incrementais e reversíveis)

| Arquivo | Alteração |
|---|---|
| `src/core/Game.js` | import, criação de `this.interiors`, `onMapActivated`, `preUpdate` antes dos veículos e `update` depois das câmeras (6 linhas) |
| `src/config.js` | bloco `interiors` (ignoreHours, preloadDistance 45 m, unloadDistance 120 m) |
| `src/vehicles/VehicleInteraction.js` | a pé, aviso e E do carro só quando `suppressed` é falso (interior mais próximo tem prioridade) |
| `src/weapons/WeaponManager.js` | sem mira e sem disparo com o jogador sentado, em transição (`player.external`) ou com o painel aberto |
| `src/player/PlayerAnimator.js` | `seatHands === 'lap'`: mãos sobre as coxas ao sentar em cadeiras (o volante continua igual) |
| `src/styles/main.css` | estilos `.int-panel` e `.int-fade` |
| `src/dev/TestHarness.js` | auxiliares de teste (somente em dev): `enterInterior`, `interiorAt`, `interiorView`, `worldView`, `interiorShot`, `boot` |
| `docs/CONTROLES.md` | controles dentro dos estabelecimentos, conflito E carro × porta, `?interiors=open` |

O GLB da TEST CITY e a geometria dos mapas externos **não foram alterados**. Em Sunset Beach só foram acrescentados porta e letreiro na frente das fachadas existentes.

## 7. Sistema de portas
- **Fachada**: folha com pivô e vidro emissivo. Abre ao entrar e sair, e mostra o aviso "PRESSIONE E PARA ENTRAR · NOME" ou "NOME · FECHADO (abre às HH:MM)" com som de recusa. A porta só aciona de frente e a até 1,9 m.
- **Porta interna da entrada**: folha de vidro animada, com colisor no vão. Não se sai do volume andando: a saída é pela interação "SAIR".
- **Portas internas** (`innerDoor`), cada uma com estado, pivô, colisor próprio (desligado quando aberta), animação, som e tranca:
  - giratória simples: banheiros, quartos 303/304/305, depósito;
  - de correr: provadores;
  - de enrolar (`roll`): suportada pelo animador, ainda sem uso.
- **Proteções**: a porta não fecha com o jogador no vão. Uma porta trancada mostra o motivo ("SOMENTE FUNCIONÁRIOS", "OCUPADO — NÃO PERTURBE"). A interação funciona em qualquer andar.
- **Tipos pedidos**: simples, dupla (largura 1,6 m na boate, discoteca, mercado e hotel), vidro (todas as fachadas), correr (provadores), garagem (portão decorativo da oficina) e serviço (depósito trancado).

## 8. Sistema de interações
- Uma única tecla, **E**, com prioridade contextual. Por quadro, o alvo é o de menor pontuação (distância − 0,4 × alinhamento com o olhar), dentro do raio de cada ponto, com tolerância de altura (andares). Os alvos possíveis são: saída, pontos do layout, comida no balcão, portas e, por último, assentos livres.
- **Fora**: a porta do prédio e a porta do carro competem pela distância; a mais próxima vence e o aviso mostra qual será usada.
- **Sentar e levantar**: cadeiras, banquetas, cabines, sofás e a poltrona do hotel. Pose sentada com IK das pernas até o piso e mãos no colo. Ao levantar, o jogador volta 0,65 m à frente, sobre o piso.
- **Painel**: opções 1–9, E/Esc para fechar, saldo visível. Fecha sozinho se o jogador se afastar mais de 3,5 m.
- **Elevador** do hotel: transição curta para o 3º andar e de volta.

## 9. NPCs
- Reaproveitam o `PedestrianRenderer` (mesmos visuais e esqueleto dos pedestres). Uniformes por função sobrescrevem o visual aleatório. Há um renderizador próprio com 18 vagas, e só o interior ativo é simulado.
- Comportamentos:
  - parado/atendendo (`stand`) e trabalhando (`work`);
  - patrulha com espera nos pontos;
  - sentado e conversando;
  - dança, em 3 estilos sincronizados ao BPM;
  - DJ e segurança.
- Os NPCs olham para o jogador a menos de 3 m e se assustam com disparos (evento `gunshot`).
- **Navegação**: as rotas de patrulha são calculadas numa grade de 0,3 m gerada dos colisores (A* com 8 vizinhos, sem cortar quinas, suavizada por linha de visada, raio do NPC 0,28 m). Teste: 0 amostras de rota e 0 posições simuladas (20 s) dentro de móveis, nos 10 interiores.
- 70 NPCs nos 10 estabelecimentos (+1 na sala de teste). Exemplos: Gina, Tony, Rosa, Beto, Ray, Lia, DJ Starlight, Kiko, Marcus, DJ Funky Ray, Dora, Vicky, Sal, Nina, Claire, Teo, Dolly, Hank, June e Max.

## 10. Áudio (100% procedural e original)
- 6 faixas sintetizadas em tempo real (bumbo, palmas, chimbal, baixo, acordes, stabs de disco, arpejo e piano de lounge):
  - "Neon Paradise", 112 BPM;
  - "Electric Fever", 122 BPM;
  - "Azure Lobby", 84 BPM;
  - "Sunrise Boulevard", 118 BPM;
  - "Pastel Nights", 92 BPM;
  - "Turbo Coast", 128 BPM.
- Ambiências por tipo: conversa, louça, bipes de caixa, ferramentas, zumbido de geladeira, rumor da oficina.
- **Fora do prédio**, o som sai abafado (passa-baixa de 260 a 760 Hz) e atenuado até 40 m.
  - Valores medidos na discoteca: a 30 m, ganho 0,25 e 260 Hz; a 10 m, 0,41 e 343 Hz; a 2 m, 0,52 e 677 Hz; dentro, 0,9 e 18 kHz.
  - A porta da fachada aberta reduz a atenuação.
- Efeitos: porta, sininho, caixa registradora, recusa, geladeira, elevador, ferramenta.
- O DJ e as jukeboxes trocam a faixa.

## 11. Iluminação
- Luz por tipo de estabelecimento: céu e solo do hemisfério, exposição, cor das vitrines, até **2 PointLights** (reaproveitadas de um pool) e "poças de luz" falsas aditivas no piso, sem custo de iluminação.
- Dentro, o sol fica desligado e sem sombras, e o mapa de ambiente do céu cai para 0,1, para não tingir o interior de pôr do sol. Tudo é restaurado ao sair (valores conferidos antes e depois).
- Emissivos: luminárias, letreiros, painéis de teto, pista, jukebox, TVs.
- A boate e a discoteca pulsam as 2 luzes reais no BPM. O hotel tem interruptor.

## 12. Comércio (dinheiro existente do `PlayerStatus`)
- `spendMoney` recusa saldo insuficiente com mensagem e som. Itens `unique` não são comprados duas vezes, e o item fica desabilitado na lista.
- Comida cura na hora ou aparece no balcão para comer (pizza, hambúrguer).
- Mercado: cesta, pagamento no caixa e opção de esvaziar. Se o pagamento for recusado, a cesta é mantida.
- Oficina: reparo de $3 por ponto de integridade (mínimo $40), cobrado só se houver dano.
- Roupas e eletrônicos: itens duráveis registrados no guarda-roupa ou inventário (`InteriorPersistence`).

## 13. Otimizações
- Geometria fundida por material (o kit acumula e funde no `build()`), produtos e piso por `InstancedMesh`, materiais compartilhados em cache.
- **Carregamento seletivo**: o interior é construído a até 45 m da porta (no máximo um por meio segundo) e liberado além de 120 m, junto com geometria, texturas, colisores e carros decorativos. Construção levou entre 8 e 36 ms por interior.
- Dentro: o mundo externo, o oceano, o trânsito, os pedestres, a polícia e as fachadas não são desenhados. Os pedestres e a polícia reativam a própria visibilidade a cada quadro, por isso o interior volta a ocultá-los (boate: de 110 para 75 draw calls).
- Áudio: a automação de volume e filtro só é agendada quando o alvo muda. Antes ela era agendada a cada quadro e custava 0,6–0,9 ms; agora custa cerca de 0,005 ms.

## 14. Desempenho (medido no navegador; tempo de render com `gl.finish`)

| Local | Draw calls | Triângulos | Render mín / mediana (ms) |
|---|---|---|---|
| Rua em frente à pizzaria | 761 | 695 mil | 7,3 / 9,5 |
| Pizzaria | 110 | 118 mil | 1,5 / 1,9 |
| Mercado | 111 | 160 mil | 1,3 / 2,5 |
| Oficina | 152 | 125 mil | 2,2 / 3,9 |
| Boate | 109 | 130 mil | 1,8 / 3,1 |
| Discoteca | 136 | 132 mil | 1,7 / 3,7 |
| Roupas | 105 | 129 mil | 1,7 / 4,3 |
| Bar | 110 | 123 mil | 1,5 / 1,8 |
| Hotel | 106 | 100 mil | 1,4 / 2,6 |
| Lanchonete | 84 | 104 mil | 1,4 / 2,2 |
| Eletrônicos | 104 | 110 mil | 1,3 / 1,9 |

- Os triângulos incluem o protagonista (GLB) e os NPCs. A medição é anterior à correção de visibilidade dos pedestres, que reduziu ainda mais as draw calls dentro.
- CPU do sistema de interiores: 0,12–0,17 ms por quadro (rua e discoteca). O passo de simulação completo foi de cerca de 3,1–3,4 ms por quadro tanto fora quanto dentro.
- Memória da GPU estável após 5 ciclos de entrar, sair e descarregar (715 geometrias e 98 texturas, antes e depois).
- Os valores variam com a carga da máquina: a automação limita o rAF a cerca de 1 FPS no navegador, por isso o custo foi medido por quadro, não por FPS.

## 15. Testes executados (Chrome, servidor de desenvolvimento, `?interiors=open`, harness `__NEON_TEST__`)

| # | Teste | Resultado |
|---|---|---|
| 1 | O jogo inicia | OK (`boot` → estado `playing`) |
| 2 | Sunset Beach carrega | OK (10 fachadas registradas) |
| 3 | TEST CITY funciona | OK (sala de teste: entrar, comprar, sentar, sair) |
| 4 | Caminhar | OK (3,07 m em 1 s, dentro da pizzaria) |
| 5 | Correr | OK (3,33 m em 0,5 s) |
| 6 | Pular | OK (altura 1,01 m; aterrissa no piso, y = 300) |
| 7–9 | 1ª pessoa, 3ª pessoa e tecla V | OK (3ª → 1ª → 3ª dentro do interior) |
| 10–13 | Aproximação, aviso, porta abre, jogador entra | OK nos 10 estabelecimentos e na sala de teste |
| 14 | Interior carrega corretamente | OK (jogador sobre o piso, 0 sólidos sobrepostos) |
| 15 | Iluminação | OK (capturas; valores restaurados ao sair) |
| 16 | Áudio | Parcial: lógica de ganho e filtro conferida; síntese renderizada offline com sinal audível sem clipping (RMS 0,04–0,08, pico até 0,56). **Não ouvi o som real**: sem gesto humano, o navegador automatizado mantém o AudioContext suspenso |
| 17 | Não atravessa paredes | OK (corrida de 3,5 s contra as 4 direções nos 10 interiores; nunca saiu do volume) |
| 18 | Móveis com colisão | OK (mesa bloqueia a 0,68 m do centro; ilha, carros, balcões) |
| 19–20 | NPCs aparecem e se movem | OK (4–14 por interior; patrulhas andam 8–16 m em 20 s) |
| 21 | NPCs não atravessam móveis | OK depois da navegação A* (antes falhava em 5 interiores; corrigido) |
| 22–23 | Diálogos e interações | OK (36 pontos acionados pelo E, cada um abre a página correta) |
| 24–25 | Sentar e levantar | OK (pose sentada conferida na captura; levanta sem entrar em sólidos) |
| 26 | Comércio | OK (compra, saldo insuficiente, cesta, item único, reparo $270 de 10% → 100%) |
| 27–28 | Sair e voltar à posição externa | OK (1,35 m à frente da porta, de costas para o prédio) |
| 29 | Veículos | OK (entrou, dirigiu 12,5 m, freou e saiu depois de usar os interiores) |
| 30 | Trânsito | OK (oculto dentro, visível de novo fora) |
| 31 | Arsenal | OK (disparo dentro assusta os NPCs; disparo fora: munição 9 → 8; bloqueado sentado) |
| 32 | HUD sem conflitos | OK (aviso único por contexto; 1–9 do painel não trocam de arma) |
| 33 | Interiores distantes não consomem recursos | OK (descarregados além de 120 m; contadores de construção e descarte iguais) |
| 34 | Console sem erros | OK (nenhum erro ou exceção registrado) |
| 35 | Desempenho aceitável | OK (seção 14) |

Também testados:
- horário fechado (21h na oficina): aviso e recusa da entrada;
- prioridade E carro × porta;
- elevador nos dois sentidos;
- portas trancadas;
- banheiro do hotel;
- interruptor;
- persistência após recarregar a página (o item comprado continua registrado e o dinheiro não é devolvido);
- `npx vite build` sem erros.

O save de teste foi apagado ao final.

## 16. Pendências e limitações
- **Provar roupas**: o protagonista importado é um GLB com roupa única (uma textura, sem peças separadas). Trocar o visual exige variantes do modelo ou malhas de roupa com rig, por isso a loja só registra a compra.
- **Áudio real**: não ouvido na automação (ver teste 16). Recomendo ouvir no navegador com um clique real.
- **Transição**: há um escurecimento curto. A conexão física contínua com a rua não é viável sem refazer os lotes estáticos dos prédios.
- O carro do jogador não entra na oficina (dirigir dentro foi vetado). O serviço é feito com o carro estacionado na vaga em frente ao portão.
- Inventário de eletrônicos e roupas: apenas registrado. O uso dos itens depende de uma etapa futura.
- Os dois carros da oficina são decorativos (não dirigíveis).

## 17. Capturas (`docs/screenshots/interiores/`)

| Arquivo | Conteúdo |
|---|---|
| 01_pizzaria_fachada.jpg | Fachada com letreiro "Sunset Slice" abaixo do neon original e porta |
| 02_pizzaria_salao.jpg | Salão, cozinha, forno, cardápio, clientes |
| 03_pizzaria_dialogo_compra.jpg | Painel de compra com a atendente |
| 04_mercado_palm_mart.jpg | Corredores, caixas, geladeiras, depósito |
| 05_oficina_sunset_auto.jpg | Elevador com carro, mecânico, bancada, recepção |
| 06_boate_neon_paradise.jpg | Pista animada, DJ, bar, VIP |
| 07_discoteca_electric_fever.jpg | Globo espelhado, piso colorido, palco |
| 08_roupas_ocean_style.jpg | Araras, manequins, vitrine com persianas |
| 09_bar_blue_horizon.jpg | Balcão, garrafas, mesas, jukebox |
| 10_hotel_azure_palms_saguao.jpg | Saguão, lounge, elevadores |
| 10b_hotel_quarto_304.jpg | Quarto modelo e banheiro |
| 11_test_city_predio.jpg | Prédio de teste na TEST CITY |
| 12_test_city_interior.jpg | Sala de teste por dentro |
| 13_lanchonete_moonlight_diner.jpg | Piso quadriculado, balcão, cabines |
| 14_eletronicos_voltage.jpg | Parede de TVs, computadores, ilha de rádios |
