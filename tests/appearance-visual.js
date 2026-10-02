const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkAppearance(page) {
  const destination = path.join(__dirname, 'artifacts', 'appearance');
  fs.mkdirSync(destination, { recursive: true });
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    const art = (first, second, label) => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 600, height: 600 });
      const ctx = canvas.getContext('2d');
      const sky = ctx.createLinearGradient(0, 0, 200, 600);
      sky.addColorStop(0, first); sky.addColorStop(1, second);
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 600, 600);
      ctx.fillStyle = '#fff8df'; ctx.beginPath(); ctx.arc(410, 185, 68, 0, Math.PI * 2); ctx.fill();
      for (let layer = 0; layer < 4; layer++) {
        ctx.fillStyle = ['#26374755', '#1c344977', '#192a4288', '#102033aa'][layer];
        ctx.beginPath(); ctx.moveTo(0, 290 + layer * 62);
        ctx.bezierCurveTo(160, 170 + layer * 72, 320, 400 + layer * 26, 600, 240 + layer * 62);
        ctx.lineTo(600, 600); ctx.lineTo(0, 600); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#fff'; ctx.font = '30px Segoe UI'; ctx.fillText(label, 42, 510);
      ctx.font = '14px Segoe UI'; ctx.fillText('MEDOMUSIC / APPEARANCE STUDY', 44, 542);
      return canvas.toDataURL();
    };
    window.__appearanceArt = [art('#ba6151', '#f4c49b', 'T I D E S'), art('#2d7f98', '#a6ddc8', 'N I G H T F A L L'), art('#e7e3d4', '#f6f4e8', 'D A Y L I G H T')];
    const names = ['潮汐之间', '晚风经过', '街灯与远方', '漫长的夏日来信', '浮光', '最后一班电车'];
    tracks = Array.from({ length: 30 }, (_, i) => ({
      id: `appearance-${i}`, title: names[i % names.length], artist: ['海岸来信', '夜航电台', '南方回声'][i % 3],
      album: ['潮汐之间', '夜色手记', '晴日'][i % 3], cover: __appearanceArt[i % 3],
      duration: 246 + i, format: 'FLAC', metadataLoaded: true, playlists: ['夜航精选']
    }));
    playlists = [{ name: '夜航精选', trackIds: tracks.map(track => track.id) }];
    favorites = new Set([tracks[0].id, tracks[3].id]);
    playbackQueueIds = tracks.slice(0, 8).map(track => track.id);
    currentIndex = 0; currentPlaylist = null; currentCollection = null; currentView = 'library';
    currentSort = 'songs'; librarySort = 'added'; query = ''; selectedTrackIds.clear();
    detailTrackVisible = true; detailQueueVisible = true; sidebarCollapsed = false; sidebarWidth = 220;
    document.querySelector('.app-shell').classList.remove('sidebar-collapsed');
    document.documentElement.style.setProperty('--sidebar-width', '220px');
    applyDisplayMode('thumbnail'); applyThemeColors('#2864ff', '#d934ff');
    lyricInspectionActive = false; activeLyricIndex = -1; wordLyricsEnabled = true;
    const lines = ['沿着海岸，等一阵晚风', '让城市的灯火慢慢亮起', '你说远方，还有新的风景', '我们走过潮汐之间', '把今天写进明天的信', '听见每一个平凡的瞬间', '都在夜色里轻轻回应'];
    for (const track of tracks) lyricsCache.set(track.id, { synced: true, networkOnly: true, level: 'word', lines: lines.map((text, i) => ({ start: i * 8, text, words: [{ start: i * 8, end: (i + 1) * 8, text }] })) });
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 28 });
    document.querySelector('#current-time').textContent = '0:28';
    document.querySelector('#duration').textContent = '4:06';
    progress.value = 28 / 246 * 100; updateRangeGradient(progress, 28 / 246);
    render(); updateNowPlaying(tracks[0]); updatePlayButtonState(true);
  });
  const settle = () => page.waitForTimeout(550);
  const shot = name => page.screenshot({ path: path.join(destination, `${name}.png`) });
  const assertLyricsVisible = async () => {
    assert.equal(await page.locator('.playback-detail').evaluate(el => getComputedStyle(el).opacity), '1', 'Real lyrics entry restores surface opacity after exit');
    assert.equal(await page.locator('.detail-layout').evaluate(el => getComputedStyle(el).opacity), '1');
    assert.ok(await page.locator('.lyric-line.active').isVisible());
  };
  await page.setViewportSize({ width: 1280, height: 820 });
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { applyTheme(theme); currentView = 'library'; currentPlaylist = null; render(); }, theme);
    await settle(); await shot(`library-${theme}`);
    assert.ok(await page.evaluate(() => document.querySelector('.track-list').getBoundingClientRect().top - document.querySelector('.pivot-bar').getBoundingClientRect().bottom >= 12), 'Tabs and list have breathing room instead of touching borders');
    for (const mode of ['thumbnail', 'compact']) {
      for (const count of [1, 3, 0]) {
        const geometry = await page.evaluate(({ mode, count }) => {
          applyDisplayMode(mode); currentView = 'favorites';
          favorites = new Set(tracks.slice(0, count).map(track => track.id)); render();
          const list = document.querySelector('#track-list');
          const bounds = list.getBoundingClientRect();
          const rows = [...list.querySelectorAll('.track-row')].map(row => row.getBoundingClientRect());
          return { height: bounds.height, shadow: getComputedStyle(list).boxShadow,
            left: rows.length ? rows[0].left - bounds.left : 0,
            right: rows.length ? bounds.right - rows[0].right : 0,
            top: rows.length ? rows[0].top - bounds.top : 0,
            bottom: rows.length ? bounds.bottom - rows.at(-1).bottom : 0 };
        }, { mode, count });
        if (count) {
          assert.equal(geometry.top, 0, `${mode}: no top inset`);
          assert.equal(geometry.bottom, geometry.top, `${mode}: matching bottom inset`);
          assert.equal(geometry.left, geometry.top, `${mode}: matching left inset`);
          assert.equal(geometry.right, geometry.top, `${mode}: matching right inset`);
        } else {
          assert.equal(geometry.height, 0, 'Empty song list occupies no frame height');
          assert.equal(geometry.shadow, 'none', 'Removing the last song leaves no outline');
          assert.equal(await page.locator('#playlist-meta').textContent(), '0 首歌曲 · 0 分钟');
        }
        assert.equal(await page.locator('#playlist-play-all').isDisabled(), count === 0);
      }
    }
    await settle(); await shot(`empty-playlist-${theme}`);
    await page.evaluate(() => {
      window.__savedAppearancePlaylists = playlists;
      playlists = [playlists[0], ...Array.from({length: 5}, (_, i) => ({name: i === 0 ? 'LongPlaylistName'.repeat(15) : `精选歌单 ${i}`, trackIds: i ? [tracks[i].id] : []}))];
      applyDisplayMode('thumbnail'); currentView = 'library'; currentPlaylist = playlists[1].name; render();
    });
    assert.equal(await page.locator('#track-list').evaluate(el => el.getBoundingClientRect().height), 0, 'Named empty playlist also has no residual frame');
    await page.evaluate(() => { currentPlaylist = null; currentView = 'playlists'; render(); });
    assert.equal(await page.locator('#track-list').evaluate(el => getComputedStyle(el).boxShadow), 'none', 'Playlist overview has no enclosing outline');
    assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Long playlist names cannot widen the overview');
    assert.equal(await page.locator('.playlist-overview-item strong').nth(1).evaluate(el => getComputedStyle(el).textOverflow), 'ellipsis');
    await settle(); await shot(`playlist-overview-${theme}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.playlist-overview-item').first().hover();
    assert.equal(await page.locator('.playlist-overview-cover').first().evaluate(el => getComputedStyle(el).transform), 'none', 'Reduced motion also disables overview hover movement');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { playlists = window.__savedAppearancePlaylists; favorites = new Set([tracks[0].id, tracks[3].id]); currentView = 'library'; });
    await page.evaluate(() => { currentPlaylist = '夜航精选'; render(); });
    await settle(); await shot(`playlist-${theme}`);
    assert.equal(await page.locator('.track-title').first().evaluate(el => getComputedStyle(el).fontWeight), '450', 'Song names keep their original weight');
    const glass = await page.evaluate(() => {
      const root = document.documentElement, material = root.dataset.windowMaterial;
      root.dataset.windowMaterial = 'blur';
      const read = () => ({ background: getComputedStyle(document.body).backgroundImage,
        sidebar: getComputedStyle(document.querySelector('.sidebar'), '::before').maskImage,
        list: getComputedStyle(document.querySelector('.track-list')).boxShadow });
      const original = read();
      applyThemeColors('#008060', '#de8030'); const custom = read();
      applyThemeColors('#2864ff', '#d934ff');
      if (material === undefined) delete root.dataset.windowMaterial; else root.dataset.windowMaterial = material;
      return { original, custom };
    });
    assert.notEqual(glass.original.background, glass.custom.background, 'Desktop glass follows the selected theme colors');
    assert.equal((glass.original.sidebar.match(/linear-gradient/g) || []).length, 2, 'Sidebar top and right edges share a masked material fade');
    assert.match(glass.original.list, /inset/, 'List has a boundary without changing virtual row geometry');
    const sharedMaterial = () => page.evaluate(() => ['body', '.window-titlebar', '.player'].map(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return [style.backgroundColor, style.backgroundImage, style.borderBottomWidth];
    }));
    await settle();
    const libraryMaterial = await sharedMaterial();
    assert.equal(libraryMaterial[1][2], '0px', 'Titlebar has no separator');
    assert.equal(libraryMaterial[1][0], 'rgba(0, 0, 0, 0)', 'Titlebar shares the body glass without an extra tint');
    assert.equal(libraryMaterial[1][1], 'none');
    assert.equal(await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().top), 38, 'Sidebar material starts below the titlebar');
    await page.evaluate(() => { openPlaybackDetail(); updateLyricsAtTime(); });
    await settle(); await shot(`lyrics-${theme}`);
    await assertLyricsVisible();
    assert.deepEqual(await sharedMaterial(), libraryMaterial, 'Lyrics and library share the background, titlebar and player material');
    assert.equal(await page.locator('.playback-detail').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.equal(await page.locator('.sidebar').evaluate(el => getComputedStyle(el).visibility), 'hidden');
    await page.evaluate(() => {
      viewBeforePlayer = 'library';
      // Generated bitmap fixtures exceed localStorage; exercise only the transition.
      const save = persist; persist = () => {};
      window.__materialExit = closePlaybackDetail().finally(() => { persist = save; });
    });
    assert.equal(await page.locator('.window-titlebar').evaluate(el => getComputedStyle(el).borderBottomWidth), '0px', 'No line flashes during exit');
    await page.evaluate(() => window.__materialExit);
    assert.deepEqual(await sharedMaterial(), libraryMaterial);
    await page.evaluate(() => { openPlaybackDetail(); updateLyricsAtTime(); });
    await settle();
    const lyricPalette = await page.evaluate(() => {
      const override = document.createElement('style');
      override.textContent = '.lyric-line, .lyric-line * { transition: none !important; }';
      document.head.append(override);
      const elements = [...document.querySelectorAll('.lyric-line, .lyric-karaoke-base, .lyric-karaoke-fill, .lyric-translation')];
      const read = () => elements.map(el => {
        const style = getComputedStyle(el);
        return [style.color, style.backgroundImage, style.opacity, style.filter];
      });
      const appearance = [...document.styleSheets].find(sheet => sheet.href?.endsWith('/appearance.css'));
      const current = read(); appearance.disabled = true;
      const original = read(); appearance.disabled = false; override.remove();
      return { current, original };
    });
    assert.ok(lyricPalette.current.length > 0);
    assert.deepEqual(lyricPalette.current, lyricPalette.original, 'Lyrics retain the original colors, karaoke gradients and opacity');
    const controls = await page.evaluate(() => {
      return ['desktop-lyrics-button', 'toggle-detail-track', 'toggle-detail-queue', 'lyric-translation-toggle'].map(id => {
        const button = document.getElementById(id), active = button.classList.contains('active');
        const transition = button.style.transition; button.style.transition = 'none';
        button.classList.add('active');
        const style = getComputedStyle(button);
        const result = { id, color: style.color, image: style.backgroundImage, clip: style.backgroundClip };
        button.classList.toggle('active', active);
        button.style.transition = transition;
        return result;
      });
    });
    for (const control of controls) {
      assert.equal(control.color, 'rgb(255, 255, 255)', `${control.id} keeps its original white active icon`);
      assert.match(control.image, /linear-gradient/);
      assert.equal(control.clip, 'border-box');
    }
    assert.equal(await page.locator('.detail-glow').first().evaluate(el => getComputedStyle(el).animationPlayState), 'running');
    await page.evaluate(() => updatePlayButtonState(false));
    assert.equal(await page.locator('.detail-glow').first().evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
    await page.evaluate(() => updatePlayButtonState(true));
    await page.evaluate(() => { currentView = 'settings'; render(); });
    await settle(); await shot(`settings-${theme}`);
    await page.locator('#open-sound-settings').click();
    await settle(); await shot(`sound-${theme}`);
    const select = await page.locator('#sound-preset').evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
    assert.notEqual(select.color, select.background);
    await page.locator('#close-sound-settings').click();
  }

  // Geometry checks use the actual supported minimum client area and largest lyrics.
  await page.setViewportSize({ width: 1060, height: 720 });
  await page.evaluate(() => {
    currentView = 'library'; currentPlaylist = '夜航精选';
    document.documentElement.style.setProperty('--sidebar-width', '360px'); render();
  });
  await settle();
  const playlistButtons = await page.locator('.playlist-actions').evaluate(el => {
    const container = el.getBoundingClientRect();
    return [...el.querySelectorAll('button:not([hidden])')].map(button => {
      const box = button.getBoundingClientRect();
      return { height: box.height, top: box.top, fits: box.left >= container.left && box.right <= container.right + 1 };
    });
  });
  assert.ok(playlistButtons.every(button => button.height === 38 && button.fits), 'Narrow hero keeps every action label on one line inside the card');
  assert.ok(new Set(playlistButtons.map(button => button.top)).size > 1, 'Actions wrap as whole buttons with a wide sidebar');
  await shot('playlist-actions-narrow');
  await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-width', '220px'));
  await page.setViewportSize({ width: 960, height: 640 });
  for (const mode of ['thumbnail', 'compact']) {
    await page.evaluate(mode => { applyDisplayMode(mode); currentView = 'library'; currentPlaylist = null; render(); }, mode);
    await settle();
    assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Minimum window ${mode} list fits`);
  }
  await page.locator('.menu-button').click();
  await settle();
  assert.ok(await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width <= 73), 'Collapsed sidebar remains usable');
  await shot('library-collapsed');
  await page.locator('.menu-button').click();
  await page.evaluate(() => { applyDetailLyricSize(38); openPlaybackDetail(); updateLyricsAtTime(); });
  await settle();
  const bounds = await page.evaluate(() => ['.detail-cover-frame', '.lyrics-stage', '.detail-queue', '.player-right', '.controls'].map(selector => {
    const r = document.querySelector(selector).getBoundingClientRect(); return { selector, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }));
  for (const box of bounds) assert.ok(box.left >= 0 && box.right <= 961 && box.top >= 0 && box.bottom <= 641, JSON.stringify(box));
  assert.ok(bounds[0].right <= bounds[1].left && bounds[1].right <= bounds[2].left, 'Lyrics columns must not overlap');
  await shot('lyrics-minimum-light');
  await assertLyricsVisible();
  for (const title of ['A very long song title '.repeat(6), '长歌曲名字测试'.repeat(18), 'LongUnbrokenTitle'.repeat(12)]) {
    const titleBounds = await page.evaluate(title => {
      const heading = document.querySelector('#detail-title'); heading.textContent = title;
      const box = heading.getBoundingClientRect(), style = getComputedStyle(heading);
      const track = document.querySelector('.detail-track').getBoundingClientRect();
      const layout = document.querySelector('.detail-layout').getBoundingClientRect();
      return { height: box.height, lineHeight: parseFloat(style.lineHeight), fits: box.left >= track.left && box.right <= track.right + 1, overflow: style.overflow,
        trackBottom: track.bottom, layoutBottom: layout.bottom };
    }, title);
    assert.ok(titleBounds.height <= 2 * titleBounds.lineHeight + 1, 'Long song title occupies at most two lines');
    assert.ok(titleBounds.fits && titleBounds.overflow === 'hidden', 'Clamped title remains clipped inside its column');
    assert.ok(titleBounds.trackBottom <= titleBounds.layoutBottom + 1, 'Artist, album and format remain inside the visible lyrics layout');
  }
  await shot('lyrics-long-title-minimum');
  await page.evaluate(() => { document.querySelector('#detail-title').textContent = tracks[0].title; });
  await page.evaluate(() => {
    const track = tracks[0]; window.__appearanceLyrics = lyricsCache.get(track.id);
    const text = 'We carry the light through the city, until the morning finds us';
    const original = __appearanceLyrics.lines;
    lyricsCache.set(track.id, { synced:true, networkOnly:true, level:'word', lines:original.map(line=>({...line,text,words:[{start:line.start,end:line.start+8,text}]})) });
    lyricTranslations.set(track.id, original.map(line=>line.text)); lyricTranslationEnabled = true;
    renderLyrics(track);
  });
  await settle(); await shot('lyrics-bilingual-minimum');
  assert.ok(await page.locator('.lyric-line.active').evaluate(el=>el.scrollWidth <= el.clientWidth + 1), 'Long bilingual lyrics wrap inside the stage');
  await page.evaluate(() => { lyricsCache.set(tracks[0].id,__appearanceLyrics); lyricTranslations.delete(tracks[0].id); renderLyrics(tracks[0]); });
  await page.evaluate(() => applyTheme('dark')); await settle(); await shot('lyrics-minimum-dark');
  await page.evaluate(() => { currentView = 'settings'; render(); document.querySelector('#sound-dialog').showModal(); });
  await settle();
  assert.ok(await page.locator('#sound-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Minimum window sound panel fits horizontally');
  await shot('sound-minimum');
  await page.locator('#close-sound-settings').click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => { applyDetailLyricSize(26); openPlaybackDetail(); });
  await settle(); await shot('lyrics-maximized');

  // The latest decode wins, and interrupted fades keep only two bitmap layers.
  const race = await page.evaluate(async () => {
    const originalDecode = HTMLImageElement.prototype.decode;
    let release;
    const slow = new Promise(resolve => { release = resolve; });
    const lateCover = __appearanceArt[2];
    HTMLImageElement.prototype.decode = async function() {
      if (this.src === lateCover) await slow;
      return originalDecode.call(this);
    };
    try {
      tracks[0].cover = lateCover;
      const late = applyCoverTheme(lateCover);
      tracks[0].cover = __appearanceArt[1];
      await applyCoverTheme(tracks[0].cover);
      const latest = document.documentElement.style.getPropertyValue('--cover-tone');
      release(); await late;
      const afterLate = document.documentElement.style.getPropertyValue('--cover-tone');
      for (const cover of [__appearanceArt[0], __appearanceArt[1], __appearanceArt[2], __appearanceArt[1]]) {
        tracks[0].cover = cover; await applyCoverTheme(cover);
      }
      return { latest, afterLate, layers: document.querySelector('#detail-backdrop').children.length,
        animations: document.querySelector('.detail-artwork-incoming').getAnimations().length };
    } finally { HTMLImageElement.prototype.decode = originalDecode; }
  });
  assert.equal(race.latest, race.afterLate, 'Late artwork must not replace the current atmosphere');
  assert.equal(race.layers, 2); assert.ok(race.animations <= 1);
  const continuity = await page.evaluate(async () => {
    const layer = document.querySelector('.detail-artwork-incoming');
    const readBlend = async () => {
      const c = Object.assign(document.createElement('canvas'), {width:96,height:96});
      const ctx = c.getContext('2d');
      for (const el of [document.querySelector('.detail-artwork-base'), layer]) {
        if (el.style.backgroundImage === 'none') continue;
        const image = new Image(); image.src = JSON.parse(el.style.backgroundImage.slice(4,-1)); await image.decode();
        ctx.globalAlpha = Number(getComputedStyle(el).opacity); ctx.drawImage(image,0,0,96,96);
      }
      return ctx.getImageData(0,0,96,96).data;
    };
    tracks[0].cover = __appearanceArt[0]; await applyCoverTheme(tracks[0].cover);
    const first = layer.getAnimations()[0]; first.pause(); first.currentTime = 220;
    const before = await readBlend();
    tracks[0].cover = __appearanceArt[2]; await applyCoverTheme(tracks[0].cover);
    const second = layer.getAnimations()[0]; second.pause(); second.currentTime = 0;
    const after = await readBlend();
    let maxDelta = 0; for (let i=0; i<before.length; i++) maxDelta = Math.max(maxDelta,Math.abs(before[i]-after[i]));
    second.play(); return maxDelta;
  });
  assert.ok(continuity <= 2, `Interrupted background must preserve the visible blend, delta=${continuity}`);
  await settle();
  await page.evaluate(async () => { tracks[0].cover = null; await applyCoverTheme(missingArt); });
  await settle();
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--cover-tone')), 'var(--ambient-fallback)');
  await shot('lyrics-no-cover');
  const fallbackChecks = await page.evaluate(async () => {
    const solid = color => {
      const c = Object.assign(document.createElement('canvas'), {width: 12, height: 12});
      const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 12, 12); return c.toDataURL();
    };
    const results = [];
    for (const color of ['#080808', '#fdfdfd', '#888888']) {
      tracks[0].cover = solid(color); await applyCoverTheme(tracks[0].cover);
      results.push(document.documentElement.style.getPropertyValue('--cover-tone'));
    }
    const originalDecode = HTMLImageElement.prototype.decode;
    const broken = solid('#ff00ff');
    HTMLImageElement.prototype.decode = function() { return this.src === broken ? Promise.reject(new Error('decode fixture')) : originalDecode.call(this); };
    try {
      tracks[0].cover = broken; await applyCoverTheme(broken);
      results.push(document.documentElement.style.getPropertyValue('--cover-tone'));
      results.push(document.querySelector('#detail-cover').getAttribute('src') === missingArt);
    } finally { HTMLImageElement.prototype.decode = originalDecode; }
    return results;
  });
  assert.deepEqual(fallbackChecks, Array(4).fill('var(--ambient-fallback)').concat(true));

  // Extreme user accents remain legible on both reading bases without changing settings.
  const ink = await page.evaluate(() => {
    const results = [];
    const luminance = rgb => rgb.map(n => n / 255).reduce((sum, c, i) => sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [.2126,.7152,.0722][i], 0);
    for (const themeName of ['light', 'dark']) for (const color of ['#ffff99', '#99ff99', '#000000', '#ffffff']) {
      applyTheme(themeName); applyThemeColors(color, color);
      const foreground = luminance(document.documentElement.style.getPropertyValue('--accent-readable').match(/[\d.]+/g).map(Number));
      const background = luminance(themeName === 'light' ? [237,241,247] : [27,34,48]);
      results.push({ themeName, color, ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05), saved: themePrimaryColor });
    }
    return results;
  });
  for (const value of ink) { assert.ok(value.ratio >= 5.2, JSON.stringify(value)); assert.equal(value.saved, value.color); }
  await page.evaluate(() => { applyThemeColors('#2864ff', '#d934ff'); applyTheme('light'); });
  await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' });
  assert.equal(await page.locator('.detail-glow').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  await shot('lyrics-reduced-motion-contrast');
  await page.emulateMedia({ reducedMotion: 'no-preference', contrast: 'no-preference' });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
  assert.equal(await page.locator('.detail-atmosphere').evaluate(el=>getComputedStyle(el).display),'none');
  assert.equal(await page.locator('.player').evaluate(el=>getComputedStyle(el).backdropFilter),'none');
  await session.send('Emulation.setEmulatedMedia', {features:[]});
  for (const scale of [1.25, 1.5]) {
    await session.send('Emulation.setDeviceMetricsOverride',{width:960,height:640,deviceScaleFactor:scale,mobile:false});
    assert.equal(await page.evaluate(()=>devicePixelRatio),scale);
    assert.ok(await page.locator('.lyrics-stage').evaluate(el=>el.getBoundingClientRect().right <= innerWidth));
  }
  await session.send('Emulation.clearDeviceMetricsOverride'); await session.detach();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.locator('.detail-glow').first().evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  assert.equal(await page.locator('.detail-artwork-incoming').evaluate(el => el.getAnimations().length), 0);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.evaluate(async () => {
    window.__windowVisibility(false);
    tracks[0].cover = __appearanceArt[0]; await applyCoverTheme(tracks[0].cover);
  });
  assert.equal(await page.locator('.detail-glow').first().evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  assert.equal(await page.locator('.detail-artwork-incoming').evaluate(el => el.getAnimations().length), 0, 'Native hidden windows do not start new fades');
  await page.evaluate(() => window.__windowVisibility(true));
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.evaluate(() => { applyDisplayMode('thumbnail'); applyTheme('dark'); updatePlayButtonState(false); });
  fs.writeFileSync(path.join(destination, 'checks.json'), JSON.stringify({ race, continuity, ink, bounds, fallbackChecks }, null, 2));
  console.log('Appearance passed: dark/light scenes, minimum/maximized geometry, latest-cover races, bounded fades, no-art fallback, accent contrast, pause/background/reduced motion');
};
