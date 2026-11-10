import { quoteIdentifier } from './sql.js';
import { highestPatchClause } from './progressive.js';
import { QUEST_SORT_KEYS } from './questFilters.js';
import { categoryLabel, categoryGroup } from '../../dbLookups/questCategories.js';

// quest_template is keyed (entry, patch), 11 patch values on this realm, so
// the rows and the count both go through highestPatchClause: a count that
// skips it reports more pages than there are quests.
const REWARD_SLOTS = [
  ...[1, 2, 3, 4].flatMap((i) => [`t1.RewItemId${i}`, `t1.RewItemCount${i}`]),
  ...[1, 2, 3, 4, 5, 6].flatMap((i) => [`t1.RewChoiceItemId${i}`, `t1.RewChoiceItemCount${i}`])
];
const COLUMNS = [
  't1.entry', 't1.Title', 't1.QuestLevel', 't1.MinLevel', 't1.RequiredRaces',
  't1.ZoneOrSort', 't1.Type', 't1.RewXP', 't1.RewOrReqMoney', ...REWARD_SLOTS
];

function tables(schema) {
  return {
    quests: `${quoteIdentifier(schema)}.${quoteIdentifier('quest_template')}`,
    areas: `${quoteIdentifier(schema)}.${quoteIdentifier('area_template')}`
  };
}

// area_template lives in the world database and has no patch column, so the
// zone name is a plain LEFT JOIN: a negative ZoneOrSort (a quest sort) matches
// no row and the name is null. All 95 zones quests use resolve through it.
export async function listQuests(pool, { schema, filters, wowPatch }) {
  const { quests, areas } = tables(schema);
  const patchClause = highestPatchClause(schema, 'quest_template', 't1');
  // Conditions before the patch clause: params bind filters first, then wowPatch.
  const where = [...filters.conditions, patchClause].join(' AND ');
  const order = `${QUEST_SORT_KEYS[filters.sort]} ${filters.dir}`;
  const offset = (filters.page - 1) * filters.pageSize;

  const [rows] = await pool.query(
    `SELECT ${COLUMNS.join(', ')}, a.name AS zone_name
     FROM ${quests} t1 LEFT JOIN ${areas} a ON a.entry = t1.ZoneOrSort
     WHERE ${where}
     ORDER BY ${order}, t1.entry LIMIT ? OFFSET ?`,
    [...filters.params, wowPatch, filters.pageSize, offset]
  );
  const [counted] = await pool.query(
    `SELECT COUNT(*) AS total FROM ${quests} t1 WHERE ${where}`,
    [...filters.params, wowPatch]
  );
  return { rows, total: Number(counted[0]?.total ?? 0) };
}

// Every item a page of quests rewards, fixed or choice, once each - for one
// batched fetchItemSummaries call rather than one per row.
export function rewardItemIds(rows) {
  const ids = new Set();
  for (const r of rows) {
    for (let i = 1; i <= 4; i++) if (Number(r[`RewItemId${i}`])) ids.add(Number(r[`RewItemId${i}`]));
    for (let i = 1; i <= 6; i++) if (Number(r[`RewChoiceItemId${i}`])) ids.add(Number(r[`RewChoiceItemId${i}`]));
  }
  return [...ids];
}

// The categories quests actually use at this patch, for the category select.
// Read once per whole-page load, never for the htmx fragment.
export async function listQuestCategories(pool, { schema, wowPatch }) {
  const { quests, areas } = tables(schema);
  const [rows] = await pool.query(
    `SELECT DISTINCT t1.ZoneOrSort AS id, a.name AS zone_name, a.map_id
     FROM ${quests} t1 LEFT JOIN ${areas} a ON a.entry = t1.ZoneOrSort
     WHERE t1.ZoneOrSort <> 0 AND ${highestPatchClause(schema, 'quest_template', 't1')}`,
    [wowPatch]
  );
  return rows
    .map((r) => {
      const mapId = r.map_id === null || r.map_id === undefined ? null : Number(r.map_id);
      return { id: Number(r.id), label: categoryLabel(r.id, r.zone_name), group: categoryGroup(r.id, mapId) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
