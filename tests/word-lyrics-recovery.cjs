// Exactly ten scenarios: eight functional checks and two build/export checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');
const asar = require('@electron/asar');
const { createOnlineLyricsSearch, LYRICS_CACHE_VERSION } = require('../src/lyrics-search');
const { hasNativeWordTiming } = require('../src/lyrics-timing');
const { fixture, options, line, yrc, qrc, qqSong, netSong, response, pending, rendererScenario } = require('./word-lyrics-reliability.cjs');
const root = path.resolve(__dirname, '..'), version = '1.6.4';
const output = path.join(__dirname, 'artifacts/word-recovery-export-1.6.4-20261020');
fs.mkdirSync(output, { recursive: true });
const phase = process.argv[2] || 'source', reportPath = path.join(output, 'checks.json');
const reuse = process.argv.includes('--retry-failed');
const report = phase !== 'source' || reuse ? JSON.parse(fs.readFileSync(reportPath)) : { total: 10, version, checks: [] };
async function scenario(id, name, action) {
  if (reuse && report.checks.find(item => item.id === id)?.status === 'PASS') return;
  let result;
  try { result = { id, name, status: 'PASS', ...await action() }; }
  catch (error) { result = { id, name, status: 'FAIL', error: error.stack || String(error) }; }
  report.checks = [...report.checks.filter(item => item.id !== id), result].sort((a, b) => a.id - b.id);
  report.passed = report.checks.filter(item => item.status === 'PASS').length;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(result));
  if (result.status !== 'PASS') process.exitCode = 1;
}

async function withRenderer(action) {
  const folder = fs.mkdtempSync(path.join(output, 'ipc-'));
  fs.mkdirSync(path.join(folder, 'Music'));
  const filePath = path.join(folder, 'Fixture.wav');
  fs.writeFileSync(filePath.replace('.wav', '.lrc'), line);
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'medo-recovery-check', version, main: 'main.cjs' }));
  fs.writeFileSync(path.join(folder, 'main.cjs'), `
    const {app,globalShortcut,ipcMain,shell}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(folder, 'Profile'))});app.setPath('music',${JSON.stringify(path.join(folder, 'Music'))});
    const state=globalThis.__recovery={mode:'line',offset:0,reads:0};const realNow=Date.now;Date.now=()=>realNow()+state.offset;
    const keys=new Set();globalShortcut.register=key=>{keys.add(key);return true;};globalShortcut.isRegistered=key=>keys.has(key);globalShortcut.unregister=key=>keys.delete(key);shell.openExternal=async()=>{};
    const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,listener)=>handle(name,(...args)=>{if(name==='music:lyrics')state.reads++;return listener(...args);});
    const response=data=>({ok:true,status:200,json:async()=>data,text:async()=>String(data)});
    globalThis.fetch=async input=>{
      const url=String(input);if(url.startsWith('https://api.github.com/'))return response({tag_name:'v1.6.4'});
      if(url.includes('musicu.fcg'))return response({req_1:{data:{body:{song:{list:[${JSON.stringify(qqSong)}]}}}}});
      if(url.includes('lyric_download'))return response(state.mode==='word'?${JSON.stringify(qrc)}:'');
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
      tracks = [track]; currentIndex = 0; playbackQueueIds = [track.id]; await ensureLyrics(track); openPlaybackDetail();
    }, { id: 'recovery', title: options.title, artist: options.artist, album: options.album, path: filePath, duration: 180, metadataLoaded: true });
    const api = { app, page, errors,
      set: values => app.evaluate((_electron, values) => { Object.assign(globalThis.__recovery, values); }, values),
      reads: () => app.evaluate(() => globalThis.__recovery.reads),
      arm: () => page.evaluate(() => { lyricsCache.get('recovery').retryAt = Date.now() + 40; scheduleLyricRetry(tracks[0]); }) };
    const result = await action(api); assert.deepEqual(errors, []); return { ...result, rendererErrors: errors };
  } finally { await app.close(); }
}

async function functional() {
  await scenario(1, 'A stalled first candidate cannot hide a later native result in either source', async () => {
    const cases = [];
    for (const provider of ['qq', 'netease']) {
      const state = fixture(call => {
        if (provider === 'qq' && call.kind === 'qq-word') return call.id === '1' ? pending(call.init.signal) : response(qrc);
        if (provider === 'netease' && call.kind === 'net-lyrics') return call.number === 1 ? pending(call.init.signal) : response({ yrc: { lyric: yrc } });
      }, { requestTimeoutMs: 80, providerTimeoutMs: 130, totalTimeoutMs: 700 });
      state.qqSongs = [qqSong, { ...qqSong, id: 2, mid: 'm2' }]; state.netSongs = [netSong, { ...netSong, id: 2 }];
      const found = await state.search({ ...options, mode: provider, force: true }); assert.equal(found.source, provider + '-word');
      if (provider === 'qq') assert.ok(state.calls.some(call => call.kind === 'qq-word' && call.id === '2'));
      cases.push({ provider, source: found.source, calls: state.calls.length });
    }
    const ranked = fixture(async call => {
      if (call.kind === 'qq-word') { if (call.id === '1') await new Promise(resolve => setTimeout(resolve, 35)); return response(qrc); }
    });
    ranked.qqSongs = [qqSong, { ...qqSong, id: 2, mid: 'm2', album: { name: 'Other' } }];
    assert.equal((await ranked.search(options)).match.album, options.album);
    return { cases, preferredRecordingRetained: true };
  });

  await scenario(2, 'Body reads retry with the same two-attempt allowance as HTTP requests', async () => {
    const cases = [];
    for (const provider of ['qq', 'netease']) {
      const kind = provider === 'qq' ? 'qq-word' : 'net-lyrics';
      const state = fixture(call => {
        if (call.kind !== kind) return;
        if (call.number === 1) return { ...response(null), [provider === 'qq' ? 'text' : 'json']: async () => { throw new TypeError('body terminated'); } };
        return provider === 'qq' ? response(qrc) : response({ yrc: { lyric: yrc } });
      });
      const found = await state.search({ ...options, mode: provider }); assert.equal(found.source, provider + '-word');
      assert.equal(state.calls.filter(call => call.kind === kind).length, 2); cases.push({ provider, source: found.source, attempts: 2 });
    }
    const exhausted = fixture(call => call.kind === 'qq-word' ? call.number === 1 ? response(null, 503) : { ...response(null), text: async () => { throw new TypeError('body terminated'); } } : undefined);
    assert.equal(hasNativeWordTiming((await exhausted.search(options)).text), false);
    assert.equal(exhausted.calls.filter(call => call.kind === 'qq-word').length, 2);
    return { cases, combinedHttpAndBodyAttemptCap: 2 };
  });

  await scenario(3, 'Partial business failures use 15 seconds while complete misses and native caches retain their TTLs', async () => {
    let timestamp = 1000000;
    const partial = fixture(call => call.kind === 'net-lyrics' && call.number > 1 ? response({ code: 503 }) : undefined, { now: () => timestamp });
    partial.qqSongs = []; partial.netSongs = [netSong, { ...netSong, id: 2 }];
    const found = await partial.search({ ...options, mode: 'netease' }); assert.equal(found.source, 'netease-line'); assert.equal(found.retryAt - timestamp, 15000);
    const clean = fixture(undefined, { now: () => timestamp }); assert.equal((await clean.search(options)).retryAt - timestamp, 60000);
    clean.qqWords = true; timestamp += 60001; assert.equal((await clean.search(options)).source, 'qq-word');
    const key = Object.keys(clean.cache)[0]; clean.cache[key].version = 9; clean.cache[key].result = { text: line, source: 'qq-line' };
    const upgraded = await clean.search(options); assert.equal(upgraded.source, 'qq-word'); assert.equal(upgraded.retryAt - timestamp, 30 * 86400000);
    assert.equal(clean.cache[key].version, 10);
    return { partialFailureMs: 15000, cleanMissMs: 60000, nativeMs: 30 * 86400000, cacheVersion: LYRICS_CACHE_VERSION };
  });

  await scenario(4, 'An actual renderer timer upgrades expired local line lyrics without a user refresh', () => withRenderer(async ui => {
    const before = await ui.reads(); await ui.set({ mode: 'word', offset: 61000 }); await ui.arm();
    await ui.page.waitForFunction(() => MedoLyricSync.hasWordLevelLines(lyricsCache.get('recovery').lines));
    const actual = await ui.page.evaluate(() => ({ source: lyricsCache.get('recovery').source, timerStopped: lyricRetryState === null, statusHidden: document.querySelector('#lyric-status').hidden }));
    assert.deepEqual(actual, { source: 'qq-word', timerStopped: true, statusHidden: true });
    assert.equal(await ui.reads(), before + 1); return { automaticRequests: 1, ...actual };
  }));

  await scenario(5, 'Automatic rechecks stop after three attempts and cancel on setting, track, metadata and playback changes', () => withRenderer(async ui => {
    const before = await ui.reads();
    for (let i = 1; i <= 3; i++) {
      await ui.set({ offset: i * 61000 }); await ui.arm();
      await ui.page.waitForFunction(attempt => lyricRetryState?.attempts === attempt && lyricsRequests.size === 0, i);
    }
    assert.equal(await ui.reads(), before + 3); await ui.arm(); await ui.page.waitForTimeout(120); assert.equal(await ui.reads(), before + 3);
    await ui.page.evaluate(() => ensureLyrics(tracks[0], true));
    const reset = await ui.reads(); await ui.arm(); await ui.page.evaluate(() => applyWordLyricsSetting(false, true));
    await ui.page.waitForTimeout(100); assert.equal(await ui.reads(), reset);
    await ui.page.evaluate(() => { wordLyricsEnabled = true; }); await ui.arm();
    await ui.page.evaluate(() => cancelPendingLyrics('different-track')); await ui.page.waitForTimeout(100); assert.equal(await ui.reads(), reset);
    await ui.arm(); await ui.page.evaluate(() => { tracks[0].title = 'Changed metadata'; }); await ui.page.waitForTimeout(100); assert.equal(await ui.reads(), reset);
    await ui.page.evaluate(title => { tracks[0].title = title; }, options.title); await ui.arm(); await ui.page.evaluate(() => clearCurrentPlayback());
    await ui.page.waitForTimeout(100); assert.equal(await ui.reads(), reset);
    assert.equal(await ui.page.evaluate(() => lyricRetryState), null);
    return { automaticAttemptCap: 3, cancelledOn: ['word-off', 'track-change', 'metadata-change', 'playback-clear'] };
  }));

  await scenario(6, 'Concurrent lookups preserve manual source order, candidate rank and existing native lyrics', async () => {
    const ranked = fixture(async call => {
      if (call.kind === 'net-lyrics' && call.number === 1) { await new Promise(resolve => setTimeout(resolve, 30)); return response({ lrc: { lyric: line } }); }
    });
    ranked.netSongs = [netSong, { ...netSong, id: 2, al: { name: 'Other' } }];
    assert.equal((await ranked.search({ ...options, mode: 'netease', force: true })).match.album, options.album);
    const sources = [];
    for (const mode of ['qq', 'netease']) {
      const state = fixture(); state.netSongs = [{ ...netSong, al: { name: 'Other' } }];
      const found = await state.search({ ...options, mode, force: true }); assert.equal(found.source, mode + '-line'); sources.push(found.source);
    }
    const invalid = fixture(); invalid.qqWords = invalid.netWords = true;
    invalid.qqSongs = [{ ...qqSong, singer: [{ name: 'Other Singer' }] }]; invalid.netSongs = [{ ...netSong, dt: 300000 }];
    assert.equal((await invalid.search(options)).text, '');
    return { manualSources: sources, matchedRecordingOrder: true, ...await rendererScenario() };
  });

  await scenario(7, 'Cancellation, source ordering, rate limits and global budgets remain bounded', async () => {
    let started; const ready = new Promise(resolve => { started = resolve; }); const controller = new AbortController();
    const state = fixture(call => { started(); return pending(call.init.signal); });
    const request = state.search(options, { signal: controller.signal }); await ready; controller.abort(); assert.equal((await request).cancelled, true); assert.equal(Object.keys(state.cache).length, 0);
    const capped = fixture(() => response(null, 503), { maxRequests: 6 }); await capped.search(options); assert.ok(capped.calls.length <= 6);
    for (const status of [404, 429]) {
      const limited = fixture(call => call.kind === 'qq-word' ? response(null, status) : undefined); await limited.search(options);
      assert.equal(limited.calls.filter(call => call.kind === 'qq-word').length, 1);
    }
    const stalled = fixture(call => pending(call.init.signal), { totalTimeoutMs: 80, providerTimeoutMs: 200, requestTimeoutMs: 300 });
    const start = Date.now(); assert.equal((await stalled.search(options)).error, 'timeout'); assert.ok(Date.now() - start < 1000);
    const alternate = fixture(call => call.kind === 'qq-search' && call.query.includes('Stranded') ? response({ req_1: { data: { body: { song: { list: [] } } } } }) : undefined);
    alternate.netSongs = []; alternate.qqWords = true;
    assert.equal((await alternate.search({ ...options, title: options.title + ' Stranded' })).source, 'qq-word');
    assert.equal(alternate.calls.filter(call => call.kind === 'public').length, 0);
    return { cancelledCacheWrites: 0, maxRequestsObserved: capped.calls.length, totalTimeoutBounded: true, lineOnlySourceDeferred: true };
  });

  await scenario(8, 'Reported song resolves original native words with tags, missing tags and a failed first body read', async () => {
    const attempts = [];
    for (const variant of ['full-tags', 'title-artist', 'body-failure']) {
      let injected = false, calls = 0; const start = Date.now();
      const search = createOnlineLyricsSearch({ getCache: async () => ({}), fetchImplementation: async (url, init) => {
        calls++;
        if (variant === 'body-failure' && String(url).includes('lyric_download') && !injected) {
          injected = true; return { ...response(null), text: async () => { throw new TypeError('body terminated'); } };
        }
        return fetch(url, init);
      } });
      const found = await search({ title: '特别的人', artist: '方大同', album: variant === 'full-tags' ? '危险世界' : '', duration: variant === 'full-tags' ? 259 : 0, mode: 'auto', requireWordTiming: true, force: true });
      assert.equal(hasNativeWordTiming(found.text), true); assert.equal(found.match.duration, 259);
      if (variant === 'body-failure') assert.equal(injected, true);
      attempts.push({ variant, source: found.source, match: found.match, calls, elapsedMs: Date.now() - start, bodyFailureInjected: injected });
    }
    return { title: '特别的人', artist: '方大同', attempts };
  });
  assert.equal(report.checks.filter(item => item.id <= 8).length, 8);
}

function files(folder) { return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(folder, entry.name)) : [path.join(folder, entry.name)]); }
async function main() {
  if (phase === 'source') return functional();
  if (phase === 'bundle') return scenario(9, 'Current source, production dependency and version are present in the staged bundle', async () => {
    assert.equal(report.checks.filter(item => item.id <= 8 && item.status === 'PASS').length, 8);
    const bundle = path.join(output, 'build/win-unpacked/resources/app.asar');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))), lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
    assert.equal(pkg.version, version); assert.equal(lock.version, version); assert.equal(lock.packages[''].version, version);
    const { scripts, devDependencies, build, ...expected } = pkg; assert.deepEqual(JSON.parse(asar.extractFile(bundle, 'package.json')), expected);
    const sources = files(path.join(root, 'src')); for (const file of sources) assert.ok(asar.extractFile(bundle, path.relative(root, file)).equals(fs.readFileSync(file)), file);
    assert.ok(asar.extractFile(bundle, path.normalize('src/lyrics-candidates.js')).length > 0);
    return { version, exactSourceFiles: sources.length, cacheVersion: LYRICS_CACHE_VERSION };
  });
  assert.equal(phase, 'export');
  await scenario(10, 'Clean export and actual packaged renderer preserve the retry and native lyric behavior', async () => {
    const info = JSON.parse(fs.readFileSync(path.join(output, 'installer-info.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(info.productVersion, version); assert.ok(info.size > 0); assert.deepEqual(info.oldInstallers, []);
    const release = path.join(root, 'release'), profile = path.join(output, 'ExportProfile'), music = path.join(output, 'ExportMusic'); fs.mkdirSync(music, { recursive: true });
    assert.ok(fs.existsSync(path.join(release, `MedoMusic-Setup-${version}-x64.exe.blockmap`)));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: path.join(release, 'win-unpacked/MedoMusic.exe'), args: [`--user-data-dir=${profile}`], env });
    const errors = [];
    try {
      const runtime = await app.evaluate(({ app }, music) => { app.setPath('music', music); return { version: app.getVersion(), profile: app.getPath('userData'), appPath: app.getAppPath() }; }, music);
      assert.equal(runtime.version, version); assert.equal(path.resolve(runtime.profile).toLowerCase(), profile.toLowerCase()); assert.equal(path.resolve(runtime.appPath).toLowerCase(), path.join(release, 'win-unpacked/resources/app.asar').toLowerCase());
      const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
      await page.waitForFunction(() => typeof lastShortcutStates !== 'undefined' && lastShortcutStates.size === 5);
      const ui = await page.evaluate(async () => {
        applyAutoUpdateSetting(false); wordLyricsEnabled = true; lyricTranslationEnabled = false;
        const track = { id: 'export-retry', title: '打包验证', artist: '歌手', path: 'Fixture.wav', duration: 180, metadataLoaded: true };
        tracks = [track]; currentIndex = 0; playbackQueueIds = [track.id];
        lyricsCache.set(track.id, { ...parseLyrics('[00:01.00]普通歌词', 180), source: 'netease-line', wordTimingRequested: true, metadataKey: lyricMetadataKey(track), retryAt: Date.now() + 60000 });
        openPlaybackDetail(); await renderAppInfo();
        const result = { about: document.querySelector('#about-version').textContent, retryArmed: Boolean(lyricRetryState?.timer), fallbackVisible: !document.querySelector('#lyric-status').hidden };
        applyWordLyricsSetting(false, true); result.disabledCancelled = lyricRetryState === null;
        wordLyricsEnabled = true; lyricsCache.set(track.id, { ...parseLyrics('[1000,1000]逐(1000,500)字(1500,500)', 180), source: 'qq-word', wordTimingRequested: true, metadataKey: lyricMetadataKey(track), retryAt: Date.now() + 60000 });
        renderLyrics(track); scheduleLyricRetry(track); result.nativeTimerStopped = lyricRetryState === null; result.nativeStatusHidden = document.querySelector('#lyric-status').hidden;
        clearCurrentPlayback(); result.clearCancelled = lyricRetryState === null; return result;
      });
      assert.match(ui.about, /1\.6\.4$/); for (const [key, value] of Object.entries(ui)) if (key !== 'about') assert.equal(value, true, key);
      assert.deepEqual(errors, []); return { ...info, ...runtime, ui, rendererErrors: errors };
    } finally { await app.close(); }
  });
  assert.equal(report.checks.length, 10); assert.equal(report.passed, 10); console.log('SUMMARY 10/10 PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
