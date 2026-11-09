# Content pipeline

The procedure every unit follows, from draft to commit. Each step runs in fresh sessions, so no session judges its own work. Commands run from the repository root.

## 1. Draft

One fresh drafting session per unit receives:

- `STYLE_GUIDE.md`;
- the unit's section of `SYLLABUS.md`;
- `content/reference/gos-top3000.tsv`;
- the `id` and `sl` of every item in earlier lessons;
- the output of `node tools/known-words.js --before <first lesson of the unit>`;
- the rule cards to write.

It writes the theme lessons in order and the consolidation lesson last. Every item's `verification` is `{ "review1": null, "review2": null, "native": null, "status": "pending" }`.

The draft is done when `node tools/lint-content.js --allow-pending` exits 0 and `node tools/known-words.js` reports no lesson of the unit under its share.

## 2. Review round 1

Two fresh reviewer sessions run in parallel, `review1` and `review2`. Each receives `REVIEW_BRIEF.md`, `STYLE_GUIDE.md`, the unit's lesson files and the rule cards they introduce, and nothing else. They judge the unit, not single lessons, because the consolidation lesson reuses the whole unit. Each returns one half per lesson.

The Workflow script, never a reviewer, writes both halves of a lesson into `content/reviews/<lesson>.review.json`:

```json
{ "lesson": "<lesson>", "reviews": [ <review1 half>, <review2 half> ] }
```

Then, for each lesson:

```
node tools/apply-review.js content/lessons/<lesson>.json
```

It merges the verdicts by rule (two accepts accept, a doubt holds the item pending, a reject rejects it), puts every doubted item on `NATIVE_LIST.md`, records the fingerprint of every judged entry in the review file, and prints the counts and one `FLAGGED <key>` line for each line the two halves do not both accept. It refuses a review with an unknown key, a key judged by one half only, or a later round already on file, and then writes nothing.

## 3. Rewrite rounds

A fresh drafting session receives both reviews of every rejected item and every flagged line, and rewrites only those. A rewritten item's `verification` goes back to nulls and `pending`.

Two fresh reviewers judge only the rewritten entries. The script writes their halves to `content/reviews/<lesson>.r2.review.json` and applies them:

```
node tools/apply-review.js content/lessons/<lesson>.json --round 2
```

From round 2 on, a rejected item is held as a doubt and waits on the native list with its fix.

A line still flagged gets one more rewrite and round 3 (`<lesson>.r3.review.json`, `--round 3`). After round 3, a structured or production exercise still flagged is deleted when its lesson keeps the minimum its level's shape asks for (`SHAPES` in `tests/content/shapes.js`; in a consolidation lesson that includes drawing on every earlier lesson of the unit). Any other line still flagged stops the task with a report to the controller.

## 4. Consistency pass

One fresh session reads the unit together with the earlier units and checks:

- duplicate and near-duplicate items;
- register consistency;
- helper consistency (the same German word spelled the same way);
- forms recorded;
- known-word shares;
- rule cards of at most 40 words;
- unambiguous glosses;
- generic English.

It may edit English text and metadata directly. Any change to Slovenian text, meaning anything `slFingerprint` in `tools/review-guard.js` covers, resets that item's `verification` to nulls and `pending` and sends the changed entries through the next review round before the gates. `node tools/review-guard.js` refuses accepted text that changed after its review.

## 5. Gates

The commands each unit task lists.

## 6. Report

In the commit body:

- lessons, items, accepted, pending;
- lookups used and review rounds;
- lines deleted;
- the three most common findings (a finding that repeats in two units goes into `STYLE_GUIDE.md`);
- the rule-table keys outside `LABELS`.
