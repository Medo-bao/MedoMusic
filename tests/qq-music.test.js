const assert = require("node:assert/strict");
const { decodeQqLyricJsonp, fetchQqMusicLyrics } = require("../src/qq-music");

const callback = "MusicJsonCallback_lrc";
const lyric = "[00:01.00]测试歌词";
const payload = Buffer.from(lyric, "utf8").toString("base64");
assert.equal(decodeQqLyricJsonp(`${callback}(${JSON.stringify({ code: 0, lyric: payload })})`, callback), lyric);
assert.equal(decodeQqLyricJsonp("invalid", callback), null);

(async () => {
  const searchPayload = {
    req_1: { data: { body: { song: { list: [{ id: 1, mid: "demo-mid", name: "测试歌曲", interval: 180, singer: [{ name: "测试歌手" }] }] } } } }
  };
  const mockFetch = (timedText) => {
    let calls = 0;
    return async () => ++calls === 1
      ? { ok: true, json: async () => searchPayload }
      : { ok: true, text: async () => `${callback}(${JSON.stringify({ code: 0, lyric: Buffer.from(timedText).toString("base64") })})` };
  };
  const ordinary = await fetchQqMusicLyrics({ title: "测试歌曲", artist: "测试歌手", duration: 180 }, mockFetch("[00:01.00]普通歌词"));
  assert.equal(ordinary.source, "qq-line");
  const qrc = await fetchQqMusicLyrics({ title: "测试歌曲", artist: "测试歌手", duration: 180 }, mockFetch("[1000,1000]逐(1000,500)字(1500,500)"));
  assert.equal(qrc.source, "qq-word");
  console.log("QQ Music tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
