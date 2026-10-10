const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { startupBounds, fittedScale } = require('../src/window-scaling');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(__dirname, 'artifacts', 'scaling');
  fs.mkdirSync(artifacts, { recursive: true });
  const results = [];
  for (const dpi of [1, 1.5, 2]) {
    // Include both a 4K desktop and a short work area at each DPI.
    for (const physical of [{width:3840,height:2112},{width:1920,height:1008}]) {
      const area = {x:-640,y:40,width:Math.floor(physical.width / dpi),height:Math.floor(physical.height / dpi)};
      const bounds = startupBounds(area);
      assert.ok(bounds.x >= area.x && bounds.y >= area.y);
      assert.ok(bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
      assert.ok(bounds.minWidth <= bounds.width && bounds.minHeight <= bounds.height);
    }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-scale-'));
    const music = path.join(profile, 'Music');
    fs.mkdirSync(music);
    fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({name:'medo-scale-fixture',version:'1.6.2',main:'bootstrap.cjs'}));
    fs.writeFileSync(path.join(profile, 'bootstrap.cjs'), `
      const {app} = require('electron');
      app.setPath('userData', ${JSON.stringify(path.join(profile, 'Profile'))});
      app.setPath('music', ${JSON.stringify(music)});
      require(${JSON.stringify(path.join(root, 'src/main.js'))});
    `);
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    const application = await _electron.launch({
      executablePath:path.join(root, '.electron-dist/electron.exe'),
      args:[profile, `--force-device-scale-factor=${dpi}`], cwd:root, env
    });
    try {
      const page = await application.firstWindow();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.waitForFunction(() => typeof syncInterfaceScale === 'function' && localStorage.getItem('medo.initialScanComplete') === 'true');
      await page.evaluate(() => {
        localStorage.setItem('medo.autoCheckUpdates', 'false');
        tracks = [{id:'scale-song',title:'高分辨率界面检查',artist:'MedoMusic',album:'显示缩放',duration:180,metadataLoaded:true,playlists:[]}];
        currentIndex = 0; currentView = 'settings'; currentPlaylist = null; currentCollection = null; render();
      });
      for (const requested of [1, 2]) {
        await page.locator('#interface-scale').selectOption(String(requested));
        await page.waitForFunction(value => localStorage.getItem('medo.interfaceScale') === String(value), requested);
        const native = await application.evaluate(({BrowserWindow, screen}) => {
          const window = BrowserWindow.getAllWindows().find(window => window.interfaceScaling);
          const display = screen.getDisplayMatching(window.getBounds());
          return {bounds:window.getBounds(),content:window.getContentBounds(),area:display.workArea,dpi:display.scaleFactor,zoom:window.webContents.getZoomFactor()};
        });
        assert.ok(Math.abs(native.zoom - fittedScale(requested, native.content)) < .001);
        assert.ok(native.bounds.x >= native.area.x && native.bounds.y >= native.area.y);
        assert.ok(native.bounds.x + native.bounds.width <= native.area.x + native.area.width + 1);
        assert.ok(native.bounds.y + native.bounds.height <= native.area.y + native.area.height + 1);
        await page.waitForFunction(() => innerWidth >= 959 && innerHeight >= 639);
        const layout = await page.evaluate(() => {
          const player = document.querySelector('.player');
          const settings = document.querySelector('.settings-panel');
          return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,body:document.body.scrollWidth,
            player:player.scrollWidth - player.clientWidth,settings:settings.scrollWidth - settings.clientWidth};
        });
        assert.ok(layout.body <= layout.width + 1 && layout.player <= 1 && layout.settings <= 1, JSON.stringify(layout));
        assert.ok(Math.abs(layout.dpr - native.dpi * native.zoom) < .01);
        await page.locator('#open-sound-settings').click();
        await page.waitForFunction(() => document.querySelector('#sound-dialog').open);
        const dialog = await page.locator('#sound-dialog').boundingBox();
        assert.ok(dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= layout.width + 1 && dialog.y + dialog.height <= layout.height + 1);
        await page.locator('#close-sound-settings').click();
        const capture = await application.evaluate(async ({BrowserWindow}) => {
          const window = BrowserWindow.getAllWindows().find(window => window.interfaceScaling);
          const image = await window.webContents.capturePage();
          return {size:image.getSize(),png:image.toPNG().toString('base64')};
        });
        assert.ok(Math.abs(capture.size.width - native.content.width * native.dpi) <= 3);
        assert.ok(Math.abs(capture.size.height - native.content.height * native.dpi) <= 3);
        fs.writeFileSync(path.join(artifacts, `dpi-${dpi}-zoom-${requested}.png`), Buffer.from(capture.png, 'base64'));
        results.push({dpi,requested,native,layout});
        if (dpi === 1 && requested === 2) {
          await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window => window.interfaceScaling).maximize());
          await page.waitForFunction(() => Math.abs(devicePixelRatio - 2) < .001);
          const expanded = await page.evaluate(() => {
            const player = document.querySelector('.player');
            return {width:innerWidth,height:innerHeight,body:document.body.scrollWidth,overflow:player.scrollWidth - player.clientWidth};
          });
          assert.ok(expanded.width >= 959 && expanded.height >= 639 && expanded.body <= expanded.width + 1 && expanded.overflow <= 1);
          results.at(-1).full200Percent = expanded;
          await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window => window.interfaceScaling).unmaximize());
        }
      }
      // Native resize changes the fitted zoom, while the requested preference survives reload.
      await application.evaluate(({BrowserWindow}) => {
        const window = BrowserWindow.getAllWindows().find(window => window.interfaceScaling);
        const [width,height] = window.getMinimumSize();
        window.setBounds({width,height});
      });
      await page.waitForFunction(() => innerWidth >= 959 && innerWidth <= 962 && innerHeight >= 639);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#interface-scale').value === '2');
      const persisted = await page.evaluate(() => localStorage.getItem('medo.interfaceScale'));
      assert.equal(persisted, '2');
      await page.evaluate(async () => {
        await window.medo.setWindowScale(.8);
        window.medo.toggleLyricsWindow();
      });
      await page.waitForTimeout(250);
      const lyricZoom = await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window => !window.interfaceScaling)?.webContents.getZoomFactor());
      assert.equal(lyricZoom, 1, 'Main interface zoom must not resize desktop lyrics');
      assert.deepEqual(errors, []);
    } finally {
      await application.close();
    }
  }
  assert.equal(results.length, 6);
  fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  console.log('Native scaling passed: 6/6 DPI/zoom combinations, window fit, dialogs, persistence, resize and desktop lyric isolation');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
