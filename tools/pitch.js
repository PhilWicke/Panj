// The median fundamental frequency of a voice clip, so the audio tool can tell a take of the male
// voice that came out too high: an agent cannot listen, so pitch is the signal. The method was
// checked on the real voice-check clips. Downsample to about 8 kHz, cut frames of 40 ms every
// 10 ms, keep the loud ones, find each frame's period by autocorrelation and take the median.

const TARGET_RATE_HZ = 8000;
const FRAME_SECONDS = 0.04;
const HOP_SECONDS = 0.01;
const MIN_PITCH_HZ = 70;
const MAX_PITCH_HZ = 400;
/** A frame counts when its RMS is at least this share of the 95th percentile of all frames' RMS. */
const LOUDNESS_SHARE = 0.35;
/** The lowest normalised autocorrelation that still reads as a voiced frame. */
const MIN_PEAK = 0.5;
const MIN_FRAMES = 8;

/** @param {Float64Array} values */
const sum = (values) => values.reduce((total, value) => total + value, 0);

/** @param {Float64Array} frame */
const rms = (frame) => Math.sqrt(sum(frame.map((value) => value * value)) / frame.length);

/**
 * 16-bit little-endian PCM as samples, averaged over `factor` samples at a time.
 * @param {Buffer} pcm @param {number} factor
 */
function downsample(pcm, factor) {
  const samples = new Float64Array(Math.floor(pcm.length / 2 / factor));
  for (let i = 0; i < samples.length; i += 1) {
    let total = 0;
    for (let j = 0; j < factor; j += 1) total += pcm.readInt16LE((i * factor + j) * 2);
    samples[i] = total / factor;
  }
  return samples;
}

/**
 * The frame's pitch in Hz from the highest peak of its normalised autocorrelation, or null when
 * no peak reaches MIN_PEAK.
 * @param {Float64Array} frame @param {number} rate the frame's sample rate
 * @returns {number | null}
 */
function framePitch(frame, rate) {
  const mean = sum(frame) / frame.length;
  const centred = frame.map((value) => value - mean);
  const energy = sum(centred.map((value) => value * value));
  if (energy === 0) return null;
  /** @param {number} lag */
  const correlation = (lag) => {
    let total = 0;
    for (let i = 0; i + lag < centred.length; i += 1) total += centred[i] * centred[i + lag];
    return total / energy;
  };
  const minLag = Math.ceil(rate / MAX_PITCH_HZ);
  const maxLag = Math.floor(rate / MIN_PITCH_HZ);
  let highest = -Infinity;
  let bestLag = 0;
  let before = correlation(minLag - 1);
  let here = correlation(minLag);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const after = correlation(lag + 1);
    if (here > before && here >= after && here > highest) {
      highest = here;
      bestLag = lag;
    }
    before = here;
    here = after;
  }
  return highest >= MIN_PEAK ? rate / bestLag : null;
}

/**
 * The median fundamental frequency in Hz of 16-bit little-endian mono PCM.
 * @param {Buffer} pcm @param {number} [sampleRate]
 * @returns {number | null} null when too little of it is voiced
 */
export function medianPitch(pcm, sampleRate = 24000) {
  const factor = Math.max(1, Math.round(sampleRate / TARGET_RATE_HZ));
  const rate = sampleRate / factor;
  const samples = downsample(pcm, factor);
  const frameLength = Math.round(FRAME_SECONDS * rate);
  const hop = Math.round(HOP_SECONDS * rate);

  const frames = [];
  for (let start = 0; start + frameLength <= samples.length; start += hop) frames.push(samples.subarray(start, start + frameLength));
  if (frames.length < MIN_FRAMES) return null;

  const levels = frames.map(rms);
  const sortedLevels = [...levels].sort((a, b) => a - b);
  const gate = LOUDNESS_SHARE * sortedLevels[Math.floor(0.95 * (sortedLevels.length - 1))];
  const pitches = frames.flatMap((frame, i) => {
    const pitch = levels[i] >= gate ? framePitch(frame, rate) : null;
    return pitch === null ? [] : [pitch];
  });
  if (pitches.length < MIN_FRAMES) return null;

  pitches.sort((a, b) => a - b);
  const middle = Math.floor(pitches.length / 2);
  return pitches.length % 2 === 1 ? pitches[middle] : (pitches[middle - 1] + pitches[middle]) / 2;
}
