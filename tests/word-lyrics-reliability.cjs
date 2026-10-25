// Exactly eight scenarios, run after the complete word-lookup change.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { encryptQrc } = require('qrc-decoder');
const { _electron } = require('playwright');
const { createOnlineLyricsSearch, LYRICS_CACHE_VERSION } = require('../src/lyrics-search');
const { hasNativeWordTiming } = require('../src/lyrics-timing');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'artifacts/word-lookup-reliability-20261020');
fs.mkdirSync(output, { recursive: true });
const reportPath = path.join(output, 'checks.json');
const prior = require.main === module && process.argv.includes('--retry-failed') ? JSON.parse(fs.readFileSync(reportPath)) : null;
const checks = [];
const options = { title: '测试歌曲', artist: '歌手', album: '专辑', duration: 180, mode: 'auto', requireWordTiming: true };
const line = '[00:01.00]Ordinary first line\n[00:03.00]Ordinary second line';
const word = '[1000,1000]Native(1000,500) words(1500,500)';
const yrc = '[1000,1000](1000,500,0)Native(1500,500,0) words';
const qrc = `<content><![CDATA[${encryptQrc(`<QrcInfos><LyricInfo><Lyric_1 LyricContent="${word}"/></LyricInfo></QrcInfos>`) }]]></content>`;
const qqSong = { id: 1, mid: 'm1', name: options.title, singer: [{ name: options.artist }], album: { name: options.album }, interval: 180 };
const netSong = { id: 1, name: options.title, ar: [{ name: options.artist }], al: { name: options.album }, dt: 180000 };
const publicSong = { trackName: options.title, artistName: options.artist, albumName: options.album, duration: 180, syncedLyrics: line };
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value, text: async () => String(value) });
const lineResponse = (text = line, translation = '') => response(`MusicJsonCallback_lrc(${JSON.stringify({ code: 0, lyric: Buffer.from(text).toString('base64'), trans: Buffer.from(translation).toString('base64') })})`);
const pending = signal => new Promise((_resolve, reject) => {
  const abort = () => reject(signal.reason);
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
});

function fixture(reply, config = {}) {
  const state = { cache: {}, calls: [], qqSongs: [qqSong], netSongs: [netSong], qqWords: false, netWords: false };
  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(input);
    const kind = url.href.includes('musicu.fcg') ? 'qq-search' : url.href.includes('lyric_download') ? 'qq-word' :
      url.href.includes('fcg_query_lyric') ? 'qq-line' : url.href.includes('cloudsearch') ? 'net-search' : url.href.includes('/eapi/') ? 'net-lyrics' : 'public';
    const query = kind === 'qq-search' ? JSON.parse(init.body)['music.search.SearchCgiService'].param.query : kind === 'net-search' ? url.searchParams.get('s') : url.searchParams.get('track_name');
    const call = { kind, query, id: kind === 'qq-word' ? new URLSearchParams(init.body).get('musicid') : null, url, init };
    state.calls.push(call); call.number = state.calls.filter(item => item.kind === kind).length;
    const overridden = reply && await reply(call, state);
    if (overridden !== undefined) return overridden;
    if (kind === 'qq-search') return response({ req_1: { data: { body: { song: { list: state.qqSongs } } } } });
    if (kind === 'qq-word') return response(state.qqWords ? qrc : '');
    if (kind === 'qq-line') return lineResponse();
    if (kind === 'net-search') return response({ result: { songs: state.netSongs } });
    if (kind === 'net-lyrics') return response(state.netWords ? { yrc: { lyric: yrc } } : { lrc: { lyric: line } });
    return response([]);
  };
  state.search = createOnlineLyricsSearch({ getCache: async () => state.cache, fetchImplementation, ...config });
  return state;
}

async function scenario(id, name, action) {
  const previous = prior?.checks.find(item => item.id === id);
  if (previous?.status === 'PASS') checks.push({ ...previous, reused: true });
  else {
    try { checks.push({ id, name, status: 'PASS', ...await action() }); }
    catch (error) { checks.push({ id, name, status: 'FAIL', error: error.stack || String(error) }); }
  }
  fs.writeFileSync(reportPath, JSON.stringify({ total: 8, passed: checks.filter(item => item.status === 'PASS').length, checks }, null, 2));
  console.log(JSON.stringify(checks.at(-1)));
}

async function rendererScenario() {
  const folder = fs.mkdtempSync(path.join(output, 'ipc-'));
  fs.mkdirSync(path.join(folder, 'Music'));
  const filePath = path.join(folder, 'Fixture.wav');
  const audio = Buffer.alloc(44 + 48000 * 4);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(2, 22); audio.writeUInt32LE(48000, 24);
  audio.writeUInt32LE(192000, 28); audio.writeUInt16LE(4, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  fs.writeFileSync(filePath, audio); fs.writeFileSync(filePath.replace('.wav', '.lrc'), line);
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'medo-word-reliability', version: '1.6.4', main: 'main.cjs' }));
  fs.writeFileSync(path.join(folder, 'main.cjs'), `
    const {app,globalShortcut,shell}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(folder, 'Profile'))});app.setPath('music',${JSON.stringify(path.join(folder, 'Music'))});
    const keys=new Set();globalShortcut.register=key=>{keys.add(key);return true;};globalShortcut.isRegistered=key=>keys.has(key);globalShortcut.unregister=key=>keys.delete(key);shell.openExternal=async()=>{};
    const state=globalThis.__reliable={mode:'line',wordCalls:0};
    const response=(data,status=200)=>({ok:status<400,status,json:async()=>data,text:async()=>String(data)});
    globalThis.fetch=async(input)=>{
      const url=String(input);if(url.startsWith('https://api.github.com/'))return response({tag_name:'v1.6.4'});
      if(state.mode==='failure')return response(null,503);
      if(url.includes('musicu.fcg'))return response({req_1:{data:{body:{song:{list:[${JSON.stringify(qqSong)}]}}}}});
      if(url.includes('lyric_download')){state.wordCalls++;if(state.mode==='transient'&&state.wordCalls===1)return response(null,503);return response(state.mode==='word'||state.mode==='transient'?${JSON.stringify(qrc)}:'');}
      if(url.includes('fcg_query_lyric'))return response(${JSON.stringify(`MusicJsonCallback_lrc(${JSON.stringify({ code: 0, lyric: Buffer.from(line).toString('base64') })})`)});
      if(url.includes('cloudsearch'))return response({result:{songs:[${JSON.stringify(netSong)}]}});
      if(url.includes('/eapi/'))return response({lrc:{lyric:${JSON.stringify(line)}}});
      return response([]);
    };
    require(${JSON.stringify(path.join(root, 'src/main.js'))});
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, '.electron-dist/electron.exe'), args: [folder], cwd: root, env });
  const errors = [];
  try {
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof lastShortcutStates !== 'undefined' && lastShortcutStates.size === 5 && localStorage.getItem('medo.initialScanComplete') === 'true');
    await page.evaluate(async track => {
      applyAutoUpdateSetting(false); lyricTranslationEnabled = false; wordLyricsEnabled = true;
      tracks = [track]; currentIndex = 0; playbackQueueIds = [track.id];
      await ensureLyrics(track); openPlaybackDetail();
    }, { id: 'reliability', title: options.title, artist: options.artist, album: options.album, duration: 180, path: filePath, metadataLoaded: true });
    assert.equal(await page.evaluate(() => lyricsCache.get('reliability').source), 'sidecar');
    await app.evaluate(() => { globalThis.__reliable.mode = 'transient'; globalThis.__reliable.wordCalls = 0; });
    const upgraded = await page.evaluate(async () => {
      await refreshCurrentLyricsFromNetwork(); const entry = lyricsCache.get('reliability');
      return { source: entry.source, words: MedoLyricSync.hasWordLevelLines(entry.lines), hidden: document.querySelector('#lyric-status').hidden };
    });
    assert.deepEqual(upgraded, { source: 'qq-word', words: true, hidden: true });
    assert.equal(await app.evaluate(() => globalThis.__reliable.wordCalls), 2);
    await app.evaluate(() => { globalThis.__reliable.mode = 'line'; });
    const retained = await page.evaluate(async () => {
      const old = lyricsCache.get('reliability'); lyricTranslations.set('reliability', ['已有翻译']);
      await refreshCurrentLyricsFromNetwork(); const entry = lyricsCache.get('reliability');
      return { sameEntry: entry === old, words: MedoLyricSync.hasWordLevelLines(entry.lines), source: entry.source, translation: lyricTranslations.get('reliability') };
    });
    assert.deepEqual(retained, { sameEntry: true, words: true, source: 'qq-word', translation: ['已有翻译'] });
    await app.evaluate(() => { globalThis.__reliable.mode = 'failure'; });
    await page.evaluate(() => refreshCurrentLyricsFromNetwork());
    assert.equal(await page.evaluate(() => lyricsCache.get('reliability').refreshError), 'network');
    await app.evaluate(() => { globalThis.__reliable.mode = 'word'; });
    await page.evaluate(() => refreshCurrentLyricsFromNetwork());
    assert.equal(await page.evaluate(() => lyricsCache.get('reliability').refreshError || null), null);
    await app.evaluate(() => { globalThis.__reliable.mode = 'line'; });
    const ordinary = await page.evaluate(async () => {
      wordLyricsEnabled = false; await ensureLyrics(tracks[0], true, 'netease');
      return { source: lyricsCache.get('reliability').source, words: MedoLyricSync.hasWordLevelLines(lyricsCache.get('reliability').lines), hidden: document.querySelector('#lyric-status').hidden };
    });
    assert.deepEqual(ordinary, { source: 'netease-line', words: false, hidden: true }); assert.deepEqual(errors, []);
    return { upgraded, retained, ordinary, rendererErrors: errors };
  } finally { await app.close(); }
}

async function main() {
  await scenario(1, 'Later QQ word candidates are checked before slow line downloads', async () => {
    const state = fixture(call => call.kind === 'qq-word' && call.id === '2' ? response(qrc) : call.kind === 'qq-line' ? pending(call.init.signal) : undefined,
      { requestTimeoutMs: 100, providerTimeoutMs: 150, totalTimeoutMs: 600 });
    state.qqSongs = [qqSong, { ...qqSong, id: 2, mid: 'm2' }];
    const found = await state.search(options); assert.equal(found.source, 'qq-word');
    assert.deepEqual(state.calls.map(call => call.kind), ['qq-search', 'qq-word', 'qq-word']);
    const ordinary = fixture(); const normal = await ordinary.search({ ...options, requireWordTiming: false, mode: 'qq' });
    assert.equal(normal.source, 'qq-line'); assert.deepEqual(ordinary.calls.map(call => call.kind), ['qq-search', 'qq-word', 'qq-line']);
    return { source: found.source, lineDownloadsBeforeWordResult: 0, ordinaryModePreserved: true };
  });

  await scenario(2, 'Transient QQ/NetEase failures retry once inside the same request budget', async () => {
    const vectors = [];
    for (const failedKind of ['qq-search', 'qq-word', 'net-search', 'net-lyrics']) {
      const state = fixture(call => call.kind === failedKind && call.number === 1 ? response(null, 503) : undefined);
      state.qqWords = true; state.netWords = true;
      const found = await state.search({ ...options, mode: failedKind.startsWith('qq') ? 'qq' : 'netease' });
      assert.match(found.source, /-word$/); assert.equal(state.calls.filter(call => call.kind === failedKind).length, 2);
      vectors.push({ failedKind, source: found.source, attempts: 2 });
    }
    const timed = fixture(call => call.kind === 'qq-word' && call.number === 1 ? pending(call.init.signal) : undefined,
      { requestTimeoutMs: 80, providerTimeoutMs: 300, totalTimeoutMs: 1000 });
    timed.qqWords = true; assert.equal((await timed.search(options)).source, 'qq-word');
    assert.equal(timed.calls.filter(call => call.kind === 'qq-word').length, 2);
    const rateLimited = fixture(call => call.kind === 'qq-word' ? response(null, 429) : undefined);
    await rateLimited.search(options); assert.equal(rateLimited.calls.filter(call => call.kind === 'qq-word').length, 1);
    return { vectors, timeoutRecovered: true, rateLimitNotRetried: true };
  });

  await scenario(3, 'Word-capable title variants precede LRCLIB while ordinary lookup keeps its order', async () => {
    const mixedOptions = { ...options, title: options.title + ' Stranded' };
    const state = fixture(call => {
      if (call.kind === 'qq-search' && call.query.includes('Stranded')) return response({ req_1: { data: { body: { song: { list: [] } } } } });
      if (call.kind === 'net-search') return response({ result: { songs: [] } });
      if (call.kind === 'public') return pending(call.init.signal);
    });
    state.qqWords = true; const found = await state.search(mixedOptions);
    assert.equal(found.source, 'qq-word'); assert.equal(state.calls.filter(call => call.kind === 'public').length, 0);
    const ordinary = fixture(call => call.kind === 'public' ? response([{ ...publicSong, trackName: mixedOptions.title }]) : undefined);
    ordinary.qqSongs = []; ordinary.netSongs = [];
    assert.equal((await ordinary.search({ ...mixedOptions, requireWordTiming: false })).source, 'lrclib');
    assert.ok(ordinary.calls.filter(call => call.kind === 'qq-search').every(call => call.query.includes('Stranded')));
    return { wordSource: found.source, lineServiceCallsBeforeWordResult: 0, ordinarySource: 'lrclib' };
  });

  await scenario(4, 'Incomplete word misses expire after 15 seconds and legacy caches cannot pin the fallback', async () => {
    let timestamp = 1000000, failing = true;
    const state = fixture(call => failing && call.kind === 'qq-word' ? response(null, 503) : undefined, { now: () => timestamp });
    const fallback = await state.search(options); assert.equal(hasNativeWordTiming(fallback.text), false); assert.equal(fallback.retryAt - timestamp, 15000);
    const count = state.calls.length; await state.search(options); assert.equal(state.calls.length, count);
    failing = false; state.qqWords = true; timestamp = fallback.retryAt + 1;
    const upgraded = await state.search(options); assert.equal(upgraded.source, 'qq-word'); assert.equal(upgraded.retryAt - timestamp, 30 * 86400000);
    const key = Object.keys(state.cache)[0]; state.cache[key].version = 8; state.cache[key].result = { text: line, source: 'qq-line' };
    assert.equal((await state.search(options)).source, 'qq-word'); assert.equal(state.cache[key].version, LYRICS_CACHE_VERSION);
    const clean = fixture(undefined, { now: () => timestamp }); assert.equal((await clean.search(options)).retryAt - timestamp, 60000);
    return { cacheVersion: LYRICS_CACHE_VERSION, interruptedFallbackMs: 15000, cleanFallbackMs: 60000, upgradedSource: upgraded.source };
  });

  await scenario(5, 'Cancellation and time/request limits still bound retries without dropping usable fallback', async () => {
    let started; const ready = new Promise(resolve => { started = resolve; });
    const controller = new AbortController();
    const cancelled = fixture(call => { started(); return pending(call.init.signal); });
    const request = cancelled.search(options, { signal: controller.signal }); await ready; controller.abort();
    assert.equal((await request).cancelled, true); assert.equal(cancelled.calls.length, 1); assert.equal(Object.keys(cancelled.cache).length, 0);
    const capped = fixture(() => response(null, 503), { maxRequests: 6 }); await capped.search(options); assert.ok(capped.calls.length <= 6);
    const recovery = fixture(call => call.kind.startsWith('qq') ? pending(call.init.signal) : undefined,
      { requestTimeoutMs: 150, providerTimeoutMs: 80, totalTimeoutMs: 700 });
    recovery.netWords = true; assert.equal((await recovery.search(options)).source, 'netease-word');
    const fallback = fixture(call => call.kind === 'qq-line' && call.number > 1 ? pending(call.init.signal) : undefined,
      { requestTimeoutMs: 150, providerTimeoutMs: 80, totalTimeoutMs: 700 });
    fallback.qqSongs = [qqSong, { ...qqSong, id: 2, mid: 'm2' }];
    assert.ok((await fallback.search(options)).text);
    const stalled = fixture(call => pending(call.init.signal), { requestTimeoutMs: 300, providerTimeoutMs: 200, totalTimeoutMs: 80 });
    const before = Date.now(); assert.equal((await stalled.search(options)).error, 'timeout'); assert.ok(Date.now() - before < 1000);
    return { cancelledRequests: 1, cacheWritesAfterCancel: 0, cappedRequests: capped.calls.length, providerRecovery: 'netease-word', totalDeadlineBounded: true };
  });

  await scenario(6, 'Actual renderer/IPC upgrades local lines and preserves native words during refresh failure', rendererScenario);

  await scenario(7, 'Metadata guards, manual source rotation, translations and the final line fallback remain correct', async () => {
    for (const change of [{ name: 'Different Song' }, { singer: [{ name: 'Wrong Artist' }], ar: [{ name: 'Wrong Artist' }] }, { interval: 300, dt: 300000 }, { name: options.title + ' (Live)' }]) {
      const state = fixture(); state.qqSongs = [{ ...qqSong, ...change }]; state.netSongs = [{ ...netSong, ...change }]; state.qqWords = state.netWords = true;
      assert.equal((await state.search(options)).text, '');
    }
    const rotation = [];
    for (const mode of ['netease', 'qq']) {
      const state = fixture(call => call.kind === 'qq-line' ? lineResponse(line, '[00:01.00]首句译文\n[00:03.00]次句译文') : undefined);
      state.netSongs = [{ ...netSong, al: { name: 'Other Album' } }];
      const found = await state.search({ ...options, mode, force: true }); assert.equal(found.source, mode + '-line');
      if (mode === 'qq') assert.deepEqual(found.translation, ['首句译文', '次句译文']);
      rotation.push(found.source);
    }
    const publicFallback = fixture(call => call.kind === 'public' ? response(publicSong) : undefined);
    publicFallback.qqSongs = publicFallback.netSongs = [];
    assert.equal((await publicFallback.search(options)).source, 'lrclib');
    const firstPublic = publicFallback.calls.findIndex(call => call.kind === 'public');
    assert.ok(publicFallback.calls.slice(0, firstPublic).some(call => call.kind === 'qq-search'));
    assert.ok(publicFallback.calls.slice(0, firstPublic).some(call => call.kind === 'net-search'));
    return { rejectedMetadataVariants: 4, rotation, translationsPreserved: true, finalFallback: 'lrclib' };
  });

  await scenario(8, 'Live reported song resolves native words with complete/missing tags and a transient QRC failure', async () => {
    const attempts = [];
    for (const variant of ['full-tags', 'title-artist', 'transient-qrc']) {
      let calls = 0, injected = false; const start = Date.now();
      const search = createOnlineLyricsSearch({ getCache: async () => ({}), fetchImplementation: async (url, init) => {
        calls++;
        if (variant === 'transient-qrc' && String(url).includes('lyric_download') && !injected) { injected = true; return response(null, 503); }
        return fetch(url, init);
      } });
      const found = await search({ title: '特别的人', artist: '方大同', album: variant === 'full-tags' ? '危险世界' : '', duration: variant === 'full-tags' ? 259 : 0, requireWordTiming: true, force: true, mode: 'auto' });
      assert.equal(hasNativeWordTiming(found.text), true, variant); if (variant === 'transient-qrc') assert.equal(injected, true);
      attempts.push({ variant, source: found.source, confidence: found.confidence, match: found.match, textLength: found.text.length, calls, elapsedMs: Date.now() - start, transientInjected: injected });
    }
    return { title: '特别的人', artist: '方大同', attempts };
  });
  assert.equal(checks.length, 8); const passed = checks.filter(item => item.status === 'PASS').length;
  console.log(`SUMMARY ${passed}/8 PASS`); if (passed !== 8) process.exitCode = 1;
}
module.exports = { fixture, options, line, word, yrc, qrc, qqSong, netSong, response, pending, rendererScenario };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
