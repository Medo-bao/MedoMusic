// Renderer playlists. Loaded before renderer.js; shares its application state.

function repairPlaylistMemberships() {
  const byId = new Map(tracks.map(track => [track.id, track]));
  for (const playlist of playlists) {
    if (!Array.isArray(playlist.trackIds)) continue;
    playlist.trackIds = [...new Set(playlist.trackIds)].filter(id => byId.has(id) && !byId.get(id).transient);
  }
  const names = new Map(tracks.map(track => [track.id, new Set()]));
  for (const playlist of playlists) {
    for (const id of playlist.trackIds || []) names.get(id)?.add(playlist.name);
  }
  const legacyNames = new Set(playlists.filter(item => !Array.isArray(item.trackIds)).map(item => item.name));
  for (const track of tracks) {
    track.playlists = [...new Set([...(track.playlists || []).filter(name => legacyNames.has(name)), ...names.get(track.id)])];
  }
}

function playlistTrackIds() {
  return new Set(playlists.flatMap(playlist => playlist.trackIds || []));
}

async function showPlaylistContextMenu(playlistName, favoritesList, event) {
  const sourceIds = favoritesList
    ? tracks.filter((track) => favorites.has(track.id)).map((track) => track.id)
    : [...(playlists.find((playlist) => playlist.name === playlistName)?.trackIds || [])];
  const validIds = sourceIds.filter((id) => tracks.some((track) => track.id === id));
  const result = await window.MedoMenus.playlist({
    favorites: favoritesList,
    canSave: canSavePlaylistTracks(tracks.filter(track => validIds.includes(track.id)), false),
    playlists: playlists
      .map((playlist) => playlist.name)
      .filter((name) => favoritesList || name !== playlistName)
  }, event);
  if (!result || !validIds.length && ["play", "play-next", "add-to-playlist", "create-playlist"].includes(result.action)) return;
  if (result.action === "play") {
    playbackQueueIds = [...validIds];
    const firstIndex = tracks.findIndex((track) => track.id === validIds[0]);
    if (firstIndex >= 0) playTrack(firstIndex, true);
  } else if (result.action === "play-next") {
    const queueWasEmpty = !playbackQueueIds.some((id) => tracks.some((track) => track.id === id));
    const currentId = tracks[currentIndex]?.id;
    const remaining = playbackQueueIds.filter((id) => !validIds.includes(id));
    const insertAt = currentId ? Math.max(0, remaining.indexOf(currentId) + 1) : 0;
    remaining.splice(insertAt, 0, ...validIds);
    playbackQueueIds = remaining;
    schedulePersist(["queue", "playback"]);
    if (queueWasEmpty) {
      const firstIndex = tracks.findIndex((track) => track.id === validIds[0]);
      if (firstIndex >= 0) playTrack(firstIndex, true);
    }
  } else if (result.action === "create-playlist") {
    await createPlaylistWithTracks(validIds);
  } else if (result.action === "add-to-playlist") {
    const target = playlists.find((playlist) => playlist.name === result.playlist);
    if (!target) return;
    if (!addTracksToPlaylist(target, validIds)) return;
    persist(["tracks", "playlists", "playback"]);
    renderPlaylists();
  } else if (result.action === "rename") {
    renamePlaylist(playlistName);
  } else if (result.action === "delete") {
    deletePlaylist(playlistName);
  }
}

async function choosePlaylist() {
  const result = await window.medo.choosePlaylist();
  if (!result) return;
  const existing = playlists.find((item) => item.path === result.path);
  const trackIds = mergeTracks(result.tracks).map((track) => track.id);
  if (existing) {
    existing.name = result.name;
    existing.trackIds = trackIds;
  } else {
    playlists.push({ name: result.name, path: result.path, trackIds });
  }
  repairPlaylistMemberships();
  currentPlaylist = result.name;
  currentCollection = null;
  currentView = "library";
  currentSort = "songs";
  document.querySelectorAll(".pivot").forEach((item) => {
    item.classList.toggle("active", item.dataset.sort === "songs");
  });
  setActiveNav(null);
  persist(["tracks", "playlists", "playback"]);
  render();
}

async function addSongsToCurrentPlaylist() {
  if (!currentPlaylist) return;
  const targetName = currentPlaylist;
  const newTracks = await window.medo.chooseFiles();
  if (!newTracks.length) return;
  const playlist = playlists.find((item) => item.name === targetName);
  if (!playlist) return;
  const previousIds = new Set(playlist.trackIds || []);
  newTracks.forEach((track) => {
    track.playlists = [...new Set([...(track.playlists || []), targetName])];
  });
  const merged = mergeTracks(newTracks);
  playlist.trackIds = [...(playlist.trackIds || []), ...merged.map((track) => track.id)]
    .filter((id, index, values) => values.indexOf(id) === index);
  const added = playlist.trackIds.filter(id => !previousIds.has(id)).length;
  showActionFeedback(`已添加 ${added} 首到“${playlist.name}”，重复跳过 ${newTracks.length - added} 首`);
  persist(["tracks", "playlists", "playback"]);
  render();
}

function confirmPlaylistAction(title, message, confirmLabel = "确认") {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "track-info-dialog playlist-name-dialog";
    dialog.setAttribute("aria-labelledby", "playlist-confirm-title");
    dialog.innerHTML = '<form method="dialog"><header><h2 id="playlist-confirm-title"></h2></header><p></p><footer><button value="cancel" autofocus>取消</button><button class="primary" value="confirm">确认</button></footer></form>';
    dialog.querySelector("h2").textContent = title;
    dialog.querySelector("p").textContent = message;
    dialog.querySelector('button[value="confirm"]').textContent = confirmLabel;
    dialog.addEventListener("close", () => { const confirmed = dialog.returnValue === "confirm"; dialog.remove(); resolve(confirmed); }, {once:true});
    document.body.append(dialog); dialog.showModal();
  });
}

function requestPlaylistName(title, initialName, excluded = null, allowExisting = false) {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "track-info-dialog playlist-name-dialog";
    dialog.setAttribute("aria-labelledby", "playlist-name-title");
    dialog.innerHTML = '<form><header><h2 id="playlist-name-title"></h2></header><label>歌单名称<input maxlength="100" aria-describedby="playlist-name-error" required></label><p id="playlist-name-error" role="alert"></p><footer><button type="button">取消</button><button class="primary" type="submit">保存</button></footer></form>';
    dialog.querySelector("h2").textContent = title;
    const input = dialog.querySelector("input");
    input.value = initialName;
    let value = null;
    dialog.querySelector('button[type="button"]').onclick = () => dialog.close();
    dialog.querySelector("form").onsubmit = event => {
      event.preventDefault();
      const name = input.value.trim();
      const duplicate = !allowExisting && playlists.some(p => p !== excluded && p.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      const error = !name ? "请输入歌单名称" : duplicate ? "已有同名歌单，请换一个名称" : "";
      dialog.querySelector("#playlist-name-error").textContent = error;
      input.setAttribute("aria-invalid", String(Boolean(error)));
      if (error) { input.focus(); return; }
      value = name;
      dialog.close();
    };
    dialog.addEventListener("close", () => { dialog.remove(); resolve(value); }, {once:true});
    document.body.append(dialog);
    dialog.showModal();
    input.focus(); input.select();
  });
}

async function renamePlaylist(playlistName) {
  const playlist = playlists.find((item) => item.name === playlistName);
  if (!playlist) return;
  const nextName = await requestPlaylistName("重命名歌单", playlist.name, playlist);
  if (!playlists.includes(playlist)) return;
  if (!nextName || nextName === playlist.name) return;
  const previousName = playlist.name;
  playlist.name = nextName;
  tracks.forEach((track) => {
    if (!track.playlists?.includes(previousName)) return;
    track.playlists = track.playlists.map((name) => name === previousName ? nextName : name);
  });
  if (currentPlaylist === previousName) currentPlaylist = nextName;
  persist(["tracks", "playlists", "playback"]);
  render();
}

function renameCurrentPlaylist() {
  renamePlaylist(currentPlaylist);
}

async function deletePlaylist(playlistName) {
  const playlist = playlists.find((item) => item.name === playlistName);
  if (!playlist || !await confirmPlaylistAction("删除歌单", `删除“${playlist.name}”？本地歌曲文件不会删除。`)) return;
  if (!playlists.includes(playlist)) return;
  const deletedName = playlist.name;
  playlists = playlists.filter((item) => item !== playlist);
  tracks.forEach((track) => {
    track.playlists = (track.playlists || []).filter((name) => name !== deletedName);
  });
  if (currentPlaylist === deletedName) {
    currentPlaylist = null;
    currentView = "library";
    setActiveNav(document.querySelector('[data-view="library"]'));
  }
  persist(["tracks", "playlists", "playback"]);
  render();
}

function deleteCurrentPlaylist() {
  deletePlaylist(currentPlaylist);
}

function canSavePlaylistTracks(items, notify = true) {
  const allowed = !items.some(track => track?.transient);
  if (!allowed && notify) showActionFeedback("外部歌曲无法保存到歌单，请先导入音乐库");
  return allowed;
}

function addTracksToPlaylist(playlist, ids) {
  const byId = new Map(tracks.map(track => [track.id, track]));
  const items = ids.map(id => byId.get(id)).filter(Boolean);
  if (!playlists.includes(playlist) || !canSavePlaylistTracks(items)) return false;
  playlist.trackIds = [...new Set([...(playlist.trackIds || []), ...items.map(track => track.id)])];
  for (const track of items) track.playlists = [...new Set([...(track.playlists || []), playlist.name])];
  return true;
}

async function createPlaylistWithTracks(ids) {
  const trackIds = [...new Set(ids)];
  const byId = new Map(tracks.map(track => [track.id, track]));
  const items = trackIds.map(id => byId.get(id)).filter(Boolean);
  if (!items.length || !canSavePlaylistTracks(items)) return null;
  let initialName = "新播放列表";
  let suffix = 2;
  while (playlists.some(playlist => playlist.name === initialName)) initialName = `新播放列表 ${suffix++}`;
  const name = await requestPlaylistName("创建新播放列表", initialName);
  if (!name) return null;
  const currentById = new Map(tracks.map(track => [track.id, track]));
  const currentItems = trackIds.map(id => currentById.get(id));
  if (currentItems.some(track => !track) || !canSavePlaylistTracks(currentItems)) return null;
  const playlist = { name, path: null, trackIds: [] };
  playlists.push(playlist);
  addTracksToPlaylist(playlist, trackIds);
  persist(["tracks", "playlists", "playback"]);
  renderPlaylists();
  showActionFeedback(`已创建“${name}”，并添加 ${trackIds.length} 首歌曲`);
  return playlist;
}

function updatePlaylistSaveControls() {
  const byId = new Map(tracks.map(track => [track.id, track]));
  const queue = playbackQueueIds.map(id => byId.get(id)).filter(Boolean);
  const selected = [...selectedTrackIds].map(id => byId.get(id)).filter(Boolean);
  for (const [selector, items] of [["#detail-save-queue", queue], ["#queue-selected", selected]]) {
    const button = document.querySelector(selector);
    const allowed = canSavePlaylistTracks(items, false);
    button.disabled = !items.length || !allowed;
    button.title = allowed ? "" : "外部歌曲无法保存到歌单，请先导入音乐库";
  }
}

async function savePlaybackQueueAsPlaylist() {
  const date = new Date();
  const defaultName = `播放列表${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

  const byId = new Map(tracks.map(track => [track.id, track]));
  const queueIds = playbackQueueIds.filter(id => byId.has(id));
  if (!canSavePlaylistTracks(queueIds.map(id => byId.get(id)))) return;
  if (!queueIds.length) {
    showActionFeedback("当前播放列表为空");
    return;
  }
  const name = await requestPlaylistName("保存为歌单", defaultName, null, true);
  if (!name) return;
  const stillSavable = () => queueIds.every(id => tracks.some(track => track.id === id && !track.transient));
  if (!stillSavable()) return;
  const existing = playlists.find(playlist => playlist.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (existing) {
    if (!await confirmPlaylistAction("替换歌单", `“${existing.name}”已存在，是否用当前队列替换？`)) return;
    if (!playlists.includes(existing) || !stillSavable()) return;
    existing.trackIds = [...queueIds];
    tracks.forEach(track => {
      track.playlists = (track.playlists || []).filter(value => value !== existing.name);
    });
    existing.name = name;
  } else playlists.push({ name, path: null, trackIds: [...queueIds] });
  showActionFeedback(`已保存 ${queueIds.length} 首到“${name}”`);
  tracks.forEach((track) => {
    if (!queueIds.includes(track.id)) return;
    track.playlists = [...new Set([...(track.playlists || []), name])];
  });
  persist(["tracks", "playlists", "playback"]);
  renderPlaylists();
}

async function migratePlaylistOrder() {
  let changed = false;
  for (const playlist of playlists.filter((item) => !item.trackIds?.length)) {
    const result = await window.medo.loadPlaylist(playlist.path);
    if (!result) continue;
    const merged = mergeTracks(result.tracks);
    playlist.name = result.name;
    playlist.trackIds = merged.map((track) => track.id);
    changed = true;
  }
  if (changed) {
    persist(["tracks", "playlists", "playback"]);
    render();
  }
}

function validTrackIds(values) {
  const requested = new Set(Array.isArray(values) ? values : []);
  if (tracks.some(track => track.transient && requested.has(track.id))) throw new Error("external-tracks-cannot-be-saved");
  const known = new Set(tracks.filter((track) => !track.transient).map((track) => track.id));
  return [...new Set((Array.isArray(values) ? values : []).filter((id) => known.has(id)))];
}

function createPlaylistFromExtension(name, trackIds = []) {
  const normalized = String(name || "").trim();
  if (!normalized || normalized.length > 100) throw new Error("invalid-playlist-name");
  if (playlists.some((playlist) => playlist.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
    throw new Error("playlist-already-exists");
  }
  const ids = validTrackIds(trackIds);
  playlists.push({ name: normalized, path: null, trackIds: ids });
  tracks.forEach((track) => {
    if (ids.includes(track.id)) track.playlists = [...new Set([...(track.playlists || []), normalized])];
  });
  persist(["tracks", "playlists", "playback"]);
  render();
  return playlists.at(-1);
}

function updatePlaylistFromExtension(currentName, changes = {}) {
  const playlist = playlists.find((item) => item.name === currentName);
  if (!playlist) throw new Error("playlist-not-found");
  const nextName = changes.newName === undefined ? currentName : String(changes.newName || "").trim();
  if (!nextName || nextName.length > 100) throw new Error("invalid-playlist-name");
  if (nextName !== currentName && playlists.some((item) => item !== playlist && item.name.toLocaleLowerCase() === nextName.toLocaleLowerCase())) {
    throw new Error("playlist-already-exists");
  }
  const nextIds = changes.trackIds === undefined ? [...(playlist.trackIds || [])] : validTrackIds(changes.trackIds);
  tracks.forEach((track) => {
    const names = new Set(track.playlists || []);
    names.delete(currentName);
    if (nextIds.includes(track.id)) names.add(nextName);
    track.playlists = [...names];
  });
  playlist.name = nextName;
  playlist.trackIds = nextIds;
  if (currentPlaylist === currentName) currentPlaylist = nextName;
  persist(["tracks", "playlists", "playback"]);
  render();
  return playlist;
}

function deletePlaylistFromExtension(name) {
  const playlist = playlists.find((item) => item.name === name);
  if (!playlist) throw new Error("playlist-not-found");
  playlists = playlists.filter((item) => item !== playlist);
  tracks.forEach((track) => {
    track.playlists = (track.playlists || []).filter((value) => value !== name);
  });
  if (currentPlaylist === name) currentPlaylist = null;
  persist(["tracks", "playlists", "playback"]);
  render();
  return { deleted: name };
}
