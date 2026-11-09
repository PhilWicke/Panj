// tests/ui/answer-field.test.js
// The typed answer field the typed recall, the slot production and the dialogue's learner lines
// share: the input is set up for Slovenian, the label names it, Enter or "Check" submits a
// non-blank answer as typed, "I don't know" submits an empty one, and the field answers once and
// then locks. The feedback goes into a slot that is a polite live region from the start (a region
// that arrives with its text is not read out), or a plain slot inside a live region that is there
// already; the panel is no live region of its own and its marked action takes the focus. The rest
// of the panel runs in the browser check.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { grade } from '../../app/js/engine/grading.js';
import { answerField, feedbackSlot, mountFeedback } from '../../app/js/ui/components/answer-field.js';

/** @type {ReturnType<typeof installFakeDom>} */
let document;

before(() => {
  document = installFakeDom();
});

/** The field's parts, through the fake DOM. @param {{ form: HTMLElement, input: HTMLInputElement }} field */
function parts({ form, input }) {
  const el = /** @type {any} */ (form);
  const [label, field, buttons] = el.childNodes;
  const [check, dontKnow] = buttons.childNodes;
  let prevented = 0;
  const submit = () => {
    for (const listener of el.listeners.get('submit') ?? []) listener({ type: 'submit', preventDefault: () => { prevented += 1; } });
  };
  return { el, label, field, buttons, check, dontKnow, input: /** @type {any} */ (input), submit, prevented: () => prevented };
}

test('answerField builds the input set up for Slovenian, labelled, with Check and "I don\'t know"', () => {
  const field = parts(answerField({ id: 'answer-u01-l01-i03', label: 'Your answer in Slovenian', onAnswer: () => {} }));
  assert.equal(field.el.tagName, 'FORM');
  assert.equal(field.el.className, 'answer-form');
  assert.equal(field.field, field.input, 'the input sits between the label and the buttons');
  assert.equal(field.input.tagName, 'INPUT');
  assert.equal(field.input.className, 'answer-input');
  assert.deepEqual(Object.fromEntries(field.input.attributes), {
    id: 'answer-u01-l01-i03', type: 'text', lang: 'sl', autocapitalize: 'off', autocomplete: 'off',
    autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done',
  });
  assert.equal(field.label.tagName, 'LABEL');
  assert.equal(field.label.className, 'visually-hidden');
  assert.equal(field.label.getAttribute('for'), 'answer-u01-l01-i03');
  assert.equal(field.label.textContent, 'Your answer in Slovenian');
  assert.equal(field.buttons.className, 'actions');
  assert.equal(field.check.getAttribute('type'), 'submit');
  assert.equal(field.check.className, 'btn btn-primary');
  assert.equal(field.check.textContent, 'Check');
  assert.equal(field.dontKnow.getAttribute('type'), 'button');
  assert.equal(field.dontKnow.className, 'btn btn-quiet');
  assert.equal(field.dontKnow.textContent, "I don't know");
});

test('answerField submits a non-blank answer as typed, once, and then locks', () => {
  /** @type {string[]} */
  const answers = [];
  const field = parts(answerField({ id: 'answer-x', label: 'Your line in Slovenian', onAnswer: (answer) => answers.push(answer) }));
  field.input.value = '   ';
  field.submit();
  assert.deepEqual(answers, [], 'Enter on a blank field does nothing');
  assert.equal(field.prevented(), 1, 'the form never navigates');
  assert.ok(!field.input.readOnly && !field.buttons.hidden, 'and leaves the field open');

  field.input.value = ' Dober vecer ';
  field.submit();
  assert.deepEqual(answers, [' Dober vecer '], 'the answer goes to grading as typed');
  assert.equal(field.input.readOnly, true);
  assert.equal(field.buttons.hidden, true);

  field.input.value = 'Dober večer.';
  field.submit();
  field.dontKnow.dispatch('click');
  assert.deepEqual(answers, [' Dober vecer '], 'a locked field answers no more');
});

test('answerField\'s "I don\'t know" submits an empty answer and locks', () => {
  /** @type {string[]} */
  const answers = [];
  const field = parts(answerField({ id: 'answer-y', label: 'Your answer in Slovenian', onAnswer: (answer) => answers.push(answer) }));
  field.dontKnow.dispatch('click');
  assert.deepEqual(answers, ['']);
  assert.equal(field.input.readOnly, true);
  assert.equal(field.buttons.hidden, true);
  field.input.value = 'Hvala.';
  field.submit();
  assert.deepEqual(answers, ['']);
});

test('feedbackSlot is an empty polite live region, or a plain slot inside a live region that is there already', () => {
  const slot = /** @type {any} */ (feedbackSlot());
  assert.equal(slot.tagName, 'DIV');
  assert.equal(slot.className, 'feedback-slot');
  assert.equal(slot.getAttribute('aria-live'), 'polite');
  assert.equal(slot.childNodes.length, 0);
  const inner = /** @type {any} */ (feedbackSlot({ live: false }));
  assert.equal(inner.className, 'feedback-slot');
  assert.equal(inner.getAttribute('aria-live'), null);
});

test('mountFeedback fills the slot the exercise made, the panel is no live region of its own, and its action takes the focus', () => {
  const slot = /** @type {any} */ (feedbackSlot());
  let done = 0;
  const panel = /** @type {any} */ (mountFeedback(slot, {
    answer: 'xyz', graded: grade('xyz', 'Hvala.'), effective: 'wrong', target: 'Hvala.', rule: null, onDone: () => { done += 1; },
  }));
  assert.deepEqual(slot.childNodes, [panel], 'the panel goes into the slot that was there before the answer');
  assert.equal(slot.getAttribute('aria-live'), 'polite');
  assert.equal(panel.getAttribute('aria-live'), null, 'no live region inside the live region');
  assert.equal(panel.className, 'feedback feedback-wrong');
  assert.equal(document.activeElement?.textContent, 'Type it again', 'after a miss the retry takes the focus');
  assert.equal(done, 0);
});
