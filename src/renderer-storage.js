// Renderer storage. Loaded before renderer.js; shares its application state.

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  if (localStorage.getItem(key) !== String(value)) localStorage.setItem(key, value);
}

function persist() {
  persistNavigation();
  const storedTracks = tracks
    .filter((track) => !track.transient)
    .map(({ transient, ...track }) => track);
  writeStoredValue("medo.tracks", JSON.stringify(storedTracks));
  writeStoredValue("medo.playlists", JSON.stringify(playlists));
  writeStoredValue("medo.musicFolders", JSON.stringify(musicFolders));
  writeStoredValue("medo.favorites", JSON.stringify([...favorites]));
  writeStoredValue("medo.recent", JSON.stringify(recent));
  writeStoredValue("medo.playStats", JSON.stringify(playStats));
  writeStoredValue("medo.theme", theme);
  writeStoredValue("medo.displayMode", displayMode);
  const persistentTrackIds = new Set(storedTracks.map((track) => track.id));
  writeStoredValue("medo.playbackQueue", JSON.stringify(
    playbackQueueIds.filter((id) => persistentTrackIds.has(id))
  ));
  writeStoredValue("medo.librarySort", librarySort);
  writeStoredValue("medo.recentSortByPlays", String(recentSortByPlays));
  writeStoredValue("medo.sidebarCollapsed", String(sidebarCollapsed));
  writeStoredValue("medo.playMode", playMode);
  persistPlaybackState();
}

function persistPlaybackState() {
  persistListeningTime();
  const currentTrack = tracks[currentIndex];
  const persistPlaybackState = currentTrack && !currentTrack.transient;
  writeStoredValue("medo.playbackState", JSON.stringify({
    trackId: persistPlaybackState ? currentTrack.id : null,
    currentTime: persistPlaybackState ? (Number(audio.currentTime) || 0) : 0,
    playing: Boolean(persistPlaybackState && audio.src && !audio.paused && !playbackPausePending),
    volume: desiredVolume,
    muted: audio.muted
  }));
}

function persistListeningTime() {
  accumulateListeningTime();
  return storeListeningDays(listeningDailyMs);
}

function storeListeningDays(days) {
  try {
    writeStoredValue("medo.listeningStats", JSON.stringify({ dailyMs: days }));
    listeningStatsSaveFailed = false;
    return true;
  } catch {
    if (!listeningStatsSaveFailed) showActionFeedback("听歌统计保存失败，请检查可用存储空间");
    listeningStatsSaveFailed = true;
    return false;
  }
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 300);
}

function persistNavigation() {
  localStorage.setItem("medo.navigation", JSON.stringify({
    view: currentView === "player" ? viewBeforePlayer : currentView,
    playlist: currentPlaylist,
    sort: currentSort,
    collection: currentCollection
  }));
}

function restoreNavigation() {
  const saved = loadJson("medo.navigation", null);
  if (!saved || !["library", "recent", "favorites", "playlists", "now", "settings"].includes(saved.view)) return;
  currentView = saved.view;
  currentSort = ["songs", "albums", "artists"].includes(saved.sort) ? saved.sort : "songs";
  currentPlaylist = playlists.some(playlist => playlist.name === saved.playlist) ? saved.playlist : null;
  currentCollection = saved.collection && ["albums", "artists"].includes(saved.collection.type) &&
    typeof saved.collection.name === "string" ? saved.collection : null;
  if (saved.playlist && !currentPlaylist) {
    currentView = "library";
    currentCollection = null;
  }
  viewBeforePlayer = currentView;
  setActiveNav(currentPlaylist ? null : document.querySelector(`.nav-item[data-view="${currentView}"]`));
  document.querySelectorAll(".pivot").forEach(button => button.classList.toggle("active", button.dataset.sort === currentSort));
}
