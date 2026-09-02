const assert = require("node:assert/strict");
const { decodeTextBuffer } = require("../src/text-decoder");

const lyric = "[00:00.00]你好世界";

assert.equal(decodeTextBuffer(Buffer.from(lyric, "utf8")), lyric);
assert.equal(decodeTextBuffer(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(lyric, "utf8")])), lyric);
assert.equal(decodeTextBuffer(Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(lyric, "utf16le")])), lyric);

const utf16be = Buffer.from(lyric, "utf16le");
for (let index = 0; index < utf16be.length; index += 2) {
  [utf16be[index], utf16be[index + 1]] = [utf16be[index + 1], utf16be[index]];
}
assert.equal(decodeTextBuffer(Buffer.concat([Buffer.from([0xFE, 0xFF]), utf16be])), lyric);

const gb18030 = Buffer.concat([
  Buffer.from("[00:00.00]", "ascii"),
  Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0xCA, 0xC0, 0xBD, 0xE7])
]);
assert.equal(decodeTextBuffer(gb18030), lyric);
const largeLyric = Buffer.alloc(2 * 1024 * 1024 + 1, 0x61);
assert.equal(decodeTextBuffer(largeLyric).length, largeLyric.length);

console.log("Text decoder tests passed");
