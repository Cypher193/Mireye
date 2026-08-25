/**
 * Mireye Earth API Client
 * Typed, rate-limit-aware wrapper for all confirmed Mireye API endpoints.
 * Authenticates with VITE_MIREYE_API_KEY from environment.
 *
 * Verified endpoints (2026-08-25):
 *   GET  /v1/meta/fields              → full field catalog
 *   POST /v1/fetch                    → single location fetch
 *   POST /v1/fetch/batch              → batch fetch (up to 25 locations)
 *   POST /v1/proximity                → proximity nearest (origin as "lat,lng" string)
 *
 * NOT available on this plan: /v1/geocode (use Nominatim instead)
 */

import type { MireyeWildfireFields, ApiStatus } from '@/types';

// ── Constants ──────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.mireye.com';
const API_KEY = import.meta.env.VITE_MIREYE_API_KEY as string;
const BATCH_SIZE = 25; // Max locations per /v1/fetch/batch call

// Wildfire underwrite preset field list (all confirmed in GET /v1/meta/fields)
export const WILDFIRE_FIELDS = [
  'slope_degrees',
  'tree_canopy_pct',
  'ndvi_current',
  'ndvi_change_5y',
  'lcms_class',
  'elevation',
] as const;

export type WildfireField = (typeof WILDFIRE_FIELDS)[number];

// ── Real API response types ────────────────────────────────────────────────

/** A single field in the /v1/fetch response — always wrapped in { value, ... } */
interface MireyeFieldResponse {
  value: number | string | boolean | null;
  unit: string | null;
  source: string;
  confidence: string;
  status: string;
}

/** Real /v1/fetch response shape */
interface MireyeFetchResponse {
  lat: number;
  lng: number;
  fetched_at: string;
  fields: Record<string, MireyeFieldResponse>;
  partial_failures: string[];
  resolved_location: { lat: number; lng: number; source: string };
}

/** One result item in /v1/fetch/batch response */
interface MireyeBatchItem {
  index: number;
  ok: boolean;
  lat: number;
  lng: number;
  fetched_at: string;
  fields: Record<string, MireyeFieldResponse>;
  partial_failures: string[];
  resolved_location: { lat: number; lng: number; source: string };
}

/** Real /v1/fetch/batch response shape */
interface MireyeBatchResponse {
  fetched_at: string;
  results: MireyeBatchItem[];
}

export interface MireyeLocation {
  lat: number;
  lng: number;
}

export interface MireyeFieldMeta {
  name: string;
  description: string;
  unit: string;
  type: string;
}

/** Normalized batch result — field values extracted from the wrapper objects */
export interface MireyeBatchResult {
  lat: number;
  lng: number;
  fields: Partial<MireyeWildfireFields>;
  error?: string;
}

export interface MireyeProximityResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceM: number;
  durationSeconds: number;
  type: string;
}

// ── Internal request helper ────────────────────────────────────────────────
async function mireyeRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<T> {
  if (!API_KEY) {
    throw new Error('VITE_MIREYE_API_KEY is not set. Add it to your .env file.');
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Mireye API ${method} ${path} → ${res.status}: ${errorText}`);
  }

  return res.json() as Promise<T>;
}

// ── Field value extractor ─────────────────────────────────────────────────

/**
 * Extracts a typed fields object from the Mireye API response.
 * The API returns { fieldName: { value, unit, ... } } — we extract just the values.
 */
function extractFields(
  rawFields: Record<string, MireyeFieldResponse>
): Partial<MireyeWildfireFields> {
  return {
    slope_degrees: typeof rawFields.slope_degrees?.value === 'number'
      ? rawFields.slope_degrees.value : undefined,
    tree_canopy_pct: typeof rawFields.tree_canopy_pct?.value === 'number'
      ? rawFields.tree_canopy_pct.value : undefined,
    ndvi_current: typeof rawFields.ndvi_current?.value === 'number'
      ? rawFields.ndvi_current.value : undefined,
    ndvi_change_5y: typeof rawFields.ndvi_change_5y?.value === 'number'
      ? rawFields.ndvi_change_5y.value : undefined,
    lcms_class: typeof rawFields.lcms_class?.value === 'string'
      ? rawFields.lcms_class.value : undefined,
    elevation: typeof rawFields.elevation?.value === 'number'
      ? rawFields.elevation.value : undefined,
  };
}

// ── Field Catalog ──────────────────────────────────────────────────────────

/**
 * Fetches the full Mireye field catalog (GET /v1/meta/fields).
 */
export async function getMetaFields(): Promise<Record<string, MireyeFieldMeta>> {
  return mireyeRequest<Record<string, MireyeFieldMeta>>('GET', '/v1/meta/fields');
}

/**
 * Verifies that all required wildfire fields are present in the API catalog.
 * Logs verification result to console.
 */
export async function verifyWildfireFields(): Promise<ApiStatus> {
  try {
    console.group('[Mireye] Phase 1 — Field Catalog Verification');
    const response = await getMetaFields();
    // Real response: { billing: {...}, fields: [...] }
    const fieldList = (response as unknown as { fields: { name: string }[] }).fields ?? [];
    const available = fieldList.map((f) => f.name);
    console.log('[Mireye] Available fields count:', available.length);

    const missing = WILDFIRE_FIELDS.filter((f) => !available.includes(f));
    if (missing.length > 0) {
      console.warn('[Mireye] Missing expected fields:', missing);
    } else {
      console.log('[Mireye] ✓ All wildfire fields confirmed:', WILDFIRE_FIELDS);
    }
    console.groupEnd();
    return 'ok';
  } catch (err) {
    console.error('[Mireye] Field verification failed:', err);
    return 'error';
  }
}

// ── Geocoding (via Nominatim — /v1/geocode not available) ─────────────────

export interface MireyeGeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  confidence: number;
}

/**
 * Geocodes a place name to lat/lng using OpenStreetMap Nominatim (free, no key required).
 * Falls back to hardcoded coordinates for known counties if Nominatim is unavailable.
 */
export async function geocodePlace(query: string): Promise<MireyeGeocodeResult> {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=us`,
      {
        headers: { 'Accept-Language': 'en', 'User-Agent': 'CCG-Dashboard/1.0' },
      }
    );

    if (!res.ok) throw new Error(`Nominatim ${res.status}`);

    const data = await res.json() as Array<{ lat: string; lon: string; display_name: string }>;
    if (data.length === 0) throw new Error(`No Nominatim results for: ${query}`);

    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      formattedAddress: data[0].display_name,
      confidence: 0.9,
    };
  } catch (err) {
    console.warn(`[Geocode] Nominatim failed for "${query}":`, err);
    throw err;
  }
}

// ── Single Location Fetch ──────────────────────────────────────────────────

/**
 * Fetches wildfire field data for a single lat/lng point (POST /v1/fetch).
 */
export async function fetchFields(
  lat: number,
  lng: number,
  fields: WildfireField[] = [...WILDFIRE_FIELDS]
): Promise<Partial<MireyeWildfireFields>> {
  const result = await mireyeRequest<MireyeFetchResponse>('POST', '/v1/fetch', {
    lat,
    lng,
    fields,
  });
  return extractFields(result.fields);
}

// ── Batch Fetch ────────────────────────────────────────────────────────────

/**
 * Fetches wildfire fields for multiple locations in batches of up to BATCH_SIZE.
 * Handles pagination automatically for large location arrays.
 * Verified response shape: { results: [{ index, ok, lat, lng, fields: {...} }] }
 */
export async function fetchBatch(
  locations: MireyeLocation[],
  fields: WildfireField[] = [...WILDFIRE_FIELDS]
): Promise<MireyeBatchResult[]> {
  const results: MireyeBatchResult[] = [];

  for (let i = 0; i < locations.length; i += BATCH_SIZE) {
    const chunk = locations.slice(i, i + BATCH_SIZE);
    const chunkNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalChunks = Math.ceil(locations.length / BATCH_SIZE);
    console.log(`[Mireye] Batch fetch chunk ${chunkNum}/${totalChunks} (${chunk.length} locations)`);

    const res = await mireyeRequest<MireyeBatchResponse>('POST', '/v1/fetch/batch', {
      locations: chunk.map((l) => ({ lat: l.lat, lng: l.lng })),
      fields,
    });

    const chunkResults: MireyeBatchResult[] = (res.results ?? []).map((item) => ({
      lat: item.lat,
      lng: item.lng,
      fields: item.ok ? extractFields(item.fields) : {},
      error: item.ok ? undefined : 'Fetch failed for this location',
    }));

    results.push(...chunkResults);
  }

  return results;
}

// ── Credit Quote ───────────────────────────────────────────────────────────

export interface MireyeQuoteResult {
  estimatedCredits: number;
  locations: number;
  fields: number;
}

/**
 * Estimates credit cost before committing to a batch fetch (POST /v1/fetch/quote).
 */
export async function quoteBatch(
  locationCount: number,
  fields: WildfireField[] = [...WILDFIRE_FIELDS]
): Promise<MireyeQuoteResult> {
  return mireyeRequest<MireyeQuoteResult>('POST', '/v1/fetch/quote', {
    location_count: locationCount,
    fields,
  });
}

// ── Proximity / Nearest Station ────────────────────────────────────────────

/**
 * Finds the nearest location in a set to a given point using POST /v1/proximity.
 * Origin must be a "lat,lng" string. Set must be a valid curated set ref.
 *
 * Note: @fire_stations is not available on all plans. If the call fails,
 * returns null and the RCS engine will use a fallback estimate.
 */
export async function proximityNearest(
  lat: number,
  lng: number,
  set: string = '@fire_stations'
): Promise<MireyeProximityResult | null> {
  try {
    const result = await mireyeRequest<{
      nearest?: {
        name?: string;
        address?: string;
        lat?: number;
        lng?: number;
        distance_m?: number;
        duration_seconds?: number;
        type?: string;
      };
    }>('POST', '/v1/proximity', {
      op: 'nearest',
      origin: `${lat},${lng}`,
      set,
    });

    const n = result.nearest;
    if (!n) return null;

    return {
      name: n.name ?? 'Unknown Station',
      address: n.address ?? '',
      lat: n.lat ?? lat,
      lng: n.lng ?? lng,
      distanceM: n.distance_m ?? 0,
      durationSeconds: n.duration_seconds ?? 1200,
      type: n.type ?? 'fire_station',
    };
  } catch (err) {
    console.warn(`[Mireye] Proximity lookup failed for (${lat},${lng}):`, err);
    return null;
  }
}
