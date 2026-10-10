const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

async function run() {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-startup-updates-'));
  const destination = path.join(__dirname, 'artifacts', 'updates');
  fs.mkdirSync(destination, { recursive: true });
  const executablePath = process.env.MEDO_TEST_EXECUTABLE || path.join(root, '.electron-dist', 'electron.exe');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath, args: [...(process.env.MEDO_TEST_EXECUTABLE ? [] : [root]), `--user-data-dir=${profile}`], env, cwd: root });
  const errors = [];
  const evidence = { version: '1.6.2', profile, checks: [], errors };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof autoCheckUpdates === 'boolean');
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), '1.6.2');
    const locations = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath, application: app.getAppPath() }));
    const expectedDirectory = locations.packaged ? path.dirname(locations.executable) : locations.application;
    assert.equal((await page.evaluate(() => window.medo.getAppInfo())).installDirectory, expectedDirectory, 'About shows the executable installation directory');
    await page.evaluate(() => {
      localStorage.setItem('medo.initialScanComplete', 'true');
      localStorage.setItem('medo.musicFolders', '[]');
      localStorage.setItem('medo.tracks', '[]');
      localStorage.removeItem('medo.autoCheckUpdates');
    });
    // Exercise the real preload and main IPC, with deterministic GitHub replies.
    await app.evaluate(({ shell }) => {
      const originalFetch = global.fetch;
      global.updateTest = { requests: 0, opened: [], mode: 'new', version: '1.6.3' };
      global.fetch = async (url, options) => {
        if (url !== 'https://api.github.com/repos/Medo-bao/MedoMusic/releases/latest') return originalFetch(url, options);
        const state = global.updateTest;
        state.requests += 1;
        if (state.mode === 'pending') await new Promise(resolve => { state.finish = resolve; });
        if (state.mode === 'offline') throw new Error('offline');
        if (state.mode === 'timeout') { const error = new Error('timeout'); error.name = 'AbortError'; throw error; }
        return { ok: true, json: async () => ({ tag_name: `v${state.version}`, html_url: `https://github.com/Medo-bao/MedoMusic/releases/tag/v${state.version}` }) };
      };
      shell.openExternal = async url => { global.updateTest.opened.push(url); };
    });
    const reset = async (mode = 'new', version = '1.6.3') => app.evaluate((_electron, { mode, version }) => {
      Object.assign(global.updateTest, { requests: 0, opened: [], mode, version });
    }, { mode, version });
    const snapshot = () => app.evaluate(() => ({ requests: global.updateTest.requests, opened: global.updateTest.opened }));
    const reload = async () => {
      await page.reload();
      await page.waitForFunction(() => typeof autoCheckUpdates === 'boolean');
      await page.waitForFunction(() => document.querySelector('#about-version').textContent.endsWith(' 1.6.2'));
      await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
    };
    const settled = () => page.waitForFunction(() => !document.querySelector('#check-for-updates').disabled);

    await reload(); await settled();
    assert.equal(await page.locator('#auto-check-updates').isChecked(), true, 'Startup checking defaults to enabled');
    assert.deepEqual(await snapshot(), { requests: 1, opened: [] }, 'One startup request; browser only opens on demand');
    assert.match(await page.locator('#action-feedback').textContent(), /发现新版本 MedoMusic 1\.6\.3/);
    await page.screenshot({ path: path.join(destination, 'startup-new-version.png') });
    await page.locator('#action-feedback button').click();
    assert.deepEqual((await snapshot()).opened, ['https://github.com/Medo-bao/MedoMusic/releases/tag/v1.6.3']);
    evidence.checks.push('Enabled by default, exactly one startup request, new-version notice opens release only after click');

    await page.locator('#settings-button').click();
    await page.locator('#auto-check-updates').uncheck();
    await page.locator('.about-group').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(destination, 'settings-disabled.png') });
    assert.equal(await page.evaluate(() => localStorage.getItem('medo.autoCheckUpdates')), 'false');
    await reset(); await reload(); await settled();
    assert.equal(await page.locator('#auto-check-updates').isChecked(), false);
    assert.deepEqual(await snapshot(), { requests: 0, opened: [] }, 'Saved opt-out suppresses startup network traffic');
    await page.locator('#settings-button').click();
    await page.locator('#check-for-updates').click(); await settled();
    assert.deepEqual(await snapshot(), { requests: 1, opened: ['https://github.com/Medo-bao/MedoMusic/releases/tag/v1.6.3'] }, 'Manual checking works with startup checks disabled');
    evidence.checks.push('Opt-out persists across renderer startup; manual update check still opens a newer release');

    await page.locator('#auto-check-updates').check();
    for (const mode of ['offline', 'timeout']) {
      await reset(mode); await reload(); await settled();
      assert.deepEqual(await snapshot(), { requests: 1, opened: [] });
      assert.equal(await page.locator('#check-for-updates span:last-child').textContent(), '检查更新', 'Automatic failures remain quiet and permit retry');
      assert.equal(await page.locator('#action-feedback').count(), 0);
      await page.locator('#settings-button').click();
      await page.locator('#check-for-updates').click(); await settled();
      assert.equal(await page.locator('#check-for-updates span:last-child').textContent(), '检查失败');
    }
    evidence.checks.push('Offline and timeout failures do not interrupt startup; manual retry reports failures');

    for (const version of ['1.5.3', '1.6.2']) {
      await reset('new', version); await reload(); await settled();
      assert.deepEqual(await snapshot(), { requests: 1, opened: [] });
      assert.equal(await page.locator('#check-for-updates span:last-child').textContent(), '软件已最新');
      assert.equal(await page.locator('#action-feedback').count(), 0);
    }
    await reset('new', '1.6.10'); await reload(); await settled();
    assert.match(await page.locator('#action-feedback').textContent(), /1\.6\.10/);
    evidence.checks.push('Older/equal versions remain quiet; numeric version comparison detects 1.6.10');

    await reset('pending'); await reload();
    await page.waitForFunction(() => document.querySelector('#check-for-updates').disabled);
    await page.locator('#settings-button').click();
    await page.locator('#auto-check-updates').uncheck();
    await app.evaluate(() => global.updateTest.finish());
    await settled();
    assert.deepEqual(await snapshot(), { requests: 1, opened: [] });
    assert.equal(await page.locator('#action-feedback').count(), 0, 'Unchecking during a pending startup check suppresses its notice');
    evidence.checks.push('Disabling during a pending startup request suppresses its notice');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(destination, process.env.MEDO_TEST_EXECUTABLE ? 'packaged-checks.json' : 'source-checks.json'), JSON.stringify(evidence, null, 2));
    console.log('Startup updates passed:', evidence.checks.join('; '));
  } finally {
    await app.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
