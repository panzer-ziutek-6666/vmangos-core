import { escapeHtml } from '../layout.js';

// Draws a sortable, paged table and nothing else: it knows no table name, no
// SQL and no entity. Cycle 4 reuses it by passing a different column list.
// `cell` returns ready HTML - a column that shows a link or an icon builds it
// itself - so the renderer escapes labels but never a cell.
function renderHeader(columns, sort, dir, href) {
  return columns
    .map((c) => {
      const label = escapeHtml(c.label);
      if (!c.sortable) return `<th>${label}</th>`;
      const active = c.key === sort;
      // Clicking the active column inverts it; clicking any other starts
      // ascending, because "descending by name" is nobody's first guess.
      const nextDir = active && dir === 'asc' ? 'desc' : 'asc';
      const cls = active ? ` class="sorted-${dir}"` : '';
      return `<th${cls}><a href="${escapeHtml(href({ sort: c.key, dir: nextDir, page: 1 }))}">${label}</a></th>`;
    })
    .join('');
}

export function renderListview({ columns, rows, total, page, pageSize, sort, dir, href }) {
  if (rows.length === 0) {
    return `<div id="listview"><p class="detail">No matches.</p></div>`;
  }

  const body = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${c.cell(r)}</td>`).join('')}</tr>`)
    .join('\n      ');

  const first = (page - 1) * pageSize + 1;
  const last = first + rows.length - 1;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const prev = page > 1
    ? `<a rel="prev" href="${escapeHtml(href({ page: page - 1 }))}">previous</a>`
    : '<span class="detail">previous</span>';
  const next = page < lastPage
    ? `<a rel="next" href="${escapeHtml(href({ page: page + 1 }))}">next</a>`
    : '<span class="detail">next</span>';

  return `<div id="listview">
  <table class="listview">
    <thead><tr>${renderHeader(columns, sort, dir, href)}</tr></thead>
    <tbody>
      ${body}
    </tbody>
  </table>
  <div class="pager">
    ${prev}
    <span class="detail">${first}-${last} of ${total}</span>
    ${next}
  </div>
</div>`;
}
