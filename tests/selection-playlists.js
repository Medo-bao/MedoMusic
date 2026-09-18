const assert = require('node:assert/strict');
module.exports = async function checkSelectionPlaylists(page) {
  await page.evaluate(() => {
    tracks = ['a', 'b', 'c'].map(id => ({id, title:id, artist:'Artist', album:'Album', duration:180, metadataLoaded:true, playlists:['Source']}));
    playlists = [{name:'Source',trackIds:['a','b','c']},{name:'Target <safe>',trackIds:['a']}];
    currentView = 'library'; currentPlaylist = 'Source'; currentCollection = null; query = ''; currentSort = 'songs';
    playbackQueueIds = ['c']; currentIndex = 2;
    selectedTrackIds = new Set(['a','b']); multiSelectionMode = true; render();
  });
  const rowA = page.locator('.track-row[data-track-id="a"] .row-leading');
  const rowB = page.locator('.track-row[data-track-id="b"] .row-leading');
  await rowA.click();
  assert.deepEqual(await page.evaluate(() => ({selected:[...selectedTrackIds], mode:multiSelectionMode})), {selected:['b'], mode:true});
  assert.equal(await page.locator('#selection-actions').isVisible(), true, 'Selection toolbar must remain visible while one song is selected');
  assert.equal(
    await page.locator('#append-selected .glyph').textContent(),
    await page.locator('#queue-selected .glyph').textContent(),
    'Add-to-queue and add-to-playlist commands must use the same plus icon'
  );
  await rowB.click();
  assert.deepEqual(await page.evaluate(() => ({size:selectedTrackIds.size, mode:multiSelectionMode})), {size:0, mode:false}, 'Deselecting the final song must leave selection mode immediately');
  assert.equal(await page.locator('#selection-actions').evaluate(element => element.classList.contains('visible')), false, 'Selection toolbar must begin leaving immediately');
  await page.waitForTimeout(230);
  assert.equal(await page.locator('#selection-actions').isVisible(), false, 'Selection toolbar must hide after its exit animation');
  await page.evaluate(() => {multiSelectionMode = false; selectedTrackIds.clear(); render();});
  const playsBefore = await page.evaluate(() => window.__mediaPlayCalls);
  await rowA.click();
  assert.deepEqual(await page.evaluate(() => ({selected:[...selectedTrackIds], mode:multiSelectionMode})), {selected:['a'], mode:true}, 'The first checkbox click must select the song and enter selection mode');
  assert.equal(await page.locator('#selection-actions').isVisible(), true);
  await rowA.click();
  assert.deepEqual(await page.evaluate(() => ({size:selectedTrackIds.size, mode:multiSelectionMode})), {size:0, mode:false});
  await rowA.dispatchEvent('dblclick', {bubbles:true});
  assert.equal(await page.evaluate(() => selectedTrackIds.size), 0);
  assert.equal(await page.evaluate(() => window.__mediaPlayCalls), playsBefore, 'Checkbox clicks must never play a song');
  await page.evaluate(() => { selectedTrackIds = new Set(['a','b']); multiSelectionMode = true; render(); });
  await page.locator('#append-selected').click();
  assert.deepEqual(await page.evaluate(() => playbackQueueIds), ['c','a','b']);
  await page.evaluate(() => {playbackQueueIds = ['a','c','b']; selectedTrackIds = new Set(['a','c']); multiSelectionMode = true; render();});
  await page.locator('#next-selected').click();
  assert.deepEqual(await page.evaluate(() => playbackQueueIds), ['c','a','b'], 'Insert next while retaining the current song');
  await page.evaluate(() => {playbackQueueIds = ['c']; selectedTrackIds = new Set(['a','b']); multiSelectionMode = true; render();});
  await page.locator('#queue-selected').click();
  await page.locator('.playlist-picker-dialog footer button').click();
  assert.equal(await page.evaluate(() => selectedTrackIds.size),2);
  await page.locator('#queue-selected').click();
  await page.locator('.playlist-picker-options button').filter({hasText:'Target <safe>'}).click();
  assert.deepEqual(await page.evaluate(() => playlists[1].trackIds),['a','b']);
  assert.deepEqual(await page.evaluate(() => playbackQueueIds),['c']);
  await page.evaluate(() => { selectedTrackIds = new Set(['a','b']); multiSelectionMode = true; render(); });
  await page.setViewportSize({width:960,height:720});
  await page.waitForTimeout(250);
  const toolbar = await page.locator('#selection-actions').evaluate(el => ({width:el.clientWidth,scroll:el.scrollWidth}));
  assert.ok(toolbar.scroll <= toolbar.width + 1, 'Selection actions must fit a narrow window');
  await page.screenshot({path:require('node:path').join(__dirname,'artifacts','selection-toolbar.png')});
  await page.locator('#remove-selected').click();
  assert.deepEqual(await page.evaluate(() => ({source:playlists[0].trackIds,target:playlists[1].trackIds,tracks:tracks.length,queue:playbackQueueIds,playing:tracks[currentIndex].id})),
    {source:['c'],target:['a','b'],tracks:3,queue:['c'],playing:'c'});
  await page.evaluate(() => {currentPlaylist = null; selectedTrackIds = new Set(['a']); render();});
  assert.equal(await page.locator('#remove-selected').isVisible(),false);
  await page.setViewportSize({width:1280,height:820});
  console.log('Selection playlists passed: picker, cancel, deduplication, scoped removal and narrow toolbar');
};
