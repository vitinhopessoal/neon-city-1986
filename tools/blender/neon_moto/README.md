# NEON MOTORCYCLES — pipeline Blender

Gera as seis motos originais do PROMPT 15 no **Blender 5.3** (modo background, `bpy`/`bmesh`), reaproveitando
os utilitários de `tools/blender/neon_motor/nm_lib.py`.

```bash
npm run build:motos
```

O comando roda `blender --background --factory-startup --python tools/blender/neon_moto/run_moto.py -- --all --render`
e precisa do `blender` no PATH. Sem PATH, use o caminho completo: `"C:\Program Files\Blender Foundation\Blender 5.3\blender.exe"`.
Para gerar só algumas, troque `--all` pelos tipos (ex.: `palm_rider_125 neon_blade_900r`).

| Arquivo | Função |
|---|---|
| `src/vehicles/models/neon-moto-specs.json` | Fonte única: medidas, estilo (motor, tanque, banco, guidão, farol, carenagem, escape, rodas, quadro), pontos do piloto (quadril, pedaleiras, manoplas), manuseio e trânsito. Lida pelo Blender e pelo jogo. |
| `nm_moto.py` | Gerador paramétrico: rodas (pneu elíptico, raios ou liga, discos/tambor), garfo inclinado pelo rake, guidão (reto, puxado, ape ou semiguidão), farol/instrumentos, quadro (berço, custom, chopper, longarinas), motor (mono, bicilíndrico, V2, V2 grande, 4 em linha), tanque/banco por cortes, carenagem (bico + painéis + quilha), escapamentos, lanternas e placa. Orçamento menor de polígonos nas básicas. |
| `run_moto.py` | Monta cada moto, cria as animações (Steer, Suspension, FrontWheel_Spin, RearWheel_Spin), valida medidas e pivôs, renderiza 6 vistas (EEVEE), salva `.blend`, exporta `.glb` e o LOD distante (`_lod1.glb`, malha única dizimada a 30%). |
| `out/<arquivo>.json` | Relatório: medidas, verificações, triângulos (moto e LOD), materiais, hierarquia, animações. |

Saídas: `assets-src/motorcycles/*.blend`, `public/models/motorcycles/*.glb` e `*_lod1.glb`, `docs/screenshots/neon-moto/*.jpg`.

Convenção: coordenadas do jogo em metros, frente = +Z, lado esquerdo = +X, origem no chão sob o centro do entre-eixos.
Pivôs: `FrontFork` na caixa de direção, girado em X por −rake (o Y local é o eixo de direção: o jogo gira o garfo
em `rotation.y`); `FrontWheel`/`RearWheel` no cubo (giram em X); `Swingarm` no pivô da balança (gira em X).
Âncoras do piloto: `Rider_Hip` (quadril sentado), `Peg_L/R` (pedaleiras), `Grip_L/R` (manoplas, filhas do garfo).
