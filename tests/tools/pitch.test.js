// tests/tools/pitch.test.js
// The pitch measure on generated tones and silence: no audio files, no ffmpeg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medianPitch } from '../../tools/pitch.js';

const RATE = 24000;

/**
 * A sine tone as 16-bit little-endian mono PCM at 24 kHz.
 * @param {number} hz @param {number} seconds
 */
function tone(hz, seconds) {
  const count = Math.round(RATE * seconds);
  const pcm = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i += 1) pcm.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * hz * i) / RATE)), i * 2);
  return pcm;
}

/** @param {number | null} actual @param {number} expected */
function assertNear(actual, expected) {
  assert.ok(actual !== null && Math.abs(actual - expected) <= 3, `measured ${actual} Hz, expected about ${expected} Hz`);
}

test('a sine tone comes back within 3 Hz of its frequency', () => {
  assertNear(medianPitch(tone(120, 1)), 120);
  assertNear(medianPitch(tone(220, 1)), 220);
});

test('a tone in bursts separated by silence comes back within 3 Hz of its frequency', () => {
  const burst = tone(150, 0.2);
  const gap = Buffer.alloc(Math.round(RATE * 0.15) * 2);
  assertNear(medianPitch(Buffer.concat([burst, gap, burst, gap, burst])), 150);
});

test('silence gives null', () => {
  assert.equal(medianPitch(Buffer.alloc(RATE * 2)), null);
});

test('PCM shorter than the eight frames gives null, and eight frames are enough', () => {
  assert.equal(medianPitch(tone(150, 0.1)), null);
  assertNear(medianPitch(tone(150, 0.11)), 150);
});
