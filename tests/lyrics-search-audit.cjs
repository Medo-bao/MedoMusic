// Exactly ten scenarios: eight functional checks and two build/export checks.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { encryptQrc } = require('qrc-decoder');
const { createOnlineLyricsSearch, LYRICS_CACHE_VERSION } = require('../src/lyrics-search');
const { normalizeLyricTag } = require('../src/lyrics-matching');
const { hasNativeWordTiming } = require('../src/lyrics-timing');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'artifacts/lyrics-search-audit-20261021');
const version = '1.6.4';
const phase = process.argv[2] || 'source';
const reportPath = path.join(output, 'checks.json');
fs.mkdirSync(output, { recursive: true });
const reuse = process.argv.includes('--retry-failed');
const report = phase !== 'source' || reuse ? JSON.parse(fs.readFileSync(reportPath)) : { total: 10, version, checks: [] };
const options = { title: '搜索审查', artist: '测试歌手', album: '测试专辑', duration: 180, requireWordTiming: true };
const line = '[00:01.00]Fixture first line\n[00:04.00]Fixture second line';
const yrc = '[1000,1000](1000,500,0)Fixture(1500,500,0) words';
const qqSong = { id: 100, mid: 'm100', name: options.title, singer: [{ name: options.artist }], album: { name: options.album }, interval: 180 };
const netSong = { id: 100, name: options.title, ar: [{ name: options.artist }], al: { name: options.album }, dt: 180000 };
const qrcResponse = text => `<content><![CDATA[${encryptQrc(`<QrcInfos><LyricInfo><Lyric_1 LyricContent="${text}"/></LyricInfo></QrcInfos>`)}]]></content>`;
const qrc = qrcResponse('[1000,1000]Fixture(1000,500) words(1500,500)');
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => String(data) });
const pending = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});
function netId(body) {
  const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), null);
  const raw = Buffer.concat([decipher.update(Buffer.from(new URLSearchParams(body).get('params'), 'hex')), decipher.final()]).toString();
  return String(JSON.parse(raw.split('-36cd479b6b5-')[1]).id);
}
function fixture(override, config = {}) {
  const state = { cache: {}, calls: [], qqSongs: [], netSongs: [], qrc: new Map(), qqLines: new Map(), netLyrics: new Map() };
  state.search = createOnlineLyricsSearch({ getCache: async () => state.cache, ...config,
    fetchImplementation: async (input, init = {}) => {
      const url = new URL(input);
      const kind = url.href.includes('musicu.fcg') ? 'qq-search' : url.href.includes('cloudsearch') ? 'net-search' :
        url.href.includes('lyric_download') ? 'qq-word' : url.href.includes('fcg_query_lyric') ? 'qq-line' : url.href.includes('/eapi/') ? 'net-lyrics' : 'public';
      const param = kind === 'qq-search' ? JSON.parse(init.body)['music.search.SearchCgiService'].param : null;
      const call = { kind, url, init, query: param?.query || url.searchParams.get('s'),
        limit: param?.num_per_page || Number(url.searchParams.get('limit')),
        id: kind === 'qq-word' ? new URLSearchParams(init.body).get('musicid') : kind === 'net-lyrics' ? netId(init.body) : url.searchParams.get('songmid') };
      state.calls.push(call);
      const custom = override && await override(call, state);
      if (custom !== undefined) return custom;
      if (kind === 'qq-search') {
        const songs = typeof state.qqSongs === 'function' ? state.qqSongs(call.query) : state.qqSongs;
        return response({ req_1: { data: { body: { song: { list: songs.slice(0, call.limit) } } } } });
      }
      if (kind === 'net-search') {
        const songs = typeof state.netSongs === 'function' ? state.netSongs(call.query) : state.netSongs;
        return response({ code: 200, result: { songs: songs.slice(0, call.limit) } });
      }
      if (kind === 'qq-word') return response(state.qrc.get(call.id) ?? '');
      if (kind === 'qq-line') return response(`MusicJsonCallback_lrc(${JSON.stringify({ code: 0, lyric: Buffer.from(state.qqLines.get(call.id) ?? line).toString('base64') })})`);
      if (kind === 'net-lyrics') return response(state.netLyrics.get(call.id) ?? { code: 200, lrc: { lyric: line } });
      return response([]);
    } });
  return state;
}
async function scenario(id, name, action) {
  if (reuse && report.checks.some(c => c.id === id && c.status === 'PASS')) return;
  let timer, result;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Scenario deadline exceeded')), 60000); });
  try { result = { id, name, status: 'PASS', ...await Promise.race([action(), deadline]) }; }
  catch (error) { result = { id, name, status: 'FAIL', error: error.stack }; process.exitCode = 1; }
  finally { clearTimeout(timer); }
  report.checks = [...report.checks.filter(c => c.id !== id), result].sort((a, b) => a.id - b.id);
  report.passed = report.checks.filter(c => c.status === 'PASS').length;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(result));
}
async function functional() {
  await scenario(1, 'Original recordings beyond the old QQ and NetEase result windows remain reachable', async () => {
    const qq = fixture();
    qq.qqSongs = [...Array.from({ length: 8 }, (_, i) => ({ ...qqSong, id: i + 1, interval: 80 + i })), qqSong];
    qq.qrc.set('100', qrc);
    assert.equal((await qq.search({ ...options, mode: 'network' })).source, 'qq-word');
    const net = fixture();
    net.netSongs = [...Array.from({ length: 14 }, (_, i) => ({ ...netSong, id: i + 1, ar: [{ name: `其他歌手${i}` }] })), netSong];
    net.netLyrics.set('100', { code: 200, yrc: { lyric: yrc } });
    assert.equal((await net.search({ ...options, mode: 'netease' })).source, 'netease-word');
    return { qqPosition: 9, neteasePosition: 15 };
  });
  await scenario(2, 'QQ duplicate and unusable identifiers do not exhaust the candidate slots', async () => {
    const state = fixture();
    const unavailable = { ...qqSong, id: 1, mid: 'm1' };
    state.qqSongs = [{ ...qqSong, id: null, mid: null }, ...Array(4).fill(unavailable), { ...qqSong, id: 2, mid: 'm2', album: { name: '其他专辑' } }];
    state.qqLines.set('m1', ''); state.qrc.set('2', qrc);
    const found = await state.search({ ...options, mode: 'network' });
    assert.equal(found.source, 'qq-word'); assert.equal(found.match.album, '其他专辑');
    assert.deepEqual(state.calls.filter(c => c.kind === 'qq-word').map(c => c.id), ['1', '2']);
    const missingArtist = fixture(); missingArtist.qqSongs = [
      { ...qqSong, id: null, mid: null, singer: [{ name: '其他歌手' }] }, qqSong
    ]; missingArtist.qrc.set('100', qrc);
    assert.equal((await missingArtist.search({ ...options, artist: '', mode: 'qq' })).match.artist, options.artist);
    return { checkedIds: ['1', '2'], source: found.source, invalidArtistAmbiguityRemoved: true };
  });
  await scenario(3, 'NetEase duplicate and missing identifiers do not exhaust the candidate slots', async () => {
    const state = fixture();
    const unavailable = { ...netSong, id: 1 };
    state.netSongs = [{ ...netSong, id: null }, ...Array(4).fill(unavailable), { ...netSong, id: 2, al: { name: '其他专辑' } }];
    state.netLyrics.set('1', { code: 200, lrc: { lyric: '' } });
    state.netLyrics.set('2', { code: 200, yrc: { lyric: yrc } });
    const found = await state.search({ ...options, mode: 'netease' });
    assert.equal(found.source, 'netease-word'); assert.equal(found.match.album, '其他专辑');
    assert.deepEqual(state.calls.filter(c => c.kind === 'net-lyrics').map(c => c.id), ['1', '2']);
    const missingArtist = fixture(); missingArtist.netSongs = [
      { ...netSong, id: null, ar: [{ name: '其他歌手' }] }, netSong
    ]; missingArtist.netLyrics.set('100', { code: 200, yrc: { lyric: yrc } });
    assert.equal((await missingArtist.search({ ...options, artist: '', mode: 'netease' })).match.artist, options.artist);
    return { checkedIds: ['1', '2'], source: found.source, invalidArtistAmbiguityRemoved: true };
  });
  await scenario(4, 'Matched recordings without usable lyrics trigger a strictly matched title-only recovery', async () => {
    const sources = [];
    for (const provider of ['qq', 'netease']) {
      const state = fixture();
      if (provider === 'qq') {
        const empty = { ...qqSong, id: 1, mid: 'm1' };
        state.qqSongs = query => query === options.title ? [empty, { ...qqSong, id: 2, mid: 'm2' }, { ...qqSong, id: 3, mid: 'm3', singer: [{ name: '其他歌手' }] }] : [empty];
        state.qqLines.set('m1', ''); state.qrc.set('2', qrc);
      } else {
        const empty = { ...netSong, id: 1 };
        state.netSongs = query => query === options.title ? [empty, { ...netSong, id: 2 }, { ...netSong, id: 3, ar: [{ name: '其他歌手' }] }] : [empty];
        state.netLyrics.set('1', { code: 200, lrc: { lyric: '' } });
        state.netLyrics.set('2', { code: 200, yrc: { lyric: yrc } });
      }
      const found = await state.search({ ...options, mode: provider });
      assert.equal(found.source, provider + '-word'); assert.equal(found.match.artist, options.artist);
      const searchKind = provider === 'qq' ? 'qq-search' : 'net-search';
      assert.deepEqual(state.calls.filter(c => c.kind === searchKind).map(c => c.query), [`${options.title} ${options.artist}`, options.title]);
      assert.deepEqual(state.calls.filter(c => c.kind === (provider === 'qq' ? 'qq-word' : 'net-lyrics')).map(c => c.id), ['1', '2']);
      sources.push(found.source);
    }
    return { sources, repeatDownloads: 0 };
  });
  await scenario(5, 'Unusable QRC and YRC content falls through to valid ordinary lyrics', async () => {
    const qq = fixture(); qq.qqSongs = [qqSong]; qq.qrc.set('100', qrcResponse('[ar:测试歌手]\n[ti:搜索审查]'));
    const qqResult = await qq.search({ ...options, mode: 'qq', requireWordTiming: false });
    assert.equal(qqResult.source, 'qq-line'); assert.equal(qqResult.text, line);
    const net = fixture(); net.netSongs = [netSong];
    net.netLyrics.set('100', { code: 200, yrc: { lyric: '[1000,1000](1000,1000,0)纯音乐，请欣赏' }, lrc: { lyric: line } });
    const netResult = await net.search({ ...options, mode: 'netease', requireWordTiming: false });
    assert.equal(netResult.source, 'netease-line'); assert.equal(netResult.text, line);
    return { sources: [qqResult.source, netResult.source] };
  });
  await scenario(6, 'Recovery preserves success ordering, strict matching, download limits and cancellation', async () => {
    const direct = fixture(); direct.qqSongs = Array.from({ length: 30 }, (_, i) => ({ ...qqSong, id: i + 1, mid: `m${i + 1}` }));
    const ordinary = await direct.search({ ...options, mode: 'network' }); assert.equal(ordinary.source, 'qq-line');
    assert.equal(direct.calls.filter(c => c.kind === 'qq-search').length, 1);
    assert.deepEqual(direct.calls.filter(c => c.kind === 'qq-word').map(c => c.id), ['1', '2', '3', '4']);
    assert.equal(direct.calls.filter(c => c.kind === 'qq-line').length, 4);
    const invalid = fixture(); invalid.qqSongs = [
      { ...qqSong, singer: [{ name: '其他歌手' }] }, { ...qqSong, interval: 80 }, { ...qqSong, name: options.title + ' (Live)' }
    ];
    assert.equal((await invalid.search({ ...options, mode: 'qq', requireWordTiming: false })).text, '');
    assert.equal(invalid.calls.filter(c => c.kind === 'qq-word' || c.kind === 'qq-line').length, 0);
    const capped = fixture(() => response(null, 503), { maxRequests: 6 }); await capped.search({ ...options, mode: 'network' }); assert.ok(capped.calls.length <= 6);
    let started; const ready = new Promise(resolve => { started = resolve; });
    const cancel = new AbortController();
    const cancelled = fixture(call => {
      if (call.kind === 'qq-search' && call.query === options.title) { started(); return pending(call.init.signal); }
    });
    cancelled.qqSongs = [qqSong]; cancelled.qqLines.set('m100', '');
    const request = cancelled.search({ ...options, mode: 'qq' }, { signal: cancel.signal }); await ready; cancel.abort();
    assert.equal((await request).cancelled, true); assert.equal(Object.keys(cancelled.cache).length, 0);
    const retained = fixture(call => call.kind === 'qq-search' && call.query === options.title ? response(null, 503) : undefined);
    retained.qqSongs = [qqSong]; retained.qqLines.set('m100', 'Plain fixture lyrics');
    assert.equal((await retained.search({ ...options, mode: 'qq', requireWordTiming: false })).text, 'Plain fixture lyrics');
    const stuck = fixture(() => new Promise(() => {}), { totalTimeoutMs: 80, providerTimeoutMs: 200, requestTimeoutMs: 300 });
    const start = Date.now(); assert.equal((await stuck.search({ ...options, mode: 'network' })).error, 'timeout');
    assert.ok(Date.now() - start < 1000);
    return { normalQqQueries: 1, maximumDownloadsPerQuery: 4, requestCap: capped.calls.length, cancelledCacheWrites: 0, fallbackRetainedOnRecoveryFailure: true, unresponsiveRequestDeadlineMs: Date.now() - start };
  });
  await scenario(7, 'Previous misses and ordinary fallbacks are invalidated and successful new results are cached', async () => {
    assert.equal(LYRICS_CACHE_VERSION, 12);
    for (const old of [{ text: '', source: null }, { text: line, source: 'qq-line' }]) {
      const state = fixture(); state.qqSongs = [qqSong]; state.qrc.set('100', qrc);
      const key = JSON.stringify([normalizeLyricTag(options.title), normalizeLyricTag(options.artist), normalizeLyricTag(options.album), 180, ['qq', 'netease'], true]);
      state.cache[key] = { version: 11, expiresAt: Date.now() + 86400000, result: old };
      assert.equal((await state.search({ ...options, mode: 'network' })).source, 'qq-word');
      assert.equal(state.cache[key].version, 12);
      const requests = state.calls.length;
      assert.equal((await state.search({ ...options, mode: 'network' })).source, 'qq-word');
      assert.equal(state.calls.length, requests);
    }
    return { invalidatedKinds: 2, cacheVersion: 12, successfulCacheReused: true };
  });
  await scenario(8, 'Both reported songs resolve matching native lyrics through real provider APIs', async () => {
    const attempts = [];
    for (const track of [
      { title: '渲染离别', artist: '许嵩', album: '情侣装', duration: 283 },
      { title: '特别的人', artist: '方大同', album: '危险世界', duration: 259 }
    ]) for (const mode of ['network', 'netease']) {
      const start = Date.now(); const search = createOnlineLyricsSearch({ getCache: async () => ({}) });
      const found = await search({ ...track, mode, requireWordTiming: true });
      assert.equal(hasNativeWordTiming(found.text), true, `${track.title}/${mode}: ${found.error || found.source}`);
      assert.equal(found.match.title, track.title); assert.equal(found.match.artist, track.artist);
      assert.ok(Math.abs(found.match.duration - track.duration) < 3);
      attempts.push({ title: track.title, mode, source: found.source, match: found.match, characters: found.text.length, elapsedMs: Date.now() - start });
    }
    return { attempts };
  });
  assert.equal(report.checks.filter(c => c.id <= 8).length, 8);
}
function files(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
}
async function main() {
  if (phase === 'source') return functional();
  if (phase === 'bundle') return scenario(9, 'Staged installer and all bundled sources contain the same-version repair', async () => {
    assert.equal(report.checks.filter(c => c.id <= 8 && c.status === 'PASS').length, 8);
    const asar = require('@electron/asar'); const bundle = path.join(output, 'build/win-unpacked/resources/app.asar');
    const pkg = require('../package.json'), lock = require('../package-lock.json');
    assert.equal(pkg.version, version); assert.equal(lock.version, version); assert.equal(lock.packages[''].version, version);
    const { scripts, devDependencies, build, ...expected } = pkg;
    assert.deepEqual(JSON.parse(asar.extractFile(bundle, 'package.json')), expected);
    const sources = files(path.join(root, 'src'));
    for (const file of sources) assert.ok(asar.extractFile(bundle, path.relative(root, file)).equals(fs.readFileSync(file)), file);
    const info = JSON.parse(fs.readFileSync(path.join(output, 'installer-info.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(info.productVersion, version); assert.ok(info.size > 0);
    return { version, exactSourceFiles: sources.length, cacheVersion: LYRICS_CACHE_VERSION, ...info };
  });
  assert.equal(phase, 'export');
  await scenario(10, 'Clean exported app starts and renders real native lyrics through its IPC', async () => {
    assert.equal(report.checks.filter(c => c.id <= 9 && c.status === 'PASS').length, 9);
    const release = path.join(root, 'release');
    const installers = fs.readdirSync(release).filter(name => /^MedoMusic-Setup-.*\.exe$/.test(name));
    assert.deepEqual(installers, [`MedoMusic-Setup-${version}-x64.exe`]);
    assert.ok(fs.existsSync(path.join(release, installers[0] + '.blockmap')));
    const { _electron } = require('playwright'); const profile = path.join(output, 'ExportProfile');
    const music = path.join(output, 'ExportMusic'); fs.mkdirSync(music, { recursive: true });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: path.join(release, 'win-unpacked/MedoMusic.exe'), args: [`--user-data-dir=${profile}`], env });
    const errors = [];
    try {
      const runtime = await app.evaluate(({ app }, music) => {
        app.setPath('music', music);
        return { version: app.getVersion(), profile: app.getPath('userData'), appPath: app.getAppPath() };
      }, music);
      assert.equal(runtime.version, version); assert.equal(path.resolve(runtime.profile).toLowerCase(), profile.toLowerCase());
      assert.equal(path.resolve(runtime.appPath).toLowerCase(), path.join(release, 'win-unpacked/resources/app.asar').toLowerCase());
      const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
      await page.waitForFunction(() => typeof lastShortcutStates !== 'undefined' && lastShortcutStates.size === 5);
      const ui = await page.evaluate(async track => {
        applyAutoUpdateSetting(false); wordLyricsEnabled = true; lyricTranslationEnabled = false;
        tracks = [track]; currentIndex = 0; playbackQueueIds = [track.id];
        await ensureLyrics(track, true, 'network'); openPlaybackDetail(); await renderAppInfo();
        const entry = lyricsCache.get(track.id);
        return { about: document.querySelector('#about-version').textContent, source: entry?.source,
          native: MedoLyricSync.hasWordLevelLines(entry?.lines), lyricCount: document.querySelectorAll('#lyrics-lines .lyric-line').length,
          normalStatusHidden: document.querySelector('#lyric-status').hidden, retryStopped: lyricRetryState === null };
      }, { id: 'export-depth', title: '渲染离别', artist: '许嵩', album: '情侣装', duration: 283, path: path.join(music, 'Fixture.mp3'), metadataLoaded: true });
      assert.match(ui.about, /1\.6\.4$/); assert.equal(ui.source, 'qq-word'); assert.equal(ui.native, true);
      assert.ok(ui.lyricCount > 10); assert.equal(ui.normalStatusHidden, true); assert.equal(ui.retryStopped, true); assert.deepEqual(errors, []);
      return { ...runtime, ui, rendererErrors: errors, installer: path.join(release, installers[0]), size: fs.statSync(path.join(release, installers[0])).size };
    } finally { await app.close(); }
  });
  assert.equal(report.passed, 10); console.log('SUMMARY 10/10 PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
