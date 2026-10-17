const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const executablePath = path.join(root, '.electron-dist', 'electron.exe');
const artifacts = path.join(__dirname, 'artifacts', 'external-open');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-external-open-'));
const profile = path.join(fixture, 'Profile');
const music = path.join(fixture, 'Music');
const external = path.join(fixture, 'External');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const children = new Set();

async function waitFor(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error(message);
}

function openFiles(filePaths) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [fixture, ...filePaths], {
      cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']
    });
    children.add(child);
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Secondary process did not exit: ${stderr}`));
    }, 15000);
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timeout);
      children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`Secondary process exited with ${code}: ${stderr}`));
    });
  });
}

async function run() {
  fs.mkdirSync(artifacts, { recursive: true });
  fs.mkdirSync(music);
  fs.mkdirSync(external);
  const wave = Buffer.alloc(44 + 8000 * 60 * 2);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40);
  const files = Array.from({ length: 10 }, (_, index) => {
    const file = path.join(external, `外部 歌曲 ${index + 1}.wav`);
    fs.writeFileSync(file, wave);
    fs.writeFileSync(file.replace('.wav', '.lrc'), '[00:00.00]外部歌曲打开验证');
    return file;
  });
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
    name: 'medo-external-open-test', version: require('../package.json').version, main: 'bootstrap.cjs'
  }));
  fs.writeFileSync(path.join(fixture, 'bootstrap.cjs'), `
    const { app } = require('electron');
    app.setPath('userData', ${JSON.stringify(profile)});
    app.setPath('music', ${JSON.stringify(music)});
    global.externalOpenTest = { handoffs: [] };
    app.on('second-instance', (_event, args) => global.externalOpenTest.handoffs.push(args));
    const storeModule = require(${JSON.stringify(path.join(root, 'src/background-image-store.js'))});
    const createStore = storeModule.createBackgroundImageStore;
    storeModule.createBackgroundImageStore = (...args) => {
      const store = createStore(...args);
      const get = store.get;
      let first = true;
      store.get = async () => {
        if (first) {
          first = false;
          await new Promise(resolve => { global.externalOpenTest.releaseStartup = resolve; });
        }
        return get();
      };
      return store;
    };
    require(${JSON.stringify(path.join(root, 'src/main.js'))});
  `);

  let application;
  const cases = [];
  const errors = [];
  try {
    application = await _electron.launch({ executablePath, args: [fixture, files[0]], cwd: root, env });
    await waitFor(() => application.evaluate(() => typeof global.externalOpenTest.releaseStartup === 'function'), 'Startup did not reach the background-settings load');
    await Promise.all([openFiles([files[1]]), openFiles([files[2]])]);
    await waitFor(() => application.evaluate(() => global.externalOpenTest.handoffs.length === 2), 'Cold-start shell handoffs were not received');
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0, 'No window may open before its startup IPC handlers are ready');
    await application.evaluate(() => global.externalOpenTest.releaseStartup());
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof playbackQueueIds !== 'undefined' && playbackQueueIds.length === 3);
    await page.evaluate(() => { audio.muted = true; applyAutoUpdateSetting(false); applyLyricTranslationSetting(false); });

    const windowId = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.interfaceScaling).id);
    const snapshot = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.interfaceScaling).map(window => ({
      id: window.id, visible: window.isVisible(), minimized: window.isMinimized()
    })));
    const queue = () => page.evaluate(() => playbackQueueIds.map(id => tracks.find(track => track.id === id)?.path));
    const coldQueue = await queue();
    assert.equal(coldQueue[0], files[0], 'The first launch must remain the first queued song');
    assert.deepEqual([...coldQueue].sort(), files.slice(0, 3).sort());
    assert.equal((await snapshot()).length, 1);
    cases.push('Cold-start per-file launches wait for initialization, open one window and retain all selected songs');

    await openFiles([files[3], files[4], files[5], files[3]]);
    await page.waitForFunction(expected => playbackQueueIds.length === expected.length && playbackQueueIds.every((id, index) => tracks.find(track => track.id === id)?.path === expected[index]), files.slice(3, 6));
    assert.deepEqual(await queue(), files.slice(3, 6));
    assert.deepEqual((await snapshot()).map(window => window.id), [windowId]);
    cases.push('Multi-file opens reuse the running window and queue each selected path once');

    await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).hide(), windowId);
    assert.equal((await snapshot())[0].visible, false);
    await openFiles(files.slice(6, 8));
    await page.waitForFunction(expected => playbackQueueIds.length === expected.length && playbackQueueIds.every((id, index) => tracks.find(track => track.id === id)?.path === expected[index]), files.slice(6, 8));
    await waitFor(async () => (await snapshot())[0]?.visible, 'External open did not reveal the existing hidden window');
    assert.deepEqual((await snapshot()).map(window => window.id), [windowId]);
    cases.push('External songs reveal and reuse the hidden player');

    await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).minimize(), windowId);
    await waitFor(async () => (await snapshot())[0]?.minimized, 'Window did not minimize');
    await openFiles(files.slice(8, 10));
    await page.waitForFunction(expected => playbackQueueIds.length === expected.length && playbackQueueIds.every((id, index) => tracks.find(track => track.id === id)?.path === expected[index]), files.slice(8, 10));
    await waitFor(async () => {
      const windows = await snapshot();
      return windows.length === 1 && windows[0].id === windowId && windows[0].visible && !windows[0].minimized;
    }, 'External open did not restore the same minimized player');
    cases.push('External songs restore and reuse the minimized player');

    assert.equal(cases.length, 4);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(artifacts, 'checks.json'), JSON.stringify({ passed: true, caseCount: 4, cases, errors }, null, 2));
    console.log('External shell-open scenarios passed: 4/4');
  } finally {
    for (const child of children) child.kill();
    if (application) await application.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
