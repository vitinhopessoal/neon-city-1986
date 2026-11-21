import * as THREE from 'three';
import { BEACH } from './Terrain.js';

/**
 * Oceano com shader leve: ondas somadas no vertex shader, profundidade
 * analítica (mesma função da areia), espuma na arrebentação, fresnel com a
 * cor do céu e brilho especular do sol. Integra a névoa da cena.
 */
const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vDepth;
  uniform float uFlatEnd;
  uniform float uDryHeight;
  uniform float uSlope;
  uniform float uMinHeight;
  uniform float uWaterLevel;
  uniform float uWaveAmp;
  #include <fog_pars_vertex>

  float sandH(float x) {
    return max(uMinHeight, uDryHeight - max(0.0, x - uFlatEnd) * uSlope);
  }

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float depth = uWaterLevel - sandH(wp.x);
    float damp = smoothstep(0.0, 1.6, depth) * uWaveAmp;
    vec2 p = wp.xz;
    float h = 0.0, dx = 0.0, dz = 0.0;
    // (direção, comprimento de onda, amplitude, velocidade)
    vec2 d1 = normalize(vec2(-1.0, 0.25)); float k1 = 6.2831 / 38.0; float a1 = 0.22; float w1 = 1.1;
    vec2 d2 = normalize(vec2(-1.0, -0.4)); float k2 = 6.2831 / 22.0; float a2 = 0.12; float w2 = 1.6;
    vec2 d3 = normalize(vec2(-0.7, 0.9));  float k3 = 6.2831 / 14.0; float a3 = 0.06; float w3 = 2.1;
    float f1 = k1 * dot(d1, p) + uTime * w1;
    float f2 = k2 * dot(d2, p) + uTime * w2;
    float f3 = k3 * dot(d3, p) + uTime * w3;
    h = a1 * sin(f1) + a2 * sin(f2) + a3 * sin(f3);
    dx = a1 * k1 * d1.x * cos(f1) + a2 * k2 * d2.x * cos(f2) + a3 * k3 * d3.x * cos(f3);
    dz = a1 * k1 * d1.y * cos(f1) + a2 * k2 * d2.y * cos(f2) + a3 * k3 * d3.y * cos(f3);
    wp.y += h * damp;
    vNormalW = normalize(vec3(-dx * damp, 1.0, -dz * damp));
    vWorldPos = wp.xyz;
    vDepth = depth;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSkyColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uFoam;
  uniform float uRipple;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vDepth;
  #include <common>
  #include <fog_pars_fragment>

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  void main() {
    vec3 V = normalize(cameraPosition - vWorldPos);
    float dist = length(cameraPosition - vWorldPos);
    // Ondulações finas no fragment shader (desaparecem ao longe).
    vec2 q = vWorldPos.xz;
    float fade = (1.0 - smoothstep(40.0, 260.0, dist)) * uRipple;
    vec2 r1 = vec2(sin(q.x * 0.9 + uTime * 1.7 + q.y * 0.3), cos(q.y * 1.1 - uTime * 1.3 + q.x * 0.2));
    vec2 r2 = vec2(sin(q.y * 2.3 + uTime * 2.6), cos(q.x * 2.1 - uTime * 2.2));
    vec3 N = normalize(vNormalW + vec3(r1.x * 0.05 + r2.x * 0.025, 0.0, r1.y * 0.05 + r2.y * 0.025) * fade);

    float depthMix = smoothstep(0.0, 2.6, vDepth);
    vec3 water = mix(uShallow, uDeep, depthMix) * 0.9;
    // Variação de tonalidade em grande escala (correntes, fundo irregular).
    float tone = noise(q * 0.011 + vec2(uTime * 0.004, 0.0)) * 0.6 + noise(q * 0.035 - uTime * 0.01) * 0.4;
    water *= 0.9 + tone * 0.2;
    water = mix(water, uShallow * 0.8, (1.0 - depthMix) * tone * 0.25);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 skyRefl = mix(uSkyColor, uHorizonColor, 0.55);
    // Reflexo do céu limitado: o mar continua turquesa perto e reflete o pôr do sol ao longe.
    float refl = clamp(fres * 0.7 + 0.03, 0.0, 0.7) * mix(0.6, 1.0, smoothstep(30.0, 400.0, dist));
    vec3 col = mix(water, skyRefl, refl);

    // Brilho do sol.
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(N, H), 0.0), 220.0) * 2.6 + pow(max(dot(N, H), 0.0), 18.0) * 0.12;
    col += uSunColor * spec;

    // Espuma na arrebentação e linhas que avançam para a areia.
    float n = noise(q * 0.35 + vec2(uTime * 0.15, 0.0)) * 0.6 + noise(q * 1.3 - uTime * 0.2) * 0.4;
    // Borda de espuma estreita que "respira" com as ondas.
    float surge = sin(uTime * 0.9 + vWorldPos.z * 0.02) * 0.04;
    float shore = 1.0 - smoothstep(0.0, 0.07 + n * 0.08 + surge, vDepth);
    float lines = smoothstep(0.8, 0.97, sin(vWorldPos.x * 0.55 + uTime * 1.25 + n * 3.0) * 0.5 + 0.5);
    lines *= (1.0 - smoothstep(0.15, 0.9, vDepth)) * smoothstep(0.08, 0.2, vDepth);
    float foam = clamp(shore * 0.85 + lines * 0.6 * n, 0.0, 1.0);
    col = mix(col, uFoam, foam);

    float alpha = mix(0.55, 0.97, smoothstep(0.0, 1.4, vDepth));
    alpha = max(alpha, foam * 0.95);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class Ocean {
  constructor({ sunDir, sunColor, skyColor, horizonColor }) {
    // Malha com ondas só na área visível de perto (~5 m x 15 m por célula, como
    // antes); além disso o anel distante plano continua até o horizonte.
    const width = 620, depth = 1100;
    const geo = new THREE.PlaneGeometry(width, depth, 124, 74);
    geo.rotateX(-Math.PI / 2);
    geo.translate(78 + width / 2, 0, 0);
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: sunDir.clone() },
        uSunColor: { value: sunColor.clone() },
        uShallow: { value: new THREE.Color(0x2fd3c6) },
        uDeep: { value: new THREE.Color(0x0b5a86) },
        uSkyColor: { value: skyColor.clone() },
        uHorizonColor: { value: horizonColor.clone() },
        uFoam: { value: new THREE.Color(0xfdf7ee) },
        uFlatEnd: { value: BEACH.flatEnd },
        uDryHeight: { value: BEACH.dryHeight },
        uSlope: { value: BEACH.slope },
        uMinHeight: { value: BEACH.minHeight },
        uWaterLevel: { value: BEACH.waterLevel },
        uWaveAmp: { value: 1 },
        uRipple: { value: 1 },
      },
    ]);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      fog: true,
      depthWrite: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = BEACH.waterLevel;
    this.mesh.name = 'ocean';
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
    // A geometria parte de y = 0; a altura da água entra via modelMatrix.

    // Mar distante: anel plano (sem ondas) ao redor da malha próxima, até além
    // da distância de renderização — elimina bordas geométricas no horizonte.
    // Compartilha os uniformes (mesmas cores/tempo), exceto a amplitude das ondas.
    const farUniforms = { ...this.uniforms, uWaveAmp: { value: 0 } };
    this.farMaterial = new THREE.ShaderMaterial({ uniforms: farUniforms, vertexShader, fragmentShader, transparent: true, fog: true });
    const R = 9000, x0 = 78, x1 = 78 + width, z1 = depth / 2;
    const parts = [
      [x1, R, -R, R],       // leste
      [x0, x1, -R, -z1],    // norte
      [x0, x1, z1, R],      // sul
    ];
    this.far = new THREE.Group();
    for (const [ax, bx, az, bz] of parts) {
      const g = new THREE.PlaneGeometry(bx - ax, bz - az, 1, 1);
      g.rotateX(-Math.PI / 2);
      g.translate((ax + bx) / 2, -0.02, (az + bz) / 2);
      const m = new THREE.Mesh(g, this.farMaterial);
      m.renderOrder = 1;
      m.frustumCulled = false;
      this.far.add(m);
    }
    this.mesh.add(this.far);
  }

  /** Mantém os uniformes coerentes com o ambiente (preparado para ciclo dia/noite). */
  syncEnvironment({ sunDir, sunColor, skyColor, horizonColor, ocean }) {
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uSkyColor.value.copy(skyColor);
    this.uniforms.uHorizonColor.value.copy(horizonColor);
    if (ocean) {
      this.uniforms.uShallow.value.set(ocean.shallow);
      this.uniforms.uDeep.value.set(ocean.deep);
      this.uniforms.uFoam.value.set(ocean.foam);
    }
  }

  /** Perfil gráfico: 0 desliga as ondulações finas do fragment shader. */
  setDetail(level) {
    this.uniforms.uRipple.value = level;
  }

  update(elapsed) {
    this.uniforms.uTime.value = elapsed;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.farMaterial.dispose();
    this.far.children.forEach((m) => m.geometry.dispose());
  }
}
