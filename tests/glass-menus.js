const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function checkGlassMenus(page) {
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    tracks = [{ id:'menu-song', path:'E:/fixture.flac', title:'菜单验证', artist:'测试艺术家', album:'材质检查', duration:120, metadataLoaded:true, playlists:['原歌单'] }];
    playlists = [{ name:'原歌单', trackIds:['menu-song'] }, { name:'目标歌单', trackIds:[] }];
    currentIndex = 0; currentView = 'library'; currentPlaylist = null; currentCollection = null; currentSort='songs'; query='';
    selectedTrackIds.clear(); applyDisplayMode('thumbnail'); render();
  });
  const menus = page.locator('.glass-menu');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => applyTheme(theme), theme);
    await page.locator('.playlist-item[data-playlist-name="原歌单"]').click({ button:'right' });
    await menus.getByRole('menuitem', { name:'添加到', exact:true }).hover();
    await page.waitForFunction(() => document.querySelectorAll('.glass-menu').length === 2);
    await page.screenshot({path:path.join(__dirname,'artifacts/appearance',`playlist-submenu-${theme}.png`)});
    assert.equal(await menus.count(), 2);
    await menus.getByRole('menuitem', {name:'目标歌单',exact:true}).click();
    assert.deepEqual(await page.evaluate(() => playlists[1].trackIds), ['menu-song']);
    assert.equal(await menus.count(), 0);
  }
  await page.locator('.track-row').first().click({button:'right'});
  await menus.getByRole('menuitem',{name:'选择',exact:true}).click();
  assert.equal(await page.evaluate(() => selectedTrackIds.has('menu-song')),true);
  await page.evaluate(() => { selectedTrackIds.clear(); syncSelectionState(); });
  // Clamp the root and nested menus to the viewport and navigate the submenu with keys.
  await page.evaluate(() => { window.__menuResult = MedoMenus.playlist({favorites:false,playlists:['测试目标']},{clientX:innerWidth-2,clientY:innerHeight-2}); });
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  assert.equal(await menus.count(),2);
  for (const box of await menus.evaluateAll(nodes => nodes.map(node => {const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}))) {
    const size=page.viewportSize(); assert.ok(box.left>=0&&box.top>=0&&box.right<=size.width&&box.bottom<=size.height,JSON.stringify(box));
  }
  await page.keyboard.press('Escape'); assert.equal(await menus.count(),1);
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => window.__menuResult),null);
  await page.locator('.track-row').first().click({button:'right'});
  await page.locator('.page-header h1').click(); assert.equal(await menus.count(),0);
  for (const [name, selector] of [['编辑信息','.track-info-dialog'],['属性','.track-properties-dialog']]) {
    await page.locator('.track-row').first().click({button:'right'});
    await menus.getByRole('menuitem',{name,exact:true}).click();
    await page.locator(selector).waitFor({state:'visible'});
    assert.match(await page.locator(selector).evaluate(node=>getComputedStyle(node).backgroundColor), /0\.88/);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => { window.__menuResult=MedoMenus.chooseTarget([],{clientX:10,clientY:100}); });
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => window.__menuResult),null);
  await page.evaluate(() => { window.__menuResult=MedoMenus.playlist({favorites:true,playlists:[]},{clientX:10,clientY:100}); });
  assert.equal(await menus.getByRole('menuitem',{name:'添加到',exact:true}).isDisabled(),true);
  assert.equal(await menus.getByRole('menuitem',{name:'删除',exact:true}).count(),0);
  await page.keyboard.press('Escape');
  // Sorting still dispatches the select change; no native opaque dropdown remains.
  await page.locator('#library-sort').click();
  assert.equal(await menus.count(),1);
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  assert.equal(await menus.count(),0);
  await page.evaluate(() => { currentView='settings'; render(); });
  await page.locator('#open-sound-settings').click();
  await page.locator('#sound-preset').click();
  assert.equal(await menus.count(),1);
  assert.equal(await menus.evaluate(node => node.parentElement.id),'sound-dialog');
  await page.screenshot({path:path.join(__dirname,'artifacts/appearance','sound-preset-glass.png')});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sound-dialog').evaluate(node=>node.open),true,'Closing popup must keep its parent dialog open');
  await page.locator('#close-sound-settings').click();
  console.log('Glass menus passed: actual playlist/track actions, nested menus, viewport bounds, keyboard, outside dismissal, disabled items, sorting and modal select');
};
