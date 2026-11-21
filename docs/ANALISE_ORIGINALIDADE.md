# Análise do projeto e direção para conteúdo original

> Atualização posterior: foram convertidos 40 perfis numéricos do
> `data/pedstats.dat` fornecido pelo usuário para a IA de cidadãos. As afirmações
> históricas abaixo sobre ausência de dados do GTA integrados devem ser lidas
> com essa atualização. A lógica de decisão, rotas e animações é implementada
> no motor deste projeto; o código-fonte da IA não existe no RAR enviado.
> Ver [IA_CIDADAOS.md](IA_CIDADAOS.md).

> Atualização de configuração posterior à auditoria: o protagonista fornecido
> pelo usuário foi restaurado como padrão no servidor local e no build.
> As restrições de carregamento do GLB descritas abaixo são um registro da
> configuração anterior, já substituída. Os pacotes GTA compactados seguem
> separados do jogo. Estado atual em [PROTAGONISTA.md](PROTAGONISTA.md).

Data: 20 de novembro de 2026 (horário de São Paulo).

## Resultado

Existe um protótipo próprio de mundo aberto em Three.js chamado NEON CITY: 1986.
Os pacotes GTA não são o código desse protótipo e não devem ser tratados como
conteúdo autorizado para distribuição. A direção adotada é implementar as
funções desejadas com código, cidade, personagens, narrativa e áudio próprios.
Uma reprodução exata da expressão visual e sonora de Vice City não atende à
exigência de não reutilizar conteúdo de terceiros sem autorização.

Esta é uma auditoria técnica inicial, não uma certificação jurídica ou de autoria.
Geometria procedural também precisa ter um desenho próprio; gerar uma cópia por
código não demonstra originalidade. Não houve comparação visual completa de
todos os modelos nem análise de todas as dependências transitivas.

## Materiais examinados

| Material | Evidência encontrada | Decisão para a distribuição |
|---|---|---|
| `src/`, `tools/`, configurações e documentação | Geradores procedurais e sistemas de jogabilidade em JavaScript | Base de trabalho; a inspeção não comprova toda a cadeia de autoria |
| `GTA-VC.rar` enviado nesta conversa | 218.505.205 bytes; 268 entradas no arquivo, incluindo pastas; executável `gta-vc.exe`, DLLs, `models/gta3.img`, mapas e animações | Referência de organização; nenhum recurso integrado ao jogo |
| `256285-gta-mixed-saxvcxlc-gtasa_manual.zip` | 357.227.322 bytes; 519 entradas, incluindo pastas; o leia-me informa conversão de conteúdo de GTA Vice City e GTA III para San Andreas | Não incorporar ao jogo independente sem autorização apropriada |
| `ImageToStl.com_arquivo+glb+feio.zip` e protagonista derivado | OBJ, MTL e duas texturas; documentação de conversão, sem comprovação de autoria/licença encontrada | Procedural como padrão; GLB excluído do build |
| `dev-maps/test-city/` | Gerador próprio e manifesto glTF; mapa de desenvolvimento | Continuar como ferramenta local de testes |
| Áudios que serão enviados depois | Ainda não recebidos nesta etapa | Avaliar organização e funções; não incorporar gravações do GTA sem licença |

O arquivo RAR foi listado, sem executar seus programas. Não foi feita uma
extração integral, decompilação do executável ou decodificação completa dos
contêineres IMG. A contagem de entradas não corresponde à contagem de todos
os modelos contidos nos IMG.

O ZIP GTA Mixed contém, fora de seus contêineres IMG, 235 DFF, 89 IPL, 59 IDE,
12 TXD, 7 COL, 6 IMG e 30 MP3, além de outros arquivos. Os MP3 já presentes
nesse mod não são o pacote de áudio que você mencionou que enviará depois.
O leia-me credita autores do mod, mas isso não documenta permissão dos titulares
dos recursos convertidos para utilização em um jogo independente.

## Como os formatos se relacionam com o projeto

| Formato encontrado | Função técnica | Equivalente a criar no projeto |
|---|---|---|
| IMG / DIR | Contêiner e índice de recursos | Recursos próprios organizados por bairro e carregamento por região |
| IDE / IPL | Definições de objetos e posicionamento | Dados próprios para `CityGenerator` e distritos |
| DFF / TXD | Modelos e conjuntos de texturas | Geometria procedural ou GLB e texturas de origem documentada |
| COL | Colisão | `CollisionSystem`, caixas, cilindros, rampas e campo de alturas |
| IFP | Animações | `PlayerAnimator`, rig próprio e futuros clipes originais |
| SCM / SC | Scripts do jogo | Futuro sistema próprio de missões e eventos |
| handling.cfg / carcols.dat | Parâmetros de veículos | Configurações próprias de física e aparência |
| GXT | Textos localizados | Catálogo próprio de interface e diálogos |

Essa tabela descreve funções gerais. Não foi copiado o mapa, o posicionamento
dos objetos, os roteiros, a redação nem os valores de configuração do GTA.

## Estado do protótipo

| Área | Encontrado no código | Trabalho seguinte |
|---|---|---|
| Mundo | Sunset Beach, arquitetura Art Déco, praia, oceano, vegetação e horários | Expandir uma geografia própria com bairros, pontes e pontos de interesse originais |
| Personagem | Movimento, corrida, salto, animação e câmeras em primeira e terceira pessoa | Produzir um protagonista original com origem documentada e melhorar sua apresentação |
| Veículos | Entrada/saída, direção, câmera, efeitos, danos e áudio | Ampliar variedade própria e ajustar dirigibilidade por testes de jogabilidade |
| Cidade | Trânsito, semáforos, pedestres e reações a eventos | Melhorar variedade de rotas e comportamento |
| Armas | Inventário, mira, disparo, recarga e efeitos | Integrar progressão e interações; revisar nomenclaturas e identidade visual |
| Som | Síntese Web Audio para ambiente, passos, veículos e armas | Criar vozes, rádios e trilha próprias, com documentação de origem |
| Missões e progressão | Não identifiquei um sistema dedicado nos módulos examinados | Criar objetivos, estados de missão, recompensas e narrativa própria |
| Polícia e procura | Não identifiquei um sistema dedicado nos módulos examinados | Criar percepção, perseguição, busca e regras de perda de alerta |
| Persistência | Armazenamento da qualidade gráfica; não identifiquei salvamento da campanha | Criar versão de save, checkpoints e recuperação |
| Navegação | HUDs de jogo, armas e veículos; não identifiquei módulo dedicado de minimapa | Criar mapa e navegação com desenho e símbolos próprios |

As lacunas indicam o resultado da leitura de módulos e buscas no código, sem
afirmar equivalência funcional completa com GTA ou validação jogável de tudo.

## Ajustes aplicados nesta etapa

1. `src/config.js`: personagem procedural como padrão.
2. `src/core/Game.js`: seleção do GLB restrita ao desenvolvimento; `?player=glb`
   não ativa o modelo importado na distribuição.
3. `vite.config.js`: `public/`, que atualmente contém somente o GLB pendente,
   deixa de ser copiada para o build. Os arquivos fonte permanecem preservados.
4. `vite.config.js`: aviso com a licença MIT do Three.js incluído na distribuição.
5. README e documentação do protagonista atualizados para explicar o estado atual.

O GLB pode ser inspecionado explicitamente em desenvolvimento com `?player=glb`.
Isso preserva a ferramenta existente e não constitui autorização para publicar
o material. Antes de adicionar novos arquivos aprovados a `public/`, revisar a
configuração para permitir sua inclusão seletiva. Não há um catálogo completo
de licenças de todos os recursos e dependências nesta etapa.

## Ordem de implementação proposta

1. Registrar autoria e licença de cada recurso novo; definir identidade própria.
2. Melhorar o protagonista procedural ou produzir outro modelo original.
3. Expandir a cidade com composição própria e carregamento por região,
   preservando colisões, rotas, densidade e desempenho.
4. Criar missões originais usando eventos, objetivos e checkpoints.
5. Implementar polícia, procura e consequências de forma própria.
6. Adicionar progressão, recompensas, salvamento e navegação.
7. Produzir vozes, rádios, músicas e efeitos próprios; testar mixagem e desempenho.

O mapa completo, uma campanha, a polícia, o salvamento e uma nova trilha não
foram implementados nesta etapa. Não é possível deduzir uma campanha inteira
apenas pela listagem de arquivos de instalação.

## Referência sobre direitos e licenças

A Lei 9.610/1998 distingue ideias e regras de jogos (art. 8º) de obras expressas
em textos, imagens, música e audiovisual (art. 7º). Reprodução e adaptação
dependem em regra de autorização (art. 29), consideradas as exceções legais.
Por isso, a direção técnica é criar uma implementação e uma expressão próprias,
em vez de converter os recursos do GTA para outro formato.

Fonte oficial: https://www.planalto.gov.br/ccivil_03/leis/l9610.htm

O Three.js é distribuído sob licença MIT, conforme `node_modules/three/LICENSE`.
Usar uma biblioteca licenciada não significa ausência de direitos autorais:
significa uso sob as condições de sua licença. O aviso correspondente passa a
acompanhar o build em `THIRD-PARTY-NOTICES.txt`.

## Validação

O build de produção foi executado com sucesso antes e depois dos ajustes de
isolamento. A verificação final confirmou a ausência do GLB e dos formatos
externos inventariados em `dist/`, a remoção da URL do GLB no JavaScript
distribuído e a presença do aviso do Three.js. Testes de movimentação,
direção, armas e comportamento no navegador não foram executados nesta auditoria.
