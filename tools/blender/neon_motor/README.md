# NEON MOTOR COMPANY — pipeline Blender

Gera os nove carros originais do PROMPT 12 no **Blender 5.3** (modo background, `bpy`/`bmesh`).

```bash
npm run build:vehicles
```

O comando roda `blender --background --factory-startup --python tools/blender/neon_motor/run.py -- --all --render` e precisa do `blender` no PATH. Sem PATH, use o caminho completo: `"C:\Program Files\Blender Foundation\Blender 5.3\blender.exe"`. Para gerar só alguns modelos, troque `--all` pelos tipos (ex.: `palm_compact ocean_coupe`).

| Arquivo | Função |
|---|---|
| `src/vehicles/models/neon-motor-specs.json` | Fonte única de medidas, estilo, assentos, manuseio e pesos de trânsito (lida pelo Blender e pelo jogo). |
| `nm_lib.py` | Utilitários: materiais PBR, loft, booleanos (solver Manifold), bevel, solidify, torno, junção, origens/pivôs. |
| `nm_car.py` | Gerador paramétrico: carroceria por cortes transversais (loft), caixas de roda, cabine, portas/capô/porta-malas recortados por booleanos (com vão real), estufa com colunas e vidros, faróis embutidos, grade, para-choques, frisos, interior, rodas, volante. |
| `run.py` | Monta cada carro, cria as animações (portas, capô, tampa, faróis escamoteáveis), valida, renderiza 6 vistas (EEVEE), salva `.blend` e exporta `.glb`. |
| `out/<arquivo>.json` | Relatório: medidas, verificações, triângulos, materiais, hierarquia, animações. |

Saídas: `assets-src/vehicles/*.blend`, `public/models/vehicles/*.glb`, `docs/screenshots/neon-motor/*.png`.

Convenção: coordenadas do jogo em metros, frente = +Z, motorista = +X, origem no chão sob o centro. No Blender o carro aponta para −Y; o exportador glTF (+Y up) devolve as coordenadas do jogo. Pivôs: `Wheel_*` no cubo da roda; `Door_*` na dobradiça dianteira (gira em Y); `Hood` na borda traseira, `Trunk` na dianteira e `Tailgate` no teto (giram em X); `Popup_*` na borda traseira da tampa (abre em −1,2 rad); `SteeringWheel` no cubo, com a coluna inclinada (gira em Y local).
