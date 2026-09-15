const assert = require("node:assert/strict");

module.exports = async function checkNavigationRestore(page) {
  await page.evaluate(() => {
    tracks = tracks.slice(0, 3);
    playlists = [{ name: "Remember me", trackIds: tracks.map(track => track.id) }];
    musicFolders = [];
    currentPlaylist = "Remember me";
    currentCollection = null;
    currentView = "library";
    currentSort = "songs";
    currentIndex = 0;
    render();
    openPlaybackDetail();
    persist();
  });
  await page.reload();
  await page.waitForSelector('#view-title', { state: 'attached' });
  assert.deepEqual(await page.evaluate(() => ({ view: currentView, playlist: currentPlaylist })),
    { view: "library", playlist: "Remember me" }, "Closing on lyrics must restore the underlying playlist");
  assert.equal(await page.locator('body').evaluate(body => body.classList.contains('playback-detail-active')), false);
  await page.evaluate(() => {
    currentView = "recent";
    currentPlaylist = null;
    render();
  });
  await page.reload();
  await page.waitForSelector('#view-title', { state: 'attached' });
  assert.equal(await page.evaluate(() => currentView), "recent");
  assert.equal(await page.locator('.nav-item[data-view="recent"]').getAttribute('class').then(value => value.includes('active')), true);
  await page.evaluate(() => {
    currentView = "library";
    currentPlaylist = "Removed playlist";
    playlists = [];
    persist();
  });
  await page.reload();
  await page.waitForSelector('#view-title', { state: 'attached' });
  assert.deepEqual(await page.evaluate(() => ({ view: currentView, playlist: currentPlaylist })),
    { view: "library", playlist: null }, "Missing playlists must fall back to the library");
  console.log("Navigation restore passed: playlist, lyrics exclusion, recent page and missing playlist fallback");
};
