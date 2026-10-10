const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

async function run() {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-popup-material-'));
  const destination = path.join(__dirname, 'artifacts', 'appearance');
  fs.mkdirSync(destination, { recursive: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: process.env.MEDO_TEST_EXECUTABLE || path.join(root, '.electron-dist', 'electron.exe'),
    args: [...(process.env.MEDO_TEST_EXECUTABLE ? [] : [root]), `--user-data-dir=${profile}`], cwd: root, env
  });
  try {
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof glassBackground === 'object');
    await page.evaluate(() => glassBackground.ready);
    await page.waitForFunction(() => localStorage.getItem('medo.initialScanComplete') === 'true');
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), '1.6.2');
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
    await app.evaluate(({ BrowserWindow, screen }) => {
      global.popupTestWindow = BrowserWindow.getAllWindows()[0];
      const area = screen.getPrimaryDisplay().workArea;
      global.popupTestWindow.setBounds({ x: area.x + 40, y: area.y + 40, width: 1280, height: 820 });
      global.popupTestWindow.setAlwaysOnTop(true, 'screen-saver'); global.popupTestWindow.show(); global.popupTestWindow.focus();
    });
    const capture = async name => {
      await page.evaluate(() => Promise.allSettled(document.getAnimations().filter(animation => animation.effect.getComputedTiming().iterations !== Infinity).map(animation => animation.finished)));
      const png = await app.evaluate(async ({ desktopCapturer, screen }) => {
        global.popupTestWindow.moveTop();
        const rect = global.popupTestWindow.getBounds(), display = screen.getDisplayMatching(rect), scale = display.scaleFactor;
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } });
        const source = sources.find(source => source.display_id === String(display.id));
        if (!source) throw new Error('Display capture missing');
        return source.thumbnail.crop({ x: Math.round((rect.x - display.bounds.x) * scale), y: Math.round((rect.y - display.bounds.y) * scale), width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) }).toPNG().toString('base64');
      });
      fs.writeFileSync(path.join(destination, `native-${name}.png`), Buffer.from(png, 'base64'));
    };
    await require('./glass-menus')(page, { capture, native: true });
    assert.deepEqual(errors, []);
    console.log('Native popup material checks passed in isolated profile', profile);
  } finally {
    await app.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
