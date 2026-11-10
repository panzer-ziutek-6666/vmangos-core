import { escapeHtml } from '../layout.js';
import { renderIcon } from './icon.js';
import { entityLink, itemEntityLink, renderRawRow, skillUpLabel, autoLearnLabel, skillLink } from './fields.js';
import { substituteSpellText, formatDuration, effectRange } from '../../dbLookups/spellText.js';
import { spellContext } from '../../dbLookups/spellLabels.js';
import { referencedContexts } from './spellTooltip.js';
import { spellEffectName, auraName, spellSchoolName } from '../../dbLookups/spellTypes.js';
import { costLabel } from './spellTooltip.js';
import { castLabel, cooldownLabel } from './spellList.js';
import { classNames, raceNames } from '../../dbLookups/questFlags.js';
import { itemSpellTriggerName } from '../../dbLookups/itemClasses.js';

const EFFECT_SLOTS = [1, 2, 3];

// `Level N · <school> · <cast> cast · <cooldown> cooldown · <range> yd range ·
// <duration> duration · <cost>`, each part dropped when it carries nothing to
// say - a passive with no cast time, no cooldown and no cost is just its
// level and school. Labelled the same way the hover card already labels cast
// time and range (spellTooltip.js), so "1.5 sec" (a cast time) and "4 sec" (a
// duration) are never left to look like the same kind of number.
function summaryLine(row, entry, labels) {
  const parts = [];

  if (Number(row.spellLevel)) parts.push(`Level ${row.spellLevel}`);

  const school = spellSchoolName(row.school);
  if (school) parts.push(school);

  const castMs = labels.castMs.get(entry);
  if (castMs !== undefined) parts.push(Number(castMs) > 0 ? `${castLabel(castMs)} cast` : castLabel(castMs));

  const cooldown = cooldownLabel(row);
  if (cooldown !== '—') parts.push(`${cooldown} cooldown`);

  const range = labels.range.get(entry);
  if (range && Number(range.max) > 0) parts.push(`${range.max} yd range`);

  // -1 already reads as the self-explanatory "until cancelled"
  // (dbLookups/spellText.js formatDuration) - a "duration" suffix on that
  // would only repeat itself.
  const durationMs = labels.durationMs.get(entry);
  const duration = formatDuration(durationMs);
  if (duration) parts.push(durationMs === -1 ? duration : `${duration} duration`);

  const cost = costLabel(row);
  if (cost) parts.push(cost);

  return parts.join(' · ');
}

function renderRequirements(row, names) {
  const reagents = [];
  for (let i = 1; i <= 8; i++) {
    const id = Number(row[`reagent${i}`]);
    if (id <= 0) continue;
    const count = Number(row[`reagentCount${i}`]);
    reagents.push(`<li>${itemEntityLink(id, names)} × ${escapeHtml(count)}</li>`);
  }

  const totems = [row.totem1, row.totem2]
    .map((t) => Number(t))
    .filter((t) => t > 0)
    .map((t) => `<li>${itemEntityLink(t, names)}</li>`);

  const parts = [];
  if (reagents.length) parts.push(`<h3>Reagents</h3>\n  <ul>\n    ${reagents.join('\n    ')}\n  </ul>`);
  if (totems.length) parts.push(`<h3>Totems</h3>\n  <ul>\n    ${totems.join('\n    ')}\n  </ul>`);
  if (Number(row.requiresSpellFocus)) parts.push(`<p class="detail">Requires spell focus: ${escapeHtml(row.requiresSpellFocus)}</p>`);

  return parts.length ? parts.join('\n') : '<p class="detail">No requirements.</p>';
}

// Effect 1-3, skipped when effectN is 0 (SPELL_EFFECT_NONE - an unused
// slot). Amount is effectRange (spellText.js), the same dice formula the
// description's $s/$o tokens resolve through - never a second copy of it.
function renderEffects(row, labels, entry, names) {
  const rows = [];
  for (const n of EFFECT_SLOTS) {
    const effect = Number(row[`effect${n}`]);
    if (!effect) continue;

    const auraId = Number(row[`effectApplyAuraName${n}`]);
    const aura = auraId ? escapeHtml(auraName(auraId)) : '—';

    const [lo, hi] = effectRange(row, n);
    const amount = lo === hi ? String(lo) : `${lo} to ${hi}`;

    const radius = labels.radius.get(`${entry}:${n}`);
    const radiusCell = radius === undefined ? '—' : `${escapeHtml(radius)} yd`;

    const target = Number(row[`effectImplicitTargetA${n}`]);

    const triggerId = Number(row[`effectTriggerSpell${n}`]);
    const trigger = triggerId ? entityLink({ kind: 'spell', entry: triggerId, name: names.spell.get(triggerId) }) : '—';

    rows.push(`      <tr><td>${escapeHtml(spellEffectName(effect))}</td><td>${aura}</td><td>${escapeHtml(amount)}</td><td>${radiusCell}</td><td>${escapeHtml(target)}</td><td>${trigger}</td></tr>`);
  }

  if (rows.length === 0) return '<p class="detail">No effects.</p>';
  return `<table>
    <thead><tr><th>effect</th><th>aura</th><th>amount</th><th>radius</th><th>target</th><th>trigger</th></tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>`;
}

// A skill line link is plain, not entityLink: /db/skill/:id is not an
// ENTITY_TYPES page (no hover route to fetch) - skillLink (fields.js) is
// shared with the skill index and spellList.js's own skill column, so the
// fallback label for an unnamed skill only has to read right in one place.
// The skill-up range and auto-learn note are skillUpLabel/autoLearnLabel
// (fields.js) - the same read the skill page's own "Teaches" table shows for
// this exact row, not a second, independently wrong copy of "(requires N)".
function renderSkills(skills, names) {
  if (skills.length === 0) return '<p class="detail">Not taught by a skill line.</p>';

  const items = skills.map((s) => {
    const link = skillLink(s.skillId, s.name);
    // Most skill_line_ability rows carry no skill-up range at all
    // (skillUpLabel's own maxValue === 0 case) - the skill page's table needs
    // a dash to fill a cell, but this list can just omit the fact entirely,
    // exactly as it already omits the auto-learn note when there is none.
    const skillUp = Number(s.maxValue) !== 0 ? ` <span class="detail">(${skillUpLabel(s)})</span>` : '';
    const autoLearn = autoLearnLabel(s);
    const auto = autoLearn ? ` <span class="detail">(${autoLearn})</span>` : '';
    const classes = s.classMask ? ` <span class="detail">${classNames(s.classMask).map((n) => escapeHtml(n)).join(', ')}</span>` : '';
    const races = s.raceMask ? ` <span class="detail">${raceNames(s.raceMask).map((n) => escapeHtml(n)).join(', ')}</span>` : '';
    const superseded = s.supersededBy
      ? ` <span class="detail">superseded by ${entityLink({ kind: 'spell', entry: s.supersededBy, name: names.spell.get(s.supersededBy) })}</span>`
      : '';
    return `<li>${link}${skillUp}${auto}${classes}${races}${superseded}</li>`;
  });

  return `<ul>\n    ${items.join('\n    ')}\n  </ul>`;
}

function renderTrainers(trainers, names) {
  if (trainers.length === 0) return '<p class="detail">Not taught by a trainer.</p>';

  const items = trainers.map((t) => {
    const cost = `${escapeHtml(t.cost)}c, requires level ${escapeHtml(t.reqLevel)}`;
    if (t.source === 'creature') {
      return `<li>${entityLink({ kind: 'creature', entry: t.entry, name: names.creature.get(t.entry) })} — ${cost}</li>`;
    }
    const creatures = t.creatures.length
      ? t.creatures.map((c) => entityLink({ kind: 'creature', entry: c, name: names.creature.get(c) })).join(', ')
      : '<span class="detail">no creature uses this template</span>';
    return `<li>Trainer template #${escapeHtml(t.entry)} — ${cost}: ${creatures}</li>`;
  });

  return `<ul>\n    ${items.join('\n    ')}\n  </ul>`;
}

// An item that casts this spell names it directly (spellid_N = this entry);
// an item that teaches it (a recipe, plan or tome) names one of its teaching
// spells instead, exactly as a trainer row does - fetchItemsCasting (spell.js
// query) tags each hit `teaches` so this reads "teaches" in place of the
// trigger name, which would otherwise describe the teaching spell's cast,
// not this one.
function renderItemsSection(items, names) {
  if (items.length === 0) return '<p class="detail">Not cast or taught by an item.</p>';

  const rows = items
    .map((i) => `      <tr><td>${itemEntityLink(i.entry, names)}</td><td>${i.teaches ? 'teaches' : escapeHtml(itemSpellTriggerName(i.trigger))}</td></tr>`)
    .join('\n');

  return `<table>
    <thead><tr><th>item</th><th>trigger</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

// `data` is loadSpell's return value plus wowPatch/clientBuild, the
// configuration the route attaches (server/sections/db.js) exactly as every
// other entity page's render call does.
export function renderSpellPage(data) {
  const { entry, row, labels, referenced, talent, skills, trainers, items, names, clientBuild } = data;

  // `referenced` is loadSpell's Map of raw spell_template rows (fetchSpellRows) -
  // built into the {spell, durationMs, rangeYards, radiusYards} shape
  // substituteSpellText's tokens read, through the same referencedContexts
  // the hover card uses, not a hand-rolled copy of it.
  const ctx = spellContext(row, labels, referencedContexts(referenced, labels));
  const description = substituteSpellText(row.description, ctx).trim();
  const descriptionHtml = escapeHtml(description).replaceAll('\n', '<br>');
  const auraText = substituteSpellText(row.auraDescription, ctx).trim();
  const auraHtml = auraText ? escapeHtml(auraText).replaceAll('\n', '<br>') : '';

  const icon = renderIcon(labels.iconName.get(entry), row.name);
  const rank = row.nameSubtext ? ` <span class="detail">${escapeHtml(row.nameSubtext)}</span>` : '';

  const talentLine = talent
    ? `<p>Talent: <a href="/db/talents/${escapeHtml(talent.classSlug)}?talent=${escapeHtml(talent.talentId)}">${escapeHtml(talent.treeName)}</a>, rank ${escapeHtml(talent.rank)}</p>\n`
    : '';

  return `<h1>${icon}${escapeHtml(row.name)}${rank}</h1>
<p class="detail">${escapeHtml(summaryLine(row, entry, labels))}</p>
${talentLine}<p><a href="/db/spells">back to spells</a></p>

<h2>Description</h2>
<p>${descriptionHtml || '—'}</p>
${auraHtml ? `<h2>Aura</h2>\n<p>${auraHtml}</p>\n` : ''}
<h2>Requirements</h2>
${renderRequirements(row, names)}

<h2>Effects</h2>
${renderEffects(row, labels, entry, names)}

<h2>Taught by</h2>
<h3>Skill lines</h3>
${renderSkills(skills, names)}
<h3>Trainers</h3>
${renderTrainers(trainers, names)}

<h2>Items</h2>
${renderItemsSection(items, names)}

<p class="detail">Read at build ${escapeHtml(row.build)}, the highest not above the configured client build ${escapeHtml(clientBuild)}.</p>
${renderRawRow(row)}`;
}
