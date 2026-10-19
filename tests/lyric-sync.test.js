const assert = require("node:assert/strict");
const { lyricSyncLevel, hasWordLevelLines } = require("../src/lyric-sync");

const wordLine = start => ({ start, text: "word line", words: [{ start, end: start + 1, text: "word" }] });
const plainLine = start => ({ start, text: "plain line" });
const infoLine = () => ({ start: 0, text: "作词: 某人", information: true });

// Plain: no usable timeline at all.
assert.equal(lyricSyncLevel([], false), "plain");
assert.equal(lyricSyncLevel([{ start: null, text: "a" }], false), "plain");

// Line: timeline but no word timings anywhere.
assert.equal(lyricSyncLevel([plainLine(1), plainLine(5)], true), "line");
assert.equal(hasWordLevelLines([plainLine(1)]), false);

// Word: every timed line carries words.
assert.equal(lyricSyncLevel([wordLine(1), wordLine(6)], true), "word");
assert.equal(hasWordLevelLines([wordLine(1)]), true);

// Mixed: syllable lines plus credit / line-only lines.
assert.equal(lyricSyncLevel([infoLine(), wordLine(2), plainLine(8)], true), "mixed");
// Info lines never count against the word level.
assert.equal(lyricSyncLevel([infoLine(), wordLine(2), wordLine(9)], true), "word");
// A file made only of info lines stays line-synced rather than claiming words.
assert.equal(lyricSyncLevel([infoLine(), infoLine()], true), "line");
// estimated single-word fallbacks (approximate) are not real syllable timing.
assert.equal(lyricSyncLevel([
  { start: 1, text: "a line", approximateWords: true, words: [{ start: 1, end: 2, text: "a line", approximate: true }] }
], true), "line");

console.log("Lyric sync levels passed");
