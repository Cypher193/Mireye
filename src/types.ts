export interface HexCell {
  id: string;
  row: number;
  col: number;
  cx: number;
  cy: number;
  vertices: string;
  ips: number;
  rcs: number;
  ccg: number;
  fuelProxy: number;
  slope: number;
  wind: number;
  thermalInertia: number;
  driveTimeMin: number;
  staffedStations: number;
  housingUnits: number;
  wuiCluster: boolean;
  riskLabel: 'Low' | 'Moderate' | 'High' | 'Severe';
}

export interface County {
  id: string;
  name: string;
  state: string;
  hexCount: number;
  population: number;
  wuiHousingUnits: number;
  fireDistricts: number;
  staffedStations: number;
}

export interface ReasoningLine {
  text: string;
  type: 'command' | 'result' | 'info' | 'warn';
  delay: number;
}

export interface CapitalBriefResult {
  hexId: string;
  countyName: string;
  ccgScore: number;
  ips: number;
  rcs: number;
  housingUnits: number;
  driveTimeMin: number;
  paragraphs: string[];
}
