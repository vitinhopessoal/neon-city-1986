import * as THREE from 'three';

/**
 * Céu procedural, sol/lua, iluminação, névoa e mapa de ambiente (reflexos).
 *
 * A iluminação é descrita por "presets de horário" (manhã, pôr do sol, noite).
 * setPreset() aplica luz, céu, névoa e exposição; os demais sistemas (neon,
 * janelas, postes, oceano) leem o mesmo preset via World.applyTimeOfDay().
 * Um ciclo contínuo futuro pode interpolar entre presets sem reestruturação.
 */
export const TIME_ORDER = ['morning', 'sunset', 'night'];

export const TIME_PRESETS = {
  morning: {
    label: 'MANHÃ',
    sunElevation: 32, sunAzimuth: 18, sunColor: 0xfff0dc, sunIntensity: 3.3,
    skyTop: 0x2f78d0, skyMid: 0x78b6ea, horizon: 0xd2e8f3, glow: 0xfff3d8, ground: 0xb4c4cc,
    hemiSky: 0xcfe2ff, hemiGround: 0xd8c6a4, hemiIntensity: 0.95, envIntensity: 0.5,
    fogColor: 0xcfe2ee, fogNear: 140, exposure: 1.0,
    cloudColor: 0xffffff, cloudShade: 0xb6c6da, cloudCover: 0.5,
    stars: 0, moon: 0, disk: 3.0,
    neon: 0.5, windowsLit: 0.25, windowsDim: 0.0, lamps: 0.0, pools: 0.0, pointLights: false, facadeGlow: 0.0,
    ocean: { shallow: 0x36d6c8, deep: 0x0d6aa0, foam: 0xffffff },
    // Limiar alto de dia: fachadas ao sol (HDR) não "estouram"; à noite só neon/luzes brilham.
    bloom: 0.25, bloomThreshold: 3.0,
  },
  sunset: {
    label: 'PÔR DO SOL',
    sunElevation: 10.5, sunAzimuth: -28, sunColor: 0xffb47a, sunIntensity: 3.5,
    skyTop: 0x2a4aa6, skyMid: 0x8a78cc, horizon: 0xffa064, glow: 0xffd8a0, ground: 0xd88a74,
    hemiSky: 0x9fb2ec, hemiGround: 0xe0a070, hemiIntensity: 0.8, envIntensity: 0.38,
    fogColor: 0xf2ab86, fogNear: 90, exposure: 1.0,
    cloudColor: 0xffc9a8, cloudShade: 0x9a6fa8, cloudCover: 0.52,
    stars: 0, moon: 0, disk: 3.0,
    neon: 1.0, windowsLit: 0.9, windowsDim: 0.05, lamps: 0.55, pools: 0.18, pointLights: true, facadeGlow: 0.03,
    ocean: { shallow: 0x2fd3c6, deep: 0x0b5a86, foam: 0xfdf7ee },
    bloom: 0.55, bloomThreshold: 2.4,
  },
  night: {
    label: 'NOITE',
    // A luz direcional vira o luar (azulado, fraco, com sombras suaves).
    sunElevation: 38, sunAzimuth: -62, sunColor: 0x9fb4ff, sunIntensity: 0.6,
    skyTop: 0x04060f, skyMid: 0x0d1430, horizon: 0x2a2050, glow: 0x3c3470, ground: 0x0a0b16,
    hemiSky: 0x2a3a7a, hemiGround: 0x2a1830, hemiIntensity: 0.55, envIntensity: 0.22,
    fogColor: 0x161430, fogNear: 70, exposure: 1.18,
    cloudColor: 0x2b3060, cloudShade: 0x0d1028, cloudCover: 0.45,
    stars: 1, moon: 1, disk: 1.3,
    neon: 1.6, windowsLit: 2.1, windowsDim: 0.35, lamps: 2.4, pools: 0.95, pointLights: true, facadeGlow: 0.2,
    ocean: { shallow: 0x0e3c4c, deep: 0x041a2e, foam: 0x7f8fb0 },
    bloom: 0.85, bloomThreshold: 0.85,
  },
};

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uCloud;
  uniform vec3 uCloudShade;
  uniform float uTime;
  uniform float uCloudOctaves;
  uniform float uCloudCover;
  uniform float uStars;
  uniform float uMoon;
  uniform float uDisk;
  varying vec3 vDir;

  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      if (float(i) >= uCloudOctaves) break;
      v += a * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float sd = max(dot(d, uSunDir), 0.0);

    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.28, h));
    col = mix(col, uTop, smoothstep(0.22, 0.85, h));
    // Brilho quente em torno do sol, mais forte perto do horizonte.
    float band = 1.0 - smoothstep(0.0, 0.45, abs(h));
    col = mix(col, uGlow, pow(sd, 5.0) * 0.75 * band + pow(sd, 2.0) * 0.15 * band);
    // Abaixo do horizonte (visível apenas além do oceano).
    col = mix(col, uGround, smoothstep(0.0, -0.08, h));

    // Nuvens leves projetadas num plano alto.
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
      float c = fbm(uv * 1.1);
      float cover = smoothstep(uCloudCover, uCloudCover + 0.26, c) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.55, 0.95, h));
      float lit = pow(sd, 3.0);
      vec3 cc = mix(uCloudShade, uCloud, 0.35 + 0.65 * lit);
      cc += uGlow * pow(sd, 12.0) * 0.6;
      col = mix(col, cc, cover * 0.85);
    }

    // Estrelas (apenas à noite), com leve cintilação.
    if (uStars > 0.0 && h > 0.0) {
      vec3 sp = d * 320.0;
      vec3 cell = floor(sp);
      float r = hash3(cell);
      float star = step(0.9965, r) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5));
      float tw = 0.7 + 0.3 * sin(uTime * 2.0 + r * 60.0);
      col += vec3(0.85, 0.9, 1.0) * star * tw * uStars * smoothstep(0.04, 0.3, h) * 1.6;
    }

    // Disco do sol (ou da lua) e halo.
    float disk = smoothstep(0.99955, 0.99975, sd);
    if (uMoon > 0.5) {
      float moonDisk = smoothstep(0.99935, 0.9996, sd);
      col += vec3(0.92, 0.94, 1.0) * moonDisk * uDisk;
      col += uSunColor * (pow(sd, 400.0) * 0.35 + pow(sd, 30.0) * 0.08);
    } else {
      col += uSunColor * disk * uDisk;
      col += uSunColor * (pow(sd, 900.0) * 1.2 + pow(sd, 60.0) * 0.25);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Environment {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.sunDir = new THREE.Vector3();
    this.preset = null;

    // Luz solar com sombra (única luz que projeta sombras).
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 900;
    // A sombra deve incluir todas as camadas (inclusive a cabeça do jogador,
    // que fica oculta da câmera principal na primeira pessoa).
    this.sun.shadow.camera.layers.enableAll();
    this.setShadowQuality(quality);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    scene.add(this.hemi);

    // Céu.
    this.skyUniforms = {
      uSunDir: { value: new THREE.Vector3() },
      uTop: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uCloud: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uTime: { value: 0 },
      uCloudOctaves: { value: quality.label === 'BAIXA' ? 3 : 5 },
      uCloudCover: { value: 0.52 },
      uStars: { value: 0 },
      uMoon: { value: 0 },
      uDisk: { value: 3 },
    };
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMaterial);
    this.sky.scale.setScalar(1800);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.sky.name = 'sky';
    scene.add(this.sky);

    scene.fog = new THREE.Fog(0xffffff, 90, quality.drawDistance);
    this.envMap = null;
    this.setPreset('sunset');

    this._snap = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
  }

  setShadowQuality(q) {
    const s = this.sun.shadow;
    const size = q.shadowMapSize;
    if (s.mapSize.x !== size) {
      s.mapSize.set(size, size);
      if (s.map) { s.map.dispose(); s.map = null; }
    }
    const e = q.shadowExtent;
    s.camera.left = -e;
    s.camera.right = e;
    s.camera.top = e;
    s.camera.bottom = -e;
    s.camera.updateProjectionMatrix();
    this.sun.castShadow = q.shadows;
    this.shadowExtent = e;
    this.shadowMapSize = size;
  }

  setPreset(name) {
    const p = TIME_PRESETS[name];
    if (!p) throw new Error(`Horário desconhecido: ${name}`);
    this.preset = p;
    this.presetName = name;
    const el = THREE.MathUtils.degToRad(p.sunElevation);
    const az = THREE.MathUtils.degToRad(p.sunAzimuth);
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();

    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;

    const u = this.skyUniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uTop.value.set(p.skyTop);
    u.uMid.value.set(p.skyMid);
    u.uHorizon.value.set(p.horizon);
    u.uGlow.value.set(p.glow);
    u.uGround.value.set(p.ground);
    u.uSunColor.value.set(p.sunColor);
    u.uCloudCover.value = p.cloudCover ?? 0.52;
    u.uStars.value = p.stars ?? 0;
    u.uMoon.value = p.moon ?? 0;
    u.uDisk.value = p.disk ?? 3;
    u.uCloud.value.set(p.cloudColor);
    u.uCloudShade.value.set(p.cloudShade);

    this.scene.fog.color.set(p.fogColor);
    this.scene.fog.near = p.fogNear;
    this.renderer.toneMappingExposure = p.exposure;
  }

  /** Cores relevantes para o oceano e outros shaders. */
  get palette() {
    return {
      sunDir: this.sunDir,
      sunColor: this.sun.color,
      skyColor: this.skyUniforms.uMid.value,
      horizonColor: this.skyUniforms.uHorizon.value,
      ocean: this.preset?.ocean,
      night: (this.preset?.moon ?? 0) > 0.5,
    };
  }

  /** Gera o mapa de ambiente (PMREM) a partir do céu procedural, para reflexos. */
  buildEnvironmentMap() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const skyClone = new THREE.Mesh(this.sky.geometry, this.skyMaterial);
    skyClone.scale.setScalar(100);
    envScene.add(skyClone);
    // Regenerado a cada troca de horário: descarta o render target anterior por inteiro.
    if (this.envRT) this.envRT.dispose();
    const rt = pmrem.fromScene(envScene, 0.02, 0.1, 500);
    this.envRT = rt;
    this.envMap = rt.texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = this.preset.envIntensity ?? 0.4;
    pmrem.dispose();
  }

  setDrawDistance(d) {
    this.scene.fog.far = d;
  }

  /** Faz a câmera de sombra seguir o jogador, alinhada à grade de texels (sem tremulação). */
  update(dt, elapsed, focus, camera) {
    this.skyUniforms.uTime.value = elapsed;
    this.sky.position.copy(camera.position);

    const dir = this.sunDir;
    this._right.set(0, 1, 0).cross(dir).normalize();
    this._up.copy(dir).cross(this._right).normalize();
    const texel = (this.shadowExtent * 2) / this.shadowMapSize;
    let r = focus.dot(this._right);
    let u = focus.dot(this._up);
    const f = focus.dot(dir);
    r = Math.round(r / texel) * texel;
    u = Math.round(u / texel) * texel;
    this._snap.copy(this._right).multiplyScalar(r).addScaledVector(this._up, u).addScaledVector(dir, f);
    this.sun.target.position.copy(this._snap);
    this.sun.position.copy(this._snap).addScaledVector(dir, 400);
    this.sun.target.updateMatrixWorld();
  }
}
