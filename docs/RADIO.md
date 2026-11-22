# PROMPT 14 — NEON RADIO NETWORK

Rede de oito emissoras fictícias com programação contínua, DJs, vinhetas, comerciais e notícias que reagem ao jogo. Inclui a **roleta de rádios** pedida durante a etapa: no veículo, o scroll abre um círculo de logotipos; depois de 2 s sem interação, a roleta some e a estação destacada passa a tocar.

**Todo o conteúdo é original, e nenhum arquivo foi baixado:**
- **Músicas:** compostas por algoritmo, por um sintetizador escrito para o projeto (`tools/radio/synth.mjs`).
- **Vozes:** sintetizadas localmente com as vozes do Windows (Microsoft Maria pt-BR e Zira en-US), com tratamento de tom e equalização para criar cada locutor.
- **Textos:** roteiros de DJs, comerciais e notícias escritos para o projeto (`tools/radio/content.mjs`).

## 1. Arquitetura encontrada (auditoria)

| Item | Situação |
|---|---|
| Áudio | `AudioManager`: um AudioContext único, criado no primeiro clique ou tecla (regra do navegador). Os módulos de motor, armas, sirenes, buzinas, barcos e interiores ligam-se ao `master`. |
| Teclas | **Q = buzina** (preservada) e **setas = esterçar/acelerar** (preservadas). O scroll a pé troca de arma; dentro de veículos estava livre. |
| Eventos | `UrbanEvents`: `policeAlert`, `policeEscape`, `policeRespawn`, `gunshot`, `pedHit`, `propBreak`, `siren`, `horn`. Nível de procurado em `PlayerStatus`. |
| Dia e noite | `World.timeOfDay` com presets e relógio acelerado (1 min de jogo por segundo real). |
| Save | IndexedDB com seções versionadas (`SaveManager`/`SaveSchema`). |
| Interiores | Pizzaria, mercado, oficina, eletrônicos e duas residências **sem música**. As boates, a loja de roupas, o bar, o hotel e a lanchonete têm música própria, que foi preservada. |
| Barcos | PROMPT 11 implementado (`BoatManager.aboard`). |
| Arquivos de áudio | Nenhum no projeto antes desta etapa, portanto nada de licença a verificar. |
| Testes | Node 67/67 antes da etapa. |

## 2. Arquitetura implementada

`src/audio/radio/`:

| Módulo | Responsabilidade |
|---|---|
| `RadioStations.js` | Registro das 8 emissoras + RADIO OFF a partir do catálogo, com regras de programação por emissora e logotipos SVG originais. |
| `RadioScheduler.js` | **Relógio central** e **programação contínua**. É a IA dos locutores: uma máquina de estados com memória de repetição e uma fila de conteúdos disparados por eventos. Salva e restaura o estado. |
| `RadioNews.js` | Ponte de eventos (só consome). Transforma acontecimentos em notícias da CITY TALK, com atraso editorial e intervalo mínimo, e em reações dos DJs. |
| `RadioPlayback.js` | Receptor único: 3 tocadores fixos por streaming (A e B para os segmentos, V para a locução sobre a música), rampas de ganho, pré-carregamento, correção de deriva e saídas direta, espacial (PannerNode) e de interior. |
| `RadioUI.js` | Roleta de rádios (scroll) e faixa da estação (logotipo, frequência, nome, gênero e o que toca). |
| `RadioManager.js` | Integração: carro, lancha, interior, carro estacionado e carro de NPC; teclas; sirene; save. |
| `radio-catalog.json` | Catálogo gerado com ID, título, artista, emissora, **duração real (ffprobe)**, caminho, licença e metadados. |

`AudioManager` ganhou canais (**geral, música, rádio, vozes, efeitos, ambiente**). O antigo `master` virou o canal de efeitos, então os motores, armas, sirenes, buzinas e barcos continuam ligados exatamente como antes. Os sons do mar, da brisa e da cidade foram para o canal de ambiente, e a música dos estabelecimentos para o canal de música. Os controles ficam em **P → Configurações**. Não há um segundo sistema de áudio.

## 3. Emissoras e conteúdo real

| Emissora | Gênero | DJ | Músicas (duração real) | Falas | Vinhetas |
|---|---|---|---|---|---|
| NEON FM 86.1 | Synthwave · Synthpop | DJ VIOLET | 4 (127/132/131/130 s) | 29 | 3 + 1 instrumental |
| GROOVE 98.5 | Funk · Disco · Boogie | TONY FLASH | 4 (119/115/114/113 s) | 29 | 3 + 1 |
| THUNDER ROCK 104.3 | Rock · Hard Rock | JACK VOLT | 4 (106/100/102/100 s) | 29 | 3 + 1 |
| STREET BEAT 92.7 | Electro · Hip-Hop · Breakbeat | MC RICO | 4 (135/124/131/127 s) | 29 | 3 + 1 |
| OCEAN BREEZE 101.2 | Soft Rock · Baladas | LISA MOON | 4 (163/169/159/163 s) | 29 | 3 + 1 |
| TROPICAL CALIENTE 95.4 | Latina · Tropical | CARLOS SOL (bilíngue) | 4 (126/133/129/136 s) | 31 (2 em inglês) | 3 + 1 |
| CITY TALK 88.9 | Notícias · Entrevistas · Humor | FRANK HOLLOWAY | — (formato falado) | 18 + 26 notícias + 3 chamadas + 6 programas | 3 + 1 |
| MIDNIGHT JAZZ 90.6 | Jazz · Fusion | NORA BLUE | 4 (137/148/119/113 s) | 29 | 3 + 1 |

**Totais:**

| Tipo | Quantidade |
|---|---|
| Músicas | 28 (60 min) |
| Falas de DJ | 223 |
| Vinhetas | 24 com voz + 8 instrumentais |
| Comerciais | 12 (NEON CUSTOMS, SUNSET SLICE PIZZA, NEON PARADISE, SUNSET AUTO WORKS, AZURE PALMS HOTEL, SUNSET MARINA, com 2 versões cada) |
| Notícias | 26 (17 ligadas a eventos, 9 de ambientação) + 3 chamadas de plantão |
| Programas da CITY TALK | 6 (debates, entrevista e ouvintes) |
| Tamanho | ~42 MB em Opus |

Cada faixa tem uma apresentação gravada específica ("Agora, Iron Coast, com Highway Thunderbolt"). A geração é refeita com `npm run build:radio`.

**Atenção à quantidade:** são **4 músicas por emissora musical**. É conteúdo real e audível, mas pouco para uma rádio de verdade. A estrutura aceita mais faixas: basta acrescentá-las em `content.mjs` e gerar de novo.

## 4. Continuidade e relógio

- **Tempo de rádio** = origem persistida + tempo real monotônico da sessão (`performance.now`). Não usa o relógio acelerado do dia/noite: uma faixa de 2 min dura 2 min.
- O tempo continua contando com o menu aberto e com a aba em segundo plano, como uma rádio real. Ao voltar, a posição é corrigida se tiver se desviado mais de 1 s.
- Cada emissora tem um estado próprio, recalculado virtualmente quando é consultada. **Nenhum áudio toca para avançar a programação**; só a emissora ouvida é decodificada, por streaming.
- Uma partida nova começa em um ponto aleatório da programação de cada emissora, nunca na 1ª faixa. Ao carregar um save, o relógio e o estado de cada emissora voltam exatamente ao ponto salvo.

## 5. IA dos locutores (local, determinística, sem rede)

- **Emissoras musicais:** música → (fala do DJ: comentário, horário ou retorno · vinheta) → música. A cada 2 a 4 músicas há um intervalo: chamada → 1 ou 2 comerciais → vinheta. Às vezes o DJ apresenta a faixa por cima da introdução, com a música abaixada.
- **CITY TALK:** blocos de vinheta, abertura, notícias, programa, comentário, horário e comerciais.
- **Memória:** as últimas faixas, falas, comerciais, vinhetas, notícias e programas não se repetem enquanto houver alternativas. Nas simulações de 3 horas, não houve nenhuma faixa repetida em seguida.
- **Eventos:** o conteúdo entra no próximo intervalo entre segmentos e nunca corta uma música.

## 6. Notícias e polícia

| Evento do jogo | Notícia (atraso editorial · intervalo mínimo) |
|---|---|
| Procurado ≥ 2 por 15 s | perseguição (40 s · 5 min) |
| `policeEscape` | fuga (25 s · 4 min) |
| `policeRespawn` com prisão | prisão (25 s · 4 min) |
| Disparo do jogador | tiros (30 s · 4 min) |
| `pedHit` | atropelamento (30 s · 4 min) |
| 5 objetos quebrados em 60 s | vandalismo (45 s · 5 min) |
| Embarcar num barco | movimento no mar (60 s · 10 min) |
| Mudança de turno | noite ou manhã (15 s · 15 min) |

- **Formato:** cada notícia vai ao ar com uma chamada de plantão antes. Nenhuma revela a posição do jogador.
- **Reações dos DJs:** cerca de 60% dos DJs musicais comentam perseguições e tiros; a decisão é fixa por emissora.
- **Só escuta:** o rádio não chama nenhuma função da polícia.

## 7. Áudio espacial, veículos, barcos, interiores e NPCs

| Situação | Comportamento |
|---|---|
| **No carro** | Saída direta com equalização de alto-falante; mistura com o motor (canal de efeitos). Com uma viatura a menos de 40 m, o rádio cai para 70%, e a sirene não é abaixada. |
| **Fora do carro** | O rádio do último carro continua audível pelo PannerNode (HRTF, distância inversa, abafado em 2,4 kHz) até 30 m. Ganho teórico: 0,54 a 4 m e 0,07 a 25 m. A 40 m desliga, mas a programação segue virtualmente. |
| **Carros de NPC** | Cada carro do trânsito recebe uma emissora fixa (ou rádio desligado). A pé, o carro de NPC mais próximo (até 12 m) se ouve por áudio espacial. É **uma fonte por vez**. Ao entrar num carro de NPC, a estação dele já está selecionada. |
| **Barcos** | Lanchas, barco de pesca, cruzeiro e iate têm rádio; o jet ski não tem. Os controles do barco não mudaram. |
| **Interiores** | SUNSET SLICE PIZZA (Tropical Caliente), PALM MART (Ocean Breeze), SUNSET AUTO WORKS (Thunder Rock), loja de eletrônicos (Street Beat) e duas residências (NEON FM e Midnight Jazz), com saída de interior abafada. Boates, bar e outros locais com música própria continuam com a programação deles. |

## 8. Persistência

- **Save, seção `radio`:** estação escolhida (ou desligado), relógio, estado de cada emissora (segmento, plano, memória, contadores e semente) e fila de notícias. São só dados simples, sem AudioNodes nem buffers. Saves antigos sem essa seção continuam válidos.
- **Volumes por canal:** ficam no `localStorage`, como preferência do jogador.

## 9. Testes executados

- **No jogo:** `await __NEON_TEST__.radioSuite()` com os 32 testes obrigatórios deu **32/32 em três execuções consecutivas**. Destaques:
  - **Continuidade:** depois de 5 min fora, a NEON FM estava em outra faixa, e a posição esperada e a do elemento conferiram (107,6 s e 107,6 s).
  - **Roleta:** abriu com o scroll, destacou a GROOVE, fechou depois de 2 s e a GROOVE passou a tocar.
  - **DJ:** a locução do JACK VOLT tocou por cima da música, com a música a 42% do volume.
  - **Perseguição:** registrada, atraso editorial respeitado e notícia no ar em seguida, com a chamada antes.
  - **Arquivo inexistente:** marcado como falho, e o jogo seguiu.
  - **Memória:** depois de 24 trocas de estação, continuaram os mesmos 3 tocadores; o heap foi de 154 para 156 MB.
  - **Custo:** o `RadioManager.update` gasta em mediana menos de 0,1 ms por quadro (p95 0,1 ms).
- **Node:** `npm run test:radio` deu 6/6. Cobre catálogo e arquivos, duração conferida com o ffprobe, continuidade, 3 h de programação sem repetir, notícia com atraso editorial e persistência.
- **Regressão:** Node 73/73 · OCEAN DRIVE 45/45 · NEON MOTOR 153/153 · `vite build` OK.

**Limites da verificação:**
- **Não ouvi o resultado.** O conteúdo foi checado por espectrograma, energia RMS e reprodução real dos elementos de áudio com ganho no canal do rádio. A qualidade musical e a das vozes precisa do seu ouvido.
- **"Cinco minutos caminhando"** foi simulado adiantando o relógio do rádio.
- **"Trocar de aba"** foi simulado com 3 s sem quadros do jogo.

## 10. Bugs encontrados e corrigidos

| Problema | Correção |
|---|---|
| Mixagem das vinhetas e comerciais falhava no ffmpeg (a mesma entrada era usada duas vezes no filtro) | `asplit` |
| Geração interrompida deixava um arquivo inválido | O build agora valida os arquivos e gera de novo os inválidos |
| Vinheta de emissoras com cordas na melodia (GROOVE) | Corrigido o tipo de instrumento |
| Histórico do agendador cortava registros nas simulações longas | Limite configurável |
| A roleta dependia do tempo do jogo, e com o quadro lento passava muito de 2 s | Usa tempo real |
| Ao sintonizar, o primeiro ajuste ainda tocava a estação anterior por um quadro | A fonte passa a ser trocada na hora |

## 11. Classificação

| Recurso | Status |
|---|---|
| Oito emissoras + RADIO OFF | Implementado e testado |
| Programação contínua e relógio | Implementado e testado |
| Roleta de rádios (scroll, 2 s) e troca de estação | Implementado e testado |
| Faixa da estação (HUD) | Implementado e testado |
| DJs com falas, vinhetas e apresentação sobre a música | Implementado e testado (vozes sintetizadas, 223 falas) |
| Comerciais | Implementado e testado |
| Notícias por eventos e integração com a polícia | Implementado e testado |
| Memória anti-repetição | Implementado e testado |
| Mistura com motor e sirenes | Implementado e testado |
| Rádio fora do carro (espacial) | Implementado e testado |
| Rádio em interiores | Implementado e testado (6 locais) |
| Rádio em barcos | Implementado e testado |
| Rádio dos NPCs | Implementado e testado (uma fonte por vez) |
| Volumes por canal | Implementado e testado |
| Persistência | Implementado e testado |
| Boates com música própria | Não aplicável (preservadas como estavam) |
| Biblioteca musical | **Parcialmente implementado**: 4 faixas por emissora musical, real mas pequena |
| Geração de texto por IA externa | Não aplicável (não usada; a IA é local) |

## 12. Pendências reais

- **Mais músicas:** só 4 por emissora; com o tempo a repetição fica perceptível.
- **Vozes:** são as vozes do Windows, com sotaque e entonação de síntese.
  - Os locutores masculinos foram feitos abaixando o tom de uma voz feminina, e o resultado é perceptivelmente artificial.
  - Quanto à licença: a geração foi local, mas os termos da Microsoft para distribuir esse áudio comercialmente não foram verificados. Para um lançamento público, o recomendado é trocar por vozes gravadas ou licenciadas.
- **Notícias dinâmicas:** variam por tipo de evento, mas o texto é pré-gravado, então não citam detalhes específicos, por exemplo a quantidade de estrelas.
- **Desktop e Linux:** a Release v0.1.0 não tem o rádio.

## Arquivos

- **Criados:**
  - `src/audio/radio/`: `RadioStations.js`, `RadioScheduler.js`, `RadioNews.js`, `RadioPlayback.js`, `RadioUI.js`, `RadioManager.js` e `radio-catalog.json`;
  - `tools/radio/`: `content.mjs`, `synth.mjs`, `build-radio.mjs`, `tts.ps1` e `radio.test.mjs`;
  - `src/dev/RadioSuite.js`;
  - `public/audio/radio/**`, com 330 arquivos Opus;
  - `docs/RADIO.md` e `docs/screenshots/radio/`.
- **Modificados (só acréscimos):**
  - `src/audio/AudioManager.js` (canais);
  - `src/interiors/InteriorAudio.js` (canal de música);
  - `src/core/Game.js` (criação e atualização);
  - `src/core/InputManager.js` (`radioNext`/`radioPrev` no scroll);
  - `src/save/SaveManager.js` (seção `radio`);
  - `src/ui/GameMenu.js` (volumes);
  - `src/interiors/InteriorDefinitions.js` e `src/properties/PropertyDefinitions.js` (`audio.radio`);
  - `src/styles/main.css`;
  - `src/dev/TestHarness.js`;
  - `package.json` (`test:radio`, `build:radio`);
  - `docs/CONTROLES.md`.
