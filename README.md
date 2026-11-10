# Slovelingo

Slovelingo is an installable web app for learning everyday Slovenian, aimed at someone who wants to talk with the people around them. Short daily sessions mix new words and phrases with spaced review, and the app runs offline on a phone once it has been added to the home screen. A session can go quiet for the moment, without sound or without speaking, and the hive shows each unit as a row of cells that fill with what you can recall now. There is no account and no server: progress stays on the device.

The project needs Node 24 or later and has no runtime dependencies. [docs/SPEC.md](docs/SPEC.md) summarises the design.

## Run locally

```sh
npm run build:content:dev
npm run serve
```

Then open http://localhost:4173. The development build keeps content that is still waiting for verification, and the app shows a "Development build" badge.

## Test

```sh
npm test
npm run typecheck
npm run lint:content
```

`npm run typecheck` fetches TypeScript 5 through npx on first use; nothing is installed in the project. `npm run lint:content` is the strict linter: it reports every practised item still awaiting verification, which a deploy strips from practice, so it fails until those items are verified; `npm run lint:content -- --allow-pending` checks everything else.

`npm run test:e2e` runs the app end to end in a phone-sized Chromium after `npm install --no-save @playwright/test@1.64.1`, which leaves `package.json` as it is; on a machine that already has Playwright's Chromium 1248, put `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in front of that install, and elsewhere fetch the browser with `npx playwright install chromium`. The CI workflow runs the same test on every push and pull request with a browser it installs itself.

The hive and quiet scenarios serve their own courses, so they do not depend on the content written so far.

## Build

```sh
npm run build:content
```

This is the strict build, the one that is deployed. Lint errors fail it, and content whose verification status is not accepted never reaches practice: it is stripped from practice sets, and a lesson without an accepted item is left out.

## Audio

The recordings are generated once, at build time, with Gemini text-to-speech, and need `ffmpeg`. The key is read from the file named by `GEMINI_API_KEY_FILE`, by default `~/.config/google/aistudio.key`; it is never printed or committed.

```sh
npm run build:content
npm run audio -- --limit 5
npm run voice-check -- --out <dir>
```

`npm run audio` generates clips for the accepted content of the last build into `app/assets/audio/`, and `--limit 5` keeps a trial run to the first five texts in each voice. The male voice's clips are measured and re-taken up to five times when they come out too high, and clips still high are listed as `HIGH`. `npm run voice-check -- --out <dir>` writes sample lines in three voices and a page to compare them into the folder you name.

## Icons

```sh
npm run icons
```

This renders `app/assets/icon.svg` and `app/assets/icon-maskable.svg` into the PNG icons under `app/assets/icons/` with the macOS tools `qlmanage` and `sips`.

## Deploy

The repository's Pages workflow publishes the site to GitHub Pages from a strict content build. Every push to `main` deploys once the tests have passed: `.github/workflows/ci.yml` runs the strict build and publishes the `app/` folder. The live app is at https://philwicke.github.io/Slovelingo/.

## Licences

Slovelingo combines parts under different licences. The MIT License in [LICENSE](LICENSE) covers everything except the third-party parts listed below.

MIT License (see [LICENSE](LICENSE)): the app code except `app/js/engine/fsrs.vendored.js`, the build tools, the tests, the course content under `content/` except `content/reference/`, and the recordings under `app/assets/audio/`, each to the extent that it is protected by copyright.

Third-party parts:

- `app/assets/fonts/`: Bricolage Grotesque, Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage), as WOFF2 subsets. SIL Open Font License 1.1, see [app/assets/fonts/LICENSE-OFL.txt](app/assets/fonts/LICENSE-OFL.txt). The font is not under the MIT License.
- `app/js/engine/fsrs.vendored.js`: ts-fsrs 6.0.0, Copyright (c) 2026 Open Spaced Repetition, MIT License, with the bundled @open-spaced-repetition/srs-kit 1.0.0, Copyright (c) 2026, Open Spaced Repetition contributors, BSD 3-Clause License. Both licence texts are at the top of the file.
- `content/reference/gos-top3000.tsv`: adapted from *Frequency lists of words from the GOS 1.0 corpus 1.1* by Jaka Čibej, Špela Arhar Holdt, Kaja Dobrovoljc and Simon Krek, Slovenian language resource repository CLARIN.SI, 2020, http://hdl.handle.net/11356/1364, licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Rows and columns were removed, see [content/reference/README.md](content/reference/README.md). This file is under CC BY-SA 4.0, not MIT. The `freq_rank` values in the course content come from it.
- `content/reference/a1-topics.md` and `content/reviews/`: these quote short passages, with their sources, from two curriculum documents of the Center za slovenščino kot drugi in tuji jezik (CSDTJ) and from the Fran dictionary portal (ZRC SAZU). The quotations remain their owners' and are not licensed under MIT.

How the content and the recordings were made:

- The course content was drafted with an AI model. Two independent AI reviews checked every item against dictionaries, a native speaker confirmed the 17 items those reviews had doubted, and an independent AI review read the whole course once more.
- The recordings are computer-generated voices, not recordings of people: Google's Gemini text-to-speech, model `gemini-3.1-flash-tts-preview`, voices Kore and Puck. Google claims no ownership of content generated with it.

Slovelingo is not affiliated with or endorsed by Google, Open Spaced Repetition, CLARIN.SI, CSDTJ, ZRC SAZU or the authors of Bricolage Grotesque.
