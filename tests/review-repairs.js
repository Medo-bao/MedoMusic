const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async page => {
  const results = await page.evaluate(async () => {
    const reports = [];
    const api = { ...window.medo };
    const originalName = requestPlaylistName;
    const originalConfirm = confirmPlaylistAction;
    const originalPersist = persist;
    const originalRender = render;
    const folder = 'E:\\ReviewMusic';
    const make = (id, extra = {}) => ({ id, path: `${folder}\\${id}.mp3`, url: `file:///E:/ReviewMusic/${id}.mp3`,
      title: id, artist: 'Artist', album: 'Album', format: 'MP3', sourceDirectory: folder,
      playlists: [], createdAt: 200, modifiedAt: 100, fileSize: 100, addedAt: 50, metadataLoaded: true, ...extra });
    const a = make('a'), b = make('b', { createdAt: 100 }), external = make('external', { transient: true, sourceDirectory: undefined });
    const record = (name, passed, detail) => reports.push({ name, passed: Boolean(passed), detail });
    const seed = (items = [a], folders = [folder]) => {
      clearTimeout(persistTimer); clearTimeout(metadataRenderTimer);
      automaticFolderScans.forEach(clearTimeout); automaticFolderScans.clear(); folderScanTickets.clear();
      Object.assign(window.medo, api);
      requestPlaylistName = originalName; confirmPlaylistAction = originalConfirm;
      persist = originalPersist; render = originalRender;
      tracks = structuredClone(items); playlists = []; musicFolders = [...folders]; currentIndex = -1;
      playbackQueueIds = []; currentPlaylist = null; currentView = 'library'; currentCollection = null;
      currentSort = 'songs'; librarySort = 'added'; query = ''; favorites = new Set(); recent = [];
      selectedTrackIds.clear(); multiSelectionMode = false; metadataRequests.clear();
      render();
    };
    try {
      seed(); playlists = [{ name: 'Imported', trackIds: ['a'] }]; repairPlaylistMemberships(); removeFolder(folder);
      record('repair imported memberships and retain playlist song after directory removal', tracks.length === 1 && tracks[0].playlists.includes('Imported'));

      seed([external], []); playlists = [{ name: 'Target', trackIds: [] }]; currentView = 'now'; playbackQueueIds = ['external']; render();
      record('external single song button and model reject saving', document.querySelector('.row-queue').disabled && !addTracksToPlaylist(playlists[0], ['external']) && !playlists[0].trackIds.length);

      seed([a, external]); playbackQueueIds = ['a', 'external']; let prompts = 0; requestPlaylistName = async () => { prompts++; return 'Bad'; };
      await savePlaybackQueueAsPlaylist(); updatePlaylistSaveControls();
      record('mixed playback queue cannot be saved', !playlists.length && prompts === 0 && document.querySelector('#detail-save-queue').disabled);

      seed([a, b]); playbackQueueIds = ['b', 'a']; requestPlaylistName = async () => 'Saved';
      await savePlaybackQueueAsPlaylist(); tracks = loadJson('medo.tracks', []); playlists = loadJson('medo.playlists', []); repairPlaylistMemberships();
      record('imported songs save and restore with playlist order', playlists[0].trackIds.join() === 'b,a' && tracks.every(track => track.playlists.includes('Saved')));

      seed([a]); playbackQueueIds = ['a']; requestPlaylistName = async () => { tracks[0].transient = true; return 'Late'; };
      await savePlaybackQueueAsPlaylist(); record('song validity is rechecked after naming dialog', playlists.length === 0);

      seed([a, external]); currentView = 'now'; playbackQueueIds = ['a', 'external']; selectedTrackIds = new Set(playbackQueueIds); multiSelectionMode = true; render(); syncSelectionState();
      record('mixed bulk selection cannot be added to playlists', document.querySelector('#queue-selected').disabled);

      seed(); let resolveAuto; window.medo.scanFolder = () => new Promise(resolve => { resolveAuto = resolve; });
      scheduleAutomaticFolderScan(folder); await new Promise(resolve => setTimeout(resolve, 550)); removeFolder(folder);
      resolveAuto({ folder, tracks: [a] }); await new Promise(resolve => setTimeout(resolve, 0));
      record('watcher scan cannot resurrect removed directory', !musicFolders.length && !tracks.length);

      seed(); let resolveRescan; window.medo.scanFolder = () => new Promise(resolve => { resolveRescan = resolve; });
      const rescan = rescanFolder(folder); removeFolder(folder); applyFolderScan({ folder, tracks: [b] });
      resolveRescan({ folder, tracks: [a] }); await rescan;
      record('old scan cannot overwrite a readded directory', tracks.length === 1 && tracks[0].id === 'b');

      seed(); const pending = []; window.medo.scanFolder = () => new Promise(resolve => pending.push(resolve));
      const older = rescanFolder(folder), newer = rescanFolder(folder);
      pending[1]({ folder, tracks: [b] }); await newer; pending[0]({ folder, tracks: [a] }); await older;
      record('latest scan wins when results arrive out of order', tracks.length === 1 && tracks[0].id === 'b');

      seed(); let resolveRebuild; window.medo.clearMetadataCache = async () => {};
      window.medo.scanFolder = () => new Promise(resolve => { resolveRebuild = resolve; });
      const rebuild = rebuildMusicLibraryIndex(); await Promise.resolve(); removeFolder(folder);
      resolveRebuild({ folder, tracks: [a] }); await rebuild;
      record('index rebuild discards removed folder results', !musicFolders.length && !tracks.length);

      seed([], []); localStorage.removeItem('medo.initialScanComplete'); let discoveries = 0;
      window.medo.discoverDefaultLibrary = async () => ++discoveries === 1 ? null : { folder, tracks: [a], playlists: [] };
      await initializeDefaultLibrary(); const failedFlag = localStorage.getItem('medo.initialScanComplete'); await initializeDefaultLibrary();
      record('failed initial discovery remains retryable', failedFlag !== 'true' && discoveries === 2 && tracks.length === 1);

      seed([a, b]); reorderTrack('b', 'a'); const sorted = visibleTracks().map(track => track.id).join();
      tracks = loadJson('medo.tracks', []); librarySort = localStorage.getItem('medo.librarySort');
      record('manual order persists without rewriting dates', sorted === 'b,a' && visibleTracks().map(track => track.id).join() === sorted && tracks.find(track => track.id === 'a').createdAt === 200 && tracks.every(track => track.addedAt === 50));

      seed(); let writes = 0, renders = 0; persist = () => writes++; render = () => renders++;
      const changed = applyFolderScan({ folder, tracks: [structuredClone(a)] });
      record('unchanged scan skips storage and rendering', changed === false && writes === 0 && renders === 0);

      seed(); currentIndex = 0; originalPersist(); const touched = []; const setter = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { touched.push(key); return setter.call(this, key, value); };
      try { desiredVolume = .43; persistPlaybackState(); } finally { Storage.prototype.setItem = setter; }
      record('playback progress writes only playback state', touched.length === 1 && touched[0] === 'medo.playbackState');

      seed(); let reads = 0; const cover = 'medo-media://local/cover?path=missing'; tracks[0].cover = cover;
      window.medo.readMetadata = async () => { reads++; return { title: 'Recovered', cover: null }; };
      const image = document.createElement('img');
      Object.defineProperty(image, 'src', { value: cover, writable: true });
      document.body.append(image); image.dispatchEvent(new Event('error'));
      await new Promise(resolve => setTimeout(resolve, 0)); image.remove();
      record('evicted cover triggers metadata reload', reads === 1 && tracks[0].cover === null && tracks[0].title === 'Recovered');

      seed([external], []); playlists = [{ name: 'Target', trackIds: [] }];
      let rejected = false; try { createPlaylistFromExtension('External', ['external']); } catch { rejected = true; }
      window.medo.chooseFiles = async () => [{ ...external, transient: undefined }]; await chooseFiles();
      const added = addTracksToPlaylist(playlists[0], ['external']);
      record('extension rejects external songs; explicit import enables saving', rejected && added && !tracks[0].transient && playlists[0].trackIds[0] === 'external');
    } finally {
      Object.assign(window.medo, api); requestPlaylistName = originalName; confirmPlaylistAction = originalConfirm;
      persist = originalPersist; render = originalRender; clearTimeout(persistTimer); clearTimeout(metadataRenderTimer);
    }
    return reports;
  });
  fs.writeFileSync(path.join(__dirname, 'artifacts/review-repairs.json'), JSON.stringify(results, null, 2));
  assert.equal(results.length, 16);
  for (const result of results) assert.ok(result.passed, result.name);
  console.log('Review repair browser scenarios passed: 16/16');

  const performanceResults = await page.evaluate(() => {
    const results = [];
    const folder = 'E:\\Benchmark';
    for (const count of [500, 1000, 2000]) {
      tracks = Array.from({ length: count }, (_, index) => ({ id: String(index), path: `${folder}\\${index}.mp3`, title: String(index), sourceDirectory: folder,
        modifiedAt: 1, fileSize: 100, playlists: [], metadataLoaded: true }));
      musicFolders = [folder]; playlists = []; currentIndex = -1; playbackQueueIds = [];
      const incoming = structuredClone(tracks);
      const start = performance.now(); const changed = applyFolderScan({ folder, tracks: incoming }, false);
      results.push({ count, milliseconds: performance.now() - start, changed });
    }
    return results;
  });
  for (const result of performanceResults) assert.equal(result.changed, false);
  fs.writeFileSync(path.join(__dirname, 'artifacts/review-performance.json'), JSON.stringify(performanceResults, null, 2));
  console.log('Scan measurements:', JSON.stringify(performanceResults));
};
