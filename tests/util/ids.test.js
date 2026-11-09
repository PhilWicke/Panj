// tests/util/ids.test.js
// Rule ids share the item states with the lesson items (a rule's quick check is scheduled under
// the rule's id), so the session builder, the progress counters and the content linter all tell
// the two apart with the one pattern that lives in app/js/util/ids.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULE_ID, isRuleId } from '../../app/js/util/ids.js';

test('isRuleId accepts r- ids and rejects item ids', () => {
  assert.ok(isRuleId('r-biti-present')); assert.ok(RULE_ID.test('r-ti-vi'));
  assert.equal(isRuleId('u01-l01-i01'), false); assert.equal(isRuleId('R-x'), false);
  // the whole id: r-, then lowercase letters, digits and hyphens
  assert.ok(isRuleId('r-2nd-person') && isRuleId('r-a') && isRuleId('r-a-'));
  for (const bad of ['r-', 'r', 'ur-x', 'r-x ', ' r-x', 'r-x\n', 'r-živjo', 'r_x', 'r-x.y', '', 'u01-l01-d', 'u01-l01-s01']) {
    assert.equal(isRuleId(bad), false, JSON.stringify(bad));
  }
  assert.ok(RULE_ID instanceof RegExp);
  assert.equal(RULE_ID.source, '^r-[a-z0-9-]+$');
  assert.equal(RULE_ID.flags, '', 'no global flag, so test() keeps no lastIndex between calls');
  assert.equal(isRuleId('r-a'), isRuleId('r-a'), 'the same answer twice in a row');
});
