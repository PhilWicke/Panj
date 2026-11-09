// tests/content/native-list.test.js
// The real content/NATIVE_LIST.md as it goes to a native speaker: its instruction and the drill words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PERCEPTION_SETS } from '../../app/js/content/perception-sets.js';

test('NATIVE_LIST.md starts with its instruction and lists every drill word once under "Drill words", after the unit sections, unless the tsv confirms it', async () => {
  const list = await readFile(new URL('../../content/NATIVE_LIST.md', import.meta.url), 'utf8');
  const tsv = (await readFile(new URL('../../content/native-confirmations.tsv', import.meta.url), 'utf8')).normalize('NFC');
  assert.ok(list.startsWith('# Ask a native speaker\n\nEach row is a word or phrase that one of the two reviews doubted.'));
  const at = list.indexOf('\n## Drill words\n');
  assert.ok(at > 0);
  const section = list.slice(at);
  // a confirmed drill line stays in the tsv (native-confirm reports it as not a lesson item) once its row is deleted
  const confirmed = new Set(tsv.replace(/^﻿/, '').split(/\r?\n/).map((line) => line.split('\t').map((cell) => cell.trim()))
    .filter(([id, verdict]) => id.startsWith('drill:') && verdict?.toLowerCase() === 'confirmed').map(([id]) => id.slice('drill:'.length)));
  for (const word of PERCEPTION_SETS.flat()) {
    const rows = section.split(`\n| drill:${word} | ${word} |`).length - 1;
    assert.ok(rows === 1 || (rows === 0 && confirmed.has(word)), `${word}: ${rows} rows, ${confirmed.has(word) ? '' : 'not '}confirmed in the tsv`);
  }
  assert.ok(!/\n## Unit \d\d\n/.test(section), 'unit sections come first');
});
