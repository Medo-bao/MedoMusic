// Exactly eight acceptance scenarios: six source/runtime checks, then bundle and export checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');
const { createSleepTimer } = require('../src/sleep-timer');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'artifacts/sleep-timer-1.6.4-20261021');
const version = require('../package.json').version;
const phase = process.argv[2] || 'source';
const retry = process.argv.includes('--retry-failed');
fs.mkdirSync(output, { recursive: true });
const reportPath = path.join(output, 'checks.json');
const report = phase === 'source' && !retry ? { total: 8, version, checks: [] } : JSON.parse(fs.readFileSync(reportPath));
const save = () => {
  report.passed = report.checks.filter(check => check.status === 'PASS').length;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
};
async function scenario(id, name, action) {
  if (retry && report.checks.some(check => check.id === id && check.status === 'PASS')) return;
  try {
    const result = { id, name, status: 'PASS', ...await action() };
    report.checks = [...report.checks.filter(check => check.id !== id), result].sort((a, b) => a.id - b.id);
    console.log(JSON.stringify(result)); save();
  } catch (error) {
    report.checks = [...report.checks.filter(check => check.id !== id), { id, name, status: 'FAIL', error: error.stack }];
    save(); throw error;
  }
}
function clockFixture() {
  let timestamp = 1000000, handle = 0, expired = 0;
  const jobs = new Map();
  const timer = createSleepTimer({ now: () => timestamp,
    schedule(callback, delay) { const id = ++handle; jobs.set(id, { callback, delay }); return id; },
    unschedule: id => jobs.delete(id), onExpire: () => expired++ });
  return { timer, jobs, expires: () => expired, advance: ms => { timestamp += ms; }, now: () => timestamp };
}
async function launch(packaged = false) {
  const folder = fs.mkdtempSync(path.join(output, packaged ? 'export-app-' : 'source-app-'));
  fs.mkdirSync(path.join(folder, 'Music'));
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'medo-sleep-timer-check', version, main: 'main.cjs' }));
  const main = packaged ? path.join(root, 'release/win-unpacked/resources/app.asar/src/main.js') : path.join(root, 'src/main.js');
  fs.writeFileSync(path.join(folder, 'main.cjs'), `
    const {app,globalShortcut,powerMonitor,shell}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(folder, 'Profile'))});app.setPath('music',${JSON.stringify(path.join(folder, 'Music'))});
    globalThis.__sleepClock={offset:0};const realNow=Date.now;Date.now=()=>realNow()+globalThis.__sleepClock.offset;
    const keys=new Set();globalShortcut.register=key=>{keys.add(key);return true;};globalShortcut.isRegistered=key=>keys.has(key);globalShortcut.unregister=key=>keys.delete(key);
    shell.openExternal=async()=>{};globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({tag_name:'v'+app.getVersion()}),text:async()=>''});
    require(${JSON.stringify(main)});
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/MedoMusic.exe' : '.electron-dist/electron.exe'), args: packaged ? [`--user-data-dir=${path.join(folder, 'Profile')}`] : [folder], cwd: root, env });
  if (packaged) await app.evaluate(({ app, globalShortcut, shell }, music) => {
    app.setPath('music', music);
    const keys = new Set(); globalShortcut.register = key => { keys.add(key); return true; };
    globalShortcut.isRegistered = key => keys.has(key); globalShortcut.unregister = key => keys.delete(key);
    shell.openExternal = async () => {};
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v' + app.getVersion() }), text: async () => '' });
  }, path.join(folder, 'Music'));
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof lastShortcutStates !== 'undefined' && lastShortcutStates.size === 5 && localStorage.getItem('medo.initialScanComplete') === 'true' && !document.querySelector('#sleep-timer-start').disabled);
  await page.evaluate(() => { applyAutoUpdateSetting(false); currentView = 'settings'; render(); });
  return { app, page, errors, folder, packaged };
}
const showSettings = page => page.evaluate(async () => {
  currentView = 'settings'; render();
  document.querySelector('.sleep-timer-setting').scrollIntoView({ block: 'center' });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
async function choose(page, value) {
  await page.locator('#sleep-timer-duration').click();
  const label = await page.locator(`#sleep-timer-duration option[value="${value}"]`).textContent();
  await page.locator('.glass-menu').getByRole('menuitemradio', { name: label, exact: true }).click();
}
async function start(page) {
  await page.locator('#sleep-timer-start').click();
  await page.waitForFunction(() => document.querySelector('#sleep-timer-status').dataset.active === 'true' && !document.querySelector('#sleep-timer-start').disabled);
  return page.evaluate(() => window.medo.getSleepTimer());
}
async function cancel(page) {
  await page.locator('#sleep-timer-cancel').click();
  await page.waitForFunction(() => document.querySelector('#sleep-timer-status').dataset.active === 'false' && !document.querySelector('#sleep-timer-start').disabled);
}
async function expireInBackground(context) {
  const { app, page } = context;
  const process = app.process();
  const exited = new Promise(resolve => process.once('exit', resolve));
  await page.evaluate(() => { applyCloseBehavior('background'); window.medo.toggleLyricsWindow(); });
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'));
    main.close();
  });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html')).isVisible()), false);
  const closed = app.waitForEvent('close', { timeout: context.packaged ? 80000 : 10000 });
  if (!context.packaged) await app.evaluate(({ powerMonitor }) => { globalThis.__sleepClock.offset += 2 * 60000; powerMonitor.emit('resume'); }).catch(error => {
    if (!/closed|destroyed|Target/i.test(error.message)) throw error;
  });
  await closed;
  await exited;
  assert.equal(process.exitCode, 0);
  assert.deepEqual(context.errors, []);
}
async function sourceChecks() {
  await scenario(1, 'Timer expires once, replacement cancels the old timeout and invalid durations preserve the active timer', async () => {
    const c = clockFixture();
    assert.deepEqual(c.timer.getState(), { deadline: null });
    c.timer.start(30); const first = c.timer.getState().deadline;
    for (const invalid of [0, -1, 1441, 1.5, NaN, Infinity, '30', null]) assert.throws(() => c.timer.start(invalid), RangeError);
    assert.equal(c.timer.getState().deadline, first); assert.equal(c.jobs.size, 1);
    c.advance(1000); c.timer.start(1); assert.equal(c.jobs.size, 1);
    assert.equal([...c.jobs.values()][0].delay, 60000);
    c.advance(60000); [...c.jobs.values()][0].callback();
    c.timer.check(); assert.equal(c.expires(), 1); assert.equal(c.jobs.size, 0);
    assert.deepEqual(c.timer.getState(), { deadline: null });
  });
  await scenario(2, 'Cancel prevents later expiry, resume honors the original deadline, and a new session begins without a timer', async () => {
    const c = clockFixture();
    c.timer.start(1440); assert.equal([...c.jobs.values()][0].delay, 86400000);
    c.timer.cancel(); c.advance(86400001); c.timer.check();
    assert.equal(c.expires(), 0); assert.equal(c.jobs.size, 0);
    const deadline = c.timer.start(2).deadline;
    c.advance(30000); c.timer.check();
    assert.equal(c.timer.getState().deadline, deadline); assert.equal([...c.jobs.values()][0].delay, 90000);
    c.advance(100000); c.timer.check(); assert.equal(c.expires(), 1);
    assert.deepEqual(clockFixture().timer.getState(), { deadline: null });
  });
  const context = await launch();
  const { app, page, errors } = context;
  try {
    await scenario(3, 'Settings use existing materials in both themes and reject empty, fractional and out-of-range custom minutes', async () => {
      await showSettings(page);
      assert.equal(await page.locator('#sleep-timer-duration').inputValue(), '30');
      assert.deepEqual(await page.evaluate(() => window.medo.getSleepTimer()), { deadline: null });
      await choose(page, 'custom');
      for (const value of ['', '0', '1441', '1.5']) {
        await page.locator('#sleep-timer-minutes').fill(value);
        await page.locator('#sleep-timer-start').click();
        assert.equal(await page.locator('#sleep-timer-minutes').evaluate(input => input.checkValidity()), false);
        assert.deepEqual(await page.evaluate(() => window.medo.getSleepTimer()), { deadline: null });
      }
      await page.locator('#sleep-timer-minutes').fill('30');
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => applyTheme(theme), theme);
        await showSettings(page);
        await page.mouse.move(1, 1);
        await page.evaluate(async () => {
          await new Promise(requestAnimationFrame);
          const controls = ['#sleep-timer-start', '#reset-desktop-lyric-position'].map(selector => document.querySelector(selector));
          await Promise.all(controls.flatMap(control => control.getAnimations()).map(animation => animation.finished));
        });
        assert.deepEqual(await page.locator('#sleep-timer-start').evaluate(button => ({ background: getComputedStyle(button).backgroundColor, border: getComputedStyle(button).borderColor })), await page.locator('#reset-desktop-lyric-position').evaluate(button => ({ background: getComputedStyle(button).backgroundColor, border: getComputedStyle(button).borderColor })));
        await page.locator('#settings-window').screenshot({ path: path.join(output, `settings-${theme}.png`) });
      }
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
      await showSettings(page);
      assert.equal(await page.locator('.sleep-timer-setting').evaluate(node => node.scrollWidth <= node.clientWidth), true);
      await page.locator('#settings-window').screenshot({ path: path.join(output, 'settings-narrow.png') });
      assert.deepEqual(errors, []);
    });
    await scenario(4, 'Start, live countdown, view changes, reload, restart and cancel keep one authoritative timer', async () => {
      await choose(page, '30'); const initial = await start(page);
      assert.ok(initial.deadline > Date.now() + 29 * 60000);
      const text = await page.locator('#sleep-timer-status').textContent();
      await page.waitForFunction(before => document.querySelector('#sleep-timer-status').textContent !== before, text);
      await page.evaluate(() => { currentView = 'library'; render(); });
      await showSettings(page); assert.deepEqual(await page.evaluate(() => window.medo.getSleepTimer()), initial);
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#sleep-timer-start').disabled);
      await showSettings(page);
      assert.deepEqual(await page.evaluate(() => window.medo.getSleepTimer()), initial);
      assert.equal(await page.locator('#sleep-timer-start').textContent(), '重新计时');
      await choose(page, 'custom'); await page.locator('#sleep-timer-minutes').fill('1');
      const replaced = await start(page); assert.ok(replaced.deadline < initial.deadline);
      assert.equal(await page.locator('.sleep-timer-setting').evaluate(node => node.scrollWidth <= node.clientWidth), true);
      await page.locator('#settings-window').screenshot({ path: path.join(output, 'settings-active-narrow.png') });
      await cancel(page);
      assert.deepEqual(await page.evaluate(() => window.medo.getSleepTimer()), { deadline: null });
      assert.equal(await page.locator('#sleep-timer-cancel').isVisible(), false);
      assert.deepEqual(errors, []);
    });
    await scenario(5, 'Timer, scale and cover dropdowns toggle closed without changing their selected values', async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 820));
      for (const id of ['sleep-timer-duration', 'interface-scale', 'cover-fit']) {
        await page.evaluate(async id => {
          document.getElementById(id).closest('.display-setting').scrollIntoView({ block: 'start' });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, id);
        const control = page.locator(`#${id}`), before = await control.inputValue();
        const box = await control.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); assert.equal(await page.locator('.glass-menu').count(), 1);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); assert.equal(await page.locator('.glass-menu').count(), 0);
        assert.equal(await control.inputValue(), before);
      }
      assert.deepEqual(errors, []);
    });
    await scenario(6, 'Deadline exits the entire app from the tray, including desktop lyrics, rather than hiding its main window', async () => {
      await showSettings(page); await choose(page, 'custom');
      await page.locator('#sleep-timer-minutes').fill('1'); await start(page);
      await expireInBackground(context);
      return { rendererErrors: errors };
    });
  } finally { await app.close().catch(() => {}); }
}
async function bundleCheck() {
  await scenario(7, 'Built installer metadata and every bundled source file match version 1.6.4 and this workspace', async () => {
    const asar = require('@electron/asar');
    const build = path.join(output, 'build'), archive = path.join(build, 'win-unpacked/resources/app.asar');
    assert.equal(version, '1.6.4');
    assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, version);
    const sourceFiles = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(file => fs.statSync(path.join(root, 'src', file)).isFile());
    for (const file of sourceFiles) assert.ok(asar.extractFile(archive, path.join('src', file)).equals(fs.readFileSync(path.join(root, 'src', file))), file);
    const installer = path.join(build, `MedoMusic-Setup-${version}-x64.exe`);
    const metadata = JSON.parse(fs.readFileSync(path.join(output, 'installer-info.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(metadata.productVersion, version);
    assert.equal(metadata.size, fs.statSync(installer).size);
    assert.ok(fs.statSync(installer).size > 0); assert.ok(fs.statSync(installer + '.blockmap').size > 0);
    return { comparedSourceFiles: sourceFiles.length, installerBytes: fs.statSync(installer).size };
  });
}
async function exportCheck() {
  await scenario(8, 'Exported app retains version 1.6.4, starts without an old timer, and cancels or exits correctly', async () => {
    const context = await launch(true);
    try {
      const { page, app, errors } = context;
      assert.equal(await app.evaluate(({ app }) => app.getVersion()), '1.6.4');
      assert.equal((await app.evaluate(({ app }) => app.getPath('userData'))).toLowerCase(), path.join(context.folder, 'Profile').toLowerCase());
      assert.equal((await app.evaluate(({ app }) => app.getAppPath())).toLowerCase(), path.join(root, 'release/win-unpacked/resources/app.asar').toLowerCase());
      assert.deepEqual(await page.evaluate(() => window.medo.getSleepTimer()), { deadline: null });
      await showSettings(page); await choose(page, 'custom');
      await page.locator('#sleep-timer-minutes').fill('1'); await start(page); await cancel(page);
      await start(page); await expireInBackground(context);
      assert.equal(fs.readdirSync(path.join(root, 'release')).filter(name => /^MedoMusic-Setup-.*\.exe$/.test(name)).join(), `MedoMusic-Setup-${version}-x64.exe`);
      return { rendererErrors: errors, installerBytes: fs.statSync(path.join(root, 'release', `MedoMusic-Setup-${version}-x64.exe`)).size };
    } finally { await context.app.close().catch(() => {}); }
  });
}
(phase === 'source' ? sourceChecks() : phase === 'bundle' ? bundleCheck() : phase === 'export' ? exportCheck() : Promise.reject(new Error('Unknown phase'))).catch(error => { console.error(error.stack); process.exitCode = 1; });
