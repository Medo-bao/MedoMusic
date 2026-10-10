const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-library-ipc-'));
const music = path.join(directory, 'Music');
fs.mkdirSync(music);
fs.writeFileSync(path.join(music, 'Artist - Song.mp3'), 'metadata fixture');
const playlistPath = path.join(music, 'Review.zpl');
fs.writeFileSync(playlistPath, '<smil><head><title>Review</title></head><body><seq><media src="Artist - Song.mp3"/></seq></body></smil>');
fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'medo-ipc-fixture', version: '1.6.2', main: 'bootstrap.cjs' }));
fs.writeFileSync(path.join(directory, 'bootstrap.cjs'), `
const {app} = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'Profile'))});
app.setPath('music', ${JSON.stringify(music)});
require(${JSON.stringify(path.join(root, 'src/main.js'))});
`);

(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let application;
  const cases = [];
  try {
    application = await _electron.launch({ executablePath: path.join(root, '.electron-dist/electron.exe'), args: [directory], cwd: root, env });
    const page = await application.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof glassBackground === 'object');
    await page.evaluate(() => {
      localStorage.setItem('medo.initialScanComplete', 'true'); localStorage.setItem('medo.indexSchema', '2');
      localStorage.setItem('medo.autoCheckUpdates', 'false'); currentView = 'settings'; render();
    });
    await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, playlistPath);
    const chosen = await page.evaluate(() => window.medo.choosePlaylist());
    assert.deepEqual(chosen.tracks[0].playlists, ['Review']); assert.ok(chosen.tracks[0].modifiedAt > 0);
    cases.push('real choose-playlist IPC preserves membership and timestamps');
    const loaded = await page.evaluate(file => window.medo.loadPlaylist(file), playlistPath);
    assert.deepEqual(loaded.tracks[0].playlists, ['Review']);
    cases.push('real load-playlist IPC preserves membership');
    const discovered = await page.evaluate(() => window.medo.discoverDefaultLibrary());
    assert.equal(discovered.tracks.length, 1); assert.deepEqual(discovered.playlists[0].tracks[0].playlists, ['Review']);
    cases.push('real default discovery retains playlist membership');
    await application.evaluate(({ app }, folder) => app.setPath('music', folder), path.join(directory, 'Unavailable'));
    await page.evaluate(async () => { localStorage.removeItem('medo.initialScanComplete'); tracks = []; playlists = []; musicFolders = []; await initializeDefaultLibrary(); });
    assert.notEqual(await page.evaluate(() => localStorage.getItem('medo.initialScanComplete')), 'true');
    await application.evaluate(({ app }, folder) => app.setPath('music', folder), music);
    await page.evaluate(() => initializeDefaultLibrary());
    assert.equal(await page.evaluate(() => localStorage.getItem('medo.initialScanComplete')), 'true');
    assert.equal(await page.evaluate(() => playlists[0].trackIds.length), 1);
    cases.push('real failed discovery retries successfully through renderer and IPC');
    assert.deepEqual(errors, []); assert.equal(cases.length, 4);
    fs.writeFileSync(path.join(root, 'tests/artifacts/library-ipc.json'), JSON.stringify({ cases, errors, profile: directory }, null, 2));
    console.log('Real Electron IPC scenarios passed: 4/4');
  } finally { if (application) await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
