const assert = require("node:assert/strict");
const { completeWordTimings, resolveYrcWordStart, hasNativeWordTiming, standardizeNativeWords } = require("../src/lyrics-timing");

assert.equal(resolveYrcWordStart(10, 10, 0), 10, "absolute YRC word timestamp changed");
assert.equal(resolveYrcWordStart(10, 0, 0), 10, "relative YRC word timestamp was not anchored to its line");
assert.equal(resolveYrcWordStart(10, 10, 250), 10.25, "YRC offset was not applied");
assert.equal(resolveYrcWordStart(10, .5, -200), 10.3, "relative YRC offset was not applied");
assert.equal(hasNativeWordTiming("[10000,3000](10000,500,0)逐(10500,500,0)字"), true, "YRC timing was not detected");
assert.equal(hasNativeWordTiming("[00:10.00]<00:10.00>逐<00:10.50>字"), true, "enhanced LRC timing was not detected");
assert.equal(hasNativeWordTiming("[00:10.00]普通歌词"), false, "ordinary LRC was mistaken for native word timing");
assert.equal(hasNativeWordTiming("[10000,3000]逐(10000,500)字(10500,500)"), true, "QRC timing was not detected");
assert.deepEqual(standardizeNativeWords([
  { start: 1, end: 1.4, text: "Hello" },
  { start: 1.4, end: 1.4, text: " " },
  { start: 1.4, end: 1.5, text: "," },
  { start: 1.5, end: 2, text: "world" }
]), [
  { start: 1, end: 1.5, text: "Hello ," },
  { start: 1.5, end: 2, text: "world" }
]);

const approximate = completeWordTimings([
  { start: 10, text: "第一句" },
  { start: 14, text: "第二句" }
], 20);
assert.deepEqual(approximate[0].words, [{ start: 10, end: 13.4, text: "第一句", approximate: true }]);
assert.deepEqual(approximate[1].words, [{ start: 14, end: 19.1, text: "第二句", approximate: true }]);
assert.equal(approximate[0].approximateWords, true);

const nativeWords = completeWordTimings([{
  start: 5,
  text: "hello world",
  words: [
    { start: 5, text: "hello " },
    { start: 6.2, end: 7.1, text: "world" }
  ]
}, { start: 8, text: "next" }], 12);
assert.equal(nativeWords[0].words[0].end, 6.2);
assert.equal(nativeWords[0].words[1].end, 7.1);
assert.equal(nativeWords[0].approximateWords, undefined);

const plain = [{ start: null, text: "no timeline" }];
assert.deepEqual(completeWordTimings(plain, 0), plain);

console.log("Lyric timing tests passed");
