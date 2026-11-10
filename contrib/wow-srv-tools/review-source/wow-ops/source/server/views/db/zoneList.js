import { escapeHtml } from '../layout.js';
import { entityLink, teamName } from './fields.js';
import { MAP_TYPES } from '../../queries/db/zones.js';

export function renderZoneIndex({ continents, instances, referenceMissing }) {
  const parts = ['<h1>Zones</h1>'];
  if (referenceMissing) {
    parts.push('<p class="error">The zones with a world map come from the reference schema, which is not built. Run <code class="command">npm run import-dbc</code> to populate it.</p>');
  }
  for (const c of continents) {
    const items = c.zones.map((z) => `<li>${entityLink({ kind: 'zone', entry: z.id, name: z.name })} <span class="detail">${escapeHtml(teamName(z.team))}</span></li>`);
    parts.push(`<h2>${escapeHtml(c.name)}</h2>\n<ul>\n  ${items.join('\n  ')}\n</ul>`);
  }
  for (const [type, label] of MAP_TYPES) {
    const maps = instances.filter((i) => i.type === type);
    if (maps.length === 0) continue;
    const items = maps.map((i) => `<li>${escapeHtml(i.name)}: ${i.zones.map((z) => entityLink({ kind: 'zone', entry: z.id, name: z.name })).join(', ')}</li>`);
    parts.push(`<h2>${escapeHtml(label)}</h2>\n<ul>\n  ${items.join('\n  ')}\n</ul>`);
  }
  return parts.join('\n');
}
