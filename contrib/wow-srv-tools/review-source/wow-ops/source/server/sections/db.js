import { searchTemplates } from '../queries/db/search.js';
import { worldSchema } from '../queries/db/sql.js';
import { loadCreature } from '../queries/db/creature.js';
import { loadItem } from '../queries/db/item.js';
import { loadQuest } from '../queries/db/quest.js';
import { loadGameObject } from '../queries/db/gameobject.js';
import { loadSpell } from '../queries/db/spell.js';
import { fetchTemplateRow, fetchTemplateRowOnly, fetchBuildRowOnly } from '../queries/db/progressive.js';
import { parseItemFilters } from '../queries/db/itemFilters.js';
import { listItems } from '../queries/db/items.js';
import { listItemSets, loadItemSet } from '../queries/db/itemSets.js';
import { parseCreatureFilters } from '../queries/db/creatureFilters.js';
import { listCreatures } from '../queries/db/creatures.js';
import { parseGameObjectFilters } from '../queries/db/gameobjectFilters.js';
import { listGameObjects } from '../queries/db/gameobjects.js';
import { parseQuestFilters } from '../queries/db/questFilters.js';
import { listQuests, rewardItemIds, listQuestCategories } from '../queries/db/quests.js';
import { parseSpellFilters } from '../queries/db/spellFilters.js';
import { listSpells, fetchSpellSkills, listSkillLines, fetchSkillNames } from '../queries/db/spells.js';
import { loadSkill } from '../queries/db/skill.js';
import { listZones, fetchZoneRow } from '../queries/db/zones.js';
import { loadZone } from '../queries/db/zone.js';
import { listFactions, fetchFactionRow } from '../queries/db/factions.js';
import { loadFaction } from '../queries/db/faction.js';
import { listTalentClasses, loadTalentClass, fetchTalentRow } from '../queries/db/talents.js';
import { parseBuild, talentPoints } from '../dbLookups/talentRules.js';
import { fetchSpellRows, fetchSpellLabels } from '../dbLookups/spellLabels.js';
import { referencedSpellIds } from '../dbLookups/spellText.js';
import { fetchItemSummaries } from '../dbLookups/names.js';
import { fetchMapNames, fetchAreaNames } from '../dbLookups/maps.js';
import { escapeHtml } from '../views/layout.js';
import { renderBrowserPage } from '../views/db/shell.js';
import { renderSearchBody, renderSearchResults } from '../views/db/search.js';
import { renderItemListBody, renderItemListSwap } from '../views/db/itemList.js';
import { renderItemSetListBody, renderItemSetPage } from '../views/db/itemSet.js';
import { renderCreatureListBody, renderCreatureListFragment } from '../views/db/creatureList.js';
import { renderGameObjectListBody, renderGameObjectListFragment } from '../views/db/gameobjectList.js';
import { renderQuestListBody, renderQuestListFragment } from '../views/db/questList.js';
import { renderSpellListBody, renderSpellListFragment } from '../views/db/spellList.js';
import { renderSkillIndex, renderSkillPage } from '../views/db/skill.js';
import { renderZoneIndex } from '../views/db/zoneList.js';
import { renderZonePage } from '../views/db/zone.js';
import { renderFactionIndex, renderFactionPage } from '../views/db/faction.js';
import { renderTalentIndex, renderTalentCalculator, renderTalentPage, IMPORT_DBC_NOTE } from '../views/db/talents.js';
import { renderTalentTooltip } from '../views/db/talentTooltip.js';
import { renderItemTooltip } from '../views/db/tooltip.js';
import { renderCreatureTooltip } from '../views/db/creatureTooltip.js';
import { renderGameObjectTooltip } from '../views/db/gameobjectTooltip.js';
import { renderQuestTooltip } from '../views/db/questTooltip.js';
import { renderSpellTooltip, referencedContexts } from '../views/db/spellTooltip.js';
import { renderZoneTooltip } from '../views/db/zoneTooltip.js';
import { renderFactionTooltip } from '../views/db/factionTooltip.js';
import { renderCreaturePage } from '../views/db/creature.js';
import { renderItemPage } from '../views/db/item.js';
import { renderQuestPage } from '../views/db/quest.js';
import { renderGameObjectPage } from '../views/db/gameobject.js';
import { renderSpellPage } from '../views/db/spell.js';

// The entity pages themselves arrived across Tasks 9-12; this section only
// routes and validates for them so a bad link is a 400, never a 500. Task 9
// filled in 'creature', Task 10 'item', Task 11 'quest', Task 12 'gameobject'.
const ENTITY_TYPES = new Set(['creature', 'item', 'quest', 'gameobject', 'spell', 'zone', 'faction']);

// Loaders take (pools, config, id) and return null on a miss, exactly like
// loadCreature (server/queries/db/creature.js) - the shape Tasks 10-12
// mirror. Renderers take that loader's return value plus wowPatch, the one
// thing every entity page needs that the loader itself has no reason to
// carry (it is server configuration, not a fact about the row).
const ENTITY_LOADERS = new Map([
  ['creature', { load: loadCreature, render: renderCreaturePage }],
  ['item', { load: loadItem, render: renderItemPage }],
  ['quest', { load: loadQuest, render: renderQuestPage }],
  ['gameobject', { load: loadGameObject, render: renderGameObjectPage }],
  ['spell', { load: loadSpell, render: renderSpellPage }],
  ['zone', { load: loadZone, render: renderZonePage }],
  ['faction', { load: loadFaction, render: renderFactionPage }]
]);

// The entity types whose pages render on the browser's chrome: the shell nav
// entry each one marks active, its page title, and where its 404 leads back
// to. Every ENTITY_TYPES name has an entry here since cycle 5a, when quest
// (the last holdout on the operator layout) joined the other three.
const BROWSER_CHROME = new Map([
  ['item', { active: 'items', label: 'Item', back: '<a href="/db">back to search</a>' }],
  ['creature', { active: 'npcs', label: 'NPC', back: '<a href="/db/npcs">back to NPCs</a>' }],
  ['gameobject', { active: 'objects', label: 'Object', back: '<a href="/db/objects">back to objects</a>' }],
  ['quest', { active: 'quests', label: 'Quest', back: '<a href="/db/quests">back to quests</a>' }],
  ['spell', { active: 'spells', label: 'Spell', back: '<a href="/db/spells">back to spells</a>' }],
  ['zone', { active: 'zones', label: 'Zone', back: '<a href="/db/zones">back to zones</a>' }],
  ['faction', { active: 'factions', label: 'Faction', back: '<a href="/db/factions">back to factions</a>' }]
]);

// A cap on rows rendered per type, not a cap on what matched - searchTemplates
// still returns the true COUNT(*) alongside it. Kept modest because up to
// seven such queries run per search and this is a synchronous page render.
const RESULT_LIMIT = 50;

// A listview route answers htmx with the listview alone and anything else
// with the whole page. HX-Request is not enough to tell them apart: on a
// history-cache miss htmx 2.0.4 sends HX-Request: true *and*
// HX-History-Restore-Request: true (public/htmx.min.js, the historyCacheMiss
// request) and swaps the response into <body>, so a fragment there would
// replace the whole page with a bare table. Vary keeps a browser cache from
// serving one shape where the other was asked for, since both share a URL.
function wantsFragment(req, reply) {
  reply.header('Vary', 'HX-Request, HX-History-Restore-Request');
  return Boolean(req.headers['hx-request']) && !req.headers['hx-history-restore-request'];
}

export function registerDb(app) {
  const { pools, config } = app.deps;

  app.get('/db', async (req, reply) => {
    const schema = worldSchema(config);
    const worldConfigured = Boolean(pools?.world) && Boolean(schema);

    // The shell header's search form is a plain GET to /db?q=... (no htmx,
    // works from every page - server/views/db/shell.js). On /db itself that
    // lands here too, so the same searchTemplates call /db/search makes runs
    // server-side and the page renders its own results, rather than only
    // reacting to the htmx form further down the body.
    const q = typeof req.query?.q === 'string' ? req.query.q : '';
    const result = worldConfigured && q
      ? await searchTemplates(pools.world, {
          schema, query: q, wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild, limit: RESULT_LIMIT
        })
      : null;

    const body = renderSearchBody({ q, result, worldConfigured });
    reply.type('text/html').send(renderBrowserPage({
      title: 'Database',
      active: 'home',
      body,
      wowPatch: config.realm?.wowPatch,
      clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // Read-only: no SOAP command, no audit row, no #result element - this
  // section sends nothing to mangosd and changes nothing, unlike Events or
  // Accounts.
  app.get('/db/search', async (req, reply) => {
    const schema = worldSchema(config);
    if (!pools?.world || !schema) {
      reply.type('text/html').send('<p class="error">Database search is not available: the world database is not configured in config.json.</p>');
      return;
    }

    const q = typeof req.query?.q === 'string' ? req.query.q : '';
    const result = await searchTemplates(pools.world, {
      schema,
      query: q,
      wowPatch: config.realm?.wowPatch,
      clientBuild: config.realm?.clientBuild,
      limit: RESULT_LIMIT
    });
    reply.type('text/html').send(renderSearchResults(result));
  });

  // Registered before /db/:type/:id, or "items" is read as an entity type
  // that route does not know and returns a 400 for.
  app.get('/db/items', async (req, reply) => {
    const schema = worldSchema(config);
    if (!pools?.world || !schema) {
      reply.type('text/html').send(renderBrowserPage({
        title: 'Items', active: 'items', wowPatch: config.realm?.wowPatch,
        clientBuild: config.realm?.clientBuild, artAvailable: app.deps.artAvailable,
        body: '<p class="error">Items are not available: the world database is not configured in config.json.</p>'
      }));
      return;
    }

    const filters = parseItemFilters(req.query ?? {});
    const { rows, total } = await listItems(pools.world, {
      schema,
      dbcSchema: config.mysql?.dbcSchema ?? null,
      filters,
      wowPatch: config.realm?.wowPatch
    });

    // One route, two shapes: htmx asks for the listview (plus the subclass
    // control, out of band - itemList.js), a browser without it (or a reload
    // of a pushed URL) asks for the whole page.
    if (wantsFragment(req, reply)) {
      reply.type('text/html').send(renderItemListSwap({ rows, total, filters }));
      return;
    }

    reply.type('text/html').send(renderBrowserPage({
      title: 'Items', active: 'items', body: renderItemListBody({ rows, total, filters }),
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // Registered before /db/:type/:id, same reason as /db/items above: without
  // this, "tooltip" would be read as an entity type that route does not
  // know and returns a 400 for. Every item name in the listview hovers this
  // (hx-trigger="mouseenter once", itemList.js) - the response is a bare
  // fragment, never the page chrome every other route wraps a whole page in,
  // since nothing here swaps a whole page into a hover card.
  //
  // Reads the row directly rather than calling loadItem(): loadItem builds
  // the whole item page (~23 queries - two template reads, ten parallel
  // reverse-source reads across the loot/vendor/quest tables, then owner
  // lookups and name batches), but renderItemTooltip reads nothing except
  // the row itself. Hovering across a 50-row listview against loadItem would
  // be on the order of 1,150 queries against a pool with a connectionLimit
  // of 4 (server/db.js) - the same pool every other page shares (final
  // review, 2026-09-22).
  app.get('/db/tooltip/item/:id', async (req, reply) => {
    const { id } = req.params;
    // Same guard as /db/:type/:id below, for the same reason: Number()
    // would accept "1e3", hex and whitespace as a valid id.
    if (!/^\d+$/.test(id)) {
      reply.code(400).type('text/html').send(`<p class="error">"${escapeHtml(id)}" is not a valid id.</p>`);
      return;
    }

    const schema = worldSchema(config);
    const template = pools?.world && schema
      ? await fetchTemplateRow(pools.world, {
          schema, table: 'item_template', entry: Number(id), wowPatch: config.realm?.wowPatch
        })
      : null;
    if (!template) {
      reply.code(404).type('text/html').send(`<p class="error">No item with id ${escapeHtml(id)}.</p>`);
      return;
    }

    reply.type('text/html').send(renderItemTooltip(template.row));
  });

  // Registered before /db/:type/:id, same reason as /db/tooltip/item/:id
  // above: without this, "tooltip" would be read as an entity type that
  // route does not know. Every NPC name in the /db/npcs listview hovers this
  // (hx-trigger="mouseenter once", creatureList.js) - the response is a bare
  // fragment, never the page chrome.
  //
  // Reads the row directly rather than calling loadCreature(): loadCreature
  // fans out over loot, vendor, trainer and quest tables to build the whole
  // creature page, but renderCreatureTooltip reads nothing except the row
  // itself. Hovering a 50-row listview against loadCreature was the same
  // defect the item tooltip above was built to avoid (final review,
  // 2026-09-22) - the reason this route exists.
  app.get('/db/tooltip/creature/:id', async (req, reply) => {
    const { id } = req.params;
    // Same guard as /db/:type/:id below, for the same reason: Number()
    // would accept "1e3", hex and whitespace as a valid id.
    if (!/^\d+$/.test(id)) {
      reply.code(400).type('text/html').send(`<p class="error">"${escapeHtml(id)}" is not a valid id.</p>`);
      return;
    }

    const schema = worldSchema(config);
    const template = pools?.world && schema
      ? await fetchTemplateRow(pools.world, {
          schema, table: 'creature_template', entry: Number(id), wowPatch: config.realm?.wowPatch
        })
      : null;
    if (!template) {
      reply.code(404).type('text/html').send(`<p class="error">No creature with id ${escapeHtml(id)}.</p>`);
      return;
    }

    reply.type('text/html').send(renderCreatureTooltip(template.row));
  });

  // Registered before /db/:type/:id, same reason as /db/items and
  // /db/tooltip/item/:id above: without this, "itemsets" is read as an
  // entity type that route does not know and returns a 400 for.
  app.get('/db/itemsets', async (req, reply) => {
    const dbcSchema = config.mysql?.dbcSchema ?? null;
    const { rows, total } = pools?.world
      ? await listItemSets(pools.world, { dbcSchema })
      : { rows: [], total: 0 };

    reply.type('text/html').send(renderBrowserPage({
      title: 'Item sets', active: 'itemsets',
      body: renderItemSetListBody({ rows, total }),
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // Same id guard as /db/:type/:id below - an item set page linked from the
  // item page (Task 8) is exactly the same kind of numeric id.
  app.get('/db/itemset/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      reply.code(400).type('text/html').send(`<p class="error">"${escapeHtml(id)}" is not a valid id.</p>`);
      return;
    }

    const schema = worldSchema(config);
    const dbcSchema = config.mysql?.dbcSchema ?? null;
    const data = pools?.world && schema
      ? await loadItemSet(pools.world, { schema, dbcSchema, id: Number(id), wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild })
      : null;

    if (!data) {
      reply.code(404).type('text/html').send(renderBrowserPage({
        title: 'Database', active: 'itemsets',
        wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
        artAvailable: app.deps.artAvailable,
        body: `<h1>Not found</h1><p class="error">No item set with id ${escapeHtml(id)}.</p><p><a href="/db/itemsets">back to item sets</a></p>`
      }));
      return;
    }

    reply.type('text/html').send(renderBrowserPage({
      title: `Item set ${id}`, active: 'itemsets',
      body: renderItemSetPage(data),
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // Two path segments, so /db/:type/:id (three) can never claim it; kept
  // beside the other listview routes rather than for ordering.
  app.get('/db/npcs', async (req, reply) => {
    const schema = worldSchema(config);
    if (!pools?.world || !schema) {
      reply.type('text/html').send(renderBrowserPage({
        title: 'NPCs', active: 'npcs', wowPatch: config.realm?.wowPatch,
        clientBuild: config.realm?.clientBuild, artAvailable: app.deps.artAvailable,
        body: '<p class="error">NPCs are not available: the world database is not configured in config.json.</p>'
      }));
      return;
    }

    const filters = parseCreatureFilters(req.query ?? {});
    const { rows, total } = await listCreatures(pools.world, {
      schema,
      dbcSchema: config.mysql?.dbcSchema ?? null,
      filters,
      wowPatch: config.realm?.wowPatch
    });

    // Map names are a second lookup, not a join in listCreatures itself: a
    // row's map_id comes from the spawn tables and can be null (decision 3 -
    // an unspawned template), so this only ever asks for the ids the page's
    // own rows actually carry.
    const mapIds = rows.map((r) => r.map_id).filter((id) => id !== null && id !== undefined);
    const mapNames = await fetchMapNames(pools.world, { schema, mapIds, wowPatch: config.realm?.wowPatch });

    // One route, two shapes: htmx asks for the listview alone, a browser
    // without it (or a reload of a pushed URL) asks for the whole page.
    if (wantsFragment(req, reply)) {
      reply.type('text/html').send(renderCreatureListFragment({ rows, total, filters, mapNames }));
      return;
    }

    reply.type('text/html').send(renderBrowserPage({
      title: 'NPCs', active: 'npcs', body: renderCreatureListBody({ rows, total, filters, mapNames }),
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // Two path segments, so /db/:type/:id (three) can never claim it; kept
  // beside the other listview routes rather than for ordering.
  app.get('/db/objects', async (req, reply) => {
    const schema = worldSchema(config);
    if (!pools?.world || !schema) {
      reply.type('text/html').send(renderBrowserPage({
        title: 'Objects', active: 'objects', wowPatch: config.realm?.wowPatch,
        clientBuild: config.realm?.clientBuild, artAvailable: app.deps.artAvailable,
        body: '<p class="error">Objects are not available: the world database is not configured in config.json.</p>'
      }));
      return;
    }

    const filters = parseGameObjectFilters(req.query ?? {});
    const { rows, total } = await listGameObjects(pools.world, {
      schema,
      dbcSchema: config.mysql?.dbcSchema ?? null,
      filters,
      wowPatch: config.realm?.wowPatch
    });

    // Map names are a second lookup, not a join in listGameObjects itself,
    // exactly as /db/npcs resolves creature map names (decision 1): a row's
    // map_id comes from the spawn table and can be null (an unspawned
    // template), so this only ever asks for the ids the page's own rows
    // actually carry.
    const mapIds = rows.map((r) => r.map_id).filter((id) => id !== null && id !== undefined);
    const mapNames = await fetchMapNames(pools.world, { schema, mapIds, wowPatch: config.realm?.wowPatch });

    // One route, two shapes: htmx asks for the listview alone, a browser
    // without it (or a reload of a pushed URL) asks for the whole page.
    if (wantsFragment(req, reply)) {
      reply.type('text/html').send(renderGameObjectListFragment({ rows, total, filters, mapNames }));
      return;
    }

    reply.type('text/html').send(renderBrowserPage({
      title: 'Objects', active: 'objects', body: renderGameObjectListBody({ rows, total, filters, mapNames }),
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // Two path segments, so /db/:type/:id (three) can never claim it.
  app.get('/db/quests', async (req, reply) => {
    const schema = worldSchema(config);
    if (!pools?.world || !schema) {
      reply.type('text/html').send(renderBrowserPage({
        title: 'Quests', active: 'quests', wowPatch: config.realm?.wowPatch,
        clientBuild: config.realm?.clientBuild, artAvailable: app.deps.artAvailable,
        body: '<p class="error">Quests are not available: the world database is not configured in config.json.</p>'
      }));
      return;
    }

    const wowPatch = config.realm?.wowPatch;
    const filters = parseQuestFilters(req.query ?? {});
    const { rows, total } = await listQuests(pools.world, { schema, filters, wowPatch });
    // One batched lookup for every reward item on the page: name, quality and
    // icon (the icon from the reference schema, dropped if it is missing).
    const items = await fetchItemSummaries(pools.world, {
      schema, dbcSchema: config.mysql?.dbcSchema ?? null, ids: rewardItemIds(rows), wowPatch
    });

    if (wantsFragment(req, reply)) {
      reply.type('text/html').send(renderQuestListFragment({ rows, total, filters, items }));
      return;
    }

    // The category select sits outside the swapped listview, so its options
    // are read only for a whole page.
    const categories = await listQuestCategories(pools.world, { schema, wowPatch });
    reply.type('text/html').send(renderBrowserPage({
      title: 'Quests', active: 'quests', body: renderQuestListBody({ rows, total, filters, items, categories }),
      wowPatch, clientBuild: config.realm?.clientBuild, artAvailable: app.deps.artAvailable
    }));
  });

  // Two path segments, so /db/:type/:id (three) can never claim it.
  app.get('/db/spells', async (req, reply) => {
    const schema = worldSchema(config);
    if (!pools?.world || !schema) {
      reply.type('text/html').send(renderBrowserPage({
        title: 'Spells', active: 'spells', wowPatch: config.realm?.wowPatch,
        clientBuild: config.realm?.clientBuild, artAvailable: app.deps.artAvailable,
        body: '<p class="error">Spells are not available: the world database is not configured in config.json.</p>'
      }));
      return;
    }
    const clientBuild = config.realm?.clientBuild;
    const dbcSchema = config.mysql?.dbcSchema ?? null;
    const filters = parseSpellFilters(req.query ?? {}, { schema, clientBuild });
    const { rows, total } = await listSpells(pools.world, { schema, filters, clientBuild });
    const ids = rows.map((r) => Number(r.entry));
    const [labels, skills] = await Promise.all([
      fetchSpellLabels(pools.world, { dbcSchema, spells: rows }),
      fetchSpellSkills(pools.world, { schema, spellIds: ids, clientBuild })
    ]);
    const skillNames = await fetchSkillNames(pools.world, { dbcSchema, ids: [...skills.values()] });

    if (wantsFragment(req, reply)) {
      reply.type('text/html').send(renderSpellListFragment({ rows, total, filters, labels, skills, skillNames }));
      return;
    }
    // The skill select sits outside the swapped listview, so its options are
    // read only for a whole page.
    const skillLines = await listSkillLines(pools.world, { dbcSchema });
    reply.type('text/html').send(renderBrowserPage({
      title: 'Spells', active: 'spells', body: renderSpellListBody({ rows, total, filters, labels, skills, skillNames, skillLines }),
      wowPatch: config.realm?.wowPatch, clientBuild, artAvailable: app.deps.artAvailable
    }));
  });

  // Two path segments, so /db/:type/:id (three) can never claim it.
  app.get('/db/skills', async (req, reply) => {
    const dbcSchema = config.mysql?.dbcSchema ?? null;
    const skillLines = pools?.world ? await listSkillLines(pools.world, { dbcSchema }) : [];
    reply.type('text/html').send(renderBrowserPage({
      title: 'Skills', active: 'skills', body: renderSkillIndex(skillLines),
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // Two path segments, so /db/:type/:id (three) can never claim it.
  app.get('/db/zones', async (req, reply) => {
    const schema = worldSchema(config);
    if (!pools?.world || !schema) {
      reply.type('text/html').send(renderBrowserPage({
        title: 'Zones', active: 'zones', wowPatch: config.realm?.wowPatch,
        clientBuild: config.realm?.clientBuild, artAvailable: app.deps.artAvailable,
        body: '<p class="error">Zones are not available: the world database is not configured in config.json.</p>'
      }));
      return;
    }

    const data = await listZones(pools.world, { schema, dbcSchema: config.mysql?.dbcSchema ?? null, wowPatch: config.realm?.wowPatch });
    reply.type('text/html').send(renderBrowserPage({
      title: 'Zones', active: 'zones', body: renderZoneIndex(data),
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // Two path segments, so /db/:type/:id (three) can never claim it.
  app.get('/db/factions', async (req, reply) => {
    const schema = worldSchema(config);
    if (!pools?.world || !schema) {
      reply.type('text/html').send(renderBrowserPage({
        title: 'Factions', active: 'factions', wowPatch: config.realm?.wowPatch,
        clientBuild: config.realm?.clientBuild, artAvailable: app.deps.artAvailable,
        body: '<p class="error">Factions are not available: the world database is not configured in config.json.</p>'
      }));
      return;
    }

    const data = await listFactions(pools.world, { schema, clientBuild: config.realm?.clientBuild });
    reply.type('text/html').send(renderBrowserPage({
      title: 'Factions', active: 'factions', body: renderFactionIndex(data),
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // A static 'skill' path segment, registered before /db/:type/:id - though
  // find-my-way prefers a static segment over a parametric one at the same
  // depth regardless of registration order, so this ordering documents the
  // intent rather than being load-bearing.
  app.get('/db/skill/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      reply.code(400).type('text/html').send(`<p class="error">"${escapeHtml(id)}" is not a valid id.</p>`);
      return;
    }

    const schema = worldSchema(config);
    const dbcSchema = config.mysql?.dbcSchema ?? null;
    const data = pools?.world && schema
      ? await loadSkill(pools.world, { schema, dbcSchema, id: Number(id), clientBuild: config.realm?.clientBuild })
      : null;

    if (!data) {
      reply.code(404).type('text/html').send(renderBrowserPage({
        title: 'Database', active: 'skills',
        wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
        artAvailable: app.deps.artAvailable,
        body: `<h1>Not found</h1><p class="error">No skill with id ${escapeHtml(id)}.</p><p><a href="/db/skills">back to skills</a></p>`
      }));
      return;
    }

    reply.type('text/html').send(renderBrowserPage({
      title: `Skill ${id}`, active: 'skills', body: renderSkillPage(data),
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // Registered before /db/:type/:id, same reason as /db/tooltip/creature/:id
  // above: without this, "tooltip" would be read as an entity type that
  // route does not know. Every gameobject name in the /db/objects listview
  // hovers this (hx-trigger="mouseenter once", gameobjectList.js) - the
  // response is a bare fragment, never the page chrome.
  //
  // Reads the row directly rather than calling loadGameObject(): loadGameObject
  // fans out over gameobject_loot_template, gameobject_questrelation and
  // gameobject_involvedrelation to build the whole gameobject page, but
  // renderGameObjectTooltip reads nothing except the row itself - the same
  // defect the creature tooltip above was built to avoid, applied to
  // gameobjects (controller decision 3).
  app.get('/db/tooltip/gameobject/:id', async (req, reply) => {
    const { id } = req.params;
    // Same guard as /db/:type/:id below, for the same reason: Number()
    // would accept "1e3", hex and whitespace as a valid id.
    if (!/^\d+$/.test(id)) {
      reply.code(400).type('text/html').send(`<p class="error">"${escapeHtml(id)}" is not a valid id.</p>`);
      return;
    }

    const schema = worldSchema(config);
    const template = pools?.world && schema
      ? await fetchTemplateRow(pools.world, {
          schema, table: 'gameobject_template', entry: Number(id), wowPatch: config.realm?.wowPatch
        })
      : null;
    if (!template) {
      reply.code(404).type('text/html').send(`<p class="error">No gameobject with id ${escapeHtml(id)}.</p>`);
      return;
    }

    reply.type('text/html').send(renderGameObjectTooltip(template.row));
  });

  // Registered before /db/:type/:id, same reason as the other tooltip routes
  // above. Every quest link on the creature, gameobject and item pages (and
  // the quest listview itself) hovers this through entityLink.
  //
  // Reads the row alone (fetchTemplateRowOnly, not fetchTemplateRow - the
  // patch-variant read that helper also does would already spend the two-
  // query budget before the zone name is asked for) and, only when
  // ZoneOrSort names a zone rather than a QuestSort, that zone's name. Never
  // loadQuest, which fans out over the relation, loot and item tables the
  // full quest page needs and a hover never does (the same defect the
  // creature and gameobject tooltips above were built to avoid).
  app.get('/db/tooltip/quest/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      reply.code(400).type('text/html').send(`<p class="error">"${escapeHtml(id)}" is not a valid id.</p>`);
      return;
    }

    const schema = worldSchema(config);
    const row = pools?.world && schema
      ? await fetchTemplateRowOnly(pools.world, {
          schema, table: 'quest_template', entry: Number(id), wowPatch: config.realm?.wowPatch
        })
      : null;
    if (!row) {
      reply.code(404).type('text/html').send(`<p class="error">No quest with id ${escapeHtml(id)}.</p>`);
      return;
    }

    const zone = Number(row.ZoneOrSort);
    const zoneName = zone > 0
      ? (await fetchAreaNames(pools.world, { schema, areaIds: [zone] })).get(zone) ?? null
      : null;
    reply.type('text/html').send(renderQuestTooltip(row, zoneName));
  });

  // Registered before /db/:type/:id, same reason as the other tooltip routes
  // above. Every spell link on the spell listview and (once its description
  // references another spell) the spell page itself hovers this.
  //
  // The spell hover card: the row, then one batched read of its labels (and
  // of any spell its description references, which adds one statement).
  // Never loadSpell, which reads trainers, items and skills a hover never
  // shows.
  app.get('/db/tooltip/spell/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      reply.code(400).type('text/html').send(`<p class="error">"${escapeHtml(id)}" is not a valid id.</p>`);
      return;
    }

    const schema = worldSchema(config);
    const clientBuild = config.realm?.clientBuild;
    const row = pools?.world && schema
      ? await fetchBuildRowOnly(pools.world, { schema, table: 'spell_template', entry: Number(id), clientBuild })
      : null;
    if (!row) {
      reply.code(404).type('text/html').send(`<p class="error">No spell with id ${escapeHtml(id)}.</p>`);
      return;
    }

    const refIds = referencedSpellIds(row.description);
    const refRows = refIds.length ? await fetchSpellRows(pools.world, { schema, ids: refIds, clientBuild }) : new Map();
    const labels = await fetchSpellLabels(pools.world, { dbcSchema: config.mysql?.dbcSchema ?? null, spells: [row, ...refRows.values()] });
    reply.type('text/html').send(renderSpellTooltip({ row, labels, referenced: referencedContexts(refRows, labels) }));
  });

  // Registered before /db/:type/:id, same reason as the other tooltip routes
  // above. Every zone link on the quest page's category row hovers this.
  //
  // fetchZoneRow (server/queries/db/zones.js) is the plain `WHERE entry = ?`
  // loadZone itself reads its own row with - one query total, never loadZone,
  // which fans out over every area_template row, the reference schema and
  // the terrain files a hover never needs.
  app.get('/db/tooltip/zone/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      reply.code(400).type('text/html').send(`<p class="error">"${escapeHtml(id)}" is not a valid id.</p>`);
      return;
    }

    const schema = worldSchema(config);
    const row = pools?.world && schema
      ? await fetchZoneRow(pools.world, { schema, id: Number(id), wowPatch: config.realm?.wowPatch })
      : null;
    if (!row) {
      reply.code(404).type('text/html').send(`<p class="error">No zone with id ${escapeHtml(id)}.</p>`);
      return;
    }

    reply.type('text/html').send(renderZoneTooltip(row));
  });

  // Registered before /db/:type/:id, same reason as the other tooltip routes
  // above. Every faction link on the creature page's faction row and the
  // quest page's reputation rewards hovers this.
  //
  // fetchFactionRow (server/queries/db/factions.js) is the same
  // highestBuildClause loadFaction itself uses, keyed on `id` rather than
  // `entry`. One query total, never loadFaction, which fans out over
  // faction_template, creature_template, the on-kill and quest reputation
  // tables and item_template a hover never needs.
  app.get('/db/tooltip/faction/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      reply.code(400).type('text/html').send(`<p class="error">"${escapeHtml(id)}" is not a valid id.</p>`);
      return;
    }

    const schema = worldSchema(config);
    const row = pools?.world && schema
      ? await fetchFactionRow(pools.world, { schema, id: Number(id), clientBuild: config.realm?.clientBuild })
      : null;
    if (!row) {
      reply.code(404).type('text/html').send(`<p class="error">No faction with id ${escapeHtml(id)}.</p>`);
      return;
    }

    reply.type('text/html').send(renderFactionTooltip(row));
  });

  // Two path segments, so /db/:type/:id (three) can never claim it.
  app.get('/db/talents', async (req, reply) => {
    const schema = worldSchema(config);
    if (!pools?.world || !schema) {
      reply.type('text/html').send(renderBrowserPage({
        title: 'Talents', active: 'talents', wowPatch: config.realm?.wowPatch,
        clientBuild: config.realm?.clientBuild, artAvailable: app.deps.artAvailable,
        body: '<p class="error">Talents are not available: the world database is not configured in config.json.</p>'
      }));
      return;
    }
    const classes = await listTalentClasses(pools.world, { dbcSchema: config.mysql?.dbcSchema ?? null });
    reply.type('text/html').send(renderBrowserPage({
      title: 'Talents', active: 'talents', body: renderTalentIndex(classes),
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // The calculator: the build lives in ?build= and never reaches SQL -
  // parseBuild reduces it to ranks through the core's rules. htmx clicks get
  // the #talent-calc fragment; a history restore or a plain load gets the page.
  app.get('/db/talents/:class', async (req, reply) => {
    const schema = worldSchema(config);
    if (!pools?.world || !schema) {
      reply.type('text/html').send(renderBrowserPage({
        title: 'Talents', active: 'talents', wowPatch: config.realm?.wowPatch,
        clientBuild: config.realm?.clientBuild, artAvailable: app.deps.artAvailable,
        body: '<p class="error">Talents are not available: the world database is not configured in config.json.</p>'
      }));
      return;
    }
    const data = await loadTalentClass(pools.world, { schema, dbcSchema: config.mysql?.dbcSchema ?? null, slug: String(req.params.class), clientBuild: config.realm?.clientBuild });
    // undefined: the reference schema's read failed - missing, partial or
    // outdated (I-1/I-2) - so the fix is the same one /db/talents itself
    // shows, at 200, never a 404. null: a genuine unknown class slug.
    if (data === undefined) {
      reply.type('text/html').send(renderBrowserPage({
        title: 'Talents', active: 'talents',
        wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
        artAvailable: app.deps.artAvailable,
        body: renderTalentIndex(null)
      }));
      return;
    }
    if (!data) {
      reply.code(404).type('text/html').send(renderBrowserPage({
        title: 'Database', active: 'talents',
        wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
        artAvailable: app.deps.artAvailable,
        body: `<h1>Not found</h1><p class="error">No talent trees for "${escapeHtml(req.params.class)}".</p><p><a href="/db/talents">back to talents</a></p>`
      }));
      return;
    }
    const rate = config.realm?.talentRate ?? 1;
    const total = talentPoints(60, rate);
    const state = parseBuild(typeof req.query?.build === 'string' ? req.query.build : '', data.trees, total);
    const marked = /^\d+$/.test(String(req.query?.talent ?? '')) ? Number(req.query.talent) : null;
    const ctx = { data, state, total, artAvailable: app.deps.artAvailable, marked, rate };
    if (wantsFragment(req, reply)) {
      reply.type('text/html').send(renderTalentCalculator(ctx));
      return;
    }
    reply.type('text/html').send(renderBrowserPage({
      title: `${data.name} talents`, active: 'talents', body: renderTalentPage(ctx),
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });

  // The talent hover card, three statements at most: the talent row with its
  // tree's name, the current and next rank's spell rows in one fetchSpellRows,
  // and their labels. Cross-spell tokens ($12345s1) are left as written rather
  // than spending a fourth statement. Never a page loader.
  app.get('/db/tooltip/talent/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      reply.code(400).type('text/html').send(`<p class="error">"${escapeHtml(id)}" is not a valid id.</p>`);
      return;
    }
    const dbcSchema = config.mysql?.dbcSchema ?? null;
    const schema = worldSchema(config);
    const row = pools?.world && schema ? await fetchTalentRow(pools.world, { dbcSchema, id: Number(id) }) : null;
    // undefined: the reference schema's read failed (I-1/I-2) - the note,
    // not a 404 or a 500. null: no talent with this id - genuinely not found.
    if (row === undefined) {
      reply.type('text/html').send(IMPORT_DBC_NOTE);
      return;
    }
    if (!row) {
      reply.code(404).type('text/html').send(`<p class="error">No talent with id ${escapeHtml(id)}.</p>`);
      return;
    }
    const ranks = [1, 2, 3, 4, 5].map((n) => Number(row[`rank_${n}`])).filter((s) => s > 0);
    const rank = Math.min(Math.max(Number.parseInt(String(req.query?.rank ?? '0'), 10) || 0, 0), ranks.length);
    // Widened to the prerequisite's rank_1 spell (for its name) and the
    // required spell (I-3) - one fetchSpellRows call still, not a fourth
    // statement; fetchTalentRow's own join found both ids already.
    const requiredSpellId = Number(row.required_spell) || 0;
    const prereqSpellId = Number(row.prereq_rank_1) || 0;
    const wanted = [...new Set([ranks[rank - 1], ranks[rank], requiredSpellId, prereqSpellId].filter(Boolean))];
    const clientBuild = config.realm?.clientBuild;
    const rows = await fetchSpellRows(pools.world, { schema, ids: wanted, clientBuild });
    const labels = await fetchSpellLabels(pools.world, { dbcSchema, spells: [...rows.values()] });
    const talent = {
      id: Number(row.id), row: Number(row.row), ranks,
      prereq: Number(row.prereq_talent) ? { talentId: Number(row.prereq_talent), rank: Number(row.prereq_rank) } : null
    };
    const requiredSpellRow = requiredSpellId ? rows.get(requiredSpellId) : null;
    reply.type('text/html').send(renderTalentTooltip({
      talent, rank, current: rows.get(ranks[rank - 1]) ?? null, next: rows.get(ranks[rank]) ?? null,
      labels, referenced: new Map(),
      requiredSpell: requiredSpellRow ? { id: requiredSpellId, name: requiredSpellRow.name } : null,
      treeName: row.tab_name ?? '',
      prereqName: prereqSpellId ? rows.get(prereqSpellId)?.name ?? null : null
    }));
  });

  app.get('/db/:type/:id', async (req, reply) => {
    const { type, id } = req.params;
    if (!ENTITY_TYPES.has(type)) {
      reply.code(400).type('text/html').send(`<p class="error">Unknown entity type "${escapeHtml(type)}".</p>`);
      return;
    }
    // Number.isInteger(Number(id)) is too loose: Number() also accepts
    // exponential notation ("1e3"), hex ("0x10"), a leading sign ("-5") and
    // surrounding whitespace (" 12"), so `/db/creature/1e3` would silently
    // render creature 1000. An entry id is a plain non-negative integer with
    // nothing else in the string.
    if (!/^\d+$/.test(id)) {
      reply.code(400).type('text/html').send(`<p class="error">"${escapeHtml(id)}" is not a valid id.</p>`);
      return;
    }

    const entity = ENTITY_LOADERS.get(type);
    if (!entity) {
      // Unreachable today - every name in ENTITY_TYPES now has a loader - but
      // kept as the guard for a future entity type added to ENTITY_TYPES
      // before its loader lands, the same two-step Tasks 9-12 each went
      // through.
      reply.code(400).type('text/html').send('<p class="error">This entity page is not implemented yet.</p>');
      return;
    }

    // Every entity page renders inside the browser's own chrome
    // (renderBrowserPage) and never touches SOAP - no /db route reads status
    // or calls SOAP.
    const chrome = BROWSER_CHROME.get(type);
    if (!chrome) {
      // Unreachable while every ENTITY_TYPES name has a chrome entry; kept as
      // the guard for a type added to ENTITY_TYPES before its page is built.
      reply.code(400).type('text/html').send('<p class="error">This entity page is not implemented yet.</p>');
      return;
    }

    const data = await entity.load(pools, config, Number(id));
    if (!data) {
      reply.code(404).type('text/html').send(renderBrowserPage({
        title: 'Database', active: chrome.active,
        wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
        artAvailable: app.deps.artAvailable,
        body: `<h1>Not found</h1><p class="error">No ${escapeHtml(type)} with id ${escapeHtml(id)}.</p><p>${chrome.back}</p>`
      }));
      return;
    }
    const body = entity.render({ ...data, wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild, artAvailable: app.deps.artAvailable });
    reply.type('text/html').send(renderBrowserPage({
      title: `${chrome.label} ${id}`, active: chrome.active, body,
      wowPatch: config.realm?.wowPatch, clientBuild: config.realm?.clientBuild,
      artAvailable: app.deps.artAvailable
    }));
  });
}
