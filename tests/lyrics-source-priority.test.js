const assert = require("node:assert/strict");
const { resolveOnlineLyricProviders, selectLocalLyrics } = require("../src/lyrics-source-priority");

assert.deepEqual(resolveOnlineLyricProviders("auto"), ["qq", "netease"]);
assert.deepEqual(resolveOnlineLyricProviders("network"), ["qq", "netease"]);
assert.deepEqual(resolveOnlineLyricProviders(), ["qq", "netease"]);
assert.deepEqual(resolveOnlineLyricProviders("qq"), ["qq"]);
assert.deepEqual(resolveOnlineLyricProviders("netease"), ["netease"]);
assert.deepEqual(resolveOnlineLyricProviders("local"), []);

assert.deepEqual(selectLocalLyrics("embedded", "sidecar"), {
  text: "embedded", source: "embedded", confidence: null
});
assert.deepEqual(selectLocalLyrics("", "sidecar"), {
  text: "sidecar", source: "sidecar", confidence: null
});
assert.deepEqual(selectLocalLyrics("", ""), { text: "", source: null });

console.log("Lyric source priority tests passed");
