// Exactly four scenarios for the shared select menu's open/close behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'artifacts/dropdown-toggle');
fs.mkdirSync(output, { recursive: true });
const fixture = fs.mkdtempSync(path.join(output, 'app-'));
fs.mkdirSync(path.join(fixture, 'Music'));
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
  name: 'medo-dropdown-check', version: require('../package.json').version, main: 'main.cjs'
}));
fs.writeFileSync(path.join(fixture, 'main.cjs'), `
  const {app,globalShortcut,shell}=require('electron');
  app.setPath('userData',${JSON.stringify(path.join(fixture, 'Profile'))});
  app.setPath('music',${JSON.stringify(path.join(fixture, 'Music'))});
  const keys=new Set();globalShortcut.register=key=>{keys.add(key);return true;};
  globalShortcut.isRegistered=key=>keys.has(key);globalShortcut.unregister=key=>keys.delete(key);
  shell.openExternal=async()=>{};
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({tag_name:'v'+app.getVersion()}),text:async()=>''});
  require(${JSON.stringify(path.join(root, 'src/main.js'))});
`);

const report = { total: 4, checks: [], rendererErrors: [] };
async function main() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, '.electron-dist/electron.exe'), args: [fixture], cwd: root, env });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => report.rendererErrors.push(error.message));
    await page.waitForFunction(() => typeof lastShortcutStates !== 'undefined' && lastShortcutStates.size === 5 && localStorage.getItem('medo.initialScanComplete') === 'true');
    await page.evaluate(() => {
      applyAutoUpdateSetting(false); currentView = 'settings'; render();
      window.__selectEvents = {};
      for (const id of ['interface-scale', 'cover-fit']) {
        const counts = window.__selectEvents[id] = { input: 0, change: 0 };
        for (const type of ['input', 'change']) document.getElementById(id).addEventListener(type, () => counts[type]++);
      }
    });
    const menus = page.locator('.glass-menu');
    const scale = page.locator('#interface-scale'), cover = page.locator('#cover-fit');
    const events = () => page.evaluate(() => window.__selectEvents);
    const showControls = () => page.evaluate(async () => {
      document.querySelector('.interface-scale-setting').scrollIntoView({ block: 'center' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const clickControl = async control => {
      const box = await control.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    const scenario = async (name, action) => {
      await action(); assert.deepEqual(report.rendererErrors, []);
      report.checks.push({ name, status: 'PASS' });
      console.log(JSON.stringify(report.checks.at(-1)));
    };

    await scenario('Interface scale toggles closed on the second click in both themes without changing scale', async () => {
      const before = await scale.inputValue();
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => applyTheme(theme), theme);
        await showControls();
        for (let cycle = 0; cycle < 3; cycle++) {
          await scale.click(); assert.equal(await menus.count(), 1);
          await scale.click(); assert.equal(await menus.count(), 0);
          assert.equal(await page.evaluate(() => document.activeElement.id), 'interface-scale');
        }
        await scale.dblclick(); assert.equal(await menus.count(), 0);
      }
      assert.equal(await scale.inputValue(), before);
      assert.deepEqual((await events())['interface-scale'], { input: 0, change: 0 });
    });

    await scenario('Cover fit toggles closed, then selection still applies and persists each display mode once', async () => {
      await showControls();
      for (let cycle = 0; cycle < 3; cycle++) {
        await cover.click(); assert.equal(await menus.count(), 1);
        await cover.click(); assert.equal(await menus.count(), 0);
      }
      await cover.dblclick(); assert.equal(await menus.count(), 0);
      assert.deepEqual((await events())['cover-fit'], { input: 0, change: 0 });
      for (const [label, value] of [['适应', 'contain'], ['拉伸', 'fill'], ['填充', 'cover']]) {
        await cover.click();
        await menus.getByRole('menuitemradio', { name: label, exact: true }).click();
        assert.equal(await menus.count(), 0);
        assert.equal(await cover.inputValue(), value);
        assert.deepEqual(await page.evaluate(() => ({ stored: localStorage.getItem('medo.coverFit'), css: document.documentElement.style.getPropertyValue('--cover-fit') })), { stored: value, css: value });
      }
      await cover.click(); await menus.getByRole('menuitemradio', { name: '填充', exact: true }).click();
      assert.deepEqual((await events())['cover-fit'], { input: 3, change: 3 });
    });

    await scenario('Switching controls leaves one menu, while outside clicks and Escape close it without changing values', async () => {
      await showControls();
      const before = await events();
      await clickControl(cover);
      assert.equal(await menus.count(), 1);
      assert.equal(await menus.getByRole('menuitemradio').count(), 3);
      // Switch to the control above the popup, without Playwright scrolling
      // an obscured control out from under the existing menu.
      await clickControl(scale);
      assert.equal(await menus.count(), 1);
      assert.equal(await menus.getByRole('menuitemradio').count(), await scale.locator('option').count());
      await page.locator('#interface-scale-status').click(); assert.equal(await menus.count(), 0);
      for (const control of [scale, cover]) {
        await showControls();
        await clickControl(control); await page.keyboard.press('Escape'); assert.equal(await menus.count(), 0);
        assert.equal(await page.evaluate(() => document.activeElement.id), await control.getAttribute('id'));
        await clickControl(control); await clickControl(control); assert.equal(await menus.count(), 0);
      }
      assert.deepEqual(await events(), before);
    });

    await scenario('Keyboard selection and the preset dropdown inside its dialog retain their behavior', async () => {
      await scale.focus(); await page.keyboard.press('Enter'); assert.equal(await menus.count(), 1);
      await page.keyboard.press('Home'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => localStorage.getItem('medo.interfaceScale') === '0.8');
      assert.equal(await menus.count(), 0);
      await scale.click();
      await menus.getByRole('menuitemradio', { name: '跟随系统（100%）', exact: true }).click();
      await page.waitForFunction(() => localStorage.getItem('medo.interfaceScale') === '1');
      await page.locator('#open-sound-settings').click();
      const preset = page.locator('#sound-preset'), dialog = page.locator('#sound-dialog');
      await preset.click(); assert.equal(await menus.count(), 1);
      assert.equal(await menus.evaluate(menu => menu.parentElement.id), 'sound-dialog');
      await preset.click(); assert.equal(await menus.count(), 0);
      assert.equal(await dialog.evaluate(node => node.open), true);
      await preset.focus(); await page.keyboard.press('Space');
      await page.keyboard.press('End'); await page.keyboard.press('Enter');
      assert.equal(await preset.inputValue(), await preset.locator('option').last().getAttribute('value'));
      await preset.click(); await page.keyboard.press('Escape');
      assert.equal(await menus.count(), 0); assert.equal(await dialog.evaluate(node => node.open), true);
      await page.locator('#close-sound-settings').click();
    });
  } finally {
    await app.close();
  }
}
main().catch(error => { report.error = error.stack || String(error); process.exitCode = 1; console.error(report.error); }).finally(() => {
  report.passed = report.checks.length === report.total && !report.error && !report.rendererErrors.length;
  fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, scenarios: `${report.checks.length}/${report.total}` }));
});
