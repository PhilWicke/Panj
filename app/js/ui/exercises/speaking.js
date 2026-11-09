// Speaking (spec 4.2): the item's line, said aloud. With speech recognition switched on
// (settings.speech, the learner's opt-in) and present in the browser, "Speak" listens once and the
// transcript is compared with the line and its accepted variants: a match is a correct recall; a
// first try that does not match gets one more, with what was heard ("Heard: ..."), and a second
// that does not match is a missed recall. Silence or the timeout lets the learner speak again
// without using up the try; a second silence in a row turns this exercise self-rated, so it never
// holds the learner. Any other recogniser error turns the exercise self-rated without a dialog. A
// refused microphone or speech service, a missing microphone or a recogniser without Slovenian
// also keeps the later speaking exercises self-rated until the next session (recognitionBlocked in
// speech.js); a lost connection or a recogniser that would not start affects this exercise only.
// Self-rated (recognition off, unavailable or failed): the model plays, "Say it, then tap", and
// "Matched" or "Not yet" report `aux` only, never a recall. A recogniser is never constructed
// unless the learner has opted in.

import { h, mount } from '../../util/dom.js';
import { compareSpoken, recognitionBlocked, recognizeOnce, speechAvailable } from '../../audio/speech.js';

/** @typedef {import('./registry.js').ExerciseRender} ExerciseRender */
/** @typedef {import('./registry.js').ExerciseOutcome} ExerciseOutcome */
/** @typedef {import('../../content/types.js').Item} Item */
/** @typedef {'match'|'close'|'miss'} Verdict */

/** Tries a recognised answer gets: the first, and one more when it does not match. */
const ATTEMPTS = 2;
/** Recogniser errors after which the learner can simply speak again; any other turns this exercise self-rated. */
const TRY_AGAIN = new Set(['no-speech', 'timeout', 'aborted']);
/** @type {Record<Verdict, number>} */
const RANK = { match: 0, close: 1, miss: 2 };
const FALLBACK_NOTICE = 'Speech recognition is not available here, so you rate yourself.';
const FAILED_NOTICE = 'Speech recognition did not work this time, so you rate this one yourself.';
const SILENCE_NOTICE = 'Nothing was heard, so you rate this one yourself.';

/**
 * What a recognised try leads to: a correct recall on a match; another try when it does not
 * match and tries are left; a missed recall otherwise.
 * @param {Verdict} verdict
 * @param {number} attempt 1 for the first try
 * @returns {'correct'|'retry'|'wrong'}
 */
export function attemptOutcome(verdict, attempt) {
  if (verdict === 'match') return 'correct';
  return attempt < ATTEMPTS ? 'retry' : 'wrong';
}

/**
 * Whether a recogniser error turns this exercise self-rated (a refused microphone, no microphone,
 * no connection to the speech service, no recogniser, a failed start, an unknown error); silence,
 * the timeout and an abort only mean the learner can speak again. Whether later exercises stay
 * self-rated is speech.js's recognitionBlocked.
 * @param {string|null} error as recognizeOnce reports it
 * @returns {boolean}
 */
export function recognitionFallsBack(error) {
  return !TRY_AGAIN.has(error ?? '');
}

/**
 * How a transcript compares with the item: compareSpoken against its form and every accepted
 * variant, the best verdict counting, as a typed answer is graded against them all.
 * @param {string} transcript
 * @param {Item} item
 * @returns {Verdict}
 */
export function spokenVerdict(transcript, item) {
  return [item.sl, ...(item.accept ?? [])]
    .map((target) => compareSpoken(transcript, target))
    .reduce((best, verdict) => (RANK[verdict] < RANK[best] ? verdict : best));
}

/**
 * @param {string} transcript
 * @returns {HTMLElement}
 */
function heard(transcript) {
  return h('p', null, 'Heard: ', h('span', { lang: 'sl', class: 'quick-check-answer' }, transcript));
}

/** @type {ExerciseRender} */
export function render(container, entry, ctx) {
  const item = ctx.item;
  if (!item) return Promise.resolve({});
  return new Promise((resolve) => {
    let done = false;
    /** @param {ExerciseOutcome} outcome */
    const finish = (outcome) => {
      if (done) return;
      done = true;
      resolve(outcome);
    };

    /** The line, its English, and a button that plays the model (none when muted). */
    const header = () => {
      const line = h('h2', { class: 'sl-display', lang: 'sl', tabindex: '-1' }, item.sl);
      const voiceNote = h('p', { class: 'quiet', hidden: true }, 'Slovenian audio is not available on this device yet.');
      const listen = ctx.mode.mute ? null : /** @type {HTMLButtonElement} */ (h('button', {
        type: 'button', class: 'btn btn-secondary', onclick: () => { void model(); },
      }, 'Listen'));
      const model = async () => {
        const how = await ctx.play(item.sl);
        if (how === 'none' && listen) {
          listen.disabled = true;
          voiceNote.hidden = false;
        }
      };
      const nodes = [
        h('p', { class: 'eyebrow' }, 'Say it in Slovenian'),
        line,
        h('p', { class: 'en-text' }, item.en),
        listen && h('div', { class: 'tools' }, listen),
        voiceNote,
      ];
      return { line, listen, voiceNote, model, nodes };
    };

    /** @param {string|null} notice why the learner rates this one, when recognition was meant to judge it */
    const selfRated = (notice) => {
      const { line, listen, model, nodes } = header();
      if (listen) listen.textContent = 'Listen again';
      mount(container, h('article', { class: 'exercise exercise-speaking' },
        nodes,
        notice && h('p', { class: 'quiet' }, notice),
        h('p', { class: 'prompt-en' }, 'Say it, then tap.'),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => finish({ aux: { kind: 'speaking', correct: true } }) }, 'Matched'),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => finish({ aux: { kind: 'speaking', correct: false } }) }, 'Not yet'))));
      line.focus();
      if (listen) void model();
    };

    const recognised = () => {
      const { listen, voiceNote, nodes } = header();
      const status = h('div', { 'aria-live': 'polite' });
      const actions = h('div', { class: 'actions' });
      const speak = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { void attempt(); } }, 'Speak'));
      let tries = 1;
      let silences = 0;
      /**
       * While the recogniser listens, nothing else may play or start; Listen stays off once it found no audio.
       * @param {boolean} busy
       */
      const hold = (busy) => {
        speak.disabled = busy;
        if (listen && voiceNote.hidden) listen.disabled = busy;
      };

      const attempt = async () => {
        hold(true);
        status.replaceChildren(h('p', { class: 'quiet' }, 'Listening…'));
        const { transcript, error } = await recognizeOnce({ lang: 'sl-SI' });
        if (done) return;
        if (transcript === null) {
          if (recognitionFallsBack(error)) {
            selfRated(recognitionBlocked() ? FALLBACK_NOTICE : FAILED_NOTICE);
            return;
          }
          silences += 1;
          if (silences >= ATTEMPTS) {
            selfRated(SILENCE_NOTICE);
            return;
          }
          status.replaceChildren(h('p', null, 'Nothing was heard. Tap Speak and say it again.'));
          hold(false);
          speak.focus();
          return;
        }
        silences = 0;
        const verdict = spokenVerdict(transcript, item);
        const next = attemptOutcome(verdict, tries);
        if (next === 'retry') {
          tries += 1;
          status.replaceChildren(
            h('p', { class: 'feedback-headline' }, verdict === 'close' ? 'Close. Try once more.' : 'Not quite. Try once more.'),
            heard(transcript));
          hold(false);
          speak.focus();
          return;
        }
        const effective = ctx.effective(item.id, next);
        const missed = effective === 'wrong';
        status.replaceChildren(h('section', { class: `feedback feedback-${missed ? 'wrong' : 'correct'}` },
          h('p', { class: 'feedback-headline' }, missed ? 'Not a match this time.' : 'That matched.'),
          heard(transcript),
          missed && h('div', { class: 'feedback-row' },
            h('span', { class: 'feedback-label' }, 'The line'),
            h('span', { class: 'sl-display feedback-form', lang: 'sl' }, item.sl))));
        const proceed = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => finish({ itemId: item.id, recall: next }) }, 'Continue');
        actions.replaceChildren(proceed);
        hold(false);
        proceed.focus();
      };

      actions.append(speak);
      mount(container, h('article', { class: 'exercise exercise-speaking' }, nodes, status, actions));
      speak.focus();
    };

    // The opt-in comes first: without it nothing below may construct a recogniser.
    if (ctx.settings.speech && speechAvailable() && !recognitionBlocked()) recognised();
    else selfRated(ctx.settings.speech ? FALLBACK_NOTICE : null);
  });
}
