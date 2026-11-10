import { escapeHtml } from '../layout.js';
import { renderIcon } from './icon.js';
import { canAdd, canRemove, withRank, totalSpent, requiredLevel } from '../../dbLookups/talentRules.js';

// The four background tiles a talent tab's art extracts to (tools/dbc/artNames.js
// TALENT_PARTS, the extractor's twin of this list - kept as a local constant
// rather than an import so the server process never reaches into tools/, which
// is offline-only and pulls in the fs-based DBC reader).
const TALENT_PARTS = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'];

// Where the client's talent frame places a button: 35 px in, 63 px per
// column, ending at 256 (inside the 300 px background); 15 px down, 45 px
// per row, so the last of the game's seven rows sits at 285-317 (inside the
// 331 px background). Measured from the client's own textures: the real art
// in each tile set is 300x331, the rest power-of-two padding - TopRight's
// content is 44 px wide, BottomLeft/BottomRight's is 75 px tall, across
// MageArcane, WarriorArms and DruidBalance.
const COL_X = (c) => 35 + c * 63;
const ROW_Y = (r) => 15 + r * 45;
const BUTTON = 32;

function calcUrl(slug, build) {
  return build ? `/db/talents/${slug}?build=${build}` : `/db/talents/${slug}`;
}

function htmxLink(url) {
  return `href="${escapeHtml(url)}" hx-get="${escapeHtml(url)}" hx-target="#talent-calc" hx-swap="outerHTML" hx-push-url="true"`;
}

// Shared by every route that finds the reference schema missing, partial or
// outdated (I-2): the talent index, a class page (loadTalentClass returns
// undefined) and the hover card (fetchTalentRow returns undefined) all show
// the operator the same fix, rather than a 404 or a raw 500.
export const IMPORT_DBC_NOTE = '<p class="error">The talent trees come from the reference schema, which is not built. Run <code class="command">npm run import-dbc</code> to populate it.</p>';

export function renderTalentIndex(classes) {
  if (classes === null) {
    return `<h1>Talents</h1>\n${IMPORT_DBC_NOTE}`;
  }
  const items = classes.map((c) => `<li><a href="/db/talents/${escapeHtml(c.slug)}">${escapeHtml(c.name)}</a></li>`);
  return `<h1>Talents</h1>\n<ul>\n  ${items.join('\n  ')}\n</ul>`;
}

function arrow(from, to) {
  // A prerequisite sits above (same column) or beside (same row) its
  // dependent; one horizontal and one vertical segment cover both.
  const x1 = COL_X(from.column) + BUTTON / 2;
  const y1 = ROW_Y(from.row) + BUTTON / 2;
  const x2 = COL_X(to.column) + BUTTON / 2;
  const y2 = ROW_Y(to.row);
  const parts = [];
  if (x1 !== x2) parts.push(`<span class="talent-arrow h" style="left:${Math.min(x1, x2)}px;top:${y1}px;width:${Math.abs(x2 - x1)}px"></span>`);
  if (y2 > y1) parts.push(`<span class="talent-arrow v" style="left:${x2}px;top:${x1 !== x2 ? y1 : ROW_Y(from.row) + BUTTON}px;height:${y2 - (x1 !== x2 ? y1 : ROW_Y(from.row) + BUTTON)}px"></span>`);
  return parts.join('');
}

function renderTree({ data, state, total, artAvailable, marked }, tree, treeIndex) {
  const trees = data.trees;
  const byId = new Map(tree.talents.map((t) => [t.id, t]));
  // The four tiles sit in their own 300x331 layer (.talent-art) so only the
  // art is cropped to it (overflow:hidden there, not on .talent-grid) - the
  // grid itself stays overflow:visible so a hovered talent's card (appended
  // inside it) is never clipped at the tree's edge (Walk C).
  const bg = artAvailable && tree.background
    ? `<div class="talent-art">${TALENT_PARTS.map((p) => `<img class="talent-bg ${p}" src="/db/art/talents/${encodeURIComponent(tree.background.toLowerCase())}/${p}.png" alt="">`).join('')}</div>`
    : '';
  const arrows = tree.talents.filter((t) => t.prereq && byId.has(t.prereq.talentId)).map((t) => arrow(byId.get(t.prereq.talentId), t)).join('');
  const buttons = tree.talents.map((t) => {
    const rank = state.ranks.get(t.id) ?? 0;
    const add = canAdd(state, trees, treeIndex, t, total);
    const remove = canRemove(state, trees, treeIndex, t);
    const cls = ['talent', 'tooltip-host', rank >= t.ranks.length ? 'maxed' : add ? 'available' : rank > 0 ? 'partial' : 'locked', t.id === marked ? 'marked' : ''].filter(Boolean).join(' ');
    const icon = renderIcon(t.icon, t.name);
    const inner = add ? `<a ${htmxLink(calcUrl(data.slug, withRank(state, trees, t.id, +1)))}>${icon}</a>` : icon;
    const removeAttrs = remove
      ? ` hx-get="${escapeHtml(calcUrl(data.slug, withRank(state, trees, t.id, -1)))}" hx-trigger="contextmenu" hx-target="#talent-calc" hx-swap="outerHTML" hx-push-url="true" hx-on:contextmenu="event.preventDefault()"`
      : '';
    // The outer span is the tooltip host - one hx-get per element, so the
    // remove attributes move to an inner span around the add link. The
    // rank in the query is the state BEFORE this render's own click, so a
    // re-render after each click always refetches the card for the current rank.
    const tooltipAttrs = ` hx-get="${escapeHtml(`/db/tooltip/talent/${t.id}?rank=${rank}`)}" hx-trigger="mouseenter once" hx-target="this" hx-swap="beforeend"`;
    return `<span class="${cls}" style="left:${COL_X(t.column)}px;top:${ROW_Y(t.row)}px"${tooltipAttrs}><span class="talent-hit"${removeAttrs}>${inner}</span><span class="talent-rank">${rank}/${t.ranks.length}</span></span>`;
  }).join('\n');
  return `<section class="talent-tree">
  <h2>${escapeHtml(tree.name)} <span class="detail">${state.spent[treeIndex]}</span></h2>
  <div class="talent-grid">${bg}${arrows}
${buttons}
  </div>
</section>`;
}

export function renderTalentCalculator(ctx) {
  const { data, state, total, rate } = ctx;
  const spent = totalSpent(state);
  const level = requiredLevel(state, rate);
  return `<div id="talent-calc">
<p>${spent} point${spent === 1 ? '' : 's'} spent, ${total - spent} left${level ? ` · Requires level ${level}` : ''} · <a ${htmxLink(calcUrl(data.slug, ''))}>Reset</a></p>
<div class="talent-trees">
${data.trees.map((tree, i) => renderTree(ctx, tree, i)).join('\n')}
</div>
</div>`;
}

export function renderTalentPage(ctx) {
  return `<h1>${escapeHtml(ctx.data.name)} talents</h1>
<p><a href="/db/talents">back to talents</a></p>
${renderTalentCalculator(ctx)}`;
}
