const assert = require("node:assert/strict");
const { isJayChouArtist, resolveOnlineLyricProviders, selectLocalLyrics } = require("../src/lyrics-source-priority");

assert.deepEqual(resolveOnlineLyricProviders("auto"), ["netease", "qq"]);
assert.deepEqual(resolveOnlineLyricProviders("network"), ["netease", "qq"]);
assert.deepEqual(resolveOnlineLyricProviders(), ["netease", "qq"]);
assert.deepEqual(resolveOnlineLyricProviders("qq"), ["qq"]);
assert.deepEqual(resolveOnlineLyricProviders("netease"), ["netease"]);
assert.deepEqual(resolveOnlineLyricProviders("local"), []);
assert.deepEqual(resolveOnlineLyricProviders("auto", "周杰伦"), ["qq", "netease"]);
assert.deepEqual(resolveOnlineLyricProviders("network", "Jay Chou"), ["qq", "netease"]);
assert.deepEqual(resolveOnlineLyricProviders("auto", "周杰伦 / 费玉清"), ["qq", "netease"]);
assert.deepEqual(resolveOnlineLyricProviders("auto", "G.E.M. 邓紫棋"), ["netease", "qq"]);
assert.deepEqual(resolveOnlineLyricProviders("qq", "邓紫棋"), ["qq"]);
assert.deepEqual(resolveOnlineLyricProviders("netease", "周杰伦"), ["netease"]);
assert.equal(isJayChouArtist("周杰伦"), true);
assert.equal(isJayChouArtist("Jay-Chou"), true);
assert.equal(isJayChouArtist("周杰伦- A-LNK"), true);
assert.equal(isJayChouArtist("林俊杰"), false);

assert.deepEqual(selectLocalLyrics("embedded", "sidecar"), {
  text: "embedded", source: "embedded", confidence: null
});
assert.deepEqual(selectLocalLyrics("", "sidecar"), {
  text: "sidecar", source: "sidecar", confidence: null
});
assert.deepEqual(selectLocalLyrics("", ""), { text: "", source: null });

console.log("Lyric source priority tests passed");
