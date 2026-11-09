// Rule ids. A rule card's id is `r-` followed by lowercase letters, digits and hyphens
// (content/types.js), a lesson item's is `uNN-lNN-iNN`. Rules share the item states with the
// lesson items (a rule's quick check is a scheduled item whose id is the rule id), so the session
// builder, the progress counters and the content linter all need to tell the two apart, and this
// is the one place the pattern lives (Ruling 27).

/** The shape of a rule id, anchored to the whole string and without flags, so `test` is stateless. */
export const RULE_ID = /^r-[a-z0-9-]+$/;

/**
 * @param {string} id an item or rule id
 * @returns {boolean} whether `id` names a rule
 */
export function isRuleId(id) {
  return RULE_ID.test(id);
}
