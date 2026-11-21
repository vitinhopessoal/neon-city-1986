# NEON CITY: 1986 — Polícia (NCPD) · Operação Blue Shield (PROMPT 08)

Polícia fictícia de Neon City: **NCPD**, com as unidades NCPD, NCPD VICE, NCPD TÁTICO, NCB (agência federal fictícia) e GUARDA. Implementação própria: nenhum código, modelo, textura, áudio ou diálogo de outros jogos.

## 1. Arquitetura encontrada

O sistema policial já existia e **não foi substituído**. Ele continua sendo um único `PoliceManager`, criado pela `CitySimulation` e ligado ao sistema de eventos urbanos (`UrbanEvents`).

| Arquivo | Função | Situação |
|---|---|---|
| `PoliceManager.js` | despacho, unidades, estados, percepção, perseguição, combate, prisão, busca, helicóptero, desfecho | reorganizado e corrigido |
| `PoliceNavigation.js` | linha de visão, rotas pelo grafo de ruas, A* a pé, condução (`driveTo`) | corrigido (ultrapassagem) |
| `PoliceRules.js` | 7 níveis de resposta, uniformes, referências de viatura | **valores próprios** (sem dados extraídos) |
| `PoliceVisuals.js` | policiais instanciados, viaturas sobre o chassi existente, helicóptero, sirene | sirene com LFO nativo, som do rotor |
| `PoliceCrimes.js` | **novo**: detecção de crimes (gravidade, deduplicação, testemunhas) | |

**Única fonte de verdade do procurado**: `PlayerStatus.wanted`. O HUD lê só esse campo. Todas as entradas passam por `PoliceManager.report(tipo, chave, local)`, depois por `PoliceCrimes.evaluate` e por fim por `PlayerStatus.reportCrime`. A redução fica só no `PoliceManager`, porque o decaimento antigo do `PlayerStatus` é desligado (`policeManaged`) quando há polícia ativa.

## 2–4. Bugs confirmados, causas e correções

Todos foram reproduzidos no jogo (Chrome, servidor dev) antes da correção e verificados depois.

| # | Bug confirmado (como reproduzi) | Causa | Correção | Status |
|---|---|---|---|---|
| 1 | **Estrelas subindo indevidamente**: uma rajada de 1,5 s com a MAC-10, sem acertar ninguém, levou de 0 a **3 estrelas** | cada disparo era um crime separado (+0,5 de "calor" por tiro; 23 tiros) | `PoliceCrimes`: gravidade por tipo, **deduplicação por evento** (a rajada conta uma vez numa janela de 4 s), testemunha obrigatória para crimes públicos (pedestre a até 35 m ou polícia a até 70 m) | **Corrigido e testado** (23 tiros → 1 crime → 1 estrela; 22 deduplicados) |
| 2 | **Morrer/ser preso dentro de um estabelecimento** deixava o jogador na rua com o interior ainda ativo (mundo oculto, sol apagado) | o desfecho reposicionava o jogador sem desativar o interior | o desfecho chama `interiors._forceOutside()` e cancela o sono antes do respawn | **Corrigido e testado** |
| 3 | **Helicóptero subindo para ~312 m** perto de estabelecimentos | a altitude segura usava o colisor mais alto abaixo dele, incluindo os interiores pré-carregados em Y=300 | ignora a camada de interiores (`minY > 150`); sobe antes de avançar sobre prédios; giro limitado (1,1 rad/s) com inclinação suave | **Corrigido e testado** (32–56 m com interior carregado) |
| 4 | **Viatura e trânsito civil em impasse eterno**: o civil cedia à sirene e a viatura esperava atrás, freada | a ultrapassagem só valia entre 5 e 18 m e sempre pela esquerda; o detector de "preso" só contava com o acelerador pressionado | ultrapassagem pelo lado livre; bloqueio detectado também com o carro freado e rota pela frente; manobra física de **ré e desvio lateral** verificada contra paredes e carros | **Corrigido e testado** (4 de 4 viaturas contornaram em 9,5 s; sem teletransporte) |
| 5 | **Viatura sem rota parada para sempre** (`path: null`, freio de mão) | `roadRoute` falhava a partir de uma faixa sem saída e a unidade só replanejava o mesmo pedido | rota alternativa (meia-volta, depois alvo intermediário). Último recurso: reciclar só fora da vista e a mais de 60 m, com registro no debug | **Corrigido e testado** (0 unidades paradas sem rota em 64 amostras com 4 estrelas) |
| 6 | **Despacho atrasado**: com 1 estrela, nenhuma viatura saiu por até 8 s | o temporizador de patrulha (8 s) não era reiniciado quando o nível subia | ao subir de nível, o despacho sai em até 0,6 s | **Corrigido e testado** |
| 7 | **Perseguição fácil demais**: viaturas a no máximo 65 km/h (2★) e 86 km/h (6★) contra 172 km/h do jogador | velocidades-alvo baixas na tabela de resposta | 36 a 144 km/h por nível; as curvas reduzem a velocidade automaticamente | **Corrigido e testado** (até 105 km/h medidos com 3★) |
| 8 | **Multa fora da economia** | `status.addMoney(-x)` direto | multa limitada ao saldo pela `EconomyManager` (sem tocar em propriedades nem no save) | **Corrigido e testado** |
| 9 | **Custo do áudio da sirene**: frequência e volume reagendados a cada quadro | `setTargetAtTime` por quadro acumula eventos no `AudioParam` | LFO nativo para a varredura; volume só muda quando o alvo muda | **Corrigido** (mesmo padrão já medido nos interiores) |
| 10 | **Dados de outro jogo**: `PoliceRules` usava o perfil `STAT_COP` convertido de `pedstats.dat` e referências de `handling.cfg` | importação feita numa etapa anterior | parâmetros próprios (`HEADING_RATE`, `VEHICLE_REFERENCE`, nomes fictícios) | **Corrigido** (só no módulo policial; ver Pendências) |

**Hipóteses investigadas sem bug confirmado**:
- policiais atravessando paredes: o A* checa colisão nas arestas e o tiro checa linha de visão;
- policiais duplicados ou sumindo na frente do jogador: a remoção exige estar fora da vista e longe;
- policiais girando ou "correndo no lugar": a velocidade da animação vem do deslocamento real;
- estrelas que não diminuem: a fuga foi medida;
- vazamento de memória: 5 ciclos de 6★ terminaram com 854 geometrias e 130 texturas, igual ao início.

## 5–7. Funcionamento

**Seis estrelas** (único estado em `PlayerStatus.wanted`, limitado a 0–6):

| ★ | Resposta |
|---|---|
| 0 | patrulha circulando pela rede viária |
| 1 | 1 viatura, abordagem, perseguição a pé, tentativa de prisão; arma só diante de ameaça |
| 2 | 2 viaturas, perseguição de carro, combate |
| 3 | 3 viaturas, NCPD VICE, helicóptero |
| 4 | 4 viaturas, NCPD TÁTICO (carroceria reforçada), bloqueio de rua |
| 5 | 5 viaturas, NCB, mais pressão |
| 6 | 6 viaturas, GUARDA; teto de 6 viaturas, 12 agentes e 1 helicóptero (difícil, mas com fuga possível) |

**Crimes** (`PoliceCrimes.CRIME_TYPES`): disparo em público 1 · atropelamento 2,5 (por vítima) · destruição 0,75 · ameaça a policial 1 · agressão a policial 3 · policial abatido 5 · tiro em viatura/helicóptero 1,5 · roubo de viatura 3. O nível é o "calor" acumulado dividido por 4, arredondado para cima.

**IA a pé**: estados SEATED, EXITING, CHASE, ARREST, COMBAT, COVER, SEARCH, RETURN, ENTERING e GUARD.
- Rotas por A* local com colisão, altura e água, replanejadas a cada ~0,9 s, escalonadas por agente.
- Separação entre agentes e giro limitado.
- **Prisão**: proximidade contínua (1,65 m), linha de visão e suspeito parado e sem ameaça recente. Agora mostra o aviso "POLÍCIA! PARADO!". Não há prisão através de paredes nem à distância.
- **Combate**: linha de visão e companheiros bloqueiam o tiro; precisão cai com a distância e o movimento; cadência por unidade.
- **Cobertura**: agente ferido recua para o lado oposto da própria viatura.

**Viaturas**: usam a física existente e rotas reais de faixas e cruzamentos.
- **Papéis dinâmicos**: a 1ª persegue com antecipação curta, a 2ª **intercepta à frente** usando a velocidade estimada do suspeito, as demais fecham pelos **flancos**. Os destinos são projetados no grafo de ruas, sem linha reta.
- Ultrapassagem de emergência, desvio físico quando bloqueadas e meia-volta sem rota.
- Policiais desembarcam pela porta com posição de saída válida e preservam sua identidade.

## 8–13. Sistemas avançados e fuga

- **Helicóptero**:
  - aparece a partir de 3★ (um no máximo);
  - mantém altitude acima dos prédios do mapa e circula a última posição conhecida;
  - tem holofote (cone), giro suave e inclinação;
  - **rotor sintetizado com atenuação por distância** (novo);
  - atira com baixa precisão a partir de 3★ e pode ser abatido.
- **Bloqueios**: a partir de 4★, uma viatura atravessada em um ponto válido da rede viária, fora da vista e a 55–150 m, com policiais a pé. É desfeito quando o nível cai abaixo de 4.
- **Fuga**: percepção por linha de visão; fora de contato, a polícia vai à **última posição conhecida** e procura em volta. As estrelas piscam durante a busca e caem uma a uma após 30–60 s sem contato (conforme o nível).
  - Medido: 2★ → 1★ em cerca de 38 s → 0★ em cerca de 68 s, com o jogador escondido.
- **Prisão e morte**: transição com faixa PRESO/MORTO por 3 s.
  - **Sai do interior** se necessário e volta ao ponto seguro do mapa.
  - Vida restaurada, estrelas zeradas.
  - Multa fictícia ($100/$50, limitada ao saldo) pela economia.
  - Propriedades, inventário e save não são alterados.

## 14–16. Integrações

- **Armas**: o arsenal acerta agentes e helicóptero via `WeaponBallistics`; os disparos da polícia não contam como crime do jogador; não é possível atirar com o painel aberto ou sentado (PROMPT 06).
- **Trânsito**: civis cedem à sirene; as viaturas ultrapassam fisicamente, sem fazer civis sumirem e sem ignorar colisões.
- **Pedestres**: reagem a **sirenes** (evento novo `siren`, a cada 1,5 s por viatura em perseguição, alcance 26 m) e a disparos, pelo mesmo `UrbanEvents` e `CitizenBrain`, sem um segundo gerenciador.
- **Interiores**: a polícia **não entra**, por limitação explícita: não há navegação policial dentro dos interiores. O jogador lá dentro não é visto; a última posição conhecida vira a **porta usada** e a busca acontece do lado de fora. Medido: 2 policiais procurando junto à porta.
- **Salvamento**: o estado policial não é salvo; carregar uma partida zera o procurado.

## 17. Desempenho

| Medida | Valor |
|---|---|
| Atualização da polícia, 2★ | 0,29 ms por quadro |
| Atualização da polícia, 6★ (6 viaturas, 12 agentes, helicóptero) | 0,43 ms por quadro |
| Memória após 5 ciclos de 6★ | estável (854 geometrias, 130 texturas antes e depois) |
| Limites | 6 viaturas, 12 agentes, 1 helicóptero; 16 posições de renderização reutilizadas (pooling) |

O pathfinding a pé é replanejado por agente em intervalos escalonados, nunca a cada quadro.

## 18–19. Testes

**Automatizados** (`npm run test:police`, 20/20; 6 novos do PROMPT 08):
- deduplicação de crimes, testemunhas e limite de 6 estrelas;
- rajada = 1 estrela;
- desfecho dentro de interior sai do interior e multa pela economia;
- polícia não vê o jogador em interior e busca na porta;
- papéis de interceptação;
- altitude do helicóptero ignora a camada de interiores;
- os 14 testes anteriores (spawn válido, rotas, LOS, prisão, fuga, respawn, limpeza) seguem passando.

**Práticos (no jogo)**:

| Teste | Resultado |
|---|---|
| A — uma estrela | viatura chegou, policiais desceram, tentativa de prisão e PRESO com o jogador parado |
| B — duas e três estrelas de carro | viaturas perseguiram com papéis de perseguição e interceptação, até 105 km/h; bloqueio surgiu com 3–4★; nenhuma viatura encostou em outra; 0 policiais travados |
| C/D/E/F — 3 a 6 estrelas | reforços até 6 viaturas e 12 agentes, NCPD TÁTICO e GUARDA, helicóptero, bloqueios; sem travar; 0,43 ms por quadro |
| G — fuga | busca na última posição (porta do interior), 2★ → 0★ em ~68 s |
| H — prisão | desfecho, multa, estado policial zerado, nenhuma unidade perseguindo depois |

**Regressão**: todos os testes automatizados do projeto (55) passam e o `vite build` não tem erros. Também conferidos andar/correr/pular/câmeras/V, carros, trânsito, pedestres, arsenal, interiores, propriedades, economia, garagens e salvamento (ver `docs/PROPRIEDADES.md`).

## 20. Pendências reais

- **Polícia dentro de interiores**: não implementada. É uma limitação explícita e segura: a polícia espera na porta.
- **Animações**: os policiais usam o esqueleto procedural dos pedestres (andar, correr, mirar, sentar/sair da viatura, cair). **Recarregar, entrar em cobertura e reação a impacto não têm animação dedicada.**
- **Perseguições muito longas**: as viaturas param na última posição conhecida quando perdem contato (por desenho); a interceptação depende de avistamentos recentes.
- **Recursos de terceiros fora do módulo policial** (decisão do usuário):
  - `src/city/data/PedStats.js` (convertido de `pedstats.dat`), ainda usado pelo `CitizenBrain` dos pedestres;
  - `public/hud/vice/*.png` (fonte, disco do radar, ícones de arma com nomes de texturas do jogo original), usados pelo HUD.
  - Substituí-los muda o HUD e o perfil dos pedestres, então não foram removidos sem autorização.
- **Áudio**: sirene e rotor estão implementados, mas não foram ouvidos na automação, porque o navegador mantém o AudioContext suspenso sem gesto real.

Capturas: `docs/screenshots/policia/01_viaturas_abordagem_4_estrelas.jpg`.
