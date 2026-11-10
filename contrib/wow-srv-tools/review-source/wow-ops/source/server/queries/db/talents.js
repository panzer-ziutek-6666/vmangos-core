import { qualified, withMissingReference, withOutdatedReference } from './sql.js';
import { fetchSpellRows, fetchSpellLabels } from '../../dbLookups/spellLabels.js';

export function classSlug(name) {
  return String(name).toLowerCase().replace(/\s+/g, '');
}

// ChrClasses.dbc, imported as the reference schema's chr_classes: the nine
// class ids and names. The class mask on a talent tab is 1 << (id - 1)
// (vmangos-core/src/game/SharedDefines.h:89 CLASS_WARRIOR = 1, :96
// CLASS_MAGE = 8, and :105-108 CLASSMASK_ALL_PLAYABLE built from
// 1<<(CLASS_x-1)).
export async function listTalentClasses(pool, { dbcSchema }) {
  if (!dbcSchema) return null;
  const rows = await withMissingReference(null, async () => (await pool.query(
    `SELECT id, name FROM ${qualified(dbcSchema, 'chr_classes')} ORDER BY name`
  ))[0]);
  return rows ? rows.map((r) => ({ id: Number(r.id), name: r.name ?? '', slug: classSlug(r.name) })) : null;
}

const RANKS = [1, 2, 3, 4, 5];

// Returns undefined when the reference schema's read fails - missing
// entirely (ER_NO_SUCH_TABLE/ER_BAD_DB_ERROR), half-imported the same way, or
// built before this cycle's talent_tab columns (ER_BAD_FIELD_ERROR,
// withOutdatedReference) - so a caller can tell "no reference schema, run
// import-dbc" apart from null, "no class has that slug" (a genuine 404).
export async function loadTalentClass(pool, { schema, dbcSchema, slug, clientBuild }) {
  if (!dbcSchema) return undefined;
  // The class's tabs, in one statement; the client orders tabs by
  // m_orderIndex (tab_page) and breaks a tie by file row
  // (tools/dbc/layouts/TalentTab.js). No view draws a tree's own icon (only
  // each talent's), so the tab's spell_icon join was read and never used.
  const tabs = await withOutdatedReference(undefined, () => withMissingReference(undefined, async () => (await pool.query(
    `SELECT c.id AS class_id, c.name AS class_name, t.id, t.name, t.background, t.tab_page, t.dbc_row
     FROM ${qualified(dbcSchema, 'talent_tab')} t
     JOIN ${qualified(dbcSchema, 'chr_classes')} c ON t.class_mask = 1 << (c.id - 1)`
  ))[0]));
  if (tabs === undefined) return undefined;
  const own = tabs.filter((t) => classSlug(t.class_name) === slug)
    .sort((a, b) => Number(a.tab_page) - Number(b.tab_page) || Number(a.dbc_row) - Number(b.dbc_row));
  if (own.length === 0) return null;

  const tabIds = own.map((t) => Number(t.id));
  // A reference-schema import that ran only partway can leave talent_tab
  // populated with talent missing or dropped; guard this read the same way
  // as the tabs statement above, rather than letting ER_NO_SUCH_TABLE
  // escape as an unguarded 500 (sql.js's withMissingReference).
  const talentRows = await withOutdatedReference(undefined, () => withMissingReference(undefined, async () => (await pool.query(
    `SELECT id, tab_id, \`row\`, \`column\`, ${RANKS.map((r) => `rank_${r}`).join(', ')}, prereq_talent, prereq_rank, required_spell
     FROM ${qualified(dbcSchema, 'talent')} WHERE tab_id IN (${tabIds.map(() => '?').join(', ')})`,
    tabIds
  ))[0]));
  if (talentRows === undefined) return undefined;

  const firstRanks = talentRows.map((r) => Number(r.rank_1)).filter((id) => id > 0);
  const spellRows = await fetchSpellRows(pool, { schema, ids: firstRanks, clientBuild });
  const labels = await fetchSpellLabels(pool, { dbcSchema, spells: [...spellRows.values()] });

  const trees = own.map((tab) => ({
    id: Number(tab.id),
    name: tab.name ?? '',
    background: tab.background ?? '',
    talents: talentRows.filter((r) => Number(r.tab_id) === Number(tab.id))
      .map((r) => {
        const ranks = RANKS.map((n) => Number(r[`rank_${n}`])).filter((id) => id > 0);
        const first = ranks[0];
        return {
          id: Number(r.id), row: Number(r.row), column: Number(r.column), ranks,
          prereq: Number(r.prereq_talent) ? { talentId: Number(r.prereq_talent), rank: Number(r.prereq_rank) } : null,
          requiredSpell: Number(r.required_spell),
          name: spellRows.get(first)?.name ?? `talent #${Number(r.id)}`,
          icon: labels.iconName.get(first) ?? null
        };
      })
      .sort((a, b) => a.row - b.row || a.column - b.column)
  }));
  return { classId: Number(own[0].class_id), name: own[0].class_name ?? '', slug, trees };
}

// The talent row for the hover card, together with its tab's name (for
// "Requires N points in <tree>") and its prerequisite's own rank_1 spell id
// (for the prerequisite's name, I-3 - the card takes it from the same
// fetchSpellRows call the current/next rank already uses rather than a
// fourth statement) - one statement, still. Undefined distinguishes "the
// reference schema's read failed" (missing, partial or outdated) from null,
// "no talent with that id" - the tooltip route renders the import-dbc note
// for the former and 404s only for the latter.
export async function fetchTalentRow(pool, { dbcSchema, id }) {
  if (!dbcSchema) return undefined;
  const rows = await withOutdatedReference(undefined, () => withMissingReference(undefined, async () => (await pool.query(
    `SELECT t.*, b.name AS tab_name, p.rank_1 AS prereq_rank_1 FROM ${qualified(dbcSchema, 'talent')} t
     LEFT JOIN ${qualified(dbcSchema, 'talent_tab')} b ON b.id = t.tab_id
     LEFT JOIN ${qualified(dbcSchema, 'talent')} p ON p.id = t.prereq_talent
     WHERE t.id = ?`,
    [id]
  ))[0]));
  if (rows === undefined) return undefined;
  return rows?.find((r) => Number(r.id) === Number(id)) ?? null;
}
