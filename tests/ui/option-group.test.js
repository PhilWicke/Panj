// tests/ui/option-group.test.js
// The pick-one options that structured input, the listening meaning pick and the perception drill
// share, through the fake DOM: one button per option in the order given, classed and labelled as
// asked; the first pick locks every button, marks the answer right and a wrong pick wrong, and
// calls onPick once; the feedback shows "Correct." or "Not quite." above the exercise's own lines;
// Continue takes the focus and hands the pick back.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fake-dom.js';
import { h } from '../../app/js/util/dom.js';
import { optionGroup } from '../../app/js/ui/components/option-group.js';

/** @type {ReturnType<typeof installFakeDom>} */
let document;

before(() => {
  document = installFakeDom();
});

/**
 * A group over sem, si, je with si as the answer, recording its picks and continues.
 * @param {Partial<import('../../app/js/ui/components/option-group.js').OptionGroupOptions>} [fields]
 */
function build(fields = {}) {
  /** @type {[string, boolean][]} */
  const picks = [];
  /** @type {[string, boolean][]} */
  const continues = [];
  const parts = optionGroup({
    options: ['sem', 'si', 'je'],
    answer: 'si',
    label: 'Options',
    onPick: (choice, correct) => {
      picks.push([choice, correct]);
      return !correct && h('p', null, 'The answer is si.');
    },
    onContinue: (choice, correct) => continues.push([choice, correct]),
    ...fields,
  });
  const any = /** @type {any} */ (parts);
  return { group: any.group, buttons: /** @type {any[]} */ (any.buttons), result: any.result, actions: any.actions, picks, continues };
}

test('optionGroup builds one button per option in the order given, in a labelled group, with an empty result and actions', () => {
  const plain = build();
  assert.equal(plain.group.className, 'options');
  assert.equal(plain.group.getAttribute('role'), 'group');
  assert.equal(plain.group.getAttribute('aria-label'), 'Options');
  assert.deepEqual(plain.group.childNodes, plain.buttons, 'the buttons are the group');
  assert.deepEqual(plain.buttons.map((button) => button.textContent), ['sem', 'si', 'je']);
  for (const button of plain.buttons) {
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.getAttribute('type'), 'button');
    assert.equal(button.className, 'btn btn-secondary option');
    assert.equal(button.getAttribute('lang'), null, 'no lang unless asked');
    assert.ok(!button.disabled);
  }
  assert.equal(plain.result.className, 'pick-result');
  assert.equal(plain.result.getAttribute('aria-live'), 'polite');
  assert.equal(plain.result.childNodes.length, 0);
  assert.equal(plain.actions.className, 'actions');
  assert.equal(plain.actions.childNodes.length, 0);

  const sl = build({ lang: 'sl', large: true, label: 'Words' });
  assert.equal(sl.group.getAttribute('aria-label'), 'Words');
  for (const button of sl.buttons) {
    assert.equal(button.className, 'btn btn-secondary option option-sl', 'Slovenian options set larger');
    assert.equal(button.getAttribute('lang'), 'sl');
  }
  assert.equal(build({ stacked: true }).group.className, 'options actions-stack', 'one option per row');
});

test('optionGroup: a wrong pick locks the options, marks the answer right and the pick wrong, and shows the feedback with Continue', () => {
  const group = build();
  const [sem, si, je] = group.buttons;
  je.dispatch('click');
  assert.deepEqual(group.picks, [['je', false]]);
  assert.ok(group.buttons.every((button) => button.disabled === true), 'every option is locked');
  assert.ok(si.classList.contains('option-right'));
  assert.ok(je.classList.contains('option-wrong'));
  assert.ok(!sem.classList.contains('option-right') && !sem.classList.contains('option-wrong'), 'the others stay unmarked');
  assert.ok(!si.classList.contains('option-wrong') && !je.classList.contains('option-right'));

  const [panel] = group.result.childNodes;
  assert.equal(panel.tagName, 'SECTION');
  assert.equal(panel.className, 'feedback feedback-wrong');
  assert.equal(panel.childNodes[0].className, 'feedback-headline');
  assert.equal(panel.childNodes[0].textContent, 'Not quite.');
  assert.equal(panel.childNodes[1].textContent, 'The answer is si.', "the exercise's own lines follow the headline");

  assert.equal(group.actions.childNodes.length, 1);
  const [next] = group.actions.childNodes;
  assert.equal(next.textContent, 'Continue');
  assert.equal(next.className, 'btn btn-primary');
  assert.equal(document.activeElement, next, 'Continue takes the focus');

  sem.dispatch('click');
  si.dispatch('click');
  assert.deepEqual(group.picks, [['je', false]], 'only the first pick counts');
  assert.equal(group.actions.childNodes.length, 1, 'and only one Continue');
  assert.ok(!sem.classList.contains('option-wrong'));

  assert.deepEqual(group.continues, []);
  next.dispatch('click');
  assert.deepEqual(group.continues, [['je', false]], 'Continue hands the pick back');
});

test('optionGroup: the right pick is marked right, nothing is marked wrong, and the feedback says correct', () => {
  const group = build();
  const [sem, si, je] = group.buttons;
  si.dispatch('click');
  assert.deepEqual(group.picks, [['si', true]]);
  assert.ok(si.classList.contains('option-right'));
  assert.ok(![sem, si, je].some((button) => button.classList.contains('option-wrong')));
  const [panel] = group.result.childNodes;
  assert.equal(panel.className, 'feedback feedback-correct');
  assert.equal(panel.textContent, 'Correct.', 'onPick added nothing for a right pick');
  group.actions.childNodes[0].dispatch('click');
  assert.deepEqual(group.continues, [['si', true]]);
});
