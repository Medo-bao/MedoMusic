const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-playlist-regressions-'));
const music = path.join(directory, 'Music');
fs.mkdirSync(music);
const files = ['a.wav', 'b.wav'].map(name => path.join(music, name));
const wav = Buffer.alloc(44 + 16000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
files.forEach(file => fs.writeFileSync(file, wav));
fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'playlist-regression', version: '1.0.0', main: 'main.cjs' }));
fs.writeFileSync(path.join(directory, 'main.cjs'), `
const {app,globalShortcut}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(directory, 'Profile'))});
app.setPath('music',${JSON.stringify(music)});
globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.isRegistered=()=>true;
const extension=require.resolve(${JSON.stringify(path.join(root, 'src/myfirefly-extension.js'))});
require.cache[extension]={id:extension,filename:extension,loaded:true,exports:{startMyFireflyExtension:async()=>({stop:async()=>{}})}};
globalThis.fetch=async()=>({ok:true,json:async()=>({}),text:async()=>''});
require(${JSON.stringify(path.join(root, 'src/main.js'))});
`);

(async () => {
  const results = [], errors = [];
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ executablePath: path.join(root, '.electron-dist/electron.exe'), args: [directory], cwd: root, env });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof choosePlaylist === 'function' && localStorage.getItem('medo.initialScanComplete') === 'true');
    await page.evaluate(() => applyAutoUpdateSetting(false));
    const first = path.join(directory, 'first.zpl'), second = path.join(directory, 'second.zpl');
    for (const [file, song] of [[first, files[0]], [second, files[1]]]) {
      fs.writeFileSync(file, `<smil><head><title>Same Name</title></head><body><seq><media src="${song}"/></seq></body></smil>`);
    }
    const importFile = async file => {
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
      await page.evaluate(() => choosePlaylist());
    };

    // Case 1: explicit empty lists survive startup; legacy missing lists still migrate.
    await importFile(first);
    await page.evaluate(() => { selectedTrackIds = new Set(playlists[0].trackIds); multiSelectionMode = true; render(); });
    await page.locator('#remove-selected').click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('medo.playlists'))[0].trackIds), []);
    await page.reload();
    await page.waitForFunction(() => typeof migratePlaylistOrder === 'function');
    const empty = await page.evaluate(async () => {
      await migratePlaylistOrder();
      return { ids: playlists[0].trackIds, visible: visibleTracks().map(t => t.path) };
    });
    assert.deepEqual(empty, { ids: [], visible: [] });
    const migrated = await page.evaluate(async second => {
      playlists.push({ name: 'Legacy name', path: second });
      await migratePlaylistOrder();
      return { name: playlists[1].name, count: playlists[1].trackIds.length, empty: playlists[0].trackIds };
    }, second);
    assert.deepEqual(migrated, { name: 'Legacy name', count: 1, empty: [] });
    results.push({ case: 1, pass: true, name: 'Empty playlist restart and legacy migration', empty, migrated });

    // Case 2: import, reimport, saved duplicates and discovery keep names unambiguous.
    await page.evaluate(() => { playlists = []; tracks.forEach(t => t.playlists = []); currentPlaylist = null; });
    await importFile(first); await importFile(second); await importFile(second);
    const imported = await page.evaluate(() => ({ names: playlists.map(p => p.name), visible: visibleTracks().map(t => t.path), memberships: tracks.map(t => ({ path: t.path, names: t.playlists })) }));
    assert.deepEqual(imported.names, ['Same Name', 'Same Name (2)']);
    assert.deepEqual(imported.visible, [files[1]]);
    assert.deepEqual(imported.memberships.find(t => t.path === files[1]).names, ['Same Name (2)']);
    // Persist an actual old duplicate, then let startup repair it.
    await page.evaluate(() => { playlists[1].name = playlists[0].name; persist(); });
    await page.reload();
    await page.waitForFunction(() => typeof playlists !== 'undefined' && playlists[1]?.name === 'Same Name (2)');
    assert.deepEqual(await page.evaluate(() => playlists.map(p => p.trackIds.length)), [1, 1]);
    await page.evaluate(() => { currentPlaylist = playlists[1].name; currentView = 'library'; render(); });
    assert.deepEqual(await page.evaluate(() => visibleTracks().map(t => t.path)), [files[1]]);
    fs.copyFileSync(first, path.join(music, 'first.zpl'));
    fs.copyFileSync(second, path.join(music, 'second.zpl'));
    const discovered = await page.evaluate(async () => {
      playlists = []; currentPlaylist = null; tracks.forEach(t => t.playlists = []);
      localStorage.removeItem('medo.initialScanComplete');
      await initializeDefaultLibrary();
      return playlists.map(p => ({ name: p.name, count: p.trackIds.length }));
    });
    assert.deepEqual(discovered, [{ name: 'Same Name', count: 1 }, { name: 'Same Name (2)', count: 1 }]);
    assert.deepEqual(errors, []);
    results.push({ case: 2, pass: true, name: 'Unique imports, stable reimport, startup repair and discovery', imported, discovered });
    results.forEach(result => console.log(JSON.stringify(result)));
  } finally {
    if (app) await app.close();
    fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ version: require('../package.json').version, results, errors }, null, 2));
    console.log('Evidence: ' + path.join(directory, 'results.json'));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
