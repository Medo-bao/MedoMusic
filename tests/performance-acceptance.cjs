// Fixed ten-scenario acceptance for the 1.6.4 performance change.
// Run after implementation; --case=N reruns an existing scenario after a repair.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const asar = require('@electron/asar');
const { PNG } = require('pngjs');
const root = path.resolve(__dirname, '..');
const baseline = process.env.MEDO_PERF_BASELINE;
const artifacts = path.join(__dirname, 'artifacts', 'runtime-performance');
const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-performance-acceptance-'));
const reportFile = path.join(artifacts, 'results.json');
fs.mkdirSync(artifacts, { recursive: true });
const report = fs.existsSync(reportFile) && process.argv.some(a => a.startsWith('--case='))
  ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { total: 10, baseline, runDirectory, scenarios: [] };
const selected = Number(process.argv.find(a => a.startsWith('--case='))?.split('=')[1]) || null;
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const applications = new Set();
let live;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function command(executable, args, name) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = fs.createWriteStream(path.join(artifacts, `${name}.log`));
    let tail = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output.write(chunk); tail = (tail + chunk).slice(-3000); });
    child.once('error', reject);
    child.once('exit', code => { output.end(); code === 0 ? resolve(tail) : reject(new Error(`${name} exited ${code}\n${tail}`)); });
  });
}

// Two real, locally streamed PCM files. No user music or user profile is modified.
const music = path.join(runDirectory, 'Music'); fs.mkdirSync(music);
function wav(frequency) {
  const rate = 48000, frames = rate * 90, data = Buffer.alloc(frames * 4 + 44);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) { const value = Math.round(Math.sin(i * 2 * Math.PI * frequency / rate) * 2000); data.writeInt16LE(value, 44 + i * 4); data.writeInt16LE(value, 46 + i * 4); }
  return data;
}
for (const [index, frequency] of [220, 330].entries()) {
  fs.writeFileSync(path.join(music, `${index}.wav`), wav(frequency));
  fs.writeFileSync(path.join(music, `${index}.lrc`), Array.from({ length: 90 }, (_, i) =>
    `[00:${String(i).padStart(2, '0')}.00]<00:${String(i).padStart(2, '0')}.00>同步歌词 ${i}`).join('\n'));
}
// Valid timed words for the display/IPC scenarios, independent of network providers.
const timedLyrics = Array.from({ length: 45 }, (_, i) => ({ start: i * 2, end: i * 2 + 2, text: `同步歌词 ${i}`,
  words: [{ text: '同步', start: i * 2, end: i * 2 + .8 }, { text: `歌词 ${i}`, start: i * 2 + .8, end: i * 2 + 2 }], translations: { 'zh-hans': `中文翻译 ${i}` } }));

async function launch(source, label, profile = path.join(runDirectory, `${label}-profile`), executable = null) {
  const fixture = path.join(runDirectory, `${label}-app-${Date.now()}`); fs.mkdirSync(fixture);
  const entry = path.join(source, 'src', 'main.js');
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'medo-performance-acceptance', version: '1.6.4', main: 'main.cjs' }));
  fs.writeFileSync(path.join(fixture, 'main.cjs'), `
    const {app,globalShortcut,ipcMain,BrowserWindow}=require('electron'),fs=require('node:fs/promises');
    app.setPath('userData',${JSON.stringify(profile)});app.setPath('music',${JSON.stringify(music)});
    globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.isRegistered=()=>true;
    const extension=require.resolve(${JSON.stringify(path.join(source, 'src', 'myfirefly-extension.js'))});
    require.cache[extension]={id:extension,filename:extension,loaded:true,exports:{startMyFireflyExtension:async()=>({stop:async()=>{}})}};
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({tag_name:'v1.6.4',result:{songs:[]}}),text:async()=>''});
    const stats=globalThis.__performance={full:0,ticks:0,forwarded:0,statActive:0,statMax:0,statCalls:0};
    const stat=fs.stat.bind(fs);fs.stat=async(...args)=>{
      const record=String(args[0]).startsWith(${JSON.stringify(music)});if(record){stats.statCalls++;stats.statMax=Math.max(stats.statMax,++stats.statActive);}
      try{return await stat(...args);}finally{if(record)stats.statActive--;}
    };
    ipcMain.on('lyrics-window:update',(_e,p)=>{if(p.positionOnly)stats.ticks++;else stats.full++;});
    app.on('browser-window-created',(_e,win)=>{const send=win.webContents.send.bind(win.webContents);win.webContents.send=(channel,...args)=>{if(channel==='lyrics-window:line')stats.forwarded++;return send(channel,...args);};});
    require(${JSON.stringify(entry)});
  `);
  if (executable) await asar.createPackage(fixture, path.join(path.dirname(executable), 'resources/app.asar'));
  const begin = performance.now();
  const app = await _electron.launch({ executablePath: executable || path.join(root, '.electron-dist', 'electron.exe'), args: executable ? [] : [fixture], env, cwd: root });
  applications.add(app);
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => typeof restorePlaybackState === 'function' && typeof tracks !== 'undefined' && localStorage.getItem('medo.initialScanComplete') === 'true');
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')); win.setSize(1280, 820); win.show(); });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => { applyAutoUpdateSetting(false); applyLyricTranslationSetting(false); });
  return { app, page, profile, errors, startupMs: performance.now() - begin };
}
async function close(context) { if (!context) return; applications.delete(context.app); await context.app.close(); }
async function current() { return live ||= await launch(root, 'current'); }
async function seed(context, count = 2) {
  await context.page.evaluate(({ music, count, lyrics }) => {
    audio.pause(); clearTimeout(persistTimer); clearTimeout(metadataRenderTimer);
    tracks = Array.from({ length: count }, (_, i) => ({ id: `${music}\\${i % 2}.wav${i > 1 ? `#${i}` : ''}`, path: `${music}\\${i % 2}.wav`,
      title: `歌曲 ${i}`, artist: 'MedoMusic', album: '性能验收', format: 'WAV', duration: 90, metadataLoaded: true, playlists: [] }));
    currentIndex = -1; playbackQueueIds = tracks.map(t => t.id); favorites = new Set(); playlists = []; recent = []; playStats = {};
    currentView = 'library'; currentPlaylist = null; currentCollection = null; currentSort = 'songs'; librarySort = 'manual'; query = '';
    selectedTrackIds.clear(); lyricsCache.clear(); wordLyricsEnabled = true; lyricTranslationEnabled = true;
    for (const track of tracks.slice(0, 2)) lyricsCache.set(track.id, { synced: true, lines: lyrics, retryAt: Date.now() + 3600000, wordTimingRequested: true });
    ensureLyrics = async track => lyricsCache.get(track.id);
    desiredVolume = .1; volume.value = .1; applyOutputVolume(); updateVolumeDisplay(); render();
  }, { music, count, lyrics: timedLyrics });
}
async function play(context, enabled = false) {
  await context.page.evaluate(async enabled => {
    soundSettings = MedoSound.normalize({ ...MedoSound.presets.recommended, enabled }); updateSoundSettings();
    await playTrack(0, true); await soundInitialization;
  }, enabled);
  await context.page.waitForFunction(() => !audio.paused && audio.currentTime > .2 && soundEngine);
}
async function sample(context, milliseconds = 6000) {
  await context.app.evaluate(({ app }) => app.getAppMetrics());
  await sleep(milliseconds);
  return context.app.evaluate(({ app }) => {
    const processes = app.getAppMetrics();
    return { cpu: processes.reduce((s, p) => s + p.cpu.percentCPUUsage, 0),
      privateMiB: processes.reduce((s, p) => s + (p.memory.privateBytes || 0), 0) / 1024,
      processes: processes.map(p => ({ type: p.type, cpu: p.cpu.percentCPUUsage, privateMiB: p.memory.privateBytes / 1024 })) };
  });
}
async function tracePaint(context, label) {
  const cdp = await context.page.context().newCDPSession(context.page), events = [];
  cdp.on('Tracing.dataCollected', payload => events.push(...payload.value));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
  await sleep(2500);
  const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end'); await complete; await cdp.detach();
  fs.writeFileSync(path.join(artifacts, `compositor-${label}.json`), JSON.stringify({ traceEvents: events }));
  const paints = events.filter(e => e.name === 'Paint'), nodes = {};
  for (const p of paints) { const name = p.args.data?.nodeName || '?'; nodes[name] = (nodes[name] || 0) + 1; }
  return { count: paints.length, durationUs: paints.reduce((sum, e) => sum + (e.dur || 0), 0), nodes };
}
async function idleLayers(context) {
  const cdp = await context.page.context().newCDPSession(context.page);
  const changed = new Promise(resolve => cdp.once('LayerTree.layerTreeDidChange', resolve));
  await cdp.send('LayerTree.enable');
  const tree = await Promise.race([changed, sleep(1500).then(() => ({ layers: [] }))]);
  const layers = tree.layers || []; await cdp.detach();
  return { count: layers.length, drawing: layers.filter(l => l.drawsContent).length,
    drawingPixels: layers.filter(l => l.drawsContent).reduce((sum, l) => sum + l.width * l.height, 0) };
}
async function visuals(context, label) {
  const snapshots = [];
  for (const theme of ['dark', 'light']) for (const view of ['library', 'player']) {
    await context.page.evaluate(({ theme, view }) => {
      audio.pause(); applyTheme(theme); currentView = view; render();
      updatePlayButtonState(false); audio.currentTime = 2.4; updateLyricsAtTime();
    }, { theme, view });
    await sleep(550);
    await context.page.evaluate(() => document.getAnimations().forEach(a => {
      if (a.effect.getComputedTiming().iterations === Infinity) { a.pause(); a.currentTime = 200; }
      else a.finish();
    }));
    const name = `${label}-${theme}-${view}.png`;
    await context.page.screenshot({ path: path.join(artifacts, name) }); snapshots.push(name);
  }
  return snapshots;
}
function comparePng(before, after) {
  const a = PNG.sync.read(fs.readFileSync(path.join(artifacts, before))), b = PNG.sync.read(fs.readFileSync(path.join(artifacts, after)));
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let changed = 0, maximum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let delta = 0; for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(a.data[i + c] - b.data[i + c]));
    maximum = Math.max(maximum, delta); if (delta > 8) changed++;
  }
  return { before, after, changedPercent: changed / (a.width * a.height) * 100, maximum };
}

const scenarios = [
  ['Cold startup, persisted state and existing regression', async () => {
    await command('cmd.exe', ['/d', '/s', '/c', 'npm.cmd test'], 'existing-regression');
    const context = await current(); await seed(context);
    await context.page.evaluate(() => { favorites.add(tracks[0].id); desiredVolume = .34; persist(); });
    const profile = context.profile, firstMs = context.startupMs; await close(context); live = null;
    live = await launch(root, 'restored', profile);
    const state = await live.page.evaluate(() => ({ tracks: tracks.length, volume: desiredVolume, favorite: favorites.has(tracks[0]?.id) }));
    assert.deepEqual(state, { tracks: 2, volume: .34, favorite: true });
    return { firstMs, restoredMs: live.startupMs, state };
  }],
  ['Continuous original playback, compositor trace and unchanged visuals', async () => {
    await close(live); live = null;
    assert.ok(baseline && fs.existsSync(path.join(baseline, 'src/main.js')), 'Supply MEDO_PERF_BASELINE from the pre-edit snapshot');
    const before = await launch(baseline, 'before'); await seed(before); await play(before);
    const beforeMetrics = await sample(before), beforePaint = await tracePaint(before, 'before'), beforeVisuals = await visuals(before, 'before'), beforeLayers = await idleLayers(before); await close(before);
    const after = await current(); await seed(after); await play(after);
    const afterMetrics = await sample(after);
    const afterPaint = await tracePaint(after, 'after');
    const afterVisuals = await visuals(after, 'after');
    const afterLayers = await idleLayers(after);
    const comparisons = beforeVisuals.map((f, i) => comparePng(f, afterVisuals[i]));
    assert.ok(comparisons.every(c => c.changedPercent < .25), JSON.stringify(comparisons));
    assert.deepEqual(after.errors, []);
    return { before: beforeMetrics, after: afterMetrics, paint: { before: beforePaint, after: afterPaint }, idleLayers: { before: beforeLayers, after: afterLayers }, comparisons };
  }],
  ['Enhancement, original comparison and unchanged DSP', async () => {
    await command(process.execPath, ['tests/fxsound-worklet.cjs'], 'worklet-regression');
    const context = await current(); await seed(context); await play(context, true);
    const settings = await context.page.evaluate(async () => {
      const engine = soundEngine; soundCompare = true; updateSoundSettings(); soundCompare = false; updateSoundSettings();
      soundSettings.masterGain = -2; soundSettings.balance = 1; updateSoundSettings();
      return { reused: soundEngine === engine, active: soundSettings.enabled, context: outputAudioContext.state };
    });
    assert.deepEqual(settings, { reused: true, active: true, context: 'running' });
    return { settings, metrics: await sample(context, 3000) };
  }],
  ['Fade pause, warm context, fast resume and consecutive track switching', async () => {
    const context = await current(); await seed(context); await play(context);
    await context.page.evaluate(() => { applyPlaybackFadeSetting(true); pausePlayback(); });
    await context.page.waitForFunction(() => audio.paused && outputAudioContext.state === 'running');
    const paused = await sample(context, 4000);
    const resume = await context.page.evaluate(async () => {
      const engine = soundEngine, start = performance.now(); await resumePlayback();
      return { elapsedMs: performance.now() - start, paused: audio.paused, state: outputAudioContext.state, reused: soundEngine === engine };
    });
    assert.equal(resume.paused, false); assert.equal(resume.state, 'running'); assert.equal(resume.reused, true); assert.ok(resume.elapsedMs < 250);
    await context.page.evaluate(async () => { pausePlayback(); await resumePlayback(); await Promise.all([playTrack(1, true), playTrack(0, true)]); });
    await context.page.waitForFunction(() => currentIndex === 0 && !audio.paused && !playbackPausePending);
    await context.page.evaluate(() => { applyPlaybackFadeSetting(false); pausePlayback(); });
    await context.page.waitForFunction(() => audio.paused && outputAudioContext.state === 'running');
    await context.page.locator('#volume').evaluate(element => { element.value = '.42'; element.dispatchEvent(new Event('input')); });
    await sleep(450);
    assert.equal(await context.page.evaluate(() => outputAudioContext.state), 'running');
    await context.page.evaluate(async () => {
      soundSettings.enabled = true; updateSoundSettings(); await resumePlayback(); pausePlayback();
    });
    await context.page.waitForFunction(() => audio.paused && outputAudioContext.state === 'running');
    await context.page.evaluate(() => document.querySelector('#detail-clear-queue').click());
    assert.deepEqual(await context.page.evaluate(() => ({ index: currentIndex, source: audio.getAttribute('src'), queue: playbackQueueIds.length })), { index: -1, source: null, queue: 0 });
    return { paused, resume };
  }],
  ['Hidden main window with visible desktop lyrics', async () => {
    const context = await current(); await seed(context); await play(context);
    await context.page.evaluate(() => window.medo.toggleLyricsWindow());
    await sleep(500);
    const desktop = await context.app.waitForEvent('window', { timeout: 500 }).catch(() => null) ||
      (await context.app.windows()).find(w => w.url().includes('lyrics.html'));
    assert.ok(desktop, 'Desktop lyric window exists');
    await context.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).hide());
    await sleep(1100);
    const state = await context.page.evaluate(() => ({ time: audio.currentTime, backgroundMode, paused: audio.paused }));
    const text = await desktop.locator('#desktop-lyric').textContent();
    assert.equal(state.backgroundMode, true); assert.equal(state.paused, false); assert.ok(text.includes('同步歌词'));
    await desktop.screenshot({ path: path.join(artifacts, 'desktop-visible.png') });
    return { state, text, ipc: await context.app.evaluate(() => globalThis.__performance) };
  }],
  ['Both windows hidden and immediate current lyric restoration', async () => {
    const context = await current();
    await seed(context); await play(context);
    if (!(await context.app.windows()).some(w => w.url().includes('lyrics.html'))) {
      await context.page.evaluate(() => window.medo.toggleLyricsWindow()); await sleep(350);
    }
    if ((await context.page.evaluate(() => window.medo.getLyricsWindowState())).visible) await context.page.evaluate(() => window.medo.toggleLyricsWindow());
    await context.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).hide());
    await sleep(200);
    await context.page.evaluate(() => { globalThis.__hiddenMutations = 0; globalThis.__hiddenObserver = new MutationObserver(m => __hiddenMutations += m.length); __hiddenObserver.observe(document.querySelector('#lyrics-lines'), { subtree: true, attributes: true, childList: true, characterData: true }); });
    const start = await context.app.evaluate(() => globalThis.__performance.forwarded);
    const position = await context.page.evaluate(() => audio.currentTime); await sleep(1800);
    const hidden = await context.page.evaluate(position => { __hiddenObserver.disconnect(); return { mutations: __hiddenMutations, advanced: audio.currentTime - position, paused: audio.paused }; }, position);
    assert.equal(hidden.mutations, 0); assert.equal(hidden.paused, false); assert.ok(hidden.advanced > 1);
    assert.equal(await context.app.evaluate(() => globalThis.__performance.forwarded), start);
    await context.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).show());
    await context.page.evaluate(() => { currentView = 'player'; render(); }); await sleep(500);
    const restored = await context.page.evaluate(() => ({ index: activeLyricIndex, expected: Math.floor((audio.currentTime + .08) / 2), active: document.querySelector('#lyrics-lines .active')?.textContent }));
    assert.equal(restored.index, restored.expected); assert.ok(restored.active.includes('同步歌词'));
    await context.page.evaluate(() => { audio.pause(); updateLyricsAtTime(); window.medo.lockLyricsWindow(true); });
    await sleep(350);
    const desktop = (await context.app.windows()).find(w => w.url().includes('lyrics.html'));
    const desktopText = await desktop.locator('#desktop-lyric').getAttribute('data-text');
    const expectedText = await context.page.evaluate(() => lyricsCache.get(tracks[currentIndex].id).lines[Math.floor((audio.currentTime + .08) / 2)].text);
    assert.equal(desktopText, expectedText);
    return { hidden, restored, lockRestored: desktopText };
  }],
  ['Ten-thousand track search, virtual scrolling and indexed queues', async () => {
    const measure = async source => {
      const context = source === root ? await current() : await launch(source, 'large-before'); await seed(context, 10000);
      const metrics = await context.page.evaluate(async () => {
        const begin = performance.now(); currentView = 'now'; const result = visibleTracks(); const queueMs = performance.now() - begin;
        currentView = 'library'; query = '歌曲 999'; const found = visibleTracks().map(t => t.title);
        query = ''; render(); document.querySelector('main').scrollTop = 300000;
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        return { queueMs, queueCount: result.length, found, rows: document.querySelectorAll('.track-row').length };
      });
      if (source !== root) await close(context); return metrics;
    };
    await close(live); live = null;
    const before = await measure(baseline), after = await measure(root);
    assert.equal(after.queueCount, 10000); assert.deepEqual(after.found, before.found); assert.ok(after.rows < 100); assert.ok(after.queueMs < before.queueMs);
    return { before, after };
  }],
  ['Scan coalescing, bounded stats, failed scans and removed directories', async () => {
    const context = await current(); await seed(context);
    await context.app.evaluate(({ ipcMain }) => {
      globalThis.__originalScan = ipcMain._invokeHandlers.get('music:scan-folder');
      globalThis.__scanControl = { count: 0, active: 0, maximum: 0, fail: false };
      ipcMain.removeHandler('music:scan-folder');
      ipcMain.handle('music:scan-folder', async (_event, folder) => {
        const state = globalThis.__scanControl; state.count++; state.maximum = Math.max(state.maximum, ++state.active);
        await new Promise(resolve => setTimeout(resolve, 70)); state.active--;
        return state.fail ? null : { folder, tracks: [] };
      });
    });
    const result = await context.page.evaluate(async music => {
      const folder = music; musicFolders = [folder];
      const first = scanCurrentFolder(folder); const joins = Array.from({ length: 8 }, () => scanCurrentFolder(folder));
      const changed = scanCurrentFolder(folder, true);
      await Promise.all([first, changed, ...joins]);
      const stale = scanCurrentFolder(folder); removeFolder(folder); const removed = await stale;
      return { removed };
    }, music);
    const control = await context.app.evaluate(() => { const snapshot = { ...__scanControl }; __scanControl.fail = true; return snapshot; });
    const failed = await context.page.evaluate(async music => { musicFolders = [music]; const before = tracks.length; await rescanFolder(music); return { before, retained: tracks.length }; }, music);
    await context.app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('music:scan-folder'); ipcMain.handle('music:scan-folder', globalThis.__originalScan); });
    assert.equal(control.count, 3); assert.equal(control.maximum, 1); assert.equal(result.removed, null); assert.equal(failed.retained, failed.before);
    const extra = path.join(music, 'batch'); fs.mkdirSync(extra, { recursive: true });
    for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(extra, `${i}.wav`), Buffer.alloc(1));
    await context.app.evaluate(() => { __performance.statMax = 0; __performance.statCalls = 0; });
    const scan = await context.page.evaluate(folder => window.medo.scanFolder(folder), extra);
    const stats = await context.app.evaluate(() => ({ maximum: __performance.statMax, calls: __performance.statCalls }));
    assert.equal(scan.tracks.length, 40); assert.equal(stats.calls, 40); assert.ok(stats.maximum <= 16);
    return { ...result, control, failed, stats };
  }],
  ['Scoped saves, pending data, playlist durability and renderer reload', async () => {
    const context = await current(); await seed(context);
    await context.page.waitForFunction(() => metadataRequests.size === 0);
    const result = await context.page.evaluate(async () => {
      persist(); const stored = localStorage.getItem('medo.tracks'); let trackSerializations = 0;
      const stringify = JSON.stringify; JSON.stringify = function(value, ...args) { if (Array.isArray(value) && value[0]?.path) trackSerializations++; return stringify.call(this, value, ...args); };
      try {
        desiredVolume = .63; volume.value = .63; volume.dispatchEvent(new Event('input'));
        toggleFavorite(tracks[1].id); await new Promise(resolve => setTimeout(resolve, 400));
        await handleMyFireflyCommand({command:'control',action:'set-volume',value:.63});
        const lightweight = { trackSerializations, sameTracks: stored === localStorage.getItem('medo.tracks') };
        tracks[0].title = '保存后的标题'; schedulePersist('tracks');
        playlists = [{ name: '保留歌单', trackIds: [tracks[0].id] }]; persist('playlists');
        return { lightweight, savedTitle: loadJson('medo.tracks', [])[0].title };
      } finally { JSON.stringify = stringify; }
    });
    assert.deepEqual(result.lightweight, { trackSerializations: 0, sameTracks: true }); assert.equal(result.savedTitle, '保存后的标题');
    await context.page.reload(); await context.page.waitForFunction(() => typeof tracks !== 'undefined' && tracks[0]?.title === '保存后的标题');
    const restored = await context.page.evaluate(() => ({ volume: desiredVolume, favorite: favorites.has(tracks[1].id), playlist: playlists[0].name }));
    assert.deepEqual(restored, { volume: .63, favorite: true, playlist: '保留歌单' });
    return { ...result, restored };
  }],
  ['Packaged footprint, compression decision and packaged-source startup', async () => {
    await close(live); live = null;
    const previousArchive = path.join(root, 'release/win-unpacked/resources/app.asar');
    const before = report.packageBaseline || JSON.parse(fs.readFileSync(path.join(baseline, 'origin.json'), 'utf8')).packageBaseline ||
      report.scenarios.find(s => s.id === 10)?.evidence?.before || (fs.existsSync(previousArchive) ? { archiveBytes: fs.statSync(previousArchive).size, installerBytes: fs.statSync(path.join(root, 'release/MedoMusic-Setup-1.6.4-x64.exe')).size } : null);
    report.packageBaseline = before;
    if (!process.argv.includes('--reuse-build')) await command(process.execPath, ['node_modules/electron-builder/cli.js', '--win', 'nsis', '--x64', '--config.electronDist=' + path.join(root, '.electron-dist')], 'package');
    const unpacked = path.join(root, 'release/win-unpacked'), archive = path.join(unpacked, 'resources/app.asar');
    const sourceFiles = directory => fs.readdirSync(directory, {withFileTypes:true}).flatMap(item => item.isDirectory()
      ? sourceFiles(path.join(directory, item.name)) : [path.join(directory, item.name)]);
    for (const file of sourceFiles(path.join(root, 'src'))) {
      const name = path.relative(root, file);
      assert.ok(asar.extractFile(archive, name).equals(fs.readFileSync(file)), `${name} must be the final source`);
    }
    const list = asar.listPackage(archive); assert.ok(!list.some(f => /\.d\.ts$|\.map$/.test(f))); assert.ok(list.some(f => f.includes('LICENSE')));
    const total = directory => fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, item) => sum + (item.isDirectory() ? total(path.join(directory, item.name)) : fs.statSync(path.join(directory, item.name)).size), 0);
    const after = { archiveBytes: fs.statSync(archive).size, unpackedBytes: total(unpacked), installerBytes: fs.statSync(path.join(root, 'release/MedoMusic-Setup-1.6.4-x64.exe')).size };
    if (before) assert.ok(after.archiveBytes < before.archiveBytes);
    const packed = await launch(path.join(unpacked, 'resources/app.asar'), 'packaged'); await seed(packed); await play(packed); await close(packed);
    const copy = path.join(runDirectory, 'compression-copy'); fs.cpSync(unpacked, copy, { recursive: true });
    const compact = new TextDecoder('gb18030').decode(execFileSync('compact.exe', ['/C', '/EXE:XPRESS8K', `/S:${copy}`, '/Q'], { windowsHide: true, maxBuffer: 1024 * 1024 }));
    fs.writeFileSync(path.join(artifacts, 'compression.txt'), compact);
    const bytes = compact.split(/\r?\n/).map(line => line.match(/\d[\d,]*/g))
      .find(numbers => numbers?.length === 2 && Number(numbers[0].replaceAll(',', '')) === after.unpackedBytes);
    assert.ok(bytes, 'Compression output must report the known logical file total and stored bytes');
    const plainCopy = path.join(runDirectory, 'uncompressed-copy'); fs.cpSync(unpacked, plainCopy, { recursive: true });
    const startup = { uncompressedMs: [], compressedMs: [], windowsFileCacheCleared: false };
    for (const [name, directory, key] of [['plain', plainCopy, 'uncompressedMs'], ['compressed', copy, 'compressedMs']]) {
      const resources = path.join(directory, 'resources'), original = path.join(resources, 'performance-source.asar');
      fs.copyFileSync(path.join(resources, 'app.asar'), original);
      fs.symlinkSync(path.join(resources, 'app.asar.unpacked'), path.join(resources, 'performance-source.asar.unpacked'), 'junction');
      for (let i = 0; i < 2; i++) {
        const probe = await launch(original, `${name}-${i}`, undefined, path.join(directory, 'MedoMusic.exe'));
        startup[key].push(probe.startupMs); await seed(probe); await play(probe); await close(probe);
      }
    }
    // Compression remains a measured candidate, not an installer side effect.
    return { before, after, compression: { algorithm: 'XPRESS8K', directory: copy,
      logicalBytes: Number(bytes[0].replaceAll(',', '')), storedBytes: Number(bytes[1].replaceAll(',', '')),
      startup, adopted: false, reason: 'These startup probes retain the Windows file cache; they do not establish cold-disk or upgrade behavior, so compression is not added to the installer.' } };
  }]
];

(async () => {
  assert.equal(scenarios.length, 10);
  try {
    for (const [index, [name, run]] of scenarios.entries()) {
      const id = index + 1; if (selected && selected !== id) continue;
      console.log(`START ${id}/10 ${name}`); const start = performance.now(); let result;
      try { result = { id, name, pass: true, evidence: await run() }; }
      catch (error) { result = { id, name, pass: false, error: error.stack }; }
      result.seconds = (performance.now() - start) / 1000;
      report.scenarios = report.scenarios.filter(r => r.id !== id).concat(result).sort((a, b) => a.id - b.id);
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); console.log(`${result.pass ? 'PASS' : 'FAIL'} ${id}/10 ${result.pass ? '' : result.error}`);
    }
  } finally {
    for (const app of applications) await app.close().catch(() => {});
    if (!report.scenarios.some(r => !r.pass)) {
      const target = path.resolve(runDirectory);
      assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
      assert.ok(path.basename(target).startsWith('medo-performance-acceptance-'));
      fs.rmSync(target, {recursive:true,force:true,maxRetries:3,retryDelay:100});
    }
  }
  console.log(JSON.stringify({ total: report.total, completed: report.scenarios.length, passed: report.scenarios.filter(r => r.pass).length, reportFile }));
  if (report.scenarios.some(r => !r.pass)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
