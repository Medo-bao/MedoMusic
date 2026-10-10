const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-background-adjustments-'));
const settingsFile = path.join(profile, 'background-image.json');
const cache = path.join(profile, 'backgrounds');
const defaults = { image: null, name: '', clarity: 30, blur: 7.5, opacity: 90, material: 'frosted' };
const evidence = { profile, cases: [], errors: [] };
let app, page;
const settings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const images = () => fs.readdirSync(cache).filter(name => /^[a-f0-9]{64}\.png$/.test(name));
const record = name => evidence.cases.push(name);

async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: process.env.MEDO_TEST_EXECUTABLE || path.join(root, '.electron-dist/electron.exe'),
    args: [...(process.env.MEDO_TEST_EXECUTABLE ? [] : [root]), `--user-data-dir=${profile}`], env, cwd: root
  });
  page = await app.firstWindow();
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.waitForFunction(() => typeof glassBackground === 'object');
  await page.evaluate(() => glassBackground.ready);
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))), path.resolve(profile));
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), '1.6.2');
  await page.evaluate(() => {
    localStorage.setItem('medo.initialScanComplete', 'true');
    localStorage.setItem('medo.indexSchema', '2');
    localStorage.setItem('medo.autoCheckUpdates', 'false');
    currentView = 'settings'; render();
  });
}
async function stop() { if (app) { await app.close(); app = null; } }
async function select(file) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => file ? { canceled: false, filePaths: [file] } : { canceled: true, filePaths: [] };
  }, file);
  await page.evaluate(() => document.querySelector('#choose-background-image').click());
  await page.waitForFunction(() => !document.querySelector('#choose-background-image').disabled);
}
async function slider(id, value) {
  await page.locator(id).evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForFunction(() => document.querySelector('#background-image-status').textContent === '调整已保存。');
}
async function reset() {
  await page.evaluate(() => document.querySelector('#reset-background-image').click());
  await page.waitForFunction(() => !document.querySelector('#choose-background-image').disabled);
}
async function fixture(name, color) {
  const png = await page.evaluate(color => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color;
    ctx.fillRect(0, 0, 192, 256); // Leave a transparent strip to exercise PNG alpha.
    ctx.fillStyle = '#efcd1a';
    for (let x = 0; x < 192; x += 32) ctx.fillRect(x, 0, 12, 256);
    return canvas.toDataURL('image/png').split(',')[1];
  }, color);
  const file = path.join(profile, name); fs.writeFileSync(file, Buffer.from(png, 'base64')); return file;
}
async function visual() {
  return page.evaluate(() => ({
    plane: Number(getComputedStyle(document.querySelector('#glass-background')).opacity),
    image: Number(getComputedStyle(document.querySelector('#glass-background img')).opacity),
    base: getComputedStyle(document.querySelector('#glass-background'), '::after').backgroundColor,
    filter: getComputedStyle(document.querySelector('#glass-background img')).filter
  }));
}

(async () => {
  try {
    await launch();
    const initial = await page.evaluate(() => window.medo.getBackgroundImageSettings());
    assert.deepEqual(initial, { ...defaults, imageUrl: null });
    assert.equal(await page.locator('#background-image-blur').inputValue(), '50');
    assert.equal(await page.locator('#reset-background-image').isDisabled(), true);
    record('defaults and ready controls');

    const first = await fixture('first.png', '#3355cc');
    const second = await fixture('second.png', '#cc4433');
    await select(first); assert.equal(images().length, 1);
    await slider('#background-image-clarity', 80); const c80 = await visual();
    await slider('#background-image-clarity', 100); const c100 = await visual();
    assert.ok(c100.image > c80.image); assert.equal(c100.plane, c80.plane);
    assert.equal(c100.filter, c80.filter);
    record('clarity 80 to 100 changes image without changing coverage or blur');

    await slider('#background-image-clarity', 70);
    await slider('#background-transparency', 10); const t10 = await visual();
    await slider('#background-transparency', 30); const t30 = await visual();
    assert.ok(t10.plane > t30.plane); assert.equal(t10.image, t30.image);
    for (const [value, expected] of [[0, 1], [100, 0]]) {
      await slider('#background-transparency', value); assert.equal((await visual()).plane, expected);
    }
    assert.doesNotMatch(t10.base, /(?:rgba\(.*?, 0\)|color\(.*?\/ 0\))/);
    assert.deepEqual(await page.evaluate(() => ['body', '.player', '#play-button'].map(s => getComputedStyle(document.querySelector(s)).opacity)), ['1', '1', '1']);
    await slider('#background-transparency', 40);
    record('transparency including endpoints and transparent PNG keeps foreground opaque');

    const blurValues = await page.locator('#background-image-blur').evaluate(input => {
      const values = [];
      for (let i = 0; i <= 100; i++) {
        input.value = i; input.dispatchEvent(new Event('input', { bubbles: true }));
        values.push(document.querySelector('#glass-background img').style.filter);
      }
      return values;
    });
    assert.equal(new Set(blurValues).size, 101);
    assert.equal(blurValues[0], 'blur(0px)'); assert.equal(blurValues[100], 'blur(15px)');
    await slider('#background-image-blur', 67); assert.equal(settings().blur, 10.05);
    record('101 distinct blur levels with fractional persistence');

    await page.evaluate(() => document.querySelector('[data-background-material-value="transparent"]').click());
    await page.waitForFunction(() => document.querySelector('#background-image-status').textContent === '调整已保存。');
    const beforeRestart = settings(); await stop(); await launch();
    assert.deepEqual(settings(), beforeRestart);
    assert.equal(await page.locator('#background-image-blur').inputValue(), '67');
    assert.equal(await page.evaluate(() => window.medo.getWindowMaterial()), 'transparent');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.glassBackground), 'image');
    record('image fractional adjustments and native material survive restart');

    await select(null); assert.deepEqual(settings(), beforeRestart);
    const invalid = path.join(profile, 'invalid.png'); fs.writeFileSync(invalid, 'not a PNG');
    await select(invalid); assert.deepEqual(settings(), beforeRestart);
    assert.equal(images().length, 1);
    record('cancel and invalid selection preserve current background');

    const oldImage = settings().image;
    fs.writeFileSync(path.join(cache, 'keep.txt'), 'not managed');
    await select(second); assert.equal(images().length, 1);
    assert.ok(!fs.existsSync(path.join(cache, oldImage)));
    await select(second); assert.equal(images().length, 1);
    assert.ok(fs.existsSync(path.join(cache, settings().image)));
    assert.equal(fs.readFileSync(path.join(cache, 'keep.txt'), 'utf8'), 'not managed');
    record('replacement cleanup and duplicate import preserve active and unmanaged files');

    const orphan = path.join(cache, `${'d'.repeat(64)}.png`); fs.writeFileSync(orphan, 'orphan');
    await stop(); await launch(); assert.ok(!fs.existsSync(orphan)); assert.equal(images().length, 1);
    record('startup removes old managed cache remnants');

    await slider('#background-image-clarity', 30);
    await app.evaluate(({ app, ipcMain, nativeImage }) => {
      const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const store = load('./src/background-image-store.js').createBackgroundImageStore(app.getPath('userData'), nativeImage);
      global.backgroundSaveTest = { calls: 0 };
      ipcMain.removeHandler('background-image:update');
      ipcMain.handle('background-image:update', (_event, values) => {
        const call = ++global.backgroundSaveTest.calls;
        return new Promise((resolve, reject) => {
          if (call === 1) global.backgroundSaveTest.succeed = async () => resolve(await store.update(values));
          else global.backgroundSaveTest.fail = () => reject(new Error('simulated write failure'));
        });
      });
    });
    for (const value of [40, 50]) await page.locator('#background-image-clarity').evaluate((input, value) => {
      input.value = value; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
    }, value);
    await app.evaluate(async () => { await global.backgroundSaveTest.succeed(); });
    await page.waitForTimeout(70);
    await app.evaluate(() => global.backgroundSaveTest.fail());
    await page.waitForFunction(() => document.querySelector('#background-image-status').textContent.includes('未能保存'));
    assert.equal(await page.locator('#background-image-clarity').inputValue(), '40');
    assert.equal(settings().clarity, 40);
    record('failed latest save rolls back to latest successful save');

    await stop(); await launch();
    await page.evaluate(() => window.medo.setBackgroundImageSettings({ clarity: 25, blur: 4, opacity: 45, material: 'transparent' }));
    const startup = await page.evaluate(() => window.medo.getBackgroundImageSettings());
    await app.evaluate(({ ipcMain }, snapshot) => {
      ipcMain.removeHandler('background-image:get');
      ipcMain.handle('background-image:get', () => new Promise(resolve => {
        global.finishBackgroundRead = () => resolve(snapshot);
      }));
    }, startup);
    await page.reload(); await page.waitForFunction(() => typeof glassBackground === 'object');
    assert.equal(await page.locator('#background-transparency').isDisabled(), true);
    assert.equal(await page.locator('#choose-background-image').isDisabled(), true);
    await page.locator('#background-transparency').evaluate(input => {
      input.value = 60; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
    });
    await app.evaluate(() => global.finishBackgroundRead()); await page.evaluate(() => glassBackground.ready);
    assert.equal(settings().clarity, 25); assert.equal(settings().blur, 4); assert.equal(settings().material, 'transparent');
    assert.equal(await page.locator('#background-transparency').inputValue(), '55');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.glassBackground), 'image');
    record('slow startup blocks changes until saved values and image restore');

    await stop(); fs.writeFileSync(path.join(cache, startup.image), 'corrupt PNG'); await launch();
    assert.equal(await page.locator('#background-image-clarity').inputValue(), '25');
    assert.equal(await page.locator('#reset-background-image').isEnabled(), true);
    assert.match(await page.locator('#background-image-status').textContent(), /不可用/);
    await reset(); assert.deepEqual(settings(), defaults); assert.equal(images().length, 0);
    record('corrupt cached image preserves adjustments and allows reset');

    await select(first); const missing = settings(); await stop();
    fs.unlinkSync(path.join(cache, missing.image)); await launch();
    assert.equal(await page.locator('#reset-background-image').isEnabled(), true);
    assert.match(await page.locator('#background-image-status').textContent(), /不可用/);
    await select(first); assert.equal(images().length, 1);
    record('missing cache image can be selected again');

    const beforeFailure = settings();
    await app.evaluate(() => {
      const fs = process.getBuiltinModule('fs/promises'); global.backgroundRename = fs.rename;
      fs.rename = (from, to) => String(to).endsWith('background-image.json')
        ? Promise.reject(new Error('simulated settings write failure')) : global.backgroundRename(from, to);
    });
    try { await select(second); } finally {
      await app.evaluate(() => { process.getBuiltinModule('fs/promises').rename = global.backgroundRename; });
    }
    assert.deepEqual(settings(), beforeFailure);
    assert.ok(fs.existsSync(path.join(cache, beforeFailure.image)));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.glassBackground), 'image');
    record('failed image commit leaves current configuration and image intact');

    await page.evaluate(() => applyThemeColors('#18a69c', '#f09445', true));
    await reset(); assert.deepEqual(settings(), defaults); assert.equal(images().length, 0);
    assert.equal(await page.locator('#theme-primary-color').inputValue(), '#18a69c');
    assert.equal(await page.locator('#theme-secondary-color').inputValue(), '#f09445');
    assert.equal(await page.locator('#background-image-blur').inputValue(), '50');
    assert.equal(fs.readFileSync(path.join(cache, 'keep.txt'), 'utf8'), 'not managed');
    record('reset removes managed cache and preserves theme colors');

    assert.equal(evidence.cases.length, 14); assert.deepEqual(evidence.errors, []);
    const destination = path.join(root, 'tests/artifacts/background-adjustments'); fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, process.env.MEDO_TEST_EXECUTABLE ? 'packaged-checks.json' : 'development-checks.json'), JSON.stringify(evidence, null, 2));
    console.log(`Background adjustments: ${evidence.cases.length}/14 scenarios passed`);
  } finally { await stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
