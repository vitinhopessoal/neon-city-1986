# Simulação urbana (PROMPT 04 ORIGINAL): trânsito e pedestres

> Atualização da cidade: o mapa procedural inclui agora Lantern Point, ao norte
> de Sunset Beach. São 8 trechos viários definidos, 6 cruzamentos e 23 faixas
> de pedestres no conjunto. As contagens de rede abaixo registram a versão
> anterior de Sunset Beach. Ver [EXPANSAO_CIDADE.md](EXPANSAO_CIDADE.md).

## Arquitetura

| Arquivo | Responsabilidade |
|---|---|
| `src/city/CitySimulation.js` | Orquestra eventos, trânsito e pedestres. Define a densidade e liga a depuração (F10, só em desenvolvimento). |
| `src/city/UrbanEvents.js` | Barramento de eventos sem dependências: `gunshot`, `impact`, `horn`, `collision`, `pedHit`. |
| `src/city/CityDebug.js` | Rede, rotas, estados e contadores. Carregado por import dinâmico e fora do build público. |
| `src/traffic/LaneGraph.js` | Grafo de faixas a partir do `RoadNetwork` existente: trechos, conversões em Bézier, linhas de parada, faixas de pedestres e sumidouros. |
| `src/traffic/TrafficVehicleAI.js` | Motorista: máquina de estados, IDM (distância e velocidade), perseguição pura (direção), personalidades. |
| `src/traffic/TrafficManager.js` | Surgimento e reciclagem (pool), níveis de simulação, cruzamentos, vagas, buzinas, reações e congestionamento. |
| `src/traffic/VehicleImpostor.js` | LOD de distância: o carro vira uma malha com cor por vértice (1 draw call). |
| `src/pedestrians/PedestrianRenderer.js` | 13 InstancedMesh (uma por parte do corpo) e visuais dos anos 80. |
| `src/pedestrians/PedestrianManager.js` | Rede de calçadas, travessias, máquina de estados, reações e animação procedural. |

Integrações:

- `VehicleManager.addVehicle` / `removeVehicle`: os carros do trânsito usam a
  mesma física, colisão, animação e danos dos outros veículos.
- `TrafficSignalController.timeInState`: tempo restante da fase, usado na
  travessia de pedestres.
- O arsenal emite o evento `gunshot`; a buzina do jogador emite `horn`.

## Rede de ruas

- **Origem:** vem do `RoadNetwork` que já gerava ruas, faixas, cruzamentos e
  faixas de pedestres. Não se presume que qualquer superfície plana seja rua.
- **Sunset Beach:** 16 trechos, 20 conversões (8 retas, 6 à esquerda, 6 à
  direita) e 2 cruzamentos. Ocean/Flamingo tem semáforo; Coral/Flamingo tem
  PARE nos quatro sentidos. As 7 pontas além do limite do bairro viram
  sumidouros, onde o carro é reciclado longe do jogador.
- **Faixas:** mão direita (EUA). A conversão à esquerda sai da faixa interna e
  a à direita, da externa. Não há retorno em U, exceto em rua sem saída.
- **TEST CITY:** metadados opcionais no manifesto (`roads`, `intersections`,
  `crosswalks`), gerados por `tools/test-map/traffic-metadata.mjs` sem tocar
  no GLB. São 80 trechos, 188 conversões, 25 cruzamentos com PARE e 36 faixas
  de pedestres. Um manifesto sem esses campos continua válido: o mapa só fica
  sem trânsito.

## Motoristas

**Estados:** CRUISING, FOLLOWING, BRAKING, STOPPED, WAITING_SIGNAL, TURNING,
YIELDING, AVOIDING, PARKING, PARKED, PULLING_OUT e RECOVERING.

**Velocidade (IDM):**

- O modelo considera todos os obstáculos sobre a rota: carros, jogador a pé e
  pedestres na pista.
- Linhas de parada e faixas de pedestres ocupadas entram como obstáculos
  virtuais. O carro para na linha.
- A velocidade cai antes das curvas.

**Direção:** perseguição pura sobre os mesmos comandos abstratos do jogador
(`throttle`, `brake`, `steer`, `handbrake`). A IA usa a `VehiclePhysics`
existente; não há uma segunda física.

**Personalidades:**

| Perfil | Comportamento |
|---|---|
| Cauteloso | Mais distância, freia cedo, quase não buzina. |
| Comum | Equilibrado. |
| Apressado | Mais rápido, passa no amarelo, buzina mais. |
| Descuidado | Distância curta, pequena oscilação na faixa, às vezes passa no vermelho que acabou de mudar. |

**Semáforos:**

- Usam as fases existentes ns/ew. Nunca há verde para direções conflitantes.
- O tempo é do controlador, não de cada carro.
- No amarelo, o carro para se conseguir parar com conforto.
- Na conversão à esquerda, o carro cede ao fluxo oposto.

**PARE:** parada completa e reserva do cruzamento por ordem de chegada. Quem
vem do mesmo acesso pode seguir junto. Se o carro do jogador estiver no
cruzamento, ninguém entra.

**Reações:**

- Param diante do jogador ou de pedestres na pista.
- Buzinam com intervalo mínimo, por carro e global, quando bloqueados pelo
  jogador.
- Após um disparo a até 45 m, ficam "assustados" por 8 s: aceleram e às vezes
  buzinam.

**Congestionamento:** carro parado sem motivo por mais de 12 s:

- se estiver fora da vista e a mais de 35 m, é reciclado;
- se estiver perto, faz uma ré curta e tenta de novo.

Não há teletransporte visível.

**Estacionamento:**

- As vagas vêm do `RoadNetwork`, sem água, colisores ou vagas já ocupadas.
- O carro entra na vaga, desliga o motor e fica 25–70 s.
- Depois sai e volta à faixa.
- Se o jogador entrar num carro estacionado do trânsito, ele sai do controle
  da IA. Não há duplicação.

## Pedestres

- **Visual:** figuras low-poly articuladas (quadril, joelhos, ombros,
  cotovelos, cabeça). Estilos dos anos 80: praia, casual, terno pastel,
  agasalho, vestido, turista e idoso. Pele, cabelo (volume e comprimento),
  óculos e altura variam. São 1.643 triângulos por pedestre e 13 draw calls
  para toda a população.
- **Rede:**
  - calçadas dos dois lados de cada rua, sem nós dentro de obstáculos ou na
    água;
  - esquinas ligadas;
  - faixas de pedestres;
  - calçadão (x = 45 e 51) e praia (x = 66).
  - Em Sunset Beach são 473 nós, 578 ligações, 9 faixas de pedestres e 25
    bancos.
- **Estados:** WALK, IDLE, SIT, WAIT_CROSS, CROSS, STARTLED, FLEE, KNOCKED e
  GETUP. O destino é sempre alcançável, por passeio no grafo.
- **Travessia:**
  - Perto do semáforo, só atravessam com a rua atravessada no vermelho e pelo
    menos 5 s restantes.
  - Também esperam brecha no trânsito.
  - Depois de 20 s de espera, atravessam se nada estiver a menos de 8 m.
  - Os carros param para quem está na faixa.
- **Reações:**
  - Um carro passando perto provoca susto e passo para o lado.
  - Contato acima de 3 m/s derruba o pedestre, que se levanta depois de cerca
    de 4 s (sem ragdoll nem violência gráfica) e gera o evento `pedHit`.
  - Um disparo a até 40 m faz o pedestre fugir correndo, para longe da origem.
  - Uma buzina próxima faz o pedestre olhar.
- **Colisão:** o mesmo resolvedor do jogador; não atravessam paredes, postes
  nem bancos.

## Densidade, população e LOD

- **Perfis:** `?density=off|low|medium|high` ou `CONFIG.city.density`.
  - Baixa: 5 carros e 10 pedestres.
  - Média: 9 e 18.
  - Alta: 14 e 28.
- **Densidade por região:**
  - Ocean Ave tem mais carros; Coral St, menos.
  - O calçadão e a Flamingo têm mais pedestres; a área residencial, menos.
- **Surgimento:** 70–175 m do jogador (45–115 m no TEST CITY), fora da vista,
  sem carro a menos de 16 m.
- **Reciclagem:** fora da vista e além do alcance. Os carros vêm de um pool e
  a geometria não é recriada: 9 carros criados para 58 surgimentos em 3 min.
- **Níveis de simulação:**
  - Até 55 m: física completa e IA a 20 Hz.
  - Além disso: movimento cinemático na faixa e IA a 3–8 Hz.
  - Além de 48 m da câmera: impostor de malha única.
  - Os pedestres longe atualizam a cada 3 quadros.

## Medições (Chrome, `quality=medium`, CPU da máquina em 83–100%)

| Ponto | Sem população (calls / mil tri / p50) | Média (calls / mil tri / p50) |
|---|---|---|
| Rua (Ocean/Flamingo) | 752 / 588 / 31,0 ms | 890 / 713 / 39,4 ms |
| Avenida | 776 / 578 / 39,8 ms | 887 / 692 / 48,9 ms |
| Orla | 812 / 568 / 41,5 ms | 845 / 703 / 43,3 ms |

- IA: 0,15 ms/quadro nos carros e 0,59 ms nos pedestres (média de 120
  quadros).
- O tempo de quadro é muito ruidoso nesta máquina. O heap variou de 134 a
  159 MB entre execuções, conforme o coletor de lixo.
- Antes do impostor e da contagem dinâmica de instâncias, a densidade média
  custava até +308 draw calls e +208 mil triângulos.

## Pendências

- Sem troca de faixa nem ultrapassagem; o carro mantém a faixa escolhida ao
  surgir.
- Pedestres não sentam em todos os tipos de banco. A orientação do assento é
  estimada pela rua mais próxima.
- Não há polícia, perseguições nem NPCs armados (fora do escopo).
- Motoristas só reagem ao disparo acelerando ou buzinando; não fogem da rota.
- O PARE dos 25 cruzamentos do TEST CITY é virtual: não há placas no modelo
  importado.
