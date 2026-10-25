// Exactly six scenarios, run after the complete search-depth repair.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOnlineLyricsSearch, LYRICS_CACHE_VERSION } = require('../src/lyrics-search');
const { normalizeLyricTag } = require('../src/lyrics-matching');
const { lyricTimingQuality } = require('../src/lyrics-timing');

const options = { title: '渲染离别', artist: '许嵩', album: '情侣装', duration: 283 };
const line = '[00:01.00]Fixture first line\n[00:04.00]Fixture second line';
const word = '[1000,1000](1000,500,0)Fixture(1500,500,0) words';
const qqSong = { id: 7335580, mid: 'original', name: options.title,
  singer: [{ name: options.artist }], album: { name: options.album }, interval: 282 };
const netSong = { id: 1868850716, name: options.title,
  ar: [{ name: options.artist }], al: { name: options.album }, dt: 282671 };
const response = value => ({ ok: true, status: 200,
  json: async () => value, text: async () => String(value) });

function fixture({ qqSongs = [], netSongs = [], native = false } = {}) {
  const state = { cache: {}, calls: [] };
  state.search = createOnlineLyricsSearch({
    getCache: async () => state.cache,
    fetchImplementation: async (input, init = {}) => {
      const url = new URL(input);
      if (url.href.includes('musicu.fcg')) {
        const param = JSON.parse(init.body)['music.search.SearchCgiService'].param;
        state.calls.push({ kind: 'qq-search', query: param.query, limit: param.num_per_page });
        return response({ req_1: { data: { body: { song: { list: qqSongs.slice(0, param.num_per_page) } } } } });
      }
      if (url.href.includes('cloudsearch')) {
        const limit = Number(url.searchParams.get('limit'));
        state.calls.push({ kind: 'net-search', query: url.searchParams.get('s'), limit });
        return response({ code: 200, result: { songs: netSongs.slice(0, limit) } });
      }
      const kind = url.href.includes('lyric_download') ? 'qq-word' :
        url.href.includes('fcg_query_lyric') ? 'qq-line' : url.href.includes('/eapi/') ? 'net-lyrics' : 'public';
      state.calls.push({ kind, id: kind === 'qq-word' ? new URLSearchParams(init.body).get('musicid') : null });
      if (kind === 'qq-word') return response('');
      if (kind === 'qq-line') return response(`MusicJsonCallback_lrc(${JSON.stringify({
        code: 0, lyric: Buffer.from(line).toString('base64')
      })})`);
      if (kind === 'net-lyrics') return response({ code: 200,
        ...(native ? { yrc: { lyric: word } } : {}), lrc: { lyric: line } });
      return response([]);
    }
  });
  return state;
}

const checks = [];
async function scenario(id, name, action) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Scenario did not finish within 30 seconds')), 30000);
  });
  try { checks.push({ id, name, status: 'PASS', ...await Promise.race([action(), deadline]) }); }
  catch (error) { checks.push({ id, name, status: 'FAIL', error: error.stack }); }
  finally { clearTimeout(timer); }
  console.log(JSON.stringify(checks.at(-1)));
}

async function main() {
  await scenario(1, 'QQ original beyond the first eight results is found', async () => {
    const clips = Array.from({ length: 8 }, (_, i) => ({ ...qqSong, id: i + 1, mid: `clip-${i}`, interval: 163 + i }));
    const state = fixture({ qqSongs: [...clips, qqSong] });
    const found = await state.search({ ...options, mode: 'qq' });
    assert.equal(found.source, 'qq-line');
    assert.equal(found.match.album, options.album);
    assert.equal(found.match.duration, 282);
    assert.deepEqual(state.calls.filter(c => c.kind === 'qq-word').map(c => c.id), ['7335580']);
    assert.equal(state.calls.filter(c => c.kind === 'qq-search').length, 1);
    return { originalPosition: 9, source: found.source, match: found.match };
  });

  await scenario(2, 'NetEase original beyond the first twelve results retains native words', async () => {
    const covers = Array.from({ length: 14 }, (_, i) => ({ ...netSong, id: i + 1, ar: [{ name: `其他歌手 ${i}` }] }));
    const state = fixture({ netSongs: [...covers, netSong], native: true });
    const found = await state.search({ ...options, mode: 'netease', requireWordTiming: true });
    assert.equal(found.source, 'netease-word');
    assert.equal(found.match.artist, options.artist);
    assert.equal(state.calls.filter(c => c.kind === 'net-lyrics').length, 1);
    assert.equal(state.calls.filter(c => c.kind === 'net-search').length, 1);
    return { originalPosition: 15, source: found.source, match: found.match };
  });

  await scenario(3, 'Expanded results still reject other artists, short clips and different versions', async () => {
    const state = fixture({ qqSongs: [
      { ...qqSong, singer: [{ name: '其他歌手' }] },
      { ...qqSong, interval: 252 },
      { ...qqSong, name: '渲染离别 (Live)' },
      { ...qqSong, name: '完全不同的歌曲' }
    ] });
    const found = await state.search({ ...options, mode: 'qq' });
    assert.equal(found.text, '');
    assert.equal(state.calls.filter(c => ['qq-word', 'qq-line', 'net-lyrics'].includes(c.kind)).length, 0);
    return { rejected: 4, lyricDownloads: 0 };
  });

  await scenario(4, 'Wider search pages preserve the four-candidate download bound and order', async () => {
    const songs = Array.from({ length: 30 }, (_, i) => ({ ...qqSong, id: i + 1, mid: `matching-${i}` }));
    const state = fixture({ qqSongs: songs });
    const found = await state.search({ ...options, mode: 'network', requireWordTiming: true });
    assert.equal(found.source, 'qq-line');
    assert.deepEqual(state.calls.filter(c => c.kind === 'qq-word').map(c => c.id), ['1', '2', '3', '4']);
    assert.equal(state.calls.filter(c => c.kind === 'qq-line').length, 4);
    assert.equal(state.calls.findIndex(c => c.kind === 'qq-line'), 5);
    return { searchedCandidates: 30, wordDownloads: 4, lineDownloads: 4 };
  });

  await scenario(5, 'Old empty and fallback caches requery and new successful cache is reused', async () => {
    for (const oldResult of [{ text: '', source: null }, { text: line, source: 'netease-line' }]) {
      const state = fixture({ netSongs: [netSong], native: true });
      const key = JSON.stringify([normalizeLyricTag(options.title), normalizeLyricTag(options.artist),
        normalizeLyricTag(options.album), options.duration, ['netease', 'qq'], true]);
      state.cache[key] = { version: 10, expiresAt: Date.now() + 86400000, result: oldResult };
      const searchOptions = { ...options, mode: 'netease', requireWordTiming: true };
      assert.equal((await state.search(searchOptions)).source, 'netease-word');
      assert.equal(state.cache[key].version, LYRICS_CACHE_VERSION);
      const requests = state.calls.length;
      assert.equal((await state.search(searchOptions)).source, 'netease-word');
      assert.equal(state.calls.length, requests);
    }
    return { oldCacheKinds: 2, cacheVersion: LYRICS_CACHE_VERSION, successfulCacheReused: true };
  });

  await scenario(6, 'Real song full metadata retrieves lyrics through the production search pipeline', async () => {
    const results = [];
    for (const mode of ['network', 'qq', 'netease']) {
      const requests = [];
      const search = createOnlineLyricsSearch({ getCache: async () => ({}),
        fetchImplementation: async (url, init) => {
          requests.push(new URL(url).pathname);
          return fetch(url, init);
        } });
      const start = Date.now();
      const found = await search({ ...options, mode, requireWordTiming: mode !== 'qq' });
      const quality = lyricTimingQuality(found.text);
      assert.ok(quality >= (mode === 'qq' ? 1 : 2), `${mode}: ${JSON.stringify({ ...found, text: undefined })}`);
      assert.equal(found.match.title, options.title);
      assert.equal(found.match.artist, options.artist);
      assert.ok(Math.abs(found.match.duration - options.duration) <= 3);
      assert.match(found.source, mode === 'netease' ? /^netease-/ : /^qq-/);
      results.push({ mode, source: found.source, quality, characters: found.text.length,
        match: found.match, elapsedMs: Date.now() - start, requests: requests.length });
    }
    return { results };
  });

  const output = path.join(__dirname, 'artifacts/lyrics-search-depth-20261021');
  fs.mkdirSync(output, { recursive: true });
  const passed = checks.filter(c => c.status === 'PASS').length;
  fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ total: 6, passed, checks }, null, 2));
  console.log(`${passed}/6 scenarios passed`);
  if (passed !== 6) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
