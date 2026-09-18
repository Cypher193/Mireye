/**
 * Dynamic Locations & Regions Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides geographic coordinate anchors for national map rendering and
 * dynamic geocoding for any city, county, or coordinate pair.
 */

import type { County } from '@/types';
import { geocodePlace } from '@/lib/mireyeClient';

/**
 * Standard regional anchors for national map viewports
 */
export const DEFAULT_COUNTIES: County[] = [
  {
    id: 'boulder-co',
    name: 'Boulder County',
    state: 'CO',
    hexCount: 64,
    population: 330000,
    wuiHousingUnits: 48000,
    fireDistricts: 12,
    staffedStations: 18,
    cityName: 'Boulder',
    lat: 40.015,
    lng: -105.271,
    cx: 435,
    cy: 235,
  },
  {
    id: 'santa-barbara-ca',
    name: 'Santa Barbara County',
    state: 'CA',
    hexCount: 64,
    population: 448000,
    wuiHousingUnits: 72000,
    fireDistricts: 8,
    staffedStations: 16,
    cityName: 'Santa Barbara',
    lat: 34.42,
    lng: -119.698,
    cx: 105,
    cy: 285,
  },
  {
    id: 'flagstaff-az',
    name: 'Coconino County',
    state: 'AZ',
    hexCount: 64,
    population: 145000,
    wuiHousingUnits: 38000,
    fireDistricts: 6,
    staffedStations: 10,
    cityName: 'Flagstaff',
    lat: 35.198,
    lng: -111.651,
    cx: 260,
    cy: 315,
  },
  {
    id: 'travis-tx',
    name: 'Travis County',
    state: 'TX',
    hexCount: 64,
    population: 1290000,
    wuiHousingUnits: 95000,
    fireDistricts: 14,
    staffedStations: 45,
    cityName: 'Austin',
    lat: 30.267,
    lng: -97.743,
    cx: 510,
    cy: 420,
  },
  {
    id: 'missoula-mt',
    name: 'Missoula County',
    state: 'MT',
    hexCount: 64,
    population: 119000,
    wuiHousingUnits: 34000,
    fireDistricts: 7,
    staffedStations: 8,
    cityName: 'Missoula',
    lat: 46.872,
    lng: -113.994,
    cx: 295,
    cy: 110,
  },
];

export const COUNTIES = DEFAULT_COUNTIES;

/**
 * Dynamically resolves any city, address, or county query into a dynamic County object.
 */
export async function resolveLocation(query: string): Promise<County> {
  const geocoded = await geocodePlace(query);
  const id = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  return {
    id,
    name: query,
    state: 'US',
    hexCount: 64,
    population: 100000,
    wuiHousingUnits: 20000,
    fireDistricts: 4,
    staffedStations: 8,
    cityName: query,
    lat: geocoded.lat,
    lng: geocoded.lng,
  };
}
