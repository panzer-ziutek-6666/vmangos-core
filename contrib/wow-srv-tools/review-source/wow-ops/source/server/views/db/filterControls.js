import { escapeHtml } from '../layout.js';

// The four controls every listview filter form is built from, plus the form
// wrapper itself. Was hand-written per page (server/views/db/itemList.js);
// hoisted here once a second and third listview (npcs, gameobjects) needed
// the same shapes.

export function textFilter({ name, label, value, placeholder }) {
  return `<label>${escapeHtml(label)}<input type="search" name="${escapeHtml(name)}" value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(placeholder ?? '')}"></label>`;
}

export function numberRangeFilter({ minName, maxName, label, min, max, applied }) {
  return `<label>min ${escapeHtml(label)}<input type="number" name="${escapeHtml(minName)}" min="${escapeHtml(min)}" max="${escapeHtml(max)}" value="${escapeHtml(applied[minName] ?? '')}"></label>
  <label>max ${escapeHtml(label)}<input type="number" name="${escapeHtml(maxName)}" min="${escapeHtml(min)}" max="${escapeHtml(max)}" value="${escapeHtml(applied[maxName] ?? '')}"></label>`;
}

function renderOption({ value: v, label: l }, value) {
  return `<option value="${escapeHtml(v)}"${String(value) === String(v) ? ' selected' : ''}>${escapeHtml(l)}</option>`;
}

export function selectFilter({ name, label, options, value, onchange }) {
  const rendered = options.map((o) => renderOption(o, value)).join('\n      ');
  const handler = onchange ? ` onchange="${escapeHtml(onchange)}"` : '';
  return `<label>${escapeHtml(label)}<select name="${escapeHtml(name)}"${handler}><option value="">any</option>
      ${rendered}
  </select></label>`;
}

// A select whose options fall into labelled groups (<optgroup>). A group with
// no options is left out rather than rendered as an empty heading.
export function groupedSelectFilter({ name, label, groups, value }) {
  const rendered = groups
    .filter((g) => g.options.length > 0)
    .map((g) => `<optgroup label="${escapeHtml(g.label)}">${g.options.map((o) => renderOption(o, value)).join('')}</optgroup>`)
    .join('\n      ');
  return `<label>${escapeHtml(label)}<select name="${escapeHtml(name)}"><option value="">any</option>
      ${rendered}
  </select></label>`;
}

// hx-swap="outerHTML": the fragment re-renders its own target wrapper, so the
// default innerHTML swap would nest a second copy inside the first on every
// submit - cycle 3 shipped that bug in itemList.js and had to fix it.
export function filterForm({ action, target, controls }) {
  return `<form method="get" action="${escapeHtml(action)}" hx-get="${escapeHtml(action)}" hx-target="${escapeHtml(target)}" hx-swap="outerHTML" hx-push-url="true">
  ${controls}
  <button type="submit">Filter</button>
</form>`;
}
