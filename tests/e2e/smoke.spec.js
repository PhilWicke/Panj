// The end-to-end smoke test: the app in a browser, against the development build that
// playwright.config.js builds and serves (nothing is accepted yet, so only the dev bundle has a
// lesson to practise). Each test starts in a fresh context, with empty storage: onboarding's three
// steps to Today, never asking when the learner will practise; a full u01-l01 session answered
// right; a wrong typed answer, its diff, the retry and the item's return after two entries; mute
// without listening; the quiet choices of one sitting, which carry through the closing menu and end
// when the learner leaves the session; export with a flag; a malformed import; a session with
// IndexedDB blocked; the service worker serving the app offline; a new version showing the update
// toast once and reloading only on Reload (it rebuilds the dev bundle with a probe module to make
// the second version, and removes it again); and the hive of a course of ten units with five
// lessons each. The quiet and hive scenarios serve their own courses (course-fixture.js), so they do
// not depend on the content written so far.
//
// The answers come from the bundle itself (app/content/dist/), read when a test asks for them,
// after the web server has built it, except in the quiet scenario, which takes them from its own
// course. Machines differ in their speech voices (a Mac may have a Slovenian one, the CI runner has
// none) and the repository's recordings grow with the content, so every test hides the device
// voices and answers the audio manifest with an empty list: nothing can play, so no listening or
// perception exercise is scheduled (Ruling 81), the same everywhere.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { validateImport } from '../../app/js/store/state.js';
import { localDateKey } from '../../app/js/util/time.js';
import { COURSE_TITLES, fourWords, tenByFive } from './course-fixture.js';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {{ kind: string, key?: string|null }} Entry an exercise of the session, `key` its prompt where it has one */
/**
 * @typedef {object} Answers
 * @property {any} lesson u01-l01 as the bundle (or a scenario's own course) has it
 * @property {Map<string, string>} typed English prompt to Slovenian answer: the items' and the slot exercises'
 * @property {Map<string, string>} rules rule title to its quick check's answer
 */

const LESSON_ID = 'u01-l01';
const NAME = 'Ana';
const SESSION_DONE = 'Session complete.';
/** The closing card's first line when a quiet choice skipped every entry of the run. */
const NOTHING_PLAYED = 'Nothing practised this round.';
const NO_AUDIO = 'No audio on this device.';
/** What the update toast says, as app/js/main.js shows it. */
const UPDATE_TEXT = 'A new version is ready. Reload when you have a moment.';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** The module the update test writes to make a second version; git-ignored, removed afterwards. */
const PROBE = join(ROOT, 'app/js/e2e-update-probe.js');
const VERSION_FILE = join(ROOT, 'app/version.js');

/** @type {Answers|null} */
let answersRead = null;

/**
 * The lesson u01-l01 of a course and its answers.
 * @param {any} index the course's index.json
 * @param {any} unit its unit file of u01
 * @returns {Answers}
 */
function answersOf(index, unit) {
  const lesson = unit.lessons.find((/** @type {any} */ each) => each.id === LESSON_ID);
  if (!lesson) throw new Error(`${LESSON_ID} is not in the bundle: build it with node tools/build-content.js --allow-pending`);
  return {
    lesson,
    typed: new Map([
      ...lesson.items.map((/** @type {any} */ item) => [item.en, item.sl]),
      ...lesson.production.map((/** @type {any} */ exercise) => [exercise.en, exercise.answer]),
    ]),
    rules: new Map(index.rules.map((/** @type {any} */ rule) => [rule.title_en, rule.quick_check.answer])),
  };
}

/** @returns {Answers} the lesson and its answers, read from the bundle once */
function answers() {
  if (answersRead) return answersRead;
  /** @param {string} path */
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  answersRead = answersOf(read('../../app/content/dist/index.json'), read('../../app/content/dist/units/u01.json'));
  return answersRead;
}

/**
 * Serves `course` (course-fixture.js) in place of the built bundle: its index.json and its unit
 * files. page.route does not see the requests a service worker answers, so the test blocks them.
 * @param {Page} page
 * @param {{ index: object, units: Record<string, object> }} course
 */
async function serveCourse(page, course) {
  await page.route('**/content/dist/index.json', (route) => route.fulfill({ json: course.index }));
  await page.route('**/content/dist/units/*.json', (route) => {
    const id = /units\/(u\d{2})\.json$/.exec(route.request().url())?.[1] ?? '';
    return route.fulfill({ json: course.units[id] });
  });
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (globalThis.speechSynthesis) globalThis.speechSynthesis.getVoices = () => [];
    // In the page, not page.route: a request the service worker answers never reaches a route.
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => (String(input?.url ?? input).includes('assets/audio/manifest.json')
      ? Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }))
      : realFetch(input, init));
  });
});

/** Runs the development build from the repository root, as the web server did before the tests. */
function rebuild() {
  execFileSync(process.execPath, ['tools/build-content.js', '--allow-pending'], { cwd: ROOT, stdio: 'ignore' });
}

/** @returns {string} the version app/version.js carries now; the module is cached by import, so the file is read */
function builtVersion() {
  const match = /SLOVELINGO_VERSION = "([0-9a-f]+)"/.exec(readFileSync(VERSION_FILE, 'utf8'));
  if (!match) throw new Error('app/version.js carries no version');
  return match[1];
}

/** Removes the probe module, if a run left it behind, and builds the version without it. */
function removeProbe() {
  if (!existsSync(PROBE)) return;
  rmSync(PROBE);
  rebuild();
}

/** @param {Page} page @param {string} name */
const button = (page, name) => page.getByRole('button', { name, exact: true });
/** @param {Page} page */
const primaryAction = (page) => page.getByRole('button', { name: /^Start today's session/ });
/** @param {Page} page */
const progress = (page) => page.getByRole('progressbar', { name: 'Session progress' });
/** @param {Page} page @param {string} label */
const tab = (page, label) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true });

/**
 * Onboarding's three steps: the name, the light theme (with no field for when the learner will
 * practise), then "Start from the first hello", which lands on Today.
 * @param {Page} page
 */
async function onboard(page) {
  await page.goto('/');
  await expect(page.getByText('1 of 3', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'What should we call you?' }).fill(NAME);
  await button(page, 'Next').click();
  await expect(page.getByText('2 of 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'I practise …' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Light', exact: true }).check();
  await button(page, 'Next').click();
  await expect(page.getByText('3 of 3', { exact: true })).toBeVisible();
  await button(page, 'Start from the first hello').click();
  await expect(primaryAction(page)).toBeVisible();
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
 * @param {any} lesson the lesson played
 * @returns {Promise<string>}
 */
async function structuredAnswer(page, lesson) {
  for (const exercise of lesson.structured) {
    const shown = exercise.prompt_sl.replace(/_+/, 'blank');
    if (await page.getByText(shown, { exact: true }).isVisible()) return exercise.answer;
  }
  throw new Error('The structured prompt on screen is not in the bundle');
}

/**
 * Answers the exercise on screen right and goes on.
 * @param {Page} page
 * @param {Entry} entry
 * @param {Answers} [given] the answers of the lesson played; the bundle's when omitted
 */
async function playEntry(page, entry, given = answers()) {
  const { lesson, typed, rules } = given;
  if (entry.kind === 'meet') {
    await button(page, "I'm ready").click();
  } else if (entry.kind === 'rule') {
    await pickRight(page, rules.get(entry.key ?? ''));
  } else if (entry.kind === 'structured') {
    await pickRight(page, await structuredAnswer(page, lesson));
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
 * @param {{ stop?: (entry: Entry, played: Entry[]) => boolean, check?: () => Promise<void>, answers?: Answers }} [options]
 *   `check` runs on every entry before it is played; `answers` are the lesson's, the bundle's when omitted
 * @returns {Promise<Entry[]>} the entries played
 */
async function playSession(page, { stop, check, answers: given } = {}) {
  /** @type {Entry[]} */
  const played = [];
  for (let at = 0; ; at += 1) {
    await expect(progress(page)).toHaveAttribute('aria-valuenow', String(at));
    const entry = await currentEntry(page);
    if (entry.kind === 'closing' || stop?.(entry, played)) return played;
    await check?.();
    await playEntry(page, entry, given);
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

test('onboarding takes three steps, never asks when you will practise, and leads to Today', async ({ page }) => {
  await onboard(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(new RegExp(`^(Dobro jutro|Dober dan|Dober večer), ${NAME}\\b`));
  await expect(page.getByText(/^I practise/)).toHaveCount(0);
  await expect(primaryAction(page)).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');

  await tab(page, 'Settings').click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'I practise …' })).toHaveCount(0);
});

test('a full u01-l01 session answered right ends at the closing menu, and Today marks the day', async ({ page }) => {
  await onboard(page);
  const honey = page.getByText(/^\d+ honey this week$/);
  await expect(honey).toHaveCount(0);
  await expect(page.getByText(/, today, practised$/)).toHaveCount(0);

  await primaryAction(page).click();
  const played = await playSession(page);
  const kinds = played.map((entry) => entry.kind);
  for (const kind of ['meet', 'rule', 'structured', 'typed', 'dialogue']) expect(kinds).toContain(kind);
  // nothing can play (no recordings, the device voices hidden), so no audio exercise is scheduled (Ruling 81)
  expect(played.filter((entry) => entry.kind === 'perception' || entry.kind === 'listening')).toEqual([]);

  const summary = await page.getByText(/^\d+ of \d+ answers right/).textContent();
  const [, right, of] = /^(\d+) of (\d+)/.exec(summary ?? '') ?? [];
  expect(Number(right)).toBeGreaterThan(0);
  expect(right).toBe(of);
  // every item of the only lesson was practised and none missed, so there is no round to offer (Ruling 80)
  await expect(button(page, 'Stop here')).toBeVisible();
  await expect(button(page, 'Three more minutes')).toHaveCount(0);
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
      await field.fill('xyzzy');   // a string no item can ever accept
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
      await expect(page.getByRole('button', { name: /^(Listen|Play again|Can't listen right now)$/ })).toHaveCount(0);
    },
  });
  expect(played.length).toBeGreaterThan(0);
  expect(played.filter((entry) => entry.kind === 'perception' || entry.kind === 'listening')).toEqual([]);
  await expect(page.getByRole('heading', { name: SESSION_DONE })).toBeVisible();
  await expect(button(page, 'A speaking round')).toHaveCount(0);
});

// Serves its own lesson of four words (course-fixture.js): three new items a day leave one for
// "Continue the lesson", and the three met graduate within the sitting, so the speaking round has
// items to speak. The service worker is blocked so that page.route sees every request.
test.describe('a lesson of four words', () => {
  test.use({ serviceWorkers: 'block' });
  test('quiet choices last for the sitting, carry through the closing menu and end when the learner leaves', async ({ page }) => {
    const course = fourWords();
    await serveCourse(page, course);
    const lessonAnswers = answersOf(course.index, course.units.u01);
    await onboard(page);
    await tab(page, 'Settings').click();
    const perDay = page.getByRole('spinbutton', { name: 'New items per day' });
    await perDay.fill('3');
    await perDay.press('Tab');
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await tab(page, 'Today').click();

    await primaryAction(page).click();
    await expect(page.getByRole('heading', { name: 'beseda 1', level: 2 })).toBeVisible();
    await expect(button(page, "I'm ready")).toBeVisible();
    await expect(button(page, 'Listen')).toBeVisible();
    await button(page, "Can't listen right now").click();
    await expect(button(page, "I'm ready")).toBeVisible();
    await expect(button(page, 'Listen')).toHaveCount(0);
    await expect(button(page, "Can't listen right now")).toHaveCount(0);
    await playSession(page, { answers: lessonAnswers, check: async () => {
      await expect(page.getByRole('button', { name: /^(Listen|Listen again|Can't listen right now)$/ })).toHaveCount(0);
    } });

    await button(page, 'Continue the lesson').click();
    await expect(page.getByRole('heading', { name: 'beseda 4', level: 2 })).toBeVisible();
    await expect(button(page, "I'm ready")).toBeVisible();
    await expect(button(page, 'Listen')).toHaveCount(0);
    await expect(button(page, "Can't listen right now")).toHaveCount(0);
    await expect(button(page, 'Quiet')).toHaveCount(0);
    await button(page, 'Quiet on').click();
    const panel = page.locator('#session-quiet-panel');
    await expect(panel.getByRole('button', { name: "Can't listen right now" })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('button', { name: "Can't talk right now" })).toHaveAttribute('aria-pressed', 'false');

    await button(page, 'End').click();
    await expect(primaryAction(page).or(page.getByRole('button', { name: 'Nothing due right now' }))).toBeVisible();
    await page.evaluate(() => { location.hash = '#/session?mode=speaking'; });
    await expect(page.getByText('Say it in Slovenian', { exact: true })).toBeVisible();
    await expect(button(page, 'Listen again')).toBeVisible();
    await expect(button(page, 'Quiet')).toBeVisible();
    await button(page, "Can't talk right now").click();
    await expect(page.getByRole('heading', { name: NOTHING_PLAYED })).toBeVisible();
    await expect(button(page, 'A speaking round')).toHaveCount(0);
  });
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

// Takes its context offline; the update test follows it in a context of its own.
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

// The update flow (Ruling 85): a second version is built from the same tree plus a probe module
// under app/js/, which the dev build lists in precache.json and hashes into the version; the
// server serves the folder live, so the next reload sees the new version.js and precache.json.
test('a new version shows the update toast once and reloads only on Reload', async ({ page }) => {
  removeProbe();
  try {
    await onboard(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    const oldVersion = await page.evaluate(() => /** @type {any} */ (globalThis).SLOVELINGO_VERSION);
    expect(oldVersion).toBe(builtVersion());
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(new RegExp(`\\?v=${oldVersion}$`));

    writeFileSync(PROBE, '// A probe the end-to-end update test writes to make a second version; never committed.\n');
    rebuild();
    const newVersion = builtVersion();
    expect(newVersion).not.toBe(oldVersion);

    // one reload: the page learns the new version, registers the new worker, and the toast shows
    await page.reload();
    await page.evaluate(() => { /** @type {any} */ (window).__slovelingoMarker = 1; });
    const region = page.locator('[role=status]').filter({ hasText: UPDATE_TEXT });
    await expect(region.getByText(UPDATE_TEXT, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (window).__slovelingoMarker)).toBe(1);   // nothing reloaded by itself
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(new RegExp(`\\?v=${oldVersion}$`));
    await expect(page.locator('.toast')).toHaveCount(1);

    // the Reload tap: the waiting worker takes over, the page reloads once into the new version
    const reloaded = page.waitForEvent('load');
    await region.getByRole('button', { name: 'Reload', exact: true }).click();
    await reloaded;
    await page.waitForFunction((version) => /** @type {any} */ (window).__slovelingoMarker === undefined
      && navigator.serviceWorker.controller?.scriptURL.endsWith(`?v=${version}`) === true, newVersion);
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration !== undefined && registration.installing === null && registration.waiting === null;
    });
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).SLOVELINGO_VERSION)).toBe(newVersion);
    const cacheNames = await page.evaluate(() => caches.keys());
    expect(cacheNames.filter((name) => /^slovelingo-(?!audio$)/.test(name))).toEqual([`slovelingo-${newVersion}`]);
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(primaryAction(page)).toBeVisible();
  } finally {
    removeProbe();
  }
});

test.describe('a ten-by-five course', () => {
  test.use({ serviceWorkers: 'block' });
  test('the hive draws fifty regular cells, five per strip, 52 px at 390 and 48 px at 360 with no sideways scroll', async ({ page }) => {
    await serveCourse(page, tenByFive());
    await page.setViewportSize({ width: 390, height: 844 });
    await onboard(page);
    const strip = page.getByRole('link', { name: /Open the hive$/ });
    await expect(strip.locator('.hive-cell')).toHaveCount(5);
    await strip.click();
    await expect(page.getByRole('heading', { name: 'Hive', level: 1 })).toBeVisible();
    await expect(page.locator('.hive-strip')).toHaveCount(10);
    await expect(page.locator('.hive-cell')).toHaveCount(50);
    for (let i = 0; i < 10; i += 1) await expect(page.locator('.hive-strip').nth(i).locator('.hive-cell')).toHaveCount(5);
    await expect(page.locator('.hive-caption')).toHaveText(COURSE_TITLES);
    /** The distance between the centres of the first strip's first two cells, in CSS px. */
    const pitch = async () => {
      const combs = page.locator('.hive-strip').first().locator('.hive-comb');
      const [a, b] = [await combs.nth(0).boundingBox(), await combs.nth(1).boundingBox()];
      if (!a || !b) throw new Error('no cells drawn');
      return b.x + b.width / 2 - (a.x + a.width / 2);
    };
    expect(await pitch()).toBeCloseTo(52, 0);
    const comb = await page.locator('.hive-strip').first().locator('.hive-comb').first().boundingBox();
    if (!comb) throw new Error('no cell drawn');
    expect(comb.height / comb.width).toBeCloseTo(2 / Math.sqrt(3), 1);
    await page.setViewportSize({ width: 360, height: 640 });
    expect(await pitch()).toBeCloseTo(48, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});
