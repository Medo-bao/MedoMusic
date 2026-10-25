// Exactly six scenarios for hidden page layers, delayed UI updates and popovers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'artifacts/visibility-layers-20261021');
fs.mkdirSync(output, { recursive: true });
const fixture = fs.mkdtempSync(path.join(output, 'app-'));
fs.mkdirSync(path.join(fixture, 'Music'));
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'medo-visibility-check', version: require('../package.json').version, main: 'main.cjs' }));
fs.writeFileSync(path.join(fixture, 'main.cjs'), `
  const {app,globalShortcut,shell}=require('electron');
  app.setPath('userData',${JSON.stringify(path.join(fixture, 'Profile'))});app.setPath('music',${JSON.stringify(path.join(fixture, 'Music'))});
  const keys=new Set();globalShortcut.register=key=>{keys.add(key);return true;};globalShortcut.isRegistered=key=>keys.has(key);globalShortcut.unregister=key=>keys.delete(key);
  shell.openExternal=async()=>{};globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({tag_name:'v'+app.getVersion()}),text:async()=>''});
  require(${JSON.stringify(path.join(root, 'src/main.js'))});
`);
const reportPath = path.join(output, 'checks.json');
const retry = process.argv.includes('--retry-failed');
const report = retry ? JSON.parse(fs.readFileSync(reportPath)) : { total: 6, checks: [], rendererErrors: [] };
async function main() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, '.electron-dist/electron.exe'), args: [fixture], cwd: root, env });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => report.rendererErrors.push(error.message));
    await page.waitForFunction(() => typeof lastShortcutStates !== 'undefined' && lastShortcutStates.size === 5 && localStorage.getItem('medo.initialScanComplete') === 'true' && !document.querySelector('#sleep-timer-start').disabled);
    await page.evaluate(() => {
      applyAutoUpdateSetting(false);
      // This suite exercises UI layers without real music files or lyric requests.
      ensureLyrics = async () => {};
      tracks = [{ id: 'visibility', title: '可见性检查', artist: '测试歌手', album: '测试专辑', duration: 180, path: 'E:/visibility-fixture.wav', metadataLoaded: true }];
      currentIndex = 0; playbackQueueIds = ['visibility']; playlists = [{ name: '测试歌单', trackIds: ['visibility'] }];
      currentView = 'library'; currentPlaylist = currentCollection = null; query = ''; currentSort = 'songs';
      selectedTrackIds.clear(); multiSelectionMode = false; sidebarCollapsed = false; syncSidebarState(); render();
      window.__painted = node => {
        if (getComputedStyle(node).visibility !== 'visible' || !node.getClientRects().length) return false;
        for (let parent = node; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || Number(style.opacity) < .01) return false;
        }
        return true;
      };
      window.__frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const menus = page.locator('.glass-menu');
    const scenario = async (id, name, action) => {
      if (retry && report.checks.some(check => check.id === id && check.status === 'PASS')) return;
      let result;
      try { await action(); assert.deepEqual(report.rendererErrors, []); result = { id, name, status: 'PASS' }; }
      catch (error) { result = { id, name, status: 'FAIL', error: error.stack }; throw error; }
      finally {
        report.checks = [...report.checks.filter(check => check.id !== id), result].sort((a, b) => a.id - b.id);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(result));
      }
    };
    const library = () => page.evaluate(async () => {
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      if (currentView === 'player') await closePlaybackDetail();
      currentView = 'library'; currentPlaylist = currentCollection = null;
      selectedTrackIds.clear(); multiSelectionMode = false; render(); await window.__frames();
    });

    await scenario(1, 'Lyrics hide every sidebar label and block its focus in both themes, then restore the sidebar on return', async () => {
      for (const theme of ['light', 'dark']) {
        await library();
        await page.evaluate(theme => { applyTheme(theme); sidebarCollapsed = false; syncSidebarState(); openPlaybackDetail(); }, theme);
        assert.deepEqual(await page.locator('.sidebar').evaluate(sidebar => ({ opacity: getComputedStyle(sidebar).opacity, inert: sidebar.inert, paintedText: [...sidebar.querySelectorAll('span, input, .playlist-list button')].filter(window.__painted).length })), { opacity: '0', inert: true, paintedText: 0 });
        assert.equal(await page.evaluate(() => { document.querySelector('#settings-button').focus(); return Boolean(document.activeElement.closest('.sidebar')); }), false);
        await page.screenshot({ path: path.join(output, `lyrics-${theme}.png`) });
        await page.evaluate(() => closePlaybackDetail());
        assert.equal(await page.locator('.sidebar').evaluate(node => !node.inert && window.__painted(node.querySelector('.nav-item > span:not(.glyph)'))), true);
      }
    });

    await scenario(2, 'Entering lyrics during sidebar transitions and interrupting page transitions cannot expose its descendants', async () => {
      await library();
      const samples = await page.evaluate(async () => {
        const samples = [];
        for (let cycle = 0; cycle < 3; cycle++) {
          document.querySelector('.menu-button').click(); openPlaybackDetail();
          for (let frame = 0; frame < 8; frame++) {
            await new Promise(requestAnimationFrame);
            samples.push([...document.querySelectorAll('.sidebar span, .sidebar input')].filter(window.__painted).length);
          }
          const closing = closePlaybackDetail(); openPlaybackDetail(); await closing;
          samples.push([...document.querySelectorAll('.sidebar span, .sidebar input')].filter(window.__painted).length);
          await closePlaybackDetail();
        }
        sidebarCollapsed = false; syncSidebarState(); return samples;
      });
      assert.ok(samples.every(count => count === 0), JSON.stringify(samples));
    });

    await scenario(3, 'A pending selection-bar reveal cannot override hiding or leak into lyrics and settings', async () => {
      for (const view of ['player', 'settings']) {
        await library();
        const state = await page.evaluate(async view => {
          selectedTrackIds.add('visibility'); multiSelectionMode = true; render();
          if (view === 'player') openPlaybackDetail(); else { currentView = 'settings'; render(); }
          await window.__frames();
          const bar = document.querySelector('#selection-actions');
          return { hidden: bar.hidden, visible: bar.classList.contains('visible'), inert: bar.inert, painted: window.__painted(bar) };
        }, view);
        assert.deepEqual(state, { hidden: true, visible: false, inert: true, painted: false });
      }
      await library();
      await page.evaluate(async () => { selectedTrackIds.add('visibility'); multiSelectionMode = true; render(); await window.__frames(); });
      assert.equal(await page.locator('#selection-actions').evaluate(node => !node.hidden && !node.inert && node.classList.contains('visible')), true);
      await page.evaluate(() => { selectedTrackIds.clear(); multiSelectionMode = false; syncSelectionState(); });
      assert.equal(await page.locator('#selection-actions').evaluate(node => node.inert), true);
      await page.waitForFunction(() => document.querySelector('#selection-actions').hidden);
    });

    await scenario(4, 'Page changes close custom and calendar popovers while a same-page render preserves an open menu', async () => {
      await library();
      await page.evaluate(() => { window.__menuResult = MedoMenus.show([{ label: '检查选项', value: 'chosen' }], document.querySelector('#library-sort')); });
      await page.evaluate(() => render()); assert.equal(await menus.count(), 1);
      await page.evaluate(() => { currentView = 'settings'; render(); });
      assert.equal(await menus.count(), 0); assert.equal(await page.evaluate(() => window.__menuResult), null);
      await page.locator('#listening-calendar-month').scrollIntoViewIfNeeded();
      await page.evaluate(async () => { await window.__frames(); document.querySelector('#listening-month-picker').showPopover(); });
      assert.equal(await page.locator('#listening-month-picker').evaluate(node => node.matches(':popover-open')), true);
      await page.evaluate(() => openPlaybackDetail());
      assert.equal(await page.locator('#listening-month-picker').evaluate(node => node.matches(':popover-open')), false);
      assert.equal(await page.locator(':popover-open').count(), 0);
    });

    await scenario(5, 'Closing a modal removes its dropdown; Escape and subsequent preset selection still work normally', async () => {
      await library(); await page.evaluate(() => { currentView = 'settings'; render(); });
      await page.locator('#open-sound-settings').click(); await page.locator('#sound-preset').click();
      assert.equal(await menus.count(), 1);
      await page.evaluate(() => document.querySelector('#sound-dialog').close());
      await page.waitForFunction(() => !document.querySelector('.glass-menu'));
      await page.locator('#open-sound-settings').click(); await page.locator('#sound-preset').click();
      await page.keyboard.press('Escape'); assert.equal(await menus.count(), 0);
      assert.equal(await page.locator('#sound-dialog').evaluate(node => node.open), true);
      await page.locator('#sound-preset').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
      assert.equal(await page.locator('#sound-preset').inputValue(), await page.locator('#sound-preset option').last().getAttribute('value'));
      await page.locator('#close-sound-settings').click();
    });

    await scenario(6, 'Hidden lyric panels and controls stay hidden, and normal sidebar and panel interactions restore correctly', async () => {
      await library(); await page.evaluate(() => openPlaybackDetail());
      await page.locator('#toggle-detail-track').click(); await page.locator('#toggle-detail-queue').click();
      await page.evaluate(async () => {
        await Promise.all([...document.querySelectorAll('.detail-layout > *')].flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => {})));
      });
      assert.equal(await page.locator('.detail-track, .detail-queue').evaluateAll(nodes => nodes.every(node => !window.__painted(node) && [...node.querySelectorAll('*')].every(child => !window.__painted(child)))), true);
      await page.locator('#toggle-detail-track').click(); await page.locator('#toggle-detail-queue').click();
      await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('.detail-layout > *')].flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => {}))); });
      assert.equal(await page.locator('.detail-track, .detail-queue').evaluateAll(nodes => nodes.every(window.__painted)), true);
      await page.evaluate(() => closePlaybackDetail());
      await page.evaluate(() => { currentView = 'settings'; render(); applyCloseBehavior('background'); });
      assert.equal(await page.locator('#tray-setting').evaluate(node => node.hidden && [...node.querySelectorAll('*')].every(child => !window.__painted(child))), true);
      await page.evaluate(() => { sidebarCollapsed = true; syncSidebarState(); });
      assert.equal(await page.locator('.playlist-list').evaluate(node => node.inert), true);
      await page.evaluate(async () => { sidebarCollapsed = false; syncSidebarState(); await window.__frames(); });
      assert.equal(await page.locator('.playlist-list').evaluate(node => !node.inert), true);
    });
  } finally { await app.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  report.passed = report.checks.filter(check => check.status === 'PASS').length;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, total: report.total, rendererErrors: report.rendererErrors }));
});
