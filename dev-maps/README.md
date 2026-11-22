# dev-maps/ — mapas de teste (somente desenvolvimento)

Esta pasta é servida em `/dev-maps/` **apenas** pelo `npm run dev` (plugin em `vite.config.js`).
Ela **não** entra no `dist/` nem no `vite preview`. Conteúdo aqui é tratado como externo ao jogo.

- `test-city/` — mapa de testes original, gerado por `npm run build:testmap`. O mesmo comando grava uma cópia
  idêntica em `public/maps/test-city/`, carregada pelo jogo como bairro oeste do mundo unificado
  (`docs/MUNDO_UNIFICADO.md`).
- Não coloque aqui conteúdo de terceiros sem licença que permita o uso. Mesmo com licença,
  mantenha-o nesta pasta (fora de `src/` e `public/`) até a autorização estar documentada.
- O `.gitignore` ignora tudo nesta pasta, exceto este README, para evitar redistribuição acidental.

## Formato

Cada mapa é uma pasta com `manifest.json` + modelo glTF/GLB (metros, Y para cima):

```json
{
  "id": "test-city",
  "label": "TEST CITY",
  "file": "test-city.glb",
  "scale": 1,
  "spawn": { "x": 0, "y": 0, "z": 15, "yaw": 0 },
  "bounds": { "minX": -108, "maxX": 108, "minZ": -108, "maxZ": 108 },
  "heightfieldCell": 0.5
}
```

Registre o mapa em `CONFIG.dev.testMaps` (`src/config.js`).

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
