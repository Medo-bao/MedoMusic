const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const asar = require('@electron/asar');

async function run() {
  const root = path.resolve(__dirname, '..');
  const unpacked = path.join(root, process.env.MEDO_TEST_OUTPUT || 'release', 'win-unpacked');
  const bundle = path.join(unpacked, 'resources', 'app.asar');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  assert.equal(JSON.parse(asar.extractFile(bundle, 'package.json')).version, version);
  const packagedFiles = {};
  for (const file of ['src/glass-menus.js', 'src/appearance.js', 'src/appearance.css', 'src/styles.css', 'src/renderer.js', 'src/index.html', 'src/main.js', 'src/preload.js', 'src/window-material.js']) {
    const shipped = asar.extractFile(bundle, file);
    assert.ok(shipped.equals(fs.readFileSync(path.join(root, file))), `${file} differs in package`);
    packagedFiles[file] = crypto.createHash('sha256').update(shipped).digest('hex');
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-appearance-runtime-'));
  const song = path.join(profile, 'Appearance playback.wav');
  const sampleRate = 44100;
  const data = Buffer.alloc(sampleRate * 2 * 12);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(data.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(song, Buffer.concat([header, data]));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(unpacked, 'MedoMusic.exe'), args: [`--user-data-dir=${profile}`], env, timeout: 30000 });
  try {
    const info = await app.evaluate(({ app }) => ({ version: app.getVersion(), userData: app.getPath('userData') }));
    assert.equal(info.version, version);
    assert.equal(path.resolve(info.userData).toLowerCase(), path.resolve(profile).toLowerCase(), 'Test profile must be isolated');
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof coverAtmosphere === 'object');
    await page.evaluate(async song => {
      localStorage.setItem('medo.initialScanComplete', 'true');
      musicFolders = []; tracks = []; playlists = []; currentIndex = -1;
      wordLyricsEnabled = false; lyricTranslationEnabled = false;
      const incoming = await window.medo.getExternalTracks([song]);
      if (!incoming.length) throw new Error('Packaged import failed');
      const track = incoming[0];
      track.title = '外观迭代 · 播放验证'; track.artist = 'MedoMusic'; track.album = '独立测试配置';
      track.metadataLoaded = true; track.duration = 12;
      const c = Object.assign(document.createElement('canvas'), {width: 300, height: 300});
      const ctx = c.getContext('2d'); const gradient = ctx.createLinearGradient(0,0,300,300);
      gradient.addColorStop(0, '#2b7690'); gradient.addColorStop(1, '#ce987b');
      ctx.fillStyle = gradient; ctx.fillRect(0,0,300,300); ctx.fillStyle = '#ffffffcc';
      ctx.beginPath(); ctx.arc(200,100,40,0,Math.PI*2); ctx.fill(); track.cover = c.toDataURL();
      lyricsCache.set(track.id, { synced: true, lines: [{start:0,text:'从真实文件开始播放'}, {start:3,text:'让旋律与光影一起流动'}, {start:8,text:'保持清晰，也保持轻盈'}] });
      mergeTracks([track]); currentView = 'library'; currentPlaylist = null; currentCollection = null; render();
      applyTheme('dark'); await playTrack(0); openPlaybackDetail();
    }, song);
    await page.waitForFunction(() => !audio.paused && audio.currentTime > .25);
    await page.waitForTimeout(700);
    const playing = await page.evaluate(() => ({ time: audio.currentTime, source: audio.currentSrc, playing: document.body.classList.contains('is-playing'), glow: getComputedStyle(document.querySelector('.detail-glow')).animationPlayState }));
    assert.equal(playing.playing, true); assert.equal(playing.glow, 'running');
    const destination = path.join(__dirname, 'artifacts', 'appearance');
    await page.screenshot({path:path.join(destination,'packaged-dark.png')});
    await page.locator('#play-button').click();
    await page.waitForFunction(() => audio.paused);
    assert.equal(await page.locator('.detail-glow').first().evaluate(el=>getComputedStyle(el).animationPlayState), 'paused');
    await page.evaluate(() => applyTheme('light')); await page.waitForTimeout(550);
    await page.screenshot({path:path.join(destination,'packaged-light.png')});
    await page.locator('#play-button').click();
    await page.waitForFunction(() => !audio.paused);
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(win=>!win.isDestroyed() && win.getTitle().includes('Medo')).minimize());
    await page.waitForFunction(() => document.body.classList.contains('background-mode'));
    assert.equal(await page.locator('.detail-glow').first().evaluate(el=>getComputedStyle(el).animationPlayState), 'paused');
    const minimizedPlaying = await page.evaluate(() => !audio.paused);
    assert.equal(minimizedPlaying, true, 'Minimizing must keep audio playing');
    await app.evaluate(({BrowserWindow}) => { const win=BrowserWindow.getAllWindows()[0];win.restore();win.show(); });
    await page.waitForFunction(() => !document.body.classList.contains('background-mode'));
    await page.evaluate(() => audio.pause());
    assert.deepEqual(errors, []);
    const evidence = { version, profile, packagedFiles, playing, minimizedPlaying, errors };
    fs.writeFileSync(path.join(destination,'packaged-checks.json'),JSON.stringify(evidence,null,2));
    console.log(`Packaged app passed: ${version}; exact source resources, real WAV playback, pause/resume, dark/light and minimized audio with paused atmosphere`);
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
