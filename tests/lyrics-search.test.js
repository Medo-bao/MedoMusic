const assert = require("node:assert/strict");
const { test } = require("node:test");
const { encryptQrc } = require("qrc-decoder");
const { createOnlineLyricsSearch, LYRICS_CACHE_VERSION } = require("../src/lyrics-search");
const { normalizeLyricOptions, scoreLyricCandidate, rankLyricCandidates, isUsableLyricText } = require("../src/lyrics-matching");

const line = "[00:01.00]测试歌词";
const words = "[1000,1000](1000,500,0)测(1500,500,0)试";
const qrc = "[1000,1000]测(1000,500)试(1500,500)";
const encrypted = encryptQrc(`<QrcInfos><LyricInfo><Lyric_1 LyricContent="${qrc}"/></LyricInfo></QrcInfos>`);
const options = { title: "测试歌曲", artist: "测试歌手", album: "测试专辑", duration: 180, mode: "auto" };
const qqSong = { id: 1, mid: "fixture-1", name: options.title, singer: [{ name: options.artist }], interval: 180 };
const netSong = { id: 1, name: options.title, ar: [{ name: options.artist }], dt: 180000 };
const publicSong = { trackName: options.title, artistName: options.artist, albumName: options.album, duration: 180, syncedLyrics: line };
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status,
  json: async () => value, text: async () => String(value) });

function fixture(reply) {
  const state = { calls: [], cache: {}, qqSongs: [qqSong], netSongs: [], publicSongs: [], qqWords: false };
  state.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const kind = url.href.includes("musicu.fcg") ? "qq-search" : url.href.includes("lyric_download") ? "qq-word" :
      url.pathname.includes("fcg_query_lyric") ? "qq-line" :
      url.pathname.includes("cloudsearch") ? "netease-search" : url.pathname.includes("eapi/") ? "netease-lyrics" :
      url.pathname.endsWith("/get") ? "public-get" : "public-search";
    const query = kind === "qq-search" ? JSON.parse(init.body)["music.search.SearchCgiService"].param.query :
      kind === "netease-search" ? url.searchParams.get("s") : url.searchParams.get("track_name");
    const call = { kind, url, init, query };
    state.calls.push(call);
    const overridden = reply && await reply(call, state);
    if (overridden !== undefined) return overridden;
    if (kind === "qq-search") return response({ req_1: { data: { body: { song: { list: state.qqSongs } } } } });
    if (kind === "qq-word") return response(state.qqWords ? `<content><![CDATA[${encrypted}]]></content>` : "");
    if (kind === "qq-line") return response(`MusicJsonCallback_lrc(${JSON.stringify({ code: 0, lyric: Buffer.from(line).toString("base64") })});`);
    if (kind === "netease-search") return response({ result: { songs: state.netSongs } });
    if (kind === "netease-lyrics") return response({ lrc: { lyric: line } });
    if (kind === "public-get") return response(null, 404);
    return response(state.publicSongs);
  };
  state.search = config => createOnlineLyricsSearch({ getCache: async () => state.cache, fetchImplementation: state.fetch, ...config });
  return state;
}

function waitForAbort(signal, onAbort = () => {}) {
  return new Promise((_resolve, reject) => {
    const abort = () => { onAbort(); reject(signal.reason); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

test("04: reject other titles, singers, versions and durations; accept exact collaborations", () => {
  const candidate = { title: options.title, artist: options.artist, album: options.album, duration: 180 };
  assert(scoreLyricCandidate(candidate, options) > .9);
  for (const changed of [{ title: "测试歌曲续篇" }, { artist: "测试歌手翻唱" }, { artist: "其他歌手" },
    { title: "测试歌曲 (Live)" }, { title: "测试歌曲 (Remix)" }, { duration: 240 }]) {
    assert.equal(scoreLyricCandidate({ ...candidate, ...changed }, options), 0);
  }
  assert(scoreLyricCandidate({ ...candidate, artists: ["Beyoncé", "歌手乙"] }, { ...options, artist: "Beyonce / 歌手乙" }) > .9);
  assert(scoreLyricCandidate({ ...candidate, title: "测试歌曲 (Official Audio)" }, options) > .9);
});

test("05: unknown tags and missing duration search successfully; title-only retries retain singer checks", async () => {
  assert.deepEqual(normalizeLyricOptions({ title: " 测试歌曲 ", artist: "未知艺术家", album: "Unknown Album", duration: Infinity }),
    { title: "测试歌曲", artist: "", album: "", duration: 0 });
  for (const provider of ["qq", "netease"]) {
    const state = fixture();
    if (provider === "netease") { state.qqSongs = []; state.netSongs = [netSong]; }
    const result = await state.search()({ ...options, mode: provider, artist: "未知艺术家", album: "未知专辑", duration: 0 });
    assert.equal(result.source, `${provider}-line`);
    assert.equal(state.calls[0].query, options.title);
    const retry = fixture(call => call.kind === `${provider}-search` && call.query.includes(options.artist)
      ? response(provider === "qq" ? { req_1: { data: { body: { song: { list: [] } } } } } : { result: { songs: [] } }) : undefined);
    retry.qqSongs = [qqSong]; retry.netSongs = [netSong];
    assert.equal((await retry.search()({ ...options, mode: provider })).source, `${provider}-line`);
    assert.deepEqual(retry.calls.filter(call => call.kind === `${provider}-search`).map(call => call.query),
      [`${options.title} ${options.artist}`, options.title]);
  }
});

test("06: LRCLIB rejects wrong singer/version and lyric-less records, then finds a valid title-only result", async () => {
  const state = fixture(call => {
    if (call.kind === "public-get") return response({ ...publicSong, artistName: "其他歌手" });
    if (call.kind === "public-search" && call.url.searchParams.has("artist_name")) return response([{ ...publicSong, artistName: "其他歌手" }]);
    return undefined;
  });
  state.qqSongs = [];
  state.publicSongs = [{ ...publicSong, artistName: "其他歌手" }, { ...publicSong, trackName: "测试歌曲续篇" },
    { ...publicSong, trackName: "测试歌曲 (Live)" }, { ...publicSong, syncedLyrics: "[ti:测试歌曲]" }, publicSong];
  const result = await state.search()(options);
  assert.equal(result.source, "lrclib");
  assert.equal(result.match.artist, options.artist);
  assert.equal(state.calls.at(-1).url.searchParams.has("artist_name"), false);
  state.publicSongs = [{ ...publicSong, artistName: "其他歌手" }];
  assert.equal((await state.search()({ ...options, force: true })).text, "");
});

test("07: word mode tries later candidates and the next provider before accepting line lyrics", async () => {
  let lyricCalls = 0;
  const state = fixture(call => call.kind === "netease-lyrics"
    ? response({ yrc: { lyric: ++lyricCalls === 1 ? "invalid" : words }, lrc: { lyric: line } }) : undefined);
  state.netSongs = [netSong, { ...netSong, id: 2 }];
  const result = await state.search()({ ...options, mode: "network" });
  assert.equal(result.source, "netease-word");
  assert.equal(lyricCalls, 2);
  assert.equal(state.calls[0].kind, "qq-search");
  const preferred = fixture();
  preferred.qqWords = true;
  assert.equal((await preferred.search()({ ...options, mode: "netease", requireWordTiming: true })).source, "qq-word");
  assert.equal(preferred.calls[0].kind, "netease-search");
});

test("08: exhaust original-title sources before Live and Chinese-title fallback", async () => {
  const mixed = fixture(call => call.kind === "qq-search"
    ? response({ req_1: { data: { body: { song: { list: call.query === `${options.title} ${options.artist}` ? [qqSong] : [] } } } } }) : undefined);
  assert.equal((await mixed.search()({ ...options, title: `${options.title} English` })).source, "qq-line");
  const originalPublic = mixed.calls.findIndex(call => call.kind === "public-search" && call.query.includes("English"));
  const chineseQQ = mixed.calls.findIndex(call => call.kind === "qq-search" && call.query === `${options.title} ${options.artist}`);
  assert(originalPublic >= 0 && originalPublic < chineseQQ);
  const live = fixture(call => call.kind === "netease-lyrics" ? response({ yrc: { lyric: words } }) : undefined);
  live.netSongs = [{ ...netSong, name: `${options.title} (Live)` }];
  assert.equal((await live.search()({ ...options, title: `${options.title} (Live)`, mode: "network" })).source, "netease-word");
  assert(!live.calls.some(call => call.kind === "qq-search" && call.query === `${options.title} ${options.artist}`));
});

test("09: cache schema, expiry and forced refresh cannot keep stale matches", async () => {
  let timestamp = 1000000;
  const state = fixture();
  const search = state.search({ now: () => timestamp });
  await search(options);
  const key = Object.keys(state.cache)[0];
  assert.equal(state.cache[key].version, LYRICS_CACHE_VERSION);
  let count = state.calls.length;
  await search(options);
  assert.equal(state.calls.length, count);
  state.cache[key].version = 2;
  await search(options);
  assert(state.calls.length > count);
  count = state.calls.length;
  timestamp = state.cache[key].expiresAt + 1;
  await search(options);
  assert(state.calls.length > count);
  count = state.calls.length;
  await search({ ...options, force: true });
  assert(state.calls.length > count);
});

test("10: ordinary caches do not pin word searches; temporary line fallbacks expire and upgrade", async () => {
  let timestamp = 1000000;
  const state = fixture();
  const search = state.search({ now: () => timestamp });
  await search(options);
  const before = state.calls.length;
  const first = await search({ ...options, mode: "network" });
  assert.equal(first.source, "qq-line");
  assert(state.calls.length > before);
  assert.equal(first.retryAt - timestamp, 60000);
  state.qqWords = true;
  timestamp = first.retryAt + 1;
  assert.equal((await search({ ...options, mode: "network" })).source, "qq-word");
});

test("11: clean misses and provider failures use different feedback and short retry caches", async () => {
  let timestamp = 1000000;
  const clean = fixture(); clean.qqSongs = [];
  const cleanResult = await clean.search({ now: () => timestamp })(options);
  assert.equal(cleanResult.error, undefined);
  assert.equal(cleanResult.retryAt - timestamp, 120000);
  const failed = fixture(() => response(null, 503));
  const search = failed.search({ now: () => timestamp });
  const unavailable = await search(options);
  assert.equal(unavailable.error, "network");
  assert.equal(unavailable.retryAt - timestamp, 15000);
  const count = failed.calls.length;
  await search(options);
  assert.equal(failed.calls.length, count);
  timestamp = unavailable.retryAt + 1;
  await search(options);
  assert(failed.calls.length > count);
  const logicalFailure = fixture(call => call.kind === "qq-search" ? response({ code: 403 }) : response(null, 404));
  assert.equal((await logicalFailure.search()(options)).error, "network");
});

test("12: per-request/provider timeouts fall through; total timeout bounds the whole search", async () => {
  let aborted = 0;
  const recover = fixture(call => call.kind.startsWith("qq") ? waitForAbort(call.init.signal, () => aborted++) : undefined);
  recover.netSongs = [netSong];
  const recovered = await recover.search({ requestTimeoutMs: 20, providerTimeoutMs: 45, totalTimeoutMs: 500 })(options);
  assert.equal(recovered.source, "netease-line");
  assert(aborted > 0);
  const stalled = fixture(call => waitForAbort(call.init.signal));
  const started = Date.now();
  const timed = await stalled.search({ requestTimeoutMs: 500, providerTimeoutMs: 100, totalTimeoutMs: 45 })(options);
  assert.equal(timed.error, "timeout");
  assert(Date.now() - started < 1000);
});

test("13: cancellation aborts active requests without caching; candidate and request counts stay bounded", async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let aborted = 0;
  const pending = fixture(call => { started(); return waitForAbort(call.init.signal, () => aborted++); });
  const controller = new AbortController();
  const result = pending.search()(options, { signal: controller.signal });
  await ready;
  controller.abort();
  assert.equal((await result).cancelled, true);
  assert(aborted > 0);
  assert.equal(Object.keys(pending.cache).length, 0);
  const bounded = fixture();
  bounded.qqSongs = Array.from({ length: 20 }, (_, index) => ({ ...qqSong, id: index + 1, mid: `m${index}` }));
  await bounded.search({ maxRequests: 6 })({ ...options, mode: "network" });
  assert(bounded.calls.length <= 6);
  const candidates = fixture(); candidates.qqSongs = bounded.qqSongs;
  await candidates.search()({ ...options, mode: "network" });
  assert.equal(candidates.calls.filter(call => call.kind === "qq-word").length, 4);
});

test("14: invalid lyric bodies do not block fallbacks; ambiguous untagged recordings are rejected", async () => {
  for (const text of ["", "[ti:测试歌曲]\n[ar:测试歌手]", "[00:01.00]", "<html>Unavailable</html>", "纯音乐，请欣赏"]) {
    assert.equal(isUsableLyricText(text), false);
  }
  assert(isUsableLyricText(words));
  const state = fixture(call => call.kind === "qq-line"
    ? response(`MusicJsonCallback_lrc(${JSON.stringify({ code: 0, lyric: Buffer.from("[ti:测试歌曲]").toString("base64") })})`) : undefined);
  state.netSongs = [netSong];
  assert.equal((await state.search()(options)).source, "netease-line");
  const candidates = ["甲", "乙"].map(artist => ({ title: options.title, artist, duration: 180 }));
  assert.deepEqual(rankLyricCandidates(candidates, { ...options, artist: "" }), []);
  assert.equal(rankLyricCandidates(candidates.slice(0, 1), { title: options.title })[0].artist, "甲");
});
