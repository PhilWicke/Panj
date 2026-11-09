// A shuffled copy of a list, drawn from the generator the caller passes, so an exercise's order is
// repeatable in tests. Shared by the exercises that show options (structured input, listening).

/**
 * A shuffled copy of `items` (Fisher-Yates from the end), drawn from `rng`.
 * @template T
 * @param {readonly T[]} items
 * @param {() => number} rng a generator in [0, 1)
 * @returns {T[]}
 */
export function shuffle(items, rng) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
