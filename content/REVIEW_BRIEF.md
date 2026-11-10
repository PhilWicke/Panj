# Review brief

You are one of two reviewers of a unit of Panj, a Slovenian course for English-speaking beginners. The other reviewer works on the same unit at the same time, and neither of you sees the other's verdicts. You receive this brief, `STYLE_GUIDE.md`, the unit's lesson files and the rule cards those lessons introduce, and nothing else. Judge the whole unit: the last lesson of a unit reuses the items of the earlier ones.

The rule: never edit a lesson or a rule card. You only report.

## What to judge for each item

Every item of every lesson, field by field:

- `sl`: standard spelling and diacritics, a real word or phrase in current use, in its citation form (nominative singular for a noun, infinitive for a verb, unless the item is a chunk or a form).
- `sl_colloquial`: really heard in everyday Ljubljana speech, and tagged as colloquial rather than written standard.
- `en`: accurate and unambiguous. A gloss with several senses, such as `orange`, `second` or `light`, needs a note in brackets.
- `register`: the right one of `neutral`, `colloquial`, `formal` and `recognition`.
- `gender`: correct for a noun.
- `forms`: correct endings, each under the right label.
- `examples`: grammatical, natural, translated faithfully, and containing the headword or one of its listed forms.
- `helper`: a true cognate or false friend, or an honest hook. No folk etymology.
- `accept`: every variant is correct Slovenian.

One verdict covers the whole item. If any field is wrong, the item is not accepted; name the field in your reason.

## What to judge for each line

Each structured exercise, each production exercise, each dialogue line and each rule card the lesson introduces: its Slovenian, and the English beside it. For a structured exercise that means the prompt, the options and the answer (exactly one option is right); for a production exercise the answer, its accepted variants and the instruction; for a rule card the example, the table forms and pronouns, the toggle examples, the quick check and the card text.

## Verdicts

- `accepted`: it would pass unnoticed with a native speaker.
- `doubtful`: possibly wrong or odd. Name the doubt in `reason`.
- `rejected`: wrong. Say what is wrong in `reason` and give the corrected Slovenian in `fix`.

Use `doubtful` when you are unsure rather than guessing either way. A doubtful item waits for a native speaker; it is not practised until then.

## Lookups

Look up any doubt about a form or a usage. Use only these two pages:

- `https://fran.si/iskanje?View=1&Query=<word>` (SSKJ, Pravopis and the other Fran dictionaries)
- `https://en.wiktionary.org/wiki/<word>`

At most 15 lookups per lesson, and no web searches. When a lookup decides a verdict, put its URL in `source`.

## Output

Return one half per lesson: a JSON object that judges every item and every line key of that lesson, and nothing else.

```json
{
  "reviewer": "review1",
  "lookups": 3,
  "items": {
    "<item id>": { "verdict": "accepted", "reason": "<why>", "fix": "", "source": "" },
    "<item id>": { "verdict": "doubtful", "reason": "<the doubt>", "fix": "", "source": "<lookup URL>" }
  },
  "lines": {
    "<structured id>": { "verdict": "accepted", "reason": "<why>", "fix": "", "source": "" },
    "<production id>": { "verdict": "rejected", "reason": "<what is wrong>", "fix": "<the corrected Slovenian>", "source": "<lookup URL>" },
    "<dialogue id>-01": { "verdict": "accepted", "reason": "<why>", "fix": "", "source": "" },
    "<rule id>": { "verdict": "accepted", "reason": "<why>", "fix": "", "source": "" }
  }
}
```

- `reviewer` is `review1` or `review2`, as your task names it. `lookups` is the number of lookups you made for this lesson.
- `items` has one entry per item id of the lesson.
- `lines` has one entry per line key, named this way: each structured exercise and each production exercise by its id; each dialogue line as the dialogue id, a hyphen and its 1-based position in two digits (`u01-l01-d-01`, `u01-l01-d-02`, and so on); each rule card the lesson lists in `rules` by its rule id.
- Every entry has `verdict` and `reason`. `fix` is required for `rejected` and may be empty otherwise; `source` may be empty.

A key you leave out or invent makes the review unusable, so check that every item and every line of the lesson has exactly one entry.
