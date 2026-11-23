# Vice City local no Neon City

Os GLBs usam os DFF/TXD da instalação fornecida e os posicionamentos IDE/IPL.
Não são prédios genéricos. Os arquivos originais são apenas lidos; as cópias de
trabalho ficam em `tools/vice-city-local/input/`. Os SHA-256 da comparação
original/cópia estão em `tools/vice-city-local/source-provenance.json`.

## Abrir

Na pasta do projeto, execute:

```powershell
npm run dev -- --host 127.0.0.1
```

- Único mapa: <http://127.0.0.1:5173/?time=morning>.
- O Vice City completo abre automaticamente; aguarde o carregamento e clique
  em **NOVO JOGO** ou **CONTINUAR**. Não há seletor de mapas nem alternância por F8.
- URLs antigas com `?map=` também abrem a cidade completa. Ocean Drive continua
  como um dos 29 setores, sem uma entrada separada no jogo.
- Saves de mapas removidos preservam o progresso e recuperam a posição no spawn
  seguro do Vice City. Os slots existentes não são apagados.
- `P`: opções, mapa completo e manuais; `E`: entrar/sair do carro;
  `WASD`: andar/dirigir. Os antigos painéis de instruções do F3 foram retirados.
- O minimapa retangular permanece fixo no canto inferior esquerdo. Usa os 64
  blocos de radar originais da instalação, em `radar/atlas.png`, com coordenadas
  calibradas para a cidade convertida. Detalhes em [INTERFACE_VICE_CITY.md](INTERFACE_VICE_CITY.md).

O mapa começa sobre uma rua real de Ocean Drive, perto dos hotéis. O importador
confere o piso, as paredes e a altura livre antes de aceitar o spawn. Os carros
são do Neon City, posicionados em superfícies verificadas do mapa convertido.

## Arquivos

`dev-maps/vice-city/` contém:

- `manifest.json`: mapa combinado; referencia os GLBs e colisões dos setores.
- `<setor>.glb`: geometria, UVs, materiais, cores e instâncias reais do setor.
- `<setor>.manifest.json`: manifesto individual, com candidatos de spawn.
- `<setor>.collision.bin`: faces COL e esferas de colisão, em formato VCC1.
- `textures/*.png`: texturas originais convertidas e compartilhadas pelos GLBs.
  Copie a pasta de texturas junto dos GLBs: eles referenciam esses PNGs externos.
- `conversion-report.json`: contagens, exclusões, recursos ausentes e erros.
- `validation-report.json`: auditoria de todos os GLBs/COLs e pisos sobrepostos.
- `pilot-runtime-validation.json`: processamento no importador e medições de CPU.
- `ocean-drive-validation.png`: conferência visual independente no Blender.
- `threejs-pilot.jpg`: imagem capturada dentro do jogo Three.js.
- `browser-validation.json`: verificações visuais e FPS observados no navegador.
- `threejs-final-validation.jpg`: captura da retomada, após dirigir e sair do carro.
- `final-verification.json`: resultado das verificações finais de 23/11/2026.

O pacote `dev-maps/vice-city-converted.zip` contém a pasta `vice-city/` e este guia.
Para reinstalar, extraia `vice-city/` dentro de `dev-maps/` deste projeto. Não é
necessário redistribuir o IMG, o RAR ou a instalação original para carregar os GLBs.

Não mover esses recursos para `public/` ou `src/`. São ignorados pelo Git e não
entram em `dist/`, nos instaladores nem no GitHub. A rota `/dev-maps/vice-city/`
aceita apenas host local; o ZIP `vice-city-converted.zip` também recebe essa
restrição. O acesso por túnel e os atalhos `/@fs/` são bloqueados e verificados
por `check-local.mjs` (manifesto, pacote, caminhos normalizados e cópias de trabalho).
Nada foi publicado no repositório remoto nesta tarefa.

Sunset Beach, Lantern Point e TEST CITY foram retirados do fluxo do jogo. Não há
mais geração procedural de cidade, download/anexação do TEST CITY ou retorno a
um mapa antigo em caso de erro. As cópias do TEST CITY em `public/maps/test-city/`
e `dev-maps/test-city/` foram removidas. Dados históricos usados como fixtures de
testes de sistemas compartilhados não entram na inicialização do cenário.
Se os recursos locais do Vice City faltarem, o jogo informa a falha e mantém
o início da partida bloqueado. O build de produção continua sem os recursos do GTA;
para jogar esta versão, use o servidor local indicado acima.

A atualização para mapa único passou nos dez testes de `npm run test:vice`
(colisões, pilotagem e recuperação de saves) e em mais vinte testes dos sistemas
compartilhados de terreno, vias, minimapa, HUD e teclado. O build passou. No
navegador, a página sem parâmetros abriu a cidade completa, iniciou uma partida,
permitiu caminhar e manteve o mesmo mapa após F8, sem erros de console.
Comprovação em `single-map-validation.json` e `vice-city-only.jpg`.

## Conversão reproduzível

Python 3.10+ e NumPy 2.2.6. O extrator RAR usa o WinRAR/UnRAR instalado.
O leitor é o [DragonFF](https://github.com/Parik27/DragonFF), commit
`319847f7803f102c5aa31fa38e8b3284117db40a`, GPL-3.0-or-later; ele fica somente
na pasta local de ferramentas. Não é instalado globalmente no Blender.

```powershell
python -m pip install numpy==2.2.6
python tools/vice-city/prepare.py --source "C:\Users\Vitin Hacker\Downloads\GTA-VC ORIGINAL\GTA-VC"
python tools/vice-city/convert.py --sector oceandrv
npm run test:vice
python tools/vice-city/convert.py --all
node tools/vice-city/audit.mjs
node tools/vice-city/check-local.mjs
npm run build
python tools/vice-city/package.py
```

Foi avaliado o DragonFF no Blender e utilizado seu `gtaLib` independente para
conversão em lote. O Blender importa o GLB resultante e produz a imagem de
validação com `tools/vice-city/render-pilot.py`. As preferências do Blender e
a instalação original do GTA não são alteradas.

## Eixos, materiais e colisões

- Metros, transformação `(X,Y,Z) GTA -> (X,Z,-Y) glTF`.
- Quaternion IPL invertido conforme o importador DragonFF, seguido da mudança
  de base. Escalas e hierarquia dos frames DFF são aplicadas também à geometria.
- Texturas PNG mantêm UVs, repetição e transparência. Materiais usam iluminação
  de dia pré-calculada, com contribuição ambiente adicionada às cores de vértice;
  copiar só as cores pré-iluminadas deixava ruas e vegetação pretas.
- Objetos temporizados são selecionados para 12h. LODs duplicados são excluídos,
  preservando os modelos detalhados. O ciclo visual original de noite não foi portado.
- COLs são independentes da geometria visual. Caixas viram faces; esferas mantêm
  seu volume curvo (raio conservador quando houver escala não uniforme).
- O piso é a face abaixo da altura atual dos pés/rodas. Não se usa um mapa de
  alturas único para a cidade: ruas, rampas, pontes e superfícies acima/abaixo
  continuam separadas. Há testes de teto, paredes, raios e volumes de veículos.
- A água usa a cota 6 da instalação fornecida. A superfície visual da água é
  simplificada; os efeitos, reflexos e ondas originais não foram reconstruídos.
- O processamento reutiliza instâncias/lotes e texturas. Grupos distantes são
  ocultados a partir de aproximadamente 700 m mais seu raio, com checagem periódica.
  A cidade completa é carregada inicialmente; não há streaming de disco por setor.

## Validação e limites

O piloto foi importado no Blender e no carregador Three.js. A física conduziu
um veículo por aproximadamente 13,4 m mantendo a altura real da rua. Os testes
incluem pisos sobrepostos, rampas, teto, parede, esferas, descarregamento e lotes.
Os números de CPU ficam nos relatórios; eles **não representam FPS de GPU**.

Foram exportados 29 setores, 8.789 nós de objetos renderizados, 2.107.579 triângulos
visuais e 379.383 faces de colisão, além das esferas. Os GLBs somam 117.559.552
bytes; 3.933 PNGs compartilhados somam 125.060.932 bytes. A estimativa das texturas
descomprimidas com mipmaps é de aproximadamente 628 MiB, sem contar geometria.
O mapa completo pode demorar alguns minutos para carregar na primeira abertura.

No navegador, foram testados caminhada, entrada no carro, direção por cerca de
90 m, frenagem e saída no piloto: 40–60 FPS observados. O mapa completo também
abriu e permitiu caminhar na rua original: 20–24 FPS na checagem curta, qualidade
média e resolução adaptativa. Há margem para otimização; essas observações não
são média de benchmark nem garantia para outras máquinas. O compartilhamento
de materiais entre setores reduziu chamadas de desenho na cena examinada de
cerca de 1.199 para 955.

Uma ponte real manteve dois pisos consultáveis na mesma coordenada horizontal:
6,611 m e 20,657 m. O relatório registra a posição e a consulta independente de
cada camada. Não faltam DFFs nem vínculos COL dos objetos exportados. Existem
12 referências de textura sem imagem correspondente encontrada em `gta3.img`
ou `generic.txd`; suas superfícies mantêm as cores originais, sem textura inventada:

```text
drycleaners/dryclean_washer_gen
dynnewstnd/glass1
lh_pwinterior/pw_guillotine
lh_pwinterior2/black2128
lh_pwinterior2/black3128
lh_pwinterior2/black4128
lh_pwinterior2/black5128
lh_taxi/wirefence
lhmachine1m/was_scrpyd_baler_stepfront
lhmachine1mn/was_scrpyd_baler_stepfront
od_bighotpool/beachwalkway
scarinterior/untitled-1
```

Por essas referências pendentes, `audit.mjs` termina com código 1 e grava o relatório
completo. Isso é uma pendência explícita da conversão, apesar do carregamento
funcional; o build e os seis testes específicos de colisão passaram.

Os 29 setores possuem ao menos um candidato de spawn aceito pela auditoria
combinada. Isso verifica chão, paredes e altura livre; não certifica acesso por
missão ou portais nos interiores originais.

Na regressão geral foram executados 125 testes: 124 passaram; o teste existente
`tools/ai/simulation.test.mjs` falhou por não encontrar passageiros na população.
Esse teste já passou em execução isolada e apresentou instabilidade nas execuções
em conjunto. Não foi alterado para esconder a falha; os detalhes de cada execução
devem ser considerados ao avaliar a regressão.

Na retomada de **23/11/2026**, os seis testes Vice City passaram novamente,
incluindo 13,43 m de condução automática sobre a rua real; o build passou e a
auditoria confirmou os 29 setores e os dois pisos sobrepostos da ponte. Os nove
arquivos originais e suas cópias conferiram com os SHA-256 da preparação. Uma
nova regressão sequencial dos demais testes teve 119 casos: 118 passaram e o
mesmo teste de passageiros falhou (`tools/vice-city-local/regression-final.log`).
Somados aos seis testes Vice City, são 125 casos, 124 aprovados e uma falha.

Nesta retomada também foram repetidos no navegador caminhada, entrada no carro,
condução por aproximadamente 118 m, frenagem e saída com apoio no terreno real.
O painel mostrou 32–60 FPS nas amostras do piloto, com qualidade média e resolução
adaptativa; a regressão em CPU estava executando em paralelo. A imagem final
mostra a posição a pé após a saída. Os números do mapa completo acima são da
validação anterior, preservada em `browser-validation.json`.

As regiões com instâncias geram setores GLB. Dos 32 IPLs, `cull.ipl`, `paths.ipl`
e `yacht/yacht.ipl` têm a seção de instâncias vazia e não geram GLB; os oito
`map0.dat` a `map7.dat` auxiliares também não viram construções. Missões, portais/visibilidade de interiores,
tráfego dos caminhos originais, animações de pontes, semáforos originais e objetos
destrutíveis do GTA não foram recriados. Não há ruas/navegação artificiais para
ativar NPCs nos lugares errados; a IA urbana automática exige metadados de navegação
que ainda não foram convertidos para este mapa. O mundo original do Neon City
mantém seus próprios sistemas.

A auditoria verifica todos os arquivos e candidatos de spawn nas colisões
combinadas da cidade. O carregador repete a verificação com os recursos do mapa
selecionado e rejeita o início se não encontrar posição segura. A condução
automática e as imagens conferidas são do piloto; não houve percurso manual por
cada ponte, túnel, interior e região. Os 29 resultados de spawn da auditoria não
certificam que cada setor é autossuficiente quando aberto individualmente.
