const assert = require("node:assert/strict");
const { encryptQrc } = require("qrc-decoder");
const { fetchQqMusicLyrics } = require("../src/qq-music");
const { fetchNeteaseLyrics } = require("../src/netease-eapi");
const { createOnlineLyricsSearch } = require("../src/lyrics-search");
const line = "[00:01.00]逐字";
const word = "[1000,1000](1000,500,0)逐(1500,500,0)字";
const options = { title: "测试歌曲", artist: "歌手", duration: 180, requireWordTiming: true };

(async () => {
  const qrc = '[1000,1000]逐(1000,500)字(1500,500)';
  const encrypted = encryptQrc(`<QrcInfos><LyricInfo><Lyric_1 LyricContent="${qrc}"/></LyricInfo></QrcInfos>`);
  let qrcCalls = 0;
  const qqFetch = async (url, request) => {
    if (request?.headers?.["Content-Type"] === "application/json") return { ok: true, json: async () => ({
      req_1: { data: { body: { song: { list: [1, 2].map(id => ({ id, mid: `m${id}`, name: options.title, singer: [{ name: options.artist }], interval: 180 })) } } } }
    }) };
    if (url.includes('lyric_download')) {
      qrcCalls++;
      return { ok: true, text: async () => qrcCalls === 1 ? '' : `<content><![CDATA[${encrypted}]]></content>` };
    }
    return { ok: true, text: async () => `MusicJsonCallback_lrc(${JSON.stringify({ code: 0, lyric: Buffer.from(line).toString('base64') })})` };
  };
  assert.equal((await fetchQqMusicLyrics(options, qqFetch)).source, 'qq-word');
  assert.equal(qrcCalls, 2);
  let lyricCalls = 0;
  const netFetch = async (_url, request) => request?.method === 'POST'
    ? { ok: true, json: async () => ({ yrc: { lyric: ++lyricCalls === 1 ? 'invalid' : word }, lrc: { lyric: line } }) }
    : { ok: true, json: async () => ({ result: { songs: [1, 2].map(id => ({ id, name: options.title, ar: [{ name: options.artist }], dt: 180000 })) } }) };
  assert.equal((await fetchNeteaseLyrics(options, netFetch)).source, 'netease-word');
  assert.equal(lyricCalls, 2);
  let searches = 0;
  const liveFetch = async (_url, request) => request?.method === 'POST'
    ? { ok: true, json: async () => searches === 1 ? { lrc: { lyric: line } } : { yrc: { lyric: word } } }
    : { ok: true, json: async () => ({ result: { songs: [{ id: ++searches, name: searches === 1 ? '测试歌曲 (Live)' : options.title, ar: [{ name: options.artist }], dt: 180000 }] } }) };
  const searchLive = createOnlineLyricsSearch({
    getCache: async () => ({}),
    fetchImplementation: (url, request) => url.includes('lrclib')
      ? Promise.resolve({ ok: true, json: async () => [] }) : liveFetch(url, request)
  });
  assert.equal((await searchLive({ ...options, title: '测试歌曲 (Live)', mode: 'netease' })).source, 'netease-word');
  assert.equal(searches, 2);
  console.log('Word lyric providers passed: later candidates, invalid YRC and Live fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
