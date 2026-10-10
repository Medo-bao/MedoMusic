const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-background-material-'));
const settingsFile = path.join(profile, 'background-image.json');
const destination = path.join(__dirname, 'artifacts', 'background-material');
fs.mkdirSync(destination, { recursive: true });
// Start with the actual default skin, without an image or saved adjustments.
const evidence = { profile, errors: [], themes: {} };
let app, page;

async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: process.env.MEDO_TEST_EXECUTABLE || path.join(root, '.electron-dist', 'electron.exe'),
    args: [...(process.env.MEDO_TEST_EXECUTABLE ? [] : [root]), `--user-data-dir=${profile}`], env, cwd: root
  });
  page = await app.firstWindow();
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.waitForFunction(() => typeof glassBackground === 'object');
  await page.evaluate(() => glassBackground.ready);
  await page.waitForFunction(() => localStorage.getItem('medo.initialScanComplete') === 'true');
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), '1.6.2');
  if (!await page.locator('#settings-panel').isVisible()) await page.locator('#settings-button').click();
}

async function settingsGroups() {
  const groups = await page.locator('#settings-panel > .settings-group h2').allTextContents();
  assert.deepEqual(groups, ['音乐库', '声音', '外观', '歌词', '桌面歌词', '全局快捷键', '窗口与托盘', '更新与关于']);
  const expected = {
    '[data-display-value="compact"]': '音乐库', '#sound-quick-enabled': '声音',
    '#background-transparency': '外观', '[data-background-material-value="transparent"]': '外观',
    '[data-word-lyrics-value="on"]': '歌词', '[data-translation-value="on"]': '歌词', '#inactive-lyric-color': '歌词',
    '#desktop-lyric-size': '桌面歌词', '#reset-desktop-lyric-position': '桌面歌词',
    '.global-play-shortcut-options': '全局快捷键', '#tray-setting': '窗口与托盘', '#auto-check-updates': '更新与关于'
  };
  for (const [selector, group] of Object.entries(expected)) {
    assert.equal(await page.locator(selector).evaluate(node => node.closest('.settings-group').querySelector('h2').textContent), group);
  }
  await page.locator('#open-sound-settings').click();
  await page.waitForFunction(() => document.querySelector('#sound-dialog').open);
  await page.locator('#close-sound-settings').click();
  const displayMode = await page.locator('[data-display-value][aria-checked="true"]').getAttribute('data-display-value');
  await page.locator('[data-display-value="compact"]').click();
  assert.equal(await page.locator('[data-display-value="compact"]').getAttribute('aria-checked'), 'true');
  await page.locator(`[data-display-value="${displayMode}"]`).click();
  const translation = await page.locator('[data-translation-value][aria-checked="true"]').getAttribute('data-translation-value');
  const opposite = translation === 'on' ? 'off' : 'on';
  await page.locator(`[data-translation-value="${opposite}"]`).click();
  assert.equal(await page.locator(`[data-translation-value="${opposite}"]`).getAttribute('aria-checked'), 'true');
  await page.locator(`[data-translation-value="${translation}"]`).click();
  const update = page.locator('#auto-check-updates');
  const autoChecked = await update.isChecked();
  await update.setChecked(!autoChecked);
  assert.equal(await page.evaluate(() => autoCheckUpdates), !autoChecked);
  await update.setChecked(autoChecked);
  evidence.settingsGroups = { groups, memberships: expected, relocatedControlsWork: true };
}

async function compactLibrary() {
  const files = [];
  const data = Buffer.alloc(44100 * 2 * 12);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(data.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(44100, 24); header.writeUInt32LE(88200, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  for (let index = 0; index < 5; index++) {
    const file = path.join(profile, `compact-${index}.wav`);
    fs.writeFileSync(file, Buffer.concat([header, data])); files.push(file);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 880));
  const expected = await page.evaluate(async files => {
    const incoming = await window.medo.getExternalTracks(files);
    const metadata = [
      ['城市微光', '晨星', '夜航', 'MP3'], ['海面回声', '晨星', '潮汐', 'FLAC'],
      ['夜行列车', '远山', '夜航', 'MP3'], ['城市微光', '晨星', '夜航', 'FLAC'], ['未命名演示', '', '', 'MP3']
    ];
    const canvas = Object.assign(document.createElement('canvas'), { width: 100, height: 100 });
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 100, 100);
    gradient.addColorStop(0, '#296bc1'); gradient.addColorStop(1, '#9154b3'); context.fillStyle = gradient; context.fillRect(0, 0, 100, 100);
    tracks = incoming.map((track, index) => ({ ...track, title: metadata[index][0], artist: metadata[index][1], album: metadata[index][2], format: metadata[index][3],
      cover: canvas.toDataURL(), metadataLoaded: true, userEditedMetadata: true, createdAt: index + 1, duration: 12 }));
    musicFolders = []; playlists = []; recent = []; favorites = new Set(); selectedTrackIds.clear(); multiSelectionMode = false;
    currentIndex = -1; currentPlaylist = null; currentCollection = null; currentSort = 'songs'; librarySort = 'added'; query = '';
    wordLyricsEnabled = false; lyricTranslationEnabled = false;
    for (const track of tracks) lyricsCache.set(track.id, { synced: true, lines: [{ start: 0, text: '紧凑列表播放验证' }] });
    persist();
    return tracks.map(track => [track.id, track.title, track.artist || '未知艺术家', track.album || '未知专辑']);
  }, files);
  evidence.compactLibrary = { fixtureSongs: expected.length, modes: {} };
  for (const [theme, mode, background] of [['light', 'compact', 'frosted'], ['dark', 'compact', 'transparent'], ['light', 'thumbnail', 'transparent']]) {
    await page.evaluate(theme => applyTheme(theme), theme);
    await page.locator(`[data-display-value="${mode}"]`).click();
    const before = await page.locator('[data-display-value][aria-checked="true"]').getAttribute('data-display-value');
    await material(background);
    assert.equal(await page.locator('[data-display-value][aria-checked="true"]').getAttribute('data-display-value'), before, 'Material choice must preserve display mode');
    await page.locator(`[data-display-value="${mode}"]`).click();
    assert.equal(await page.locator('[data-background-material-value][aria-checked="true"]').getAttribute('data-background-material-value'), background, 'Display mode must preserve material state');
    await page.locator('.nav-item[data-view="library"]').click();
    await page.locator('.pivot[data-sort="songs"]').click();
    const songs = await page.locator('.track-row').evaluateAll(rows => rows.map(row => [row.dataset.trackId, row.querySelector('.track-title').textContent,
      row.querySelector('.row-artist').textContent, row.querySelector('.row-album-name').textContent]));
    assert.deepEqual(songs, [...expected].reverse(), 'Song, artist and album metadata use separate fields');
    assert.equal(await page.locator('#compact-track-heading').isVisible(), mode === 'compact');
    if (mode === 'compact') {
      assert.deepEqual(await page.locator('.row-number').allTextContents(), ['1', '2', '3', '4', '5']);
      assert.equal(await page.locator('.track-row').first().evaluate(row => row.getBoundingClientRect().height), 48);
      await page.locator('.track-row').first().locator('.row-leading').click();
      assert.equal(await page.locator('.track-row.selected').count(), 1);
      await page.locator('#cancel-selection').click();
    }
    await page.screenshot({ path: path.join(destination, `library-${theme}-${mode}-songs.png`) });
    await page.locator('.pivot[data-sort="artists"]').click();
    const artists = await page.locator('.collection-card strong').allTextContents();
    assert.deepEqual(artists, ['未知艺术家', '晨星', '远山']);
    if (mode === 'compact') assert.deepEqual(await page.locator('.collection-count').allTextContents(), ['1 首歌曲', '3 首歌曲', '1 首歌曲']);
    await page.screenshot({ path: path.join(destination, `library-${theme}-${mode}-artists.png`) });
    await page.locator('.collection-card').filter({ has: page.locator('strong', { hasText: '晨星' }) }).click();
    assert.equal(await page.locator('.track-row').count(), 3, 'Artist rows open their songs');
    await page.locator('#collection-back').click();
    await page.locator('.pivot[data-sort="albums"]').click();
    assert.deepEqual(await page.locator('.collection-card strong').allTextContents(), ['未知专辑', '夜航', '夜航', '潮汐']);
    const album = page.locator('.collection-card').filter({ has: page.locator('small', { hasText: 'MP3' }) });
    await page.screenshot({ path: path.join(destination, `library-${theme}-${mode}-albums.png`) });
    await album.click();
    assert.equal(await page.locator('.track-row').count(), 2, 'Album format groups retain separate song sets');
    assert.deepEqual(await page.locator('.row-album-name').allTextContents(), ['夜航', '夜航']);
    await page.locator('#collection-back').click();
    await page.locator('#search-input').fill('海面');
    await page.waitForFunction(() => document.querySelectorAll('.collection-card').length === 1);
    assert.deepEqual(await page.locator('.collection-card strong').allTextContents(), ['潮汐']);
    await page.locator('#search-input').fill('');
    await page.waitForFunction(() => document.querySelectorAll('.collection-card').length === 4);
    const layout = await page.locator('.collection-card').first().evaluate(card => ({ height: card.getBoundingClientRect().height,
      listClass: card.parentElement.className, fits: card.scrollWidth <= card.clientWidth }));
    assert.ok(layout.fits, 'Collection text stays within its row');
    assert.match(layout.listClass, mode === 'compact' ? /collection-list/ : /collection-grid/);
    evidence.compactLibrary.modes[`${theme}-${mode}`] = { songs: songs.length, artists: artists.length, albums: 4, background, layout };
    await page.locator('#settings-button').click();
  }
  await page.locator('[data-display-value="compact"]').click();
  await page.locator('.nav-item[data-view="library"]').click();
  await page.locator('.pivot[data-sort="songs"]').click();
  await page.locator('.track-row').first().locator('.track-title').dblclick();
  await page.waitForFunction(() => !audio.paused && audio.currentTime > .2);
  await page.locator('#play-button').click();
  await page.waitForFunction(() => audio.paused);
  await page.locator('#settings-button').click();
  await app.close(); app = null;
  await launch();
  assert.equal(await page.locator('[data-display-value="compact"]').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('[data-background-material-value="transparent"]').getAttribute('aria-checked'), 'true');
  await page.locator('.nav-item[data-view="library"]').click();
  await page.locator('.pivot[data-sort="albums"]').click();
  assert.equal(await page.locator('.collection-list > .collection-card').count(), 4, 'Compact grouping survives restart');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.screenshot({ path: path.join(destination, 'library-compact-albums-960.png') });
  await page.locator('.pivot[data-sort="songs"]').click();
  assert.equal(await page.locator('#compact-track-heading .heading-album').isVisible(), false);
  assert.ok(await page.locator('.track-row').first().evaluate(row => row.scrollWidth <= row.clientWidth), 'Compact songs fit the minimum window');
  await page.screenshot({ path: path.join(destination, 'library-compact-songs-960.png') });
  await page.locator('#settings-button').click();
  evidence.compactLibrary.selectionPlaybackSearchAndRestart = true;
}

async function opacity(value) {
  const transparency = 100 - value;
  const input = page.locator('#background-transparency');
  await input.focus();
  await input.press('Home');
  for (let i = 0; i < transparency; i++) await input.press('ArrowRight');
  await page.waitForFunction(async value => (await window.medo.getBackgroundImageSettings()).opacity === value, value);
  assert.equal(await input.inputValue(), String(transparency));
  assert.equal(await input.getAttribute('aria-valuetext'), `${transparency}%`);
  assert.equal(await page.locator('#background-transparency-value').textContent(), `${transparency}%`);
}

async function material(mode) {
  const button = page.locator(`[data-background-material-value="${mode}"]`);
  await button.click();
  await page.waitForFunction(async mode => (await window.medo.getBackgroundImageSettings()).material === mode, mode);
  await page.waitForFunction(mode => mode === 'transparent'
    ? document.documentElement.dataset.windowMaterial === 'transparent'
    : ['blur', 'acrylic'].includes(document.documentElement.dataset.windowMaterial), mode);
  assert.equal(await button.getAttribute('aria-checked'), 'true');
}

async function desktop() {
  await app.evaluate(async ({ BrowserWindow, screen }) => {
    const main = BrowserWindow.getAllWindows()[0];
    const area = screen.getPrimaryDisplay().workArea;
    main.setBounds({ x: area.x + 40, y: area.y + 40, width: 1080, height: 720 });
    const behind = new BrowserWindow({ ...main.getBounds(), frame: false, show: false });
    await behind.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:repeating-linear-gradient(90deg,#000 0 8px,#fff 8px 16px)">'));
    behind.setAlwaysOnTop(true, 'screen-saver'); behind.showInactive();
    main.setAlwaysOnTop(true, 'screen-saver'); main.show(); main.focus(); main.moveTop();
    global.backgroundMaterialTest = { main, behind };
  });
}

async function capture(name) {
  await page.locator('.background-material-setting').scrollIntoViewIfNeeded();
  await app.evaluate(() => {
    global.backgroundMaterialTest.behind.showInactive();
    global.backgroundMaterialTest.main.moveTop();
  });
  await page.waitForTimeout(350);
  const content = await page.locator('.background-material-setting').evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return { x: bounds.left + 8, y: bounds.top + 9 };
  });
  const result = await app.evaluate(async ({ desktopCapturer, screen }, content) => {
    const bounds = global.backgroundMaterialTest.main.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const scale = display.scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } });
    const screenImage = sources.find(source => source.display_id === String(display.id)).thumbnail;
    const image = screenImage.crop({ x: Math.round((bounds.x - display.bounds.x) * scale), y: Math.round((bounds.y - display.bounds.y) * scale), width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) });
    const bitmap = image.crop({ x: Math.round(430 * scale), y: Math.round(12 * scale), width: Math.round(120 * scale), height: 1 }).toBitmap();
    const green = Array.from({ length: bitmap.length / 4 }, (_, index) => bitmap[index * 4 + 1]);
    const contentBitmap = image.crop({ x: Math.round(content.x * scale), y: Math.round(content.y * scale), width: Math.round(120 * scale), height: 1 }).toBitmap();
    const contentGreen = Array.from({ length: contentBitmap.length / 4 }, (_, index) => contentBitmap[index * 4 + 1]);
    return { png: image.toPNG().toString('base64'), contrast: Math.max(...green) - Math.min(...green), contentContrast: Math.max(...contentGreen) - Math.min(...contentGreen) };
  }, content);
  fs.writeFileSync(path.join(destination, `${name}.png`), Buffer.from(result.png, 'base64'));
  return { contrast: result.contrast, contentContrast: result.contentContrast };
}

async function run() {
  try {
    await launch();
    assert.equal(await page.locator('#background-transparency').inputValue(), '10');
    assert.equal(await page.locator('#background-image-clarity').inputValue(), '30');
    assert.equal(await page.locator('#background-image-blur').inputValue(), '50');
    evidence.defaults = await page.evaluate(() => window.medo.getBackgroundImageSettings());
    assert.equal(await page.locator('#background-transparency-value').textContent(), '10%');
    assert.equal(await page.locator('#background-image-clarity-value').textContent(), '30%');
    assert.equal(await page.locator('#background-image-blur-value').textContent(), '50%');
    assert.equal(await page.locator('[data-background-material-value="frosted"]').getAttribute('aria-checked'), 'true');
    await settingsGroups();
    // Keep native-material comparisons at a fixed reference opacity.
    await opacity(60);
    await compactLibrary();
    await desktop();
    for (const theme of ['dark', 'light', 'system']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await material('frosted');
      const frosted = await capture(`${theme}-frosted`);
      await material('transparent');
      const transparent = await capture(`${theme}-transparent`);
      assert.ok(transparent.contrast > 60 && transparent.contrast > frosted.contrast * 2,
        `Transparent glass retains real desktop detail: ${theme}; frosted=${frosted.contrast}, transparent=${transparent.contrast}`);
      assert.ok(transparent.contentContrast > 30 && transparent.contentContrast > frosted.contentContrast * 2,
        `Default skin content remains transparent: ${theme}; frosted=${frosted.contentContrast}, transparent=${transparent.contentContrast}`);
      evidence.themes[theme] = { frosted, transparent };
    }
    await page.evaluate(() => applyTheme('light'));
    await app.close(); app = null;
    await launch(); await desktop();
    await page.locator('.background-material-setting').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.windowMaterial), 'transparent');
    const restartedDefault = await capture('default-restarted');
    assert.ok(restartedDefault.contrast > 60 && restartedDefault.contentContrast > 30, 'Default skin keeps transparent glass after restart');
    evidence.defaultRestart = restartedDefault;
    const bounds = await app.evaluate(() => global.backgroundMaterialTest.main.getBounds());
    await app.evaluate((_electronApi, bounds) => global.backgroundMaterialTest.main.setBounds({ ...bounds, width: bounds.width + 60, height: bounds.height + 30 }), bounds);
    await page.waitForTimeout(200);
    const resized = await app.evaluate(({ screen }) => ({
      bounds: global.backgroundMaterialTest.main.getBounds(),
      minimum: global.backgroundMaterialTest.main.getMinimumSize(),
      resizable: global.backgroundMaterialTest.main.isResizable(),
      workArea: screen.getDisplayMatching(global.backgroundMaterialTest.main.getBounds()).workArea
    }));
    assert.equal(resized.bounds.width, bounds.width + 60, `Clear window accepts native bounds: ${JSON.stringify({ previous: bounds, resized })}`);
    await app.evaluate((_electronApi, bounds) => global.backgroundMaterialTest.main.setBounds(bounds), bounds);
    await app.evaluate(() => global.backgroundMaterialTest.main.maximize());
    await page.waitForFunction(() => document.querySelector('#window-maximize').classList.contains('is-maximized'));
    await app.evaluate(() => global.backgroundMaterialTest.main.unmaximize());
    await page.waitForFunction(() => !document.querySelector('#window-maximize').classList.contains('is-maximized'));
    await app.evaluate(() => global.backgroundMaterialTest.main.minimize());
    await page.waitForFunction(() => document.body.classList.contains('background-mode'));
    await app.evaluate(() => { global.backgroundMaterialTest.main.restore(); global.backgroundMaterialTest.main.show(); global.backgroundMaterialTest.main.focus(); });
    await page.waitForFunction(() => !document.body.classList.contains('background-mode'));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.windowMaterial), 'transparent');
    const restored = await capture('default-restored');
    assert.ok(restored.contrast > 60 && restored.contentContrast > 30, 'Restoring the window retains actual client transparency');
    evidence.transparentWindowResizeAndRestore = true;
    await app.evaluate(({ nativeTheme }) => {
      Object.defineProperty(nativeTheme, 'shouldUseHighContrastColors', { configurable: true, get: () => true });
      nativeTheme.emit('updated');
    });
    await page.waitForFunction(() => document.documentElement.dataset.windowMaterial === 'none');
    await app.evaluate(({ nativeTheme }) => { delete nativeTheme.shouldUseHighContrastColors; nativeTheme.emit('updated'); });
    await page.waitForFunction(() => document.documentElement.dataset.windowMaterial === 'transparent');
    evidence.nativeHighContrastFallback = true;
    await opacity(100);
    assert.equal(await page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--background-coverage'))), 1);
    const opaque = await capture('opaque');
    await opacity(0);
    assert.equal(await page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--background-coverage'))), 0);
    const clear = await capture('fully-transparent');
    assert.ok(opaque.contrast < 10 && clear.contrast > evidence.themes.light.transparent.contrast * 1.5,
      `Background opacity covers both endpoints: opaque=${opaque.contrast}, clear=${clear.contrast}`);
    const foreground = await page.evaluate(() => ['body', '.player', '#play-button'].map(selector => getComputedStyle(document.querySelector(selector)).opacity));
    assert.deepEqual(foreground, ['1', '1', '1']);
    assert.equal(await app.evaluate(() => global.backgroundMaterialTest.main.getOpacity()), 1);
    evidence.endpoints = { opaque, clear, foreground, nativeWindowOpacity: 1 };
    const fixture = path.join(profile, 'opacity-image.png');
    const png = await page.evaluate(() => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
      const context = canvas.getContext('2d'); context.fillStyle = '#e86435'; context.fillRect(0, 0, 640, 360);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(fixture, Buffer.from(png, 'base64'));
    await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
    await page.locator('#choose-background-image').click();
    await page.waitForFunction(() => !document.querySelector('#choose-background-image').disabled);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.glassBackground), 'image');
    const imageClear = await capture('image-zero-opacity');
    assert.ok(Math.abs(imageClear.contrast - clear.contrast) <= 2, 'Zero background opacity also reveals the desktop through a custom image');
    await opacity(100);
    const imageOpaque = await capture('image-full-opacity');
    assert.ok(imageOpaque.contrast < 10, 'Full background opacity hides desktop detail under a custom image');
    evidence.imageEndpoints = { imageClear, imageOpaque };
    await opacity(27);
    await app.close(); app = null;
    await launch();
    assert.equal(await page.locator('#background-transparency').inputValue(), '73');
    assert.equal(await page.locator('[data-background-material-value="transparent"]').getAttribute('aria-checked'), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.windowMaterial), 'transparent');
    evidence.restarted = await page.evaluate(() => window.medo.getBackgroundImageSettings());
    assert.equal(evidence.restarted.clarity, 30); assert.equal(evidence.restarted.blur, 7.5);
    assert.equal(evidence.restarted.opacity, 27);
    assert.equal(evidence.restarted.name, 'opacity-image.png');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.glassBackground), 'image');
    await page.locator('#reset-background-image').click();
    await page.waitForFunction(() => document.querySelector('#background-transparency').value === '10');
    await page.waitForFunction(() => ['blur', 'acrylic'].includes(document.documentElement.dataset.windowMaterial));
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile)), { image: null, name: '', clarity: 30, blur: 7.5, opacity: 90, material: 'frosted' });
    evidence.reset = true;
    assert.deepEqual(evidence.errors, []);
    fs.writeFileSync(path.join(destination, process.env.MEDO_TEST_EXECUTABLE ? 'packaged-checks.json' : 'development-checks.json'), JSON.stringify(evidence, null, 2));
    console.log('Compact library, defaults and material passed: distinct song/artist/album views, format grouping, selection/playback/search/restart/minimum window, independent material controls, 10% transparency / 30% clarity / 50% blur / frosted defaults, default skin transparency, opacity endpoints and reset');
  } finally { await app?.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
