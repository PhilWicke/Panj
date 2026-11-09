// tests/helpers/items.js
// The shape of an accepted chunk that the UI tests build their lessons from. It holds no course
// data: each test passes its own ids and text, so the fixtures stay inline in the test and nothing
// is read from content/.

/** A chunk item whose two reviews accepted it. @param {string} id @param {string} sl @param {string} en */
export const acceptedChunk = (id, sl, en) => ({
  id, type: 'chunk', sl, en, register: 'neutral', examples: [],
  verification: { review1: 'accepted', review2: 'accepted', native: null, status: 'accepted' },
});
