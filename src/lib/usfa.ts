/**
 * USFA (U.S. Fire Administration) Registry Utilities
 *
 * Provides functions to work with USFA National Fire Department Registry data.
 * Station addresses are geocoded via Mireye /v1/geocode.
 * Results are cached in sessionStorage.
 */

import { geocodePlace } from '@/lib/mireyeClient';
import type { StationRecord } from '@/types';

const USFA_CACHE_KEY = 'usfa_stations_v1';

/** Reads geocoded station list from sessionStorage cache. */
function readStationCache(): StationRecord[] | null {
  try {
    const raw = sessionStorage.getItem(USFA_CACHE_KEY);
    return raw ? (JSON.parse(raw) as StationRecord[]) : null;
  } catch {
    return null;
  }
}

/** Writes geocoded station list to sessionStorage cache. */
function writeStationCache(stations: StationRecord[]): void {
  try {
    sessionStorage.setItem(USFA_CACHE_KEY, JSON.stringify(stations));
  } catch {
    // sessionStorage unavailable or quota exceeded
  }
}

/**
 * Geocodes a list of USFA station addresses via Mireye /v1/geocode.
 * Returns stations with lat/lng populated. Cached for the session.
 */
export async function geocodeStations(
  stations: Omit<StationRecord, 'lat' | 'lng'>[]
): Promise<StationRecord[]> {
  const cached = readStationCache();
  if (cached && cached.length > 0) {
    return cached;
  }

  const results: StationRecord[] = [];

  for (const station of stations) {
    try {
      const geo = await geocodePlace(`${station.address}, ${station.city}, ${station.state}`);
      results.push({
        ...station,
        lat: geo.lat,
        lng: geo.lng,
      });
    } catch (err) {
      console.warn(`[USFA] Failed to geocode station "${station.name}":`, err);
      // Skip stations that fail to geocode
    }
  }

  writeStationCache(results);
  return results;
}

/**
 * Finds the nearest station to a point from a pre-geocoded list.
 * Uses simple Euclidean distance (degrees) for fast client-side filtering.
 * For accurate drive-time, use Mireye /v1/proximity instead.
 */
export function findNearestStation(
  lat: number,
  lng: number,
  stations: StationRecord[]
): StationRecord | null {
  if (stations.length === 0) return null;

  let nearest = stations[0];
  let minDist = Infinity;

  for (const station of stations) {
    const dist = Math.sqrt(
      (station.lat - lat) ** 2 + (station.lng - lng) ** 2
    );
    if (dist < minDist) {
      minDist = dist;
      nearest = station;
    }
  }

  return nearest;
}

/**
 * Counts staffed stations within a radius (in degrees ~miles) of a point.
 * Used for RCS computation when Mireye proximity is unavailable.
 */
export function countStationsWithinRadius(
  lat: number,
  lng: number,
  stations: StationRecord[],
  radiusDeg: number = 0.22 // ~15 miles ≈ 0.22 degrees
): number {
  return stations.filter((s) => {
    const dist = Math.sqrt((s.lat - lat) ** 2 + (s.lng - lng) ** 2);
    return dist <= radiusDeg;
  }).length;
}
