const assert = require('node:assert/strict');
module.exports = async function(page) {
  await page.evaluate(() => {
    tracks = Array.from({length:300}, (_,i) => ({id:`scroll-${i}`, title:`Song ${i}`, artist:'Artist', album:'Album', duration:180, metadataLoaded:true, playlists:['Long']}));
    playlists = [{name:'Long',trackIds:tracks.map(t=>t.id)}];
    currentView='library'; currentPlaylist=null; currentCollection=null; currentSort='songs'; query=''; selectedTrackIds.clear(); render();
    document.querySelector('main').scrollTop=1200;
    currentPlaylist='Long'; render();
  });
  assert.equal(await page.locator('main').evaluate(el=>el.scrollTop),0);
  await page.evaluate(() => {
    document.querySelector('main').scrollTop=2200;
    currentPlaylist=null; render();
  });
  assert.equal(await page.locator('main').evaluate(el=>el.scrollTop),1200);
  await page.evaluate(() => {currentPlaylist='Long'; render();});
  assert.equal(await page.locator('main').evaluate(el=>el.scrollTop),2200);
  await page.locator('#search-input').fill('no-such-song');
  await page.waitForTimeout(180);
  assert.equal(await page.locator('main').evaluate(el=>el.scrollTop),0);
  assert.equal(await page.locator('#empty-state h2').textContent(),'没有匹配的歌曲');
  await page.locator('.clear-empty-search').click();
  assert.equal(await page.evaluate(()=>query),'');
  await page.evaluate(() => {currentPlaylist=null; currentView='favorites'; favorites.clear(); render();});
  assert.equal(await page.locator('#empty-state h2').textContent(),'还没有喜欢的歌曲');
  await page.evaluate(() => {currentView='playlists'; render();});
  assert.equal(await page.locator('#empty-state').isVisible(),false);
  await page.evaluate(() => {playlists=[]; render();});
  assert.equal(await page.locator('#empty-state h2').textContent(),'还没有歌单');
  console.log('Page experience passed: independent scroll positions, search reset and contextual empty states');
};
