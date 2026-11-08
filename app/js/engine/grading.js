// Typed-answer grading. The answer and the target (or any accepted variant) are normalised the
// same way, then compared: equal is correct; equal once the diacritics are stripped from both
// sides is a slip that names the letters the learner got wrong; anything else is wrong, with a
// character-level diff that marks the error within the learner's answer (the feedback shows the
// correct form separately). Every function is pure and the module has no dependencies. The
// spoken comparison (Task 14) reuses levenshtein on the normalised, diacritic-free strings.

const CURLY_SINGLE = /[\u2018\u2019\u201A\u201B]/g; // ‘ ’ ‚ ‛
const CURLY_DOUBLE = /[\u201C\u201D\u201E\u201F]/g; // “ ” „ ‟
const DROPPED = /[.,;:!?"'()\-\u2013\u2014]/g; // .,;:!?"'() and the hyphen, en dash and em dash

/**
 * One run of the diff. `same`: the same letters in the answer and the target. `del`: typed, not
 * in the target. `sub`: typed where the target has other letters. `add`: in the target, missing
 * from the answer. `text` is the answer's text for `same`, `del` and `sub` and the target's for
 * `add`, so the `same`, `del` and `sub` runs in order spell the normalised answer.
 * @typedef {object} DiffOp
 * @property {'same'|'add'|'del'|'sub'} type
 * @property {string} text
 */

/**
 * @typedef {object} GradeResult
 * @property {'correct'|'slip'|'wrong'} result
 * @property {string|null} matched the target or accept entry the answer matched, as written in the content; null when wrong
 * @property {DiffOp[]} diff the normalised answer against the matched candidate (one `same` run when correct, `sub` runs at the slipped letters) or, when wrong, against the normalised target
 * @property {string[]} slipChars when `slip`, the letters of the matched candidate at the places where the answer differs only in diacritics, each once, in order; otherwise empty
 */

/**
 * The comparable form of a line: NFC (so a decomposed č equals the precomposed one), lowercase,
 * curly quotes and apostrophes made straight, then `.,;:!?"'()` and the hyphen, en dash and em
 * dash dropped, whitespace collapsed to single spaces and trimmed.
 * @param {string} s
 * @returns {string}
 */
export function normalize(s) {
  return s.normalize('NFC').toLowerCase()
    .replace(CURLY_SINGLE, "'")
    .replace(CURLY_DOUBLE, '"')
    .replace(DROPPED, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The string without its diacritics: NFD, then every combining mark removed (č to c, š to s, ž to z).
 * @param {string} s
 * @returns {string}
 */
export function stripDiacritics(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * The Levenshtein distance between two strings, counted in code points: the fewest single
 * character insertions, deletions and substitutions that turn one into the other.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[y.length];
}

/**
 * Grades a typed answer against the target and its accepted variants. The candidates are tried
 * in the order target, accept entries: a match of the normalised forms on any of them is correct;
 * otherwise a match once the diacritics are stripped from both sides (Ruling 12: on accept
 * entries too) is a slip; otherwise the answer is wrong and `diff` marks the error within it
 * against the target.
 * @param {string} answer what the learner typed
 * @param {string} target the Slovenian form as written in the content
 * @param {string[]} [accept] accepted variants as written in the content
 * @returns {GradeResult}
 */
export function grade(answer, target, accept = []) {
  const typed = normalize(answer);
  const candidates = [target, ...accept];
  const exact = candidates.find((candidate) => normalize(candidate) === typed);
  if (exact !== undefined) {
    return { result: 'correct', matched: exact, diff: typed ? [{ type: 'same', text: typed }] : [], slipChars: [] };
  }
  const plain = stripDiacritics(typed);
  const slipped = candidates.find((candidate) => stripDiacritics(normalize(candidate)) === plain);
  if (slipped !== undefined) {
    const expected = normalize(slipped);
    return { result: 'slip', matched: slipped, diff: diffChars(typed, expected), slipChars: missedLetters(typed, expected) };
  }
  return { result: 'wrong', matched: null, diff: diffChars(typed, normalize(target)), slipChars: [] };
}

/**
 * The letters of `expected` at the places where `typed` differs from it, each once, in order.
 * Called only when the two are equal without diacritics, so they have the same letters in the
 * same places and differ only in marks. A letter is a base character with the combining marks
 * that follow it, recomposed, so the comparison does not depend on how the input was encoded;
 * a stray mark with no letter under it is dropped, as the comparison without diacritics drops it.
 * @param {string} typed
 * @param {string} expected
 * @returns {string[]}
 */
function missedLetters(typed, expected) {
  const got = letters(typed);
  return [...new Set(letters(expected).filter((letter, i) => letter !== got[i]))];
}

/**
 * @param {string} s
 * @returns {string[]}
 */
function letters(s) {
  /** @type {string[]} */
  const out = [];
  for (const ch of s.normalize('NFD')) {
    if (/\p{M}/u.test(ch)) {
      if (out.length > 0) out[out.length - 1] += ch;
    } else {
      out.push(ch);
    }
  }
  return out.map((letter) => letter.normalize('NFC'));
}

/**
 * Character-level diff of `a` (the normalised answer) against `b` (the normalised target) along
 * a longest common subsequence, as runs. Of the equally long subsequences, the walk keeps a
 * deletion or insertion run going while that stays optimal, so a dropped or extra word comes out
 * as one run instead of being threaded through letters that happen to match later. A deletion
 * next to an insertion is a substitution and keeps the answer's text.
 * @param {string} a
 * @param {string} b
 * @returns {DiffOp[]}
 */
function diffChars(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = x.length;
  const m = y.length;
  // lcs[i][j]: length of the longest common subsequence of x from i on and y from j on
  const lcs = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  /** @type {{ type: 'same'|'add'|'del', text: string }[]} */
  const runs = [];
  /** @param {'same'|'add'|'del'} type @param {string} ch */
  const push = (type, ch) => {
    const last = runs[runs.length - 1];
    if (last && last.type === type) last.text += ch;
    else runs.push({ type, text: ch });
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    const last = runs.length > 0 ? runs[runs.length - 1].type : 'same';
    if (i < n && (j >= m || (last === 'del' && lcs[i + 1][j] === lcs[i][j]))) push('del', x[i++]);
    else if (j < m && (i >= n || (last === 'add' && lcs[i][j + 1] === lcs[i][j]))) push('add', y[j++]);
    else if (x[i] === y[j]) { push('same', x[i]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push('del', x[i++]);
    else push('add', y[j++]);
  }
  return mergeSubstitutions(runs);
}

/**
 * Joins the per-letter runs into the diff: neighbouring `del` and `add` runs, in either order,
 * become one `sub` carrying the answer's text; `same` runs separate the groups.
 * @param {{ type: 'same'|'add'|'del', text: string }[]} runs
 * @returns {DiffOp[]}
 */
function mergeSubstitutions(runs) {
  /** @type {DiffOp[]} */
  const ops = [];
  let k = 0;
  while (k < runs.length) {
    if (runs[k].type === 'same') {
      ops.push({ type: 'same', text: runs[k].text });
      k++;
      continue;
    }
    let typed = '';
    let expected = '';
    for (; k < runs.length && runs[k].type !== 'same'; k++) {
      if (runs[k].type === 'del') typed += runs[k].text;
      else expected += runs[k].text;
    }
    if (typed && expected) ops.push({ type: 'sub', text: typed });
    else if (typed) ops.push({ type: 'del', text: typed });
    else ops.push({ type: 'add', text: expected });
  }
  return ops;
}
