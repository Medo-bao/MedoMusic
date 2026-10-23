// Renderer library. Loaded before renderer.js; shares its application state.

function removeRedundantMusicFolders() {
  const normalized = musicFolders.map((folder) => folder.replaceAll("/", "\\").replace(/[\\]+$/, ""));
  const filtered = normalized.filter((folder, index) => !normalized.some((parent, parentIndex) =>
    parentIndex !== index && folder.toLowerCase().startsWith(`${parent.toLowerCase()}\\`)
  ));
  if (filtered.length !== musicFolders.length) {
    musicFolders = filtered;
    persist();
    syncMusicFolderWatchers();
  }
}

function syncMusicFolderWatchers() {
  window.medo.setWatchedMusicFolders(musicFolders);
}

async function scanManagedFoldersIncrementally() {
  let changed = false;
  for (const folder of [...musicFolders]) {
    const result = await scanCurrentFolder(folder);
    if (result) changed = applyFolderScan(result, false) || changed;
  }
  if (changed) { persist(); render(); }
}

function beginFolderScan(folder) {
  const key = normalizedWindowsPath(folder);
  if (!musicFolders.some(item => normalizedWindowsPath(item) === key)) return null;
  const ticket = ++nextFolderScanTicket;
  folderScanTickets.set(key, ticket);
  return { key, ticket };
}

function isCurrentFolderScan(scan) {
  return scan && folderScanTickets.get(scan.key) === scan.ticket &&
    musicFolders.some(item => normalizedWindowsPath(item) === scan.key);
}

const folderScanTasks = new Map();

function scanCurrentFolder(folder, changed = false) {
  const key = normalizedWindowsPath(folder);
  const running = folderScanTasks.get(key);
  if (running) {
    if (!isCurrentFolderScan(running.scan)) return running.promise.then(() => scanCurrentFolder(folder, changed));
    if (changed) running.again = true;
    return running.promise;
  }
  const scan = beginFolderScan(folder);
  if (!scan) return Promise.resolve(null);
  const task = { scan, again: false, promise: null };
  task.promise = (async () => {
    let result;
    do {
      task.again = false;
      result = await window.medo.scanFolder(folder).catch(() => null);
    } while (task.again && isCurrentFolderScan(scan));
    return isCurrentFolderScan(scan) ? result : null;
  })().finally(() => { if (folderScanTasks.get(key) === task) folderScanTasks.delete(key); });
  folderScanTasks.set(key, task);
  return task.promise;
}

function scheduleAutomaticFolderScan(folder) {
  const normalized = normalizedWindowsPath(folder);
  const managedFolder = musicFolders.find(item => normalizedWindowsPath(item) === normalized);
  if (!managedFolder) return;
  clearTimeout(automaticFolderScans.get(normalized));
  automaticFolderScans.set(normalized, setTimeout(async () => {
    automaticFolderScans.delete(normalized);
    const result = await scanCurrentFolder(managedFolder, true);
    if (result) applyFolderScan(result);
  }, 500));
}

function tracksReferToSameFile(left, right) {
  const leftPath = normalizedWindowsPath(left?.path);
  const rightPath = normalizedWindowsPath(right?.path);
  if (leftPath && rightPath) return leftPath === rightPath;
  return Boolean(left?.id && left.id === right?.id);
}

function normalizedWindowsPath(value) {
  return String(value || "").replaceAll("/", "\\").replace(/[\\]+$/, "").toLocaleLowerCase();
}

function managedFolderForFile(filePath) {
  const normalizedFile = normalizedWindowsPath(filePath);
  return musicFolders.find((folder) => {
    const normalizedFolder = normalizedWindowsPath(folder);
    return normalizedFile === normalizedFolder || normalizedFile.startsWith(`${normalizedFolder}\\`);
  }) || null;
}

async function openExternalAudioFiles(filePaths) {
  const incomingTracks = await window.medo.getExternalTracks(filePaths);
  if (!incomingTracks?.length) return;

  // Temporary files from an earlier shell-open session never leak into the
  // next queue. Files under a managed folder are promoted into the library
  // immediately, even when that folder has not indexed them yet.
  const currentId = tracks[currentIndex]?.id;
  tracks = tracks.filter((track) => !track.transient);
  reconcileCurrentTrack(currentId);
  const queueIds = [];
  for (const incoming of incomingTracks) {
    let existing = tracks.find((track) => tracksReferToSameFile(track, incoming));
    const managedFolder = managedFolderForFile(incoming.path);
    if (existing) {
      existing.transient = false;
      if (managedFolder) existing.sourceDirectory = managedFolder;
      queueIds.push(existing.id);
      continue;
    }
    incoming.addedAt ||= Date.now();
    if (managedFolder) {
      incoming.sourceDirectory = managedFolder;
      incoming.transient = false;
    } else {
      incoming.transient = true;
    }
    tracks.push(incoming);
    queueIds.push(incoming.id);
  }

  playbackQueueIds = queueIds;
  playMode = "sequence";
  shuffleQueueSignature = "";
  shuffleRemainingIds = [];
  shuffleHistoryIds = [];
  shuffleHistoryIndex = -1;
  updatePlayModeButton();
  persist();
  const firstIndex = tracks.findIndex((track) => track.id === queueIds[0]);
  if (firstIndex >= 0) await playTrack(firstIndex, true);
}

function createTrackIndex(items) {
  const byPath = new Map();
  const byId = new Map();
  const add = track => {
    if (track.path) byPath.set(normalizedWindowsPath(track.path), track);
    if (track.id) byId.set(track.id, track);
  };
  items.forEach(add);
  return { add, find: track => track.path ? byPath.get(normalizedWindowsPath(track.path)) : byId.get(track.id) };
}

function mergeTrackBatch(newTracks) {
  const index = createTrackIndex(tracks);
  const merged = [];
  let changed = false;
  for (const incoming of newTracks) {
    const existing = index.find(incoming);
    if (!existing) {
      incoming.addedAt ||= Date.now();
      incoming.transient = false;
      tracks.push(incoming);
      index.add(incoming);
      merged.push(incoming);
      changed = true;
      continue;
    }
    const update = (key, value) => {
      if (existing[key] !== value) { existing[key] = value; changed = true; }
    };
    const audioFileChanged = (Number(existing.modifiedAt) || 0) !== (Number(incoming.modifiedAt) || 0) ||
      (Number(existing.fileSize) || 0) !== (Number(incoming.fileSize) || 0);
    update("path", incoming.path);
    update("url", incoming.url);
    for (const key of ["createdAt", "modifiedAt", "fileSize"]) {
      if (incoming[key] !== undefined) update(key, incoming[key]);
    }
    if (audioFileChanged) { update("metadataLoaded", false); update("cover", null); }
    if (!existing.userEditedMetadata) {
      if (!existing.artist && incoming.artist) update("artist", incoming.artist);
      if (incoming.artist && existing.title.includes(" - ")) update("title", incoming.title);
    }
    const names = new Set(existing.playlists || []);
    for (const name of incoming.playlists || []) {
      if (!names.has(name)) { names.add(name); changed = true; }
    }
    if (names.size !== (existing.playlists || []).length) existing.playlists = [...names];
    if (!existing.sourceDirectory && incoming.sourceDirectory) update("sourceDirectory", incoming.sourceDirectory);
    if (existing.transient) update("transient", false);
    merged.push(existing);
  }
  return { merged, changed };
}

function mergeTracks(newTracks, commit = true) {
  const result = mergeTrackBatch(newTracks);
  if (commit && result.changed) { persist(); render(); }
  return result.merged;
}

async function chooseFolder() {
  const result = await window.medo.chooseFolder();
  if (result) applyFolderScan(result);
}

async function chooseFiles() {
  const incoming = await window.medo.chooseFiles();
  if (!incoming.length) return;
  const previousCount = tracks.filter((track) => !track.transient).length;
  mergeTracks(incoming);
  const added = tracks.filter((track) => !track.transient).length - previousCount;
  showActionFeedback(`已导入 ${added} 首歌曲，重复跳过 ${incoming.length - added} 首`);
}

function reconcileCurrentTrack(currentId) {
  const validIds = new Set(tracks.map((track) => track.id));
  playbackQueueIds = playbackQueueIds.filter((id) => validIds.has(id));
  currentIndex = tracks.findIndex((track) => track.id === currentId);
  if (currentId && currentIndex < 0) {
    clearCurrentPlayback();
    if (currentView === "player") closePlaybackDetail();
  }
}

function applyFolderScan(result, commit = true) {
  if (!result?.folder || !Array.isArray(result.tracks)) return false;
  const currentId = tracks[currentIndex]?.id;
  const folderKey = normalizedWindowsPath(result.folder);
  const incomingIndex = createTrackIndex(result.tracks);
  const retainedIds = playlistTrackIds();
  const oldLength = tracks.length;
  tracks = tracks.filter(track => normalizedWindowsPath(track.sourceDirectory) !== folderKey ||
    incomingIndex.find(track) || retainedIds.has(track.id) || track.playlists?.length);
  let changed = oldLength !== tracks.length;
  if (!musicFolders.some(folder => normalizedWindowsPath(folder) === folderKey)) {
    musicFolders.push(result.folder);
    libraryFolderRevision += 1;
    syncMusicFolderWatchers();
    changed = true;
  }
  changed = mergeTrackBatch(result.tracks).changed || changed;
  if (changed) {
    reconcileCurrentTrack(currentId);
    if (commit) { persist(); render(); }
  }
  return changed;
}

async function rescanFolder(folder) {
  const result = await scanCurrentFolder(folder, true);
  if (result) applyFolderScan(result);
}

async function refreshMusicLibrary() {
  const button = document.querySelector("#refresh-library");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在刷新…";
  try {
    for (const folder of [...musicFolders]) {
      const result = await scanCurrentFolder(folder, true);
      if (result) applyFolderScan(result, false);
    }
    tracks.forEach((track) => {
      track.metadataLoaded = false;
      track.cover = null;
    });
    metadataRequests.clear();
    persist();
    render();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function rebuildMusicLibraryIndex() {
  const button = document.querySelector("#refresh-library");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在重建索引…";
  try {
    await window.medo.clearMetadataCache();
    const previousIndex = createTrackIndex(tracks);
    const manualOrder = new Map(tracks.map((track, index) => [track.id, index]));
    const batches = [];
    let failedFolderCount = 0;
    for (const folder of [...musicFolders]) {
      const result = await scanCurrentFolder(folder, true);
      const scan = { key: normalizedWindowsPath(folder), ticket: folderScanTickets.get(normalizedWindowsPath(folder)) };
      if (!isCurrentFolderScan(scan)) continue;
      if (!result) {
        failedFolderCount += 1;
        continue;
      }
      const rebuilt = result.tracks.map((incoming) => {
        const previous = previousIndex.find(incoming);
        return {
          ...incoming,
          id: previous?.id || incoming.id,
          addedAt: previous?.addedAt || Date.now(),
          playCount: previous?.playCount || 0,
          playlists: previous?.playlists || incoming.playlists || [],
          ...(previous?.userEditedMetadata ? {
            title: previous.title,
            artist: previous.artist,
            album: previous.album,
            userEditedMetadata: true
          } : {})
        };
      });
      batches.push({ scan, rebuilt });
    }
    const currentBatches = batches.filter(batch => isCurrentFolderScan(batch.scan));
    const rebuilt = currentBatches.flatMap(batch => batch.rebuilt);
    const scannedFolders = new Set(currentBatches.map(batch => batch.scan.key));
    const rebuiltIds = new Set(rebuilt.map(track => track.id));
    const retainedPlaylistIds = playlistTrackIds();
    // Only a successful scan can replace a folder's existing records.
    const retainedTracks = tracks.filter((track) =>
      !scannedFolders.has(normalizedWindowsPath(track.sourceDirectory)) ||
      (!rebuiltIds.has(track.id) && retainedPlaylistIds.has(track.id))
    ).map((track) => ({ ...track, metadataLoaded: false, cover: null }));
    const currentId = tracks[currentIndex]?.id;
    tracks = [...new Map([...retainedTracks, ...rebuilt].map((track) => [track.id, track])).values()];
    if (librarySort === "manual") tracks.sort((a, b) => (manualOrder.get(a.id) ?? Infinity) - (manualOrder.get(b.id) ?? Infinity));
    reconcileCurrentTrack(currentId);
    metadataRequests.clear();
    lyricsCache.clear();
    lyricsRequests.clear();
    persist();
    render();
    if (failedFolderCount) {
      showActionFeedback(`${failedFolderCount} 个音乐文件夹未能读取，已保留原有歌曲记录，请连接或恢复访问后重试`);
    }
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function removeFolder(folder) {
  const currentId = tracks[currentIndex]?.id;
  const folderKey = normalizedWindowsPath(folder);
  folderScanTickets.delete(folderKey);
  clearTimeout(automaticFolderScans.get(folderKey));
  automaticFolderScans.delete(folderKey);
  libraryFolderRevision += 1;
  musicFolders = musicFolders.filter(item => normalizedWindowsPath(item) !== folderKey);
  const retainedIds = playlistTrackIds();
  syncMusicFolderWatchers();
  tracks = tracks.filter((track) => {
    const fromFolder = normalizedWindowsPath(track.sourceDirectory) === folderKey;
    if (fromFolder && (retainedIds.has(track.id) || track.playlists?.length)) {
      delete track.sourceDirectory;
      return true;
    }
    return !fromFolder;
  });
  const validIds = new Set(tracks.map((track) => track.id));
  favorites = new Set([...favorites].filter((id) => validIds.has(id)));
  recent = recent.filter((id) => validIds.has(id));
  reconcileCurrentTrack(currentId);
  persist();
  render();
}

async function initializeDefaultLibrary() {
  if (localStorage.getItem("medo.initialScanComplete") === "true") {
    if (localStorage.getItem("medo.indexSchema") !== "2") {
      await rebuildMusicLibraryIndex();
      localStorage.setItem("medo.indexSchema", "2");
    }
    syncMusicFolderWatchers();
    await scanManagedFoldersIncrementally();
    return;
  }
  try {
    const revision = libraryFolderRevision;
    const discovered = await window.medo.discoverDefaultLibrary();
    if (!discovered || revision !== libraryFolderRevision) return;
    if (discovered.folder && !musicFolders.some((folder) => folder.toLowerCase() === discovered.folder.toLowerCase())) {
      musicFolders.push(discovered.folder);
    }
    mergeTracks(discovered.tracks || [], false);
    for (const imported of discovered.playlists || []) {
      const merged = mergeTracks(imported.tracks || [], false);
      const existing = playlists.find((playlist) => playlist.path === imported.path);
      const next = {
        name: imported.name,
        path: imported.path,
        trackIds: merged.map((track) => track.id)
      };
      if (existing) Object.assign(existing, next);
      else playlists.push(next);
    }
    repairPlaylistMemberships();
    localStorage.setItem("medo.initialScanComplete", "true");
    localStorage.setItem("medo.indexSchema", "2");
    persist();
    render();
    syncMusicFolderWatchers();
  } catch {
    // Leave the flag unset so a temporary first-run failure can retry next launch.
  }
}
