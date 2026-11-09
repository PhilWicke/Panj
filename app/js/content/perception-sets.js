// The perception drill's sets of similar words (Ruling 46): pure data, shared by the drill
// (ui/exercises/perception.js) and by the audio texts (util/audio-texts.js), so the audio tool
// records every word the drill can play. A small built-in list for the sounds that trip German
// and English speakers: a final l (bil, bila), s against š (vas, vaš), s, z and ž (kosa, koza,
// koža), an s before t (peti, pesti) and v before a consonant (v šoli, šoli).

/** The drill's sets of similar words, each shown in this order. */
export const PERCEPTION_SETS = Object.freeze([
  Object.freeze(['bil', 'bila']),
  Object.freeze(['vas', 'vaš']),
  Object.freeze(['kosa', 'koza', 'koža']),
  Object.freeze(['peti', 'pesti']),
  Object.freeze(['v šoli', 'šoli']),
]);
