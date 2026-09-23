const assert = require('node:assert/strict');
module.exports = async function(page) {
  await page.evaluate(() => {
    playlists = [{name:'One',trackIds:[]},{name:'Two',trackIds:[]}];
    renamePlaylist('One');
  });
  const input = page.locator('.playlist-name-dialog input');
  await input.fill('Two');
  await input.press('Enter');
  assert.match(await page.locator('#playlist-name-error').textContent(), /同名/);
  await input.fill('Renamed');
  await input.press('Enter');
  await page.locator('.playlist-name-dialog').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>playlists[0].name),'Renamed');
  await page.evaluate(()=>{renamePlaylist('Renamed');});
  await page.locator('.playlist-name-dialog input').press('Escape');
  await page.locator('.playlist-name-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('.playlist-name-dialog').count(),0);
  await page.evaluate(() => {
    audio.pause(); currentIndex=-1;
    currentView='library';currentPlaylist=null;currentCollection=null;currentSort='songs';query='';render();
    document.querySelector('main').scrollTop=0;
  });
  await page.waitForTimeout(100);
  const row = page.locator('.track-row').first();
  await row.locator('.track-title').hover();
  const box = await row.locator('.track-title').boundingBox();
  await page.mouse.down();
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>draggedTrackId),null,'Holding alone must not start drag');
  await page.mouse.move(box.x+box.width/2+9,box.y+box.height/2);
  assert.ok(await page.evaluate(()=>draggedTrackId),'Intentional movement after holding starts drag');
  await page.mouse.up();
  await page.evaluate(async () => {
    currentIndex=0;currentView='player';
    const track=tracks[0];
    lyricsCache.set(track.id,{synced:false,lines:[],error:'network'});
    renderLyrics(track);
  });
  assert.equal(await page.locator('.lyrics-empty strong').textContent(),'歌词加载失败');
  assert.equal(await page.locator('.lyric-retry').count(),1);
  await page.evaluate(() => {
    lyricsCache.set(tracks[0].id,{synced:false,lines:[]}); renderLyrics(tracks[0]);
  });
  assert.equal(await page.locator('.lyrics-empty strong').textContent(),'未找到歌词');
  console.log('Interaction upgrades passed: inline validation, keyboard cancellation, deliberate dragging and lyric error distinction');
};
