# Destruição do mobiliário urbano

## Comportamento

Tiros acumulam dano no objeto atingido. Ao esgotar sua resistência, o objeto
intacto desaparece e suas próprias peças de construção são animadas como
destroços: tábuas dos bancos, partes dos postes, armações/toldos das barracas,
peças dos guarda-sóis, placas e componentes das cabines telefônicas.
Há balanço breve nos impactos que ainda não destroem o objeto.

Veículos quebram o objeto quando a velocidade de aproximação no contato
atinge o limiar do tipo. Velocidade lateral sem aproximação não conta como
uma batida forte. A quebra é processada antes da resposta de parede do
resolvedor de colisões: o veículo perde um pouco de velocidade e prossegue.
Contatos fracos continuam tendo a resposta de colisão existente.

| Tipo | Resistência a dano | Velocidade normal para quebra por veículo |
|---|---:|---:|
| Poste de iluminação | 85 | 5 m/s |
| Hidrante | 65 | 4 m/s |
| Banco | 40 | 3 m/s |
| Barraca | 45 | 3 m/s |
| Lixeira / parquímetro | 30 | 2,5 m/s |
| Guarda-sol | 20 | 2 m/s |
| Espreguiçadeira | 22 | 2 m/s |
| Jardineira | 55 | 4 m/s |
| Caixa de jornal | 35 | 3 m/s |
| Balizador | 60 | 4,5 m/s |
| Placa de rua / trânsito | 30 | 3 m/s |
| Poste de semáforo | 100 | 6 m/s |
| Cabine telefônica | 65 | 4 m/s |

Esses valores são parâmetros de jogo arcade. Não são dados de engenharia.
Árvores e palmeiras existentes de tronco grosso são marcadas como
`tree/unbreakable` e não entram no registro de objetos quebráveis.
Prédios, ruas, torres de salva-vidas e limites geográficos continuam sendo
infraestrutura fixa. Toalhas e batentes baixos não participam do sistema.

## Animação e integração

- Cada objeto conserva as peças de sua geometria procedural como modelos
  para fragmentos. Intactos, os objetos repetidos continuam instanciados.
- Ao quebrar, só a instância atingida é ocultada, seus colisores são removidos
  e até 32 peças recebem impulso, rotação, gravidade, quique e atrito no chão.
- O volume para acertar um tiro acompanha os limites visuais aproximados do
  objeto e não bloqueia a passagem do jogador. A colisão física mantém as
  formas simplificadas existentes, com dimensões proporcionais à escala.
- A iluminação desenhada no chão é desligada para o poste derrubado.
- Hidrantes criam um jato de 96 partículas durante até 10 segundos.
- A quebra de um semáforo apaga os focos do cruzamento, que passa a operar
  como PARE em todos os acessos; pedestres passam a avaliar brechas no trânsito.
- Pedestres reagem à quebra próxima e deixam de escolher bancos destruídos.
- Arbustos apoiados dentro de uma jardineira caem junto quando ela quebra.
- Há sons de impacto por material, aproveitando a síntese existente.
- Foram adicionadas barracas em `(47.2, -100)` e `(47.2, -224)` no calçadão.

## Desempenho e ciclo de vida

O limite padrão é 180 fragmentos ativos e seis jatos simultâneos. Fragmentos
antigos são retirados ao atingir o orçamento. Destroços duram até 14 segundos,
diminuindo nos dois segundos finais. Geometria e materiais são compartilhados;
o descarte de um destroço não destrói os recursos de objetos intactos.

Destroços são efeitos visuais com contato no chão, sem colisão contra jogador,
veículos ou outros destroços. Essa escolha evita engasgos e obstáculos pequenos
travando o carro. Não é uma simulação estrutural nem uma malha cortada em tempo
real: as peças se separam nos componentes definidos pelo gerador.

O estado quebrado permanece na sessão, inclusive após alternar para o mapa
de teste e voltar. Efeitos ficam pausados enquanto o cenário está oculto.
Recarregar a página reconstrói o cenário; não há persistência em disco.
Mapas importados não ganham destruição automaticamente: seus recursos precisam
ser registrados explicitamente. As regras novas estão integradas aos dois
bairros do mapa procedural.

## Arquivos e verificação

`src/world/DestructionSystem.js` gerencia resistência, ocultação, destroços e
água. `PropGenerator` e `TrafficSignals` registram os objetos; `CityGenerator`
vincula as poças de luz a seus postes. Armas aplicam dano no impacto e veículos
consultam a quebra antes de receber o impulso contra um obstáculo fixo.

`npm run test:destruction` executa dez testes, incluindo a geração da cidade
completa e quebra em massa. A suíte verifica acúmulo de dano, instância correta,
remoção das colisões, movimento/rotação dos destroços, tiros na parte superior
dos bancos, colisões fortes/fracas/tangenciais, proteção de árvores, água,
orçamentos de efeitos, desligamento das poças de luz, pausa entre mapas,
falha do semáforo, barracas, cabines e plantas em jardineiras.

Os testes de integração usam o gerador e as geometrias reais, substituindo
somente o desenho Canvas2D; não validam pixels, renderização WebGL, áudio
ou FPS. A conferência visual no navegador continua pendente. As suítes de
cidade e do protagonista/arsenal também devem passar após esta alteração.
