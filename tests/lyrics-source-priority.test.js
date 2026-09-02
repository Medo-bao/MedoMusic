const assert = require("node:assert/strict");
const { resolveOnlineLyricProviders, selectLocalLyrics, removeLiveQualifier, removeEnglishSuffixFromChineseTitle } = require("../src/lyrics-source-priority");

assert.deepEqual(resolveOnlineLyricProviders("auto"), ["qq", "netease"]);
assert.deepEqual(resolveOnlineLyricProviders("network"), ["qq", "netease"]);
assert.deepEqual(resolveOnlineLyricProviders(), ["qq", "netease"]);
assert.deepEqual(resolveOnlineLyricProviders("qq"), ["qq"]);
assert.deepEqual(resolveOnlineLyricProviders("qq", true), ["qq", "netease"]);
assert.deepEqual(resolveOnlineLyricProviders("netease"), ["netease"]);
assert.deepEqual(resolveOnlineLyricProviders("local"), []);

assert.deepEqual(selectLocalLyrics("embedded", "sidecar"), {
  text: "embedded", source: "embedded", confidence: null
});
assert.deepEqual(selectLocalLyrics("", "sidecar"), {
  text: "sidecar", source: "sidecar", confidence: null
});
assert.deepEqual(selectLocalLyrics("", ""), { text: "", source: null });

assert.equal(removeLiveQualifier("测试歌曲 (Live)"), "测试歌曲");
assert.equal(removeLiveQualifier("测试歌曲（Live版）"), "测试歌曲");
assert.equal(removeLiveQualifier("测试歌曲 - Live Version"), "测试歌曲");
assert.equal(removeLiveQualifier("测试歌曲 LIVE"), "测试歌曲");
assert.equal(removeLiveQualifier("Alive"), null);
assert.equal(removeLiveQualifier("Live and Learn"), null);

assert.equal(removeEnglishSuffixFromChineseTitle("搁浅 Stranded"), "搁浅");
assert.equal(removeEnglishSuffixFromChineseTitle("搁浅（Stranded）"), "搁浅");
assert.equal(removeEnglishSuffixFromChineseTitle("搁浅 - Stranded Version"), "搁浅");
assert.equal(removeEnglishSuffixFromChineseTitle("晴天Sunny Day"), "晴天");
assert.equal(removeEnglishSuffixFromChineseTitle("Stranded 搁浅"), null);
assert.equal(removeEnglishSuffixFromChineseTitle("Live and Learn"), null);

console.log("Lyric source priority tests passed");
