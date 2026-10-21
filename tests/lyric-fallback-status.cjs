// Six acceptance scenarios for the completed UI/source change and its export.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');
const asar = require('@electron/asar');
const { createOnlineLyricsSearch, LYRICS_CACHE_VERSION } = require('../src/lyrics-search');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'artifacts/lyric-fallback-1.6.4');
fs.mkdirSync(output, { recursive: true });
const reportPath = path.join(output, 'checks.json');
const exporting = process.argv.includes('--export');
const retrying = process.argv.includes('--retry-failed');
const report = exporting || retrying ? JSON.parse(fs.readFileSync(reportPath)) : { total: 6, version: '1.6.4', results: [] };
const line = '[00:01.00]Original timed lyrics\n[00:03.00]Another lyric line';
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value, text: async () => String(value) });
const options = { title: 'Fixture', artist: 'Singer', album: 'Album', duration: 120, requireWordTiming: true };
function aborting(signal) {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}
function sources({ qqDuration = 128, netDuration = 120, hang = false, publicOnly = false } = {}) {
  let qrcCount = 0;
  return async (url, init = {}) => {
    if (String(url).includes('musicu.fcg')) return response({ req_1: { data: { body: { song: { list: publicOnly ? [] : [1, 2].map(id => ({ id, mid: `m${id}`, name: 'Fixture', singer: [{ name: 'Singer' }], interval: qqDuration })) } } } } });
    if (String(url).includes('lyric_download')) { if (hang && ++qrcCount > 1) return aborting(init.signal); return response(''); }
    if (String(url).includes('fcg_query_lyric')) return response('MusicJsonCallback_lrc(' + JSON.stringify({ code: 0, lyric: Buffer.from(line).toString('base64') }) + ')');
    if (String(url).includes('cloudsearch')) return response({ result: { songs: publicOnly || hang ? [] : [{ id: 1, name: 'Fixture', ar: [{ name: 'Singer' }], dt: netDuration * 1000 }] } });
    if (init.method === 'POST') return response({ lrc: { lyric: line } });
    const good = { trackName: 'Fixture', artistName: 'Singer', albumName: 'Album', duration: 120 };
    if (String(url).includes('/api/get?')) return response({ ...good, plainLyrics: 'Plain exact result' });
    return response([{ ...good, plainLyrics: 'Plain exact result' }, { ...good, albumName: '', syncedLyrics: line }, { ...good, artistName: 'Other Singer', syncedLyrics: '[00:01.00]Wrong artist' }]);
  };
}
async function scenario(id, name, action) {
  if (retrying && report.results.some(item => item.id === id && item.status === 'PASS')) return;
  let result;
  try { result = { id, name, status: 'PASS', ...await action() }; }
  catch (error) { result = { id, name, status: 'FAIL', error: error.stack || String(error) }; process.exitCode = 1; }
  report.results = [...report.results.filter(item => item.id !== id), result].sort((a, b) => a.id - b.id);
  report.passed = report.results.filter(item => item.status === 'PASS').length;
  report.failed = report.results.filter(item => item.status === 'FAIL').length;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(result));
}
function fixture() {
  const folder = fs.mkdtempSync(path.join(output, 'run-'));
  fs.mkdirSync(path.join(folder, 'Music'));
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'medo-fallback-acceptance', version: '1.6.4', main: 'main.cjs' }));
  fs.writeFileSync(path.join(folder, 'main.cjs'), `
    const {app,globalShortcut,shell}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(folder, 'Profile'))});app.setPath('music',${JSON.stringify(path.join(folder, 'Music'))});
    const keys=new Set();globalShortcut.register=key=>{keys.add(key);return true;};globalShortcut.isRegistered=key=>keys.has(key);globalShortcut.unregister=key=>keys.delete(key);shell.openExternal=async()=>{};
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({result:{songs:[]}}),text:async()=>''});
    require(${JSON.stringify(path.join(root, 'src/main.js'))});
  `);
  return folder;
}
async function seed(page) {
  await page.evaluate(() => {
    applyAutoUpdateSetting(false); lyricTranslationEnabled = false; wordLyricsEnabled = true;
    const track = { id: 'fallback-ui', path: 'fixture.wav', title: '普通歌词展示', artist: '演唱者', album: '专辑', duration: 180, metadataLoaded: true };
    tracks = [track]; currentIndex = 0; playbackQueueIds = [track.id];
    const text = Array.from({ length: 30 }, (_, i) => `[${String(Math.floor(i * 4 / 60)).padStart(2, '0')}:${String(i * 4 % 60).padStart(2, '0')}.00]${i + 1} · 普通歌词依然清晰可读`).join('\n');
    lyricsCache.set(track.id, { ...parseLyrics(text, 180), source: 'qq-line', confidence: 97, wordTimingRequested: true, metadataKey: lyricMetadataKey(track), retryAt: Date.now() + 60000 });
    openPlaybackDetail();
  });
  await page.waitForFunction(() => document.body.classList.contains('playback-detail-active'));
}
async function main() {
  if (!exporting) {
    const folder = fixture(), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: path.join(root, '.electron-dist/electron.exe'), args: [folder], cwd: root, env });
    const errors = [];
    try {
      const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
      await page.waitForFunction(() => typeof renderLyricStatus === 'function' && localStorage.getItem('medo.initialScanComplete') === 'true');
      await seed(page);
      await scenario(1, 'Pinned footer stays clear of the lyric viewport across themes and sizes', async () => {
        const layouts = [];
        for (const [width, height, theme] of [[1440, 960, 'light'], [1440, 960, 'dark'], [960, 720, 'light'], [960, 720, 'dark']]) {
          await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(...size); }, [width, height]);
          await page.evaluate(theme => { applyTheme(theme); lyricsStage.classList.remove('inspecting'); }, theme);
          await page.evaluate(() => Promise.all(document.getAnimations().filter(item => item.playState === 'running' && item.effect?.target?.id === 'playback-detail').map(item => item.finished.catch(() => {}))));
          const measure = () => page.evaluate(() => {
            const status = document.querySelector('#lyric-status'), viewport = document.querySelector('.lyrics-viewport');
            const note = status.getBoundingClientRect(), view = viewport.getBoundingClientRect(), stage = lyricsStage.getBoundingClientRect();
            return { x: note.x, y: note.y, gap: note.top - view.bottom, outsideScroller: !lyricsLines.contains(status), fits: note.left >= stage.left && note.right <= stage.right && note.bottom <= stage.bottom, textFits: status.scrollWidth <= status.clientWidth + 1, source: status.textContent.trim() };
          });
          const before = await measure();
          await page.evaluate(() => { lyricsLines.style.transform = 'translateY(-800px)'; });
          const after = await measure();
          assert.equal(before.outsideScroller, true); assert.ok(before.gap >= 0); assert.ok(before.fits && before.textFits); assert.ok(Math.abs(before.y - after.y) < .25);
          const screenshot = path.join(folder, `${theme}-${width}.png`); await page.locator('#playback-detail').screenshot({ path: screenshot });
          layouts.push({ width, height, theme, ...after, screenshot });
        }
        return { layouts };
      });
      await scenario(2, 'Source labels, mixed lyrics, follow button and empty states', async () => {
        const states = await page.evaluate(() => {
          const labels = [];
          for (const source of ['qq-line', 'netease-line', 'lrclib', 'embedded', 'sidecar', null]) {
            renderLyricStatus({ ...parseLyrics('[00:01.00]普通歌词', 120), source });
            labels.push(document.querySelector('.lyric-status-source').textContent);
          }
          renderLyricStatus(parseLyrics('[1000,1000]逐(1000,500)字(1500,500)\n[00:03.00]普通歌词', 120));
          const mixed = document.querySelector('.lyric-status-message').textContent;
          lyricsStage.classList.add('inspecting');
          const hiddenWhileInspecting = getComputedStyle(document.querySelector('#lyric-status')).visibility === 'hidden';
          const restoreVisible = getComputedStyle(document.querySelector('#restore-lyric-follow')).visibility === 'visible';
          lyricsStage.classList.remove('inspecting'); wordLyricsEnabled = false;
          renderLyricStatus({ ...parseLyrics('[00:01.00]普通歌词', 120), source: 'netease-line' });
          const normal = document.querySelector('.lyric-status-message').textContent;
          renderLyricStatus({ lines: [] }); const emptyHidden = document.querySelector('#lyric-status').hidden;
          renderLyricStatus({ ...parseLyrics('Plain text', 120), source: 'lrclib' }); const plain = document.querySelector('.lyric-status-source').textContent;
          clearCurrentPlayback(); const cleared = document.querySelector('#lyric-status').hidden;
          return { labels, mixed, hiddenWhileInspecting, restoreVisible, normal, emptyHidden, plain, cleared };
        });
        assert.deepEqual(states.labels, ['QQ 音乐 · 逐行歌词', '网易云音乐 · 逐行歌词', 'LRCLIB · 逐行歌词', '内嵌歌词 · 逐行歌词', '本地 LRC · 逐行歌词', '未知来源 · 逐行歌词']);
        assert.match(states.mixed, /其余 1 行/); assert.equal(states.hiddenWhileInspecting, true); assert.equal(states.restoreVisible, true);
        assert.equal(states.normal, ''); assert.equal(states.emptyHidden, true); assert.equal(states.cleared, true); assert.equal(states.plain, '');
        assert.deepEqual(errors, []); return { ...states, rendererErrors: errors };
      });
    } finally { await app.close(); }
    await scenario(3, 'Fallback chooses the stronger match and LRCLIB timed result without relaxing artist guards', async () => {
      const cases = [];
      for (const config of [{ qqDuration: 123, netDuration: 120, expected: 'netease-line' }, { qqDuration: 120, netDuration: 123, expected: 'qq-line' }, { publicOnly: true, expected: 'lrclib' }]) {
        const cache = {};
        const search = createOnlineLyricsSearch({ getCache: async () => cache, fetchImplementation: sources(config), now: () => 100000 });
        const found = await search(options);
        assert.equal(found.source, config.expected); assert.equal(found.text, line); assert.equal(found.match.artist, 'Singer'); assert.equal(found.retryAt, 160000);
        assert.equal(Object.values(cache)[0].version, LYRICS_CACHE_VERSION); cases.push({ source: found.source, confidence: found.confidence, duration: found.match.duration });
      }
      return { cases, cacheVersion: LYRICS_CACHE_VERSION };
    });
    await scenario(4, 'Provider timeout retains a published line; parent cancellation stores no result', async () => {
      const cache = {}, search = createOnlineLyricsSearch({ getCache: async () => cache, fetchImplementation: sources({ qqDuration: 120, hang: true }), providerTimeoutMs: 60, requestTimeoutMs: 1000, totalTimeoutMs: 2000 });
      const found = await search(options); assert.equal(found.source, 'qq-line'); assert.equal(found.text, line);
      const cancelledCache = {}, controller = new AbortController(); let started;
      const pending = new Promise(resolve => { started = resolve; });
      const cancelledSearch = createOnlineLyricsSearch({ getCache: async () => cancelledCache, fetchImplementation: async (_url, init) => { started(); return aborting(init.signal); } });
      const task = cancelledSearch(options, { signal: controller.signal }); await pending; controller.abort(); const cancelled = await task;
      assert.equal(cancelled.cancelled, true); assert.deepEqual(cancelledCache, {});
      return { retainedSource: found.source, cancelled: true, cancelledCacheEntries: 0 };
    });
    assert.equal(report.results.length, 4); return;
  }
  assert.equal(report.passed, 4); assert.equal(report.failed, 0);
  await scenario(5, 'Exported bundle matches current source, same version and clean installer output', () => {
    const bundle = path.join(root, 'release/win-unpacked/resources/app.asar');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '1.6.4');
    assert.equal(JSON.parse(asar.extractFile(bundle, 'package.json')).version, '1.6.4');
    const changed = ['src/index.html', 'src/styles.css', 'src/renderer.js', 'src/renderer-playback.js', 'src/lyrics-search.js', 'src/qq-music.js', 'src/netease-eapi.js'];
    for (const file of changed) assert.ok(asar.extractFile(bundle, path.normalize(file)).equals(fs.readFileSync(path.join(root, file))), file);
    const info = JSON.parse(fs.readFileSync(path.join(output, 'installer-info.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(info.productVersion, '1.6.4'); assert.ok(info.size > 0); assert.equal(info.oldInstallers.length, 0);
    return { exactSourceFiles: changed.length, ...info };
  });
  await scenario(6, 'Actual packaged app shows the pinned source/status and current lyric cache', async () => {
    const profile = path.join(output, 'PackagedProfile'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    fs.mkdirSync(path.join(output, 'Music'), { recursive: true });
    const app = await _electron.launch({ executablePath: path.join(root, 'release/win-unpacked/MedoMusic.exe'), args: [`--user-data-dir=${profile}`], env });
    try {
      const info = await app.evaluate(({ app }, music) => { app.setPath('music', music); return { version: app.getVersion(), profile: app.getPath('userData') }; }, path.join(output, 'Music'));
      assert.equal(info.version, '1.6.4'); assert.equal(path.resolve(info.profile).toLowerCase(), profile.toLowerCase());
      const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.waitForFunction(() => typeof renderLyricStatus === 'function'); await seed(page);
      const state = await page.evaluate(async () => { await renderAppInfo(); return { about: document.querySelector('#about-version').textContent, message: document.querySelector('.lyric-status-message').textContent, source: document.querySelector('.lyric-status-source').textContent, outsideScroller: !lyricsLines.contains(document.querySelector('#lyric-status')) }; });
      assert.match(state.about, /1\.6\.4$/); assert.equal(state.message, '暂未找到逐字歌词'); assert.equal(state.source, 'QQ 音乐 · 逐行歌词'); assert.equal(state.outsideScroller, true);
      const cacheVersion = await app.evaluate(({ app }) => { const path = process.getBuiltinModule('path'); return process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(), 'package.json'))('./src/lyrics-search').LYRICS_CACHE_VERSION; });
      assert.equal(cacheVersion, LYRICS_CACHE_VERSION); assert.deepEqual(errors, []); return { ...info, ...state, cacheVersion, rendererErrors: errors };
    } finally { await app.close(); }
  });
  assert.equal(report.results.length, 6); console.log(JSON.stringify({ total: 6, passed: report.passed, failed: report.failed }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
