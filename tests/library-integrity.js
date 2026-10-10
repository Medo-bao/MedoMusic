const assert = require("node:assert/strict");

module.exports = async function checkLibraryIntegrity(page) {
  const reports = await page.evaluate(async () => {
    const reports = [];
    const folderA = "E:\\ReviewMusic\\AlbumA";
    const folderB = "E:\\ReviewMusic\\AlbumB";
    const make = (folder, name, extra = {}) => ({
      id: `${folder}\\${name}`, path: `${folder}\\${name}`,
      title: name, artist: "Artist", album: folder.split("\\").pop(),
      format: "MP3", playlists: [], metadataLoaded: true,
      sourceDirectory: folder, modifiedAt: 1, fileSize: 100, ...extra
    });
    const a = make(folderA, "01.mp3", { title: "First song" });
    const b = make(folderB, "01.mp3", { title: "Second song" });
    const api = { ...window.medo };
    const seed = (items, folders = []) => {
      clearTimeout(persistTimer); clearTimeout(metadataRenderTimer);
      clearTimeout(showActionFeedback.timer);
      Object.assign(window.medo, api);
      tracks = structuredClone(items); musicFolders = [...folders]; playlists = [];
      currentIndex = -1; playbackQueueIds = []; currentView = "library";
      currentPlaylist = null; currentCollection = null; currentSort = "songs"; query = "";
      favorites = new Set(); recent = []; selectedTrackIds.clear(); multiSelectionMode = false;
      metadataRequests.clear(); render(); persist();
    };
    const savedTracks = () => JSON.parse(localStorage.getItem("medo.tracks"));
    try {
      seed([a]);
      window.medo.chooseFiles = async () => [structuredClone(b)];
      await chooseFiles();
      reports.push({ name: "distinct same-name files", paths: tracks.map(t => t.path), titles: tracks.map(t => t.title) });

      seed([a]);
      const alternate = { ...a, path: a.path.toLowerCase().replaceAll("\\", "/"), id: a.id.toLowerCase() };
      window.medo.choosePlaylist = async () => ({ name: "Case playlist", path: "E:\\ReviewMusic\\case.zpl", tracks: [alternate] });
      await choosePlaylist();
      reports.push({ name: "same path keeps canonical playlist id", count: tracks.length, trackId: tracks[0].id, playlistId: playlists[0].trackIds[0], visible: visibleTracks().length });

      seed([a], [folderA]);
      currentIndex = 0; playbackQueueIds = [a.id]; favorites.add(a.id);
      window.medo.scanFolder = async () => null;
      await rebuildMusicLibraryIndex();
      reports.push({ name: "failed folder retains records and references", saved: savedTracks().map(t => t.id), current: tracks[currentIndex]?.id, queue: [...playbackQueueIds], favorite: favorites.has(a.id), feedback: document.querySelector("#action-feedback").textContent });

      seed([a, b], [folderA, folderB]);
      const added = make(folderA, "02.mp3");
      window.medo.scanFolder = async folder => folder === folderA ? { folder, tracks: [added] } : null;
      await rebuildMusicLibraryIndex();
      reports.push({ name: "partial scan replaces only successful folder", paths: savedTracks().map(t => t.path).sort() });

      seed([a], [folderA]);
      window.medo.scanFolder = async () => { throw new Error("folder unavailable"); };
      await rebuildMusicLibraryIndex();
      reports.push({ name: "rejected scan preserves data and releases button", saved: savedTracks().length, buttonDisabled: document.querySelector("#refresh-library").disabled });

      seed([a], [folderA]);
      window.medo.scanFolder = async folder => ({ folder, tracks: [] });
      await rebuildMusicLibraryIndex();
      reports.push({ name: "successful empty folder removes stale records", saved: savedTracks().length });

      const edited = { ...a, title: "Custom - title", artist: "Custom artist", album: "Custom album", userEditedMetadata: true };
      seed([edited], [folderA]);
      window.medo.scanFolder = async folder => ({ folder, tracks: [{ ...a, metadataLoaded: false }] });
      window.medo.readMetadata = async () => ({ title: "File title", artist: "File artist", album: "File album", duration: 245 });
      await rebuildMusicLibraryIndex();
      await loadMetadata(tracks[0]);
      reports.push({ name: "rebuild preserves edits while refreshing audio metadata", title: tracks[0].title, artist: tracks[0].artist, album: tracks[0].album, edited: tracks[0].userEditedMetadata, duration: tracks[0].duration });

      seed([edited], [folderA]);
      applyFolderScan({ folder: folderA, tracks: [{ ...a, modifiedAt: 2 }] });
      reports.push({ name: "incremental scan preserves edited title", title: tracks[0].title, artist: tracks[0].artist, album: tracks[0].album });

      const temporary = { ...a, sourceDirectory: undefined, transient: true };
      seed([temporary]);
      playbackQueueIds = [a.id]; favorites.add(a.id);
      window.medo.chooseFiles = async () => [{ ...a, sourceDirectory: undefined }];
      await chooseFiles();
      reports.push({ name: "file import promotes temporary track", count: tracks.length, visible: visibleTracks().length, saved: savedTracks().length, id: tracks[0].id, queue: [...playbackQueueIds], favorite: favorites.has(a.id), feedback: document.querySelector("#action-feedback").textContent });

      seed([temporary]);
      applyFolderScan({ folder: folderA, tracks: [{ ...a }] });
      reports.push({ name: "folder scan promotes temporary track", saved: savedTracks().length, folder: tracks[0].sourceDirectory, transient: Boolean(tracks[0].transient) });

      seed([temporary]);
      window.medo.choosePlaylist = async () => ({ name: "Promoted playlist", path: "E:\\ReviewMusic\\promoted.zpl", tracks: [{ ...a }] });
      await choosePlaylist();
      reports.push({ name: "playlist import promotes temporary track", saved: savedTracks().length, visible: visibleTracks().length, playlistId: playlists[0].trackIds[0] });

      // Keep one external-only track unsaved while persisting the imported one.
      seed([temporary, { ...b, sourceDirectory: undefined, transient: true }]);
      window.medo.chooseFiles = async () => [{ ...a, sourceDirectory: undefined }];
      await chooseFiles();
      persist();
    } finally {
      Object.assign(window.medo, api);
    }
    return reports;
  });

  const idA = "E:\\ReviewMusic\\AlbumA\\01.mp3";
  const idB = "E:\\ReviewMusic\\AlbumB\\01.mp3";
  assert.deepEqual(reports[0].paths, [idA, idB]);
  assert.deepEqual(reports[0].titles, ["First song", "Second song"]);
  assert.deepEqual([reports[1].count, reports[1].trackId, reports[1].playlistId, reports[1].visible], [1, idA, idA, 1]);
  assert.deepEqual([reports[2].saved, reports[2].current, reports[2].queue, reports[2].favorite], [[idA], idA, [idA], true]);
  assert.match(reports[2].feedback, /已保留原有歌曲记录/);
  assert.deepEqual(reports[3].paths, ["E:\\ReviewMusic\\AlbumA\\02.mp3", idB]);
  assert.deepEqual([reports[4].saved, reports[4].buttonDisabled], [1, false]);
  assert.equal(reports[5].saved, 0);
  assert.deepEqual([reports[6].title, reports[6].artist, reports[6].album, reports[6].edited, reports[6].duration], ["Custom - title", "Custom artist", "Custom album", true, 245]);
  assert.deepEqual([reports[7].title, reports[7].artist, reports[7].album], ["Custom - title", "Custom artist", "Custom album"]);
  assert.deepEqual([reports[8].count, reports[8].visible, reports[8].saved, reports[8].id, reports[8].queue, reports[8].favorite], [1, 1, 1, idA, [idA], true]);
  assert.match(reports[8].feedback, /已导入 1 首歌曲/);
  assert.deepEqual([reports[9].saved, reports[9].folder, reports[9].transient], [1, "E:\\ReviewMusic\\AlbumA", false]);
  assert.deepEqual([reports[10].saved, reports[10].visible, reports[10].playlistId], [1, 1, idA]);

  await page.reload();
  await page.waitForFunction(() => typeof window.__setMaximized === "function");
  const restored = await page.evaluate(() => ({ ids: tracks.map(t => t.id), visible: visibleTracks().length }));
  assert.deepEqual(restored, { ids: [idA], visible: 1 });
  reports.push({ name: "reload keeps imported track and excludes external-only track", ...restored });
  assert.equal(reports.length, 12);
  console.log(`Library integrity: ${reports.length}/12 scenarios passed`);
};
