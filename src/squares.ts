// WorldCup Bingo — square pool, seeded card generation, and event→category mapping.

export interface Square { category: string; label: string; }

// Pool of squares. `auto` = can be auto-detected from TxLINE count/phase data.
// Non-auto squares still appear on cards and can be triggered via /api/mock-event for the demo.
export const POOL: (Square & { auto?: boolean })[] = [
  { category: 'goal', label: 'Goal scored', auto: true },
  { category: 'yellow_card', label: 'Yellow card', auto: true },
  { category: 'red_card', label: 'Red card', auto: true },
  { category: 'corner', label: 'A corner kick', auto: true },
  { category: 'two_goals', label: '2+ goals in the match', auto: true },
  { category: 'three_goals', label: '3+ goals in the match', auto: true },
  { category: 'five_goals', label: '5+ goals in the match', auto: true },
  { category: 'five_corners', label: '5+ corners', auto: true },
  { category: 'two_yellows', label: '2+ yellow cards', auto: true },
  { category: 'two_reds', label: 'Two red cards', auto: true },
  { category: 'half_time', label: 'Reach half time', auto: true },
  { category: 'full_time', label: 'Final whistle', auto: true },
  { category: 'nil_nil', label: 'Match ends 0–0', auto: true },
  { category: 'extra_time', label: 'Goes to extra time', auto: true },
  { category: 'penalty_shootout', label: 'Penalty shootout', auto: true },
  // demo / mock-triggered (not derivable from counts alone)
  { category: 'penalty_awarded', label: 'Penalty awarded' },
  { category: 'var_review', label: 'VAR review' },
  { category: 'own_goal', label: 'Own goal' },
  { category: 'free_kick_goal', label: 'Free-kick goal' },
  { category: 'goal_first_15', label: 'Goal in first 15 min' },
  { category: 'goal_last_10', label: 'Goal in last 10 min' },
  { category: 'hat_trick', label: 'A hat-trick' },
  { category: 'goalkeeper_save', label: 'Big goalkeeper save' },
  { category: 'penalty_missed', label: 'Penalty missed' },
  { category: 'injury_stoppage', label: 'Injury stoppage' },
  { category: 'substitution', label: 'Sub before 60’' },
  { category: 'disallowed_goal', label: 'Goal disallowed (VAR)' },
  { category: 'comeback', label: 'A comeback' },
  { category: 'clean_sheet', label: 'A clean sheet' },
];

// ---- deterministic seeded RNG (mulberry32 + string hash) ----
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Same (fixtureId + userId) always yields the same card (prevents refresh-to-cheat).
export function generateCard(fixtureId: string, userId: string): { id: number; category: string; label: string; free: boolean }[] {
  const rand = mulberry32(hashSeed(`${fixtureId}:${userId}`));
  const pool = [...POOL];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picks = pool.slice(0, 24);
  const cells: { id: number; category: string; label: string; free: boolean }[] = [];
  let p = 0;
  for (let i = 0; i < 25; i++) {
    if (i === 12) cells.push({ id: i, category: 'FREE', label: 'FREE', free: true });
    else { const s = picks[p++]; cells.push({ id: i, category: s.category, label: s.label, free: false }); }
  }
  return cells;
}

// ---- map a TxLINE score state to the set of satisfied categories ----
export interface CountState { goals: number; yellows: number; reds: number; corners: number; phase: string; }

export function categoriesFor(s: CountState): string[] {
  const out: string[] = [];
  if (s.goals >= 1) out.push('goal');
  if (s.goals >= 2) out.push('two_goals');
  if (s.goals >= 3) out.push('three_goals');
  if (s.goals >= 5) out.push('five_goals');
  if (s.yellows >= 1) out.push('yellow_card');
  if (s.yellows >= 2) out.push('two_yellows');
  if (s.reds >= 1) out.push('red_card');
  if (s.reds >= 2) out.push('two_reds');
  if (s.corners >= 1) out.push('corner');
  if (s.corners >= 5) out.push('five_corners');
  const p = s.phase;
  if (p === 'HT') out.push('half_time');
  if (p === 'ET1' || p === 'ET2' || p === 'HTET' || p === 'WET') out.push('extra_time');
  if (p === 'PE' || p === 'WPE' || p === 'FPE') out.push('penalty_shootout');
  if (p === 'F' || p === 'FET' || p === 'FPE') {
    out.push('full_time');
    if (s.goals === 0) out.push('nil_nil');
  }
  return out;
}
