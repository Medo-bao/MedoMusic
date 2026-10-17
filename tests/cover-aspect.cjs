const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-cover-aspect-'));
const profile = path.join(fixture, 'Profile');
const artifacts = path.join(__dirname, 'artifacts', 'cover-aspect');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function flacWithCover(png, width, height) {
  const info = Buffer.alloc(34);
  info.writeUInt16BE(4096, 0);
  info.writeUInt16BE(4096, 2);
  info.writeBigUInt64BE((44100n << 44n) | (1n << 41n) | (15n << 36n) | (44100n * 60n), 10);
  const mime = Buffer.from('image/png');
  const picture = Buffer.concat([
    uint32(3), uint32(mime.length), mime, uint32(0),
    uint32(width), uint32(height), uint32(32), uint32(0), uint32(png.length), png
  ]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(picture.length);
  header[0] = 0x86;
  return Buffer.concat([Buffer.from('fLaC'), Buffer.from([0, 0, 0, 34]), info, header, picture]);
}

async function launch() {
  const application = await _electron.launch({
    executablePath: path.join(root, '.electron-dist', 'electron.exe'),
    args: [fixture], cwd: root, env
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => typeof render === 'function' && typeof tracks !== 'undefined');
  await page.waitForFunction(() => localStorage.getItem('medo.initialScanComplete') === 'true');
  await page.evaluate(() => { applyAutoUpdateSetting(false); applyLyricTranslationSetting(false); wordLyricsEnabled = false; });
  return { application, page };
}

async function dimensions(page, url) {
  return page.evaluate(async url => {
    const image = new Image();
    image.src = url;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, url);
}

async function chooseFit(page, mode, label) {
  await page.locator('#cover-fit').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#cover-fit').click();
  await page.getByRole('menuitemradio').first().waitFor({ state:'visible' });
  assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['填充', '适应', '拉伸']);
  await page.getByRole('menuitemradio', { name:label, exact:true }).click();
  const selected = await page.evaluate(() => ({
    value:document.querySelector('#cover-fit').value,
    saved:localStorage.getItem('medo.coverFit'),
    fit:getComputedStyle(document.querySelector('#mini-cover')).objectFit
  }));
  assert.deepEqual(selected, { value:mode, saved:mode, fit:mode });
  assert.equal(await page.locator('#cover-fit').evaluate(select => getComputedStyle(select).outlineStyle), 'none', 'The themed control does not show a native blue focus outline');
}

async function checkSurfaces(page, track, name) {
  await page.evaluate(track => {
    audio.pause(); tracks = [track]; playlists = [{ name:'封面验证', trackIds:[track.id] }];
    favorites = new Set([track.id]); recent = []; musicFolders = [];
    currentIndex = 0; playbackQueueIds = [track.id]; currentPlaylist = null; currentCollection = null;
    currentView = 'library'; currentSort = 'songs'; query = ''; selectedTrackIds.clear();
    detailTrackVisible = true; detailQueueVisible = false;
    lyricsCache.set(track.id, { synced:true, networkOnly:true, lines:[{ start:0, text:'完整保留歌曲封面' }] });
    applyTheme('light'); render(); updateNowPlaying(track);
  }, track);
  const checkImage = async (selector, mode) => {
    const image = page.locator(selector).first();
    await image.waitFor({ state:'visible' });
    const actual = await image.evaluate(async image => {
      await image.decode();
      const style = getComputedStyle(image);
      return { fit:style.objectFit, position:style.objectPosition, size:[image.naturalWidth, image.naturalHeight] };
    });
    assert.equal(actual.fit, mode, `${selector} follows the selected cover mode`);
    assert.equal(actual.position, '50% 50%', `${selector} centers the cover`);
    assert.deepEqual(actual.size, track.coverSize);
  };
  for (const [mode, label] of [['cover', '填充'], ['contain', '适应'], ['fill', '拉伸']]) {
    await page.evaluate(() => { currentView = 'settings'; currentSort = 'songs'; currentPlaylist = null; render(); });
    await chooseFit(page, mode, label);
    if (name === 'landscape' && mode === 'cover') await page.screenshot({ path:path.join(artifacts, 'settings-cover-fit.png') });
    await page.evaluate(() => { currentView = 'library'; render(); });
    await checkImage('.row-cover', mode);
    await checkImage('#mini-cover', mode);
    await page.evaluate(() => { currentSort = 'albums'; render(); });
    await checkImage('.collection-cover', mode);
    await page.evaluate(() => { currentSort = 'songs'; currentPlaylist = '封面验证'; render(); });
    await checkImage('#playlist-cover', mode);
    await page.evaluate(() => { currentPlaylist = null; currentView = 'playlists'; render(); });
    await checkImage('.playlist-overview-cover', mode);
    await page.evaluate(() => { currentView = 'player'; render(); });
    await page.evaluate(() => applyCoverTheme(tracks[0].cover));
    await checkImage('#detail-cover', mode);
    if (['landscape', 'portrait'].includes(name)) await page.screenshot({ path:path.join(artifacts, `${name}-${mode}-player.png`) });
  }
  await page.evaluate(() => applyTheme('dark'));
  await checkImage('#detail-cover', 'fill');
}

async function run() {
  fs.mkdirSync(artifacts, { recursive:true });
  fs.mkdirSync(path.join(fixture, 'Music'));
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
    name:'medo-cover-aspect-test', version:require('../package.json').version, main:'bootstrap.cjs'
  }));
  fs.writeFileSync(path.join(fixture, 'bootstrap.cjs'), `
    const { app } = require('electron');
    app.setPath('userData', ${JSON.stringify(profile)});
    app.setPath('music', ${JSON.stringify(path.join(fixture, 'Music'))});
    require(${JSON.stringify(path.join(root, 'src/main.js'))});
  `);
  let application;
  let page;
  const cases = [];
  const errors = [];
  try {
    ({ application, page } = await launch());
    page.on('pageerror', error => errors.push(error.message));
    assert.equal(await page.locator('#cover-fit').inputValue(), 'cover', 'Fresh profiles default to fill without stretching');
    const shapes = [
      { name:'landscape', width:1600, height:800, expected:[800, 400] },
      { name:'portrait', width:800, height:1600, expected:[400, 800] },
      { name:'square', width:1200, height:1200, expected:[800, 800] },
      { name:'small-square', width:128, height:128, expected:[128, 128] }
    ];
    const images = await page.evaluate(shapes => shapes.map(shape => {
      const canvas = Object.assign(document.createElement('canvas'), { width:shape.width, height:shape.height });
      const context = canvas.getContext('2d');
      context.fillStyle = '#25466b'; context.fillRect(0, 0, canvas.width, canvas.height);
      const unit = Math.min(canvas.width, canvas.height);
      context.strokeStyle = '#ed9975'; context.lineWidth = unit * .06;
      context.strokeRect(unit * .05, unit * .05, canvas.width - unit * .1, canvas.height - unit * .1);
      context.fillStyle = '#e7cd77'; context.beginPath();
      context.arc(canvas.width / 2, canvas.height / 2, unit * .25, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#25466b'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.font = `bold ${unit * .08}px sans-serif`; context.fillText(shape.name, canvas.width / 2, canvas.height / 2);
      return canvas.toDataURL('image/png').split(',')[1];
    }), shapes);
    const collected = [];
    for (const [index, shape] of shapes.entries()) {
      const file = path.join(fixture, `${shape.name}.flac`);
      fs.writeFileSync(file, flacWithCover(Buffer.from(images[index], 'base64'), shape.width, shape.height));
      const metadata = await page.evaluate(file => window.medo.readMetadata(file), file);
      assert.ok(metadata?.cover, `${shape.name} embedded artwork is readable`);
      const size = await dimensions(page, metadata.cover);
      assert.deepEqual(size, shape.expected, `${shape.name} cache preserves proportions without upscaling`);
      const cached = await page.evaluate(file => window.medo.readMetadata(file), file);
      assert.equal(cached.cover, metadata.cover, 'Repeated reads reuse the proportional cover');
      const track = { ...metadata, id:file, path:file, title:shape.name, artist:'MedoMusic', album:shape.name,
        format:'FLAC', playlists:['封面验证'], metadataLoaded:true, coverSize:size };
      await checkSurfaces(page, track, shape.name);
      collected.push({ file, metadata, track });
      if (index === 0) cases.push('Landscape caches preserve 2:1 proportions; fill, fit and stretch settings update every cover surface');
      if (index === 1) cases.push('Portrait caches preserve 1:2 proportions; all three display modes follow the selected setting');
      if (index === 3) cases.push('Large square artwork scales down correctly and small square artwork keeps its source resolution');
    }

    const first = collected[0];
    const oldJpeg = await application.evaluate(({ nativeImage }, url) => {
      const fs = process.getBuiltinModule('fs');
      return nativeImage.createFromBuffer(fs.readFileSync(new URL(url).searchParams.get('path')))
        .resize({ width:800, height:800 }).toJPEG(100).toString('base64');
    }, first.metadata.cover);
    const oldCoverPath = path.join(profile, 'cover-cache', `${'a'.repeat(40)}.jpg`);
    const oldCover = `medo-media://local/cover?path=${encodeURIComponent(oldCoverPath)}`;
    await page.evaluate(({ track, oldCover }) => {
      tracks = [{ ...track, cover:oldCover, title:'保留自定义歌名', artist:'保留歌手', album:'保留专辑', userEditedMetadata:true }];
      favorites = new Set([track.id]); recent = [track.id];
      playlists = [{ name:'保留歌单', trackIds:[track.id] }];
      currentView = 'settings'; currentPlaylist = null; currentIndex = -1; musicFolders = [];
      localStorage.setItem('medo.initialScanComplete', 'true'); localStorage.setItem('medo.indexSchema', '2');
      persist(); localStorage.removeItem('medo.coverSizing');
    }, { track:first.track, oldCover });
    await application.close(); application = null;
    fs.mkdirSync(path.dirname(oldCoverPath), { recursive:true });
    fs.writeFileSync(oldCoverPath, Buffer.from(oldJpeg, 'base64'));
    const stat = fs.statSync(first.file);
    fs.writeFileSync(path.join(profile, 'metadata-cache.json'), JSON.stringify({
      [first.file]: { mtimeMs:stat.mtimeMs, size:stat.size, coverVersion:8, coverPath:oldCoverPath, value:{ ...first.metadata, cover:oldCover } }
    }));
    ({ application, page } = await launch());
    page.on('pageerror', error => errors.push(error.message));
    assert.equal(await page.locator('#cover-fit').inputValue(), 'fill', 'The selected stretch mode survives restarting the app');
    const migrated = await page.evaluate(() => ({ cover:tracks[0].cover, loaded:tracks[0].metadataLoaded, title:tracks[0].title }));
    assert.deepEqual(migrated, { cover:null, loaded:false, title:'保留自定义歌名' });
    await page.evaluate(() => loadMetadata(tracks[0]));
    const refreshed = await page.evaluate(() => ({ track:tracks[0], favorite:[...favorites], recent, playlists, marker:localStorage.getItem('medo.coverSizing') }));
    assert.notEqual(refreshed.track.cover, oldCover);
    assert.deepEqual(await dimensions(page, refreshed.track.cover), [800, 400]);
    assert.equal(refreshed.track.title, '保留自定义歌名');
    assert.equal(refreshed.track.artist, '保留歌手');
    assert.equal(refreshed.track.album, '保留专辑');
    assert.deepEqual(refreshed.favorite, [first.track.id]);
    assert.deepEqual(refreshed.recent, [first.track.id]);
    assert.deepEqual(refreshed.playlists, [{ name:'保留歌单', trackIds:[first.track.id] }]);
    assert.equal(refreshed.marker, 'proportional');
    await chooseFit(page, 'contain', '适应');
    await page.locator('#cover-fit').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cover-fit').inputValue(), 'contain', 'Escape leaves the chosen mode unchanged');
    await page.evaluate(() => persist());
    await page.reload();
    await page.waitForFunction(() => typeof tracks !== 'undefined' && tracks[0]?.metadataLoaded);
    assert.equal(await page.evaluate(() => tracks[0].cover), refreshed.track.cover, 'Fresh proportional covers are not invalidated on later launches');
    assert.equal(await page.locator('#cover-fit').inputValue(), 'contain', 'The fit setting survives reloading');
    assert.equal(await page.locator('#mini-cover').evaluate(image => getComputedStyle(image).objectFit), 'contain');
    cases.push('Saved display modes survive restart and reload; old covers refresh without losing edited music data');

    assert.equal(cases.length, 4);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(artifacts, 'checks.json'), JSON.stringify({ passed:true, caseCount:4, cases, errors }, null, 2));
    console.log('Cover aspect scenarios passed: 4/4');
  } finally {
    if (application) await application.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
