# Style guide

This guide is for the sessions that draft Slovelingo lessons and the sessions that review them. It holds for every level of the course. Numbers that differ by level, such as lessons per unit, items per lesson or lines per dialogue, live in `SYLLABUS.md` and nowhere else.

## Who the course is for

Adult beginners who read English and want to manage everyday life in Slovenia: greeting people, visiting a family, eating with hosts, ordering, shopping, finding the way and making small talk. Many also know some German, so German is offered as a second hook where it helps, never as a requirement. Learners practise a few minutes a day, often on the move and often without sound. They want the rule behind a pattern in one line, not a grammar chapter.

## Levels and the unit shape

Every unit in `units.json` carries its `level` and its `lessonCount`, and every lesson file carries its `role`. A unit has `lessonCount` lessons: theme lessons first, then one consolidation lesson.

- A theme lesson brings new items, the rule cards the grammar order places there, structured input, production and one short dialogue.
- The consolidation lesson comes last and introduces no rule card. It reuses the unit's chunks in a longer dialogue and writes its structured input and production over the whole unit: its production and its dialogue `new_items` practise items of every earlier lesson of the unit, all `lessonCount - 1` of them.

How many items, exercises and lines each role has is set per level in `SYLLABUS.md`.

## Register and the day-one pairs

Production targets standard Slovenian plus the general colloquial standard heard in Ljubljana. Dialect vocabulary is left out. Every item has one register:

- `neutral`: fine anywhere.
- `colloquial`: everyday speech among friends and family.
- `formal`: polite or official settings.
- `recognition`: understood, never asked for in production. `ful`, `kul`, `okej` and `fajn` are recognition only.

Some pairs are taught together because learners hear both from the first day: `ja` and `da`, `a` and `ali`, `živjo` and `čau` next to `dober dan`, `adijo` next to `nasvidenje`. The short colloquial infinitive is heard next to the written one: `delat` is the `sl_colloquial` of `delati`.

## Chunks and slots

The unit of learning is the chunk, a phrase people actually say. A single word becomes an item only after the learner has met it inside a chunk.

A chunk can have slots, places where other words fit: `Lahko dobim kavo, prosim?` has a slot for the drink. Each slot filler is an item of its own with its own verification record, and the slot lists the fillers by id. A production exercise that swaps the filler names it in `filler`, written as it stands in the slot: the filler's `sl` or one of its `forms`. If the filler item is `voda` and the slot takes the accusative, `filler` is `vodo`, and `vodo` is recorded in that item's `forms`. A filler that is not yet accepted keeps its slot and its production out of a strict build.

## The item fields

| Field | What goes in it |
|---|---|
| `id` | `uNN-lNN-iNN`, unique across the course |
| `type` | `chunk`, `word` or `form` |
| `sl` | the standard form, with sentence punctuation when it is a sentence |
| `sl_colloquial` | the form heard in speech when it differs from `sl`, else null |
| `en` | the English gloss, unique across the course |
| `register` | one of the four above |
| `pos`, `gender` | part of speech, and `m`, `f` or `n` for a noun |
| `forms` | every inflected form the course uses, by label |
| `slots` | for a chunk with slots: a label and the filler ids |
| `examples` | one or two sentences with their English |
| `helper` | a cognate, false friend or hook, else null |
| `accept` | other correct answers |
| `rules` | ids of the rule cards the item exercises |
| `freq_rank` | the spoken frequency rank, else null |
| `verification` | the review record, see the last section |

A filled example, a chunk with one slot:

```json
{
  "id": "u04-l01-i01",
  "type": "chunk",
  "sl": "Lahko dobim kavo, prosim?",
  "sl_colloquial": null,
  "en": "Can I have a coffee, please?",
  "register": "neutral",
  "slots": [{ "label": "drink", "fillers": ["u04-l01-i02", "u04-l01-i03"] }],
  "examples": [
    { "sl": "Lahko dobim kavo z mlekom, prosim?", "en": "Can I have a coffee with milk, please?" }
  ],
  "helper": null,
  "accept": [],
  "rules": [],
  "freq_rank": null,
  "verification": { "review1": null, "review2": null, "native": null, "status": "pending" }
}
```

The English gloss must be unambiguous across the course. A word with several senses gets a note in brackets: `orange (the fruit)`, `orange (the colour)`. The linter refuses two items with the same gloss.

English "you" hides what Slovenian marks: `ti` or `vi`, and for two people whether the speaker is one of them (`midva` or `vidva`). Wherever the answer turns on it, the English of a gloss, a structured line or a production instruction says who is meant: "(to a friend)", "(to an older person)", or "you and one other person" rather than "the two of you", which also reads as `vidva`.

A production instruction has one right answer among what the course has taught so far, or its `accept` lists every other one. "Decline politely when offered more" fits `Ne, hvala.`, `Ni treba.` and `Dovolj je.` alike; "Your hosts offer you more. Say no, thank you." asks for the first. No production instruction repeats the English of another word for word, in its own lesson or any other; the consolidation lesson words its own.

## Example sentences

- One or two per item, at most eight words each.
- Natural speech: what someone would say in the situation, not a sentence built to show grammar.
- Each example contains the headword or one of its recorded forms.
- Known words: across a lesson's examples at least 95 percent of the words are known, and across its dialogue lines at least 90 percent.
- Known means taught or met in an earlier lesson in course order (item text, colloquial forms, recorded forms, accepted variants, rule card examples, table forms and pronouns, example sentences, dialogue lines), or taught in this lesson (its items and the rule cards it introduces). In the dialogue, the lesson's own example sentences count as known as well. Numbers written as digits are always known. The first lesson of the course is exempt.
- Words are compared as written, so `kavo` is not known because `kava` is. Record the forms you use.

Before drafting a unit, `node tools/known-words.js --before <first lesson of the unit>` lists the known words. After drafting, `node tools/known-words.js` prints every lesson's shares and fails when one falls short.

## Helper lines

A helper is one line that makes the item stick: a real cognate, a false friend or a transparent hook.

- German first when German helps (`brat`, like Bruder; `noč`, like Nacht), English otherwise.
- A false friend is marked with "not": `gimnazija` is a secondary school, not a gym.
- Never invented. No folk etymology and no forced resemblance. When there is no honest hook, `helper` is null, and the linter's `helper-missing` warning stays.

## Accepted variants

`accept` lists other answers that are also right: a common alternative spelling (`na svidenje` next to `nasvidenje`) or an equally natural phrasing. Every variant is correct Slovenian. Never list the target without its diacritics (`zivjo` for `živjo`): the grader already treats a missing diacritic as a slip and names the letter, and an accept entry would hide that. The grader ignores case and punctuation as well, so those need no variants.

## Gender and forms

Every noun item has its `gender`. `forms` records every inflected form that one of the item's examples, a dialogue line, a production answer or a slot uses, so the grader and the known-word count can find it. The accusative enters with its rule card (unit 3 at A1) and the locative with its card (unit 6 at A1); plural and dual forms are recorded wherever a lesson uses them. Label forms by case and number: `acc`, `loc`, `gen` for the singular, `du` and `pl` for the nominative dual and plural, `acc.pl` and so on for the rest; verbs by person and number, `1sg` to `3pl`. The linter warns (`form-unrecorded`) when an example of a word item uses a form that starts like the headword but is missing from `forms`.

## Frequency rank

`freq_rank` comes from `content/reference/gos-top3000.tsv` (columns `rank`, `lemma`, `pos`, `frequency`). It is set for a word item, or a one-word chunk, whose lemma the list holds. When the lemma is listed under several tags, take the lowest rank. Longer chunks and unlisted lemmas keep null.

## Rule cards

- `card_en` says one idea in at most 40 words.
- `example` is one Slovenian sentence with its English: the pair the card is about.
- A table (`rows`, `cols` and `cells` keyed `<row>.<col>`) or a toggle (one example per option) lets the learner see the pattern change.
- `quick_check` is one question whose `prompt_sl` has exactly one blank, a single run of underscores (`Midva ___ lačna.`, `Pijem kav_`), with the answer among the options and an `explain_en`.
- `helper_de` and `helper_en` contrast the rule with German or English where that helps or misleads.

The app labels the table keys `1`, `2`, `3`, `sg`, `du` and `pl`; any other key shows as written until the app learns it. Every unit task reports the keys outside that set with the rule-table keys command and puts its output in the commit body.

## Dialogues

- The number of lines per lesson role is in `SYLLABUS.md`.
- Speakers: `you` (the learner), `host`, `waiter`, `clerk`, `passer-by`, `colleague`.
- `setting_en` sets the scene in English, generically: "your hosts", "a café", "an older person".
- Every line has at most 60 characters and 10 words, so it can be typed.
- `new_items` on a line names the items that line practises.

## Standing alone without sound or speech

A lesson works with the sound off and without speaking. Its typed, structured and production material carries it on its own; listening and perception draw only on the lesson's own items; nothing the learner needs is ever only heard; and every dialogue line is short enough to type.

## What is excluded

- Dialect vocabulary.
- Slang in production; slang is at most `recognition`.
- Personal framing: no named relationship, no partner or particular family. Write "your hosts" or "an older person".
- Names of real people.
- Exclamation marks in system text, em dashes and labels in capitals. English copy is in sentence case.

## The verification record

Every item carries `verification`: `review1` and `review2` (`accepted`, `doubtful`, `rejected`, or null before review), `native` (`confirmed`, `corrected`, or null) and `status`, which follows from the others:

- a native verdict gives `accepted`;
- two `accepted` reviews give `accepted`;
- a `rejected` review gives `rejected`;
- anything else gives `pending`.

The verdicts mean:

- `accepted`: it would pass unnoticed with a native speaker.
- `doubtful`: possibly wrong or odd. The item waits on the native list and is not practised until a native speaker has looked at it.
- `rejected`: wrong. The item is rewritten and reviewed again. From the second review round on, a rejection is held as a doubt, so the item goes to a native speaker instead of a third rewrite.

A draft starts with `{ "review1": null, "review2": null, "native": null, "status": "pending" }`. Only accepted items are practised in a strict build. Any later change to an item's Slovenian text sends it back to nulls and `pending`: the review guard refuses accepted text that differs from what the reviewers saw.
