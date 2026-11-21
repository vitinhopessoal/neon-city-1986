# Protagonista 3D importado

> Configuração atual: o protagonista enviado pelo usuário voltou a ser o padrão
> (`CONFIG.protagonist.model = 'glb'`) no desenvolvimento e no build. O arquivo
> `public/models/protagonist/protagonist.glb` é preservado e copiado para `dist/`.
> O personagem procedural continua como fallback se o modelo não carregar.

O modelo do ZIP `ImageToStl.com_arquivo+glb+feio.zip` substitui visualmente o
personagem provisório. O personagem procedural continua no jogo: ele serve de
esqueleto animado e de fallback.

## Arquivos

| Caminho | Função |
|---|---|
| `assets-src/protagonist/original/` | Cópia intocada do conteúdo do ZIP (OBJ, MTL, 2 PNG, leia-me). |
| `tools/protagonist/build-protagonist.mjs` | Pipeline completo (Node puro, sem dependências novas). |
| `tools/protagonist/obj.mjs` | Leitor OBJ (somente dados). |
| `tools/protagonist/simplify.mjs` | Simplificação QEM com costuras de UV preservadas. |
| `tools/protagonist/rig.mjs` | Medição das articulações, pose de ligação e pesos de pele. |
| `tools/protagonist/glb-skinned.mjs` | Gravador GLB com skin. |
| `tools/protagonist/png-io.mjs` | Leitura/gravação de PNG. |
| `public/models/protagonist/protagonist.glb` | Resultado usado pelo jogo (3,1 MB). |
| `assets-src/protagonist/build-report.json` | Medidas e articulações da última execução. |
| `assets-src/protagonist/mixamo-prep/` | Malha otimizada em OBJ + textura, para um auto-rig externo opcional. |
| `assets-src/protagonist/.cache/` | Cache da simplificação (pode ser apagado). |
| `src/player/ProtagonistModel.js` | Carregamento, validação, divisão em camadas e sincronização com o animador. |

## Regenerar

```
node tools/protagonist/build-protagonist.mjs            # completo (~70 s)
node tools/protagonist/build-protagonist.mjs --reuse=1  # reaproveita a simplificação (~6 s)
```

Opções: `--tris=28000`, `--tex=1024`, `--height=1.8`, `--spec=arquivo.json`
(sobrescreve as alturas relativas das articulações).

## O que o pipeline faz

1. Lê o OBJ (186.599 triângulos, 92.417 posições, 128.505 vértices com UV).
2. Normaliza: altura de 1,80 m, pés em y = 0, centro no tronco.
3. Corrige o giro do corpo: o modelo estava virado cerca de 20° em Y
   (ombros, coxas e pés apontavam para o lado).
4. Simplifica para 27.999 triângulos por erro quádrico. As costuras de UV
   (31.860 arestas) são preservadas e colapsos que dobram triângulos no UV são
   rejeitados, para a textura não escorregar.
5. Mede as articulações por cortes horizontais e cria um rig com os mesmos
   17 ossos e a mesma hierarquia do personagem provisório.
6. Calcula os pesos de pele por região (pernas, braços, tronco e cabeça) com
   transições suaves nas articulações.
7. Reduz a textura de 2048 para 1024 px. O mapa de metal/rugosidade era
   constante (rugosidade 1, metal 0) e virou fator do material.
8. Grava um GLB padrão com skin e metadados do rig (`extras.neonRig`).

## Como anima

Não há clipes de animação no GLB. O `PlayerAnimator` continua animando o
esqueleto provisório, agora invisível. A cada quadro, `ProtagonistModel.sync()`
copia as rotações das 17 juntas para os ossos do GLB.

A pose de repouso do modelo (braços e pernas levemente inclinados, passo
largo) é normalizada no bind. A rotação zero do animador corresponde, nos
dois modelos, a membros retos para baixo.

Por isso todas as animações existentes funcionam: parado, caminhar, correr,
pular, cair, aterrissar, virar no lugar, entrar, sentar e dirigir, e sair do
carro.

Sentado no carro:

- O GLB sobe 14 cm, porque o quadril dele é mais baixo que o do provisório.
- Uma IK de dois ossos leva os pulsos ao volante.
- Em carros com teto, o encosto reclina o necessário para a cabeça caber.

## Primeira pessoa

A malha é dividida em três partes que compartilham o mesmo esqueleto: cabeça,
braços e corpo. Elas usam as mesmas camadas do personagem provisório
(`HEAD_LAYER`, `ARMS_LAYER` e `BODY_LAYER`). Assim, a câmera em primeira pessoa
oculta cabeça e braços e a sombra continua completa.

## Fallback

- `CONFIG.protagonist.model`: `'glb'` (padrão) ou `'original'`.
- `?player=original` ou `?player=glb` na URL.
- F9 alterna em tempo real (somente em desenvolvimento).
- Se o GLB falhar ao carregar (arquivo ausente, sem skin, sem os 17 ossos ou
  sem os metadados), o jogo segue com o personagem original e registra o motivo
  em `player.modelStatus`.

## Limitações conhecidas

- **Malha fundida:** a malha original é uma casca única. As mãos encostam nas
  coxas e a parte interna dos braços encosta no tronco. Em movimentos amplos
  há esticamento na axila e no quadril, perto das mãos.
- **Sem dedos nem rosto animados:** não há ossos de dedos nem de rosto, e as
  mãos ficam fechadas como no modelo.
- **Rig procedural:** um rig feito por artista, ou um auto-rig como o Mixamo,
  daria deformações mais limpas. Os arquivos em `mixamo-prep/` servem para
  isso. Enviá-los a um serviço externo depende de autorização. Um rig externo
  exigiria um mapeamento de ossos e da pose de repouso (T-pose) para o
  `ProtagonistModel`.
