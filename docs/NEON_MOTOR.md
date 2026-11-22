# PROMPT 12 — NEON MOTOR COMPANY

Nove carros originais modelados no **Blender 5.3** (instalado com autorização, executado em modo background por scripts Python) e integrados ao sistema automotivo existente. Nenhum sistema foi removido ou reescrito: os carros entram como **modelos adicionais** na mesma fábrica de veículos, com a mesma física, câmeras, danos, trânsito, polícia, garagens, salvamento e NEON CUSTOMS.

## 1. Auditoria inicial (resumo)

| Item | Resultado |
|---|---|
| Blender | Não estava instalado; Blender MCP sem conexão (porta 9876). Instalado o Blender 5.3 via winget (autorizado). Exportador glTF 2.0 nativo disponível. |
| Escala e eixos do jogo | Metros; frente = +Z, motorista = +X, origem no chão sob o centro do carro. |
| Hierarquia dos carros atuais | `root → body` (suspensão visual) com rodas `pivô → giro → [pneu, aro]`, portas com dobradiça na borda dianteira, volante com pivô inclinado, faróis escamoteáveis por pivô. |
| Controlador / física | `VehicleController` (comandos abstratos) + `VehiclePhysics` (modelo de bicicleta, OBB, passos fixos), parâmetros em `SPECS[type].handling`. |
| Personalização / garagem / save | NEON CUSTOMS por tipo/peça (`CustomizationCatalog`), `PropertyGarage.recordOf` (tipo, cor, integridade, `custom`), save `vehicles.world` + garagens. |
| Trânsito | `TrafficManager` sorteava 3 tipos com pesos fixos; impostor (1 chamada de desenho) para carros distantes. |
| Testes existentes | 63/63 antes de qualquer mudança. |

## 2. Os nove modelos

| # | Modelo | Categoria | Tipo | Portas | Triângulos | Materiais | `.blend` | `.glb` |
|---|---|---|---|---|---|---|---|---|
| 1 | PALM COMPACT (1984) | Popular | hatch | 2 + tampa | 24 228 | 18 | `assets-src/vehicles/palm-compact.blend` | `public/models/vehicles/palm-compact.glb` |
| 2 | BAY CITY 100 (1983) | Popular | sedã | 4 + porta-malas | 27 942 | 18 | `assets-src/vehicles/bay-city-100.blend` | `public/models/vehicles/bay-city-100.glb` |
| 3 | COAST WAGON (1985) | Popular | perua | 4 + tampa, bagageiro | 28 306 | 18 | `assets-src/vehicles/coast-wagon.blend` | `public/models/vehicles/coast-wagon.glb` |
| 4 | METRO EXECUTIVE (1985) | Intermediário | sedã executivo | 4 + porta-malas | 30 300 | 20 | `assets-src/vehicles/metro-executive.blend` | `public/models/vehicles/metro-executive.glb` |
| 5 | OCEAN COUPE (1986) | Intermediário | cupê fastback | 2 + tampa de vidro | 28 516 | 19 | `assets-src/vehicles/ocean-coupe.blend` | `public/models/vehicles/ocean-coupe.glb` |
| 6 | SUNSET TOURING (1984) | Intermediário | perua premium | 4 + tampa, bagageiro cromado | 33 534 | 19 | `assets-src/vehicles/sunset-touring.blend` | `public/models/vehicles/sunset-touring.glb` |
| 7 | NEON PHANTOM (1986) | Esportivo de luxo | motor central, cunha | 2 | 26 752 | 18 | `assets-src/vehicles/neon-phantom.blend` | `public/models/vehicles/neon-phantom.glb` |
| 8 | AZURE GT-R (1986) | Esportivo de luxo | gran turismo fastback | 2 + tampa de vidro | 27 898 | 19 | `assets-src/vehicles/azure-gtr.blend` | `public/models/vehicles/azure-gtr.glb` |
| 9 | MIDNIGHT VORTEX (1986) | Esportivo de luxo | roadster conversível | 2 (sem teto) | 29 224 | 18 | `assets-src/vehicles/midnight-vortex.blend` | `public/models/vehicles/midnight-vortex.glb` |

Os nove GLBs somam ~9,6 MB e entram no build web e no executável desktop (`dist/models/vehicles/`).

**Originalidade.** As imagens de referência serviram só como clima e categoria. Algumas lembravam carros reais, mas nenhuma silhueta foi copiada. Os nomes, marcas e emblemas (PALM, BAY CITY, COAST, METRO, OCEAN, SUNSET, NEON, AZURE, VORTEX) são fictícios, escritos em 3D com a fonte padrão do Blender, e não há logotipos de fabricantes.

## 3. Como os carros foram modelados

Pipeline em `tools/blender/neon_motor/`; o uso está em `tools/blender/neon_motor/README.md`. O comando é `npm run build:vehicles`.

- **Fonte única de medidas:** `src/vehicles/models/neon-motor-specs.json`, lida pelo Blender e pelo jogo. Guarda dimensões, linhas da carroceria, assentos, volante, manuseio, estilo e pesos de trânsito.
- **Carroceria:** é um *loft* de cortes transversais a cada ~7 cm. Cada corte tem fundo, soleira, vinco de maior largura, ombro com *tumblehome* e capô abaulado. Os cantos em planta são arredondados.
  - Nos esportivos em cunha, os **para-lamas sobem sobre as rodas** e o capô fica baixo no centro.
  - O bevel limitado por ângulo dá as quinas macias.
- **Booleanos reais** (solver *Manifold*), cada um com o material do cortador:
  - caixas de roda (forro preto);
  - cabine (paredes e assoalho na cor do interior);
  - nichos de faróis, lanternas, grade e tomadas laterais;
  - portas, capô, porta-malas ou tampa traseira e tampas dos faróis escamoteáveis, **recortados da própria carroceria**, com vão real de 5 mm.
- **Estufa:** retalhos com o para-brisa e o vidro traseiro curvos (abaulados). As colunas A, B, C e D ficam na cor da carroceria, e o forro do teto é feito com espessura de 3 cm. Os vidros são recortados das janelas, e os vidros das portas acompanham as portas.
- **Detalhes:**
  - para-choques (pretos, cromados ou integrados com spoiler e difusor);
  - grades (lâminas, colmeia, cromada vertical, *egg-crate*);
  - faróis retangulares, quádruplos, finos ou escamoteáveis;
  - lanternas em bloco, faixa, verticais ou com aletas;
  - piscas e marcadores âmbar;
  - retrovisores, maçanetas, frisos, faixa decorativa e painéis de madeira (Touring);
  - teto de vinil (Executive), bagageiros, aerofólios (lábio, *ducktail*, asa baixa), aletas do motor (Phantom) e arcos de proteção (Vortex);
  - placas com UV, escapamentos, chassi, eixos e tanque.
- **Interior:** carpete; bancos com encosto e apoio de cabeça (laterais esportivas nos esportivos); banco traseiro inteiriço; painel com binóculo; 2 ou 3 mostradores emissivos com ponteiro; rádio, saídas de ar e console com câmbio; madeira no Executive e no Touring; pedais; coluna de direção; retrovisor interno; para-sóis; forros de porta com apoio de braço; bandeja traseira e assoalho de carga.
- **Rodas:** pneu torneado com flanco e sulcos, mais 8 estilos de aro: calota, aço, raiada, turbina, 5 raios, prato dourado, *phone-dial* e lâminas. Cada aro tem disco de freio.

## 4. Hierarquia, pivôs e animações

```
VehicleRoot (extras: neonType, neonModel)
├─ Body · Windows · Lights · Chassis · Interior · Plate_F · Plate_R
├─ Wheel_FL/FR/RL/RR (no cubo) ─ Tire_* · Rim_*
├─ Door_FL/FR[/RL/RR] (dobradiça dianteira, gira em Y) ─ Glass_Door_* · DoorCard_*
├─ Hood (borda traseira, gira em X) · Trunk | Tailgate (com vidro e moldura)
├─ Popup_L/R (Phantom e Azure, abre em −1,2 rad)
└─ SteeringWheel (no cubo, coluna inclinada; gira em Y local)
```

- Carros de duas portas não têm portas traseiras.
- O conversível não tem teto rígido.
- Animações no GLB: `Door_*_Open`, `Hood_Open`, `Trunk_Open` ou `Tailgate_Open`, `Popup_*_Open` (4 a 6 por carro).
- No jogo, portas, rodas, volante e faróis escamoteáveis são animados pelo sistema existente.

## 5. Integração com o jogo

| Sistema | Como |
|---|---|
| Carregamento | `NeonModelLibrary` carrega os 9 GLBs em paralelo com a inicialização (1,7 a 2,3 s medidos). O jogo aguarda antes de montar o mapa. Se um arquivo falhar, aquele modelo usa o carro procedural da mesma família. |
| Fábrica | `VehicleFactory.create(tipo)` monta um `Vehicle` igual aos procedurais. Pintura, faróis, lanternas e placa são próprios de cada carro. Vidro, cromado e borracha usam os materiais de fábrica. As geometrias são compartilhadas entre carros do mesmo modelo. |
| Física | Mesma `VehiclePhysics`. Os parâmetros de cada modelo estão no JSON (massa, força, freio, direção, aderência, suspensão, marchas). |
| Postura do motorista | `headroomY` (forro interno) ajusta a inclinação do banco. Em todos os modelos fechados, a cabeça fica abaixo do forro (medido nos vértices do protagonista já posicionado). |
| Danos | Mesmo `VehicleDamage`: escurece e opaca a pintura, amassa a carroceria e quebra os faróis. |
| Trânsito | Pesos por zona: os populares são frequentes, os intermediários moderados e os esportivos raros. Na zona preferida do modelo, o peso é ×2,2. Os três carros procedurais continuam no trânsito. A IA de trânsito não mudou. |
| Mundo | Um exemplar de cada modelo fica estacionado em vagas do Sunset Beach: populares nas ruas internas, intermediários na Ocean Avenue, esportivos perto dos hotéis. Eles contam como veículos do mapa. |
| NEON CUSTOMS | Cada modelo herda a compatibilidade da família no JSON: `sedan`, `sports` ou `convertible`. Pintura, rodas, pneus, suspensão, peças, vidros, interior e melhorias funcionam sem alterar os outros carros. |
| Garagens e saves | O registro existente guarda tipo, cor, integridade e `custom`. Guardar, retirar, salvar e carregar não duplicam carros nem perdem personalizações. |

## 6. Desempenho

| Medida | Resultado |
|---|---|
| Chamadas de desenho por carro (passe principal + sombra) | 129 antes da otimização → **82,7** depois. Peças fixas fundidas por material, uma vez por modelo; projetam sombra só a pintura, os pneus e as peças grandes. |
| Referência: carro procedural | 46,7 |
| Quadro com 9 carros próximos (mediana, `render` + `gl.finish`) | sem carros 36,0 ms · 9 NEON 42,3 ms · 9 procedurais 38,9 ms. A variação sob automação é alta (26 a 46 ms). |
| Trânsito distante | Impostor existente (1 chamada). O interior é ocultado à distância. |
| Memória | Geometrias 1725 → 1725 e texturas 163 → 163 depois de criar e descartar 30 carros (sem vazamento). |

## 7. Testes executados

- **No jogo** (`await __NEON_TEST__.neonMotorSuite()`): 17 testes por carro × 9 modelos = 153.
  - Testes: carregamento, surgimento, entrada, câmeras, aceleração, frenagem, curvas, rodas, faróis, colisões, danos, saída, personalização, garagem, trânsito IA, salvamento e console sem erros.
  - Resultado: **153/153 em três execuções consecutivas**, sem recarregar a página, incluindo salvar e carregar com os 9 carros personalizados.
  - Detalhes em `docs/screenshots/neon-motor/testes_neon_motor.json`.
- **Node** `npm run test:neon`: 4/4. Cobre especificações, GLB (hierarquia, pivôs, materiais, animações, medidas, sem dependências externas), balanceamento por categoria e integração (SPECS, NEON CUSTOMS, pesos do trânsito).
- **Regressão:** Node 63/63 · OCEAN DRIVE no jogo 45/45 (com os carros NEON circulando) · `vite build` OK.
- **Blender:** validação automática por carro (comprimento, largura, altura, alinhamento das 4 rodas, dobradiças, cabeça × teto). Todos os itens passaram nos 9 carros.

### Medidas por carro (3ª execução)

| Modelo | 0→5 s | 9 s | Frenagem 1 s | Giro 2 s | Integridade após batida a 45 km/h |
|---|---|---|---|---|---|
| PALM COMPACT | 58 km/h | 91 km/h | −9,9 m/s | 1,77 rad | 86,6 |
| BAY CITY 100 | 62 | 97 | −9,6 | 1,68 | 85,9 |
| COAST WAGON | 58 | 91 | −9,0 | 1,71 | 83,2 |
| METRO EXECUTIVE | 73 | 113 | −8,3 | 1,31 | 77,1 |
| OCEAN COUPE | 91 | 137 | −10,4 | 1,40 | 83,1 |
| SUNSET TOURING | 69 | 108 | −7,9 | 1,48 | 75,0 |
| NEON PHANTOM | 125 | 182 | −13,2 | 1,38 | 85,8 |
| AZURE GT-R | 113 | 168 | −11,8 | 1,36 | 83,9 |
| MIDNIGHT VORTEX | 127 | 179 | −14,4 | 1,38 | 88,9 |

## 8. Capturas

- Renders do Blender (frente, traseira, lateral, três-quartos, portas/capô/tampa abertos, interior): `docs/screenshots/neon-motor/<modelo>.png`.
- No jogo: `jogo_01_ocean_avenue.jpg`, `jogo_02_frota.jpg`, `jogo_03_palm_compact.png`.

## 9. Problemas encontrados e corrigidos

| Problema | Causa | Correção |
|---|---|---|
| Portas, capô e tampa fora do lugar no GLB | A origem nova era perdida ao aparentar (matrix_world desatualizada) | Atualiza o depsgraph antes de aparentar |
| Roda dianteira acima da linha do capô (Phantom, Vortex) | Capô baixo no corte inteiro | Para-lamas elevados só nos ombros, perto dos eixos |
| Frisos e faixas soltos na frente afunilada e sobre as caixas de roda | Peça reta única | Trechos curtos que acompanham o contorno e param nas caixas de roda |
| Cabeça encostando no teto nos esportivos | A postura usava o teto externo | Tetos 1 a 3 cm mais altos, bancos dos esportivos 2 cm mais baixos e `headroomY` (forro) para a postura |
| Showcase vazio | As vagas só existem depois de montar o Sunset Beach | Gancho `afterDistrictBuild` no `World` |
| Muitas chamadas de desenho | Um nó por peça; tudo projetava sombra | Fusão por material e sombras seletivas |
| Erros da bateria de testes (não dos carros) | Pista no canteiro central, limite do mapa em z 169, sonda de chão atingindo o teto de outro carro, carros parados na baia da garagem, protagonista morrendo após ~16 batidas (dano ao motorista já existente) | Pista x 25,75 de z −290, sonda baixa, área de espera, vida restaurada por carro |

## 10. Pendências reais

- **Triângulos acima das metas iniciais.** Populares têm 24 a 28 mil (meta 8–15 mil), intermediários 28 a 33,5 mil (meta 12–20 mil) e o Vortex 29 mil (meta 15–28 mil). O custo foi medido e o trânsito distante usa o impostor existente, mas ainda não há malhas LOD dedicadas nos GLBs.
- **Peças do NEON CUSTOMS** (para-choques, saias, aerofólios) são posicionadas pelo perfil aproximado de cada modelo. Funcionam e foram testadas por contagem, cor e desempenho, mas o encaixe visual delas nos nove modelos não foi conferido em imagem.
- **Piscas:** são âmbar e estáticos, porque o jogo não tem lógica de seta.
- **Capô, porta-malas e tampa** têm pivôs e animações no GLB, mas ainda não há interação para abri-los no jogo (preparado para o futuro).
- **Mãos no volante:** usam o IK existente (`seatGrip` vindo da especificação), sem verificação visual dedicada.
- **Problema antigo, não alterado:** no NEON GT procedural, a cabeça do protagonista passa 1,5 cm do teto externo (1,235 m contra teto de 1,22 m, medido nos vértices).
- **Releases:** os executáveis desktop e Linux da Release v0.1.0 ainda não têm estes carros. É preciso gerar uma nova versão.
