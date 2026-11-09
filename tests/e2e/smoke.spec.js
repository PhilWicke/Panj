// The end-to-end smoke test: the app in a browser, against the development build that
// playwright.config.js builds and serves (nothing is accepted yet, so only the dev bundle has a
// lesson to practise). Each test starts in a fresh context, with empty storage: onboarding to
// Today; a full u01-l01 session answered right; a wrong typed answer, its diff, the retry and the
// item's return after two entries; mute without listening; export with a flag; a malformed import;
// a session with IndexedDB blocked; the service worker serving the app offline (kept last).
//
// The answers come from the bundle itself (app/content/dist/), read when a test asks for them,
// after the web server has built it. Machines differ in their speech voices (a Mac may have a
// Slovenian one, the CI runner has none) and the audio manifest lists no recordings yet, so every
// test hides the device voices: each audio exercise takes its no-audio form, the same everywhere.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { validateImport } from '../../app/js/store/state.js';
import { localDateKey } from '../../app/js/util/time.js';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {{ kind: string, key?: string|null }} Entry an exercise of the session, `key` its prompt where it has one */
/**
 * @typedef {object} Answers
 * @property {any} lesson u01-l01 as the bundle has it
 * @property {Map<string, string>} typed English prompt to Slovenian answer: the items' and the slot exercises'
 * @property {Map<string, string>} rules rule title to its quick check's answer
 */

const LESSON_ID = 'u01-l01';
const NAME = 'Ana';
const SESSION_DONE = 'Session complete.';
const NO_AUDIO = 'No audio on this device.';

/** @type {Answers|null} */
let answersRead = null;

/** @returns {Answers} the lesson and its answers, read from the bundle once */
function answers() {
  if (answersRead) return answersRead;
  /** @param {string} path */
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const unit = read('../../app/content/dist/units/u01.json');
  const index = read('../../app/content/dist/index.json');
  const lesson = unit.lessons.find((/** @type {any} */ each) => each.id === LESSON_ID);
  if (!lesson) throw new Error(`${LESSON_ID} is not in the bundle: build it with node tools/build-content.js --allow-pending`);
  answersRead = {
    lesson,
    typed: new Map([
      ...lesson.items.map((/** @type {any} */ item) => [item.en, item.sl]),
      ...lesson.production.map((/** @type {any} */ exercise) => [exercise.en, exercise.answer]),
    ]),
    rules: new Map(index.rules.map((/** @type {any} */ rule) => [rule.title_en, rule.quick_check.answer])),
  };
  return answersRead;
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (globalThis.speechSynthesis) globalThis.speechSynthesis.getVoices = () => [];
  });
});

/** @param {Page} page @param {string} name */
const button = (page, name) => page.getByRole('button', { name, exact: true });
/** @param {Page} page */
const primaryAction = (page) => page.getByRole('button', { name: /^Start today's session/ });
/** @param {Page} page */
const progress = (page) => page.getByRole('progressbar', { name: 'Session progress' });
/** @param {Page} page @param {string} label */
const tab = (page, label) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true });

/**
 * Onboarding's four steps: the name, the intention as prefilled, the light theme, then "Start
 * from the first hello", which lands on Today.
 * @param {Page} page
 * @returns {Promise<string>} the intention clause, as prefilled
 */
async function onboard(page) {
  await page.goto('/');
  await expect(page.getByText('1 of 4', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'What should we call you?' }).fill(NAME);
  await button(page, 'Next').click();
  await expect(page.getByText('2 of 4', { exact: true })).toBeVisible();
  const clause = await page.getByRole('textbox', { name: 'I practise …' }).inputValue();
  expect(clause).not.toBe('');
  await button(page, 'Next').click();
  await expect(page.getByText('3 of 4', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Light', exact: true }).check();
  await button(page, 'Next').click();
  await expect(page.getByText('4 of 4', { exact: true })).toBeVisible();
  await button(page, 'Start from the first hello').click();
  await expect(primaryAction(page)).toBeVisible();
  return clause;
}

/**
 * The exercise on screen, told by what it shows.
 * @param {Page} page
 * @returns {Promise<Entry>}
 */
async function currentEntry(page) {
  const heading = page.getByRole('heading', { level: 2 });
  if (await page.getByRole('heading', { name: SESSION_DONE }).isVisible()) return { kind: 'closing' };
  if (await button(page, "I'm ready").isVisible()) return { kind: 'meet', key: await heading.textContent() };
  if (await page.getByRole('heading', { name: 'Rule card' }).isVisible()) {
    return { kind: 'rule', key: await page.getByRole('heading', { level: 3 }).textContent() };
  }
  if (await page.getByText('Choose the form', { exact: true }).isVisible()) return { kind: 'structured' };
  if (await page.getByRole('textbox', { name: 'Your answer in Slovenian' }).isVisible()) return { kind: 'typed', key: await heading.textContent() };
  if (await page.getByText('Dialogue', { exact: true }).isVisible()) return { kind: 'dialogue' };
  if (await page.getByRole('heading', { name: 'Which did you hear?' }).isVisible()) return { kind: 'perception' };
  if (await page.getByText(NO_AUDIO, { exact: true }).isVisible()) return { kind: 'perception' };
  if (await page.getByText('Listening', { exact: true }).isVisible()) return { kind: 'listening' };
  throw new Error(`No known exercise on screen: ${await page.getByRole('main').innerText()}`);
}

/**
 * Picks `answer` among the options of a rule's quick check or a structured exercise, then Continue.
 * @param {Page} page
 * @param {string|undefined} answer
 */
async function pickRight(page, answer) {
  if (answer === undefined) throw new Error('No answer in the bundle for these options');
  await page.getByRole('group', { name: 'Options' }).getByRole('button', { name: answer, exact: true }).click();
  await expect(page.getByText('Correct.', { exact: true })).toBeVisible();
  await button(page, 'Continue').click();
}

/**
 * Types `answer` in the field named `label`, checks it and goes on once it is graded correct.
 * @param {Page} page
 * @param {string} label
 * @param {string|undefined} answer
 */
async function typeRight(page, label, answer) {
  if (answer === undefined) throw new Error(`No answer in the bundle for the field ${label}`);
  const field = page.getByRole('textbox', { name: label });
  await expect(field).toBeEditable();
  await field.fill(answer);
  await field.press('Enter');
  await expect(page.getByText('Correct.', { exact: true })).toBeVisible();
  await button(page, 'Continue').click();
}

/**
 * The structured exercise's answer, found by its Slovenian prompt (the blank reads "blank").
 * @param {Page} page
 * @returns {Promise<string>}
 */
async function structuredAnswer(page) {
  for (const exercise of answers().lesson.structured) {
    const shown = exercise.prompt_sl.replace(/_+/, 'blank');
    if (await page.getByText(shown, { exact: true }).isVisible()) return exercise.answer;
  }
  throw new Error('The structured prompt on screen is not in the bundle');
}

/**
 * Answers the exercise on screen right and goes on.
 * @param {Page} page
 * @param {Entry} entry
 */
async function playEntry(page, entry) {
  const { lesson, typed, rules } = answers();
  if (entry.kind === 'meet') {
    await button(page, "I'm ready").click();
  } else if (entry.kind === 'rule') {
    await pickRight(page, rules.get(entry.key ?? ''));
  } else if (entry.kind === 'structured') {
    await pickRight(page, await structuredAnswer(page));
  } else if (entry.kind === 'typed') {
    await typeRight(page, 'Your answer in Slovenian', typed.get(entry.key ?? ''));
  } else if (entry.kind === 'perception') {
    await expect(page.getByText(NO_AUDIO, { exact: true })).toBeVisible();
    await button(page, 'Continue').click();
  } else if (entry.kind === 'dialogue') {
    const lines = lesson.dialogue.lines;
    for (const line of lines) if (line.speaker === 'you') await typeRight(page, 'Your line in Slovenian', line.sl);
    if (lines.at(-1).speaker !== 'you') await button(page, 'Continue').click();
  } else {
    throw new Error(`The test does not play ${entry.kind} exercises`);
  }
}

/**
 * Plays the session on screen, every answer right, entry by entry: the progress bar's value is
 * the index of the entry showing, so each entry is played once it is drawn. Ends at the closing
 * menu, or before the first entry `stop` accepts.
 * @param {Page} page
 * @param {{ stop?: (entry: Entry, played: Entry[]) => boolean, check?: () => Promise<void> }} [options]
 *   `check` runs on every entry before it is played
 * @returns {Promise<Entry[]>} the entries played
 */
async function playSession(page, { stop, check } = {}) {
  /** @type {Entry[]} */
  const played = [];
  for (let at = 0; ; at += 1) {
    await expect(progress(page)).toHaveAttribute('aria-valuenow', String(at));
    const entry = await currentEntry(page);
    if (entry.kind === 'closing' || stop?.(entry, played)) return played;
    await check?.();
    await playEntry(page, entry);
    played.push(entry);
  }
}

/**
 * From Today, plays the session up to its first typed recall, answered right, and ends it there,
 * back on Today: the lesson's first item has been met.
 * @param {Page} page
 */
async function meetFirstItem(page) {
  await primaryAction(page).click();
  await playSession(page, { stop: (entry, played) => played.some((each) => each.kind === 'typed') });
  await button(page, 'End').click();
  await expect(primaryAction(page)).toBeVisible();
}

/**
 * The Words screen as the learner reads it: the count line and the entries.
 * @param {Page} page
 * @returns {Promise<{ count: string|null, rows: string[] }>}
 */
async function wordsList(page) {
  await tab(page, 'Words').click();
  await expect(page.getByRole('heading', { name: 'Words', level: 1 })).toBeVisible();
  const count = page.getByText(/^\d+ items? met$/);
  await expect(count).toBeVisible();
  return { count: await count.textContent(), rows: await page.getByRole('main').getByRole('listitem').allTextContents() };
}

test('onboarding leads to Today with the name, the intention and the session to start', async ({ page }) => {
  const clause = await onboard(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(new RegExp(`^(Dobro jutro|Dober dan|Dober večer), ${NAME}\\b`));
  await expect(page.getByText(`I practise ${clause}.`, { exact: true })).toBeVisible();
  await expect(primaryAction(page)).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
});

test('a full u01-l01 session answered right ends at the closing menu, and Today marks the day', async ({ page }) => {
  await onboard(page);
  const honey = page.getByText(/^\d+ honey this week$/);
  await expect(honey).toHaveCount(0);
  await expect(page.getByText(/, today, practised$/)).toHaveCount(0);

  await primaryAction(page).click();
  const played = await playSession(page);
  const kinds = played.map((entry) => entry.kind);
  for (const kind of ['meet', 'rule', 'structured', 'typed', 'perception', 'dialogue']) expect(kinds).toContain(kind);

  const summary = await page.getByText(/^\d+ of \d+ answers right/).textContent();
  const [, right, of] = /^(\d+) of (\d+)/.exec(summary ?? '') ?? [];
  expect(Number(right)).toBeGreaterThan(0);
  expect(right).toBe(of);
  await expect(button(page, 'Three more minutes')).toBeVisible();
  await button(page, 'Stop here').click();

  await expect(primaryAction(page).or(page.getByRole('button', { name: 'Nothing due right now' }))).toBeVisible();
  await expect(page.getByText(/, today, practised$/)).toHaveCount(1);
  await expect(honey).toHaveText(`${right} honey this week`);
});

test('a wrong typed answer shows the diff and a retry, and the item returns after two entries', async ({ page }) => {
  await onboard(page);
  await primaryAction(page).click();
  const { typed } = answers();
  /** @type {{ at: number, key: string }|null} */
  let missed = null;
  for (let at = 0; ; at += 1) {
    await expect(progress(page)).toHaveAttribute('aria-valuenow', String(at));
    const entry = await currentEntry(page);
    if (entry.kind === 'closing') throw new Error('The missed item never came back');
    if (entry.kind === 'typed' && missed === null) {
      missed = { at, key: entry.key ?? '' };
      const field = page.getByRole('textbox', { name: 'Your answer in Slovenian' });
      await field.fill('Zdravo');
      await field.press('Enter');
      await expect(page.getByText('Not quite.', { exact: true })).toBeVisible();
      await expect(page.locator('.diff').locator('.diff-del, .diff-sub').first()).toBeVisible();
      await button(page, 'Type it again').click();
      const answer = typed.get(missed.key);
      if (answer === undefined) throw new Error(`No answer in the bundle for ${missed.key}`);
      await page.getByRole('textbox', { name: 'Type the correct form once more' }).fill(answer);
      await button(page, 'Done').click();
      continue;
    }
    if (entry.kind === 'typed' && missed !== null && entry.key === missed.key) {
      expect(at - missed.at - 1).toBe(2);
      await playEntry(page, entry);
      break;
    }
    await playEntry(page, entry);
  }
});

test('with mute on, a session has no listening, no perception and no play buttons', async ({ page }) => {
  await onboard(page);
  await tab(page, 'Settings').click();
  const mute = page.getByRole('switch', { name: 'Mute' });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await tab(page, 'Today').click();

  await primaryAction(page).click();
  const played = await playSession(page, {
    check: async () => {
      // A muted audio exercise would turn into the no-audio line at once, so that line counts too.
      await expect(page.getByText(/^(Write what you hear\.|Which did you hear\?|What does it mean\?|No audio on this device\.)$/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^(Listen|Play again)$/ })).toHaveCount(0);
    },
  });
  expect(played.length).toBeGreaterThan(0);
  expect(played.filter((entry) => entry.kind === 'perception' || entry.kind === 'listening')).toEqual([]);
  await expect(page.getByRole('heading', { name: SESSION_DONE })).toBeVisible();
  await expect(button(page, 'A speaking round')).toHaveCount(0);
});

test('export downloads a backup that validates and carries a flag from Words', async ({ page }) => {
  await onboard(page);
  await meetFirstItem(page);
  const item = answers().lesson.items[0];
  const note = 'The smoke test flags this.';

  await tab(page, 'Words').click();
  const row = page.getByRole('listitem').filter({ hasText: item.sl });
  await row.getByRole('button', { name: 'Report this', exact: true }).click();
  await row.getByRole('textbox', { name: 'What looks wrong?' }).fill(note);
  await row.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByText('Noted. Flags travel with your export.', { exact: true })).toBeVisible();

  await tab(page, 'Settings').click();
  const downloaded = page.waitForEvent('download');
  await button(page, 'Export progress').click();
  const download = await downloaded;
  const name = `slovelingo-backup-${localDateKey(Date.now())}.json`;
  expect(download.suggestedFilename()).toBe(name);
  await expect(page.getByText(`Backup saved as ${name}.`, { exact: true })).toBeVisible();

  const result = validateImport(readFileSync(await download.path(), 'utf8'));
  if (!result.ok) throw new Error(`The backup does not validate: ${result.reason}`);
  expect(result.data.flags).toContainEqual(expect.objectContaining({ itemId: item.id, note }));
});

test('a malformed import shows the reason and leaves the Words list as it was', async ({ page }) => {
  await onboard(page);
  await meetFirstItem(page);
  const before = await wordsList(page);
  expect(before.rows.length).toBeGreaterThan(0);

  const malformed = '{"nope":1}';
  const verdict = validateImport(malformed);
  if (verdict.ok) throw new Error('The malformed file validates');
  await tab(page, 'Settings').click();
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Import progress').click();
  await (await chooser).setFiles({ name: 'not-a-backup.json', mimeType: 'application/json', buffer: Buffer.from(malformed) });
  await expect(page.getByText(`Nothing was imported. ${verdict.reason}`, { exact: true })).toBeVisible();
  await expect(button(page, 'Replace')).toBeHidden();

  expect(await wordsList(page)).toEqual(before);
  await page.reload();
  expect(await wordsList(page)).toEqual(before);
});

test('with IndexedDB blocked, Today says progress is not saved and a session still runs', async ({ context, page }) => {
  await context.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }));
  await onboard(page);
  await expect(page.getByText('Progress is not being saved in this browser.', { exact: true })).toBeVisible();
  await primaryAction(page).click();
  const played = await playSession(page);
  expect(played.length).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: SESSION_DONE })).toBeVisible();
  await expect(button(page, 'Stop here')).toBeVisible();
});

// Kept last: it takes the context offline.
test('the service worker serves the app offline and a session plays a typed item', async ({ context, page }) => {
  await onboard(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await expect(primaryAction(page)).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(NAME);
  await expect(primaryAction(page)).toBeVisible();
  const version = await page.evaluate(() => /** @type {any} */ (globalThis).SLOVELINGO_VERSION);
  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames.filter((name) => /^slovelingo-(?!audio$)/.test(name))).toEqual([`slovelingo-${version}`]);

  await primaryAction(page).click();
  const played = await playSession(page, { stop: (entry, done) => done.some((each) => each.kind === 'typed') });
  expect(played.filter((entry) => entry.kind === 'typed')).toHaveLength(1);
});
