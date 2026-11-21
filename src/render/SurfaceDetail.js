import * as THREE from 'three';

/**
 * Realce de superfícies para MeshStandardMaterial (via onBeforeCompile):
 *  - detalhe de reboco/concreto por projeção triplanar em coordenadas de mundo
 *    (funciona em geometria fundida sem depender das UVs)
 *  - manchas grandes e desgaste discreto junto ao chão
 *  - variação de rugosidade
 *  - "lavagem" de luz nas fachadas à noite (uplight barato, sem luzes dinâmicas)
 * O efeito pode ser desligado no perfil gráfico BAIXO (define SURFACE_DETAIL).
 */
export const SURFACE_UNIFORMS = {
  uSdMap: { value: null },
  uSdGlow: { value: 0 },
  uSdGlowColor: { value: new THREE.Color(1.0, 0.78, 0.55) },
};

const enhanced = new Set();

function inject(shader, local) {
  shader.uniforms.uSdMap = SURFACE_UNIFORMS.uSdMap;
  shader.uniforms.uSdGlow = SURFACE_UNIFORMS.uSdGlow;
  shader.uniforms.uSdGlowColor = SURFACE_UNIFORMS.uSdGlowColor;
  shader.uniforms.uSdScale = local.scale;
  shader.uniforms.uSdStrength = local.strength;
  shader.uniforms.uSdGrime = local.grime;
  shader.uniforms.uSdRough = local.rough;

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      varying vec3 vSdWorldPos;
      varying vec3 vSdWorldNormal;`)
    .replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec4 sdWp = vec4(transformed, 1.0);
        vec3 sdN = objectNormal;
        #ifdef USE_INSTANCING
          sdWp = instanceMatrix * sdWp;
          sdN = mat3(instanceMatrix) * sdN;
        #endif
        sdWp = modelMatrix * sdWp;
        vSdWorldPos = sdWp.xyz;
        vSdWorldNormal = normalize(mat3(modelMatrix) * sdN);
      }`);

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform sampler2D uSdMap;
      uniform float uSdScale;
      uniform float uSdStrength;
      uniform float uSdGrime;
      uniform float uSdRough;
      uniform float uSdGlow;
      uniform vec3 uSdGlowColor;
      varying vec3 vSdWorldPos;
      varying vec3 vSdWorldNormal;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 sdNrm = normalize(vSdWorldNormal);
      float sdVert = 1.0 - abs(sdNrm.y);
      float sdRoughDelta = 0.0;
      #ifdef SURFACE_DETAIL
        vec3 sdW = pow(abs(sdNrm), vec3(4.0));
        sdW /= (sdW.x + sdW.y + sdW.z);
        vec3 sdP = vSdWorldPos * uSdScale;
        float sdFine = texture2D(uSdMap, sdP.zy).r * sdW.x + texture2D(uSdMap, sdP.xz).r * sdW.y + texture2D(uSdMap, sdP.xy).r * sdW.z;
        vec3 sdC = vSdWorldPos * (uSdScale * 0.11);
        float sdCoarse = texture2D(uSdMap, sdC.zy).g * sdW.x + texture2D(uSdMap, sdC.xz).g * sdW.y + texture2D(uSdMap, sdC.xy).g * sdW.z;
        diffuseColor.rgb *= 1.0 + (sdFine - 0.5) * uSdStrength + (sdCoarse - 0.5) * uSdStrength * 0.9;
        float sdGrime = (1.0 - smoothstep(0.12, 1.5, vSdWorldPos.y)) * sdVert * uSdGrime;
        diffuseColor.rgb *= 1.0 - sdGrime;
        sdRoughDelta = (sdFine - 0.5) * uSdRough + sdGrime * 0.12;
      #endif`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + sdRoughDelta, 0.04, 1.0);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        float sdGlowH = 1.0 - smoothstep(0.0, 14.0, vSdWorldPos.y);
        totalEmissiveRadiance += diffuseColor.rgb * uSdGlowColor * uSdGlow * (0.3 + 0.7 * sdGlowH) * sdVert;
      }`);
}

/**
 * Aplica o realce a um material. Parâmetros por material:
 * scale (repetições por metro), strength (contraste do detalhe),
 * grime (escurecimento junto ao chão), rough (variação de rugosidade).
 */
export function enhanceSurface(material, { scale = 0.55, strength = 0.22, grime = 0.12, rough = 0.18 } = {}) {
  const local = {
    scale: { value: scale },
    strength: { value: strength },
    grime: { value: grime },
    rough: { value: rough },
  };
  material.defines = { ...(material.defines || {}), SURFACE_DETAIL: '' };
  material.onBeforeCompile = (shader) => inject(shader, local);
  // Mesmo código de shader para todos os materiais realçados (cache de programa compartilhado).
  material.customProgramCacheKey = () => 'neon-surface-detail';
  material.userData.surfaceDetail = local;
  enhanced.add(material);
  return material;
}

/** Liga/desliga o detalhe (perfil gráfico). Recompila os materiais afetados. */
export function setSurfaceDetailEnabled(enabled) {
  for (const m of enhanced) {
    const has = 'SURFACE_DETAIL' in (m.defines || {});
    if (enabled === has) continue;
    if (enabled) m.defines.SURFACE_DETAIL = '';
    else delete m.defines.SURFACE_DETAIL;
    m.needsUpdate = true;
  }
}
