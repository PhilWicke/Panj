// The voice-check CLI contract (Ruling 35): the output folder is a required --out argument. Only
// the refusal runs here, since a run with --out calls Gemini; the key file points nowhere so a
// regression fails on the missing key instead of sending anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../../tools/voice-check.js', import.meta.url));

test('voice-check refuses to run without --out and prints its usage', () => {
  const run = spawnSync(process.execPath, [TOOL], {
    encoding: 'utf8',
    env: { ...process.env, GEMINI_API_KEY_FILE: '/nonexistent/slovelingo-voice-check-test.key' },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Usage: node tools\/voice-check\.js --out <dir> \[--model <model>\]/);
  assert.equal(run.stdout, '');
});
