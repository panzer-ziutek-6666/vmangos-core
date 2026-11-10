// The talent calculator's rules, from the core's Player::LearnTalent
// (vmangos-core/src/game/Objects/Player.cpp:20956-21060) and
// Player::CalculateTalentsPoints (:20772-20776), plus the client's refund
// rule for taking a point back (the server never removes a single rank).
// Pure: trees come in, build strings and states go out, nothing touches SQL.

// MAX_TALENT_RANK (vmangos-core/src/game/Database/DBCStructure.h:658).
const MAX_TALENT_RANK = 5;

// Level - 9 from level 10 on, times Rate.Talent (Player.cpp:20772-20776).
// CONFIG_FLOAT_RATE_TALENT is a float (World.cpp:545), not a double: at a
// rate a float cannot hold exactly, uint32(points * rate) in the core and a
// double-precision `points * rate` in JS can differ (level 19, rate 0.7 ->
// the core's uint32(10 * 0.7f) is 6, plain JS is 7). Math.fround rounds the
// rate to the same float the core reads from mangosd.conf before the
// multiply, and again after it - a double-precision product of two floats,
// rounded once, is the IEEE float product the core computes.
export function talentPoints(level, rate) {
  return Math.trunc(Math.fround(Math.max(0, level - 9) * Math.fround(rate)));
}

function rankOf(state, talentId) {
  return state.ranks.get(talentId) ?? 0;
}

export function totalSpent(state) {
  return state.spent.reduce((a, b) => a + b, 0);
}

// The first level (10..60) whose talentPoints(level, rate) covers what is
// spent, searched directly rather than computed with 9 + ceil(spent / rate) -
// that formula assumes talentPoints is exact division, which it no longer is
// once talentPoints rounds through Math.fround (M-3). A direct search is
// exact for every rate; a realm never has more than 51 levels to check.
export function requiredLevel(state, rate = 1) {
  const spent = totalSpent(state);
  if (spent === 0) return null;
  for (let level = 10; level <= 60; level++) {
    if (talentPoints(level, rate) >= spent) return level;
  }
  return 60;
}

// Player::LearnTalent's checks, for one more rank of `talent`: a rank the
// talent has (:20963, and a zero RankID past its last rank, :21052-21055), a
// free point (:20960), the prerequisite at DependsOnRank+1 or more
// (:20998-21013), and Row * MAX_TALENT_RANK points already in this tree
// (:21022-21050).
export function canAdd(state, trees, treeIndex, talent, total) {
  const rank = rankOf(state, talent.id);
  if (rank >= Math.min(talent.ranks.length, MAX_TALENT_RANK)) return false;
  if (totalSpent(state) >= total) return false;
  if (state.spent[treeIndex] < talent.row * MAX_TALENT_RANK) return false;
  if (talent.prereq && rankOf(state, talent.prereq.talentId) < talent.prereq.rank + 1) return false;
  return true;
}

// The client's refund rule. After taking one rank of `talent` back:
// - every talent that names it as a prerequisite and holds a point still
//   finds it at its required rank;
// - every row above it that holds points still has row * 5 points below it.
export function canRemove(state, trees, treeIndex, talent) {
  const rank = rankOf(state, talent.id);
  if (rank === 0) return false;
  const tree = trees[treeIndex];
  for (const other of tree.talents) {
    if (other.prereq?.talentId === talent.id && rankOf(state, other.id) > 0 && rank - 1 < other.prereq.rank + 1) return false;
  }
  const byRow = new Map();
  for (const t of tree.talents) byRow.set(t.row, (byRow.get(t.row) ?? 0) + rankOf(state, t.id) - (t.id === talent.id ? 1 : 0));
  let below = 0;
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    if (byRow.get(row) > 0 && below < row * MAX_TALENT_RANK) return false;
    below += byRow.get(row);
  }
  return true;
}

// One digit per talent in (row, column) order, trees joined by "-", each
// tree's trailing zeros and the build's trailing empty trees trimmed.
export function encodeBuild(state, trees) {
  const parts = trees.map((tree) => tree.talents.map((t) => rankOf(state, t.id)).join('').replace(/0+$/, ''));
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts.join('-');
}

// Reads a build one talent at a time, adding each rank through canAdd; the
// first digit that is not 0-5, or the first rank the rules refuse, ends that
// tree. Never throws: an impossible build is its longest valid prefix per tree.
export function parseBuild(build, trees, total) {
  const state = { ranks: new Map(), spent: trees.map(() => 0) };
  const parts = String(build ?? '').split('-');
  trees.forEach((tree, treeIndex) => {
    const digits = parts[treeIndex] ?? '';
    for (let i = 0; i < tree.talents.length && i < digits.length; i++) {
      if (!/^[0-5]$/.test(digits[i])) return;
      const talent = tree.talents[i];
      const want = Number(digits[i]);
      for (let r = 0; r < want; r++) {
        if (!canAdd(state, trees, treeIndex, talent, total)) return;
        state.ranks.set(talent.id, rankOf(state, talent.id) + 1);
        state.spent[treeIndex]++;
      }
    }
  });
  return state;
}

export function withRank(state, trees, talentId, delta) {
  const next = { ranks: new Map(state.ranks), spent: [...state.spent] };
  const treeIndex = trees.findIndex((tree) => tree.talents.some((t) => t.id === talentId));
  const rank = rankOf(next, talentId) + delta;
  if (rank > 0) next.ranks.set(talentId, rank); else next.ranks.delete(talentId);
  next.spent[treeIndex] += delta;
  return encodeBuild(next, trees);
}
