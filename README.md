# Slovelingo

Slovelingo is an installable web app for learning everyday Slovenian, aimed at someone who wants to talk with the people around them. Short daily sessions mix new words and phrases with spaced review, and the app runs offline on a phone once it has been added to the home screen. There is no account and no server: progress stays on the device.

The project needs Node 24 or later and has no dependencies. [docs/SPEC.md](docs/SPEC.md) summarises the design.

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

`npm run audio` generates clips for the accepted content of the last build into `app/assets/audio/`, and `--limit 5` keeps a trial run to the first five texts in each voice. `npm run voice-check -- --out <dir>` writes sample lines in three voices and a page to compare them into the folder you name.

## Icons

```sh
npm run icons
```

This renders `app/assets/icon.svg` and `app/assets/icon-maskable.svg` into the PNG icons under `app/assets/icons/` with the macOS tools `qlmanage` and `sips`.

## Deploy

The repository's Pages workflow publishes the site to GitHub Pages from a strict content build. Every push to `main` deploys once the tests have passed: `.github/workflows/ci.yml` runs the strict build and publishes the `app/` folder.

## Licence

MIT, see [LICENSE](LICENSE).
