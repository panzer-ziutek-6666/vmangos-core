import { escapeHtml } from '../layout.js';
import { teamName } from './fields.js';
import { CONTINENTS, MAP_TYPES } from '../../queries/db/zones.js';

// Built from fetchZoneRow's single joined row (server/queries/db/zones.js):
// team is already the zone's, not a sub-area's own (I1), and map_type is
// only set for an instance - the two continents keep their CONTINENTS name.
export function renderZoneTooltip(row) {
  const continent = CONTINENTS.get(Number(row.map_id));
  const where = continent ?? MAP_TYPES.get(Number(row.map_type)) ?? `Instance map ${Number(row.map_id)}`;
  const kind = Number(row.zone_id) ? 'Area' : 'Zone';
  return `<div class="tooltip">
  <div>${escapeHtml(row.name)}</div>
  <div class="detail">${escapeHtml(kind)} · ${escapeHtml(where)}</div>
  <div>${escapeHtml(teamName(row.team))}</div>
</div>`;
}
