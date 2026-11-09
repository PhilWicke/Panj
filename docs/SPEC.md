# Slovelingo technical summary

Slovelingo is an installable web app for learning everyday Slovenian in short daily sessions.

## What it teaches

The course covers A1 Slovenian for everyday conversation, in ten units from first contact and family to work and study. It teaches standard forms, notes the common colloquial forms heard in daily speech and puts no emphasis on any dialect.

Each unit has the number of lessons its content sets, five at A1, and the last one consolidates: it practises the unit's earlier items through structured choices and production, mixed in with a few new items of its own. Units carry their level, so a later level adds units and lessons without changes to the app.

## Learning model

Typed recall comes first: the learner writes the Slovenian from an English prompt rather than picking it. Each item is scheduled with FSRS at a target retention of 0.90, adjustable between 0.85 and 0.92. New items pass through learning steps of 1 and 10 minutes and graduate after three correct recalls. An item counts as mastered after correct recalls in three later sessions on distinct days. Only typed recall and spoken recall judged by speech recognition change an item's recall state; the other exercises keep their own counters.

By default the app introduces seven new items a day against a ten-minute daily goal. The weekly target is five active days out of seven, with one grace day. Grammar arrives as rule cards: short interactive checks, not texts to read. Every unit ends in a checkpoint with a pass mark of 80 percent, and passing paints that unit's row of the hive, the course map. A weekly check asks the learner to predict their score first, so the app can show how well confidence and recall agree.

## Exercises

- Meet: a first look at a new word or phrase, with audio and a helper line.
- Typed recall from English to Slovenian.
- Structured choice: pick the form or ending that fits a sentence.
- Slot production: type a known chunk with a new filler.
- Dialogues: scripted scenes in which the learner types their own lines.
- Listening: hear a phrase, then write it down or choose its meaning.
- Speaking: self-rated by default. After the learner opts in, the browser's speech recognition judges the answer, listening only when the learner taps to speak.
- Hearing drills: pick which of two or three similar words was said.

## Progress

The hive draws the course as a honeycomb: one row per unit, one cell per lesson. A cell fills with honey by the share of the lesson's items the learner can recall now, so it rises and falls with memory rather than completion; a cell whose items can all be recalled is full, with a thicker rim. A passed checkpoint paints the unit's motif across its row, with the honey still visible underneath. The unit page shows the row drawn large, and a tap on a cell opens a sheet with the lesson's words and phrases, its rule cards and its state; practice itself always runs through the daily session, in course order. The closing screen of a unit's last lesson offers the unit checkpoint, a passed checkpoint shows the unit's painted row, and the unit page says how many of the unit's items are due for review. The Words list shows each item's helper line and first example.

## Quiet sessions

A session can go quiet without changing a setting. Can't listen right now appears beside the first exercise that would play sound; it drops listening and hearing drills for the rest of the sitting, hides every Listen button and plays no model line. Can't talk right now appears beside the first speaking exercise and in the closing menu, and drops speaking. Both are also in the session's Quiet control, cost no miss, carry through whatever the closing menu starts, end when the learner leaves the session and are never stored. Settings keep the permanent choices: mute and the speech recognition opt-in.

## Content pipeline

Content is JSON under `content/`: units, lessons, reviews and rule cards, and every item carries a verification status (accepted, pending or rejected). A linter checks the files against their schemas, references, register labels and generic framing, and any error stops the build. The deployed strict build keeps only accepted content in practice: anything else is stripped from practice sets, and a lesson without an accepted item is left out. A development build keeps everything and says so in the app. A build-time tool generates audio for accepted content only; the app ships the clips with a manifest mapping each text and voice to its file. A native-speaker check list records which items a native speaker has confirmed or corrected.

## Stack

The app is plain ES modules with no framework, bundler or runtime dependency, typed with JSDoc and checked by the TypeScript compiler. Progress lives in IndexedDB, with an in-memory fallback, and can be exported to a file and imported again. A module service worker keeps the app shell and the content in versioned caches, so the app works offline once installed. The site is static files on GitHub Pages, with no account and no server.

## Privacy

Nothing leaves the device at runtime except speech recognition after the learner opts in, which sends their voice to the browser's speech service while it listens. With the switch off, speaking is self-rated and nothing is sent.
