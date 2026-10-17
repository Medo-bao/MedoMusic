const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-lyrics-search-'));
const artifacts = path.join(__dirname, 'artifacts', 'lyrics-search');
const songPath = path.join(fixture, 'song.wav');
const metadataPath = path.join(fixture, 'metadata.wav');
const localPath = path.join(fixture, 'song.lrc');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

function makeWav() {
  const bytes = Buffer.alloc(44 + 16000);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16000, 40);
  return bytes;
}

async function run() {
  fs.mkdirSync(artifacts, { recursive: true });
  fs.mkdirSync(path.join(fixture, 'Music'));
  fs.writeFileSync(songPath, makeWav());
  fs.writeFileSync(metadataPath, makeWav());
  fs.writeFileSync(localPath, '[00:01.00]本地歌词');
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
    name: 'medo-lyrics-search-test', version: require('../package.json').version, main: 'bootstrap.cjs'
  }));
  fs.writeFileSync(path.join(fixture, 'bootstrap.cjs'), `
    const { app, ipcMain, shell } = require('electron');
    app.setPath('userData', ${JSON.stringify(path.join(fixture, 'Profile'))});
    app.setPath('music', ${JSON.stringify(path.join(fixture, 'Music'))});
    const state = globalThis.__lyricFixture = { mode: 'line', title: '测试歌曲', calls: [], invocations: [], external: [], aborted: 0 };
    const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value, text: async () => String(value) });
    const handle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
      if (channel === 'music:lyrics') state.invocations.push(args[0]);
      if (channel === 'music:metadata' && state.metadataGate && !state.metadataGate.used) {
        state.metadataGate.used = true;
        state.metadataGate.startedResolve();
        await state.metadataGate.promise;
      }
      return listener(event, ...args);
    });
    shell.openExternal = async url => {
      state.external.push(url);
      if (state.openError) throw new Error('fixture browser failure');
      if (state.openGate) await state.openGate.promise;
    };
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input);
      if (url.hostname === 'api.github.com') return response({ tag_name: 'v1.6.3', html_url: 'https://github.com/Medo-bao/MedoMusic/releases/tag/v1.6.3' });
      state.calls.push(url.href);
      state.onFetch?.(); state.onFetch = null;
      if (state.mode === 'pending') return new Promise((_resolve, reject) => {
        const abort = () => { state.aborted++; reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
      });
      if (state.mode === 'failure') return response(null, 503);
      if (url.href.includes('musicu.fcg')) return response({ req_1: { data: { body: { song: { list: state.mode === 'empty' ? [] : [
        { id: 1, mid: 'fixture', name: state.title, singer: [{ name: '测试歌手' }], interval: 180 }
      ] } } } } });
      if (url.href.includes('lyric_download')) return response('');
      if (url.href.includes('fcg_query_lyric')) return response('MusicJsonCallback_lrc(' + JSON.stringify({ code: 0, lyric: Buffer.from('[00:01.00]网络歌词').toString('base64') }) + ');');
      if (url.href.includes('cloudsearch')) return response({ result: { songs: [] } });
      if (url.pathname.endsWith('/get')) return response(null, 404);
      return response([]);
    };
    require(${JSON.stringify(path.join(root, 'src/main.js'))});
  `);

  let application;
  const checks = [];
  const errors = [];
  try {
    application = await _electron.launch({ executablePath: path.join(root, '.electron-dist', 'electron.exe'), args: [fixture], cwd: root, env });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof ensureLyrics === 'function' && localStorage.getItem('medo.initialScanComplete') === 'true');
    await page.evaluate(() => { applyAutoUpdateSetting(false); applyLyricTranslationSetting(false); wordLyricsEnabled = false; });
    const track = { id: 'a', path: songPath, title: '测试歌曲', artist: '测试歌手', album: '测试专辑', duration: 180, metadataLoaded: true, format: 'WAV' };
    const waitForFetch = () => application.evaluate(async () => {
      if (!globalThis.__lyricFixture.calls.length) await new Promise(resolve => { globalThis.__lyricFixture.onFetch = resolve; });
    });

    // 15. Local precedence and explicit online refresh through the real IPC handler.
    const local = await page.evaluate(track => window.medo.readLyrics({ ...track, filePath: track.path, mode: 'auto' }), track);
    assert.equal(local.source, 'sidecar');
    assert(local.text.includes('本地歌词'));
    assert.equal(await application.evaluate(() => globalThis.__lyricFixture.calls.length), 0);
    const online = await page.evaluate(track => window.medo.readLyrics({ ...track, filePath: track.path, mode: 'auto', force: true }), track);
    assert.equal(online.source, 'qq-line');
    fs.writeFileSync(localPath, '[1000,1000]本(1000,500)地(1500,500)');
    assert.equal((await page.evaluate(track => window.medo.readLyrics({ ...track, filePath: track.path, mode: 'auto', requireWordTiming: true }), track)).source, 'sidecar');
    fs.writeFileSync(localPath, '[00:01.00]本地歌词');
    checks.push('15: local precedence, native words and explicit network refresh');

    // 16. Duplicate calls merge; switching tracks aborts the active HTTP request.
    await application.evaluate(() => { Object.assign(globalThis.__lyricFixture, { mode: 'pending', calls: [], invocations: [], aborted: 0 }); });
    await page.evaluate(track => {
      cancelPendingLyrics(); lyricsCache.clear(); tracks = [track, { ...track, id: 'b' }]; currentIndex = 0;
      window.__oldLyrics = ensureLyrics(tracks[0], true);
      window.__duplicateLyrics = ensureLyrics(tracks[0]);
    }, track);
    await waitForFetch();
    assert.equal(await application.evaluate(() => globalThis.__lyricFixture.invocations.length), 1);
    await application.evaluate(() => { globalThis.__lyricFixture.mode = 'line'; });
    await page.evaluate(async () => { currentIndex = 1; await ensureLyrics(tracks[1], true); await Promise.all([window.__oldLyrics, window.__duplicateLyrics]); });
    assert.deepEqual(await page.evaluate(() => ({ old: lyricsCache.has('a'), current: lyricsCache.get('b')?.source, pending: lyricsRequests.size })),
      { old: false, current: 'qq-line', pending: 0 });
    assert(await application.evaluate(() => globalThis.__lyricFixture.aborted > 0));
    checks.push('16: duplicate requests, track-switch cancellation and stale-response rejection');

    // 17. An abandoned metadata load cannot start a new lyric search later.
    await application.evaluate(() => {
      const gate = { used: false };
      gate.promise = new Promise(resolve => { gate.release = resolve; });
      gate.started = new Promise(resolve => { gate.startedResolve = resolve; });
      Object.assign(globalThis.__lyricFixture, { mode: 'line', invocations: [], metadataGate: gate });
    });
    await page.evaluate(({ track, metadataPath }) => {
      cancelPendingLyrics(); lyricsCache.clear();
      tracks = [{ ...track, id: 'meta', path: metadataPath, metadataLoaded: false, duration: 0 }, { ...track, id: 'ready' }]; currentIndex = 0;
      window.__metadataLyrics = ensureLyrics(tracks[0], true);
    }, { track, metadataPath });
    await application.evaluate(async () => { await globalThis.__lyricFixture.metadataGate.started; });
    await page.evaluate(async () => { currentIndex = 1; await ensureLyrics(tracks[1], true); });
    await application.evaluate(() => { globalThis.__lyricFixture.metadataGate.release(); });
    await page.evaluate(async () => { await window.__metadataLyrics; });
    const metadataCalls = await application.evaluate(() => globalThis.__lyricFixture.invocations);
    assert.equal(metadataCalls.length, 1);
    assert.equal(metadataCalls[0].filePath, songPath);
    checks.push('17: late metadata cannot restart an abandoned lyric request');

    // 18. Renderer misses expire, metadata edits requery, and clearing playback cancels work.
    await application.evaluate(() => { Object.assign(globalThis.__lyricFixture, { mode: 'empty', calls: [], invocations: [] }); });
    await page.evaluate(async track => {
      cancelPendingLyrics(); lyricsCache.clear(); tracks = [{ ...track, id: 'cache' }]; currentIndex = 0;
      await ensureLyrics(tracks[0], true); await ensureLyrics(tracks[0]);
    }, { ...track, path: metadataPath });
    assert.equal(await application.evaluate(() => globalThis.__lyricFixture.invocations.length), 1);
    await page.evaluate(async () => { lyricsCache.get('cache').retryAt = Date.now() - 1; await ensureLyrics(tracks[0]); });
    assert.equal(await application.evaluate(() => globalThis.__lyricFixture.invocations.length), 2);
    await application.evaluate(() => { Object.assign(globalThis.__lyricFixture, { mode: 'line', title: '修改歌曲' }); });
    await page.evaluate(async () => { tracks[0].title = '修改歌曲'; await ensureLyrics(tracks[0]); });
    assert.equal(await page.evaluate(() => lyricsCache.get('cache').source), 'qq-line');
    await application.evaluate(() => { Object.assign(globalThis.__lyricFixture, { mode: 'pending', calls: [], aborted: 0 }); });
    await page.evaluate(() => { window.__clearedLyrics = ensureLyrics(tracks[0], true); });
    await waitForFetch();
    await page.evaluate(async () => { clearCurrentPlayback(); await window.__clearedLyrics; });
    assert.equal(await page.evaluate(() => lyricsRequests.size), 0);
    assert(await application.evaluate(() => globalThis.__lyricFixture.aborted > 0));
    checks.push('18: miss expiry, metadata edits and clear-playback cancellation');

    // 19. About entry retains the shared material and fits light/dark and narrow windows.
    await page.evaluate(() => { currentView = 'settings'; currentPlaylist = null; currentCollection = null; render(); });
    for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 960], ['dark', 960]]) {
      await application.evaluate(({ BrowserWindow }, width) => { BrowserWindow.getAllWindows()[0].setSize(width, 860); }, width);
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.locator('#open-github-page').scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const layout = await page.locator('#open-github-page').evaluate(button => {
        const rectangle = button.getBoundingClientRect();
        const group = button.closest('.settings-group').getBoundingClientRect();
        const reference = document.createElement('button');
        reference.className = 'secondary-button';
        reference.style.cssText = 'position:fixed;visibility:hidden';
        button.after(reference);
        const shared = getComputedStyle(reference).backgroundColor;
        reference.remove();
        return { left: rectangle.left - group.left, right: group.right - rectangle.right, height: rectangle.height,
          background: getComputedStyle(button).backgroundColor, shared };
      });
      assert(layout.left >= 12 && layout.right >= 12 && layout.height >= 36);
      assert.equal(layout.background, layout.shared);
      await page.locator('#settings-about').screenshot({ path: path.join(artifacts, `about-${theme}-${width}.png`) });
    }
    checks.push('19: shared material and light/dark/narrow About layouts');

    // 20. Click/keyboard use the exact repository URL; failures restore the button.
    await application.evaluate(() => {
      const gate = {}; gate.promise = new Promise(resolve => { gate.release = resolve; });
      Object.assign(globalThis.__lyricFixture, { external: [], openError: false, openGate: gate });
    });
    await page.locator('#open-github-page').click();
    await page.waitForFunction(() => document.querySelector('#open-github-page').disabled);
    assert.deepEqual(await application.evaluate(() => globalThis.__lyricFixture.external), ['https://github.com/Medo-bao/MedoMusic']);
    await application.evaluate(() => { globalThis.__lyricFixture.openGate.release(); globalThis.__lyricFixture.openGate = null; });
    await page.waitForFunction(() => !document.querySelector('#open-github-page').disabled);
    await application.evaluate(() => { globalThis.__lyricFixture.openError = true; });
    await page.locator('#open-github-page').focus();
    await page.keyboard.press('Enter');
    await page.getByText('无法打开 GitHub，请检查默认浏览器设置', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#open-github-page').getAttribute('aria-busy'), null);
    assert.equal(await page.evaluate(() => currentView), 'settings');
    assert.deepEqual(await application.evaluate(() => globalThis.__lyricFixture.external), Array(2).fill('https://github.com/Medo-bao/MedoMusic'));
    checks.push('20: GitHub IPC, keyboard access, busy state and failure recovery');

    assert.equal(checks.length, 6);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(artifacts, 'ui-checks.json'), JSON.stringify({ totalScenarios: 6, checks, errors }, null, 2));
    console.log(JSON.stringify({ totalScenarios: 6, checks, errors }, null, 2));
  } finally {
    await application?.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
