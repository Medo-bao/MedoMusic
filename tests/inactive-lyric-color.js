const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkInactiveLyricColor(page, { native = false } = {}) {
  const destination = path.join(__dirname, 'artifacts', 'appearance');
  fs.mkdirSync(destination, { recursive: true });
  const previous = await page.evaluate(() => ({ color: localStorage.getItem('medo.inactiveLyricColor'), theme: localStorage.getItem('medo.theme') }));
  const reports = [];
  const setup = () => page.evaluate(() => {
    applyInactiveLyricColor(null, true);
    const mediaPath = tracks[currentIndex]?.path;
    tracks = [{ id: 'inactive-color-song', path: mediaPath, title: '非播放歌词颜色', artist: '材质与颜色验证', album: '歌词显示', duration: 90, metadataLoaded: true }];
    currentIndex = 0; currentView = 'player'; currentPlaylist = null; currentCollection = null;
    playbackQueueIds = [tracks[0].id]; lyricInspectionActive = false; wordLyricsEnabled = true; lyricTranslationEnabled = true;
    const text = ['Walk into the quiet night', 'Let yesterday drift away', 'A new light fills the sky', 'Leave a note by the window', 'This melody is playing now', 'Hear an echo from afar', 'The city lights return', 'We have walked a long way', 'Another view awaits'];
    lyricsCache.set(tracks[0].id, { synced: true, networkOnly: true, level: 'word', lines: text.map((text, i) => ({ start: i * 8, text, words: [{ start: i * 8, end: (i + 1) * 8, text }] })) });
    lyricTranslations.set(tracks[0].id, text.map((_, i) => `中文翻译示例 ${i + 1}`));
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 34 });
    render(); updateNowPlaying(tracks[0]); updateLyricsAtTime();
    const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 820 });
    const ctx = canvas.getContext('2d');
    const sky = ctx.createLinearGradient(0, 0, 1280, 820);
    sky.addColorStop(0, '#173784'); sky.addColorStop(.45, '#b5b7da'); sky.addColorStop(1, '#414b9c');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 1280, 820);
    const light = ctx.createRadialGradient(720, 340, 20, 720, 340, 460);
    light.addColorStop(0, '#fff0eb'); light.addColorStop(.45, '#eee6edcc'); light.addColorStop(1, '#b5b7da00');
    ctx.fillStyle = light; ctx.fillRect(0, 0, 1280, 820);
    ctx.strokeStyle = '#eef4ff80'; ctx.lineWidth = 4;
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.moveTo(400 + i * 95, 0); ctx.bezierCurveTo(950, 230, 200, 430, 600 + i * 95, 820); ctx.stroke(); }
    window.__inactiveColorPicture = canvas.toDataURL();
  });
  const choose = async (value, save = true) => {
    await page.locator('#inactive-lyric-color').evaluate((input, { value, save }) => {
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
      if (save) input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { value, save });
  };
  const snapshot = () => page.evaluate(() => {
    const pause = document.createElement('style'); pause.textContent = '.lyric-line, .lyric-line * { transition: none !important; }'; document.head.append(pause);
    const read = node => {
      const s = getComputedStyle(node);
      return { color: s.color, opacity: Number(s.opacity), background: s.backgroundImage, shadow: s.textShadow, weight: s.fontWeight, transform: s.transform, filter: s.filter };
    };
    try {
      return { inactive: [...document.querySelectorAll('.lyric-line:not(.active):not(.selected)')].map(node => ({ classes: node.className, ...read(node), translation: read(node.querySelector('.lyric-translation')) })), active: [...document.querySelectorAll('.lyric-line.active, .lyric-line.active *')].map(read) };
    } finally { pause.remove(); }
  });
  const channels = line => line.color.match(/[\d.]+/g).map(Number);
  const strength = line => (channels(line)[3] ?? 1) * line.opacity;
  const assertCustomDepth = (custom, original) => {
    const nearestStrength = strength(original.find(line => line.classes.split(' ').includes('near')));
    for (let index = 0; index < custom.length; index++) {
      const actual = custom[index], baseline = original[index];
      assert.deepEqual([actual.classes, actual.transform, actual.filter], [baseline.classes, baseline.transform, baseline.filter]);
      assert.equal(channels(actual)[3] ?? 1, 1, 'Custom ink is opaque before the single distance fade');
      assert.ok(Math.abs(strength(actual) - strength(baseline) / nearestStrength) < .000001, `Relative lyric depth is preserved with the nearest lines at full ink: ${JSON.stringify({ actual, baseline, nearestStrength })}`);
    }
  };
  const hierarchy = lines => ({
    past: strength(lines.find(line => line.classes.includes('past') && !line.classes.includes('near'))),
    future: strength(lines.find(line => !line.classes.includes('past') && !line.classes.includes('near'))),
    near: strength(lines.find(line => line.classes.includes('near')))
  });
  // Stronger distant and played ink, with adjacent ink and row opacity retained.
  const assertAutomaticDepth = (lines, theme) => {
    for (const line of lines) {
      const near = line.classes.split(' ').includes('near');
      const past = line.classes.split(' ').includes('past');
      const alpha = near ? .68 : past ? (theme === 'light' ? .32 : .36) : (theme === 'light' ? .41 : .45);
      assert.equal(channels(line)[3], alpha, 'Distant and played lyric ink is stronger while adjacent ink stays unchanged');
      assert.equal(line.opacity, near ? .78 : past ? .42 : .55, 'Original distance opacity is preserved');
    }
  };
  const assertCustomInk = (lines, expected = [189, 91, 48]) => {
    for (const line of lines) {
      assert.deepEqual(channels(line).slice(0, 3), expected);
      assert.equal(channels(line)[3] ?? 1, 1, 'The selected RGB is not diluted at the color layer');
      assert.equal(line.translation.color, line.color, 'Translation inherits the same ink depth');
    }
  };
  try {
    await setup();
    for (const theme of ['light', 'dark']) {
      for (const mode of ['theme', 'image']) {
        await page.evaluate(({ theme, mode }) => {
          applyInactiveLyricColor(null, true); applyTheme(theme); document.documentElement.dataset.glassBackground = mode;
          const image = document.querySelector('#glass-background img');
          image.src = __inactiveColorPicture; image.hidden = mode !== 'image'; image.style.opacity = '.95'; image.style.filter = 'blur(0px)';
          document.querySelector('.glass-background-tint').hidden = mode === 'image';
          document.querySelector('.lyrics-stage').classList.remove('inspecting');
        }, { theme, mode });
        if (mode === 'image') await require('./custom-background-lyrics')(page);
        await page.locator('#lyrics-lines').evaluate(node => Promise.allSettled(node.getAnimations({ subtree: true }).filter(animation => animation.effect.getComputedTiming().iterations !== Infinity && animation.playState !== 'paused').map(animation => animation.finished)));
        const original = await snapshot();
        assert.equal(original.inactive.length, 8);
        assert.ok(original.inactive.every(line => line.shadow === 'none' && line.translation.shadow === 'none'), 'Inactive lyrics have no extra image-background outline');
        assert.equal(original.active[0].weight, '680');
        assert.ok(original.inactive.every(line => line.weight === '540'), 'Inactive lyrics retain their original weight');
        const past = original.inactive.find(line => line.classes.includes('past') && !line.classes.includes('near'));
        const near = original.inactive.find(line => line.classes.includes('near'));
        const future = original.inactive.find(line => !line.classes.includes('past') && !line.classes.includes('near'));
        assertAutomaticDepth(original.inactive, theme);
        for (const line of original.inactive) {
          assert.deepEqual(channels(line).slice(0, 3), theme === 'light' ? [24, 33, 38] : [255, 255, 255], 'Original default ink is restored');
        }
        assert.ok(strength(near) > strength(future) && strength(future) > strength(past));
        assert.ok(strength(near) < 1, 'Current lyric remains the strongest line');
        await page.screenshot({ path: path.join(destination, `${native ? 'native-' : ''}inactive-default-${mode}-${theme}.png`) });
        await choose('#000000', false);
        const black = await snapshot();
        assertCustomInk(black.inactive, [0, 0, 0]);
        assertCustomDepth(black.inactive, original.inactive);
        assert.ok(black.inactive.filter(line => line.classes.split(' ').includes('near')).every(line => line.opacity === 1), 'Selected black stays black on adjacent inactive lyrics');
        assert.deepEqual(black.active, original.active, 'Black custom ink leaves active lyrics unchanged');
        await page.screenshot({ path: path.join(destination, `${native ? 'native-' : ''}inactive-black-${mode}-${theme}.png`) });
        await choose('#bd5b30', false);
        assert.equal(await page.evaluate(() => localStorage.getItem('medo.inactiveLyricColor')), null, 'Input previews before change commits');
        const preview = await snapshot();
        assertCustomInk(preview.inactive);
        assertCustomDepth(preview.inactive, original.inactive);
        assert.deepEqual(preview.active, original.active, 'Active word lyrics and translation keep their appearance');
        await page.screenshot({ path: path.join(destination, `${native ? 'native-' : ''}inactive-custom-${mode}-${theme}.png`) });
        await choose('#bd5b30');
        assert.equal(await page.evaluate(() => localStorage.getItem('medo.inactiveLyricColor')), '#bd5b30');
        await page.mouse.move(4, 4);
        assert.equal(await page.locator('.lyric-line:hover').count(), 0, 'Measure manual browsing without pointer hover');
        await page.evaluate(() => { document.querySelector('.lyrics-stage').classList.add('inspecting'); applyInactiveLyricColor(null); });
        const originalInspection = await snapshot();
        await choose('#bd5b30', false);
        const inspection = await snapshot();
        assertCustomInk(inspection.inactive);
        assertCustomDepth(inspection.inactive, originalInspection.inactive);
        assert.deepEqual(inspection.active, originalInspection.active, 'Manual browsing preserves current word lyrics');
        const selected = await page.evaluate(() => {
          const line = document.querySelector('.lyric-line:not(.active)'); line.classList.add('selected');
          const color = getComputedStyle(line).color;
          applyInactiveLyricColor('#1c887d');
          const same = getComputedStyle(line).color === color; line.classList.remove('selected');
          applyInactiveLyricColor('#bd5b30'); document.querySelector('.lyrics-stage').classList.remove('inspecting'); return same;
        });
        assert.equal(selected, true, 'Selection feedback keeps its own color');
        await page.evaluate(opposite => applyTheme(opposite), theme === 'light' ? 'dark' : 'light');
        const switched = await snapshot();
        assertCustomInk(switched.inactive);
        await page.evaluate(() => applyInactiveLyricColor(null));
        const switchedDefault = await snapshot();
        assertAutomaticDepth(switchedDefault.inactive, theme === 'light' ? 'dark' : 'light');
        assertCustomDepth(switched.inactive, switchedDefault.inactive);
        await page.evaluate(() => applyInactiveLyricColor('#bd5b30'));
        await page.evaluate(theme => applyTheme(theme), theme);
        await page.emulateMedia({ contrast: 'more' });
        const customContrast = await snapshot();
        await page.evaluate(() => applyInactiveLyricColor(null));
        assert.deepEqual(await snapshot(), customContrast, 'High contrast retains its existing ink');
        await choose('#bd5b30');
        await page.emulateMedia({ contrast: 'no-preference' });
        reports.push({ theme, mode, defaultStrength: hierarchy(original.inactive), customStrength: hierarchy(preview.inactive), inspectionStrength: hierarchy(inspection.inactive), customColor: '#bd5b30', defaultPaletteRestored: true, distantAndPlayedDeepened: true, originalOpacityPreserved: true, customInkOpaque: true, blackNearMatchesPicker: true, extraOutlineRemoved: true, originalWeightsPreserved: true, depthPreserved: true, activePreserved: true, translationInherited: true, contrastPreserved: true });
      }
    }
    await page.evaluate(() => { applyTheme('light'); localStorage.setItem('medo.theme', 'light'); delete audio.currentTime; });
    await page.reload(); await page.waitForFunction(() => typeof applyInactiveLyricColor === 'function');
    assert.equal(await page.locator('#inactive-lyric-color').inputValue(), '#bd5b30', 'Custom color survives reload');
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-custom-lyric-color')), true);
    await page.evaluate(() => { currentView = 'settings'; render(); });
    await page.locator('#reset-inactive-lyric-color').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('medo.inactiveLyricColor')), null);
    assert.equal(await page.locator('#inactive-lyric-color').inputValue(), '#182126');
    await page.evaluate(() => applyTheme('dark'));
    assert.equal(await page.locator('#inactive-lyric-color').inputValue(), '#ffffff');
    await page.evaluate(() => applyTheme('system'));
    await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    assert.equal(await page.locator('#inactive-lyric-color').inputValue(), '#182126');
    await choose('#bd5b30');
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await page.locator('#inactive-lyric-color').inputValue(), '#bd5b30');
    await page.locator('#reset-inactive-lyric-color').click();
    await page.reload(); await page.waitForFunction(() => typeof applyInactiveLyricColor === 'function');
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-custom-lyric-color')), false, 'Reset survives reload');
    fs.writeFileSync(path.join(destination, `${native ? 'native-' : ''}inactive-lyric-color-checks.json`), JSON.stringify({ reports, preview: true, persisted: true, reset: true, systemTheme: true }, null, 2));
  } finally {
    await page.emulateMedia({ colorScheme: 'no-preference' });
    await page.evaluate(previous => {
      delete audio.currentTime;
      if (previous.theme === null) localStorage.removeItem('medo.theme'); else localStorage.setItem('medo.theme', previous.theme);
      applyTheme(previous.theme || 'system'); applyInactiveLyricColor(previous.color, true);
    }, previous);
  }
  console.log('Inactive lyric color passed: stronger distant and played ink, unchanged adjacent ink, exact custom RGB and black near lines, single fade with preserved depth ordering, original palette/weights, no extra outline, inspection, preview, save/reload, reset/reload, both themes/backgrounds, system theme, word lyrics, translation, selection and high contrast');
};
