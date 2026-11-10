import { escapeHtml } from '../layout.js';

// ItemDisplayInfo.dbc's inventory_icon is a bare texture name, but not always:
// some rows still carry the source extension (INV_Chest_Fur.tga). The
// extractor writes <name>.png, so the extension is stripped before the path is
// built - cycle 1 measured 2171 of 2219 distinct names as present on disk.
//
// The name also reaches this function straight from the reference import, so
// anything with a path separator or a dot-segment in it is refused rather than
// turned into a URL that walks out of the art root.
export function iconPath(inventoryIcon) {
  const name = String(inventoryIcon ?? '').trim();
  if (!name) return null;
  const base = name.replace(/\.(tga|blp|png)$/i, '');
  if (!/^[A-Za-z0-9_-]+$/.test(base)) return null;
  return `/db/art/icons/${base}.png`;
}

// A frame is always drawn, so a list of items with a missing icon stays a
// tidy column rather than a ragged one. An icon that is not on disk simply
// leaves the frame empty: the 404 is expected, not an error to report.
export function renderIcon(inventoryIcon, alt) {
  const path = iconPath(inventoryIcon);
  const img = path ? `<img src="${path}" alt="${escapeHtml(alt ?? '')}" loading="lazy">` : '';
  return `<span class="icon">${img}</span>`;
}
