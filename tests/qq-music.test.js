const assert = require("node:assert/strict");
const { encryptQrc } = require("qrc-decoder");
const { decodeQqLyricJsonp, extractQrcLyric, searchSongsFromPayload, fetchQqMusicLyrics } = require("../src/qq-music");

const callback = "MusicJsonCallback_lrc";
const lyric = "[00:01.00]测试歌词";
const payload = Buffer.from(lyric, "utf8").toString("base64");
assert.equal(decodeQqLyricJsonp(`${callback}(${JSON.stringify({ code: 0, lyric: payload })})`, callback), lyric);
assert.equal(decodeQqLyricJsonp("invalid", callback), null);

const qrcText = "[1000,1000]逐(1000,500)字(1500,500)";
const qrcXml = `<?xml version="1.0"?><QrcInfos><LyricInfo><Lyric_1 LyricType="1" LyricContent="${qrcText}"/></LyricInfo></QrcInfos>`;
const qrcResponse = `<!--<lyric><content type="file"><![CDATA[${encryptQrc(qrcXml)}]]></content></lyric>-->`;
assert.equal(extractQrcLyric(qrcResponse), qrcText);
assert.equal(extractQrcLyric("<content><![CDATA[invalid]]></content>"), null);

const song = { id: 1, mid: "demo-mid", name: "测试歌曲", interval: 180, singer: [{ name: "测试歌手" }] };
const searchPayload = { "music.search.SearchCgiService": { data: { body: { song: { list: [song] } } } } };
assert.deepEqual(searchSongsFromPayload(searchPayload), [song]);
assert.deepEqual(searchSongsFromPayload({ req_1: { data: { body: { song: { list: [song] } } } } }), [song]);

(async () => {
  const qrcFetch = async (_url, options) => options?.headers?.["Content-Type"] === "application/json"
    ? { ok: true, json: async () => searchPayload }
    : { ok: true, text: async () => qrcResponse };
  const qrc = await fetchQqMusicLyrics({ title: "测试歌曲", artist: "测试歌手", duration: 180 }, qrcFetch);
  assert.equal(qrc.source, "qq-word");
  assert.equal(qrc.text, qrcText);

  let calls = 0;
  const ordinaryFetch = async () => {
    calls += 1;
    if (calls === 1) return { ok: true, json: async () => searchPayload };
    if (calls === 2) return { ok: true, text: async () => "<lyric></lyric>" };
    return { ok: true, text: async () => `${callback}(${JSON.stringify({ code: 0, lyric: Buffer.from(lyric).toString("base64") })})` };
  };
  const ordinary = await fetchQqMusicLyrics({ title: "测试歌曲", artist: "测试歌手", duration: 180 }, ordinaryFetch);
  assert.equal(ordinary.source, "qq-line");
  assert.equal(calls, 3);

  const liveQueries = [];
  const liveFallbackFetch = async (_url, options) => {
    if (options?.headers?.["Content-Type"] === "application/json") {
      const query = JSON.parse(options.body)["music.search.SearchCgiService"].param.query;
      liveQueries.push(query);
      return {
        ok: true,
        json: async () => query.includes("Live")
          ? { "music.search.SearchCgiService": { data: { body: { song: { list: [] } } } } }
          : searchPayload
      };
    }
    return { ok: true, text: async () => qrcResponse };
  };
  const liveFallback = await fetchQqMusicLyrics(
    { title: "测试歌曲 (Live)", artist: "测试歌手", duration: 180 },
    liveFallbackFetch
  );
  assert.equal(liveFallback.source, "qq-word");
  assert.deepEqual(liveQueries, ["测试歌曲 (Live) 测试歌手", "测试歌曲 测试歌手"]);
  console.log("QQ Music tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
