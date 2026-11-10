// The voice check before any audio is generated in bulk: the twenty lines of
// tools/fixtures/voice-sample.txt in three Gemini voices, written as MP3 into
// the audio folder of the --out folder, plus an index.html there to listen to
// them side by side and note what sounds wrong. Bulk generation waits for the
// listener's verdict on this page.
//
// CLI: node tools/voice-check.js --out <dir> [--model <model>]
//   (npm run voice-check -- --out <dir>)
// Repeatable: lines already generated are skipped. Exit 1 when a line failed or
// --out is missing, 2 on a bad argument.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { audioId } from '../app/js/util/audio-id.js';
import { DEFAULT_MODEL, generateAll, textsFromFile } from './gen-audio.js';

const SAMPLE_FILE = fileURLToPath(new URL('./fixtures/voice-sample.txt', import.meta.url));
const VOICES = [
  { name: 'Kore', kind: 'female' },
  { name: 'Puck', kind: 'male' },
  { name: 'Aoede', kind: 'female' },
];
const USAGE = 'Usage: node tools/voice-check.js --out <dir> [--model <model>]';

/**
 * @param {string} file
 * @returns {Promise<Record<string, { model: string, bytes: number }>>}
 */
const readManifestOrEmpty = (file) => readFile(file, 'utf8').then((raw) => JSON.parse(raw), () => ({}));

/** @param {string} s */
const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/**
 * @param {{ text: string, clips: { voice: string, id: string, ok: boolean }[] }[]} rows
 * @param {string} model the model or models that made the clips
 */
function page(rows, model) {
  const female = VOICES.filter((v) => v.kind === 'female').map((v) => v.name).join(' or ');
  const male = VOICES.filter((v) => v.kind === 'male').map((v) => v.name).join(' or ');
  const body = rows
    .map(({ text, clips }, i) => {
      const n = i + 1;
      const buttons = clips
        .map(({ voice, id, ok }) =>
          ok
            ? `<button type="button" data-src="audio/${id}.mp3" aria-pressed="false" aria-label="Play line ${n} in ${voice}">${voice}</button>`
            : `<span class="missing">${voice} not generated</span>`,
        )
        .join('');
      return `      <tr>
        <td class="n">${n}</td>
        <td class="sl" lang="sl">${escapeHtml(text)}</td>
        <td class="play">${buttons}</td>
        <td class="notes"><textarea data-note="${n}" rows="1" aria-label="Notes on line ${n}"></textarea></td>
      </tr>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panj voice check</title>
<style>
  :root { --indigo: #22307A; --deep-indigo: #161F5C; --honey: #F0B323; --warm-white: #FFFDF9; --ink: #1B1B2A; --line: #E3E0EC; --muted: #5C5A70; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 48px; background: var(--warm-white); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 980px; margin: 0 auto; }
  h1 { margin: 0 0 8px; color: var(--indigo); font-size: 1.75rem; line-height: 1.2; }
  .instruction { margin: 0 0 20px; padding: 10px 14px; border-left: 4px solid var(--honey); background: #FFF5D6; }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 10px; background: var(--indigo); color: var(--warm-white); font-weight: 600; text-align: left; }
  td { padding: 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  td.n { width: 2.5rem; color: var(--muted); }
  td.sl { font-size: 1.2rem; min-width: 14rem; }
  td.play { white-space: nowrap; }
  td.notes { min-width: 12rem; width: 30%; }
  button { min-width: 44px; min-height: 44px; margin: 2px 6px 2px 0; padding: 0 14px; border: 2px solid var(--indigo); border-radius: 22px; background: var(--warm-white); color: var(--indigo); font: inherit; font-weight: 600; cursor: pointer; }
  button:hover { background: #ECEEF8; }
  button[aria-pressed="true"] { border-color: var(--honey); background: var(--honey); color: var(--deep-indigo); }
  button:focus-visible, textarea:focus-visible { outline: 3px solid var(--honey); outline-offset: 2px; }
  textarea { width: 100%; min-height: 44px; padding: 8px; border: 1px solid #C8C4D8; border-radius: 8px; background: #FFFFFF; color: var(--ink); font: inherit; resize: vertical; }
  .missing { display: inline-block; margin-right: 10px; color: var(--muted); font-size: 0.9rem; }
  footer { margin-top: 16px; color: var(--muted); font-size: 0.9rem; }
</style>
</head>
<body>
<main>
  <h1>Panj voice check</h1>
  <p class="instruction">Play each line in the three voices, then pick a female voice (${female}) and a male voice (${male}) for the course, or reject them.</p>
  <div class="scroll">
    <table>
      <thead>
        <tr><th scope="col">#</th><th scope="col">Line</th><th scope="col">Play</th><th scope="col">Notes</th></tr>
      </thead>
      <tbody>
${body}
      </tbody>
    </table>
  </div>
  <footer>Gemini text-to-speech, model ${escapeHtml(model)}, 48 kbps mono MP3. Notes stay in this browser only.</footer>
</main>
<script>
  const player = new Audio();
  let current = null;
  const release = () => {
    if (current) current.setAttribute('aria-pressed', 'false');
    current = null;
  };
  player.addEventListener('ended', release);
  player.addEventListener('error', release);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-src]');
    if (!button) return;
    const again = current === button && !player.paused;
    player.pause();
    release();
    if (again) return;
    current = button;
    button.setAttribute('aria-pressed', 'true');
    player.src = button.dataset.src;
    player.play().catch(release);
  });
  for (const note of document.querySelectorAll('textarea[data-note]')) {
    const key = 'slovelingo-voice-check-note-' + note.dataset.note;
    try { note.value = localStorage.getItem(key) || ''; } catch {}
    note.addEventListener('input', () => {
      try { localStorage.setItem(key, note.value); } catch {}
    });
  }
</script>
</body>
</html>
`;
}

/** @param {string[]} argv @returns {Promise<number>} the exit code */
async function main(argv) {
  let model = DEFAULT_MODEL;
  /** @type {string | undefined} */
  let out;
  try {
    const { values } = parseArgs({ args: argv, options: { model: { type: 'string' }, out: { type: 'string' } } });
    model = values.model ?? DEFAULT_MODEL;
    out = values.out;
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    return 2;
  }
  if (!out) {
    console.error(`Give the output folder with --out <dir>\n${USAGE}`);
    return 1;
  }
  const outDir = path.resolve(out);
  const audioDir = path.join(outDir, 'audio');
  const lines = await textsFromFile(SAMPLE_FILE);
  const texts = lines.flatMap((text) => VOICES.map(({ name }) => ({ text, voice: name })));
  let result;
  try {
    result = await generateAll({ texts, outDir: audioDir, model });
  } catch (err) {
    console.error(`ERROR ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const manifest = await readManifestOrEmpty(path.join(audioDir, 'manifest.json'));
  const rows = [];
  let bytes = 0;
  /** @type {Set<string>} */
  const models = new Set();
  for (const text of lines) {
    const clips = [];
    for (const { name } of VOICES) {
      const id = await audioId(text, name);
      const entry = manifest[id];
      bytes += entry?.bytes ?? 0;
      if (entry) models.add(entry.model);
      clips.push({ voice: name, id, ok: entry !== undefined });
    }
    rows.push({ text, clips });
  }
  await writeFile(path.join(outDir, 'index.html'), page(rows, [...models].join(', ') || model));
  for (const { text, error } of result.failed) console.error(`FAILED ${JSON.stringify(text)} ${error}`);
  console.log(`lines=${lines.length} voices=${VOICES.map((v) => v.name).join(',')} model=${model} generated=${result.generated} skipped=${result.skipped} failed=${result.failed.length}`);
  console.log(`clips=${rows.flatMap((row) => row.clips).filter((clip) => clip.ok).length} total=${(bytes / 1024).toFixed(1)} KB`);
  console.log(`wrote ${path.join(outDir, 'index.html')}`);
  return result.failed.length > 0 ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
