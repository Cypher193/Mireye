import type { HexCell } from '@/types';

/**
 * Compiles severe hotspot cell polygons (CCG >= 0.70) into a standard OASIS CAP 1.2 XML alert feed.
 */
export function generateCAPAlertXML(cells: HexCell[], countyName: string): string {
  const severeHotspots = cells.filter((c) => c.ccg >= 0.7);
  const sentTime = new Date().toISOString();
  const identifier = `MIREYE-ALERT-${countyName.toUpperCase().replace(/\s+/g, '-')}-${Date.now()}`;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${identifier}</identifier>
  <sender>alerts@mireye.earth</sender>
  <sent>${sentTime}</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <category>Fire</category>
    <event>Wildfire Risk Warning</event>
    <urgency>Immediate</urgency>
    <severity>Severe</severity>
    <certainty>Observed</certainty>
    <audience>Emergency Managers, Public Safety personnel</audience>
    <eventCode>
      <valueName>SAME</valueName>
      <value>FRW</value>
    </eventCode>
    <headline>Severe Wildfire Coverage Gap Risk Detected in ${countyName}</headline>
    <description>Mireye sensor analytics have identified severe coverage gaps where ignition propensity intersects limited response capacity. Emergency suppression apparatus and community alert systems should prepare for immediate warning protocols.</description>
    <instruction>Monitor local sensor channels. Coordinate with dispatched wildfire response apparatus. Prepare evacuation routes for structural zones with delayed response capacity.</instruction>
    <contact>alerts-coord@mireye.earth</contact>
    <area>
      <areaDesc>Composite severe WUI hotspot perimeter within ${countyName}</areaDesc>
`;

  // Draw bounding boxes as polygons for each severe cell
  severeHotspots.forEach((cell) => {
    if (cell.lat === undefined || cell.lng === undefined) return;
    const sizeOffset = 0.007; // ~750m box offset matching GoogleMap geofences
    const p1 = `${(cell.lat + sizeOffset).toFixed(5)},${(cell.lng - sizeOffset).toFixed(5)}`;
    const p2 = `${(cell.lat + sizeOffset).toFixed(5)},${(cell.lng + sizeOffset).toFixed(5)}`;
    const p3 = `${(cell.lat - sizeOffset).toFixed(5)},${(cell.lng + sizeOffset).toFixed(5)}`;
    const p4 = `${(cell.lat - sizeOffset).toFixed(5)},${(cell.lng - sizeOffset).toFixed(5)}`;
    
    xml += `      <polygon>${p1} ${p2} ${p3} ${p4} ${p1}</polygon>\n`;
  });

  if (severeHotspots.length === 0) {
    xml += `      <!-- No active severe WUI hotspot coordinates detected in this county grid -->\n`;
  }

  xml += `    </area>
  </info>
</alert>`;

  return xml;
}
