import * as THREE from 'three';

// ── 1. IndexedDB Satellite Texture Caching ────────────────────────────────────
const DB_NAME = 'CCG_3D_RenderCache';
const DB_VERSION = 1;
const STORE_TEXTURES = 'satellite_textures';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_TEXTURES)) {
        db.createObjectStore(STORE_TEXTURES);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function getCachedSatelliteBlob(cacheKey: string): Promise<Blob | null> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_TEXTURES, 'readonly');
      const store = transaction.objectStore(STORE_TEXTURES);
      const req = store.get(cacheKey);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedSatelliteBlob(cacheKey: string, blob: Blob): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_TEXTURES, 'readwrite');
      const store = transaction.objectStore(STORE_TEXTURES);
      store.put(blob, cacheKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  } catch {
    // Non-fatal cache failure
  }
}

/**
 * Loads a satellite texture with two-tier caching:
 * 1. Checks offline IndexedDB storage (sub-5ms retrieval)
 * 2. If missed, fetches over network from ESRI World Imagery, caches binary blob to IndexedDB, and returns Three.js Texture
 */
export async function loadCachedSatelliteTexture(
  url: string,
  cacheKey: string
): Promise<{ texture: THREE.Texture; fromCache: boolean }> {
  // Check IndexedDB
  const cachedBlob = await getCachedSatelliteBlob(cacheKey);
  if (cachedBlob) {
    const objectUrl = URL.createObjectURL(cachedBlob);
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        objectUrl,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          resolve({ texture: tex, fromCache: true });
        },
        undefined,
        (err) => reject(err)
      );
    });
  }

  // Network Fetch with Blob Caching
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`Failed to fetch satellite imagery: ${response.statusText}`);
  }

  const blob = await response.blob();
  // Asynchronously write to IndexedDB without blocking render
  setCachedSatelliteBlob(cacheKey, blob).catch(() => {});

  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      objectUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        resolve({ texture: tex, fromCache: false });
      },
      undefined,
      (err) => reject(err)
    );
  });
}

// ── 2. Topography Geometry Memory Cache ───────────────────────────────────────
const geometryPool = new Map<string, THREE.PlaneGeometry>();

export function getCachedTerrainGeometry(
  cacheKey: string
): THREE.PlaneGeometry | null {
  const geom = geometryPool.get(cacheKey);
  if (geom) {
    return geom.clone();
  }
  return null;
}

export function setCachedTerrainGeometry(
  cacheKey: string,
  geom: THREE.PlaneGeometry
): void {
  // Limit pool size to prevent unbounded memory growth
  if (geometryPool.size > 20) {
    const firstKey = geometryPool.keys().next().value;
    if (firstKey) {
      geometryPool.get(firstKey)?.dispose();
      geometryPool.delete(firstKey);
    }
  }
  geometryPool.set(cacheKey, geom.clone());
}

// ── 3. On-Demand / Dirty-Flag Render Controller ───────────────────────────────
export class RenderController {
  private isDirty = true;
  private continuousCounter = 0;

  public markDirty(): void {
    this.isDirty = true;
  }

  public keepAlive(frames: number = 30): void {
    this.continuousCounter = Math.max(this.continuousCounter, frames);
  }

  public shouldRender(): boolean {
    if (this.continuousCounter > 0) {
      this.continuousCounter--;
      return true;
    }
    if (this.isDirty) {
      this.isDirty = false;
      return true;
    }
    return false;
  }
}
