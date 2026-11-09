// tests/ui/session-speech.test.js
// The session screen with the real speaking exercise and a fake Web Speech recogniser, so the
// microphone's life can be watched: once the learner has tapped Speak, "Can't talk right now"
// (which skips the exercise), "Can't listen right now" (which draws it again without sound) and
// leaving the screen each abort the recogniser at once, long before recognizeOnce's own timeout.
// tests/ui/session-screen.test.js registers fake exercises for every kind it plays, speaking
// among them, so the real exercise runs in this file of its own.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { elements } from '../helpers/dom-query.js';
import { skipAheadState } from '../../app/js/engine/scheduler.js';
import { createMemoryStore } from '../../app/js/store/memory.js';
import { DEFAULT_APP_SETTINGS } from '../../app/js/store/state.js';
import { register } from '../../app/js/ui/exercises/registry.js';
import { render as speaking } from '../../app/js/ui/exercises/speaking.js';
import { resetQuiet } from '../../app/js/ui/quiet.js';
import { renderSession } from '../../app/js/ui/screens/session.js';

/** @type {ReturnType<typeof installFakeDom>} */
let document;
const STUBBED = ['location', 'SpeechRecognition', 'webkitSpeechRecognition'];
const originals = new Map(STUBBED.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

/** Every recogniser constructed, with how often it was started and aborted. @type {any[]} */
const recognisers = [];
class FakeRecognition {
  constructor() {
    this.started = 0;
    this.aborted = 0;
    /** @type {any} */ this.onresult = null;
    /** @type {any} */ this.onerror = null;
    /** @type {any} */ this.onend = null;
    recognisers.push(this);
  }

  start() {
    this.started += 1;
  }

  abort() {
    this.aborted += 1;
  }
}

before(() => {
  document = installFakeDom();
  Object.defineProperty(globalThis, 'location', { value: { hash: '', replace() {} }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'SpeechRecognition', { value: undefined, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
  register('speaking', speaking);
});

after(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (/** @type {Record<string, unknown>} */ (globalThis))[name];
  }
});

beforeEach(() => {
  recognisers.length = 0;
  resetQuiet();
});

const DAY = 86_400_000;
const NOW = Date.now();
const IDS = ['u01-l01-i01', 'u01-l01-i02', 'u01-l01-i03'];

/** An app with three review items, sound and speech recognition on, and a player that has audio. */
function speakingApp() {
  return /** @type {any} */ ({
    adapter: createMemoryStore(),
    persistent: true,
    state: {
      items: Object.fromEntries(IDS.map((id) => [id, skipAheadState(id, NOW - DAY)])),
      sessions: [],
      settings: { ...DEFAULT_APP_SETTINGS, mute: false, speech: true, onboarded: true },
      flags: [],
      meta: { schemaVersion: 1, createdAt: NOW },
    },
    index: { version: 't', mode: 'dev', generated: '', units: [], rules: [], lessonIndex: [], counts: { scheduledItems: IDS.length, lemmasMet: 0 } },
    units: [],
    known: new Set(IDS),
    items: new Map(IDS.map((id) => [id, { item: { id, type: 'chunk', sl: `sl ${id}`, en: `en ${id}`, register: 'neutral', examples: [] }, lesson: null }])),
    lessons: new Map(),
    rules: new Map(),
    allowPending: false,
    player: { play: async () => 'none', stop() {}, setMute() {}, setVoice() {}, audioAvailable: async () => true },
  });
}

/** The button under `root` that reads `text`. @param {any} root @param {string} text */
const button = (root, text) => elements(root).find((el) => el.tagName === 'BUTTON' && el.textContent === text);
/** Lets the screen's handlers, and the store promises they wait on, finish; far shorter than recognizeOnce's 6 s timeout. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/**
 * Starts a speaking round, taps Speak and returns the screen, its cleanup and the recogniser
 * listening now.
 */
async function listening() {
  const container = /** @type {any} */ (document.createElement('main'));
  const leave = renderSession(container, speakingApp(), { mode: 'speaking' });
  await settle();
  const speak = button(container, 'Speak');
  assert.ok(speak, 'the recognised speaking exercise is showing');
  speak.dispatch('click');
  await settle();
  assert.equal(recognisers.length, 1);
  assert.deepEqual([recognisers[0].started, recognisers[0].aborted], [1, 0], 'the recogniser listens');
  return { container, leave, live: recognisers[0] };
}

test("\"Can't talk right now\" after Speak stops the recogniser at once", async () => {
  const { container, live } = await listening();
  button(container.querySelector('.quiet-offer'), "Can't talk right now").dispatch('click');
  await settle();
  assert.equal(live.aborted, 1, 'aborted, not left to its timeout');
  assert.ok(container.querySelector('.closing-menu'), 'the speaking round is skipped to its end');
});

test("\"Can't listen right now\" after Speak draws the exercise again and stops the recogniser at once", async () => {
  const { container, live } = await listening();
  const quiet = button(container.querySelector('.session-bar'), 'Quiet');
  quiet.dispatch('click');
  button(container.querySelector('.quiet-panel'), "Can't listen right now").dispatch('click');
  await settle();
  assert.equal(live.aborted, 1, 'aborted, not left to its timeout');
  assert.ok(button(container, 'Speak'), 'the exercise is drawn again');
  assert.equal(recognisers.length, 1, 'and nothing listens until Speak is tapped again');
});

test('leaving the screen after Speak stops the recogniser at once', async () => {
  const { leave, live } = await listening();
  leave();
  await settle();
  assert.equal(live.aborted, 1, 'aborted, not left to its timeout');
});
