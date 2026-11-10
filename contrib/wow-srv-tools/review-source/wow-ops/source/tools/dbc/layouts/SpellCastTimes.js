import { defineLayout, uint, int } from '../layout.js';

// SpellCastTimesEntry in DBCStructure.h is { ID, CastTime, CastTimePerLevel,
// MinCastTime } and DBCfmt.h's SpellCastTimefmt is "niii" - four fields, all
// used by the core, so nothing here is unknown.
export default defineLayout({
  table: 'spell_cast_times',
  file: 'SpellCastTimes.dbc',
  columns: [uint('id'), int('cast_time'), int('cast_time_per_level'), int('min_cast_time')]
});
