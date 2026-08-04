const assert = require("node:assert/strict");
const { createNeteaseEapiRequest, rankNeteaseSongs, fetchNeteaseLyrics } = require("../src/netease-eapi");

const request = createNeteaseEapiRequest("123456", 1700000000000, 7);
assert.equal(request.url, "https://interface3.music.163.com/eapi/song/lyric/v1");
assert.match(request.body, /^params=[0-9A-F]+$/);
assert.match(request.headers.Cookie, /appver=8\.0\.0/);
assert.match(request.headers.Cookie, /requestId=1700000000000_0007/);
assert.equal(request.headers.Referer, "https://music.163.com/");

const official = { id: 1, name: "测试歌曲", ar: [{ name: "测试歌手" }], dt: 180000 };
const wrongCover = { id: 2, name: "测试歌曲", ar: [{ name: "测试歌手 Remix" }], dt: 120000 };
const misleadingArtist = { id: 3, name: "测试歌曲", ar: [{ name: "测试歌手 ABCDEFG" }], dt: 180000 };
assert.equal(rankNeteaseSongs([wrongCover, official], { title: "测试歌曲", artist: "测试歌手", duration: 180 })[0].song.id, 1);
assert.equal(rankNeteaseSongs([wrongCover], { title: "测试歌曲", artist: "测试歌手", duration: 180 })[0].score, 0);
assert.equal(rankNeteaseSongs([misleadingArtist], { title: "测试歌曲", artist: "测试歌手", duration: 180 })[0].score, 0);

(async () => {
  let calls = 0;
  const mockFetch = async (_url, options) => {
    calls += 1;
    if (options?.method !== "POST") {
      return { ok: true, json: async () => ({ result: { songs: [official] } }) };
    }
    return { ok: true, json: async () => ({ code: 200, yrc: { lyric: '[1000,1000](1000,500,0)逐(1500,500,0)字' }, lrc: { lyric: "[00:01.00]逐字" } }) };
  };
  const result = await fetchNeteaseLyrics({ title: "测试歌曲", artist: "测试歌手", duration: 180 }, mockFetch);
  assert.equal(result.source, "netease-word");
  assert.equal(result.match.artist, "测试歌手");
  assert.equal(calls, 2);
  console.log("Netease EAPI tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
