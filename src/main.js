const { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, Tray, Menu, protocol, screen, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { parseZpl } = require("./zpl");
const { decodeTextBuffer } = require("./text-decoder");
const { createMediaFileResponse } = require("./media-file-response");
const { hasNativeWordTiming } = require("./lyrics-timing");
const { fetchNeteaseLyrics } = require("./netease-eapi");
const { fetchQqMusicLyrics } = require("./qq-music");
const { resolveOnlineLyricProviders, selectLocalLyrics, removeLiveQualifier, removeEnglishSuffixFromChineseTitle } = require("./lyrics-source-priority");
const { startMyFireflyExtension } = require("./myfirefly-extension");

const WINDOWS_APP_USER_MODEL_ID = "com.medomusic.desktop";
const WINDOWS_TRAY_GUID = "8c33d388-8b65-4e7c-a54d-1af447cd8bfa";
const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma"
]);
protocol.registerSchemesAsPrivileged([{
  scheme: "medo-media",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
}]);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (process.platform === "win32") app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    showMainWindow();
    queueExternalAudioFiles(commandLine);
  });
}
let mainWindow = null;
let pendingExternalAudioFiles = [];
let externalAudioDispatchTimer = null;
let tray = null;
let trayEnabled = false;
let myFireflyExtension = null;
const myFireflyPending = new Map();
let closeBehavior = "background";
let isQuitting = false;
let metadataCache = null;
let metadataCacheWriteTimer = null;
let onlineLyricsCache = null;
let onlineLyricsCacheWriteTimer = null;
let lyricTranslationCache = null;
let lyricTranslationCacheWriteTimer = null;
let lyricsWindow = null;
let lastLyricsWindowPayload = null;
let lyricsWindowLocked = true;
let lyricsWindowReady = false;
let lyricsWindowShowWhenReady = false;
let lyricsWindowPointerTimer = null;
let lyricsWindowPointerInside = false;
let lyricsWindowTopTimer = null;
let trayMuted = false;
let trayLyricsSize = 34;
let globalPlayPauseShortcutEnabled = true;
let globalLyricsRefreshShortcutEnabled = true;
let globalPreviousShortcutEnabled = true;
let globalNextShortcutEnabled = true;
const musicFolderWatchers = new Map();
const METADATA_COVER_VERSION = 8;

function coverCacheDirectory() {
  return path.join(app.getPath("userData"), "cover-cache");
}

function coverCachePath(filePath, stat) {
  const key = crypto.createHash("sha1")
    .update(`${path.resolve(filePath)}\0${stat.mtimeMs}\0${stat.size}\0${METADATA_COVER_VERSION}`)
    .digest("hex");
  return path.join(coverCacheDirectory(), `${key}.jpg`);
}

function closeMusicFolderWatchers() {
  for (const entry of musicFolderWatchers.values()) {
    clearTimeout(entry.timer);
    entry.watcher.close();
  }
  musicFolderWatchers.clear();
}

function updateMusicFolderWatchers(folders = []) {
  const requested = new Map(folders
    .filter((folder) => typeof folder === "string" && folder.trim())
    .map((folder) => [path.resolve(folder).toLowerCase(), path.resolve(folder)]));
  for (const [key, entry] of musicFolderWatchers) {
    if (requested.has(key)) continue;
    clearTimeout(entry.timer);
    entry.watcher.close();
    musicFolderWatchers.delete(key);
  }
  for (const [key, folder] of requested) {
    if (musicFolderWatchers.has(key)) continue;
    try {
      const entry = { watcher: null, timer: null };
      entry.watcher = fsSync.watch(folder, { recursive: true }, () => {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("music:library-folder-changed", folder);
          }
        }, 1200);
      });
      entry.watcher.on("error", () => {
        clearTimeout(entry.timer);
        entry.watcher.close();
        musicFolderWatchers.delete(key);
      });
      musicFolderWatchers.set(key, entry);
    } catch {}
  }
}

function audioPathsFromArguments(args = []) {
  return [...new Set(args
    .map((value) => String(value || "").replace(/^"|"$/g, ""))
    .filter((value) => AUDIO_EXTENSIONS.has(path.extname(value).toLowerCase()))
    .map((value) => path.resolve(value)))];
}

function queueExternalAudioFiles(args) {
  const files = audioPathsFromArguments(args);
  if (!files.length) return;
  pendingExternalAudioFiles = [...new Set([...pendingExternalAudioFiles, ...files])];
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return;
  clearTimeout(externalAudioDispatchTimer);
  externalAudioDispatchTimer = setTimeout(() => {
    externalAudioDispatchTimer = null;
    if (!pendingExternalAudioFiles.length || !mainWindow || mainWindow.isDestroyed()) return;
    const queuedFiles = pendingExternalAudioFiles;
    pendingExternalAudioFiles = [];
    mainWindow.webContents.send("app:open-audio-files", queuedFiles);
  }, 60);
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  queueExternalAudioFiles([filePath]);
});

function trimRecord(record, limit) {
  const keys = Object.keys(record || {});
  for (let index = 0; index < keys.length - limit; index += 1) delete record[keys[index]];
}

async function getMetadataCache() {
  if (metadataCache) return metadataCache;
  try {
    const cachePath = path.join(app.getPath("userData"), "metadata-cache.json");
    const serialized = await fs.readFile(cachePath, "utf8");
    if (serialized.length > 20 * 1024 * 1024) {
      metadataCache = {};
      await fs.rm(cachePath, { force: true });
    } else {
      metadataCache = JSON.parse(serialized);
    }
  } catch {
    metadataCache = {};
  }
  return metadataCache;
}

function scheduleMetadataCacheWrite() {
  trimRecord(metadataCache, 1200);
  clearTimeout(metadataCacheWriteTimer);
  metadataCacheWriteTimer = setTimeout(async () => {
    const entries = Object.entries(metadataCache || {}).slice(-1200);
    try {
      await fs.writeFile(
        path.join(app.getPath("userData"), "metadata-cache.json"),
        JSON.stringify(Object.fromEntries(entries)),
        "utf8"
      );
    } catch {
      // Cache failures must never interrupt playback or library loading.
    }
  }, 800);
}

async function getOnlineLyricsCache() {
  if (onlineLyricsCache) return onlineLyricsCache;
  try {
    onlineLyricsCache = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "online-lyrics-cache.json"), "utf8"));
  } catch {
    onlineLyricsCache = {};
  }
  return onlineLyricsCache;
}

function scheduleOnlineLyricsCacheWrite() {
  trimRecord(onlineLyricsCache, 400);
  clearTimeout(onlineLyricsCacheWriteTimer);
  onlineLyricsCacheWriteTimer = setTimeout(async () => {
    try {
      await fs.writeFile(
        path.join(app.getPath("userData"), "online-lyrics-cache.json"),
        JSON.stringify(onlineLyricsCache || {}),
        "utf8"
      );
    } catch {
      // Online lyrics remain optional when the cache cannot be persisted.
    }
  }, 800);
}

async function getLyricTranslationCache() {
  if (lyricTranslationCache) return lyricTranslationCache;
  try {
    lyricTranslationCache = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "lyric-translations.json"), "utf8"));
  } catch {
    lyricTranslationCache = {};
  }
  return lyricTranslationCache;
}

function scheduleLyricTranslationCacheWrite() {
  trimRecord(lyricTranslationCache, 600);
  clearTimeout(lyricTranslationCacheWriteTimer);
  lyricTranslationCacheWriteTimer = setTimeout(async () => {
    try {
      const entries = Object.entries(lyricTranslationCache || {}).slice(-600);
      await fs.writeFile(
        path.join(app.getPath("userData"), "lyric-translations.json"),
        JSON.stringify(Object.fromEntries(entries)),
        "utf8"
      );
    } catch {
      // Translation remains optional when its cache cannot be written.
    }
  }, 800);
}

async function translateLyricBlock(lines) {
  const text = lines.join("\n");
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", "zh-CN");
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);
  const response = await fetch(url, {
    headers: { "User-Agent": "MedoMusic/1.0" },
    signal: AbortSignal.timeout(4500)
  });
  if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
  const payload = await response.json();
  const translated = (payload?.[0] || []).map((part) => part?.[0] || "").join("");
  const result = translated.split(/\r?\n/);
  if (result.length === lines.length) return result;
  return lines.map((line, index) => result[index] || (line.trim() ? "" : line));
}

async function getNeteaseLyricTranslation(options, lines) {
  const title = String(options.title || "").trim();
  const artist = String(options.artist || "").trim();
  if (!title) return null;
  const headers = {
    Referer: "https://music.163.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MedoMusic"
  };
  const query = new URLSearchParams({
    s: `${title} ${artist}`.trim(),
    type: "1",
    offset: "0",
    total: "true",
    limit: "8"
  });
  const searchResponse = await fetch(`https://music.163.com/api/search/get/web?${query}`, {
    headers,
    signal: AbortSignal.timeout(6000)
  });
  if (!searchResponse.ok) return null;
  const songs = (await searchResponse.json())?.result?.songs || [];
  const normalize = (value) => String(value || "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
  const expectedDuration = Number(options.duration) || 0;
  const ranked = songs.map((song) => {
    const songArtists = (song.artists || song.ar || []).map((item) => item.name).join(" ");
    const titleScore = normalize(song.name) === normalize(title) ? 1 : normalize(song.name).includes(normalize(title)) ? .76 : 0;
    const artistScore = !artist ? .5 : normalize(songArtists).includes(normalize(artist)) ? 1 : 0;
    const duration = Number(song.duration || song.dt || 0) / 1000;
    const durationScore = !expectedDuration ? .5 : Math.max(0, 1 - Math.abs(duration - expectedDuration) / 12);
    return { song, score: titleScore * .58 + artistScore * .27 + durationScore * .15 };
  }).sort((left, right) => right.score - left.score);
  if (!ranked[0] || ranked[0].score < .58) return null;
  const lyricResponse = await fetch(
    `https://music.163.com/api/song/lyric?id=${ranked[0].song.id}&lv=1&kv=1&tv=-1`,
    { headers, signal: AbortSignal.timeout(6000) }
  );
  if (!lyricResponse.ok) return null;
  const translatedLrc = (await lyricResponse.json())?.tlyric?.lyric;
  if (!translatedLrc) return null;
  const translatedLines = [];
  for (const rawLine of translatedLrc.split(/\r?\n/)) {
    const stamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = rawLine.replace(/\[[^\]]+\]/g, "").trim();
    for (const stamp of stamps) {
      const fraction = stamp[3] ? Number(stamp[3]) / (10 ** stamp[3].length) : 0;
      translatedLines.push({ start: Number(stamp[1]) * 60 + Number(stamp[2]) + fraction, text });
    }
  }
  if (!translatedLines.length) return null;
  const starts = Array.isArray(options.starts) ? options.starts : [];
  return lines.map((_line, index) => {
    const start = Number(starts[index]);
    if (!Number.isFinite(start)) return "";
    let best = null;
    for (const candidate of translatedLines) {
      const distance = Math.abs(candidate.start - start);
      if (distance <= .9 && (!best || distance < best.distance)) best = { ...candidate, distance };
    }
    return best?.text || "";
  });
}

function createWindow() {
  const startupBackground = nativeTheme.shouldUseDarkColors ? "#111416" : "#f4f6f7";
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: startupBackground,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow = window;
  const sendMaximizedState = () => {
    if (!window.isDestroyed()) window.webContents.send("window:maximized", window.isMaximized());
  };
  window.on("maximize", sendMaximizedState);
  window.on("unmaximize", sendMaximizedState);
  window.webContents.on("did-finish-load", sendMaximizedState);
  window.loadFile(path.join(__dirname, "index.html"));
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show();
  });
  window.webContents.on("did-finish-load", () => {
    if (!pendingExternalAudioFiles.length) return;
    clearTimeout(externalAudioDispatchTimer);
    externalAudioDispatchTimer = null;
    window.webContents.send("app:open-audio-files", pendingExternalAudioFiles);
    pendingExternalAudioFiles = [];
  });
  window.on("close", (event) => {
    if (!isQuitting && closeBehavior === "background") {
      event.preventDefault();
      window.hide();
      return;
    }
    if (closeBehavior === "quit" && !isQuitting) {
      isQuitting = true;
      app.quit();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.webContents.isLoading()) {
    mainWindow.show();
    mainWindow.focus();
    keepLyricsWindowOnTop();
  }
}

function sendTrayCommand(command, value) {
  showMainWindow();
  mainWindow.webContents.send("tray:command", { command, value });
}

function sendGlobalPlaybackCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("tray:command", { command });
  };
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
  else send();
}

function sendMyFireflyCommand(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      myFireflyPending.delete(id);
      reject(new Error("renderer-timeout"));
    }, 8000);
    myFireflyPending.set(id, { resolve, reject, timer });
    const send = () => mainWindow.webContents.send("myfirefly-extension:command", { id, ...payload });
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
    else send();
  });
}

async function controlWindowFromMyFirefly(action) {
  if (action === "show" || action === "open") {
    showMainWindow();
  } else if (action === "hide") {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  } else if (action === "minimize") {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  } else {
    throw new Error("unsupported-native-action");
  }
  return { action, visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) };
}

function applyGlobalShortcutSettings(settings = {}) {
  globalPlayPauseShortcutEnabled = settings.playPause !== false;
  globalLyricsRefreshShortcutEnabled = settings.lyricsRefresh !== false;
  globalPreviousShortcutEnabled = settings.previous !== false;
  globalNextShortcutEnabled = settings.next !== false;
  globalShortcut.unregister("Alt+S");
  globalShortcut.unregister("Alt+D");
  globalShortcut.unregister("Alt+Q");
  globalShortcut.unregister("Alt+E");
  if (globalPlayPauseShortcutEnabled) {
    globalShortcut.register("Alt+S", () => sendGlobalPlaybackCommand("toggle-play"));
  }
  if (globalLyricsRefreshShortcutEnabled) {
    globalShortcut.register("Alt+D", () => sendGlobalPlaybackCommand("refresh-lyrics"));
  }
  if (globalPreviousShortcutEnabled) {
    globalShortcut.register("Alt+Q", () => sendGlobalPlaybackCommand("previous"));
  }
  if (globalNextShortcutEnabled) {
    globalShortcut.register("Alt+E", () => sendGlobalPlaybackCommand("next"));
  }
}

function keepLyricsWindowOnTop(window = lyricsWindow) {
  if (!window || window.isDestroyed()) return;
  window.setAlwaysOnTop(true, "screen-saver");
  if (window.isVisible()) window.moveTop();
}

function startLyricsWindowTopGuard() {
  clearInterval(lyricsWindowTopTimer);
  lyricsWindowTopTimer = setInterval(() => {
    if (!lyricsWindow || lyricsWindow.isDestroyed() || !lyricsWindow.isVisible()) return;
    keepLyricsWindowOnTop(lyricsWindow);
  }, 2000);
}

function showLyricsWindowWhenReady(window) {
  if (!window || window.isDestroyed()) return;
  if (!lyricsWindowReady || window.webContents.isLoading()) {
    lyricsWindowShowWhenReady = true;
    return;
  }
  window.showInactive();
  keepLyricsWindowOnTop(window);
}

function setLyricsWindowLocked(locked) {
  lyricsWindowLocked = Boolean(locked);
  const window = createLyricsWindow();
  if (lyricsWindowLocked && !window.isVisible()) showLyricsWindowWhenReady(window);
  keepLyricsWindowOnTop(window);
  window.setIgnoreMouseEvents(lyricsWindowLocked, { forward: true });
  window.webContents.send("lyrics-window:lock-state", lyricsWindowLocked);
  updateLyricsWindowPointerTracking();
  mainWindow?.webContents.send("lyrics-window:lock-state", lyricsWindowLocked);
  refreshTrayMenu();
}

function updateLyricsWindowPointerTracking() {
  clearInterval(lyricsWindowPointerTimer);
  lyricsWindowPointerTimer = null;
  lyricsWindowPointerInside = false;
  lyricsWindow?.webContents.send("lyrics-window:pointer-inside", false);
  if (!lyricsWindowLocked || !lyricsWindow || lyricsWindow.isDestroyed()) return;
  lyricsWindowPointerTimer = setInterval(() => {
    if (!lyricsWindow || lyricsWindow.isDestroyed() || !lyricsWindow.isVisible()) return;
    const point = screen.getCursorScreenPoint();
    const bounds = lyricsWindow.getBounds();
    const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width &&
      point.y >= bounds.y && point.y < bounds.y + bounds.height;
    if (inside === lyricsWindowPointerInside) return;
    lyricsWindowPointerInside = inside;
    lyricsWindow.webContents.send("lyrics-window:pointer-inside", inside);
  }, 50);
}

function lyricsVisibilityStatePath() {
  return path.join(app.getPath("userData"), "desktop-lyrics-state.json");
}

async function readSavedLyricsVisibility() {
  try {
    const serialized = await fs.readFile(lyricsVisibilityStatePath(), "utf8");
    return JSON.parse(serialized)?.visible === true;
  } catch {
    return false;
  }
}

function persistLyricsVisibility(visible) {
  const payload = JSON.stringify({ visible: Boolean(visible), savedAt: new Date().toISOString() });
  fs.writeFile(lyricsVisibilityStatePath(), payload, "utf8").catch(() => {});
}

function persistLyricsVisibilitySync(visible) {
  try {
    fsSync.writeFileSync(lyricsVisibilityStatePath(), JSON.stringify({ visible: Boolean(visible), savedAt: new Date().toISOString() }), "utf8");
  } catch {}
}

function setLyricsWindowVisible(visible, senderWindow) {
  const window = createLyricsWindow();
  if (visible) {
    showLyricsWindowWhenReady(window);
    keepLyricsWindowOnTop(window);
    if (lastLyricsWindowPayload) window.webContents.send("lyrics-window:line", lastLyricsWindowPayload);
  } else {
    lyricsWindowShowWhenReady = false;
    window.hide();
  }
  const current = Boolean(visible);
  persistLyricsVisibility(current);
  (senderWindow || mainWindow)?.webContents.send("lyrics-window:visibility", current);
  refreshTrayMenu();
  return current;
}

async function restoreLyricsWindowVisibility() {
  const visible = await readSavedLyricsVisibility();
  if (visible) {
    const window = createLyricsWindow();
    showLyricsWindowWhenReady(window);
    keepLyricsWindowOnTop(window);
    if (lastLyricsWindowPayload) window.webContents.send("lyrics-window:line", lastLyricsWindowPayload);
  }
  mainWindow?.webContents.send("lyrics-window:visibility", visible);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: lyricsWindow?.isVisible() ? "隐藏桌面歌词" : "显示桌面歌词",
      click: () => {
        setLyricsWindowVisible(!(lyricsWindow && !lyricsWindow.isDestroyed() && lyricsWindow.isVisible()));
      }
    },
    {
      label: lyricsWindowLocked ? "解除锁定桌面歌词" : "锁定桌面歌词",
      click: () => setLyricsWindowLocked(!lyricsWindowLocked)
    },
    {
      label: "桌面歌词字号",
      click: () => sendTrayCommand("open-desktop-lyric-settings")
    },
    { type: "separator" },
    { label: "打开播放器", click: showMainWindow },
    { type: "separator" },
    {
      label: trayMuted ? "取消静音" : "静音",
      click: () => {
        trayMuted = !trayMuted;
        mainWindow?.webContents.send("tray:command", { command: "toggle-mute" });
        refreshTrayMenu();
      }
    },
    {
      label: "播放模式",
      submenu: [
        { label: "列表播放", click: () => sendTrayCommand("set-mode", "list-once") },
        { label: "队列循环", click: () => sendTrayCommand("set-mode", "sequence") },
        { label: "无序播放", click: () => sendTrayCommand("set-mode", "shuffle") },
        { label: "单曲循环", click: () => sendTrayCommand("set-mode", "repeat-one") }
      ]
    },
    { type: "separator" },
    { label: "上一曲", click: () => sendTrayCommand("previous") },
    { label: "暂停 / 播放", click: () => sendTrayCommand("toggle-play") },
    { label: "下一曲", click: () => sendTrayCommand("next") },
    { type: "separator" },
    { label: "设置", click: () => sendTrayCommand("open-settings") },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

function createTray() {
  if (tray) return;
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(__dirname, "..", "build", "icon.ico");
  let trayImage = nativeImage.createFromPath(iconPath);
  if (trayImage.isEmpty()) trayImage = nativeImage.createEmpty();
  const trayGuid = process.platform === "win32" ? WINDOWS_TRAY_GUID : undefined;
  tray = new Tray(trayImage.resize({ width: 16, height: 16 }), trayGuid);
  tray.setToolTip("MedoMusic");
  refreshTrayMenu();
  tray.on("double-click", showMainWindow);
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function setTrayEnabled(enabled) {
  trayEnabled = Boolean(enabled);
  if (trayEnabled) createTray();
  else destroyTray();
}

function createLyricsWindow() {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) return lyricsWindow;
  const width = 680;
  const height = 88;
  const workArea = screen.getPrimaryDisplay().workArea;
  lyricsWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + 4,
    minWidth: 420,
    minHeight: 68,
    frame: false,
    transparent: true,
    thickFrame: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  lyricsWindowReady = false;
  lyricsWindowShowWhenReady = false;
  lyricsWindow.setIgnoreMouseEvents(lyricsWindowLocked, { forward: true });
  keepLyricsWindowOnTop(lyricsWindow);
  lyricsWindow.loadFile(path.join(__dirname, "lyrics.html"));
  lyricsWindow.webContents.on("did-finish-load", () => {
    lyricsWindowReady = true;
    keepLyricsWindowOnTop(lyricsWindow);
    if (lastLyricsWindowPayload) lyricsWindow?.webContents.send("lyrics-window:line", lastLyricsWindowPayload);
    lyricsWindow?.webContents.send("lyrics-window:lock-state", lyricsWindowLocked);
    updateLyricsWindowPointerTracking();
    if (lyricsWindowShowWhenReady && lyricsWindow && !lyricsWindow.isDestroyed()) {
      lyricsWindowShowWhenReady = false;
      lyricsWindow.showInactive();
      keepLyricsWindowOnTop(lyricsWindow);
    }
  });
  lyricsWindow.on("show", () => keepLyricsWindowOnTop(lyricsWindow));
  lyricsWindow.on("always-on-top-changed", (_event, isAlwaysOnTop) => {
    if (!isAlwaysOnTop) setTimeout(() => keepLyricsWindowOnTop(lyricsWindow), 0);
  });
  startLyricsWindowTopGuard();
  lyricsWindow.on("closed", () => {
    clearInterval(lyricsWindowPointerTimer);
    lyricsWindowPointerTimer = null;
    clearInterval(lyricsWindowTopTimer);
    lyricsWindowTopTimer = null;
    lyricsWindowReady = false;
    lyricsWindowShowWhenReady = false;
    lyricsWindow = null;
  });
  return lyricsWindow;
}

async function walkDirectory(directory) {
  const results = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkDirectory(fullPath));
    } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

async function walkPlaylistFiles(directory) {
  const results = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkPlaylistFiles(fullPath));
    } else if (path.extname(entry.name).toLowerCase() === ".zpl") {
      results.push(fullPath);
    }
  }
  return results;
}

function toTrack(filePath) {
  const extension = path.extname(filePath);
  const fileName = path.basename(filePath, extension);
  const separatorIndex = fileName.indexOf(" - ");
  return {
    id: filePath,
    path: filePath,
    url: pathToFileURL(filePath).href,
    title: separatorIndex > 0 ? fileName.slice(separatorIndex + 3).trim() : fileName,
    artist: separatorIndex > 0 ? fileName.slice(0, separatorIndex).trim() : null,
    album: path.basename(path.dirname(filePath)),
    format: extension.slice(1).toUpperCase(),
    playlists: []
  };
}

async function toTrackWithFileTimes(filePath) {
  const track = toTrack(filePath);
  try {
    const stat = await fs.stat(filePath);
    track.createdAt = stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs;
    track.modifiedAt = stat.mtimeMs;
    track.fileSize = stat.size;
  } catch {
    track.createdAt = Date.now();
  }
  return track;
}

app.whenReady().then(() => {
  ipcMain.on("myfirefly-extension:response", (_event, payload = {}) => {
    const pending = myFireflyPending.get(payload.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    myFireflyPending.delete(payload.id);
    if (payload.ok) pending.resolve(payload.result);
    else pending.reject(new Error(payload.error || "renderer-command-failed"));
  });
  protocol.handle("medo-media", async (request) => {
    try {
      const filePath = new URL(request.url).searchParams.get("path");
      if (!filePath) return new Response("Missing media path", { status: 400 });
      return await createMediaFileResponse(filePath, request.headers.get("range"));
    } catch {
      return new Response("Media file unavailable", { status: 404 });
    }
  });
  ipcMain.handle("app:get-info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    installDirectory: "E:\\Medo_music\\release"
  }));
  ipcMain.handle("app:check-update", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("https://api.github.com/repos/Medo-bao/MedoMusic/releases/latest", {
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `MedoMusic/${app.getVersion()}`,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      });
      if (!response.ok) throw new Error(`github-${response.status}`);
      const release = await response.json();
      const currentVersion = app.getVersion();
      const latestVersion = String(release.tag_name || release.name || "").replace(/^v/i, "").trim();
      const parts = (version) => String(version).split(/[+-]/, 1)[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
      const current = parts(currentVersion);
      const latest = parts(latestVersion);
      let comparison = 0;
      for (let index = 0; index < Math.max(current.length, latest.length); index += 1) {
        const difference = (latest[index] || 0) - (current[index] || 0);
        if (difference !== 0) {
          comparison = difference;
          break;
        }
      }
      const updateAvailable = comparison > 0;
      const releaseUrl = String(release.html_url || "");
      if (updateAvailable && /^https:\/\/github\.com\/Medo-bao\/MedoMusic\/releases\//i.test(releaseUrl)) {
        await shell.openExternal(releaseUrl);
      }
      return { currentVersion, latestVersion, updateAvailable, releaseUrl };
    } catch (error) {
      return { error: error?.name === "AbortError" ? "timeout" : "unavailable" };
    } finally {
      clearTimeout(timeout);
    }
  });

  ipcMain.handle("music:discover-default-library", async () => {
    const folder = app.getPath("music");
    try {
      const [audioFiles, playlistFiles] = await Promise.all([
        walkDirectory(folder),
        walkPlaylistFiles(folder)
      ]);
      const parsedPlaylists = [];
      for (const playlistPath of playlistFiles) {
        try {
          const playlist = await parseZpl(playlistPath, toTrack);
          playlist.tracks = await Promise.all(playlist.tracks.map((track) => toTrackWithFileTimes(track.path)));
          parsedPlaylists.push(playlist);
        } catch {
          // Ignore malformed playlists while continuing the first-run scan.
        }
      }
      return {
        folder,
        tracks: await Promise.all(audioFiles.map(async (filePath) => ({ ...await toTrackWithFileTimes(filePath), sourceDirectory: folder }))),
        playlists: parsedPlaylists
      };
    } catch {
      return { folder, tracks: [], playlists: [] };
    }
  });

  ipcMain.on("theme:set-titlebar", (_event, theme) => {
    nativeTheme.themeSource = ["system", "light", "dark"].includes(theme) ? theme : "system";
    _event.sender.send("theme:resolved", nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });

  ipcMain.on("window:minimize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.minimize();
  });

  ipcMain.on("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    window.isMaximized() ? window.unmaximize() : window.maximize();
  });

  ipcMain.on("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.on("app:set-close-behavior", (_event, value) => {
    closeBehavior = value === "quit" ? "quit" : "background";
  });

  ipcMain.on("app:set-tray-enabled", (_event, enabled) => {
    setTrayEnabled(enabled);
  });

  ipcMain.on("app:set-global-shortcuts", (_event, settings) => {
    applyGlobalShortcutSettings(settings);
  });

  ipcMain.handle("music:lyrics", async (_event, options) => {
    const filePath = typeof options === "string" ? options : options?.filePath;
    if (typeof filePath !== "string") return { text: "", source: null };
    const lrcPath = path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.lrc`);
    const requireWordTiming = options?.mode === "network" || options?.requireWordTiming === true;
    const onlineProviders = resolveOnlineLyricProviders(options?.mode, requireWordTiming);
    const preferLocal = options?.mode === "auto";
    let localFallback = null;
    let embeddedFallback = null;
    if (!options?.force && !options?.ignoreLocal) {
      try {
        const { parseFile } = await import("music-metadata");
        const metadata = await parseFile(filePath, { duration: false, skipCovers: true });
        const lyrics = metadata.common.lyrics;
        const text = Array.isArray(lyrics)
          ? lyrics.map((item) => typeof item === "string" ? item : item?.text || "").filter(Boolean).join("\n")
          : (typeof lyrics === "string" ? lyrics : "");
        if (text) embeddedFallback = { text, source: "embedded", confidence: null };
      } catch {}
      try {
        const text = decodeTextBuffer(await fs.readFile(lrcPath));
        if (text) localFallback = { text, source: "sidecar", confidence: null };
      } catch {}
    }
    const fallbackResult = () => selectLocalLyrics(embeddedFallback?.text, localFallback?.text);
    const hasOrdinaryFallback = () => Boolean(localFallback || embeddedFallback);
    if (!onlineProviders.length || (preferLocal && hasOrdinaryFallback())) return fallbackResult();
    if (hasNativeWordTiming(embeddedFallback?.text) || hasNativeWordTiming(localFallback?.text)) return fallbackResult();
    const title = String(options.title || "").trim();
    const artist = String(options.artist || "").trim();
    const album = String(options.album || "").trim();
    const duration = Math.round(Number(options.duration) || 0);
    if (!title || !duration) return fallbackResult();
    const cache = await getOnlineLyricsCache();
    try {
      const searchOnlineProviders = async (searchOptions) => {
        let lineFallback = null;
        const searchTitle = String(searchOptions.title || "").trim();
        for (const onlineProvider of onlineProviders) {
          const providerCacheKey = JSON.stringify([onlineProvider, searchTitle, artist, album, duration]);
          let onlineLyrics = cache[providerCacheKey] && !options?.force ? cache[providerCacheKey] : null;
          if (!onlineLyrics) {
            try {
              onlineLyrics = onlineProvider === "qq"
                ? await fetchQqMusicLyrics(searchOptions)
                : await fetchNeteaseLyrics(searchOptions);
            } catch {}
          }
          if (!onlineLyrics) continue;
          cache[providerCacheKey] = onlineLyrics;
          scheduleOnlineLyricsCacheWrite();
          if (requireWordTiming && !hasNativeWordTiming(onlineLyrics.text)) {
            lineFallback ||= onlineLyrics;
            continue;
          }
          return { result: onlineLyrics, lineFallback };
        }
        return { result: null, lineFallback };
      };
      const initialOnlineSearch = await searchOnlineProviders(options);
      if (initialOnlineSearch.result) return initialOnlineSearch.result;
      if (initialOnlineSearch.lineFallback) return initialOnlineSearch.lineFallback;
      if (hasOrdinaryFallback()) return fallbackResult();
      const retryTitle = removeLiveQualifier(title);
      const publicTitles = retryTitle ? [title, retryTitle] : [title];
      const requestJson = async (url) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5500);
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": `MedoMusic/${app.getVersion()} (local Windows music player)` }
          });
          if (!response.ok) return null;
          return await response.json();
        } finally {
          clearTimeout(timeout);
        }
      };
      const normalize = (value) => String(value || "").toLowerCase()
        .normalize("NFKC")
        .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
        .replace(/[^\p{L}\p{N}]+/gu, "");
      const similarity = (left, right) => {
        const a = normalize(left);
        const b = normalize(right);
        if (!a || !b) return 0;
        if (a === b) return 1;
        if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
        const pairs = new Set(Array.from({ length: Math.max(0, a.length - 1) }, (_, index) => a.slice(index, index + 2)));
        const otherPairs = Array.from({ length: Math.max(0, b.length - 1) }, (_, index) => b.slice(index, index + 2));
        const overlap = otherPairs.filter((pair) => pairs.has(pair)).length;
        return (2 * overlap) / Math.max(1, pairs.size + otherPairs.length);
      };
      const scoreResult = (result, searchTitle) => {
        const durationScore = Math.max(0, 1 - Math.abs(Number(result.duration || 0) - duration) / Math.max(8, duration * .08));
        return similarity(searchTitle, result.trackName) * .48 +
          similarity(artist, result.artistName) * .28 +
          similarity(album, result.albumName) * .14 +
          durationScore * .1;
      };
      const searchPublicLyrics = async (searchTitles, cacheTitle) => {
        const publicCacheKey = JSON.stringify(["lrclib", cacheTitle, artist, album, duration]);
        if (cache[publicCacheKey] && !options?.force) return cache[publicCacheKey];
        let result = null;
        let confidence = 0;
        for (const searchTitle of searchTitles) {
          const exactQuery = new URLSearchParams({
            track_name: searchTitle,
            artist_name: artist,
            album_name: album,
            duration: String(duration)
          });
          result = await requestJson(`https://lrclib.net/api/get?${exactQuery}`);
          confidence = result ? scoreResult(result, searchTitle) : 0;
          if (!result || confidence < .62) {
            const searchQuery = new URLSearchParams({ track_name: searchTitle, artist_name: artist });
            let candidates = await requestJson(`https://lrclib.net/api/search?${searchQuery}`);
            if (!Array.isArray(candidates) || !candidates.length) {
              const titleOnlyQuery = new URLSearchParams({ track_name: searchTitle });
              candidates = await requestJson(`https://lrclib.net/api/search?${titleOnlyQuery}`);
            }
            if (Array.isArray(candidates) && candidates.length) {
              const ranked = candidates.map((item) => ({ item, score: scoreResult(item, searchTitle) }))
                .sort((left, right) => right.score - left.score);
              if (ranked[0].score >= .56) {
                result = ranked[0].item;
                confidence = ranked[0].score;
              }
            }
          }
          if (result && confidence >= .56) break;
          result = null;
          confidence = 0;
        }
        if (!result || confidence < .56) return null;
        const text = result.syncedLyrics || result.plainLyrics || "";
        if (!text) return null;
        const value = {
          text,
          source: "lrclib",
          confidence: Math.round(confidence * 100),
          match: {
            title: result.trackName,
            artist: result.artistName,
            album: result.albumName
          }
        };
        cache[publicCacheKey] = value;
        scheduleOnlineLyricsCacheWrite();
        return value;
      };
      const initialPublicLyrics = await searchPublicLyrics(publicTitles, title);
      if (initialPublicLyrics) return initialPublicLyrics;

      const chineseTitle = removeEnglishSuffixFromChineseTitle(title);
      if (chineseTitle) {
        const chineseOptions = { ...options, title: chineseTitle };
        const chineseOnlineSearch = await searchOnlineProviders(chineseOptions);
        if (chineseOnlineSearch.result) return chineseOnlineSearch.result;
        if (chineseOnlineSearch.lineFallback) return chineseOnlineSearch.lineFallback;
        const chineseLiveTitle = removeLiveQualifier(chineseTitle);
        const chinesePublicTitles = chineseLiveTitle ? [chineseTitle, chineseLiveTitle] : [chineseTitle];
        const chinesePublicLyrics = await searchPublicLyrics(chinesePublicTitles, chineseTitle);
        if (chinesePublicLyrics) return chinesePublicLyrics;
      }
      return fallbackResult();
    } catch {
      return fallbackResult();
    }
  });

  ipcMain.handle("lyrics:translate", async (_event, options = {}) => {
    const lines = Array.isArray(options.lines)
      ? options.lines.map((line) => String(line || "").trim()).slice(0, 240)
      : [];
    if (!lines.length) return [];
    const cacheKey = String(options.cacheKey || JSON.stringify(lines));
    const cache = await getLyricTranslationCache();
    if (Array.isArray(cache[cacheKey]) && cache[cacheKey].length === lines.length) return cache[cacheKey];
    try {
      let translated = await getNeteaseLyricTranslation(options, lines);
      if (!translated?.some(Boolean)) {
        translated = [];
        for (let index = 0; index < lines.length; index += 24) {
          const chunk = lines.slice(index, index + 24);
          translated.push(...await translateLyricBlock(chunk));
        }
      }
      cache[cacheKey] = translated;
      scheduleLyricTranslationCacheWrite();
      return translated;
    } catch {
      return [];
    }
  });

  ipcMain.on("lyrics-window:toggle", (event) => {
    setLyricsWindowVisible(!(lyricsWindow && !lyricsWindow.isDestroyed() && lyricsWindow.isVisible()), BrowserWindow.fromWebContents(event.sender));
  });

  ipcMain.on("tray:set-muted", (_event, muted) => {
    trayMuted = Boolean(muted);
    refreshTrayMenu();
  });

  ipcMain.on("lyrics-window:update", (_event, payload) => {
    lastLyricsWindowPayload = payload;
    if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
    lyricsWindow.webContents.send("lyrics-window:line", payload);
  });

  ipcMain.on("lyrics-window:set-locked", (_event, locked) => {
    setLyricsWindowLocked(Boolean(locked));
  });
  ipcMain.on("lyrics-window:reset-position", () => {
    const window = createLyricsWindow();
    const bounds = window.getBounds();
    const workArea = screen.getPrimaryDisplay().workArea;
    window.setPosition(
      workArea.x + Math.round((workArea.width - bounds.width) / 2),
      workArea.y + 4,
      true
    );
  });
  ipcMain.handle("lyrics-window:get-state", () => ({
    locked: lyricsWindowLocked,
    visible: Boolean(lyricsWindow && !lyricsWindow.isDestroyed() && lyricsWindow.isVisible())
  }));

  ipcMain.on("lyrics-window:set-size", (_event, size) => {
    const value = Math.min(64, Math.max(16, Number(size) || 28));
    trayLyricsSize = value;
    lyricsWindow?.webContents.send("lyrics-window:size", value);
  });

  ipcMain.on("lyrics-window:fit-height", (_event, height) => {
    if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
    const bounds = lyricsWindow.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const targetHeight = Math.min(180, Math.max(68, Math.ceil(Number(height) || 88)));
    if (bounds.height >= targetHeight) return;
    const y = Math.min(
      Math.max(bounds.y, workArea.y),
      workArea.y + workArea.height - targetHeight
    );
    lyricsWindow.setBounds({ x: bounds.x, y, width: bounds.width, height: targetHeight }, true);
  });

  ipcMain.on("lyrics-window:fit-width", (_event, width) => {
    if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
    const bounds = lyricsWindow.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const targetWidth = Math.min(workArea.width, Math.max(420, Math.ceil(Number(width) || 680)));
    if (Math.abs(bounds.width - targetWidth) < 2) return;
    const centerX = bounds.x + bounds.width / 2;
    const x = Math.max(
      workArea.x,
      Math.min(workArea.x + workArea.width - targetWidth, Math.round(centerX - targetWidth / 2))
    );
    lyricsWindow.setBounds({ x, y: bounds.y, width: targetWidth, height: bounds.height }, true);
  });

  ipcMain.on("lyrics-window:move", (_event, delta) => {
    if (lyricsWindowLocked || !lyricsWindow || lyricsWindow.isDestroyed()) return;
    const dx = Math.trunc(Number(delta?.x) || 0);
    const dy = Math.trunc(Number(delta?.y) || 0);
    if (!dx && !dy) return;
    const bounds = lyricsWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + Math.round(bounds.height / 2) });
    const area = display.workArea;
    const x = Math.max(area.x, Math.min(area.x + area.width - bounds.width, bounds.x + dx));
    const y = Math.max(area.y, Math.min(area.y + area.height - bounds.height, bounds.y + dy));
    lyricsWindow.setPosition(x, y, false);
  });

  ipcMain.on("lyrics-window:command", (_event, command) => {
    if (command === "hide") {
      setLyricsWindowVisible(false);
      return;
    }
    if (["previous", "toggle-play", "next"].includes(command)) {
      mainWindow?.webContents.send("tray:command", { command });
    }
  });

  ipcMain.handle("track:context-menu", (event, options = {}) => new Promise((resolve) => {
    let completed = false;
    const finish = (result) => {
      if (completed) return;
      completed = true;
      resolve(result);
    };
    const playlistItems = Array.isArray(options.playlists)
      ? options.playlists.map((name) => ({
        label: name,
        click: () => finish({ action: "add-to-playlist", playlist: name })
      }))
      : [];
    const legacyTemplate = [
      { label: "添加到播放队列", click: () => finish({ action: "add-to-queue" }) },
      { label: "播放", click: () => finish({ action: "play" }) },
      { label: "播放下一首", click: () => finish({ action: "play-next" }) },
      {
        label: "添加到",
        enabled: playlistItems.length > 0,
        submenu: playlistItems
      },
      ...(options.currentPlaylist ? [{
        label: "从播放列表中删除",
        click: () => finish({ action: "remove-from-playlist" })
      }] : [{
        label: "删除",
        click: () => finish({ action: "remove-from-library" })
      }]),
      { label: "显示专辑", click: () => finish({ action: "show-album" }) },
      { label: "编辑信息", click: () => finish({ action: "edit-info" }) },
      { label: "属性", click: () => finish({ action: "properties" }) },
      { label: "打开歌曲位置", click: () => finish({ action: "open-location" }) },
      { type: "separator" },
      { label: options.currentPlaylist ? "选择" : "选择", click: () => finish({ action: "select" }) }
    ];
    const template = [
      { label: "播放", click: () => finish({ action: "play" }) },
      { label: "添加到播放队列", click: () => finish({ action: "add-to-queue" }) },
      { label: "添加到下一首播放", click: () => finish({ action: "play-next" }) },
      ...legacyTemplate.slice(3)
    ];
    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(event.sender),
      callback: () => finish(null)
    });
  }));

  ipcMain.handle("playlist:context-menu", (event, options = {}) => new Promise((resolve) => {
    let completed = false;
    const finish = (result) => {
      if (completed) return;
      completed = true;
      resolve(result);
    };
    const playlistItems = Array.isArray(options.playlists)
      ? options.playlists.map((name) => ({
        label: name,
        click: () => finish({ action: "add-to-playlist", playlist: name })
      }))
      : [];
    const template = [
      { label: "播放", click: () => finish({ action: "play" }) },
      { label: "播放下一首", click: () => finish({ action: "play-next" }) },
      {
        label: "添加到",
        enabled: playlistItems.length > 0,
        submenu: playlistItems
      },
      ...(!options.favorites ? [
        { type: "separator" },
        { label: "重命名", click: () => finish({ action: "rename" }) },
        { label: "删除", click: () => finish({ action: "delete" }) }
      ] : [])
    ];
    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(event.sender),
      callback: () => finish(null)
    });
  }));

  ipcMain.handle("playlist:pick-target", (event, playlistNames = []) => new Promise((resolve) => {
    let completed = false;
    const finish = (name) => {
      if (completed) return;
      completed = true;
      resolve(name || null);
    };
    const template = Array.isArray(playlistNames) && playlistNames.length
      ? playlistNames.map((name) => ({ label: name, click: () => finish(name) }))
      : [{ label: "暂无播放列表", enabled: false }];
    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(event.sender),
      callback: () => finish(null)
    });
  }));

  ipcMain.handle("track:properties", async (event, filePath) => {
    if (typeof filePath !== "string") return null;
    try {
      const stat = await fs.stat(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        extension: path.extname(filePath).slice(1).toUpperCase(),
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString()
      };
    } catch {
      return null;
    }
  });

  ipcMain.handle("track:show-in-folder", async (_event, filePath) => {
    if (typeof filePath !== "string" || !filePath) return false;
    try {
      await fs.access(filePath);
      shell.showItemInFolder(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("music:metadata", async (_event, filePath) => {
    try {
      const stat = await fs.stat(filePath);
      const cache = await getMetadataCache();
      const cached = cache[filePath];
      const validCachedMetadata = cached?.mtimeMs === stat.mtimeMs && cached?.size === stat.size && cached?.coverVersion === METADATA_COVER_VERSION;
      if (validCachedMetadata) {
        try {
          if (cached.coverPath) await fs.access(cached.coverPath);
          return cached.value;
        } catch {}
      }
      const { parseFile, selectCover } = await import("music-metadata");
      const metadata = await parseFile(filePath, {
        duration: true,
        skipCovers: false
      });
      let cover = null;
      try {
        const picture = selectCover(metadata.common.picture);
        const image = picture ? nativeImage.createFromBuffer(Buffer.from(picture.data)) : null;
        if (image && !image.isEmpty()) {
          const jpeg = image.resize({ width: 800, height: 800, quality: "good" }).toJPEG(100);
          const cachedCoverPath = coverCachePath(filePath, stat);
          await fs.mkdir(path.dirname(cachedCoverPath), { recursive: true });
          await fs.writeFile(cachedCoverPath, jpeg);
          cover = `medo-media://local/cover?path=${encodeURIComponent(cachedCoverPath)}`;
        }
      } catch {
        // Broken or unsupported embedded artwork must not discard valid audio metadata.
      }
      const value = {
        title: metadata.common.title || null,
        artist: metadata.common.artist || metadata.common.albumartist || null,
        album: metadata.common.album || null,
        duration: metadata.format.duration || null,
        bitrate: metadata.format.bitrate || null,
        sampleRate: metadata.format.sampleRate || null,
        bitsPerSample: metadata.format.bitsPerSample || null,
        cover
      };
      const cachedCoverPath = cover ? new URL(cover).searchParams.get("path") : null;
      cache[filePath] = { mtimeMs: stat.mtimeMs, size: stat.size, coverVersion: METADATA_COVER_VERSION, coverPath: cachedCoverPath, value };
      scheduleMetadataCacheWrite();
      return value;
    } catch {
      return null;
    }
  });

  ipcMain.handle("music:resolve-source", async (_event, filePath) => {
    if (typeof filePath !== "string" || !filePath) return null;
    try {
      await fs.access(filePath);
      return `medo-media://local/audio?path=${encodeURIComponent(path.resolve(filePath))}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle("music:external-tracks", async (_event, filePaths = []) => {
    const validPaths = audioPathsFromArguments(filePaths);
    const tracks = [];
    for (const filePath of validPaths) {
      try {
        await fs.access(filePath);
        tracks.push(await toTrackWithFileTimes(filePath));
      } catch {
        // Ignore paths that disappeared before the renderer handled them.
      }
    }
    return tracks;
  });

  ipcMain.handle("music:clear-metadata-cache", async () => {
    metadataCache = {};
    clearTimeout(metadataCacheWriteTimer);
    try {
      await fs.rm(path.join(app.getPath("userData"), "metadata-cache.json"), { force: true });
    } catch {}
    try {
      await fs.rm(coverCacheDirectory(), { recursive: true, force: true });
    } catch {}
    return true;
  });

  ipcMain.handle("music:choose-files", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择音乐",
      properties: ["openFile", "multiSelections"],
      filters: [{
        name: "音频文件",
        extensions: [...AUDIO_EXTENSIONS].map((item) => item.slice(1))
      }]
    });
    return result.canceled ? [] : Promise.all(result.filePaths.map(toTrackWithFileTimes));
  });

  ipcMain.handle("music:choose-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择音乐文件夹",
      properties: ["openDirectory"]
    });
    if (result.canceled) return null;
    const folder = result.filePaths[0];
    const files = await walkDirectory(folder);
    return {
      folder,
      tracks: await Promise.all(files.map(async (filePath) => ({
        ...await toTrackWithFileTimes(filePath),
        sourceDirectory: folder
      })))
    };
  });

  ipcMain.handle("music:scan-folder", async (_event, folder) => {
    if (typeof folder !== "string") return null;
    try {
      const files = await walkDirectory(folder);
      return {
        folder,
        tracks: await Promise.all(files.map(async (filePath) => ({
          ...await toTrackWithFileTimes(filePath),
          sourceDirectory: folder
        })))
      };
    } catch {
      return null;
    }
  });

  ipcMain.on("music:set-watched-folders", (_event, folders) => {
    updateMusicFolderWatchers(Array.isArray(folders) ? folders : []);
  });

  ipcMain.handle("music:choose-playlist", async () => {
    const result = await dialog.showOpenDialog({
      title: "导入播放列表",
      properties: ["openFile"],
      filters: [{ name: "Groove / Zune 播放列表", extensions: ["zpl"] }]
    });
    if (result.canceled) return null;
    const playlist = await parseZpl(result.filePaths[0], toTrack);
    playlist.tracks = await Promise.all(playlist.tracks.map((track) => toTrackWithFileTimes(track.path)));
    return playlist;
  });

  ipcMain.handle("music:choose-cover", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择播放列表封面",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }]
    });
    if (result.canceled) return null;
    return pathToFileURL(result.filePaths[0]).href;
  });

  ipcMain.handle("music:load-playlist", async (_event, playlistPath) => {
    if (typeof playlistPath !== "string" || path.extname(playlistPath).toLowerCase() !== ".zpl") {
      return null;
    }
    try {
      const playlist = await parseZpl(playlistPath, toTrack);
      playlist.tracks = await Promise.all(playlist.tracks.map((track) => toTrackWithFileTimes(track.path)));
      return playlist;
    } catch {
      return null;
    }
  });

  queueExternalAudioFiles(process.argv.slice(1));
  createWindow();
  startMyFireflyExtension({
    app,
    dispatch: sendMyFireflyCommand,
    nativeControl: controlWindowFromMyFirefly
  }).then((bridge) => {
    myFireflyExtension = bridge;
    console.log(`[MyFirefly] MedoMusic extension ready at ${bridge.endpoint}`);
  }).catch((error) => {
    console.error("[MyFirefly] Failed to start MedoMusic extension:", error);
  });
  setTrayEnabled(false);
  applyGlobalShortcutSettings();
  restoreLyricsWindowVisibility();
  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (isQuitting || closeBehavior === "quit") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  closeMusicFolderWatchers();
  for (const pending of myFireflyPending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("app-quitting"));
  }
  myFireflyPending.clear();
  myFireflyExtension?.stop().catch(() => {});
  persistLyricsVisibilitySync(Boolean(lyricsWindow && !lyricsWindow.isDestroyed() && lyricsWindow.isVisible()));
});
