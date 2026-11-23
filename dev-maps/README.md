# dev-maps/ — cenário local do Vice City

Esta pasta é servida em `/dev-maps/` **apenas** pelo `npm run dev` (plugin em `vite.config.js`).
Ela **não** entra no `dist/` nem no `vite preview`. Conteúdo aqui é tratado como externo ao jogo.

- `vice-city/` — único cenário do jogo: 29 setores GLB, texturas e colisões.
  O jogo abre automaticamente `vice-city/manifest.json`; não há seletor de mapas.
- `vice-city-converted.zip` — pacote local de reinstalação do mesmo cenário.
- Sunset Beach, Lantern Point e TEST CITY saíram do fluxo de carregamento.
- Não coloque aqui conteúdo de terceiros sem licença que permita o uso. Mesmo com licença,
  mantenha-o nesta pasta (fora de `src/` e `public/`) até a autorização estar documentada.
- O `.gitignore` ignora tudo nesta pasta, exceto este README, para evitar redistribuição acidental.

## Formato

O `vice-city/manifest.json` combina `files` (29 GLBs) e `collisionFiles`
(29 arquivos COL convertidos). Cada setor tem também seu manifesto de conversão.
As coordenadas usam metros, com Y para cima. A colisão efetiva é tridimensional,
independente do campo de alturas legado do importador.

O cenário ativo é definido em `CONFIG.map` (`src/config.js`). A configuração
atual aceita somente o Vice City completo; os manifestos por setor são recursos
de conversão e validação, sem entradas separadas no jogo.

## Convenções nos "extras" dos nós glTF

| Extra / nome | Efeito no carregador (`src/maps/ImportedMap.js`) |
|---|---|
| `ground: true` ou nome `GROUND*` | vira campo de alturas (terreno, colinas) |
| `surface: "grass"` etc. | som de passos / tipo de superfície |
| `collide: false` | sem colisor automático (faixas, decalques) |
| nome `COL_*` ou `collider: "box"` | proxy de colisão invisível (caixa orientada) |
| `collider: "ramp"` | rampa caminhável; sobe ao longo do +X local (escadas) |
| `castShadow: false` | não projeta sombra |
| `cameraBlocker: true/false` | força se a câmera colide ou não |

Sem extras, cada malha recebe uma caixa orientada automática. Objetos esparsos
(postes com braço, árvores) usam só a parte até 2,5 m de altura para não criar
paredes invisíveis sob braços e copas.
