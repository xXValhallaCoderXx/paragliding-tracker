/**
 * Common wings, offered as taps rather than as a restriction.
 *
 * A list like this is always out of date, so it is a shortcut and never a constraint:
 * `matchGliders` filters it, but the field itself accepts anything the pilot types. The
 * five the design draws come first so the empty state matches the mock exactly.
 */
export const GLIDER_SUGGESTIONS: readonly string[] = [
  'Ozone Rush 6',
  'Ozone Buzz Z7',
  'Advance Iota 3',
  'Gin Explorer 2',
  'Nova Mentor 7',
  'Ozone Delta 4',
  'Ozone Zeno 2',
  'Advance Epsilon 10',
  'Gin Bonanza 3',
  'Nova Ion 7',
  'Niviuk Artik 6',
  'Niviuk Klimber 3',
  'Skywalk Mescal 6',
  'Skywalk Cumeo 2',
  'UP Summit XC 5',
];

/** How many suggestions the step shows at once. More becomes a wall of names. */
export const GLIDER_SUGGESTION_LIMIT = 5;

/**
 * Case- and position-insensitive substring match, so "rush" finds "Ozone Rush 6" and
 * "ozone" finds every Ozone. An empty query returns the head of the list rather than
 * nothing, because an empty field is exactly when suggestions are most useful.
 */
export function matchGliders(
  query: string,
  suggestions: readonly string[] = GLIDER_SUGGESTIONS,
  limit = GLIDER_SUGGESTION_LIMIT,
): string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return suggestions.slice(0, limit);
  const matches = suggestions.filter((name) => name.toLowerCase().includes(needle));
  // An exact match is not a suggestion — offering the pilot what they already typed is
  // noise, and tapping it would do nothing.
  return matches.filter((name) => name.toLowerCase() !== needle).slice(0, limit);
}
