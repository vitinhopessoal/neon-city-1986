import * as THREE from 'three';

/**
 * Cache persistente do mapa local (dev-maps/vice-city).
 *
 * O cache HTTP comum do navegador descarta os ~260 MB de setores e texturas,
 * então o jogo baixava tudo de novo a cada `npm run dev`. Aqui cada arquivo vai
 * para o Cache Storage (disco, sem despejo por tamanho); nas aberturas seguintes
 * só se pergunta ao servidor se o arquivo mudou (If-None-Match → 304) e a cópia
 * local é usada. Se o mapa for reconvertido, o ETag muda e só aquele arquivo é
 * baixado de novo. Fora de http(s) (Electron app://) tudo segue pela rede.
 */
const CACHE_NAME = 'neon-city-vice-city-v1';
const enabled = typeof caches !== 'undefined' && typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
let cachePromise = null;

function openCache() {
  if (!enabled) return Promise.resolve(null);
  cachePromise ??= caches.open(CACHE_NAME).catch(err => {
    console.warn('[MapCache] Cache Storage indisponível:', err);
    return null;
  });
  return cachePromise;
}

export const mapCacheEnabled = enabled;

/**
 * Igual a fetch(url), mas reaproveita a cópia salva quando o servidor responde 304.
 * immutable: o nome do arquivo já é o hash do conteúdo (texturas do conversor),
 * então a cópia salva é usada sem nem consultar o servidor.
 */
export async function cachedFetch(url, { immutable = false } = {}) {
  const key = new URL(url, location.href).href;
  const cache = await openCache();
  if (!cache) return fetch(key);
  let cached = null;
  try { cached = await cache.match(key); } catch { cached = null; }
  if (cached && immutable) return cached;
  const etag = cached?.headers.get('ETag');
  let res;
  try {
    res = await fetch(key, etag ? { cache: 'no-store', headers: { 'If-None-Match': etag } } : { cache: 'no-store' });
  } catch (err) {
    if (cached) return cached; // servidor fora do ar: usa a cópia local
    throw err;
  }
  if (res.status === 304 && cached) return cached;
  if (res.ok && res.headers.get('ETag')) {
    try { await cache.put(key, res.clone()); } catch (err) { console.warn('[MapCache] não foi possível guardar', key, err); }
  }
  return res;
}

/** URIs externas (texturas) declaradas no JSON de um GLB. */
function externalImageUris(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67) return []; // 'glTF'
    const length = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
    return (json.images || []).map(i => i.uri).filter(uri => uri && !uri.startsWith('data:'));
  } catch { return []; }
}

/**
 * Busca as texturas externas de um GLB pelo cache e devolve um LoadingManager
 * que entrega ao GLTFLoader blob: URLs locais. `blobs` é compartilhado entre
 * setores (a mesma textura é lida uma vez só); chame releaseBlobs() ao terminar.
 */
export async function preloadTextures(buffer, base, blobs, concurrency = 8) {
  const manager = new THREE.LoadingManager();
  if (!enabled) return manager;
  const urls = [...new Set(externalImageUris(buffer).map(uri => new URL(THREE.LoaderUtils.resolveURL(uri, base), location.href).href))]
    .filter(url => !blobs.has(url));
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        // tools/vice-city/convert.py nomeia cada textura pelo SHA-256 dos pixels.
        const res = await cachedFetch(url, { immutable: /\/textures\/[0-9a-f]{20}\.png$/.test(url) });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blobs.has(url)) blobs.set(url, URL.createObjectURL(blob));
      } catch { /* o GLTFLoader tenta a URL original e reporta o erro */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  manager.setURLModifier(url => {
    try { return blobs.get(new URL(url, location.href).href) || url; } catch { return url; }
  });
  return manager;
}

export function releaseBlobs(blobs) {
  for (const url of blobs.values()) URL.revokeObjectURL(url);
  blobs.clear();
}
