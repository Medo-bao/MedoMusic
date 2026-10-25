// Exactly six scenarios: four lyric behaviors, bundle contents, exported runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');
const { encryptQrc } = require('qrc-decoder');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'artifacts/word-refresh-line-1.6.4-20261018');
const reportPath = path.join(output, 'checks.json');
const version = '1.6.4';
const localLine = '[00:01.00]Local first line\n[00:03.00]Local second line';
const netLine = '[00:01.00]Netease first line\n[00:03.00]Netease second line';
const qqLine = '[00:01.00]QQ first line\n[00:03.00]QQ second line';
const word = '[1000,1000]Native(1000,500) words(1500,500)';
fs.mkdirSync(output, { recursive: true });
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath)) : { total: 6, version, checks: [] };

async function scenario(id, name, action) {
  let result;
  try { result = { id, name, status: 'PASS', ...await action() }; }
  catch (error) { result = { id, name, status: 'FAIL', error: error.stack || String(error) }; }
  report.checks = [...report.checks.filter(item => item.id !== id), result].sort((a, b) => a.id - b.id);
  report.passed = report.checks.filter(item => item.status === 'PASS').length;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(result));
  if (result.status !== 'PASS') process.exitCode = 1;
}

function wav() {
  const data = Buffer.alloc(44 + 48000 * 4);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(48000, 24); data.writeUInt32LE(192000, 28);
  data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(data.length - 44, 40); return data;
}

async function source() {
  // A fresh profile and local files, with synthetic service responses only.
  const folder = fs.mkdtempSync(path.join(output, 'run-'));
  const filePath = path.join(folder, 'Fixture.wav'), nativePath = path.join(folder, 'Native.wav');
  fs.writeFileSync(filePath, wav()); fs.writeFileSync(filePath.replace('.wav', '.lrc'), localLine);
  fs.writeFileSync(nativePath, wav()); fs.writeFileSync(nativePath.replace('.wav', '.lrc'), word);
  fs.mkdirSync(path.join(folder, 'Music'));
  const qrc = '<content><![CDATA[' + encryptQrc(`<?xml version="1.0"?><QrcInfos><LyricInfo><Lyric_1 LyricType="1" LyricContent="${word}"/></LyricInfo></QrcInfos>`) + ']]></content>';
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'medo-word-refresh-check', version, main: 'main.cjs' }));
  fs.writeFileSync(path.join(folder, 'main.cjs'), `
    const {app,globalShortcut,shell,ipcMain}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(folder, 'Profile'))});
    app.setPath('music',${JSON.stringify(path.join(folder, 'Music'))});
    const keys=new Set();globalShortcut.register=key=>{keys.add(key);return true;};
    globalShortcut.isRegistered=key=>keys.has(key);globalShortcut.unregister=key=>keys.delete(key);
    shell.openExternal=async()=>{};
    const state=globalThis.__refresh={mode:'line',calls:[],invocations:[]};
    const handle=ipcMain.handle.bind(ipcMain);
    ipcMain.handle=(name,listener)=>handle(name,(event,...args)=>{
      if(name==='music:lyrics')state.invocations.push(args[0]);return listener(event,...args);
    });
    const response=(data,status=200)=>({ok:status<400,status,json:async()=>data,text:async()=>String(data)});
    globalThis.fetch=async(input,init={})=>{
      const url=String(input);
      if(url.startsWith('https://api.github.com/'))return response({tag_name:'v1.6.4'});
      state.calls.push(url);state.started?.();state.started=null;
      if(state.mode==='pending')return new Promise((resolve,reject)=>{
        const abort=()=>reject(init.signal.reason);
        if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});
      });
      if(state.mode==='failure')return response(null,503);
      const singer=state.mode==='wrong-artist'?'Unrelated Artist':'Singer';
      if(url.includes('musicu.fcg'))return response({req_1:{data:{body:{song:{list:[
        {id:1,mid:'fixture-mid',name:'Fixture',interval:120,singer:[{name:singer}],album:{name:'Album'}}
      ]}}}}});
      if(url.includes('lyric_download'))return response(state.mode==='word'?${JSON.stringify(qrc)}:'<lyric></lyric>');
      if(url.includes('fcg_query_lyric'))return response('MusicJsonCallback_lrc('+JSON.stringify({code:0,lyric:${JSON.stringify(Buffer.from(qqLine).toString('base64'))}})+')');
      if(url.includes('cloudsearch'))return response({result:{songs:[
        {id:2,name:'Fixture',ar:[{name:singer}],dt:120000,al:{name:'Other Album'}}
      ]}});
      if(url.includes('/eapi/'))return response({lrc:{lyric:${JSON.stringify(netLine)}}});
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
    const track = { id: 'refresh-local-line', title: 'Fixture', artist: 'Singer', album: 'Album', path: filePath, duration: 120, metadataLoaded: true };
    const state = values => app.evaluate((_electron, values) => Object.assign(globalThis.__refresh, values), values);
    const snapshot = () => page.evaluate(() => {
      const entry = lyricsCache.get(tracks[currentIndex].id);
      return { source: entry.source, confidence: entry.confidence, text: entry.lines[0]?.text, worded: MedoLyricSync.hasWordLevelLines(entry.lines), refreshError: entry.refreshError || null, status: document.querySelector('.lyric-status-message').textContent, sourceLabel: document.querySelector('.lyric-status-source').textContent };
    });
    await page.evaluate(async track => {
      applyAutoUpdateSetting(false); lyricTranslationEnabled = false; wordLyricsEnabled = true;
      tracks = [track]; currentIndex = 0; playbackQueueIds = [track.id];
      await ensureLyrics(track); openPlaybackDetail();
    }, track);

    await scenario(1, 'Local line fallback refresh uses the ordinary line source order without a second search', async () => {
      assert.equal((await snapshot()).source, 'sidecar');
      const normal = await page.evaluate(track => window.medo.readLyrics({ ...track, filePath: track.path, mode: 'netease', force: true, ignoreLocal: true, requireWordTiming: false }), track);
      assert.equal(normal.source, 'netease-line');
      await state({ calls: [], invocations: [] });
      await page.evaluate(() => refreshCurrentLyricsFromNetwork());
      const refreshed = await snapshot();
      assert.equal(refreshed.source, normal.source); assert.equal(refreshed.confidence, normal.confidence);
      assert.equal(refreshed.text, 'Netease first line'); assert.equal(refreshed.worded, false);
      assert.match(refreshed.status, /暂未找到逐字歌词/); assert.equal(refreshed.sourceLabel, '网易云音乐 · 逐行歌词');
      const requests = await app.evaluate(() => ({ calls: globalThis.__refresh.calls, invocations: globalThis.__refresh.invocations }));
      assert.equal(requests.calls.length, 5); assert.equal(requests.invocations.length, 1);
      assert.equal(requests.invocations[0].force, true); assert.equal(requests.invocations[0].requireWordTiming, true);
      // NetEase is 95%, QQ is 100%; line mode still chooses the selected source.
      assert.ok(refreshed.confidence < 100);
      await state({ calls: [], invocations: [] });
      await page.evaluate(() => refreshCurrentLyricsFromNetwork());
      const rotated = await snapshot(); assert.equal(rotated.source, 'qq-line');
      assert.equal(rotated.confidence, 100); assert.equal((await app.evaluate(() => globalThis.__refresh.calls)).length, 5);
      return { refreshed, rotated, requests: 5, ipcRequestsPerRefresh: 1, secondNetworkSearch: false };
    });

    await scenario(2, 'A later provider native word result still wins over the line fallback', async () => {
      await state({ mode: 'word', calls: [], invocations: [] });
      await page.evaluate(() => { lyricRefreshProviders.set(tracks[0].id, 'netease'); return refreshCurrentLyricsFromNetwork(); });
      const found = await snapshot(); assert.equal(found.source, 'qq-word'); assert.equal(found.worded, true);
      assert.equal(found.refreshError, null); assert.equal(found.status, '');
      const calls = await app.evaluate(() => globalThis.__refresh.calls);
      assert.ok(calls[0].includes('cloudsearch')); assert.ok(calls.some(url => url.includes('lyric_download')));
      return { found, requests: calls.length };
    });

    await scenario(3, 'Failures, mismatched artists and cancelled refreshes preserve local lyrics and translations', async () => {
      await page.evaluate(async () => {
        await ensureLyrics(tracks[0], true, 'local'); lyricTranslations.set(tracks[0].id, ['原翻译', '次行翻译']);
      });
      await state({ mode: 'failure', calls: [] });
      await page.evaluate(() => refreshCurrentLyricsFromNetwork());
      const failure = await snapshot(); assert.equal(failure.source, 'sidecar'); assert.equal(failure.refreshError, 'network');
      await state({ mode: 'wrong-artist', calls: [] });
      await page.evaluate(() => refreshCurrentLyricsFromNetwork());
      const mismatch = await snapshot(); assert.equal(mismatch.source, 'sidecar'); assert.equal(mismatch.refreshError, 'not-found');
      await state({ mode: 'pending', calls: [] });
      await page.evaluate(() => { window.__pendingRefresh = refreshCurrentLyricsFromNetwork(); });
      await app.evaluate(async () => { if (!globalThis.__refresh.calls.length) await new Promise(resolve => { globalThis.__refresh.started = resolve; }); });
      const cancelled = await page.evaluate(async () => {
        cancelPendingLyrics(); await window.__pendingRefresh;
        const entry = lyricsCache.get(tracks[0].id);
        return { source: entry.source, text: entry.lines[0].text, translations: lyricTranslations.get(tracks[0].id), requests: lyricsRequests.size };
      });
      assert.deepEqual(cancelled, { source: 'sidecar', text: 'Local first line', translations: ['原翻译', '次行翻译'], requests: 0 });
      return { failure, mismatch, cancelled };
    });

    await scenario(4, 'Automatic local and native priorities and the existing refresh cache remain intact', async () => {
      await state({ mode: 'line', calls: [], invocations: [] });
      const ordinary = await page.evaluate(async () => {
        wordLyricsEnabled = false; lyricsCache.clear(); await ensureLyrics(tracks[0]);
        return lyricsCache.get(tracks[0].id).source;
      });
      assert.equal(ordinary, 'sidecar'); assert.equal((await app.evaluate(() => globalThis.__refresh.calls)).length, 0);
      const native = await page.evaluate(async nativePath => {
        tracks[0] = { ...tracks[0], id: 'native', path: nativePath }; wordLyricsEnabled = true;
        await ensureLyrics(tracks[0]); const entry = lyricsCache.get('native');
        return { source: entry.source, worded: MedoLyricSync.hasWordLevelLines(entry.lines) };
      }, nativePath);
      assert.deepEqual(native, { source: 'sidecar', worded: true });
      assert.equal((await app.evaluate(() => globalThis.__refresh.calls)).length, 0);
      await page.evaluate(track => { tracks[0] = track; lyricsCache.clear(); return ensureLyrics(track); }, track);
      await page.evaluate(() => { lyricRefreshProviders.set(tracks[0].id, 'netease'); return refreshCurrentLyricsFromNetwork(); });
      const before = await app.evaluate(() => globalThis.__refresh.invocations.length);
      await page.evaluate(() => ensureLyrics(tracks[0]));
      assert.equal((await snapshot()).source, 'netease-line');
      assert.equal(await app.evaluate(() => globalThis.__refresh.invocations.length), before);
      assert.deepEqual(errors, []);
      return { ordinarySource: ordinary, native, freshOnlineFallbackReused: true, rendererErrors: errors };
    });
  } finally { await app.close(); }
  assert.equal(report.checks.filter(item => item.id <= 4).length, 4);
}

function files(folder) { return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(folder, entry.name)) : [path.join(folder, entry.name)]); }

async function main() {
  if (process.argv[2] === 'source') return source();
  if (process.argv[2] === 'bundle') return scenario(5, 'All current source bytes and unchanged package version are in the bundle', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))), lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
    assert.equal(pkg.version, version); assert.equal(lock.version, version); assert.equal(lock.packages[''].version, version);
    const bundle = path.join(output, 'build/win-unpacked/resources/app.asar');
    const { scripts, devDependencies, build, ...expected } = pkg;
    assert.deepEqual(JSON.parse(asar.extractFile(bundle, 'package.json')), expected);
    const sources = files(path.join(root, 'src'));
    for (const file of sources) assert.ok(asar.extractFile(bundle, path.relative(root, file)).equals(fs.readFileSync(file)), file);
    assert.equal(report.checks.filter(item => item.id <= 4 && item.status === 'PASS').length, 4);
    return { version, exactSourceFiles: sources.length };
  });
  assert.equal(process.argv[2], 'export');
  await scenario(6, 'Old build removed, exported installer metadata and actual packaged UI are correct', async () => {
    const release = path.join(root, 'release');
    const info = JSON.parse(fs.readFileSync(path.join(output, 'installer-info.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(info.productVersion, version); assert.ok(info.size > 0); assert.deepEqual(info.oldInstallers, []);
    assert.ok(fs.existsSync(path.join(release, `MedoMusic-Setup-${version}-x64.exe.blockmap`)));
    const profile = path.join(output, 'ExportProfile'), music = path.join(output, 'ExportMusic');
    fs.mkdirSync(music, { recursive: true });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: path.join(release, 'win-unpacked/MedoMusic.exe'), args: [`--user-data-dir=${profile}`], env });
    try {
      const runtime = await app.evaluate(({ app }, music) => { app.setPath('music', music); return { version: app.getVersion(), profile: app.getPath('userData'), appPath: app.getAppPath() }; }, music);
      assert.equal(runtime.version, version); assert.equal(path.resolve(runtime.profile).toLowerCase(), profile.toLowerCase());
      assert.equal(path.resolve(runtime.appPath).toLowerCase(), path.join(release, 'win-unpacked/resources/app.asar').toLowerCase());
      const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.waitForFunction(() => typeof lastShortcutStates !== 'undefined' && lastShortcutStates.size === 5);
      const display = await page.evaluate(async () => {
        applyAutoUpdateSetting(false); wordLyricsEnabled = true; lyricTranslationEnabled = false;
        const track = { id: 'export-refresh', path: 'Fixture.wav', title: 'Fixture', artist: 'Singer', duration: 120, metadataLoaded: true };
        tracks = [track]; currentIndex = 0; playbackQueueIds = [track.id];
        lyricsCache.set(track.id, { ...parseLyrics('[00:01.00]Network line', 120), source: 'netease-line', wordTimingRequested: true, metadataKey: lyricMetadataKey(track), retryAt: Date.now() + 60000 });
        openPlaybackDetail(); await renderAppInfo();
        const status = document.querySelector('#lyric-status');
        const result = { about: document.querySelector('#about-version').textContent, hidden: status.hidden, message: status.querySelector('.lyric-status-message').textContent, source: status.querySelector('.lyric-status-source').textContent };
        wordLyricsEnabled = false; renderLyrics(track); result.ordinaryHidden = status.hidden;
        return result;
      });
      assert.match(display.about, /1\.6\.4$/); assert.equal(display.hidden, false);
      assert.match(display.message, /暂未找到逐字歌词/); assert.equal(display.source, '网易云音乐 · 逐行歌词');
      assert.equal(display.ordinaryHidden, true); assert.deepEqual(errors, []);
      return { ...info, ...runtime, display, rendererErrors: errors };
    } finally { await app.close(); }
  });
  assert.equal(report.checks.length, 6); assert.equal(report.passed, 6);
  console.log('SUMMARY 6/6 PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
