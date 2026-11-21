import * as THREE from 'three';

/**
 * Letreiros neon gerados com CanvasTexture (sem imagens externas).
 * Cada letreiro tem textura própria, material emissivo (sem tone mapping)
 * e um halo aditivo leve. O NeonSignSystem controla a cintilação.
 */

const FONTS = {
  script: (px) => `italic bold ${px}px "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive`,
  block: (px) => `900 ${px}px "Arial Black", "Impact", "Helvetica Neue", Arial, sans-serif`,
  deco: (px) => `bold ${px}px "Futura", "Century Gothic", "Trebuchet MS", "Arial", sans-serif`,
};

function lighten(hex, k) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), k);
  return `#${c.getHexString()}`;
}

function fitFont(ctx, text, style, maxW, maxH) {
  let px = Math.floor(maxH);
  ctx.font = FONTS[style](px);
  const w = ctx.measureText(text).width;
  if (w > maxW) px = Math.floor(px * (maxW / w));
  ctx.font = FONTS[style](px);
  return px;
}

function drawGlowText(ctx, text, x, y, color, style, px, outline) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = FONTS[style](px);
  const core = lighten(color, 0.55);
  if (outline) {
    ctx.shadowColor = color;
    ctx.shadowBlur = px * 0.35;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, px * 0.09);
    ctx.strokeText(text, x, y);
    ctx.shadowBlur = px * 0.15;
    ctx.strokeText(text, x, y);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = core;
    ctx.lineWidth = Math.max(1.5, px * 0.035);
    ctx.strokeText(text, x, y);
  } else {
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.shadowBlur = px * 0.4;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = px * 0.18;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = core;
    ctx.fillText(text, x, y);
  }
}

/**
 * Cache de texturas de letreiros: parâmetros idênticos reutilizam a mesma
 * textura (e o mesmo canvas). Cada uso registra uma referência; dispose só
 * libera a GPU quando a última referência é solta.
 */
const _texCache = new Map();
function cached(key, make) {
  let e = _texCache.get(key);
  if (!e) {
    e = { tex: make(), refs: 0 };
    _texCache.set(key, e);
    const t = e.tex;
    const baseDispose = t.dispose.bind(t);
    t.dispose = () => {
      e.refs--;
      if (e.refs <= 0) { _texCache.delete(key); baseDispose(); }
    };
  }
  e.refs++;
  return e.tex;
}

/** Estatísticas do cache (diagnóstico). */
export function signTextureCacheStats() {
  let refs = 0;
  for (const e of _texCache.values()) refs += e.refs;
  return { textures: _texCache.size, references: refs };
}

/** Gera (ou reutiliza) a textura de um letreiro horizontal. */
export function neonTextTexture(text, opts = {}) {
  const o = { color: '#ff4fd8', style: 'script', width: 1024, height: 256, outline: false, sub: null, subColor: null, frame: null, ...opts };
  return cached(`text|${text}|${o.color}|${o.style}|${o.width}|${o.height}|${o.outline}|${o.sub}|${o.subColor}|${o.frame}`, () => makeTextTexture(text, o));
}

function makeTextTexture(text, { color, style, width, height, outline, sub, subColor, frame }) {
  // Constantes de traço desenhadas para 1024 px; escalam com a resolução.
  const k = width / 1024;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  if (frame) {
    ctx.shadowColor = frame;
    ctx.shadowBlur = 18 * k;
    ctx.strokeStyle = frame;
    ctx.lineWidth = 7 * k;
    const r = height * 0.18;
    const x0 = 14 * k, y0 = 14 * k, x1 = width - 14 * k, y1 = height - 14 * k;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x1, y0, x1, y1, r);
    ctx.arcTo(x1, y1, x0, y1, r);
    ctx.arcTo(x0, y1, x0, y0, r);
    ctx.arcTo(x0, y0, x1, y0, r);
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = lighten(frame, 0.6);
    ctx.lineWidth = 2.5 * k;
    ctx.stroke();
  }

  const mainH = sub ? height * 0.55 : height * 0.62;
  const px = fitFont(ctx, text, style, width * 0.86, mainH);
  const y = sub ? height * 0.42 : height * 0.52;
  drawGlowText(ctx, text, width / 2, y, color, style, px, outline);
  if (sub) {
    const spx = fitFont(ctx, sub, 'deco', width * 0.7, height * 0.2);
    drawGlowText(ctx, sub, width / 2, height * 0.78, subColor || color, 'deco', spx, false);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Gera (ou reutiliza) a textura de um letreiro vertical (letras empilhadas). */
export function neonVerticalTexture(text, opts = {}) {
  const o = { color: '#45f3ff', width: 192, height: 1024, style: 'block', ...opts };
  return cached(`vert|${text}|${o.color}|${o.width}|${o.height}|${o.style}`, () => makeVerticalTexture(text, o));
}

function makeVerticalTexture(text, { color, width, height, style }) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const letters = [...text];
  const cell = height / letters.length;
  const px = Math.min(width * 0.78, cell * 0.86);
  letters.forEach((ch, i) => {
    if (ch === ' ') return;
    drawGlowText(ctx, ch, width / 2, cell * (i + 0.53), color, style, px, false);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Textura de ícone desenhado (sol, onda, palmeira, flamingo). */
export function neonIconTexture(kind, color, color2 = null, size = 512) {
  return cached(`icon|${kind}|${color}|${color2}|${size}`, () => makeIconTexture(kind, color, color2, size));
}

function makeIconTexture(kind, color, color2, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const s = size;
  const stroke = (col, w, blur) => {
    ctx.shadowColor = col;
    ctx.shadowBlur = blur;
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };
  const pass = (draw, col) => {
    stroke(col, s * 0.028, s * 0.07); draw();
    stroke(lighten(col, 0.6), s * 0.01, 0); draw();
  };
  if (kind === 'sun') {
    pass(() => { ctx.beginPath(); ctx.arc(s / 2, s * 0.62, s * 0.22, Math.PI, 0); ctx.stroke(); }, color);
    pass(() => {
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        ctx.moveTo(s / 2 + Math.cos(a) * s * 0.28, s * 0.62 + Math.sin(a) * s * 0.28);
        ctx.lineTo(s / 2 + Math.cos(a) * s * 0.4, s * 0.62 + Math.sin(a) * s * 0.4);
      }
      ctx.stroke();
    }, color2 || color);
    pass(() => {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        ctx.moveTo(s * 0.22, s * (0.7 + i * 0.07));
        ctx.lineTo(s * 0.78, s * (0.7 + i * 0.07));
      }
      ctx.stroke();
    }, color);
  } else if (kind === 'wave') {
    pass(() => {
      ctx.beginPath();
      for (let k = 0; k < 2; k++) {
        const y = s * (0.45 + k * 0.18);
        ctx.moveTo(s * 0.1, y);
        for (let i = 0; i <= 40; i++) {
          const x = s * 0.1 + (i / 40) * s * 0.8;
          ctx.lineTo(x, y + Math.sin(i / 40 * Math.PI * 4) * s * 0.06);
        }
      }
      ctx.stroke();
    }, color);
  } else if (kind === 'palm') {
    pass(() => {
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.92);
      ctx.quadraticCurveTo(s * 0.44, s * 0.6, s * 0.52, s * 0.32);
      ctx.stroke();
    }, color2 || color);
    pass(() => {
      ctx.beginPath();
      const cx = s * 0.52, cy = s * 0.32;
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI * 0.95 + (i / 5) * Math.PI * 0.9;
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx + Math.cos(a) * s * 0.25, cy + Math.sin(a) * s * 0.2, cx + Math.cos(a) * s * 0.36, cy + Math.sin(a) * s * 0.06 + s * 0.12);
      }
      ctx.stroke();
    }, color);
  } else if (kind === 'flamingo') {
    pass(() => {
      ctx.beginPath();
      ctx.ellipse(s * 0.5, s * 0.5, s * 0.17, s * 0.11, -0.2, 0, Math.PI * 2);
      ctx.moveTo(s * 0.4, s * 0.45);
      ctx.quadraticCurveTo(s * 0.28, s * 0.2, s * 0.38, s * 0.14);
      ctx.lineTo(s * 0.46, s * 0.18);
      ctx.moveTo(s * 0.5, s * 0.6);
      ctx.lineTo(s * 0.5, s * 0.9);
      ctx.moveTo(s * 0.5, s * 0.75);
      ctx.lineTo(s * 0.6, s * 0.68);
      ctx.stroke();
    }, color);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Cria a malha do letreiro. Retorna { group, materials }.
 * O plano emissivo fica levemente à frente da placa de fundo (se houver).
 */
export function createSignMesh(texture, width, height, {
  intensity = 1.5,
  backing = null,
  backingDepth = 0.18,
  glowColor = null,
  glowMaterialFactory = null,
  doubleSided = false,
} = {}) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    color: new THREE.Color(intensity, intensity, intensity),
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  mat.userData.baseIntensity = intensity;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  plane.position.z = backing ? backingDepth / 2 + 0.02 : 0.03;
  plane.renderOrder = 2;
  group.add(plane);

  if (backing !== null) {
    const bm = new THREE.MeshStandardMaterial({ color: backing, roughness: 0.6, metalness: 0.2 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, height * 1.04, backingDepth), bm);
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
  }

  if (glowColor !== null && glowMaterialFactory) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.5, height * 2.2), glowMaterialFactory(glowColor));
    g.position.z = plane.position.z + 0.01;
    g.renderOrder = 3;
    group.add(g);
  }

  return { group, material: mat };
}

/**
 * Controla a cintilação dos letreiros: alguns piscam ocasionalmente
 * como neon antigo, outros pulsam suavemente.
 */
export class NeonSignSystem {
  constructor() {
    this.entries = [];
    /** Intensidade global (horário): 1 = pôr do sol. */
    this.multiplier = 1;
  }

  /** mode: 'steady' | 'pulse' | 'flicker' */
  register(material, mode = 'steady', seed = Math.random() * 100) {
    const base = material.userData.baseIntensity ?? 1;
    const baseColor = material.userData.baseColor ? material.userData.baseColor.clone() : null;
    this.entries.push({ material, mode, seed, base, baseColor, nextFlicker: 2 + (seed % 7), flickerT: 0 });
  }

  update(dt, elapsed) {
    for (const e of this.entries) {
      let k = 1;
      if (e.mode === 'pulse') {
        k = 0.88 + 0.12 * Math.sin(elapsed * 2.2 + e.seed);
      } else if (e.mode === 'flicker') {
        e.nextFlicker -= dt;
        if (e.nextFlicker <= 0) {
          e.flickerT = 0.35 + (Math.sin(e.seed * 13.1 + elapsed) * 0.5 + 0.5) * 0.4;
          e.nextFlicker = 4 + ((e.seed * 7.7 + elapsed * 3.3) % 9);
        }
        if (e.flickerT > 0) {
          e.flickerT -= dt;
          const s = Math.sin(elapsed * 61 + e.seed) * Math.sin(elapsed * 23 + e.seed * 2);
          k = s > 0.1 ? 1 : 0.18;
        }
      }
      k *= this.multiplier;
      if (e.baseColor) {
        e.material.color.copy(e.baseColor).multiplyScalar(k);
      } else {
        e.material.color.setScalar(e.base * k);
      }
    }
  }
}
