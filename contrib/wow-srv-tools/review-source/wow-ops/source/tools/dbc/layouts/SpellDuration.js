import { defineLayout, uint, int } from '../layout.js';

// SpellDurationEntry is { ID, Duration[3] } - m_duration, m_durationPerLevel,
// m_maxDuration - and SpellDurationfmt is "niii". All four fields are used by
// the core. Row 0 (10000, 0, 10000) is a duration with no per-level scaling,
// which is the common case in this file.
export default defineLayout({
  table: 'spell_duration',
  file: 'SpellDuration.dbc',
  columns: [uint('id'), int('duration'), int('duration_per_level'), int('duration_max')]
});
