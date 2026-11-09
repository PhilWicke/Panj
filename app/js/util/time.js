// Local calendar helpers for the scheduler and the progress views. Slovelingo counts in the
// learner's local days: an item that graduates is due at the start of the next local day, a later
// review is due from the start of a local day, mastery needs recalls on distinct local days, and
// the week view groups sessions by local date. Every function takes an optional IANA zone for
// tests; without it the phone's zone applies. The Intl formatter behind every reading is built
// once per zone and kept, since a session reads the clock on every answer.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @type {Map<string, Intl.DateTimeFormat>} one formatter per zone, under '' for the phone's zone */
const formatters = new Map();

/**
 * The formatter for a zone, built on first use.
 * @param {string} [tz]
 * @returns {Intl.DateTimeFormat}
 */
function formatter(tz) {
  const key = tz ?? '';
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(key, cached);
  }
  return cached;
}

/**
 * How many zones have a formatter cached, for the tests.
 * @returns {number}
 */
export function formatterCacheSize() {
  return formatters.size;
}

/**
 * The wall clock of an instant in a zone, to the second.
 * @param {number} epochMs
 * @param {string} [tz]
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number }}
 */
function wallClock(epochMs, tz) {
  const parts = formatter(tz).formatToParts(new Date(epochMs));
  const clock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of parts) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day'
      || part.type === 'hour' || part.type === 'minute' || part.type === 'second') {
      clock[part.type] = Number(part.value);
    }
  }
  return clock;
}

/**
 * The local calendar date of an instant as `YYYY-MM-DD`.
 * @param {number} epochMs
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {string}
 */
export function localDateKey(epochMs, tz) {
  const { year, month, day } = wallClock(epochMs, tz);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The first instant of the local day that contains `epochMs`, as epoch ms.
 * @param {number} epochMs
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {number}
 */
export function startOfLocalDay(epochMs, tz) {
  const clock = wallClock(epochMs, tz);
  const dayUtc = Date.UTC(clock.year, clock.month - 1, clock.day);
  // The zone's offset at the instant is the wall clock read as UTC minus the instant (to the second).
  const wall = dayUtc + ((clock.hour * 60 + clock.minute) * 60 + clock.second) * 1000;
  let midnight = dayUtc - (wall - Math.floor(epochMs / 1000) * 1000);
  // A clock change between midnight and the instant shifts the offset; one correction settles it.
  const check = wallClock(midnight, tz);
  if (check.day !== clock.day || check.hour !== 0 || check.minute !== 0 || check.second !== 0) {
    const checkWall = Date.UTC(check.year, check.month - 1, check.day, check.hour, check.minute, check.second);
    midnight = dayUtc - (checkWall - midnight);
  }
  return midnight;
}

/**
 * The first instant of the local day after the one that contains `epochMs`, as epoch ms: where a
 * review is due once an item graduates. Thirty-six hours after the start of a day is always inside
 * the next local day, since local days last 23 to 25 hours around the clock changes.
 * @param {number} epochMs
 * @param {string} [tz] IANA zone, for tests; the phone's zone when omitted
 * @returns {number}
 */
export function startOfNextLocalDay(epochMs, tz) {
  return startOfLocalDay(startOfLocalDay(epochMs, tz) + 36 * HOUR_MS, tz);
}

/**
 * Calendar days from `keyA` to `keyB`: 1 for consecutive days, negative when `keyB` is earlier.
 * @param {string} keyA `YYYY-MM-DD`
 * @param {string} keyB `YYYY-MM-DD`
 * @returns {number}
 */
export function daysBetween(keyA, keyB) {
  return Math.round((keyToUtc(keyB) - keyToUtc(keyA)) / DAY_MS);
}

/**
 * @param {string} key
 * @returns {number}
 */
function keyToUtc(key) {
  const match = KEY_PATTERN.exec(key);
  if (!match) throw new RangeError(`Not a date key: ${key}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
