const assert = require("node:assert/strict");

module.exports = async function checkLongListScroll(page) {
  const results = await page.evaluate(async () => {
    const main = document.querySelector("main");
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const results = [];
    tracks = Array.from({ length: 10000 }, (_, index) => ({
      id: `long-${index}`, path: `E:\\Music\\${index}.mp3`, title: `Song ${index}`,
      artist: "Artist", album: "Album", duration: 180, format: "MP3",
      metadataLoaded: true, playlists: ["Long playlist"]
    }));
    playlists = [{ name: "Long playlist", trackIds: tracks.map(track => track.id) }];
    favorites = new Set(tracks.map(track => track.id));
    playbackQueueIds = tracks.map(track => track.id);
    currentIndex = -1;
    selectedTrackIds.clear();
    query = "";
    currentSort = "songs";
    currentCollection = null;
    librarySort = "added";
    for (const mode of ["thumbnail", "compact"]) {
      applyDisplayMode(mode);
      for (const view of ["library", "playlist", "favorites", "now"]) {
        currentView = view === "playlist" ? "library" : view;
        currentPlaylist = view === "playlist" ? "Long playlist" : null;
        main.scrollTop = 0;
        render();
        await settle();
        const height = main.scrollHeight;
        const expectedLast = visibleTracks().at(-1).id;
        for (const ratio of [.5, 1, .1, 1, 0]) {
          main.scrollTop = (main.scrollHeight - main.clientHeight) * ratio;
          await settle();
          const rows = [...trackList.querySelectorAll(".track-row")];
          results.push({ mode, view, ratio, height, after: main.scrollHeight, count: rows.length,
            lastReachable: ratio !== 1 || rows.some(row => row.dataset.trackId === expectedLast),
            overlaps: rows.some((row, index) => index > 0 && row.getBoundingClientRect().top < rows[index - 1].getBoundingClientRect().bottom - .5)
          });
        }
      }
    }
    // Search uses the same scroll geometry and can jump directly to its last result.
    query = "song 99";
    currentView = "library";
    main.scrollTop = 0;
    render();
    await settle();
    const height = main.scrollHeight;
    const expected = visibleTracks().at(-1).id;
    main.scrollTop = main.scrollHeight;
    await settle();
    results.push({ mode: "search", height, after: main.scrollHeight,
      count: trackList.children.length, lastReachable: [...trackList.children].some(row => row.dataset.trackId === expected) });
    query = "";
    currentIndex = 0;
    currentView = "player";
    render();
    await settle();
    const queue = document.querySelector("#detail-queue-list");
    const queueHeight = queue.scrollHeight;
    queue.scrollTop = queueHeight;
    await settle();
    results.push({ mode: "detail-queue", height: queueHeight, after: queue.scrollHeight,
      count: queue.querySelectorAll(".queue-item").length,
      lastReachable: [...queue.querySelectorAll(".queue-item")].some(row => row.dataset.trackId === tracks.at(-1).id) });
    return results;
  });
  for (const result of results) {
    assert.equal(result.after, result.height, JSON.stringify(result));
    assert.ok(result.count <= 50, JSON.stringify(result));
    assert.equal(result.lastReachable, true, JSON.stringify(result));
    assert.ok(!result.overlaps, JSON.stringify(result));
  }
  const queue = page.locator("#detail-queue-list");
  await queue.evaluate((element) => { element.scrollTop = 0; });
  await page.waitForTimeout(80);
  const first = queue.locator('.queue-item[data-track-id="long-0"]');
  await first.hover();
  await page.mouse.down();
  await page.waitForTimeout(360);
  assert.equal(await page.evaluate(() => draggedQueueTrackId), "long-0");
  await queue.evaluate((element) => { element.scrollTop = 6400; });
  await page.waitForTimeout(80);
  assert.equal(await first.count(), 1, "Scrolling must retain the row holding pointer capture");
  await page.mouse.up();
  assert.equal(await page.evaluate(() => draggedQueueTrackId), null);
  assert.equal(await page.locator(".queue-drag-preview").count(), 0);
  const scroll = await page.evaluate(() => {
    const element = document.querySelector("#detail-queue-list");
    const before = element.scrollTop;
    renderPlaybackDetail();
    return { before, after: element.scrollTop };
  });
  assert.ok(scroll.before > 0);
  assert.equal(scroll.after, scroll.before, "Refreshing the same track must preserve queue scroll position");
  console.log(`Long-list scroll passed: ${results.length} checks with 10,000 tracks; stable height and bounded rows`);
};
