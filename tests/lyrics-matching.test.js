// Candidate scoring: exact match, fuzzy fallback, artist aliases and the
// version-tag guards that keep a Live take from matching a studio lyric.
const assert = require("node:assert/strict");
const {
  cleanLyricTag, normalizeLyricTag, scoreLyricCandidate, rankLyricCandidates,
  textSimilarity, artistAliases, isUsableLyricText
} = require("../src/lyrics-matching");

const track = { title: "Counting Stars", artist: "OneRepublic", album: "Native", duration: 259 };
const candidate = (overrides = {}) => ({
  title: "Counting Stars", artist: "OneRepublic", artists: ["OneRepublic"], album: "Native", duration: 259, ...overrides
});

// 1. Exact metadata still scores as before.
const exact = scoreLyricCandidate(candidate(), track);
assert.ok(exact > .9, `exact score ${exact}`);
assert.equal(scoreLyricCandidate(candidate({ duration: 400 }), track), 0, "duration outside tolerance is rejected");
assert.equal(scoreLyricCandidate(candidate({ artists: ["Adele"], artist: "Adele" }), track), 0, "unrelated artist is rejected");
assert.equal(scoreLyricCandidate(candidate({ title: "Another Song" }), track), 0, "unrelated title is rejected");

// 2. Version tags stay strict: a Live candidate cannot satisfy a studio track.
assert.equal(scoreLyricCandidate(candidate({ title: "Counting Stars (Live)" }), track), 0);
assert.equal(scoreLyricCandidate(candidate({ title: "Counting Stars (Acoustic)" }), track), 0);

// 3. Fuzzy title fallback handles width/punctuation/spelling drift.
const spaced = scoreLyricCandidate(candidate({ title: "Counting  Stars" }), track);
assert.ok(spaced > .5, `whitespace variant scored ${spaced}`);
const punctuated = scoreLyricCandidate(candidate({ title: "Counting Stars!" }), track);
assert.ok(punctuated > .5, `punctuation variant scored ${punctuated}`);
const typo = scoreLyricCandidate(candidate({ title: "Countin Stars" }), track);
assert.ok(typo > 0, `a single typo still matches, scored ${typo}`);
assert.equal(scoreLyricCandidate(candidate({ title: "Completely Different" }), track), 0, "distant title stays rejected");

// 4. textSimilarity is a symmetric LCS percentage.
assert.equal(textSimilarity("abc", "abc"), 100);
assert.equal(textSimilarity("abc", "abd"), 66.66666666666666);
assert.equal(textSimilarity("", "abc"), 0);
assert.equal(textSimilarity("abc", "abd"), textSimilarity("abd", "abc"));

// 5. Artist aliases bridge Chinese and Latin metadata.
assert.ok(artistAliases(normalizeLyricTag("Taylor Swift")).includes(normalizeLyricTag("霉霉")));
assert.ok(artistAliases(normalizeLyricTag("泰勒·斯威夫特")).includes(normalizeLyricTag("Taylor Swift")));
const chineseArtist = { title: "Love Story", artist: "泰勒·斯威夫特", duration: 235 };
const latinCandidate = { title: "Love Story", artists: ["Taylor Swift"], artist: "Taylor Swift", duration: 235 };
assert.ok(scoreLyricCandidate(latinCandidate, chineseArtist) > .6, "Chinese artist tag matches the Latin candidate");
const chineseCandidate = { title: "Love Story", artists: ["泰勒·斯威夫特"], artist: "泰勒·斯威夫特", duration: 235 };
assert.ok(scoreLyricCandidate(chineseCandidate, { title: "Love Story", artist: "Taylor Swift", duration: 235 }) > .6,
  "Latin artist tag matches the Chinese candidate");
// Alias expansion must not match every artist to every other artist.
assert.equal(scoreLyricCandidate(latinCandidate, { title: "Love Story", artist: "周杰伦", duration: 235 }), 0);
assert.deepEqual(artistAliases("nobodyinthelist"), ["nobodyinthelist"], "unknown artists fall back to themselves");

// 6. Ranking keeps order, threshold and the ambiguous-artist guard.
const ranked = rankLyricCandidates([
  candidate({ title: "Counting Stars (Live)", duration: 300 }),
  candidate({ duration: 258 }),
  candidate({ duration: 262 })
], track);
assert.ok(ranked.length >= 1, "at least one eligible candidate");
assert.ok(ranked.every(item => item.score >= .68), "ranked candidates clear the threshold");
assert.ok(ranked[0].score >= ranked[ranked.length - 1].score, "ranking is descending");
const ambiguous = rankLyricCandidates([
  { title: "Same Song", artists: ["Artist A"], artist: "Artist A", duration: 200 },
  { title: "Same Song", artists: ["Artist B"], artist: "Artist B", duration: 200 }
], { title: "Same Song", duration: 200 });
assert.deepEqual(ambiguous, [], "two artists with no requested artist is unsafe");

// 7. Helpers still behave.
assert.equal(cleanLyricTag(" 未知艺术家 "), "");
assert.equal(cleanLyricTag("  正常 标题  "), "正常 标题");
assert.equal(normalizeLyricTag("Taylor  Swift!"), "taylorswift");
assert.equal(isUsableLyricText("[00:01.00]hello"), true);
assert.equal(isUsableLyricText("纯音乐，请欣赏"), false);
assert.equal(isUsableLyricText("<html></html>"), false);

console.log("Lyric candidate matching passed");
