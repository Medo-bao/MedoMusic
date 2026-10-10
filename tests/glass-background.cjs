const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-background-'));
const destination = path.join(__dirname, 'artifacts', 'background');
fs.mkdirSync(destination, { recursive: true });
const settingsFile = path.join(profile, 'background-image.json');
const fixture = path.join(profile, '玻璃染色 图片.png');
const readSettings = () => JSON.parse(fs.readFileSync(settingsFile));
const material = () => {
  const style = getComputedStyle(document.querySelector('.player'));
  return { background: style.background, blur: style.backdropFilter, border: style.borderTop, shadow: style.boxShadow };
};
let app;
let page;
let pointerApi;
const evidence = { profile, errors: [] };

async function dragSlider(start, finish) {
  if (!pointerApi) {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const point = koffi.struct({ x: 'long', y: 'long' });
    pointerApi = {
      cursor: user32.func('__stdcall', 'GetCursorPos', 'int', [koffi.out(koffi.pointer(point))]),
      client: user32.func('__stdcall', 'ClientToScreen', 'int', ['uintptr_t', koffi.inout(koffi.pointer(point))]),
      move: user32.func('int __stdcall SetCursorPos(int x, int y)'),
      mouse: user32.func('void __stdcall mouse_event(uint32_t flags, uint32_t x, uint32_t y, uint32_t data, uintptr_t extra)'),
      dpi: user32.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t context)')
    };
  }
  const native = await app.evaluate(({ screen }) => {
    const main = global.backgroundTest.main;
    const handle = main.getNativeWindowHandle();
    return { handle: String(handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()), scale: screen.getDisplayMatching(main.getBounds()).scaleFactor };
  });
  const context = pointerApi.dpi(-4);
  const previous = {}; pointerApi.cursor(previous);
  const origin = { x: 0, y: 0 };
  let pressed = false;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    assert.equal(pointerApi.client(BigInt(native.handle), origin), 1);
    const position = point => ({ x: Math.round(origin.x + point.x * native.scale), y: Math.round(origin.y + point.y * native.scale) });
    const from = position(start), to = position(finish);
    assert.equal(pointerApi.move(from.x, from.y), 1, 'Native pointer reaches the slider');
    pointerApi.mouse(2, 0, 0, 0, 0); pressed = true;
    await wait(80);
    for (let step = 1; step <= 6; step++) {
      assert.equal(pointerApi.move(Math.round(from.x + (to.x - from.x) * step / 6), Math.round(from.y + (to.y - from.y) * step / 6)), 1);
      await wait(30);
    }
  } finally {
    if (pressed) { pointerApi.mouse(4, 0, 0, 0, 0); await wait(80); }
    pointerApi.move(previous.x, previous.y);
    pointerApi.dpi(context);
  }
}

async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.MEDO_TEST_EXECUTABLE || path.join(root, '.electron-dist', 'electron.exe');
  app = await _electron.launch({ executablePath, args: [...(process.env.MEDO_TEST_EXECUTABLE ? [] : [root]), `--user-data-dir=${profile}`], env, cwd: root });
  page = await app.firstWindow();
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.waitForFunction(() => typeof glassBackground === 'object');
  await page.evaluate(() => glassBackground.ready);
  await page.waitForFunction(() => localStorage.getItem('medo.initialScanComplete') === 'true');
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), '1.6.2');
  const paths = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), sessionData: app.getPath('sessionData') }));
  assert.equal(path.resolve(paths.userData).toLowerCase(), profile.toLowerCase());
  assert.equal(path.resolve(paths.sessionData).toLowerCase(), profile.toLowerCase());
}

async function select(file) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => file ? { canceled: false, filePaths: [file] } : { canceled: true, filePaths: [] };
  }, file);
  await page.locator('#choose-background-image').click();
  await page.waitForFunction(() => !document.querySelector('#choose-background-image').disabled);
}

async function range(id, value) {
  if (id.endsWith('blur')) value = Math.round(value / 15 * 100);
  await app.evaluate(() => { global.backgroundTest?.main.focus(); global.backgroundTest?.main.moveTop(); });
  await page.waitForFunction(() => document.hasFocus());
  const input = page.locator(id);
  await input.scrollIntoViewIfNeeded();
  await page.locator('#settings-panel').evaluate(panel => Promise.allSettled(panel.getAnimations().map(animation => animation.finished)));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await input.boundingBox();
  const maximum = Number(await input.getAttribute('max'));
  const current = Number(await input.inputValue());
  const start = box.x + 8 + (box.width - 16) * current / maximum;
  const finish = box.x + 8 + (box.width - 16) * value / maximum;
  await dragSlider({ x: start, y: box.y + box.height / 2 }, { x: finish, y: box.y + box.height / 2 });
  assert.equal(await input.evaluate(element => element === document.activeElement), true, 'Native pointer focuses the slider');
  const adjustment = value - Number(await input.inputValue());
  assert.ok(Math.abs(adjustment) <= 2, `Pointer drag reaches requested range position: ${id}; expected ${value}, actual ${await input.inputValue()}`);
  for (let i = 0; i < Math.abs(adjustment); i++) await input.press(adjustment > 0 ? 'ArrowRight' : 'ArrowLeft');
  assert.equal(Number(await input.inputValue()), value);
  const key = id.endsWith('blur') ? 'blur' : id.endsWith('transparency') ? 'opacity' : 'clarity';
  await page.waitForFunction(async ({ key, value }) => (await window.medo.getBackgroundImageSettings())[key] === value, { key, value: key === 'opacity' ? 100 - value : key === 'blur' ? Math.round(value * 15) / 100 : value });
}

async function setupDesktop() {
  await app.evaluate(async ({ BrowserWindow, screen }) => {
    const main = BrowserWindow.getAllWindows()[0];
    const area = screen.getPrimaryDisplay().workArea;
    main.setBounds({ x: area.x + 40, y: area.y + 30, width: 1080, height: 720 });
    const behind = new BrowserWindow({ ...main.getBounds(), frame: false, show: false, backgroundColor: '#c85e27' });
    await behind.loadURL('data:text/html,<body style="margin:0;background:%23c85e27">');
    behind.setAlwaysOnTop(true, 'screen-saver'); behind.showInactive();
    main.setAlwaysOnTop(true, 'screen-saver'); main.show(); main.moveTop();
    global.backgroundTest = { main, behind };
  });
}

async function capture(name, backgroundSamples = false, points = null) {
  await app.evaluate(() => { global.backgroundTest.behind.showInactive(); global.backgroundTest.main.show(); global.backgroundTest.main.moveTop(); });
  await page.waitForTimeout(350);
  const result = await app.evaluate(async ({ desktopCapturer, screen }, points) => {
    const rect = global.backgroundTest.main.getBounds();
    const display = screen.getDisplayMatching(rect);
    const scale = display.scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } });
    const source = sources.find(item => item.display_id === String(display.id));
    const image = source.thumbnail.crop({ x: Math.round((rect.x - display.bounds.x) * scale), y: Math.round((rect.y - display.bounds.y) * scale), width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) });
    const tintSamples = [.2, .35, .5, .65, .8].flatMap(position => [...image.crop({ x: Math.round(rect.width * position * scale), y: Math.round(12 * scale), width: 1, height: 1 }).toBitmap()]);
    const detailSamples = points?.map(point => [...image.crop({ x: Math.round(point.x * scale), y: Math.round(point.y * scale), width: 1, height: 1 }).toBitmap()]);
    return { png: image.toPNG().toString('base64'), sample: [...image.crop({ x: Math.round((rect.width - 90) * scale), y: Math.round(170 * scale), width: 1, height: 1 }).toBitmap()], tintSamples, detailSamples };
  }, points);
  fs.writeFileSync(path.join(destination, `${name}.png`), Buffer.from(result.png, 'base64'));
  return points ? result.detailSamples : backgroundSamples ? result.tintSamples : result.sample;
}

async function run() {
  await launch();
  try {
    evidence.nativeMaterial = await page.evaluate(() => document.documentElement.dataset.windowMaterial);
    assert.ok(['blur', 'acrylic'].includes(evidence.nativeMaterial));
    await setupDesktop();
    await page.evaluate(() => { applyTheme('dark'); currentView = 'library'; render(); });
    const defaultSample = await capture('default-dark');
    const defaultPlane = await page.evaluate(() => ({
      coverage: Number(getComputedStyle(document.documentElement).getPropertyValue('--background-coverage')),
      tintOpacity: Number(getComputedStyle(document.querySelector('.glass-background')).opacity) * Number(getComputedStyle(document.querySelector('.glass-background-tint')).opacity)
    }));
    assert.deepEqual(defaultPlane, { coverage: .90, tintOpacity: .90 });
    evidence.defaultPlane = defaultPlane;
    // Lower coverage must reveal more of the real desktop.
    const transparency = [];
    for (const coverage of [.50, .40]) {
      await page.evaluate(coverage => document.documentElement.style.setProperty('--background-coverage', coverage), coverage);
      await app.evaluate(async () => global.backgroundTest.behind.webContents.executeJavaScript("document.body.style.background='#c85e27'"));
      const warm = await capture(`coverage-${coverage}-warm`, true);
      await app.evaluate(async () => global.backgroundTest.behind.webContents.executeJavaScript("document.body.style.background='#040404'"));
      const dark = await capture(`coverage-${coverage}-dark`, true);
      const contribution = warm.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : Math.abs(value - dark[index])), 0) / 15;
      transparency.push({ coverage, warm, dark, contribution });
    }
    assert.ok(transparency[1].contribution > transparency[0].contribution * 1.1,
      `Lower coverage reveals more of the real desktop: ${JSON.stringify(transparency)}`);
    await page.evaluate(() => document.documentElement.style.removeProperty('--background-coverage'));
    await app.evaluate(async () => global.backgroundTest.behind.webContents.executeJavaScript("document.body.style.background='#c85e27'"));
    assert.equal(await app.evaluate(() => global.backgroundTest.main.getOpacity()), 1, 'Native window opacity keeps all foreground content intact');
    const foreground = await page.evaluate(() => ['body', '.player', '#play-button'].map(selector => getComputedStyle(document.querySelector(selector)).opacity));
    assert.deepEqual(foreground, ['1', '1', '1']);
    evidence.transparency = { samples: transparency, foreground, windowOpacity: 1 };
    await page.locator('#settings-button').click();
    assert.equal(await page.locator('.background-image-heading h3').textContent(), '自定义背景');
    assert.equal(await page.locator('#background-image-name').textContent(), '默认染色');
    assert.equal(await page.locator('#background-image-clarity').isEnabled(), true);
    assert.equal(await page.locator('#background-image-blur').isEnabled(), true);
    assert.equal(await page.locator('#background-image-clarity-value').textContent(), '30%');
    assert.equal(await page.locator('#background-image-blur-value').textContent(), '50%');
    assert.equal(await page.locator('#background-image-blur').getAttribute('max'), '15');
    assert.equal(await page.locator('#search-input').getAttribute('placeholder'), null);
    await range('#background-transparency', 73);
    assert.equal(await page.locator('#background-transparency-value').textContent(), '73%');
    await range('#background-transparency', 40);
    evidence.nativeTransparencyDrag = true;
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { applyTheme(theme); applyThemeColors('#ff4520', '#20baff'); }, theme);
      await range('#background-image-clarity', 0);
      const clear = await capture(`default-clear-${theme}`, true);
      await range('#background-image-clarity', 100);
      await range('#background-image-blur', 0);
      assert.equal(await page.locator('#background-image-blur-value').textContent(), '0%');
      const sharp = await capture(`default-sharp-${theme}`, true);
      assert.notDeepEqual(sharp, clear, 'Default tint clarity changes actual native composite');
      assert.equal(await page.locator('.glass-background-tint').evaluate(tint => tint.style.getPropertyValue('--default-tint-strength')), '30%');
      await range('#background-image-blur', 15);
      assert.equal(await page.locator('#background-image-blur-value').textContent(), '100%');
      assert.equal(await page.locator('#background-image-blur').getAttribute('aria-valuetext'), '100%');
      assert.equal(await page.locator('.glass-background-tint').evaluate(tint => getComputedStyle(tint).filter), 'blur(15px)', 'New 100% blur equals the previous 50% effect');
      const soft = await capture(`default-soft-${theme}`, true);
      assert.notDeepEqual(soft, sharp, 'Default tint blur changes actual native composite');
      evidence[`default-${theme}`] = { clear, sharp, soft };
    }
    assert.deepEqual(readSettings(), { image: null, name: '', clarity: 100, blur: 15, opacity: 60, material: 'frosted' });
    await app.close(); app = null;
    fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), blur: 30 }));
    await launch();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.glassBackground), 'theme');
    assert.equal(await page.locator('#background-image-clarity').inputValue(), '100');
    assert.equal(await page.locator('#background-image-blur').inputValue(), '100', 'An old saved value above the new maximum is capped on restart');
    assert.equal(await page.locator('#background-image-blur-value').textContent(), '100%');
    assert.equal((await page.evaluate(() => window.medo.getBackgroundImageSettings())).blur, 15);
    evidence.legacyBlur = { saved: 30, restored: 15, displayed: '100%' };
    await setupDesktop();
    await page.locator('#settings-button').click();
    await page.locator('#reset-background-image').click();
    await page.waitForFunction(() => document.querySelector('#background-image-clarity').value === '30');
    assert.deepEqual(readSettings(), { image: null, name: '', clarity: 30, blur: 7.5, opacity: 90, material: 'frosted' });
    await page.evaluate(() => { applyTheme('dark'); applyThemeColors('#2864ff', '#d934ff'); });
    const png = await page.evaluate(() => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 1600, height: 900 });
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, 1600, 900);
      gradient.addColorStop(0, '#d66723'); gradient.addColorStop(.48, '#2e877f'); gradient.addColorStop(1, '#2845a2');
      context.fillStyle = gradient; context.fillRect(0, 0, 1600, 900);
      context.fillStyle = '#fff0b9'; context.beginPath(); context.arc(1160, 230, 125, 0, Math.PI * 2); context.fill();
      for (let i = 0; i < 5; i++) { context.fillStyle = '#17383c66'; context.beginPath(); context.moveTo(0, 550 + i * 70); context.bezierCurveTo(500, 350 + i * 80, 900, 950, 1600, 450 + i * 80); context.lineTo(1600, 900); context.lineTo(0, 900); context.fill(); }
      return canvas.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(fixture, Buffer.from(png, 'base64'));
    await page.locator('#settings-button').click();
    await range('#background-transparency', 60);
    await range('#background-image-clarity', 65);
    await select(fixture);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.glassBackground), 'image');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.windowMaterial), evidence.nativeMaterial);
    const imageCoverage = await page.evaluate(() => {
      const layer = document.querySelector('#glass-background');
      const image = Number(getComputedStyle(layer.querySelector('img')).opacity);
      const base = 1;
      return { image, base, combined: Number(getComputedStyle(layer).opacity) };
    });
    assert.equal(imageCoverage.image, .52);
    assert.equal(imageCoverage.base, 1, 'Neutral base fills transparent image pixels');
    assert.equal(imageCoverage.combined, .40);
    evidence.imageCoverage = imageCoverage;
    await range('#background-image-clarity', 40);
    const lowClarityCoverage = await page.evaluate(() => {
      const layer = document.querySelector('#glass-background');
      const image = Number(getComputedStyle(layer.querySelector('img')).opacity);
      const base = 1;
      return { image, base, combined: Number(getComputedStyle(layer).opacity) };
    });
    assert.equal(lowClarityCoverage.image, .32);
    assert.equal(lowClarityCoverage.base, 1, 'Clarity keeps the neutral base intact');
    assert.ok(Math.abs(lowClarityCoverage.combined - .40) < .0001, 'Lower image clarity shares the 40% neutral plane');
    evidence.lowClarityCoverage = lowClarityCoverage;
    await range('#background-image-clarity', 65);
    const formats = await page.evaluate(() => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 40, height: 24 });
      const context = canvas.getContext('2d'); context.fillStyle = '#378aa0'; context.fillRect(0, 0, 40, 24);
      return { jpg: canvas.toDataURL('image/jpeg').split(',')[1], webp: canvas.toDataURL('image/webp').split(',')[1] };
    });
    const bmp = Buffer.alloc(54 + 16 * 16 * 3);
    bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(16, 18); bmp.writeInt32LE(16, 22);
    bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.fill(120, 54);
    formats.bmp = bmp.toString('base64');
    for (const [extension, data] of Object.entries(formats)) {
      const file = path.join(profile, `format.${extension}`); fs.writeFileSync(file, Buffer.from(data, 'base64'));
      await select(file);
      assert.equal(readSettings().name, path.basename(file), `${extension} import decodes and persists`);
    }
    evidence.formats = ['png', ...Object.keys(formats)];
    // High-frequency details under the real settings card must survive at 0% blur.
    const striped = path.join(profile, 'sharp-background.png');
    const stripes = await page.evaluate(() => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 1600, height: 900 });
      const context = canvas.getContext('2d');
      for (let x = 0; x < canvas.width; x += 20) {
        context.fillStyle = x % 40 ? '#ffffff' : '#000000'; context.fillRect(x, 0, 20, canvas.height);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(striped, Buffer.from(stripes, 'base64'));
    await select(striped);
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await range('#background-image-clarity', 80);
      await range('#background-image-blur', 0);
      const points = await page.evaluate(() => {
        const image = document.querySelector('#glass-background img'), box = image.getBoundingClientRect();
        const card = document.querySelector('.background-image-setting').getBoundingClientRect();
        const row = document.querySelector('.background-image-adjustments').getBoundingClientRect();
        const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
        const left = box.left + (box.width - image.naturalWidth * scale) / 2;
        const points = [];
        for (let x = 10; x < image.naturalWidth; x += 20) {
          const visibleX = left + x * scale;
          if (visibleX > card.left + card.width * .5 && visibleX < card.right - 24) points.push({ x: visibleX, y: row.top - 10 });
        }
        return points;
      });
      assert.ok(points.length >= 8);
      const sharp = await capture(`image-zero-blur-settings-${theme}`, false, points);
      const style = await page.locator('#glass-background img').evaluate(image => {
        const box = image.getBoundingClientRect();
        return { filter: getComputedStyle(image).filter, left: box.left, top: box.top, width: box.width, height: box.height, viewport: [innerWidth, innerHeight] };
      });
      assert.equal(style.filter, 'blur(0px)');
      assert.equal(style.left, 0); assert.equal(style.top, 0);
      assert.deepEqual([style.width, style.height], style.viewport, 'Zero blur uses the original cover framing without extra zoom');
      const contrast = samples => Math.max(...samples.map(pixel => pixel[1])) - Math.min(...samples.map(pixel => pixel[1]));
      const sharpContrast = contrast(sharp);
      await range('#background-image-clarity', 100);
      const maximumClarity = await capture(`image-max-clarity-settings-${theme}`, false, points);
      const maximumContrast = contrast(maximumClarity);
      assert.ok(maximumContrast > sharpContrast * 1.35, `100% clarity has stronger detail than the old 80%-opacity maximum: ${theme}, 80%=${sharpContrast}, 100%=${maximumContrast}`);
      const maximumStyle = await page.evaluate(() => ({
        opacity: getComputedStyle(document.querySelector('#glass-background img')).opacity,
        base: getComputedStyle(document.querySelector('#glass-background'), '::after').backgroundColor,
        blur: getComputedStyle(document.querySelector('#glass-background img')).filter
      }));
      assert.equal(Number(maximumStyle.opacity), .95);
      assert.doesNotMatch(maximumStyle.base, /(?:rgba\(.*?, 0\)|color\(.*?\/ 0\))/);
      assert.equal(maximumStyle.blur, 'blur(0px)', 'Clarity does not change the independently selected blur');
      await range('#background-image-clarity', 80);
      await range('#background-image-blur', 15);
      const soft = await capture(`image-full-blur-settings-${theme}`, false, points);
      const softContrast = contrast(soft);
      assert.ok(sharpContrast >= 65, `0% blur retains settings background detail: ${theme}, contrast=${sharpContrast}`);
      assert.ok(softContrast < sharpContrast * .25, `100% blur visibly softens fine details: ${theme}, sharp=${sharpContrast}, soft=${softContrast}`);
      evidence[`image-detail-${theme}`] = { sharpContrast, maximumContrast, softContrast, style, maximumStyle };
    }
    await select(fixture);
    const chosen = readSettings();
    assert.ok(fs.existsSync(path.join(profile, 'backgrounds', chosen.image)));
    fs.unlinkSync(fixture);
    await range('#background-image-clarity', 90);
    await range('#background-image-blur', 10);
    assert.equal(readSettings().clarity, 90);
    assert.equal(readSettings().blur, 10.05);
    assert.equal(await page.locator('#background-image-clarity-value').textContent(), '90%');
    assert.equal(await page.locator('#background-image-blur-value').textContent(), '67%');
    const imageStyle = await page.locator('#glass-background img').evaluate(image => ({ opacity: getComputedStyle(image).opacity, filter: getComputedStyle(image).filter }));
    assert.equal(Number(imageStyle.opacity), .795);
    assert.equal(imageStyle.filter, 'blur(10.05px)');
    evidence.sliders = imageStyle;
    const beforeCancel = readSettings();
    await select(null);
    assert.deepEqual(readSettings(), beforeCancel);
    const badFile = path.join(profile, 'bad.png'); fs.writeFileSync(badFile, 'not an image');
    await select(badFile);
    assert.match(await page.locator('#background-image-status').textContent(), /图片无法读取/);
    assert.deepEqual(readSettings(), beforeCancel);
    await select(null);
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { applyTheme(theme); localStorage.setItem('medo.theme', theme); currentView = 'library'; render(); }, theme);
      await page.waitForTimeout(250);
      const sample = await capture(`image-${theme}`);
      if (theme === 'dark') { assert.notDeepEqual(sample, defaultSample, 'Custom picture changes actual desktop composite'); evidence.imageSample = sample; }
      const player = await page.evaluate(material);
      await page.evaluate(() => {
        tracks = [{ id: 'background-test', title: '玻璃上的色彩', artist: 'MedoMusic', album: '背景验证', duration: 160, format: 'FLAC', metadataLoaded: true, cover: '../Groove/Assets/MissingAlbumArt.jpg' }];
        currentIndex = 0; playbackQueueIds = ['background-test']; render(); updateNowPlaying(tracks[0]);
        lyricsCache.set('background-test', { synced: true, networkOnly: true, lines: Array.from({ length: 24 }, (_, index) => ({
          start: index * 8, text: ['沿着海岸 等一阵晚风', '让色彩映在玻璃上', '窗外的光依然清晰', '把今天写进明天的信'][index % 4]
        })) });
        Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 96 });
        openPlaybackDetail(); updateLyricsAtTime();
      });
      await page.waitForTimeout(550);
      assert.deepEqual(await page.evaluate(material), player, 'Player material matches between both pages');
      evidence[`lyrics-${theme}`] = await require('./custom-background-lyrics')(page);
      await capture(`lyrics-${theme}`);
      await page.evaluate(() => { currentView = 'settings'; render(); });
      await page.locator('.background-image-setting').evaluate(element => element.scrollIntoView({ block: 'center' }));
      await capture(`settings-${theme}`);
    }
    await app.evaluate(() => global.backgroundTest.main.setSize(960, 640));
    await page.evaluate(() => { document.documentElement.style.setProperty('--sidebar-width', '360px'); currentView = 'settings'; render(); });
    await page.locator('.background-image-setting').evaluate(element => element.scrollIntoView({ block: 'center' }));
    const slidersFit = await page.locator('.background-image-slider').evaluateAll(rows => rows.every(row => {
      const box = row.getBoundingClientRect();
      return [...row.children].every(child => { const bounds = child.getBoundingClientRect(); return bounds.left >= box.left - 1 && bounds.right <= box.right + 1; });
    }));
    assert.equal(slidersFit, true, 'Both sliders fit the minimum window with a wide sidebar');
    await capture('settings-narrow');
    await app.evaluate(() => global.backgroundTest.main.setSize(1080, 720));
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-width', '220px'));
    await page.evaluate(() => { applyTheme('dark'); currentView = 'library'; render(); });
    const firstDesktop = await capture('image-desktop-warm');
    await app.evaluate(async () => {
      global.backgroundTest.behind.setBackgroundColor('#040404');
      await global.backgroundTest.behind.webContents.executeJavaScript("document.body.style.background='#040404'");
      return true;
    });
    const secondDesktop = await capture('image-desktop-dark');
    assert.notDeepEqual(firstDesktop, secondDesktop, 'Desktop stays visible through picture tint');
    evidence.desktopSamples = [firstDesktop, secondDesktop];
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.glassBackground), 'image');
    await page.emulateMedia({ contrast: 'more' });
    assert.equal(await page.locator('#glass-background').evaluate(element => getComputedStyle(element).display), 'none');
    await page.emulateMedia({ contrast: 'no-preference', reducedMotion: 'no-preference' });
    await page.evaluate(() => { currentView = 'settings'; render(); });
    await app.close(); app = null;
    await launch();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.glassBackground), 'image');
    assert.equal(await page.locator('#background-image-clarity').inputValue(), '90');
    assert.equal(await page.locator('#background-image-blur').inputValue(), '67');
    await page.locator('#settings-button').click();
    await page.evaluate(() => { applyThemeColors('#18a69c', '#f09445', true); });
    await page.locator('#reset-background-image').click();
    await page.waitForFunction(() => document.documentElement.dataset.glassBackground === 'theme');
    assert.deepEqual(readSettings(), { image: null, name: '', clarity: 30, blur: 7.5, opacity: 90, material: 'frosted' });
    assert.equal(await page.locator('#background-image-clarity').inputValue(), '30');
    assert.equal(await page.locator('#background-image-blur').inputValue(), '50');
    assert.equal(await page.locator('#background-image-clarity-value').textContent(), '30%');
    assert.equal(await page.locator('#background-image-blur-value').textContent(), '50%');
    assert.equal(await page.locator('#theme-primary-color').inputValue(), '#18a69c');
    assert.equal(await page.locator('#theme-secondary-color').inputValue(), '#f09445');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.windowMaterial), evidence.nativeMaterial);
    assert.equal(await page.locator('#background-image-clarity').isEnabled(), true);
    assert.equal(await page.locator('#background-image-blur').isEnabled(), true);
    assert.deepEqual(evidence.errors, []);
    evidence.passed = '90% default coverage with intact foreground, lower coverage reveals more desktop, independent image clarity and 40% plane coverage, new 100% blur equals previous 50% effect, legacy blur capped on restart, stronger 100% clarity detail in dark/light, default tint clarity/blur native pixels, default adjustment restart/reset, sharp image detail at 0% blur and soft detail at 100%, zero-blur original framing, import, managed asset, cancel/error, player-style sliders, themes, shared player, actual desktop transparency, restart after source removal, contrast fallback, reset with preserved accents';
    fs.writeFileSync(path.join(destination, process.env.MEDO_TEST_EXECUTABLE ? 'packaged-checks.json' : 'development-checks.json'), JSON.stringify(evidence, null, 2));
    console.log('Glass background passed:', evidence.passed);
  } finally { await app?.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
