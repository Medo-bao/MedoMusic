const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

async function dragNative(start, end) {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const point = koffi.struct({ x: 'long', y: 'long' });
  const getCursor = user32.func('__stdcall', 'GetCursorPos', 'int', [koffi.out(koffi.pointer(point))]);
  const setCursor = user32.func('int __stdcall SetCursorPos(int x, int y)');
  const mouse = user32.func('void __stdcall mouse_event(uint32_t flags, uint32_t x, uint32_t y, uint32_t data, uintptr_t extra)');
  const setDpi = user32.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t context)');
  const context = setDpi(-4);
  const previous = {}; getCursor(previous);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let pointerMoved = false;
  try {
    if (!setCursor(Math.round(start.x), Math.round(start.y))) return { skipped: 'Host blocks SetCursorPos; physical drag is unverified' };
    pointerMoved = true;
    mouse(2, 0, 0, 0, 0); await wait(80);
    for (let step = 1; step <= 5; step++) {
      setCursor(Math.round(start.x + (end.x - start.x) * step / 5), Math.round(start.y + (end.y - start.y) * step / 5));
      await wait(60);
    }
    return { performed: true };
  } finally {
    if (pointerMoved) { mouse(4, 0, 0, 0, 0); await wait(200); setCursor(previous.x, previous.y); }
    setDpi(context);
  }
}

async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-desktop-glass-'));
  const destination = path.join(__dirname, 'artifacts', 'appearance');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: process.env.MEDO_TEST_EXECUTABLE || path.resolve(__dirname, '../release/win-unpacked/MedoMusic.exe'),
    args: [`--user-data-dir=${profile}`], env
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => ['blur', 'acrylic'].includes(document.documentElement.dataset.windowMaterial));
    await page.waitForFunction(() => localStorage.getItem('medo.initialScanComplete') === 'true');
    const setup = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const main = BrowserWindow.getAllWindows()[0];
      const area = screen.getPrimaryDisplay().workArea;
      main.setBounds({ x: area.x + 50, y: area.y + 50, width: 1080, height: 720 });
      const behind = new BrowserWindow({ ...main.getBounds(), frame: false, show: false, backgroundColor: '#dd7755' });
      const tiles = Array.from({length: 40}, (_, i) => `<div style="width:64px;height:60px;background:${i % 2 ? '#f5eee1' : '#223451'};border-radius:8px;box-shadow:0 8px 0 #10182055;color:${i % 2 ? '#26334b' : '#ffffff'};font:16px sans-serif;text-align:center;line-height:60px">${i + 1}</div>`).join('');
      await behind.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;height:100vh;background:linear-gradient(115deg,#dd7755 15%,#d6ba81 40%,#3a8199 65%,#334372);display:grid;grid-template-columns:repeat(8,1fr);align-items:center;justify-items:center">${tiles}</body>`));
      behind.setAlwaysOnTop(true, 'screen-saver'); behind.show();
      main.setAlwaysOnTop(true, 'screen-saver'); main.show(); main.focus(); main.moveTop();
      global.glassTest = { main, behind };
      return { handle: String(main.getNativeWindowHandle().readBigUInt64LE()), material: main.desktopMaterial.get(), bounds: main.getBounds(), scale: screen.getPrimaryDisplay().scaleFactor, behindStyle: await behind.webContents.executeJavaScript('getComputedStyle(document.body).background') };
    });
    console.log('Setup', setup);
    await page.evaluate(async song => {
      localStorage.setItem('medo.initialScanComplete', 'true'); musicFolders = []; playlists = []; favorites = new Set();
      const metadata = song ? await window.medo.readMetadata(song) : {};
      tracks = Array.from({ length: 6 }, (_, index) => ({ ...metadata, id: `glass-${index}`, metadataLoaded: true,
        title: ['孤独娱乐', '愿与愁', '裂缝中的阳光', '不死之身', '那些你很冒险的梦', '修炼爱情'][index],
        artist: '林俊杰', album: '玻璃材质测试列表', duration: 239 }));
      playlists = [{name: '夜间聆听', trackIds: tracks.map(track => track.id)}, {name:'材质目标',trackIds:[]}];
      for (const track of tracks) lyricsCache.set(track.id, { networkOnly: true, synced: true, lines: [{start:0,text:'让音乐陪伴此刻'}, {start:8,text:'窗外的光慢慢经过'}, {start:16,text:'听见每一段旋律'}, {start:24,text:'把这一刻留在歌里'}] });
      currentIndex = 0; currentView = 'library'; currentPlaylist = null; currentCollection = null;
      playbackQueueIds = tracks.map(track => track.id); query = ''; render(); updateNowPlaying(tracks[0]);
    }, process.argv[2]);
    const capture = async (name, samplePoint = { x: 980, y: 585 }) => {
      await app.evaluate(() => {
        global.glassTest.behind.showInactive();
        global.glassTest.main.show(); global.glassTest.main.moveTop();
      });
      await page.waitForTimeout(300);
      const result = await app.evaluate(async ({ desktopCapturer, screen }, point) => {
        const display = screen.getDisplayMatching(global.glassTest.main.getBounds());
        const scale = display.scaleFactor;
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } });
        const source = sources.find(source => source.display_id === String(display.id));
        if (!source) throw new Error('Display capture missing');
        const rect = global.glassTest.main.getBounds();
        const image = source.thumbnail.crop({ x: Math.round((rect.x - display.bounds.x) * scale), y: Math.round((rect.y - display.bounds.y) * scale), width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) });
        const sample = image.crop({ x: Math.round(point.x * scale), y: Math.round(point.y * scale), width: 1, height: 1 }).toBitmap();
        return { png: image.toPNG().toString('base64'), sample: [...sample] };
      }, samplePoint);
      fs.writeFileSync(path.join(destination, `${name}.png`), Buffer.from(result.png, 'base64'));
      return result.sample;
    };
    const samples = {};
    const playerMaterials = {};
    const readPlayerMaterial = () => page.locator('.player').evaluate(el => {
      const style = getComputedStyle(el);
      return { color: style.backgroundColor, image: style.backgroundImage, blur: style.backdropFilter, border: style.borderTop, shadow: style.boxShadow };
    });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.waitForTimeout(1500);
      await capture('desktop-glass-warmup');
      await page.waitForTimeout(500);
      samples[theme] = await capture(`desktop-glass-${theme}`);
      await page.evaluate(() => { currentPlaylist = '夜间聆听'; render(); });
      await page.waitForTimeout(600); await capture(`desktop-playlist-${theme}`);
      await page.evaluate(() => { currentPlaylist = null; currentView = 'favorites'; favorites = new Set([tracks[0].id]); render(); });
      const insets = await page.locator('#track-list').evaluate(el => {
        const list = el.getBoundingClientRect(), row = el.querySelector('.track-row').getBoundingClientRect();
        return [row.top - list.top, list.bottom - row.bottom, row.left - list.left, list.right - row.right];
      });
      assert.deepEqual(insets, [0, 0, 0, 0]);
      await page.waitForTimeout(400); await capture(`desktop-single-song-${theme}`);
      await page.evaluate(() => { favorites.clear(); render(); });
      assert.equal(await page.locator('#track-list').evaluate(el => getComputedStyle(el).boxShadow), 'none');
      await page.waitForTimeout(400); await capture(`desktop-empty-playlist-${theme}`);
      await page.evaluate(() => { currentView = 'playlists'; render(); });
      assert.equal(await page.locator('#track-list').evaluate(el => getComputedStyle(el).boxShadow), 'none');
      await page.waitForTimeout(400); await capture(`desktop-playlist-overview-${theme}`);
      await page.evaluate(() => { currentView = 'library'; currentPlaylist = '夜间聆听'; render(); });
      playerMaterials[theme] = await readPlayerMaterial();
      await page.evaluate(() => { currentView = 'player'; render(); updateLyricsAtTime(); });
      await page.waitForTimeout(600);
      samples[`lyrics-${theme}`] = await capture(`desktop-lyrics-${theme}`, { x: 540, y: 80 });
      assert.deepEqual(await readPlayerMaterial(), playerMaterials[theme], `${theme} native player material must match on both pages`);
      assert.equal(playerMaterials[theme].blur, 'none', 'Native glass does not receive a second CSS blur');
      assert.equal(await page.locator('.window-titlebar').evaluate(el => getComputedStyle(el).borderBottomWidth), '0px');
      assert.equal(await page.locator('.sidebar').evaluate(el => getComputedStyle(el).visibility), 'hidden');
      await page.evaluate(() => { currentView = 'settings'; render(); });
      await page.waitForTimeout(600); await capture(`desktop-settings-${theme}`);
      await page.locator('#open-sound-settings').click();
      await page.waitForTimeout(400); await capture(`desktop-sound-${theme}`);
      await page.locator('#close-sound-settings').click();
      await page.evaluate(() => { currentView = 'library'; currentPlaylist = null; render(); });
      await page.waitForTimeout(600);
      await page.locator('.playlist-item[data-playlist-name="夜间聆听"]').click({button:'right'});
      await page.getByRole('menuitem',{name:'添加到',exact:true}).hover();
      assert.equal(await page.locator('.glass-menu').count(),2);
      await capture(`desktop-submenu-${theme}`);
      await page.getByRole('menuitem',{name:'材质目标',exact:true}).click();
      assert.equal(await page.evaluate(() => playlists[1].trackIds.length),6);
    }
    // Change only the separate native window behind MedoMusic. A DOM/page
    // screenshot cannot prove desktop transparency; capture the DWM composite.
    await app.evaluate(() => global.glassTest.behind.webContents.executeJavaScript("document.body.style.background = '#050505'; document.body.replaceChildren()"));
    await page.waitForTimeout(1500);
    await capture('desktop-glass-warmup');
    await page.waitForTimeout(500);
    samples.changed = await capture('desktop-glass-background-changed');
    assert.ok(samples.changed.slice(0, 3).some((value, i) => Math.abs(value - samples.dark[i]) > 8), `Desktop must show through: ${JSON.stringify(samples)}`);
    await page.evaluate(() => { currentView = 'player'; render(); });
    await page.waitForTimeout(800);
    await capture('desktop-glass-warmup');
    samples.lyricsChanged = await capture('desktop-lyrics-background-changed', { x: 540, y: 80 });
    assert.ok(samples.lyricsChanged.slice(0, 3).some((value, i) => Math.abs(value - samples['lyrics-dark'][i]) > 8), `Lyrics must also show the desktop: ${JSON.stringify(samples)}`);
    await page.evaluate(() => { currentView = 'library'; render(); });
    const start = { x: (setup.bounds.x + 400) * setup.scale, y: (setup.bounds.y + 18) * setup.scale };
    await app.evaluate(() => { global.glassTest.main.focus(); global.glassTest.main.moveTop(); });
    const nativeDrag = await dragNative(start, { x: start.x + 75, y: start.y + 45 });
    const moved = await app.evaluate(() => global.glassTest.main.getBounds());
    let nativeResize = { skipped: nativeDrag.skipped };
    if (nativeDrag.performed) {
      assert.ok(moved.x > setup.bounds.x + 20 && moved.y > setup.bounds.y + 10, 'Native titlebar dragging must move the window');
      const edge = { x: (moved.x + moved.width) * setup.scale - 2, y: (moved.y + 350) * setup.scale };
      nativeResize = await dragNative(edge, { x: edge.x + 75, y: edge.y });
      const resized = await app.evaluate(() => global.glassTest.main.getBounds());
      if (nativeResize.performed) assert.ok(resized.width > moved.width + 20, 'Native edge dragging must resize the window');
    }
    console.log('Physical input verification', { nativeDrag, nativeResize });
    await page.locator('.menu-button').click();
    await page.waitForTimeout(250);
    assert.ok(await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width < 74));
    await page.locator('.menu-button').click();
    await page.locator('#window-maximize').click();
    await page.waitForFunction(() => document.querySelector('#window-maximize').classList.contains('is-maximized'));
    assert.equal(await app.evaluate(() => global.glassTest.main.isMaximized()), true);
    await page.waitForTimeout(800);
    await page.locator('#window-maximize').click();
    await page.waitForFunction(() => !document.querySelector('#window-maximize').classList.contains('is-maximized'));
    assert.equal(await app.evaluate(() => global.glassTest.main.isMaximized()), false);
    await app.evaluate(() => global.glassTest.main.setSize(960, 640));
    await page.waitForTimeout(250);
    assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.locator('#window-minimize').click();
    await page.waitForFunction(() => document.body.classList.contains('background-mode'));
    await app.evaluate(() => { global.glassTest.main.restore(); global.glassTest.main.show(); });
    await page.waitForFunction(() => !document.body.classList.contains('background-mode'));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.windowMaterial), setup.material);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(18, 21, 28)');
    await cdp.detach();
    fs.writeFileSync(path.join(destination, 'desktop-glass-checks.json'), JSON.stringify({ ...setup, samples, playerMaterials, nativeDrag, nativeResize, lifecycle: 'maximize, restore, API minimum size, minimize, restore, reduced transparency passed' }, null, 2));
    console.log('Native desktop glass passed', { ...setup, samples });
  } finally {
    await app.evaluate(() => { global.glassTest?.behind.destroy(); });
    await app.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
