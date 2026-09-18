const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { encryptQrc } = require("qrc-decoder");
const { fetchQqMusicLyrics } = require("../src/qq-music");
const { fetchNeteaseLyrics } = require("../src/netease-eapi");
const priority = require("../src/lyrics-source-priority");
const { hasNativeWordTiming } = require("../src/lyrics-timing");
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
  assert.equal((await fetchNeteaseLyrics({ ...options, title: '测试歌曲 (Live)' }, liveFetch)).source, 'netease-word');
  assert.equal(searches, 2);

  // Run the real IPC resolver with deterministic provider/cache responses.
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const handlerCode = source.slice(source.indexOf('  ipcMain.handle("music:lyrics"'), source.indexOf('  ipcMain.handle("lyrics:translate"'));
  const cache = {};
  const calls = [];
  let handler;
  let returnWords = true;
  const context = vm.createContext({ ...priority, hasNativeWordTiming, path, URLSearchParams,
    ipcMain: { handle: (_name, fn) => { handler = fn; } },
    getOnlineLyricsCache: async () => cache, scheduleOnlineLyricsCacheWrite: () => {},
    fetchQqMusicLyrics: async opts => { calls.push(`qq:${opts.title}`); return { text: line, source: 'qq-line' }; },
    fetchNeteaseLyrics: async opts => { calls.push(`netease:${opts.title}`); return { text: returnWords && opts.title === '测试歌曲' ? word : line, source: 'netease' }; }
  });
  vm.runInContext(handlerCode, context);
  const request = { ...options, title: '测试歌曲 English', mode: 'network', ignoreLocal: true, filePath: 'E:/song.mp3' };
  cache[JSON.stringify(['qq', request.title, options.artist, '', 180])] = { text: line, source: 'old-cache' };
  assert.equal((await handler(null, request)).text, word);
  assert.deepEqual(calls, ['qq:测试歌曲 English', 'netease:测试歌曲 English', 'qq:测试歌曲', 'netease:测试歌曲']);
  calls.length = 0;
  returnWords = false;
  assert.equal((await handler(null, { ...request, force: true })).text, line);
  assert.equal(calls.length, 4, 'Ordinary lyrics may only win after all provider/title attempts');
  console.log('Word lyric search passed: later candidates, invalid YRC, title retry, provider order and ordinary-cache bypass');
})().catch(error => { console.error(error); process.exitCode = 1; });
