import { escapeHtml } from '../layout.js';
import { entityLink, teamName, table } from './fields.js';

// A zone's world map is twelve 256x256 tiles, four across and three down, of
// which the client shows the top-left 1002x668 (the world map frame's size);
// world_map_area's loc_* rectangle spans exactly that visible region. So a
// dot's percentages are of the visible region, and the tile grid is drawn
// larger than its clipping frame by 1024/1002 and 768/668.
export function mapPosition(worldMap, x, y) {
  const left = ((worldMap.left - y) / (worldMap.left - worldMap.right)) * 100;
  const top = ((worldMap.top - x) / (worldMap.top - worldMap.bottom)) * 100;
  if (left < 0 || left > 100 || top < 0 || top > 100) return null;
  return { left, top };
}

function renderMap(data) {
  const { worldMap, dots, artAvailable } = data;
  if (!worldMap || !artAvailable) return '';
  const dir = encodeURIComponent(worldMap.name.toLowerCase());
  const tiles = Array.from({ length: 12 }, (_, i) => `<img src="/db/art/maps/${dir}/${i + 1}.png" alt="" loading="lazy">`).join('');
  const names = new Map([...data.npcs.map((n) => [`creature:${n.entry}`, n.name]), ...data.objects.map((o) => [`gameobject:${o.entry}`, o.name])]);
  const marks = dots.map((d) => {
    const at = mapPosition(worldMap, d.x, d.y);
    if (!at) return '';
    const title = names.get(`${d.kind}:${d.entry}`) || `#${d.entry}`;
    return `<a class="dot ${d.kind}" href="/db/${d.kind}/${escapeHtml(d.entry)}" title="${escapeHtml(title)}" style="left:${at.left.toFixed(2)}%;top:${at.top.toFixed(2)}%"></a>`;
  }).join('');
  return `<div class="zone-map"><div class="zone-map-tiles">${tiles}</div>${renderOverlays(data.overlays ?? [], dir)}${marks}</div>`;
}

// The client's WorldMapFrame draws an overlay as ceil(w/256) x ceil(h/256)
// textures laid row by row from its offset in the 1002x668 map; a full tile
// shows 256 px, the last column or row only the remaining pixels, of a file
// sized to the next power of two (at least 16) and cropped by texture
// coordinates. Here each tile is a box of the pixels shown, in percentages of
// the map so it scales with it, holding an image of the whole file, clipped.
const pct = (n, of) => ((n / of) * 100).toFixed(2);

function shownAndFile(total, index, count) {
  if (index < count - 1) return { shown: 256, file: 256 };
  const shown = total % 256 || 256;
  let file = 16;
  while (file < shown) file *= 2;
  return { shown, file };
}

function renderOverlays(overlays, dir) {
  return overlays.map((o) => {
    const cols = Math.ceil(o.width / 256);
    const rows = Math.ceil(o.height / 256);
    const tex = encodeURIComponent(o.texture.toLowerCase());
    const out = [];
    for (let r = 0; r < rows; r++) {
      const h = shownAndFile(o.height, r, rows);
      for (let c = 0; c < cols; c++) {
        const w = shownAndFile(o.width, c, cols);
        const n = r * cols + c + 1;
        out.push(`<span class="zone-overlay" style="left:${pct(o.x + c * 256, 1002)}%;top:${pct(o.y + r * 256, 668)}%;width:${pct(w.shown, 1002)}%;height:${pct(h.shown, 668)}%"><img src="/db/art/maps/${dir}/overlays/${tex}${n}.png" alt="" style="width:${pct(w.file, w.shown)}%;height:${pct(h.file, h.shown)}%"></span>`);
      }
    }
    return out.join('');
  }).join('');
}

function terrainNote({ terrain, terrainErrorCode, refused, worldMapOutdated }) {
  const notes = [];
  if (terrain === 'unconfigured') notes.push('<p class="error">NPCs and objects need the server\'s terrain files: set <code>terrain.mapsDir</code> in config.json to the server\'s extracted maps directory.</p>');
  if (terrain === 'missing') {
    const reason = terrainErrorCode ? ` (${escapeHtml(terrainErrorCode)})` : '';
    notes.push(`<p class="error">The configured maps directory (<code>terrain.mapsDir</code>) was not found${reason}, so NPCs and objects cannot be placed in zones.</p>`);
  }
  if (terrain === 'empty') notes.push('<p class="error">The configured maps directory (<code>terrain.mapsDir</code>) holds no <code>.map</code> files: it must name the extracted <code>maps</code> directory itself, not its parent.</p>');
  if (refused.length) notes.push(`<p class="error">These terrain files were not readable as the core's map format and were skipped: ${refused.map((f) => escapeHtml(f)).join(', ')}.</p>`);
  if (worldMapOutdated) notes.push('<p class="error">The reference schema is missing a column this page needs. Re-run <code class="command">npm run import-dbc</code> to rebuild it.</p>');
  return notes.join('\n');
}

export function renderZonePage(data) {
  const { area, zone, subAreas, npcs, objects, levelRange, quests, terrain } = data;
  const facts = [escapeHtml(teamName(area.team))];
  if (levelRange) facts.push(`Creatures level ${levelRange.min}–${levelRange.max}`);
  const parent = zone ? `<p>Part of ${entityLink({ kind: 'zone', entry: zone.id, name: zone.name })}</p>` : '';
  const subs = subAreas.length
    ? `<h2>Areas</h2>\n<p>${subAreas.map((s) => entityLink({ kind: 'zone', entry: s.id, name: s.name })).join(', ')}</p>`
    : '';
  const spawnLists = terrain === 'ok'
    ? `<h2>NPCs <span class="detail">(${npcs.length})</span></h2>
${table(['npc', 'level', 'spawns'], npcs.map((n) => `    <tr><td>${entityLink({ kind: 'creature', entry: n.entry, name: n.name })}</td><td>${n.levelMin === n.levelMax ? n.levelMin : `${n.levelMin}–${n.levelMax}`}</td><td>${n.count}</td></tr>`))}
<h2>Objects <span class="detail">(${objects.length})</span></h2>
${table(['object', 'spawns'], objects.map((o) => `    <tr><td>${entityLink({ kind: 'gameobject', entry: o.entry, name: o.name })}</td><td>${o.count}</td></tr>`))}`
    : '';

  return `<h1>${escapeHtml(area.name)}</h1>
<p class="detail">${facts.join(' · ')}</p>
${parent}
<p><a href="/db/zones">back to zones</a></p>
${renderMap(data)}
${terrainNote(data)}
${subs}
${spawnLists}
<h2>Quests <span class="detail">(${quests.length})</span></h2>
${table(['quest', 'level'], quests.map((q) => `    <tr><td>${entityLink({ kind: 'quest', entry: q.entry, name: q.title })}</td><td>${q.level}</td></tr>`))}`;
}
