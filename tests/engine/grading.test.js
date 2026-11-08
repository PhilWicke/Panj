// tests/engine/grading.test.js
// Typed-answer grading: normalisation, diacritic slips, accepted variants, the diff that marks
// the error within the learner's answer, and the edit distance the spoken comparison reuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, stripDiacritics, levenshtein, grade } from '../../app/js/engine/grading.js';

// The brief's tests, verbatim.
test('ignores case, punctuation, curly quotes and spaces', () => {
  assert.equal(grade('  Lahko dobim kavo prosim ', 'Lahko dobim kavo, prosim?').result, 'correct');
  assert.equal(grade('Dober dan!', 'Dober dan.').result, 'correct');
  assert.equal(grade('ni za kaj', 'Ni za kaj.').result, 'correct');
});
test('accept list counts as correct', () => {
  assert.equal(grade('hvala lepa', 'hvala', ['hvala lepa']).result, 'correct');
});
test('missing diacritics is a slip naming the characters', () => {
  const g = grade('caj', 'čaj');
  assert.equal(g.result, 'slip');
  assert.deepEqual(g.slipChars, ['č']);
});
test('wrong answer yields a diff', () => {
  const g = grade('kava', 'kavo');
  assert.equal(g.result, 'wrong');
  assert.ok(g.diff.some(d => d.type === 'sub' || d.type === 'del' || d.type === 'add'));
});
test('empty answer is wrong, not a crash', () => {
  assert.equal(grade('', 'živjo').result, 'wrong');
});

// normalize
test('normalize lowercases, trims, drops punctuation and dashes and collapses whitespace', () => {
  assert.equal(normalize('  Lahko   dobim\u00a0kavo, prosim?  '), 'lahko dobim kavo prosim');
  assert.equal(normalize('"Dober dan!" (rekel je); na-svidenje – jutri — zjutraj.'), 'dober dan rekel je nasvidenje jutri zjutraj');
  assert.equal(normalize('? kava'), 'kava');
  assert.equal(normalize(''), '');
});
test('normalize maps curly quotes and apostrophes to straight ones before dropping them', () => {
  assert.equal(normalize('‘Živjo’, „dober“ “dan” ‚ja‛'), 'živjo dober dan ja');
  assert.equal(normalize('al’ ne'), normalize("al' ne"));
});
test('normalize composes decomposed diacritics so both spellings compare equal', () => {
  const decomposed = 'c\u030Caj'; // c followed by a combining caron
  assert.equal(normalize(decomposed), 'čaj');
  assert.equal(normalize(decomposed), normalize('Čaj'));
  assert.equal(grade(decomposed, 'čaj').result, 'correct');
});

// stripDiacritics
test('stripDiacritics removes the marks and keeps everything else', () => {
  assert.equal(stripDiacritics('Češnja, šči in žganje'), 'Cesnja, sci in zganje');
  assert.equal(stripDiacritics('c\u030C'), 'c');
  assert.equal(stripDiacritics('kava 12'), 'kava 12');
});

// slips and the matched candidate
test('slip against an accepted variant typed without its diacritics (Ruling 12)', () => {
  const g = grade('zivijo', 'Živjo.', ['živijo']);
  assert.equal(g.result, 'slip');
  assert.equal(g.matched, 'živijo');
  assert.deepEqual(g.slipChars, ['ž']);
});
test('a correct match on any candidate beats a slip on the target', () => {
  const g = grade('caj', 'čaj', ['caj']);
  assert.equal(g.result, 'correct');
  assert.equal(g.matched, 'caj');
  assert.deepEqual(g.slipChars, []);
});
test('slipChars lists each letter once, in target order, and names the target letter at the slipped spot', () => {
  assert.deepEqual(grade('cesnja', 'češnja').slipChars, ['č', 'š']);
  assert.deepEqual(grade('cicerika', 'čičerika').slipChars, ['č']);
  const spurious = grade('koša', 'kosa');
  assert.equal(spurious.result, 'slip');
  assert.deepEqual(spurious.slipChars, ['s']);
  assert.deepEqual(grade('\u030Ccaj', 'čaj').slipChars, ['č']); // a stray mark with no letter under it does not shift the comparison
});
test('correct and slip carry the matched candidate as written in the content; wrong carries null', () => {
  assert.equal(grade('Dober dan', 'Dober dan.').matched, 'Dober dan.');
  assert.equal(grade('hvala lepa', 'Hvala.', ['hvala lepa']).matched, 'hvala lepa');
  assert.equal(grade('caj', 'čaj').matched, 'čaj');
  assert.equal(grade('kava', 'kavo').matched, null);
  assert.deepEqual(grade('kava', 'kavo').slipChars, []);
});

// the diff
test('the diff marks the error within the learner answer as same, sub, del and add runs', () => {
  assert.deepEqual(grade('kava', 'kavo').diff, [{ type: 'same', text: 'kav' }, { type: 'sub', text: 'a' }]);
  assert.deepEqual(grade('Kava!', 'kavo.').diff, [{ type: 'same', text: 'kav' }, { type: 'sub', text: 'a' }]);
  assert.deepEqual(grade('', 'živjo').diff, [{ type: 'add', text: 'živjo' }]);
  assert.deepEqual(grade('hvala lepa prosim', 'hvala prosim').diff,
    [{ type: 'same', text: 'hvala ' }, { type: 'del', text: 'lepa ' }, { type: 'same', text: 'prosim' }]);
  assert.deepEqual(grade('hvala prosim', 'hvala lepa prosim').diff,
    [{ type: 'same', text: 'hvala ' }, { type: 'add', text: 'lepa ' }, { type: 'same', text: 'prosim' }]);
  assert.deepEqual(grade('kruh', 'sol').diff, [{ type: 'sub', text: 'kruh' }]);
});
test('same, del and sub runs spell the normalised answer in order', () => {
  const pairs = [['kava', 'kavo'], ['dobre dan', 'dober dan'], ['Hvala lepa, prosim!', 'hvala prosim'],
    ['', 'živjo'], ['lahko noc', 'dober večer'], ['nasvidenje', 'na svidenje'], ['se vidmo jutri', 'se vidimo']];
  for (const [answer, target] of pairs) {
    const typed = grade(answer, target).diff.filter((op) => op.type !== 'add').map((op) => op.text).join('');
    assert.equal(typed, normalize(answer), `${answer} vs ${target}`);
  }
});
test('a correct answer diffs as one same run; a slip marks the slipped letters', () => {
  assert.deepEqual(grade('Dober dan', 'Dober dan.').diff, [{ type: 'same', text: 'dober dan' }]);
  assert.deepEqual(grade('hvala lepa', 'Hvala.', ['hvala lepa']).diff, [{ type: 'same', text: 'hvala lepa' }]);
  assert.deepEqual(grade('caj', 'čaj').diff, [{ type: 'sub', text: 'c' }, { type: 'same', text: 'aj' }]);
});

// levenshtein
test('levenshtein is the edit distance over characters', () => {
  assert.equal(levenshtein('', ''), 0);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('flaw', 'lawn'), 2);
  assert.equal(levenshtein('čaj', 'caj'), 1);
  assert.equal(levenshtein('dober dan', 'dober dan'), 0);
});
