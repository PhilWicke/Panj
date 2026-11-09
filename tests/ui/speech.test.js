// tests/ui/speech.test.js
// The audio player and speech recognition under Node, with the browser APIs stubbed per test.
// compareSpoken: a correct or slipped transcript is a match, one within 2 edits or 20 percent of
// the line (diacritics aside) is close, anything else a miss. recognizeOnce never rejects: it
// resolves transcript null when the API is missing, on an error, on an end without a result and
// on its timeout; a refused microphone or service, no microphone or no Slovenian is remembered as
// recognitionBlocked until resetRecognition, and no other error is. createPlayer plays the recording first, the device's Slovenian voice second and
// resolves 'none' when neither exists; a missing manifest reads as empty without a console error,
// and a missing Web Crypto as no recording; mute plays nothing; setVoice changes the voice of later lookups and stops what
// plays; a new play waits for the cancelled utterance to let go before it speaks; audioAvailable
// says whether a recording in the preferred voice or a Slovenian device voice exists (Ruling 81),
// within AUDIO_CHECK_MS, a slower answer reading as available (Ruling 95).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { compareSpoken, recognitionBlocked, recognizeOnce, resetRecognition, speechAvailable } from '../../app/js/audio/speech.js';
import { AUDIO_CHECK_MS, createPlayer, voiceFor, VOICES } from '../../app/js/audio/player.js';
import { audioId } from '../../app/js/util/audio-id.js';

const MANIFEST_URL = 'assets/audio/manifest.json';
const STUBBED = ['fetch', 'crypto', 'Audio', 'speechSynthesis', 'SpeechSynthesisUtterance', 'SpeechRecognition', 'webkitSpeechRecognition'];
const originals = new Map(STUBBED.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

/** @param {string} name @param {unknown} value */
function stub(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

afterEach(() => {
  resetRecognition();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (/** @type {Record<string, unknown>} */ (globalThis))[name];
  }
});

/** A fetch that answers 404 for everything, counting its calls. */
function notFound() {
  const calls = /** @type {string[]} */ ([]);
  const fetch = async (/** @type {string} */ url) => {
    calls.push(url);
    return { ok: false, status: 404, json: async () => { throw new SyntaxError('no JSON in a 404 page'); } };
  };
  return { fetch, calls };
}

/** A fetch that serves `manifest` at any URL, counting its calls. @param {Record<string, unknown>} manifest */
function serving(manifest) {
  const calls = /** @type {string[]} */ ([]);
  const fetch = async (/** @type {string} */ url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => manifest };
  };
  return { fetch, calls };
}

/** An HTMLAudioElement stand-in: play() ends the clip on the next turn, or fails it when `fail` is set. */
function fakeAudio({ fail = false } = {}) {
  const made = /** @type {any[]} */ ([]);
  class FakeAudio {
    /** @param {string} src */
    constructor(src) {
      this.src = src;
      this.paused = true;
      /** @type {(() => void)|null} */ this.onended = null;
      /** @type {(() => void)|null} */ this.onerror = null;
      made.push(this);
    }

    play() {
      this.paused = false;
      setTimeout(() => (fail ? this.onerror?.() : this.onended?.()), 0);
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
    }
  }
  return { FakeAudio, made };
}

/**
 * A speechSynthesis stand-in with the given voices. speak() ends the utterance after `speakMs`;
 * cancel() fails the current one with `interrupted` after `cancelMs`, or never when `cancelMs`
 * is null. Every call is logged in `log`.
 * @param {{ voices?: { lang: string, name: string }[], speakMs?: number, cancelMs?: number|null }} [opts]
 */
function fakeSynth({ voices = [{ lang: 'sl-SI', name: 'Lado' }], speakMs = 0, cancelMs = 10 } = {}) {
  const log = /** @type {string[]} */ ([]);
  /** @type {any} */
  let current = null;
  const synth = {
    getVoices: () => voices,
    addEventListener() {},
    removeEventListener() {},
    /** @param {any} utterance */
    speak(utterance) {
      log.push(`speak ${utterance.text}`);
      current = utterance;
      setTimeout(() => {
        if (current !== utterance) return;
        current = null;
        log.push(`end ${utterance.text}`);
        utterance.onend?.({});
      }, speakMs);
    },
    cancel() {
      log.push('cancel');
      const cancelled = current;
      current = null;
      if (cancelled && cancelMs !== null) {
        setTimeout(() => {
          log.push(`error ${cancelled.text}`);
          cancelled.onerror?.({ error: 'interrupted' });
        }, cancelMs);
      }
    },
  };
  class FakeUtterance {
    /** @param {string} text */
    constructor(text) {
      this.text = text;
      /** @type {any} */ this.voice = null;
      this.lang = '';
      /** @type {((event: any) => void)|null} */ this.onend = null;
      /** @type {((event: any) => void)|null} */ this.onerror = null;
    }
  }
  return { synth, FakeUtterance, log };
}

/**
 * A SpeechRecognition stand-in; `behave(recognition)` runs on start() and drives its events.
 * @param {(recognition: any) => void} behave
 */
function fakeRecognition(behave) {
  const made = /** @type {any[]} */ ([]);
  class FakeRecognition {
    constructor() {
      this.lang = '';
      this.interimResults = true;
      this.continuous = true;
      this.maxAlternatives = 0;
      this.started = 0;
      this.aborted = 0;
      /** @type {any} */ this.onresult = null;
      /** @type {any} */ this.onerror = null;
      /** @type {any} */ this.onend = null;
      made.push(this);
    }

    start() {
      this.started += 1;
      behave(this);
    }

    abort() {
      this.aborted += 1;
    }
  }
  return { FakeRecognition, made };
}

test('compareSpoken: a correct transcript, or one that differs only in diacritics or punctuation, is a match', () => {
  assert.equal(compareSpoken('Dober večer', 'Dober večer.'), 'match');
  assert.equal(compareSpoken('dober vecer', 'Dober večer.'), 'match', 'what grade calls a slip');
  assert.equal(compareSpoken('Dober večer!', 'Dober večer.'), 'match', 'the recogniser\'s own punctuation and case');
});

test('compareSpoken: within 2 edits or 20 percent of the line, diacritics aside, is close; beyond is a miss', () => {
  assert.equal(compareSpoken('dober vece', 'Dober večer.'), 'close', '1 edit');
  assert.equal(compareSpoken('dober več', 'Dober večer.'), 'close', '2 edits');
  assert.equal(compareSpoken('dobro večer', 'Dober večer.'), 'close', '2 edits, a swap');
  assert.equal(compareSpoken('hvla', 'Hvala.'), 'close', 'a short line still allows 2 edits');
  assert.equal(compareSpoken('pro', 'Prosim.'), 'miss', '3 edits on a line of 6 letters');
  // "lahko dobim kavo prosim" has 23 characters: 20 percent allows 4 edits.
  assert.equal(compareSpoken('lahk dobi kava prosi', 'Lahko dobim kavo, prosim?'), 'close', '4 edits on 23');
  assert.equal(compareSpoken('lah dobi kava prosi', 'Lahko dobim kavo, prosim?'), 'miss', '5 edits on 23');
  assert.equal(compareSpoken('nasvidenje', 'Dober večer.'), 'miss');
  assert.equal(compareSpoken('', 'Hvala.'), 'miss', 'nothing heard');
});

test('recognizeOnce resolves transcript null when the API is missing, and speechAvailable says so', async () => {
  stub('SpeechRecognition', undefined);
  stub('webkitSpeechRecognition', undefined);
  assert.equal(speechAvailable(), false);
  assert.deepEqual(await recognizeOnce(), { transcript: null, error: 'unavailable' });
  assert.deepEqual(await recognizeOnce({ lang: 'sl-SI', timeoutMs: 10 }), { transcript: null, error: 'unavailable' });
});

test('recognizeOnce listens once in Slovenian, through the prefixed API too, and resolves the trimmed transcript', async () => {
  const { FakeRecognition, made } = fakeRecognition((recognition) => setTimeout(() => {
    recognition.onresult?.({ results: [[{ transcript: ' Dober večer ' }]] });
    recognition.onend?.();
  }, 0));
  stub('SpeechRecognition', undefined);
  stub('webkitSpeechRecognition', FakeRecognition);
  assert.equal(speechAvailable(), true, 'the webkit prefix counts');
  assert.equal(made.length, 0, 'checking availability constructs nothing');

  assert.deepEqual(await recognizeOnce(), { transcript: 'Dober večer', error: null });
  assert.equal(made.length, 1);
  const [recognition] = made;
  assert.equal(recognition.lang, 'sl-SI');
  assert.equal(recognition.interimResults, false);
  assert.equal(recognition.continuous, false);
  assert.equal(recognition.started, 1);
});

test('recognizeOnce never rejects: a refusal, no speech, an end without a result, a failed start and the timeout resolve null', async () => {
  /** @param {(recognition: any) => void} behave @param {number} [timeoutMs] */
  const run = (behave, timeoutMs) => {
    const { FakeRecognition, made } = fakeRecognition(behave);
    stub('SpeechRecognition', FakeRecognition);
    return { result: recognizeOnce({ timeoutMs }), made };
  };

  const refused = run((r) => setTimeout(() => { r.onerror?.({ error: 'not-allowed' }); r.onend?.(); }, 0));
  assert.deepEqual(await refused.result, { transcript: null, error: 'not-allowed' });

  const silent = run((r) => setTimeout(() => { r.onerror?.({ error: 'no-speech' }); r.onend?.(); }, 0));
  assert.deepEqual(await silent.result, { transcript: null, error: 'no-speech' });

  const ended = run((r) => setTimeout(() => r.onend?.(), 0));
  assert.deepEqual(await ended.result, { transcript: null, error: 'no-speech' }, 'an end without a result');

  const blank = run((r) => setTimeout(() => r.onresult?.({ results: [[{ transcript: '  ' }]] }), 0));
  assert.deepEqual(await blank.result, { transcript: null, error: 'no-speech' }, 'a blank transcript');

  const broken = run(() => { throw new Error('InvalidStateError'); });
  assert.deepEqual(await broken.result, { transcript: null, error: 'start-failed' });

  const hung = run(() => {}, 20);
  assert.deepEqual(await hung.result, { transcript: null, error: 'timeout' });
  assert.equal(hung.made[0].aborted, 1, 'the timeout stops the recogniser');
});

test('recognizeOnce remembers a failure that does not pass by itself until resetRecognition, and no other', async () => {
  /** @param {(recognition: any) => void} behave @param {number} [timeoutMs] */
  const run = (behave, timeoutMs) => {
    stub('SpeechRecognition', fakeRecognition(behave).FakeRecognition);
    return recognizeOnce({ timeoutMs });
  };
  /** @param {string} error */
  const failing = (error) => run((r) => setTimeout(() => { r.onerror?.({ error }); r.onend?.(); }, 0));

  assert.equal(recognitionBlocked(), false, 'nothing is remembered before the first attempt');
  for (const error of ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']) {
    resetRecognition();
    assert.deepEqual(await failing(error), { transcript: null, error });
    assert.equal(recognitionBlocked(), true, `${error} stays`);
    resetRecognition();
    assert.equal(recognitionBlocked(), false, `resetRecognition forgets ${error}`);
  }

  for (const error of ['network', 'no-speech', 'aborted', 'bad-grammar', 'a-code-from-a-later-browser']) {
    assert.deepEqual(await failing(error), { transcript: null, error });
    assert.equal(recognitionBlocked(), false, `${error} is for that attempt only`);
  }
  assert.equal((await run(() => { throw new Error('InvalidStateError'); })).error, 'start-failed');
  assert.equal(recognitionBlocked(), false, 'a recogniser that would not start once may start the next time');
  assert.equal((await run(() => {}, 10)).error, 'timeout');
  assert.equal(recognitionBlocked(), false, 'nor does the timeout');
  stub('SpeechRecognition', undefined);
  assert.equal((await recognizeOnce()).error, 'unavailable');
  assert.equal(recognitionBlocked(), false, 'a missing API is speechAvailable\'s to say');
});

test('voiceFor maps the voice preference to the recordings\' voice, none for the device voice', () => {
  assert.deepEqual(VOICES, { female: 'Kore', male: 'Puck' });
  assert.equal(voiceFor('female'), 'Kore');
  assert.equal(voiceFor('male'), 'Puck');
  assert.equal(voiceFor('device'), null);
});

test('createPlayer resolves none with an empty manifest and no device voice, without a console error', async (t) => {
  const { fetch, calls } = notFound();
  stub('fetch', fetch);
  stub('speechSynthesis', undefined);
  const errors = t.mock.method(console, 'error');
  const player = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: false });

  assert.equal(await player.play('Dober dan.'), 'none');
  assert.equal(await player.hasAudioFor('Dober dan.'), false);
  assert.equal(player.deviceVoiceAvailable(), false);
  assert.deepEqual(calls, [MANIFEST_URL], 'the manifest is fetched once');

  stub('fetch', async () => { throw new TypeError('Failed to fetch'); });
  const offline = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: false });
  assert.equal(await offline.play('Dober dan.'), 'none', 'a network error reads as an empty manifest');
  assert.equal(errors.mock.callCount(), 0);
});

test('audioAvailable: a recording in the preferred voice or a Slovenian device voice; neither is no audio (Ruling 81)', async () => {
  const { fetch, calls } = notFound();
  stub('fetch', fetch);
  stub('speechSynthesis', undefined);
  const silent = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: false });
  assert.equal(await silent.audioAvailable(), false, 'an empty manifest and no device voice');
  assert.deepEqual(calls, [MANIFEST_URL], 'the manifest is fetched once');
  assert.equal(await silent.audioAvailable(), false);
  assert.equal(calls.length, 1, 'and not again');

  const id = await audioId('Dober dan.', 'Kore');
  stub('fetch', serving({ [id]: { text: 'Dober dan.', voice: 'Kore', model: 'm', bytes: 1 } }).fetch);
  const female = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: true });
  assert.equal(await female.audioAvailable(), true, 'a recording in the preferred voice; mute does not enter into it');
  const male = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'male', mute: false });
  assert.equal(await male.audioAvailable(), false, 'the one recording is in the other voice');
  male.setVoice('female');
  assert.equal(await male.audioAvailable(), true, 'setVoice changes the voice the lookup uses');
  stub('fetch', serving({ odd: null, other: 'text' }).fetch);
  assert.equal(await createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: false }).audioAvailable(), false, 'a manifest with odd entries reads as none');

  const { synth, FakeUtterance } = fakeSynth();
  stub('speechSynthesis', synth);
  stub('SpeechSynthesisUtterance', FakeUtterance);
  const device = notFound();
  stub('fetch', device.fetch);
  assert.equal(await createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'device', mute: false }).audioAvailable(), true, 'a Slovenian device voice');
  assert.deepEqual(device.calls, [], 'the voice device never fetches the manifest (Ruling 45)');
  assert.equal(await createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: false }).audioAvailable(), true, 'no recording, but the device voice');
  stub('speechSynthesis', fakeSynth({ voices: [{ lang: 'en-GB', name: 'Daniel' }] }).synth);
  assert.equal(await createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'device', mute: false }).audioAvailable(), false, 'no Slovenian voice among the device voices');
});

test('audioAvailable answers within AUDIO_CHECK_MS: a manifest that never comes reads as available, a faster answer stands and clears its timer (Ruling 95)', async (t) => {
  assert.equal(AUDIO_CHECK_MS, 1500);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sets = t.mock.method(globalThis, 'setTimeout');
  const clears = t.mock.method(globalThis, 'clearTimeout');
  /** Lets every promise that can settle do so; setImmediate is not mocked. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  stub('speechSynthesis', undefined);

  const stalled = { calls: /** @type {string[]} */ ([]) };
  stub('fetch', (/** @type {string} */ url) => {
    stalled.calls.push(url);
    return new Promise(() => {});
  });
  /** @type {boolean|null} */
  let answer = null;
  const pending = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: false }).audioAvailable()
    .then((value) => { answer = value; });
  await flush();
  assert.deepEqual(stalled.calls, [MANIFEST_URL], 'the manifest fetch has started and never settles');
  t.mock.timers.tick(AUDIO_CHECK_MS - 1);
  await flush();
  assert.equal(answer, null, 'no answer before the bound');
  t.mock.timers.tick(1);
  await pending;
  assert.equal(answer, true, 'the bound wins: audio reads as available, so no exercise is removed');

  sets.mock.resetCalls();
  clears.mock.resetCalls();
  stub('fetch', notFound().fetch);
  assert.equal(await createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: false }).audioAvailable(), false,
    'the real answer comes first and stands: an empty manifest and no device voice');
  const bound = sets.mock.calls.filter((call) => call.arguments[1] === AUDIO_CHECK_MS);
  assert.equal(bound.length, 1, 'one timer for the bound');
  assert.ok(clears.mock.calls.some((call) => call.arguments[0] === bound[0].result), 'and it is cleared once the real answer wins');
});

test('createPlayer never rejects: without Web Crypto (an insecure context) there is no recording to find', async () => {
  const id = await audioId('Dober dan.', 'Kore');
  stub('fetch', serving({ [id]: { text: 'Dober dan.', voice: 'Kore', model: 'm', bytes: 1 } }).fetch);
  stub('crypto', {});
  stub('speechSynthesis', undefined);
  const player = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: false });
  assert.equal(await player.play('Dober dan.'), 'none');
  assert.equal(await player.hasAudioFor('Dober dan.'), false);
});

test('createPlayer plays the recording in the preferred voice from beside the manifest', async () => {
  const id = await audioId('Dober dan.', 'Kore');
  const { fetch, calls } = serving({ [id]: { text: 'Dober dan.', voice: 'Kore', model: 'm', bytes: 1 } });
  const { FakeAudio, made } = fakeAudio();
  stub('fetch', fetch);
  stub('Audio', FakeAudio);
  stub('speechSynthesis', undefined);
  const player = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: false });

  assert.equal(await player.hasAudioFor('Dober dan.'), true);
  assert.equal(await player.play('Dober dan.'), 'file');
  assert.equal(made.length, 1);
  assert.equal(made[0].src, `assets/audio/${id}.mp3`);
  assert.equal(await player.play('Dober dan.'), 'file');
  assert.equal(calls.length, 1, 'the manifest is fetched once for every lookup');

  const male = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'male', mute: false });
  assert.equal(await male.hasAudioFor('Dober dan.'), false, 'the recording is in the other voice');
  assert.equal(await male.play('Dober dan.'), 'none');
});

test('createPlayer falls back to a Slovenian device voice when there is no recording, or the recording fails', async () => {
  const id = await audioId('Hvala.', 'Kore');
  stub('fetch', serving({ [id]: { text: 'Hvala.', voice: 'Kore', model: 'm', bytes: 1 } }).fetch);
  stub('Audio', fakeAudio({ fail: true }).FakeAudio);
  const { synth, FakeUtterance, log } = fakeSynth({ voices: [{ lang: 'de-DE', name: 'Anna' }, { lang: 'sl-SI', name: 'Lado' }] });
  stub('speechSynthesis', synth);
  stub('SpeechSynthesisUtterance', FakeUtterance);
  const player = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: false });

  assert.equal(player.deviceVoiceAvailable(), true);
  assert.equal(await player.play('Prosim.'), 'device', 'no recording');
  assert.equal(await player.play('Hvala.'), 'device', 'the recording failed to play');
  assert.deepEqual(log, ['speak Prosim.', 'end Prosim.', 'speak Hvala.', 'end Hvala.']);

  const { fetch, calls } = notFound();
  stub('fetch', fetch);
  const device = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'device', mute: false });
  assert.equal(await device.play('Hvala.'), 'device');
  assert.equal(calls.length, 0, 'the device preference never looks for recordings');

  stub('speechSynthesis', fakeSynth({ voices: [{ lang: 'de-DE', name: 'Anna' }] }).synth);
  const german = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'device', mute: false });
  assert.equal(german.deviceVoiceAvailable(), false);
  assert.equal(await german.play('Hvala.'), 'none', 'a voice that is not Slovenian does not count');
});

test('createPlayer plays nothing when muted, and setMute stops what plays', async () => {
  const id = await audioId('Dober dan.', 'Kore');
  const { fetch, calls } = serving({ [id]: { text: 'Dober dan.', voice: 'Kore', model: 'm', bytes: 1 } });
  stub('fetch', fetch);
  stub('speechSynthesis', undefined);
  /** An audio element that plays until it is paused. */
  const made = /** @type {any[]} */ ([]);
  stub('Audio', class {
    /** @param {string} src */
    constructor(src) { this.src = src; this.paused = true; made.push(this); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  });

  const player = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'female', mute: true });
  assert.equal(await player.play('Dober dan.'), 'none');
  assert.equal(calls.length, 0, 'muted, nothing is fetched');

  player.setMute(false);
  const playing = player.play('Dober dan.');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(made.length, 1);
  assert.equal(made[0].paused, false);
  player.setMute(true);
  assert.equal(made[0].paused, true, 'setMute stops the playback');
  assert.equal(await playing, 'file', 'the stopped play still says where the sound came from');
  assert.equal(await player.play('Dober dan.'), 'none');
});

test('setVoice switches the voice of the recordings for later lookups and stops what plays (Ruling 48)', async () => {
  const kore = await audioId('Dober dan.', 'Kore');
  const { fetch, calls } = serving({ [kore]: { text: 'Dober dan.', voice: 'Kore', model: 'm', bytes: 1 } });
  stub('fetch', fetch);
  stub('speechSynthesis', undefined);
  /** An audio element that plays until it is paused. */
  const made = /** @type {any[]} */ ([]);
  stub('Audio', class {
    /** @param {string} src */
    constructor(src) { this.src = src; this.paused = true; made.push(this); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  });

  const player = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'male', mute: false });
  assert.equal(await player.hasAudioFor('Dober dan.'), false, 'the recording is in the female voice');
  player.setVoice('female');
  assert.equal(await player.hasAudioFor('Dober dan.'), true, 'the next lookup uses the new voice');
  const playing = player.play('Dober dan.');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(made.length, 1);
  assert.equal(made[0].src, `assets/audio/${kore}.mp3`);
  assert.equal(made[0].paused, false);
  player.setVoice('device');
  assert.equal(made[0].paused, true, 'setVoice stops the playback');
  assert.equal(await playing, 'file');
  assert.equal(await player.hasAudioFor('Dober dan.'), false, 'the device voice has no recordings');
  assert.equal(await player.play('Dober dan.'), 'none', 'and no Slovenian device voice here');
  assert.equal(made.length, 1, 'nothing more was played from a file');
  assert.equal(calls.length, 1, 'the manifest is fetched once, whatever the voice');
});

test('a new play cancels the utterance before it and waits for its end, or 150 ms, before speaking', async () => {
  stub('fetch', notFound().fetch);
  const slow = fakeSynth({ speakMs: 1000, cancelMs: 20 });
  stub('speechSynthesis', slow.synth);
  stub('SpeechSynthesisUtterance', slow.FakeUtterance);
  const player = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'device', mute: false });

  const first = player.play('Dober dan.');
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = player.play('Hvala.');
  assert.equal(await first, 'device', 'the cut-short utterance had a voice');
  player.stop();
  assert.equal(await second, 'device');
  assert.deepEqual(slow.log.slice(0, 4), ['speak Dober dan.', 'cancel', 'error Dober dan.', 'speak Hvala.'],
    'the next utterance is spoken only after the cancelled one reported its error');

  const mute = fakeSynth({ speakMs: 1000, cancelMs: null });
  stub('speechSynthesis', mute.synth);
  stub('SpeechSynthesisUtterance', mute.FakeUtterance);
  const quiet = createPlayer({ manifestUrl: MANIFEST_URL, voicePref: 'device', mute: false });
  void quiet.play('Dober dan.');
  await new Promise((resolve) => setTimeout(resolve, 10));
  const cancelledAt = Date.now();
  const next = quiet.play('Hvala.');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(mute.log, ['speak Dober dan.', 'cancel'], 'no event from the cancelled utterance: still waiting at 100 ms');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(mute.log, ['speak Dober dan.', 'cancel', 'speak Hvala.'], 'spoken after 150 ms');
  assert.ok(Date.now() - cancelledAt >= 150);
  quiet.stop();
  assert.equal(await next, 'device');
});
