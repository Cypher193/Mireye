import { COUNTIES } from './hexGrid';

export interface HistoricalFire {
  id: string;
  name: string;
  year: number;
  acres: number;
  boundary: { lat: number; lng: number }[];
}

/**
 * Historical fire boundary data corresponding to the 7 pilot counties.
 * Polygons are centered around each county's geocoded centroid.
 */
export const HISTORICAL_FIRES: Record<string, HistoricalFire> = {
  'boulder-co': {
    id: 'marshall-fire',
    name: 'Marshall Fire',
    year: 2021,
    acres: 6028,
    boundary: [
      { lat: 40.025, lng: -105.290 },
      { lat: 40.035, lng: -105.275 },
      { lat: 40.028, lng: -105.250 },
      { lat: 40.008, lng: -105.242 },
      { lat: 39.995, lng: -105.265 },
      { lat: 40.010, lng: -105.295 },
      { lat: 40.025, lng: -105.290 },
    ],
  },
  'flagstaff-az': {
    id: 'tunnel-fire',
    name: 'Tunnel Fire',
    year: 2022,
    acres: 19344,
    boundary: [
      { lat: 35.210, lng: -111.670 },
      { lat: 35.230, lng: -111.640 },
      { lat: 35.225, lng: -111.610 },
      { lat: 35.185, lng: -111.620 },
      { lat: 35.175, lng: -111.660 },
      { lat: 35.210, lng: -111.670 },
    ],
  },
  'santa-barbara-ca': {
    id: 'thomas-fire',
    name: 'Thomas Fire',
    year: 2017,
    acres: 281893,
    boundary: [
      { lat: 34.430, lng: -119.720 },
      { lat: 34.455, lng: -119.680 },
      { lat: 34.440, lng: -119.640 },
      { lat: 34.395, lng: -119.660 },
      { lat: 34.400, lng: -119.735 },
      { lat: 34.430, lng: -119.720 },
    ],
  },
  'bend-or': {
    id: 'two-bulls-fire',
    name: 'Two Bulls Fire',
    year: 2014,
    acres: 6900,
    boundary: [
      { lat: 44.070, lng: -121.340 },
      { lat: 44.090, lng: -121.300 },
      { lat: 44.080, lng: -121.280 },
      { lat: 44.040, lng: -121.295 },
      { lat: 44.045, lng: -121.350 },
      { lat: 44.070, lng: -121.340 },
    ],
  },
  'missoula-mt': {
    id: 'lolo-peak-fire',
    name: 'Lolo Peak Fire',
    year: 2017,
    acres: 53902,
    boundary: [
      { lat: 46.885, lng: -114.020 },
      { lat: 46.910, lng: -113.980 },
      { lat: 46.895, lng: -113.955 },
      { lat: 46.850, lng: -113.970 },
      { lat: 46.860, lng: -114.030 },
      { lat: 46.885, lng: -114.020 },
    ],
  },
  'kerr-tx': {
    id: 'kerr-county-complex',
    name: 'Kerr County Complex',
    year: 2020,
    acres: 1200,
    boundary: [
      { lat: 30.060, lng: -113.994 }, // Kerr County fallback values
      { lat: 30.075, lng: -99.115 },
      { lat: 30.055, lng: -99.090 },
      { lat: 30.025, lng: -99.120 },
      { lat: 30.035, lng: -99.165 },
      { lat: 30.060, lng: -99.155 },
    ],
  },
  'fannin-ga': {
    id: 'rough-ridge-fire',
    name: 'Rough Ridge Fire',
    year: 2016,
    acres: 27870,
    boundary: [
      { lat: 34.870, lng: -84.340 },
      { lat: 34.890, lng: -84.300 },
      { lat: 34.875, lng: -84.280 },
      { lat: 34.835, lng: -84.310 },
      { lat: 34.845, lng: -84.360 },
      { lat: 34.870, lng: -84.340 },
    ],
  },
};

/**
 * Retrieves the historical fire details for a county, generating values if missing.
 */
export function getHistoricalFire(countyId: string): HistoricalFire {
  const match = HISTORICAL_FIRES[countyId];
  if (match) return match;

  const county = COUNTIES.find((c) => c.id === countyId);
  const lat = county?.lat ?? 39.5;
  const lng = county?.lng ?? -98.35;

  return {
    id: 'generic-historical',
    name: 'County Fire Incident',
    year: 2023,
    acres: 4500,
    boundary: [
      { lat: lat + 0.015, lng: lng - 0.02 },
      { lat: lat + 0.025, lng: lng + 0.015 },
      { lat: lat - 0.015, lng: lng + 0.02 },
      { lat: lat - 0.02, lng: lng - 0.015 },
      { lat: lat + 0.015, lng: lng - 0.02 },
    ],
  };
}
