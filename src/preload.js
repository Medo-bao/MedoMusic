const { contextBridge, ipcRenderer } = require("electron");
const pendingOpenAudioFiles = [];
const openAudioListeners = new Set();

ipcRenderer.on("app:open-audio-files", (_event, filePaths) => {
  if (openAudioListeners.size) {
    openAudioListeners.forEach((callback) => callback(filePaths));
  } else {
    pendingOpenAudioFiles.push(filePaths);
  }
});

contextBridge.exposeInMainWorld("medo", {
  chooseFiles: () => ipcRenderer.invoke("music:choose-files"),
  chooseFolder: () => ipcRenderer.invoke("music:choose-folder"),
  scanFolder: (folder) => ipcRenderer.invoke("music:scan-folder", folder),
  discoverDefaultLibrary: () => ipcRenderer.invoke("music:discover-default-library"),
  choosePlaylist: () => ipcRenderer.invoke("music:choose-playlist"),
  chooseCover: () => ipcRenderer.invoke("music:choose-cover"),
  loadPlaylist: (playlistPath) => ipcRenderer.invoke("music:load-playlist", playlistPath),
  readMetadata: (filePath) => ipcRenderer.invoke("music:metadata", filePath),
  clearMetadataCache: () => ipcRenderer.invoke("music:clear-metadata-cache"),
  resolveMediaSource: (filePath) => ipcRenderer.invoke("music:resolve-source", filePath),
  getExternalTracks: (filePaths) => ipcRenderer.invoke("music:external-tracks", filePaths),
  readLyrics: (options) => ipcRenderer.invoke("music:lyrics", options),
  translateLyrics: (options) => ipcRenderer.invoke("lyrics:translate", options),
  showTrackMenu: (options) => ipcRenderer.invoke("track:context-menu", options),
  showPlaylistMenu: (options) => ipcRenderer.invoke("playlist:context-menu", options),
  chooseTargetPlaylist: (playlists) => ipcRenderer.invoke("playlist:pick-target", playlists),
  showTrackProperties: (filePath) => ipcRenderer.invoke("track:properties", filePath),
  showTrackInFolder: (filePath) => ipcRenderer.invoke("track:show-in-folder", filePath),
  toggleLyricsWindow: () => ipcRenderer.send("lyrics-window:toggle"),
  updateLyricsWindow: (payload) => ipcRenderer.send("lyrics-window:update", payload),
  lockLyricsWindow: (locked = true) => ipcRenderer.send("lyrics-window:set-locked", Boolean(locked)),
  resetLyricsWindowPosition: () => ipcRenderer.send("lyrics-window:reset-position"),
  getLyricsWindowState: () => ipcRenderer.invoke("lyrics-window:get-state"),
  sendLyricsWindowCommand: (command) => ipcRenderer.send("lyrics-window:command", command),
  setLyricsWindowSize: (size) => ipcRenderer.send("lyrics-window:set-size", size),
  fitLyricsWindowHeight: (height) => ipcRenderer.send("lyrics-window:fit-height", height),
  fitLyricsWindowWidth: (width) => ipcRenderer.send("lyrics-window:fit-width", width),
  setTrayMuted: (muted) => ipcRenderer.send("tray:set-muted", Boolean(muted)),
  moveLyricsWindow: (delta) => ipcRenderer.send("lyrics-window:move", delta),
  onLyricsWindowLine: (callback) => ipcRenderer.on("lyrics-window:line", (_event, payload) => callback(payload)),
  onLyricsWindowLockState: (callback) => ipcRenderer.on("lyrics-window:lock-state", (_event, locked) => callback(locked)),
  onLyricsWindowPointerInside: (callback) => ipcRenderer.on("lyrics-window:pointer-inside", (_event, inside) => callback(inside)),
  onLyricsWindowSize: (callback) => ipcRenderer.on("lyrics-window:size", (_event, size) => callback(size)),
  onLyricsWindowVisibility: (callback) => ipcRenderer.on("lyrics-window:visibility", (_event, visible) => callback(visible)),
  onOpenAudioFiles: (callback) => {
    openAudioListeners.add(callback);
    pendingOpenAudioFiles.splice(0).forEach((filePaths) => callback(filePaths));
    return () => openAudioListeners.delete(callback);
  },
  setTitleBarTheme: (theme) => ipcRenderer.send("theme:set-titlebar", theme),
  onResolvedTheme: (callback) => ipcRenderer.on("theme:resolved", (_event, theme) => callback(theme)),
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.send("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  setCloseBehavior: (value) => ipcRenderer.send("app:set-close-behavior", value),
  onTrayCommand: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("tray:command", listener);
    return () => ipcRenderer.removeListener("tray:command", listener);
  },
  getAppInfo: () => ipcRenderer.invoke("app:get-info")
});
