const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkPopupMaterial(page, options = {}) {
  const destination = path.join(__dirname, 'artifacts', 'appearance');
  fs.mkdirSync(destination, { recursive: true });
  const capture = options.capture || (name => page.screenshot({ path: path.join(destination, `${name}.png`) }));
  const material = selector => page.locator(selector).first().evaluate(node => {
    const style = getComputedStyle(node);
    return Object.fromEntries(['backgroundColor', 'backgroundImage', 'color', 'borderTop', 'borderRadius', 'boxShadow', 'backdropFilter'].map(key => [key, style[key]]));
  });
  const evidence = {};
  const cdp = await page.context().newCDPSession(page);
  // A sharp, detailed image checks the popup's own frost independently of the
  // user's background blur slider. Restore the real layer after the test.
  await page.evaluate(() => {
    const root = document.documentElement, image = document.querySelector('#glass-background img');
    window.__popupBackground = { mode: root.dataset.glassBackground, src: image.getAttribute('src'), style: image.getAttribute('style'), hidden: image.hidden, tintHidden: document.querySelector('.glass-background-tint').hidden };
    const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 820 });
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 1280, 820);
    ['#e36f59', '#56a79c', '#465eb4', '#b883bd'].forEach((color, i) => gradient.addColorStop(i / 3, color));
    context.fillStyle = gradient; context.fillRect(0, 0, 1280, 820);
    context.font = '18px Segoe UI';
    for (let y = 24; y < 820; y += 32) {
      context.fillStyle = y % 64 ? '#ffffffc0' : '#172541c0';
      context.fillText('DETAILED BACKGROUND / 1234567890 / GLASS MATERIAL '.repeat(4), 0, y);
    }
    image.src = canvas.toDataURL(); image.hidden = false; image.style.opacity = '.95'; image.style.filter = 'blur(0px)';
    document.querySelector('.glass-background-tint').hidden = true; root.dataset.glassBackground = 'image';
    currentView = 'library'; currentPlaylist = null; query = ''; selectedTrackIds.clear(); render();
  });
  try {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { applyTheme(theme); selectedTrackIds.add('menu-song'); multiSelectionMode = true; syncSelectionState(); }, theme);
      await page.locator('#selection-actions').evaluate(node => Promise.allSettled(node.getAnimations().map(animation => animation.finished)));
      const reference = await material('#selection-actions');
      evidence[theme] = reference;
      const same = async selector => assert.deepEqual(await material(selector), reference, `${theme}: ${selector} shares popup material`);
      const toolbar = await page.locator('#selection-actions').boundingBox();
      await page.evaluate(anchor => { window.__menuResult = MedoMenus.playlist({ favorites: false, playlists: ['目标歌单'] }, anchor); }, { clientX: toolbar.x - 60, clientY: toolbar.y - 120 });
      await page.getByRole('menuitem', { name: '添加到', exact: true }).hover();
      assert.equal(await page.locator('.glass-menu').count(), 2);
      for (const node of await page.locator('.glass-menu').all()) assert.deepEqual(await node.evaluate(node => {
        const style = getComputedStyle(node);
        return Object.fromEntries(['backgroundColor', 'backgroundImage', 'color', 'borderTop', 'borderRadius', 'boxShadow', 'backdropFilter'].map(key => [key, style[key]]));
      }), reference);
      await capture(`popup-overlap-${theme}`);
      for (const feature of ['prefers-reduced-transparency', 'prefers-contrast']) {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: feature, value: feature === 'prefers-contrast' ? 'more' : 'reduce' }] });
        const solid = await material('#selection-actions');
        assert.equal(solid.backdropFilter, 'none'); assert.equal(solid.backgroundImage, 'none');
        assert.deepEqual(await material('.glass-menu'), solid, `${feature}: menu and toolbar use the same solid fallback`);
      }
      await cdp.send('Emulation.setEmulatedMedia', { features: [] });
      await page.locator('.glass-menu').first().locator('button').first().press('Escape');
      assert.equal(await page.locator('.glass-menu').count(), 0);
      await page.evaluate(() => { showActionFeedback('材质验证'); clearTimeout(showActionFeedback.timer); showPlaybackError(tracks[0], '测试提示'); clearTimeout(showPlaybackError.timer); });
      await same('#action-feedback'); await same('#playback-error-toast');
      await page.locator('#volume').hover(); await same('#volume-percent');
      await page.evaluate(() => { document.querySelector('#action-feedback').hidden = true; document.querySelector('#playback-error-toast').classList.remove('visible'); });
      await page.locator('#queue-selected').click(); await same('.playlist-picker-dialog');
      await page.keyboard.press('Escape');
      for (const [name, selector] of [['编辑信息', '.track-info-dialog'], ['属性', '.track-properties-dialog'], ['删除', '.playlist-name-dialog']]) {
        await page.locator('.track-row').first().click({ button: 'right' });
        await page.getByRole('menuitem', { name, exact: true }).click();
        await page.locator(selector).waitFor({ state: 'visible' }); await same(selector);
        if (name === '删除') {
          assert.equal(await page.locator(selector).getByRole('heading').textContent(), '删除歌曲');
          assert.equal(await page.locator(selector).getByRole('button', { name: '取消' }).evaluate(node => node === document.activeElement), true);
        }
        await capture(`popup-${name === '删除' ? 'confirm' : name === '属性' ? 'properties' : 'edit'}-${theme}`);
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => tracks.length), 1, 'Cancel keeps the song in the library');
      }
      await page.locator('.playlist-item[data-playlist-name="原歌单"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: '重命名', exact: true }).click(); await same('.playlist-name-dialog');
      await page.keyboard.press('Escape');
      await page.evaluate(() => { currentView = 'settings'; render(); });
      await page.locator('#open-sound-settings').click(); await same('#sound-dialog');
      await page.locator('#sound-preset').click(); await same('.glass-menu');
      await page.getByRole('menuitemradio', { name: '作者推荐', exact: true }).click({ button: 'right' }); await same('#sound-preset-menu');
      await page.getByRole('menuitem', { name: '重命名', exact: true }).click(); await same('#sound-rename-dialog');
      await capture(`popup-sound-rename-${theme}`); await page.locator('#sound-rename-cancel').click();
      assert.equal(await page.locator('#sound-dialog').evaluate(node => node.open), true);
      await page.locator('#sound-delete').click(); await same('#sound-delete-dialog');
      await page.locator('#sound-delete-cancel').click(); await page.locator('#close-sound-settings').click();
      await page.evaluate(() => { currentView = 'library'; currentPlaylist = null; render(); });
    }
    // Verify the custom confirmation's actual removal path as well as cancel.
    await page.locator('.track-row').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除', exact: true }).click();
    await page.locator('.playlist-name-dialog').getByRole('button', { name: '确认', exact: true }).click();
    await page.waitForFunction(() => tracks.length === 0);
    assert.equal(await page.evaluate(() => playlists.every(playlist => !playlist.trackIds.includes('menu-song'))), true);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    fs.writeFileSync(path.join(destination, `${options.native ? 'native-' : ''}popup-material-checks.json`), JSON.stringify({ materials: evidence, themes: ['light', 'dark'], customImage: 'sharp detailed canvas', checks: 'menu/toolbar overlap, submenus, dialogs, preset operations, feedback, volume tooltip, solid accessibility fallback, cancel and confirm removal' }, null, 2));
  } finally {
    await cdp.send('Emulation.setEmulatedMedia', { features: [] }); await cdp.detach();
    await page.evaluate(() => {
      const saved = window.__popupBackground, image = document.querySelector('#glass-background img');
      document.documentElement.dataset.glassBackground = saved.mode;
      if (saved.src === null) image.removeAttribute('src'); else image.setAttribute('src', saved.src);
      if (saved.style === null) image.removeAttribute('style'); else image.setAttribute('style', saved.style);
      image.hidden = saved.hidden; document.querySelector('.glass-background-tint').hidden = saved.tintHidden;
      delete window.__popupBackground;
    });
  }
  console.log('Popup materials passed: both themes, detailed image, overlapping menus/toolbars, modal controls, notifications, tooltip and accessibility fallback; custom removal cancel/confirm passed');
};
