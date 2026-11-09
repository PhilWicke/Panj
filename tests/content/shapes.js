// tests/content/shapes.js
// The shape of a unit at each level, the numbers the syllabus and the unit tests check. Ranges are
// inclusive [min, max]. `spread` is how many earlier lessons of its unit a consolidation lesson's
// production and dialogue new_items must draw on: lessonCount - 1, so every earlier lesson. A
// later level adds its own row; the tools hold none of these numbers.
export const SHAPES = {
  A1: {
    lessonCount: 5,
    themeItems: 8,
    consolidationItems: 6,
    unitItems: 38,
    courseItems: 380,
    themeRules: [1, 2],
    structured: [4, 8],
    production: [3, 6],
    themeLines: [4, 6],
    consolidationLines: [6, 8],
    spread: 4,
  },
};
