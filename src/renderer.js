const audio = document.querySelector("#audio");
audio.crossOrigin = "anonymous";
const trackList = document.querySelector("#track-list");
const emptyState = document.querySelector("#empty-state");
const playButton = document.querySelector("#play-button");
const progress = document.querySelector("#progress");
const volume = document.querySelector("#volume");
const favoriteButton = document.querySelector("#favorite-button");
const missingArt = "../Groove/Assets/MissingAlbumArt.jpg";
const { completeWordTimings, resolveYrcWordStart } = window.MedoLyricsTiming;

function updatePlayButtonState(playing) {
  const action = playing ? "暂停" : "播放";
  playButton.innerHTML = playing ? "&#xE769;" : "&#xE768;";
  playButton.title = action;
  playButton.setAttribute("aria-label", action);
}

let tracks = loadJson("medo.tracks", []);
let playlists = loadJson("medo.playlists", []);
let musicFolders = loadJson("medo.musicFolders", []);
let favorites = new Set(loadJson("medo.favorites", []));
let recent = loadJson("medo.recent", []);
let playStats = loadJson("medo.playStats", {});
let currentIndex = -1;
let playMode = localStorage.getItem("medo.playMode") || "sequence";
let currentView = "library";
let viewBeforePlayer = "library";
let viewBeforeSettings = null;
let currentPlaylist = null;
let currentSort = "songs";
let librarySort = localStorage.getItem("medo.librarySort") || "added";
let recentSortByPlays = localStorage.getItem("medo.recentSortByPlays") === "true";
let currentCollection = null;
let query = "";
const metadataRequests = new Map();
let metadataRenderTimer = null;
let theme = localStorage.getItem("medo.theme") || "system";
let themePrimaryColor = localStorage.getItem("medo.themePrimaryColor") || "#2864ff";
let themeSecondaryColor = localStorage.getItem("medo.themeSecondaryColor") || "#d934ff";
let desktopLyricPrimaryColor = localStorage.getItem("medo.desktopLyricPrimaryColor") || "#2864ff";
let desktopLyricSecondaryColor = localStorage.getItem("medo.desktopLyricSecondaryColor") || "#d934ff";
let displayMode = localStorage.getItem("medo.displayMode") || "thumbnail";
let closeBehavior = localStorage.getItem("medo.closeBehavior") || "background";
let globalPlayPauseShortcutEnabled = localStorage.getItem("medo.globalPlayPauseShortcutEnabled") !== "false";
let globalLyricsRefreshShortcutEnabled = localStorage.getItem("medo.globalLyricsRefreshShortcutEnabled") !== "false";
let globalPreviousShortcutEnabled = localStorage.getItem("medo.globalPreviousShortcutEnabled") !== "false";
let globalNextShortcutEnabled = localStorage.getItem("medo.globalNextShortcutEnabled") !== "false";
let lyricTranslationEnabled = localStorage.getItem("medo.lyricTranslationEnabled") !== "false";
const hasWordLyricsPreference = localStorage.getItem("medo.wordLyricsPreferenceSet") === "true";
let wordLyricsEnabled = hasWordLyricsPreference && localStorage.getItem("medo.wordLyricsEnabled") === "true";
let desktopLyricSize = Math.min(64, Math.max(16, Number(localStorage.getItem("medo.desktopLyricSize")) || 34));
if (desktopLyricSize === 28) desktopLyricSize = 34;
let detailLyricSize = Math.min(38, Math.max(18, Number(localStorage.getItem("medo.detailLyricSize")) || 26));
if (detailLyricSize === 28) detailLyricSize = 26;
let sidebarCollapsed = localStorage.getItem("medo.sidebarCollapsed") === "true";
let sidebarWidth = Math.min(360, Math.max(190, Number(localStorage.getItem("medo.sidebarWidth")) || 220));
let selectedTrackIds = new Set();
let multiSelectionMode = false;
let draggedTrackId = null;
let suppressRowClickUntil = 0;
let playbackTransitionId = 0;
let playbackQueueIds = loadJson("medo.playbackQueue", []);
let persistTimer = null;
let activeMetadataReads = 0;
const metadataWaiters = [];
let metadataObserver = null;
let searchTimer = null;
const lyricsCache = new Map();
const lyricsRequests = new Map();
const lyricRefreshProviders = new Map();
const automaticFolderScans = new Map();
const lyricTranslations = new Map();
const lyricTranslationRequests = new Map();
const hiddenLyricTranslations = new Set();
let activeLyricIndex = -1;
let lyricInspectionActive = false;
let lyricInspectionOffset = 0;
let lyricInspectionRestoreTimer = null;
let selectedLyricElement = null;
let lyricDragPointerId = null;
let lyricDragStartY = 0;
let lyricDragStartOffset = 0;
let lyricDraggedDistance = 0;
let lyricFollowAnimation = null;
let detailTrackVisible = true;
let detailQueueVisible = true;
let desktopLyricsLocked = false;
let renderedTrackLimit = 200;
let listLoadObserver = null;
let backgroundMode = document.hidden;
let lastBackgroundUiUpdate = 0;
let lastMediaSessionUpdate = 0;
let playbackGeneration = 0;
let switchingPlaybackGeneration = 0;
const playbackFailedIds = new Set();
let lastPreviousRestartAt = 0;
let lastPreviousRestartTrackId = null;
let desiredVolume = Number(volume.value);
let outputAudioContext = null;
let outputGainNode = null;
let outputLimiterNode = null;
let selectionActionsHideTimer = null;
let volumeBubbleHideTimer = null;
let volumePointerActive = false;
let dragAutoScrollFrame = null;
let dragAutoScrollVelocity = 0;
let playlistDragFrame = null;
let draggedPlaylistName = null;
let suppressPlaylistClickUntil = 0;
let queueDragFrame = null;
let draggedQueueTrackId = null;
let suppressQueueClickUntil = 0;
let detailQueueRenderFrame = null;
let detailQueueActiveTrackId = null;
let shuffleRemainingIds = [];
let shuffleHistoryIds = [];
let shuffleHistoryIndex = -1;
let shuffleQueueSignature = "";
const coverColorCache = new Map();
const favoriteMetadataPrimed = new Set();
const restoredPlaybackState = loadJson("medo.playbackState", {});
let lastPlaybackStateSave = 0;

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function ensureOutputGain() {
  if (!outputAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    outputAudioContext = new AudioContextClass({ latencyHint: "playback" });
    const source = outputAudioContext.createMediaElementSource(audio);
    outputGainNode = outputAudioContext.createGain();
    outputLimiterNode = outputAudioContext.createDynamicsCompressor();
    outputLimiterNode.threshold.value = -1;
    outputLimiterNode.knee.value = 0;
    outputLimiterNode.ratio.value = 20;
    outputLimiterNode.attack.value = 0.003;
    outputLimiterNode.release.value = 0.12;
    source.connect(outputGainNode).connect(outputLimiterNode).connect(outputAudioContext.destination);
  }
  if (outputAudioContext.state === "suspended") {
    outputAudioContext.resume().catch(() => {});
  }
  applyOutputVolume();
}

function applyOutputVolume() {
  const normalizedVolume = Math.min(1, Math.max(0, desiredVolume));
  audio.volume = normalizedVolume;
  if (outputGainNode) {
    const boostProgress = Math.max(0, (normalizedVolume - 0.7) / 0.3);
    outputGainNode.gain.value = 1 + boostProgress * 0.8;
  }
}

function setBoundedCache(cache, key, value, limit = 160) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
}

function persist() {
  const storedTracks = tracks
    .filter((track) => !track.transient)
    .map(({ transient, ...track }) => track);
  localStorage.setItem("medo.tracks", JSON.stringify(storedTracks));
  localStorage.setItem("medo.playlists", JSON.stringify(playlists));
  localStorage.setItem("medo.musicFolders", JSON.stringify(musicFolders));
  localStorage.setItem("medo.favorites", JSON.stringify([...favorites]));
  localStorage.setItem("medo.recent", JSON.stringify(recent));
  localStorage.setItem("medo.playStats", JSON.stringify(playStats));
  localStorage.setItem("medo.theme", theme);
  localStorage.setItem("medo.displayMode", displayMode);
  const persistentTrackIds = new Set(storedTracks.map((track) => track.id));
  localStorage.setItem("medo.playbackQueue", JSON.stringify(
    playbackQueueIds.filter((id) => persistentTrackIds.has(id))
  ));
  localStorage.setItem("medo.librarySort", librarySort);
  localStorage.setItem("medo.recentSortByPlays", String(recentSortByPlays));
  localStorage.setItem("medo.sidebarCollapsed", String(sidebarCollapsed));
  localStorage.setItem("medo.playMode", playMode);
  const currentTrack = tracks[currentIndex];
  const persistPlaybackState = currentTrack && !currentTrack.transient;
  localStorage.setItem("medo.playbackState", JSON.stringify({
    trackId: persistPlaybackState ? currentTrack.id : null,
    currentTime: persistPlaybackState ? (Number(audio.currentTime) || 0) : 0,
    playing: Boolean(persistPlaybackState && audio.src && !audio.paused),
    volume: desiredVolume,
    muted: audio.muted
  }));
}

function normalizedSongIdentity(track) {
  return [
    String(track?.title || "").trim().toLocaleLowerCase("zh-CN"),
    String(track?.artist || "").trim().toLocaleLowerCase("zh-CN"),
    String(track?.album || "").trim().toLocaleLowerCase("zh-CN")
  ].join("\u001f");
}

function tracksWithSameSongIdentity(track) {
  const identity = normalizedSongIdentity(track);
  return tracks.filter((candidate) =>
    !candidate.transient && normalizedSongIdentity(candidate) === identity
  );
}

function mergedPlayCount(track) {
  if (!track || track.transient) return 0;
  const identity = normalizedSongIdentity(track);
  if (Number.isFinite(playStats[identity])) return playStats[identity];
  const initial = tracksWithSameSongIdentity(track)
    .reduce((total, candidate) => total + (Number(candidate.playCount) || 0), 0);
  playStats[identity] = initial;
  return initial;
}

function preferredRecentVersion(track) {
  return tracksWithSameSongIdentity(track)
    .sort((left, right) => {
      const leftFlac = String(left.format || "").toUpperCase() === "FLAC" ? 1 : 0;
      const rightFlac = String(right.format || "").toUpperCase() === "FLAC" ? 1 : 0;
      return rightFlac - leftFlac;
    })[0] || track;
}

function normalizeRecentVersions() {
  const normalized = [];
  const seen = new Set();
  recent.forEach((id) => {
    const track = tracks.find((candidate) => candidate.id === id && !candidate.transient);
    if (!track) return;
    const identity = normalizedSongIdentity(track);
    if (seen.has(identity)) return;
    seen.add(identity);
    normalized.push(preferredRecentVersion(track).id);
  });
  recent = normalized.slice(0, 100);
}

function scheduleMetadataRender() {
  clearTimeout(metadataRenderTimer);
  metadataRenderTimer = setTimeout(render, 240);
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 300);
}

function acquireMetadataSlot() {
  if (activeMetadataReads < 3) {
    activeMetadataReads += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => metadataWaiters.push(resolve));
}

function releaseMetadataSlot() {
  const next = metadataWaiters.shift();
  if (next) next();
  else activeMetadataReads -= 1;
}

function titleForView() {
  if (currentView === "playlists") return "播放列表";
  if (currentView === "favorites") return "喜欢";
  if (currentView === "settings") return "设置";
  if (currentPlaylist) return currentPlaylist;
  if (currentView === "recent") return "最近播放";
  if (currentView === "now") return "正在播放";
  return "我的音乐";
}

function applyTheme(nextTheme) {
  theme = ["system", "light", "dark"].includes(nextTheme) ? nextTheme : "system";
  const resolvedTheme = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : theme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = theme;
  window.medo.setTitleBarTheme(theme);
  document.querySelectorAll(".theme-option").forEach((button) => {
    const active = button.dataset.themeValue === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  const shell = document.querySelector(".app-shell");
  if (shell && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    shell.getAnimations().forEach((animation) => animation.cancel());
    shell.animate(
      [{ opacity: 0.86 }, { opacity: 1 }],
      { duration: 150, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
    );
  }
}

function applyThemeColors(primary = themePrimaryColor, secondary = themeSecondaryColor, save = false) {
  const validColor = /^#[0-9a-f]{6}$/i;
  themePrimaryColor = validColor.test(primary) ? primary : "#2864ff";
  themeSecondaryColor = validColor.test(secondary) ? secondary : "#d934ff";
  const root = document.documentElement;
  root.style.setProperty("--accent", themePrimaryColor);
  root.style.setProperty("--accent-secondary", themeSecondaryColor);
  root.style.setProperty("--accent-soft", `color-mix(in srgb, ${themePrimaryColor} 15%, transparent)`);
  root.style.setProperty("--accent-gradient", `linear-gradient(105deg, ${themePrimaryColor} 0%, color-mix(in srgb, ${themePrimaryColor} 46%, ${themeSecondaryColor}) 50%, ${themeSecondaryColor} 100%)`);
  root.style.setProperty("--accent-gradient-hover", `linear-gradient(105deg, color-mix(in srgb, ${themePrimaryColor} 84%, white) 0%, #8657ff 48%, color-mix(in srgb, ${themeSecondaryColor} 84%, white) 100%)`);
  document.querySelector("#theme-primary-color").value = themePrimaryColor;
  document.querySelector("#theme-secondary-color").value = themeSecondaryColor;
  if (save) {
    localStorage.setItem("medo.themePrimaryColor", themePrimaryColor);
    localStorage.setItem("medo.themeSecondaryColor", themeSecondaryColor);
  }
}

function applyDisplayMode(nextMode) {
  displayMode = nextMode === "compact" ? "compact" : "thumbnail";
  const main = document.querySelector("main");
  main.classList.toggle("display-compact", displayMode === "compact");
  main.classList.toggle("display-thumbnail", displayMode === "thumbnail");
  document.querySelectorAll(".display-option").forEach((button) => {
    const active = button.dataset.displayValue === displayMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
}

function applyCloseBehavior(value) {
  closeBehavior = value === "quit" ? "quit" : "background";
  localStorage.setItem("medo.closeBehavior", closeBehavior);
  window.medo.setCloseBehavior(closeBehavior);
  document.querySelectorAll(".close-behavior-option").forEach((button) => {
    const active = button.dataset.closeValue === closeBehavior;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
}

function reloadCurrentLyrics({ networkProvider = null } = {}) {
  const track = tracks[currentIndex];
  if (!track) return Promise.resolve();
  lyricsCache.delete(track.id);
  lyricTranslations.delete(track.id);
  const request = ensureLyrics(track, Boolean(networkProvider), networkProvider);
  if (currentView === "player") renderLyrics(track);
  return request;
}

function applyGlobalShortcutSettings(type, enabled) {
  if (type === "playPause") {
    globalPlayPauseShortcutEnabled = Boolean(enabled);
    localStorage.setItem("medo.globalPlayPauseShortcutEnabled", String(globalPlayPauseShortcutEnabled));
  } else if (type === "lyricsRefresh") {
    globalLyricsRefreshShortcutEnabled = Boolean(enabled);
    localStorage.setItem("medo.globalLyricsRefreshShortcutEnabled", String(globalLyricsRefreshShortcutEnabled));
  } else if (type === "previous") {
    globalPreviousShortcutEnabled = Boolean(enabled);
    localStorage.setItem("medo.globalPreviousShortcutEnabled", String(globalPreviousShortcutEnabled));
  } else if (type === "next") {
    globalNextShortcutEnabled = Boolean(enabled);
    localStorage.setItem("medo.globalNextShortcutEnabled", String(globalNextShortcutEnabled));
  }
  document.querySelectorAll(".global-play-shortcut-option").forEach((button) => {
    const active = (button.dataset.enabled === "true") === globalPlayPauseShortcutEnabled;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  document.querySelectorAll(".global-lyrics-shortcut-option").forEach((button) => {
    const active = (button.dataset.enabled === "true") === globalLyricsRefreshShortcutEnabled;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  document.querySelectorAll(".global-previous-shortcut-option").forEach((button) => {
    const active = (button.dataset.enabled === "true") === globalPreviousShortcutEnabled;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  document.querySelectorAll(".global-next-shortcut-option").forEach((button) => {
    const active = (button.dataset.enabled === "true") === globalNextShortcutEnabled;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  window.medo.setGlobalShortcuts({
    playPause: globalPlayPauseShortcutEnabled,
    lyricsRefresh: globalLyricsRefreshShortcutEnabled,
    previous: globalPreviousShortcutEnabled,
    next: globalNextShortcutEnabled
  });
}

function refreshCurrentLyricsFromNetwork() {
  const track = tracks[currentIndex];
  if (!track) return Promise.resolve();
  const provider = lyricRefreshProviders.get(track.id) || "netease";
  lyricRefreshProviders.set(track.id, provider === "qq" ? "netease" : "qq");
  return reloadCurrentLyrics({ networkProvider: provider });
}

function applyLyricTranslationSetting(enabled) {
  lyricTranslationEnabled = Boolean(enabled);
  localStorage.setItem("medo.lyricTranslationEnabled", String(lyricTranslationEnabled));
  document.querySelectorAll(".lyric-translation-option").forEach((button) => {
    const active = (button.dataset.translationValue === "on") === lyricTranslationEnabled;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  const track = tracks[currentIndex];
  if (currentView === "player" && track) {
    renderLyrics(track);
    if (lyricTranslationEnabled) ensureLyricTranslation(track);
  }
}

function applyDesktopLyricSize(value) {
  desktopLyricSize = Math.min(64, Math.max(16, Number(value) || 34));
  localStorage.setItem("medo.desktopLyricSize", String(desktopLyricSize));
  document.querySelector("#desktop-lyric-size").value = desktopLyricSize;
  document.querySelector("#desktop-lyric-size-value").textContent = `${desktopLyricSize} px`;
  window.medo.setLyricsWindowSize(desktopLyricSize);
}

function applyDesktopLyricColors(primary = desktopLyricPrimaryColor, secondary = desktopLyricSecondaryColor, save = false) {
  const validColor = /^#[0-9a-f]{6}$/i;
  desktopLyricPrimaryColor = validColor.test(primary) ? primary : "#2864ff";
  desktopLyricSecondaryColor = validColor.test(secondary) ? secondary : "#d934ff";
  document.querySelector("#desktop-lyric-primary-color").value = desktopLyricPrimaryColor;
  document.querySelector("#desktop-lyric-secondary-color").value = desktopLyricSecondaryColor;
  if (save) {
    localStorage.setItem("medo.desktopLyricPrimaryColor", desktopLyricPrimaryColor);
    localStorage.setItem("medo.desktopLyricSecondaryColor", desktopLyricSecondaryColor);
  }
  window.medo.updateLyricsWindow({
    colorsOnly: true,
    primary: desktopLyricPrimaryColor,
    secondary: desktopLyricSecondaryColor
  });
}

function applyDetailLyricSize(value) {
  detailLyricSize = Math.min(38, Math.max(18, Number(value) || 26));
  localStorage.setItem("medo.detailLyricSize", String(detailLyricSize));
  document.documentElement.style.setProperty("--detail-lyric-size", `${detailLyricSize}px`);
  document.querySelector("#detail-lyric-size").value = detailLyricSize;
  document.querySelector("#detail-lyric-size-value").textContent = `${detailLyricSize} px`;
}

function syncDesktopLyricLockSetting(locked) {
  desktopLyricsLocked = Boolean(locked);
  document.querySelectorAll(".desktop-lyric-lock-option").forEach((button) => {
    const active = button.dataset.lockedValue === String(desktopLyricsLocked);
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
}

function applyWordLyricsSetting(enabled, userInitiated = false) {
  wordLyricsEnabled = Boolean(enabled);
  localStorage.setItem("medo.wordLyricsEnabled", String(wordLyricsEnabled));
  if (userInitiated) localStorage.setItem("medo.wordLyricsPreferenceSet", "true");
  document.querySelectorAll(".word-lyrics-option").forEach((button) => {
    const active = (button.dataset.wordLyricsValue === "on") === wordLyricsEnabled;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  const track = tracks[currentIndex];
  if (userInitiated && track) reloadCurrentLyrics({ networkProvider: wordLyricsEnabled ? "network" : null });
  else if (track && currentView === "player") renderLyrics(track);
  activeLyricIndex = -1;
  updateLyricsAtTime();
}

function parseLyrics(text, duration = 0) {
  let offset = 0;
  const lines = [];
  const metadataLine = /^\[(ar|ti|al|by|re|ve|length):/i;
  for (const rawLine of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (/^\s*\{"t":\d+,"c":\[/.test(rawLine)) {
      try {
        const information = JSON.parse(rawLine.trim());
        const text = Array.isArray(information.c)
          ? information.c.map((item) => String(item?.tx || "")).join("").trim()
          : "";
        const start = Number(information.t) / 1000 + offset / 1000;
        if (text && Number.isFinite(start)) lines.push({ start, text, information: true });
      } catch {}
      continue;
    }
    const offsetMatch = rawLine.match(/^\[offset:([+-]?\d+)\]/i);
    if (offsetMatch) {
      offset = Number(offsetMatch[1]) || 0;
      continue;
    }
    if (metadataLine.test(rawLine)) continue;
    const yrcLine = rawLine.match(/^\[(\d+),(\d+)\](.*)$/);
    if (yrcLine) {
      const rawLineStart = Number(yrcLine[1]) / 1000;
      const lineStart = rawLineStart + offset / 1000;
      let words = [...yrcLine[3].matchAll(/\((\d+),(\d+),\d+\)([^()]*)/g)].map((word) => {
        const rawStart = Number(word[1]) / 1000;
        const start = resolveYrcWordStart(rawLineStart, rawStart, offset);
        return { start, end: start + Number(word[2]) / 1000, text: word[3] };
      }).filter((word) => word.text);
      if (!words.length) {
        words = [...yrcLine[3].matchAll(/([^()]*)\((\d+),(\d+)\)/g)].map((word) => {
          const start = Number(word[2]) / 1000 + offset / 1000;
          return { start, end: start + Number(word[3]) / 1000, text: word[1] };
        }).filter((word) => word.text);
      }
      const lyric = words.map((word) => word.text).join("").trim();
      if (lyric) lines.push({ start: lineStart, text: lyric, words });
      continue;
    }
    const stamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const content = rawLine.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, "").trim();
    const wordMatches = [...content.matchAll(/<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g)];
    const words = wordMatches.map((word) => ({
      start: Number(word[1]) * 60 + Number(word[2]) + (word[3] ? Number(word[3]) / (10 ** word[3].length) : 0) + offset / 1000,
      text: word[4]
    })).filter((word) => word.text);
    const lyric = words.length ? words.map((word) => word.text).join("") : content;
    if (!stamps.length) {
      if (lyric) lines.push({ start: null, text: lyric });
      continue;
    }
    for (const stamp of stamps) {
      const fraction = stamp[3] ? Number(stamp[3]) / (10 ** stamp[3].length) : 0;
      lines.push({
        start: Number(stamp[1]) * 60 + Number(stamp[2]) + fraction + offset / 1000,
        text: lyric || "♪",
        words
      });
    }
  }
  const synced = lines.some((line) => line.start !== null);
  if (!synced && Number.isFinite(duration) && duration > 20 && lines.length > 1) {
    const start = Math.min(12, duration * .06);
    const span = Math.max(1, duration - start - Math.min(8, duration * .04));
    const weights = lines.map((line) => Math.max(2.2, [...line.text].length + (/[，。！？,.!?]$/.test(line.text) ? 4 : 0)));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let elapsedWeight = 0;
    lines.forEach((line, index) => {
      line.start = start + span * elapsedWeight / totalWeight;
      line.estimated = true;
      elapsedWeight += weights[index];
    });
  }
  const hasTimeline = lines.some((line) => line.start !== null);
  if (hasTimeline) lines.sort((a, b) => (a.start ?? Number.MAX_VALUE) - (b.start ?? Number.MAX_VALUE));
  const timedLines = hasTimeline ? completeWordTimings(lines, duration) : lines;
  const level = timedLines.some((line) => line.words?.length) ? "word" : hasTimeline ? "line" : "plain";
  return { synced: hasTimeline, level, lines: timedLines };
}

async function ensureLyrics(track, force = false, modeOverride = null) {
  if (!track) return;
  const requestMode = modeOverride || (wordLyricsEnabled ? "network" : "auto");
  const networkOnlyRequest = wordLyricsEnabled || Boolean(modeOverride);
  const cachedLyrics = lyricsCache.get(track.id);
  const compatibleCache = cachedLyrics && (!networkOnlyRequest || cachedLyrics.networkOnly === true);
  const existingRequest = lyricsRequests.get(track.id);
  const compatibleRequest = existingRequest && (!networkOnlyRequest || existingRequest.networkOnly === true);
  if (!force && (compatibleCache || compatibleRequest)) return existingRequest;
  if (cachedLyrics && !compatibleCache) lyricsCache.delete(track.id);
  if (force) {
    lyricsCache.delete(track.id);
    lyricTranslations.delete(track.id);
    lyricTranslationRequests.delete(track.id);
  }
  let request;
  request = (async () => {
    if (requestMode !== "local" && (!track.metadataLoaded || !track.duration)) {
      await loadMetadata(track);
    }
    return window.medo.readLyrics({
      filePath: track.path,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration || audio.duration,
      mode: requestMode,
      force,
      ignoreLocal: wordLyricsEnabled || Boolean(modeOverride)
    });
  })()
    .then((result) => {
      if (lyricsRequests.get(track.id) !== request) return;
      setBoundedCache(lyricsCache, track.id, {
        ...parseLyrics(result?.text, track.duration || audio.duration),
        source: result?.source || null,
        confidence: result?.confidence || null,
        match: result?.match || null,
        networkOnly: networkOnlyRequest
      });
      if (lyricTranslationEnabled) ensureLyricTranslation(track);
    })
    .catch(() => {
      if (lyricsRequests.get(track.id) === request) setBoundedCache(lyricsCache, track.id, { synced: false, lines: [], networkOnly: networkOnlyRequest });
    })
    .finally(() => {
      if (lyricsRequests.get(track.id) !== request) return;
      lyricsRequests.delete(track.id);
      if (tracks[currentIndex]?.id !== track.id) return;
      const loadedLyrics = lyricsCache.get(track.id);
      window.medo.updateLyricsWindow({
        title: track.title,
        artist: track.artist,
        album: track.album,
        noLyrics: !loadedLyrics?.lines?.length,
        playing: !audio.paused
      });
      if (currentView === "player") renderLyrics(track);
      else {
        activeLyricIndex = -1;
        updateLyricsAtTime();
      }
    });
  request.networkOnly = networkOnlyRequest;
  lyricsRequests.set(track.id, request);
  return request;
}

function lyricsNeedChineseTranslation(lines = []) {
  const text = lines.map((line) => line.text).join("").replace(/[♪\s\d\p{P}\p{S}]/gu, "");
  if (!text) return false;
  const han = (text.match(/\p{Script=Han}/gu) || []).length;
  const hasJapanese = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
  const hasKorean = /\p{Script=Hangul}/u.test(text);
  if (hasJapanese || hasKorean) return true;
  return han / [...text].length < .45;
}

async function ensureLyricTranslation(track) {
  const lyrics = lyricsCache.get(track?.id);
  if (!lyricTranslationEnabled || !track || !lyrics?.lines?.length ||
      !lyricsNeedChineseTranslation(lyrics.lines) || lyricTranslations.has(track.id) ||
      lyricTranslationRequests.has(track.id)) return;
  let request;
  request = window.medo.translateLyrics({
    cacheKey: JSON.stringify([track.title, track.artist, track.album, lyrics.lines.map((line) => line.text)]),
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration || audio.duration,
    starts: lyrics.lines.map((line) => line.start),
    lines: lyrics.lines.map((line) => line.text)
  }).then((translated) => {
    if (lyricTranslationRequests.get(track.id) !== request || lyricsCache.get(track.id) !== lyrics) return;
    if (!Array.isArray(translated) || translated.length !== lyrics.lines.length || !translated.some(Boolean)) return;
    setBoundedCache(lyricTranslations, track.id, translated);
    if (tracks[currentIndex]?.id !== track.id) return;
    activeLyricIndex = -1;
    if (currentView === "player") renderLyrics(track);
    else updateLyricsAtTime();
  }).finally(() => {
    if (lyricTranslationRequests.get(track.id) === request) lyricTranslationRequests.delete(track.id);
  });
  lyricTranslationRequests.set(track.id, request);
}

function renderLyrics(track) {
  const container = document.querySelector("#lyrics-lines");
  selectedLyricElement?.classList.remove("selected");
  selectedLyricElement = null;
  const lyrics = lyricsCache.get(track.id);
  const translationButton = document.querySelector("#lyric-translation-toggle");
  activeLyricIndex = -1;
  container.style.transform = "translateY(0)";
  container.classList.remove("unsynced");
  if (!lyrics) {
    translationButton.hidden = true;
    container.innerHTML = '<p class="lyrics-empty">正在查找歌词</p>';
    return;
  }
  if (!lyrics.lines.length) {
    translationButton.hidden = true;
    container.innerHTML = '<p class="lyrics-empty"><strong>未找到歌词</strong><span>可将同名 .lrc 文件放在歌曲旁边</span></p>';
    window.medo.updateLyricsWindow({
      title: track.title,
      artist: track.artist,
      album: track.album,
      noLyrics: true,
      playing: !audio.paused
    });
    return;
  }
  const translationAvailable = lyricsNeedChineseTranslation(lyrics.lines);
  const translations = lyricTranslations.get(track.id);
  const showTranslations = lyricTranslationEnabled && translationAvailable &&
    !hiddenLyricTranslations.has(track.id) && Array.isArray(translations);
  translationButton.hidden = !lyricTranslationEnabled || !translationAvailable;
  const translationTitle = showTranslations ? "隐藏中文翻译" : "显示中文翻译";
  translationButton.title = translationTitle;
  translationButton.setAttribute("aria-label", translationTitle);
  translationButton.classList.toggle("active", showTranslations);
  if (lyricTranslationEnabled && translationAvailable && !translations) ensureLyricTranslation(track);
  container.classList.toggle("unsynced", !lyrics.synced);
  container.innerHTML = "";
  lyrics.lines.forEach((line, lineIndex) => {
    const item = document.createElement(lyrics.synced ? "button" : "p");
    item.className = "lyric-line";
    if (line.start !== null) item.dataset.start = String(line.start);
    if (wordLyricsEnabled && line.words?.length) {
      const karaoke = document.createElement("span");
      karaoke.className = "lyric-karaoke";
      karaoke.innerHTML = '<span class="lyric-karaoke-base"></span><span class="lyric-karaoke-fill"></span>';
      karaoke.querySelector(".lyric-karaoke-base").textContent = line.text;
      karaoke.querySelector(".lyric-karaoke-fill").textContent = line.text;
      item.append(karaoke);
    } else {
      item.textContent = line.text;
    }
    if (showTranslations && translations[lineIndex]) {
      const translation = document.createElement("span");
      if (wordLyricsEnabled && line.words?.length) {
        translation.className = "lyric-translation lyric-karaoke lyric-translation-karaoke";
        translation.innerHTML = '<span class="lyric-karaoke-base"></span><span class="lyric-karaoke-fill"></span>';
        translation.querySelector(".lyric-karaoke-base").textContent = translations[lineIndex];
        translation.querySelector(".lyric-karaoke-fill").textContent = translations[lineIndex];
      } else {
        translation.className = "lyric-translation";
        translation.textContent = translations[lineIndex];
      }
      item.append(translation);
    }
    container.append(item);
  });
  updateLyricsAtTime();
}

function updateWordHighlight(line, element) {
  if (!line?.words?.length || !element) return;
  const karaoke = element.querySelector(".lyric-karaoke");
  if (!karaoke) return;
  const totalCharacters = Math.max(1, line.words.reduce((total, word) => total + [...word.text].length, 0));
  let completedCharacters = 0;
  for (let index = 0; index < line.words.length; index += 1) {
    const word = line.words[index];
    const start = Number(word.start) || 0;
    const nextStart = Number(line.words[index + 1]?.start);
    const end = Number(word.end) > start ? Number(word.end) : Number.isFinite(nextStart) ? nextStart : start + .48;
    const progress = Math.max(0, Math.min(1, (audio.currentTime + .04 - start) / Math.max(.08, end - start)));
    const length = [...word.text].length;
    if (progress >= 1) completedCharacters += length;
    else {
      completedCharacters += length * progress;
      break;
    }
  }
  element.style.setProperty("--line-progress", `${Math.max(0, Math.min(100, completedCharacters / totalCharacters * 100))}%`);
}

function updateDesktopLyrics(track, lyrics, index) {
  const line = lyrics.lines[index];
  window.medo.updateLyricsWindow({
    current: line?.text,
    words: wordLyricsEnabled ? line?.words?.map((word) => ({ start: word.start, end: word.end, text: word.text })) || [] : [],
    position: audio.currentTime,
    currentTranslation: lyricTranslationEnabled && !hiddenLyricTranslations.has(track.id)
      ? lyricTranslations.get(track.id)?.[index] : null,
    next: lyrics.lines[index + 1]?.text,
    title: track.title,
    artist: track.artist,
    album: track.album,
    primary: desktopLyricPrimaryColor,
    secondary: desktopLyricSecondaryColor,
    noLyrics: false,
    playing: !audio.paused
  });
}

function animateLyricFollow(container, active) {
  const target = `translateY(${-active.offsetTop - active.offsetHeight / 2}px)`;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    container.style.transform = target;
    return;
  }
  const liveTransform = getComputedStyle(container).transform;
  lyricFollowAnimation?.cancel();
  container.style.transform = target;
  lyricFollowAnimation = container.animate(
    [
      { transform: liveTransform === "none" ? target : liveTransform },
      { transform: target }
    ],
    { duration: 440, easing: "cubic-bezier(.18,.82,.22,1)" }
  );
  active.getAnimations().forEach((animation) => animation.cancel());
  active.animate(
    [
      { opacity: .68, transform: "translateY(5px) scale(.975)" },
      { opacity: 1, transform: "translateY(0) scale(1)" }
    ],
    { duration: 380, easing: "cubic-bezier(.18,.82,.22,1)" }
  );
}

function updateLyricsAtTime() {
  const track = tracks[currentIndex];
  const lyrics = track && lyricsCache.get(track.id);
  if (!lyrics?.synced || !lyrics.lines.length) return;
  let index = -1;
  for (let i = 0; i < lyrics.lines.length; i += 1) {
    if (lyrics.lines[i].start > audio.currentTime + 0.08) break;
    index = i;
  }
  const elements = [...document.querySelectorAll("#lyrics-lines .lyric-line")];
  if (index === activeLyricIndex) {
    updateWordHighlight(lyrics.lines[index], elements[index]);
    updateDesktopLyrics(track, lyrics, index);
    return;
  }
  activeLyricIndex = index;
  const container = document.querySelector("#lyrics-lines");
  elements.forEach((element, itemIndex) => {
    element.classList.toggle("active", itemIndex === index);
    element.classList.toggle("past", itemIndex < index);
    element.classList.toggle("near", Math.abs(itemIndex - index) === 1);
    if (itemIndex !== index) element.style.setProperty("--line-progress", "0%");
  });
  const active = elements[index];
  updateDesktopLyrics(track, lyrics, index);
  if (active && !lyricInspectionActive) {
    animateLyricFollow(container, active);
    updateWordHighlight(lyrics.lines[index], active);
  }
}

function visibleTracks() {
  if (currentView === "recent") normalizeRecentVersions();
  const selectedPlaylist = playlists.find((playlist) => playlist.name === currentPlaylist);
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  let result = currentPlaylist && selectedPlaylist?.trackIds?.length
    ? selectedPlaylist.trackIds
      .map((id) => tracksById.get(id))
      .filter(Boolean)
    : [...tracks];

  result = result.filter((track) => {
    if (track.transient && !currentPlaylist && currentView !== "now") return false;
    if (currentPlaylist && !selectedPlaylist?.trackIds?.length && !track.playlists?.includes(currentPlaylist)) return false;
    if (currentView === "recent" && !recent.includes(track.id)) return false;
    if (currentView === "now" && !playbackQueueIds.includes(track.id)) return false;
    if (currentView === "favorites" && !favorites.has(track.id)) return false;
    if (currentCollection) {
      const value = currentCollection.type === "artists" ? (track.artist || "未知艺术家") : (track.album || "未知专辑");
      if (value !== currentCollection.name) return false;
      if (currentCollection.format && String(track.format || "").toUpperCase() !== currentCollection.format) return false;
    }
    return `${track.title} ${track.artist || ""} ${track.album} ${(track.playlists || []).join(" ")}`
      .toLowerCase().includes(query);
  });

  // A playlist is an explicitly ordered sequence. Never apply library sorting
  // to it, otherwise the order stored in Groove's ZPL file is lost.
  if (currentView === "now") {
    result = playbackQueueIds.map((id) => result.find((track) => track.id === id)).filter(Boolean);
  } else if (currentView === "recent") {
    result = recent.map((id) => result.find((track) => track.id === id)).filter(Boolean);
    if (recentSortByPlays) {
      result.sort((left, right) => mergedPlayCount(right) - mergedPlayCount(left));
    }
  } else if (!currentPlaylist && !currentCollection && currentView === "library") {
    const comparators = {
      added: (a, b) => (b.createdAt || b.addedAt || 0) - (a.createdAt || a.addedAt || 0),
      az: (a, b) => a.title.localeCompare(b.title, "zh-CN"),
      artist: (a, b) => (a.artist || "").localeCompare(b.artist || "", "zh-CN"),
      album: (a, b) => (a.album || "").localeCompare(b.album || "", "zh-CN")
    };
    result.sort(comparators[librarySort] || comparators.added);
  }
  return result;
}

async function loadMetadata(track) {
  if (track.metadataLoaded || metadataRequests.has(track.id)) {
    return metadataRequests.get(track.id);
  }
  const request = (async () => {
    await acquireMetadataSlot();
    let metadata;
    try {
      metadata = await window.medo.readMetadata(track.path);
    } catch {
      metadata = null;
    } finally {
      releaseMetadataSlot();
      metadataRequests.delete(track.id);
    }
    const previousArtist = track.artist;
    const previousAlbum = track.album;
    track.metadataLoaded = true;
    if (metadata) {
      if (!track.userEditedMetadata) {
        track.title = metadata.title || track.title;
        track.artist = metadata.artist || track.artist || "未知艺术家";
        track.album = metadata.album || track.album;
      }
      track.cover = metadata.cover || null;
      track.duration = metadata.duration || null;
      track.bitrate = metadata.bitrate || null;
      track.sampleRate = metadata.sampleRate || null;
      track.bitsPerSample = metadata.bitsPerSample || null;
    }
    schedulePersist();
    const collectionIdentityChanged =
      (currentSort === "artists" && previousArtist !== track.artist) ||
      (currentSort === "albums" && previousAlbum !== track.album);
    if (!currentPlaylist && (currentSort === "artists" || currentSort === "albums") && collectionIdentityChanged) {
      scheduleMetadataRender();
    } else {
      updateTrackPresentation(track);
    }
    if ((currentPlaylist && track.playlists?.includes(currentPlaylist)) ||
        (currentView === "favorites" && favorites.has(track.id))) {
      renderPlaylistHero(visibleTracks());
    }
    if (tracks[currentIndex]?.id === track.id) updateNowPlaying(track);
    return metadata;
  })();
  metadataRequests.set(track.id, request);
  return request;
}

function updateTrackPresentation(track) {
  document.querySelectorAll(".track-row").forEach((row) => {
    if (row.dataset.trackId !== track.id) return;
    const cover = row.querySelector(".row-cover");
    if (cover) cover.src = track.cover || missingArt;
    row.querySelector(".track-title").textContent = track.title;
    row.querySelector(".track-album")?.replaceChildren();
    row.querySelector(".row-artist").textContent = track.artist || "未知艺术家";
    row.querySelector(".row-album-name").textContent = track.album || "未知专辑";
  });
  document.querySelectorAll(".collection-card").forEach((card) => {
    if (card.dataset.trackId === track.id) card.querySelector(".collection-cover").src = track.cover || missingArt;
  });
  document.querySelectorAll(".playlist-overview-item").forEach((card) => {
    if (card.dataset.trackId === track.id) card.querySelector(".playlist-overview-cover").src = track.cover || missingArt;
  });
}

function observeMetadataRow(row, track) {
  if (track.metadataLoaded) return;
  metadataObserver.observe(row);
}

function renderPlaylists() {
  const container = document.querySelector("#playlist-list");
  const favoriteSlot = document.querySelector("#playlist-favorite-slot");
  container.innerHTML = "";
  favoriteSlot.innerHTML = "";
  document.querySelector("#playlists-overview").classList.toggle("active", currentView === "playlists");
  const liked = document.createElement("button");
  liked.className = `playlist-item playlist-favorites${currentView === "favorites" ? " active" : ""}`;
  liked.innerHTML = `<span class="playlist-heart">${currentView === "favorites" ? "♥" : "♡"}</span><span class="playlist-item-name">喜欢</span><span class="playlist-count"></span>`;
  liked.querySelector(".playlist-count").textContent = favorites.size;
  liked.addEventListener("click", () => {
    selectedTrackIds.clear();
    currentPlaylist = null;
    currentCollection = null;
    currentView = "favorites";
    setActiveNav(null);
    render();
    visibleTracks().slice(0, 80).forEach((track) => {
      if (favoriteMetadataPrimed.has(track.id)) return;
      favoriteMetadataPrimed.add(track.id);
      if (!track.cover) track.metadataLoaded = false;
      loadMetadata(track).catch(() => {});
    });
    animateViewSurface();
  });
  liked.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showPlaylistContextMenu(null, true);
  });
  favoriteSlot.append(liked);
  playlists.forEach((playlist) => {
    const button = document.createElement("button");
    button.className = `playlist-item${currentPlaylist === playlist.name ? " active" : ""}`;
    button.dataset.playlistName = playlist.name;
    button.innerHTML = '<span class="playlist-item-name"></span><span class="playlist-count"></span>';
    button.querySelector(".playlist-item-name").textContent = playlist.name;
    button.querySelector(".playlist-count").textContent = playlist.trackIds?.length || 0;
    button.title = playlist.path;
    button.addEventListener("click", () => {
      if (Date.now() < suppressPlaylistClickUntil) return;
      currentPlaylist = playlist.name;
      currentCollection = null;
      currentView = "library";
      setActiveNav(null);
      render();
      animateViewSurface();
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showPlaylistContextMenu(playlist.name, false);
    });
    attachPlaylistDrag(button, playlist.name);
    container.append(button);
  });
}

function attachPlaylistDrag(button, playlistName) {
  let longPressTimer = null;
  let pointerId = null;
  let targetName = null;
  let preview = null;
  let pointerX = 0;
  let pointerY = 0;
  const list = document.querySelector("#playlist-list");
  const updateTarget = () => {
    document.querySelectorAll(".playlist-item.playlist-drag-over")
      .forEach((item) => item.classList.remove("playlist-drag-over"));
    const target = document.elementFromPoint(pointerX, pointerY)?.closest(".playlist-item[data-playlist-name]");
    targetName = target?.dataset.playlistName || null;
    if (targetName && targetName !== playlistName) target.classList.add("playlist-drag-over");
  };
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    pointerX = event.clientX;
    pointerY = event.clientY;
    longPressTimer = setTimeout(() => {
      draggedPlaylistName = playlistName;
      button.setPointerCapture(pointerId);
      button.classList.add("playlist-dragging");
      document.body.classList.add("playlist-drag-active");
      preview = document.createElement("div");
      preview.className = "playlist-drag-preview";
      preview.innerHTML = '<span class="glyph">&#xE8FD;</span><strong></strong><span class="glyph drag-grip">&#xE700;</span>';
      preview.querySelector("strong").textContent = playlistName;
      preview.style.left = `${pointerX + 14}px`;
      preview.style.top = `${pointerY + 12}px`;
      document.body.appendChild(preview);
    }, 320);
  });
  button.addEventListener("pointermove", (event) => {
    if (draggedPlaylistName !== playlistName || event.pointerId !== pointerId) return;
    event.preventDefault();
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (preview) {
      preview.style.left = `${pointerX + 14}px`;
      preview.style.top = `${pointerY + 12}px`;
    }
    updateTarget();
    const bounds = list.getBoundingClientRect();
    const edgeZone = Math.min(72, Math.max(42, bounds.height * .2));
    const topIntensity = Math.max(0, Math.min(1, (bounds.top + edgeZone - pointerY) / edgeZone));
    const bottomIntensity = Math.max(0, Math.min(1, (pointerY - (bounds.bottom - edgeZone)) / edgeZone));
    list.dataset.dragVelocity = String(
      topIntensity ? -(2 + 22 * topIntensity ** 2) : bottomIntensity ? 2 + 22 * bottomIntensity ** 2 : 0
    );
    if (Number(list.dataset.dragVelocity) && !playlistDragFrame) {
      const scroll = () => {
        const speed = Number(list.dataset.dragVelocity) || 0;
        if (!speed || draggedPlaylistName !== playlistName) {
          playlistDragFrame = null;
          return;
        }
        list.scrollTop += speed;
        updateTarget();
        playlistDragFrame = requestAnimationFrame(scroll);
      };
      playlistDragFrame = requestAnimationFrame(scroll);
    }
  });
  ["pointerup", "pointercancel"].forEach((eventName) => {
    button.addEventListener(eventName, () => {
      clearTimeout(longPressTimer);
      if (draggedPlaylistName === playlistName) {
        suppressPlaylistClickUntil = Date.now() + 350;
        if (eventName === "pointerup" && targetName && targetName !== playlistName) {
          const sourceIndex = playlists.findIndex((playlist) => playlist.name === playlistName);
          if (sourceIndex >= 0) {
            const [moved] = playlists.splice(sourceIndex, 1);
            const targetIndex = playlists.findIndex((playlist) => playlist.name === targetName);
            playlists.splice(Math.max(0, targetIndex), 0, moved);
            persist();
          }
        }
      }
      draggedPlaylistName = null;
      list.dataset.dragVelocity = "0";
      if (playlistDragFrame) cancelAnimationFrame(playlistDragFrame);
      playlistDragFrame = null;
      preview?.remove();
      preview = null;
      document.body.classList.remove("playlist-drag-active");
      document.querySelectorAll(".playlist-item")
        .forEach((item) => item.classList.remove("playlist-dragging", "playlist-drag-over"));
      pointerId = null;
      targetName = null;
      if (eventName === "pointerup" && Date.now() < suppressPlaylistClickUntil) renderPlaylists();
    });
  });
}

async function showPlaylistContextMenu(playlistName, favoritesList) {
  const sourceIds = favoritesList
    ? tracks.filter((track) => favorites.has(track.id)).map((track) => track.id)
    : [...(playlists.find((playlist) => playlist.name === playlistName)?.trackIds || [])];
  const validIds = sourceIds.filter((id) => tracks.some((track) => track.id === id));
  const result = await window.medo.showPlaylistMenu({
    favorites: favoritesList,
    playlists: playlists
      .map((playlist) => playlist.name)
      .filter((name) => favoritesList || name !== playlistName)
  });
  if (!result || !validIds.length && ["play", "play-next", "add-to-playlist"].includes(result.action)) return;
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
    schedulePersist();
    if (queueWasEmpty) {
      const firstIndex = tracks.findIndex((track) => track.id === validIds[0]);
      if (firstIndex >= 0) playTrack(firstIndex, true);
    }
  } else if (result.action === "add-to-playlist") {
    const target = playlists.find((playlist) => playlist.name === result.playlist);
    if (!target) return;
    target.trackIds = [...new Set([...(target.trackIds || []), ...validIds])];
    tracks.forEach((track) => {
      if (validIds.includes(track.id)) {
        track.playlists = [...new Set([...(track.playlists || []), target.name])];
      }
    });
    persist();
    renderPlaylists();
  } else if (result.action === "rename") {
    renamePlaylist(playlistName);
  } else if (result.action === "delete") {
    deletePlaylist(playlistName);
  }
}

function renderFolders() {
  const container = document.querySelector("#folder-list");
  const summary = document.querySelector("#folder-summary");
  container.innerHTML = "";
  summary.textContent = musicFolders.length
    ? `正在管理 ${musicFolders.length} 个音乐目录`
    : "尚未添加自动扫描目录";

  if (!musicFolders.length) {
    const empty = document.createElement("div");
    empty.className = "folder-empty";
    empty.textContent = "添加文件夹后，MedoMusic 会扫描其中的音频文件。";
    container.append(empty);
    return;
  }

  musicFolders.forEach((folder) => {
    const row = document.createElement("div");
    row.className = "folder-row";
    row.innerHTML = `
      <span class="glyph folder-icon">&#xE8B7;</span>
      <div><strong></strong><small></small></div>
      <button class="folder-rescan" title="重新扫描">重新扫描</button>
      <button class="folder-remove" title="移除目录">移除</button>
    `;
    row.querySelector("strong").textContent = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
    row.querySelector("small").textContent = folder;
    row.querySelector(".folder-rescan").addEventListener("click", () => rescanFolder(folder));
    row.querySelector(".folder-remove").addEventListener("click", () => removeFolder(folder));
    container.append(row);
  });
}

function syncSelectionState() {
  const visible = multiSelectionMode && selectedTrackIds.size > 0 && currentView !== "settings" && currentView !== "player";
  const main = document.querySelector("main");
  main.classList.toggle("selection-mode", visible);
  setSelectionActionsVisible(visible);
  document.querySelector("#selection-count").textContent = `已选择 ${selectedTrackIds.size} 首`;
  document.querySelectorAll(".track-row").forEach((row) => {
    const wasSelected = row.classList.contains("selected");
    const selected = selectedTrackIds.has(row.dataset.trackId);
    row.classList.toggle("selected", selected);
    if (wasSelected !== selected && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      row.animate(
        selected
          ? [{ opacity: .82, filter: "brightness(1.08)" }, { opacity: 1, filter: "brightness(1)" }]
          : [{ opacity: .9, filter: "brightness(1.04)" }, { opacity: 1, filter: "brightness(1)" }],
        { duration: selected ? 180 : 140, easing: "cubic-bezier(.22,1,.36,1)" }
      );
      row.querySelector(".selection-check")?.animate(
        selected
          ? [{ opacity: 0, transform: "scale(.7) rotate(-8deg)" }, { opacity: 1, transform: "scale(1) rotate(0)" }]
          : [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.82)" }],
        { duration: selected ? 200 : 130, easing: "cubic-bezier(.22,1,.36,1)" }
      );
    }
  });
}

function setSelectionActionsVisible(visible) {
  const actions = document.querySelector("#selection-actions");
  clearTimeout(selectionActionsHideTimer);
  if (visible) {
    actions.hidden = false;
    requestAnimationFrame(() => actions.classList.add("visible"));
    return;
  }
  actions.classList.remove("visible");
  selectionActionsHideTimer = setTimeout(() => {
    if (!actions.classList.contains("visible")) actions.hidden = true;
  }, 220);
}

function formatCollectionDuration(tracksInView) {
  const seconds = tracksInView.reduce((total, track) => total + (track.duration || 0), 0);
  if (!seconds) return "时长读取中";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.round((seconds % 3600) / 60));
  return hours ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
}

function renderPlaylistHero(tracksInView) {
  const hero = document.querySelector("#playlist-hero");
  const favoritesOpen = currentView === "favorites";
  const active = Boolean(currentPlaylist || currentCollection || favoritesOpen) && currentView !== "settings";
  hero.hidden = !active;
  if (!active) return;
  const playlist = playlists.find((item) => item.name === currentPlaylist);
  const firstCover = tracksInView[0]?.cover || null;
  const cover = currentCollection || favoritesOpen ? firstCover : (playlist?.cover || firstCover);
  const art = document.querySelector("#playlist-art");
  const image = document.querySelector("#playlist-cover");
  art.classList.toggle("has-cover", Boolean(cover));
  image.src = cover || "";
  art.setAttribute("aria-disabled", String(Boolean(currentCollection || favoritesOpen)));
  art.title = currentCollection || favoritesOpen ? "" : "更换封面";
  document.querySelector("#playlist-name").textContent = favoritesOpen ? "喜欢" : (currentCollection?.name || currentPlaylist);
  document.querySelector(".playlist-kicker").textContent =
    currentCollection?.type === "artists" ? "艺术家" : currentCollection?.type === "albums" ? "专辑" : "播放列表";
  document.querySelector("#playlist-meta").textContent =
    `${tracksInView.length} 首歌曲 · ${formatCollectionDuration(tracksInView)}`;
  document.querySelector("#playlist-add-songs").hidden = Boolean(currentCollection || favoritesOpen);
  document.querySelector("#playlist-rename").hidden = Boolean(currentCollection || favoritesOpen);
  document.querySelector("#playlist-delete").hidden = Boolean(currentCollection || favoritesOpen);
  document.querySelector("#collection-back").hidden = !currentCollection;
}

function renderCollectionCards(visible) {
  const baseGroups = new Map();
  visible.forEach((track) => {
    const name = currentSort === "artists"
      ? (track.artist || "未知艺术家")
      : (track.album || "未知专辑");
    if (!baseGroups.has(name)) baseGroups.set(name, []);
    baseGroups.get(name).push(track);
  });
  const groups = [];
  for (const [name, groupTracks] of baseGroups) {
    if (currentSort !== "albums") {
      groups.push({ name, tracks: groupTracks, format: null });
      continue;
    }
    const titleFormats = new Map();
    groupTracks.forEach((track) => {
      const title = String(track.title || "").trim().toLocaleLowerCase("zh-CN");
      if (!titleFormats.has(title)) titleFormats.set(title, new Set());
      titleFormats.get(title).add(String(track.format || "").toUpperCase());
    });
    const hasMp3FlacDuplicate = [...titleFormats.values()]
      .some((formats) => formats.has("MP3") && formats.has("FLAC"));
    if (!hasMp3FlacDuplicate) {
      groups.push({ name, tracks: groupTracks, format: null });
      continue;
    }
    const formatGroups = new Map();
    groupTracks.forEach((track) => {
      const format = String(track.format || "其他").toUpperCase();
      if (!formatGroups.has(format)) formatGroups.set(format, []);
      formatGroups.get(format).push(track);
    });
    formatGroups.forEach((formatTracks, format) => {
      groups.push({ name, tracks: formatTracks, format });
    });
  }
  trackList.classList.add("collection-grid", `collection-${currentSort}`);
  for (const group of groups) {
    const { name, tracks: groupTracks, format } = group;
    const representative = groupTracks.find((track) => track.cover) || groupTracks[0];
    const card = document.createElement("button");
    card.className = "collection-card";
    card.dataset.trackId = representative.id;
    const subtitle = currentSort === "artists"
      ? `${groupTracks.length} 首歌曲`
      : `${representative.artist || "未知艺术家"}${format ? ` · ${format}` : ""}`;
    card.innerHTML = `<img class="collection-cover" alt=""><strong></strong><small></small>`;
    card.querySelector("img").src = representative.cover || missingArt;
    card.querySelector("strong").textContent = name;
    const totalPlays = groupTracks.reduce((total, track) => total + (track.playCount || 0), 0);
    card.querySelector("small").textContent = currentView === "recent"
      ? `${subtitle} · ${totalPlays} 次播放`
      : subtitle;
    card.addEventListener("click", () => {
      currentCollection = { type: currentSort, name, format };
      render();
      animateViewSurface();
    });
    trackList.append(card);
    observeMetadataRow(card, representative);
  }
}

function albumCollectionFormat(selectedTrack) {
  const albumName = selectedTrack.album || "未知专辑";
  const albumTracks = tracks.filter((track) => (track.album || "未知专辑") === albumName);
  const titleFormats = new Map();
  albumTracks.forEach((track) => {
    const title = String(track.title || "").trim().toLocaleLowerCase("zh-CN");
    if (!titleFormats.has(title)) titleFormats.set(title, new Set());
    titleFormats.get(title).add(String(track.format || "").toUpperCase());
  });
  const splitByFormat = [...titleFormats.values()]
    .some((formats) => formats.has("MP3") && formats.has("FLAC"));
  return splitByFormat ? String(selectedTrack.format || "其他").toUpperCase() : null;
}

function editTrackInfo(track) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "track-info-dialog";
    dialog.innerHTML = `
      <form>
        <header><h2>编辑歌曲信息</h2></header>
        <label><span>歌曲标题</span><input name="title" required></label>
        <label><span>歌手</span><input name="artist"></label>
        <label><span>专辑</span><input name="album"></label>
        <footer><button type="button" data-action="cancel">取消</button><button type="submit" class="primary">保存</button></footer>
      </form>`;
    let completed = false;
    const finish = (value) => {
      if (completed) return;
      completed = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelector('[name="title"]').value = track.title || "";
    dialog.querySelector('[name="artist"]').value = track.artist || "";
    dialog.querySelector('[name="album"]').value = track.album || "";
    dialog.querySelector('[data-action="cancel"]').addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      finish({
        title: String(data.get("title") || "").trim(),
        artist: String(data.get("artist") || "").trim(),
        album: String(data.get("album") || "").trim()
      });
    });
    document.body.append(dialog);
    dialog.showModal();
    const titleInput = dialog.querySelector('[name="title"]');
    titleInput.focus();
    titleInput.select();
  });
}

function showTrackPropertiesDialog(track, properties) {
  const dialog = document.createElement("dialog");
  dialog.className = "track-properties-dialog";
  const size = properties?.size >= 1024 * 1024
    ? `${(properties.size / 1024 / 1024).toFixed(2)} MB`
    : `${Math.max(1, Math.round((properties?.size || 0) / 1024))} KB`;
  const rows = [
    ["文件名", properties?.name || track.title],
    ["文件类型", properties?.extension || String(track.format || "").toUpperCase()],
    ["大小", size],
    ["时长", formatTime(track.duration)],
    ["比特率", track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : "未知"],
    ["采样率", track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)} kHz` : "未知"],
    ["修改时间", properties?.modifiedAt ? new Date(properties.modifiedAt).toLocaleString() : "未知"],
    ["位置", properties?.path || track.path]
  ];
  dialog.innerHTML = `
    <section>
      <header><h2>歌曲属性</h2><p></p></header>
      <dl></dl>
      <footer><button type="button">确定</button></footer>
    </section>`;
  dialog.querySelector("header p").textContent = `${track.title} · ${track.artist || "未知艺术家"}`;
  const list = dialog.querySelector("dl");
  rows.forEach(([label, value]) => {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    if (label === "位置") description.className = "path";
    list.append(term, description);
  });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector("button").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector("button").focus();
}

function reorderTrack(draggedId, targetId) {
  if (!draggedId || draggedId === targetId) return;
  const moveBefore = (ids) => {
    const next = ids.filter((id) => id !== draggedId);
    const targetIndex = next.indexOf(targetId);
    next.splice(targetIndex < 0 ? next.length : targetIndex, 0, draggedId);
    return next;
  };
  if (currentPlaylist) {
    const playlist = playlists.find((item) => item.name === currentPlaylist);
    if (playlist) playlist.trackIds = moveBefore(playlist.trackIds || []);
  } else if (currentView === "now") {
    playbackQueueIds = moveBefore(playbackQueueIds);
  } else if (currentView === "recent") {
    recent = moveBefore(recent);
  } else {
    const orderedIds = moveBefore(tracks.map((track) => track.id));
    const byId = new Map(tracks.map((track) => [track.id, track]));
    tracks = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    const stamp = Date.now();
    tracks.forEach((track, index) => { track.addedAt = stamp - index; });
    librarySort = "added";
  }
  persist();
  render();
}

function applyViewShellState({ preservePlaybackDetailActive = false } = {}) {
  const settingsOpen = currentView === "settings";
  const playbackDetailOpen = currentView === "player";
  const main = document.querySelector("main");
  main.classList.toggle("settings-open", settingsOpen);
  main.classList.toggle("playlist-open", Boolean(currentPlaylist || currentCollection || currentView === "favorites") && !settingsOpen);
  main.classList.toggle("playlists-open", currentView === "playlists");
  main.classList.toggle("now-open", currentView === "now");
  main.classList.toggle("playback-detail-open", playbackDetailOpen);
  if (!preservePlaybackDetailActive) {
    document.body.classList.toggle("playback-detail-active", playbackDetailOpen);
  }
  document.body.classList.toggle("settings-view", settingsOpen);
  return { main, settingsOpen, playbackDetailOpen };
}

function render() {
  const { main, settingsOpen, playbackDetailOpen } = applyViewShellState();
  if (playbackDetailOpen) {
    document.querySelector("#back-button").disabled = false;
    main.classList.remove("selection-mode");
    setSelectionActionsVisible(false);
    renderPlaybackDetail();
    return;
  }
  document.querySelector("#back-button").disabled =
    currentView === "library" && !currentPlaylist && !currentCollection;
  const showLibraryTools = (currentView === "library" || currentView === "recent") && !currentPlaylist && !currentCollection;
  const hasSelection = selectedTrackIds.size > 0;
  const selectionVisible = multiSelectionMode && hasSelection && !settingsOpen && !playbackDetailOpen;
  main.classList.toggle("selection-mode", selectionVisible);
  setSelectionActionsVisible(selectionVisible);
  document.querySelector("#selection-count").textContent = `已选择 ${selectedTrackIds.size} 首`;
  document.querySelector("#shuffle-all").hidden = hasSelection || currentView !== "library" || !showLibraryTools || currentSort !== "songs";
  const recentPlaySort = document.querySelector("#recent-play-count-sort");
  recentPlaySort.hidden = hasSelection || currentView !== "recent" || currentSort !== "songs";
  recentPlaySort.classList.toggle("active", recentSortByPlays);
  recentPlaySort.setAttribute("aria-pressed", String(recentSortByPlays));
  document.querySelector("#sort-control").hidden = hasSelection || currentView !== "library" || !showLibraryTools || currentSort === "artists";
  const librarySortSelect = document.querySelector("#library-sort");
  librarySortSelect.value = librarySort;
  document.querySelector("#library-sort-value").textContent =
    librarySortSelect.selectedOptions[0]?.textContent || "创建时间";
  document.querySelector("#view-title").textContent = titleForView();
  renderPlaylists();
  renderFolders();
  if (settingsOpen) {
    renderPlaylistHero([]);
    return;
  }

  const visible = visibleTracks();
  renderPlaylistHero(visible);
  metadataObserver?.disconnect();
  metadataObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      metadataObserver.unobserve(entry.target);
      const track = tracks.find((item) => item.id === entry.target.dataset.trackId);
      if (track) loadMetadata(track);
    });
  }, {
    root: document.querySelector("main"),
    rootMargin: "240px 0px"
  });
  document.querySelector("#track-count").textContent = `${visible.length} 首歌曲`;
  emptyState.classList.toggle("hidden", visible.length > 0);
  trackList.innerHTML = "";
  trackList.className = "track-list";

  if (currentView === "playlists") {
    trackList.className = "track-list playlist-overview-list";
    const items = playlists.map((playlist) => {
      const firstTrack = playlist.trackIds
        ?.map((trackId) => tracks.find((track) => track.id === trackId))
        .find(Boolean);
      return {
        name: playlist.name,
        count: playlist.trackIds?.length || 0,
        cover: playlist.cover || firstTrack?.cover || missingArt,
        firstTrackId: playlist.cover ? null : firstTrack?.id || null
      };
    });
    items.forEach((item) => {
      const button = document.createElement("button");
      button.className = "playlist-overview-item";
      if (item.firstTrackId) button.dataset.trackId = item.firstTrackId;
      button.innerHTML = '<img class="playlist-overview-cover" alt=""><strong></strong><small></small>';
      button.querySelector("img").src = item.cover;
      button.querySelector("strong").textContent = item.name;
      button.querySelector("small").textContent = `${item.count} 首歌曲`;
      if (item.firstTrackId) {
        const firstTrack = tracks.find((track) => track.id === item.firstTrackId);
        if (firstTrack && !firstTrack.metadataLoaded) loadMetadata(firstTrack).catch(() => {});
      }
      button.addEventListener("click", () => {
        currentView = "library";
        currentPlaylist = item.name;
        render();
        animateViewSurface();
      });
      trackList.append(button);
    });
    return;
  }

  if (!currentPlaylist && !currentCollection && (currentView === "library" || currentView === "recent") &&
      displayMode === "thumbnail" && (currentSort === "artists" || currentSort === "albums")) {
    renderCollectionCards(visible);
    return;
  }

  visible.slice(0, renderedTrackLimit).forEach((track, visibleIndex) => {
    const actualIndex = tracks.findIndex((item) => item.id === track.id);
    const row = document.createElement("div");
    row.className = `track-row${actualIndex === currentIndex ? " active" : ""}${selectedTrackIds.has(track.id) ? " selected" : ""}`;
    row.dataset.trackId = track.id;
    row.innerHTML = `
      <span class="row-leading"><img class="row-cover" src="${track.cover || missingArt}" alt=""><span class="selection-check glyph">&#xE73E;</span></span>
      <div class="track-copy">
        <div class="track-title-line">
          <span class="now-playing-indicator" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="track-title"></span>
          <div class="row-actions">
            <button class="row-play glyph" title="播放">&#xE768;</button>
            <button class="row-queue glyph" title="添加到播放列表">&#xE710;</button>
          </div>
        </div>
      </div>
      <span class="row-artist"></span>
      <span class="row-album-name"></span>
      <span class="play-count" hidden></span>
      <button class="row-favorite${favorites.has(track.id) ? " active" : ""}" title="收藏">${favorites.has(track.id) ? "♥" : "♡"}</button>
    `;
    row.querySelector(".track-title").textContent = track.title;
    row.querySelector(".row-artist").textContent = track.artist || "未知艺术家";
    row.querySelector(".row-album-name").textContent = track.album || "未知专辑";
    const playCount = row.querySelector(".play-count");
    playCount.hidden = currentView !== "recent";
    playCount.textContent = `${mergedPlayCount(track)} 次播放`;
    let longPressTimer = null;
    let pointerId = null;
    let dropTargetId = null;
    let dragPreview = null;
    let dragPointerX = 0;
    let dragPointerY = 0;
    row.addEventListener("click", () => {
      if (Date.now() < suppressRowClickUntil) return;
      if (multiSelectionMode) {
        selectedTrackIds.has(track.id) ? selectedTrackIds.delete(track.id) : selectedTrackIds.add(track.id);
        if (!selectedTrackIds.size) multiSelectionMode = false;
      } else {
        selectedTrackIds.clear();
        selectedTrackIds.add(track.id);
      }
      syncSelectionState();
    });
    row.addEventListener("dblclick", (event) => {
      if (event.target.closest("button")) return;
      selectedTrackIds.delete(track.id);
      multiSelectionMode = false;
      syncSelectionState();
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        row.animate(
          [
            { filter: "brightness(1)" },
            { filter: "brightness(1.16)", offset: .45 },
            { filter: "brightness(1)" }
          ],
          { duration: 240, easing: "cubic-bezier(.22,1,.36,1)" }
        );
      }
      playTrack(actualIndex);
    });
    row.querySelector(".row-leading").addEventListener("click", (event) => {
      if (!selectedTrackIds.has(track.id) && !multiSelectionMode) return;
      event.stopPropagation();
      multiSelectionMode = true;
      selectedTrackIds.has(track.id) ? selectedTrackIds.delete(track.id) : selectedTrackIds.add(track.id);
      if (!selectedTrackIds.size) selectedTrackIds.add(track.id);
      syncSelectionState();
    });
    row.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      clearTimeout(longPressTimer);
      pointerId = event.pointerId;
      dragPointerX = event.clientX;
      dragPointerY = event.clientY;
      longPressTimer = setTimeout(() => {
        draggedTrackId = track.id;
        row.classList.add("drag-ready");
        row.setPointerCapture(pointerId);
        dragPreview = document.createElement("div");
        dragPreview.className = "track-drag-preview";
        const previewCover = document.createElement("img");
        previewCover.src = track.cover || missingArt;
        previewCover.alt = "";
        const previewTitle = document.createElement("strong");
        previewTitle.textContent = track.title;
        const previewGrip = document.createElement("span");
        previewGrip.className = "glyph";
        previewGrip.innerHTML = "&#xE700;";
        dragPreview.append(previewCover, previewTitle, previewGrip);
        dragPreview.style.left = `${dragPointerX + 16}px`;
        dragPreview.style.top = `${dragPointerY + 14}px`;
        document.body.appendChild(dragPreview);
        document.body.classList.add("track-drag-active");
        navigator.vibrate?.(20);
      }, 320);
    });
    row.addEventListener("pointermove", (event) => {
      if (draggedTrackId !== track.id || event.pointerId !== pointerId) return;
      event.preventDefault();
      dragPointerX = event.clientX;
      dragPointerY = event.clientY;
      if (dragPreview) {
        dragPreview.style.left = `${event.clientX + 16}px`;
        dragPreview.style.top = `${event.clientY + 14}px`;
      }
      row.classList.add("dragging");
      document.querySelectorAll(".track-row.drag-over").forEach((item) => item.classList.remove("drag-over"));
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".track-row");
      dropTargetId = target?.dataset.trackId || null;
      if (target && dropTargetId !== track.id) target.classList.add("drag-over");
      const scrollSurface = document.querySelector("main");
      const bounds = scrollSurface.getBoundingClientRect();
      const edgeZone = Math.min(150, Math.max(84, bounds.height * .18));
      const topIntensity = Math.max(0, Math.min(1, (bounds.top + edgeZone - event.clientY) / edgeZone));
      const bottomIntensity = Math.max(0, Math.min(1, (event.clientY - (bounds.bottom - edgeZone)) / edgeZone));
      dragAutoScrollVelocity = topIntensity > 0
        ? -(6 + 94 * topIntensity * topIntensity)
        : bottomIntensity > 0
          ? 6 + 94 * bottomIntensity * bottomIntensity
          : 0;
      if (dragAutoScrollVelocity && !dragAutoScrollFrame) {
        const autoScroll = () => {
          if (!dragAutoScrollVelocity || draggedTrackId !== track.id) {
            dragAutoScrollFrame = null;
            return;
          }
          scrollSurface.scrollTop += dragAutoScrollVelocity;
          document.querySelectorAll(".track-row.drag-over").forEach((item) => item.classList.remove("drag-over"));
          const currentTarget = document.elementFromPoint(dragPointerX, dragPointerY)?.closest(".track-row");
          dropTargetId = currentTarget?.dataset.trackId || null;
          if (currentTarget && dropTargetId !== track.id) currentTarget.classList.add("drag-over");
          dragAutoScrollFrame = requestAnimationFrame(autoScroll);
        };
        dragAutoScrollFrame = requestAnimationFrame(autoScroll);
      }
    });
    ["pointerup", "pointercancel"].forEach((eventName) => {
      row.addEventListener(eventName, (event) => {
        clearTimeout(longPressTimer);
        if (draggedTrackId === track.id) {
          suppressRowClickUntil = Date.now() + 350;
          if (eventName === "pointerup" && dropTargetId && dropTargetId !== track.id) {
            reorderTrack(track.id, dropTargetId);
          }
        }
        draggedTrackId = null;
        dragAutoScrollVelocity = 0;
        if (dragAutoScrollFrame) cancelAnimationFrame(dragAutoScrollFrame);
        dragAutoScrollFrame = null;
        dragPreview?.remove();
        dragPreview = null;
        document.body.classList.remove("track-drag-active");
        pointerId = null;
        dropTargetId = null;
        document.querySelectorAll(".track-row").forEach((item) => item.classList.remove("dragging", "drag-ready", "drag-over"));
      });
    });
    row.querySelector(".row-play").addEventListener("click", (event) => {
      event.stopPropagation();
      playTrack(actualIndex);
    });
    row.querySelector(".row-queue").addEventListener("click", async (event) => {
      event.stopPropagation();
      const targetName = await window.medo.chooseTargetPlaylist(playlists.map((playlist) => playlist.name));
      const target = playlists.find((playlist) => playlist.name === targetName);
      if (!target) return;
      target.trackIds = [...new Set([...(target.trackIds || []), track.id])];
      track.playlists = [...new Set([...(track.playlists || []), target.name])];
      persist();
      renderPlaylists();
    });
    row.querySelector(".row-favorite").addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(track.id);
    });
    row.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      const result = await window.medo.showTrackMenu({
        trackId: track.id,
        playlists: playlists.map((item) => item.name),
        currentPlaylist
      });
      if (!result) return;
      if (result.action === "play") {
        playTrack(actualIndex);
      } else if (result.action === "play-next") {
        const queueWasEmpty = !playbackQueueIds.some((id) => tracks.some((item) => item.id === id));
        playbackQueueIds = playbackQueueIds.filter((id) => id !== track.id);
        const queueIndex = Math.max(-1, playbackQueueIds.indexOf(tracks[currentIndex]?.id));
        playbackQueueIds.splice(queueIndex + 1, 0, track.id);
        schedulePersist();
        if (queueWasEmpty) playTrack(actualIndex, true);
      } else if (result.action === "add-to-queue") {
        const queueWasEmpty = !playbackQueueIds.some((id) => tracks.some((item) => item.id === id));
        playbackQueueIds = playbackQueueIds.filter((id) => id !== track.id);
        playbackQueueIds.push(track.id);
        schedulePersist();
        if (queueWasEmpty) playTrack(actualIndex, true);
      } else if (result.action === "add-to-playlist") {
        const playlist = playlists.find((item) => item.name === result.playlist);
        if (playlist && !playlist.trackIds?.includes(track.id)) {
          playlist.trackIds = [...(playlist.trackIds || []), track.id];
          track.playlists = [...new Set([...(track.playlists || []), playlist.name])];
          persist();
          renderPlaylists();
        }
      } else if (result.action === "remove-from-playlist") {
        const playlist = playlists.find((item) => item.name === currentPlaylist);
        if (playlist) playlist.trackIds = (playlist.trackIds || []).filter((id) => id !== track.id);
        track.playlists = (track.playlists || []).filter((name) => name !== currentPlaylist);
        persist();
        render();
      } else if (result.action === "remove-from-library") {
        if (!window.confirm(`从 MedoMusic 音乐库中删除“${track.title}”？\n不会删除本地音频文件。`)) return;
        tracks = tracks.filter((item) => item.id !== track.id);
        playbackQueueIds = playbackQueueIds.filter((id) => id !== track.id);
        recent = recent.filter((id) => id !== track.id);
        favorites.delete(track.id);
        playlists.forEach((playlist) => {
          playlist.trackIds = (playlist.trackIds || []).filter((id) => id !== track.id);
        });
        if (currentIndex === actualIndex) {
          audio.pause();
          audio.removeAttribute("src");
          currentIndex = -1;
        } else if (currentIndex > actualIndex) {
          currentIndex -= 1;
        }
        persist();
        render();
      } else if (result.action === "show-album") {
        selectedTrackIds.clear();
        currentPlaylist = null;
        currentView = "library";
        currentSort = "albums";
        currentCollection = { type: "albums", name: track.album || "未知专辑" };
        currentCollection.format = albumCollectionFormat(track);
        setActiveNav(document.querySelector('.nav-item[data-view="library"]'));
        document.querySelectorAll(".pivot").forEach((item) =>
          item.classList.toggle("active", item.dataset.sort === "albums")
        );
        render();
        animateViewSurface();
      } else if (result.action === "edit-info") {
        const edits = await editTrackInfo(track);
        if (!edits) return;
        track.title = edits.title || track.title;
        track.artist = edits.artist || "未知艺术家";
        track.album = edits.album || "未知专辑";
        track.userEditedMetadata = true;
        track.metadataLoaded = true;
        persist();
        render();
      } else if (result.action === "properties") {
        const properties = await window.medo.showTrackProperties(track.path);
        showTrackPropertiesDialog(track, properties);
      } else if (result.action === "open-location") {
        const opened = await window.medo.showTrackInFolder(track.path);
        if (!opened) showPlaybackError(track, "无法打开歌曲所在位置");
      } else if (result.action === "select") {
        selectedTrackIds.clear();
        selectedTrackIds.add(track.id);
        multiSelectionMode = false;
        syncSelectionState();
      }
    });
    trackList.append(row);
    observeMetadataRow(row, track);
    if (visibleIndex < 60 && !track.metadataLoaded) loadMetadata(track).catch(() => {});
  });
  listLoadObserver?.disconnect();
  if (visible.length > renderedTrackLimit) {
    const sentinel = document.createElement("div");
    sentinel.className = "list-load-sentinel";
    sentinel.textContent = `继续加载 ${Math.min(200, visible.length - renderedTrackLimit)} 首歌曲`;
    trackList.append(sentinel);
    listLoadObserver = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      listLoadObserver.disconnect();
      renderedTrackLimit += 200;
      render();
    }, { root: document.querySelector("main"), rootMargin: "320px" });
    listLoadObserver.observe(sentinel);
  }
}

function trackFileKey(track) {
  const source = String(track?.path || track?.url || "").replaceAll("/", "\\").toLowerCase();
  return `${source.split("\\").pop() || source}|${String(track?.format || "").toLowerCase()}`;
}

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
  if (!musicFolders.length) return;
  let changed = false;
  for (const folder of musicFolders) {
    const result = await window.medo.scanFolder(folder);
    if (!result) continue;
    applyFolderScan(result, false);
    changed = true;
  }
  if (changed) {
    persist();
    render();
  }
}

function scheduleAutomaticFolderScan(folder) {
  const normalized = normalizedWindowsPath(folder);
  const managedFolder = musicFolders.find((item) => normalizedWindowsPath(item) === normalized);
  if (!managedFolder) return;
  clearTimeout(automaticFolderScans.get(normalized));
  automaticFolderScans.set(normalized, setTimeout(async () => {
    automaticFolderScans.delete(normalized);
    const result = await window.medo.scanFolder(managedFolder);
    if (result) applyFolderScan(result);
  }, 500));
}

function tracksReferToSameFile(left, right) {
  return Boolean(left?.id === right?.id || (trackFileKey(left) && trackFileKey(left) === trackFileKey(right)));
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
  tracks = tracks.filter((track) => !track.transient);
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

function mergeTracks(newTracks, commit = true) {
  for (const incoming of newTracks) {
    const existing = tracks.find((track) => tracksReferToSameFile(track, incoming));
    if (existing) {
      const audioFileChanged = Number(existing.modifiedAt) !== Number(incoming.modifiedAt) ||
        Number(existing.fileSize) !== Number(incoming.fileSize);
      existing.path = incoming.path;
      existing.url = incoming.url;
      if (incoming.createdAt) existing.createdAt = incoming.createdAt;
      if (incoming.modifiedAt) existing.modifiedAt = incoming.modifiedAt;
      if (incoming.fileSize) existing.fileSize = incoming.fileSize;
      if (audioFileChanged) {
        existing.metadataLoaded = false;
        existing.cover = null;
      }
      if (!existing.artist && incoming.artist) existing.artist = incoming.artist;
      if (incoming.artist && existing.title.includes(" - ")) existing.title = incoming.title;
      existing.playlists = [...new Set([
        ...(existing.playlists || []),
        ...(incoming.playlists || [])
      ])];
      existing.sourceDirectory ||= incoming.sourceDirectory;
    } else {
      incoming.addedAt ||= Date.now();
      tracks.push(incoming);
    }
  }
  if (commit) {
    persist();
    render();
  }
}

async function chooseFolder() {
  const result = await window.medo.chooseFolder();
  if (result) applyFolderScan(result);
}

async function chooseFiles() {
  mergeTracks(await window.medo.chooseFiles());
}

function applyFolderScan(result, commit = true) {
  if (!result?.folder || !Array.isArray(result.tracks)) return;
  const folderKey = result.folder.toLowerCase();
  tracks = tracks.filter((track) => {
    const fromFolder = track.sourceDirectory?.toLowerCase() === folderKey;
    const removedFromDisk = fromFolder && !result.tracks.some((incoming) => tracksReferToSameFile(track, incoming));
    return !removedFromDisk || track.playlists?.length;
  });
  if (!musicFolders.some((folder) => folder.toLowerCase() === folderKey)) {
    musicFolders.push(result.folder);
    syncMusicFolderWatchers();
  }
  mergeTracks(result.tracks, false);
  if (commit) {
    persist();
    render();
  }
}

async function rescanFolder(folder) {
  const result = await window.medo.scanFolder(folder);
  if (result) applyFolderScan(result);
}

async function refreshMusicLibrary() {
  const button = document.querySelector("#refresh-library");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在刷新…";
  try {
    for (const folder of musicFolders) {
      const result = await window.medo.scanFolder(folder);
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
    const previousTracks = [...tracks];
    const rebuilt = [];
    for (const folder of musicFolders) {
      const result = await window.medo.scanFolder(folder);
      if (!result) continue;
      result.tracks.forEach((incoming) => {
        const previous = previousTracks.find((track) => tracksReferToSameFile(track, incoming));
        rebuilt.push({
          ...incoming,
          id: previous?.id || incoming.id,
          addedAt: previous?.addedAt || Date.now(),
          playCount: previous?.playCount || 0,
          playlists: previous?.playlists || incoming.playlists || []
        });
      });
    }
    const managedFolders = musicFolders.map((folder) => folder.toLowerCase());
    const manualTracks = tracks.filter((track) =>
      !track.sourceDirectory || !managedFolders.includes(track.sourceDirectory.toLowerCase())
    ).map((track) => ({ ...track, metadataLoaded: false, cover: null }));
    tracks = [...new Map([...rebuilt, ...manualTracks].map((track) => [track.id, track])).values()];
    metadataRequests.clear();
    lyricsCache.clear();
    lyricsRequests.clear();
    persist();
    render();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function removeFolder(folder) {
  const folderKey = folder.toLowerCase();
  musicFolders = musicFolders.filter((item) => item.toLowerCase() !== folderKey);
  syncMusicFolderWatchers();
  tracks = tracks.filter((track) => {
    const fromFolder = track.sourceDirectory?.toLowerCase() === folderKey;
    return !fromFolder || track.playlists?.length;
  });
  const validIds = new Set(tracks.map((track) => track.id));
  favorites = new Set([...favorites].filter((id) => validIds.has(id)));
  recent = recent.filter((id) => validIds.has(id));
  if (!tracks[currentIndex]) currentIndex = -1;
  persist();
  render();
}

async function choosePlaylist() {
  const result = await window.medo.choosePlaylist();
  if (!result) return;
  const existing = playlists.find((item) => item.path === result.path);
  mergeTracks(result.tracks);
  const trackIds = result.tracks.map((track) => track.id);
  if (existing) {
    existing.name = result.name;
    existing.trackIds = trackIds;
  } else {
    playlists.push({ name: result.name, path: result.path, trackIds });
  }
  currentPlaylist = result.name;
  currentCollection = null;
  currentView = "library";
  currentSort = "songs";
  document.querySelectorAll(".pivot").forEach((item) => {
    item.classList.toggle("active", item.dataset.sort === "songs");
  });
  setActiveNav(null);
  persist();
  render();
}

async function addSongsToCurrentPlaylist() {
  if (!currentPlaylist) return;
  const newTracks = await window.medo.chooseFiles();
  if (!newTracks.length) return;
  const playlist = playlists.find((item) => item.name === currentPlaylist);
  if (!playlist) return;
  newTracks.forEach((track) => {
    track.playlists = [...new Set([...(track.playlists || []), currentPlaylist])];
  });
  mergeTracks(newTracks);
  playlist.trackIds = [...(playlist.trackIds || []), ...newTracks.map((track) => track.id)]
    .filter((id, index, values) => values.indexOf(id) === index);
  persist();
  render();
}

function renamePlaylist(playlistName) {
  const playlist = playlists.find((item) => item.name === playlistName);
  if (!playlist) return;
  const nextName = window.prompt("输入新的播放列表名称", playlist.name)?.trim();
  if (!nextName || nextName === playlist.name) return;
  const previousName = playlist.name;
  playlist.name = nextName;
  tracks.forEach((track) => {
    if (!track.playlists?.includes(previousName)) return;
    track.playlists = track.playlists.map((name) => name === previousName ? nextName : name);
  });
  if (currentPlaylist === previousName) currentPlaylist = nextName;
  persist();
  render();
}

function renameCurrentPlaylist() {
  renamePlaylist(currentPlaylist);
}

function deletePlaylist(playlistName) {
  const playlist = playlists.find((item) => item.name === playlistName);
  if (!playlist || !window.confirm(`从 MedoMusic 中删除播放列表“${playlist.name}”？`)) return;
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
  persist();
  render();
}

function deleteCurrentPlaylist() {
  deletePlaylist(currentPlaylist);
}

function savePlaybackQueueAsPlaylist() {
  const date = new Date();
  const defaultName = `播放列表${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  const name = window.prompt("输入播放列表名称", defaultName)?.trim();
  if (!name) return;
  const queueIds = playbackQueueIds.filter((id) => tracks.some((track) => track.id === id));
  if (!queueIds.length) {
    window.alert("当前播放列表为空");
    return;
  }
  const existing = playlists.find((playlist) => playlist.name === name);
  if (existing) {
    if (!window.confirm(`播放列表“${name}”已存在，是否替换？`)) return;
    existing.trackIds = [...queueIds];
  } else {
    playlists.push({ name, path: null, trackIds: [...queueIds] });
  }
  tracks.forEach((track) => {
    if (!queueIds.includes(track.id)) return;
    track.playlists = [...new Set([...(track.playlists || []), name])];
  });
  persist();
  renderPlaylists();
}

async function migratePlaylistOrder() {
  let changed = false;
  for (const playlist of playlists.filter((item) => !item.trackIds?.length)) {
    const result = await window.medo.loadPlaylist(playlist.path);
    if (!result) continue;
    mergeTracks(result.tracks);
    playlist.name = result.name;
    playlist.trackIds = result.tracks.map((track) => track.id);
    changed = true;
  }
  if (changed) {
    persist();
    render();
  }
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
    const discovered = await window.medo.discoverDefaultLibrary();
    if (!discovered) return;
    if (discovered.folder && !musicFolders.some((folder) => folder.toLowerCase() === discovered.folder.toLowerCase())) {
      musicFolders.push(discovered.folder);
    }
    mergeTracks(discovered.tracks || [], false);
    for (const imported of discovered.playlists || []) {
      mergeTracks(imported.tracks || [], false);
      const existing = playlists.find((playlist) => playlist.path === imported.path);
      const next = {
        name: imported.name,
        path: imported.path,
        trackIds: (imported.tracks || []).map((track) => track.id)
      };
      if (existing) Object.assign(existing, next);
      else playlists.push(next);
    }
    localStorage.setItem("medo.initialScanComplete", "true");
    localStorage.setItem("medo.indexSchema", "2");
    persist();
    render();
    syncMusicFolderWatchers();
  } catch {
    // Leave the flag unset so a temporary first-run failure can retry next launch.
  }
}

function showPlaybackError(track, message = "播放失败，已自动跳到下一首") {
  let toast = document.querySelector("#playback-error-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "playback-error-toast";
    toast.className = "playback-error-toast";
    document.body.append(toast);
  }
  const mediaError = audio.error;
  const errorNames = { 1: "播放已中止", 2: "文件读取错误", 3: "音频解码失败", 4: "格式不受支持" };
  const detail = mediaError ? `（${errorNames[mediaError.code] || `错误 ${mediaError.code}`}）` : "";
  toast.textContent = `${track?.title || "歌曲"}：${message}${detail}`;
  toast.classList.add("visible");
  clearTimeout(showPlaybackError.timer);
  showPlaybackError.timer = setTimeout(() => toast.classList.remove("visible"), 4200);
}

function recoverPlaybackFailure(track) {
  if (!track || playbackFailedIds.has(track.id)) return;
  playbackFailedIds.add(track.id);
  showPlaybackError(track);
  const tracksById = new Map(tracks.map((item) => [item.id, item]));
  const queue = playbackQueueIds.map((id) => tracksById.get(id)).filter(Boolean);
  const start = Math.max(0, queue.findIndex((item) => item.id === track.id));
  for (let offset = 1; offset <= queue.length; offset += 1) {
    const candidate = queue[(start + offset) % queue.length];
    if (!playbackFailedIds.has(candidate.id)) {
      playTrack(tracks.findIndex((item) => item.id === candidate.id), true);
      return;
    }
  }
  showPlaybackError(track, "队列中没有可播放的文件");
}

async function playTrack(index, preserveQueue = false, preservePreviousNavigation = false) {
  if (!tracks[index]) return;
  ensureOutputGain();
  if (!preserveQueue) playbackFailedIds.clear();
  const generation = ++playbackGeneration;
  if (!preserveQueue && currentView !== "now") {
    playbackQueueIds = visibleTracks().map((track) => track.id);
  }
  if (!playbackQueueIds.length) playbackQueueIds = [tracks[index].id];
  const track = tracks[index];
  window.medo.updateLyricsWindow({ noLyrics: false, playing: true });
  const resolvedSource = await window.medo.resolveMediaSource(track.path);
  if (generation !== playbackGeneration) return;
  if (!resolvedSource) {
    recoverPlaybackFailure(track);
    return;
  }
  track.url = resolvedSource;
  loadMetadata(track).catch(() => {});
  activeLyricIndex = -1;
  ensureLyrics(track);
  window.medo.updateLyricsWindow({
    title: track.title,
    artist: track.artist,
    album: track.album,
    primary: desktopLyricPrimaryColor,
    secondary: desktopLyricSecondaryColor,
    noLyrics: false,
    playing: true
  });
  if (!track.transient) {
    const identity = normalizedSongIdentity(track);
    const nextCount = mergedPlayCount(track) + 1;
    playStats[identity] = nextCount;
    tracksWithSameSongIdentity(track).forEach((version) => {
      version.playCount = nextCount;
    });
  }
  switchingPlaybackGeneration = generation;
  audio.pause();
  if (generation !== playbackGeneration) return;
  currentIndex = index;
  if (!preservePreviousNavigation) {
    lastPreviousRestartAt = 0;
    lastPreviousRestartTrackId = null;
  }
  audio.src = track.url;
  applyOutputVolume();
  audio.load();
  const ready = await new Promise((resolve, reject) => {
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      resolve();
      return;
    }
    const cleanup = () => {
      clearTimeout(timeout);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("error", onError);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(audio.error); };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("media-load-timeout"));
    }, 10000);
    audio.addEventListener("canplay", onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });
  }).catch(() => false);
  if (generation !== playbackGeneration) return;
  if (ready === false) {
    switchingPlaybackGeneration = 0;
    recoverPlaybackFailure(track);
    return;
  }
  audio.play().then(() => {
    playbackFailedIds.delete(track.id);
  }).catch(() => {
    switchingPlaybackGeneration = 0;
    recoverPlaybackFailure(track);
  });
  if (!track.transient) {
    const identity = normalizedSongIdentity(track);
    const preferred = preferredRecentVersion(track);
    recent = [
      preferred.id,
      ...recent.filter((id) => {
        const candidate = tracks.find((item) => item.id === id);
        return candidate && normalizedSongIdentity(candidate) !== identity;
      })
    ].slice(0, 100);
  }
  try {
    updateNowPlaying(track);
  } catch {
    // Visual metadata, artwork and lyrics are isolated from audio playback.
  }
  schedulePersist();
  if (currentView === "recent" || currentView === "now") {
    render();
  } else {
    document.querySelectorAll(".track-row").forEach((row) => {
      const active = row.dataset.trackId === track.id;
      row.classList.toggle("active", active);
      if (active && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        row.querySelector(".row-cover")?.animate(
          [{ opacity: .66, transform: "scale(.94)" }, { opacity: 1, transform: "scale(1)" }],
          { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" }
        );
      }
    });
  }
}

function updateNowPlaying(track) {
  document.querySelector("#now-title").textContent = track.title;
  document.querySelector("#now-album").textContent = track.artist || "未知艺术家";
  const cover = document.querySelector("#mini-cover");
  const nextCover = track.cover || missingArt;
  if (cover.src !== new URL(nextCover, document.baseURI).href) {
    cover.src = nextCover;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cover.animate(
        [
          { opacity: 0.55, transform: "scale(0.97)" },
          { opacity: 1, transform: "scale(1)" }
        ],
        { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
      );
    }
  }
  updateFavoriteButton();
  updateMediaSession(track);
  applyCoverTheme(nextCover);
  if (currentView === "player") renderPlaybackDetail();
}

function detailFormat(track) {
  const parts = [track.format];
  if (track.bitsPerSample) parts.push(`${track.bitsPerSample}bit`);
  if (track.sampleRate) parts.push(`${(track.sampleRate / 1000).toFixed(1)}kHz`);
  if (track.bitrate) parts.push(`${Math.round(track.bitrate / 1000)}kbps`);
  return parts.filter(Boolean).join(" · ");
}

async function applyCoverTheme(cover) {
  if (!cover) return;
  if (coverColorCache.has(cover)) {
    const [red, green, blue] = coverColorCache.get(cover);
    document.documentElement.style.setProperty("--detail-theme", `rgb(${red} ${green} ${blue})`);
    document.documentElement.style.setProperty("--detail-theme-rgb", `${red}, ${green}, ${blue}`);
    return;
  }
  try {
    const image = new Image();
    image.src = cover;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, 24, 24);
    const pixels = context.getImageData(0, 0, 24, 24).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const brightness = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
      const range = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) -
        Math.min(pixels[index], pixels[index + 1], pixels[index + 2]);
      if (pixels[index + 3] < 180 || brightness < 30 || brightness > 232) continue;
      const pixelWeight = 1 + range / 80;
      red += pixels[index] * pixelWeight;
      green += pixels[index + 1] * pixelWeight;
      blue += pixels[index + 2] * pixelWeight;
      weight += pixelWeight;
    }
    if (!weight) return;
    const color = [red, green, blue].map((value) => Math.round(value / weight));
    setBoundedCache(coverColorCache, cover, color, 96);
    if ((tracks[currentIndex]?.cover || missingArt) !== cover) return;
    document.documentElement.style.setProperty("--detail-theme", `rgb(${color[0]} ${color[1]} ${color[2]})`);
    document.documentElement.style.setProperty("--detail-theme-rgb", color.join(", "));
  } catch {
    // Keep the default detail theme when artwork cannot be sampled.
  }
}

function attachQueueDrag(button, trackId) {
  let longPressTimer = null;
  let pointerId = null;
  let dropTargetId = null;
  let preview = null;
  let pointerY = 0;
  let scrollVelocity = 0;

  const stopAutoScroll = () => {
    scrollVelocity = 0;
    if (queueDragFrame) cancelAnimationFrame(queueDragFrame);
    queueDragFrame = null;
  };
  const cleanup = () => {
    clearTimeout(longPressTimer);
    stopAutoScroll();
    preview?.remove();
    preview = null;
    draggedQueueTrackId = null;
    document.body.classList.remove("queue-drag-active");
    document.querySelectorAll(".queue-item").forEach((item) => {
      item.classList.remove("dragging", "drag-ready", "drag-over");
    });
  };
  const updateDropTarget = (clientX, clientY) => {
    document.querySelectorAll(".queue-item.drag-over").forEach((item) => item.classList.remove("drag-over"));
    const target = document.elementFromPoint(clientX, clientY)?.closest(".queue-item");
    dropTargetId = target?.dataset.trackId || null;
    if (target && dropTargetId !== trackId) target.classList.add("drag-over");
  };

  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    pointerY = event.clientY;
    longPressTimer = setTimeout(() => {
      draggedQueueTrackId = trackId;
      button.classList.add("drag-ready");
      button.setPointerCapture(pointerId);
      preview = button.cloneNode(true);
      preview.className = "queue-drag-preview";
      preview.style.left = `${event.clientX + 14}px`;
      preview.style.top = `${event.clientY + 12}px`;
      document.body.append(preview);
      document.body.classList.add("queue-drag-active");
      navigator.vibrate?.(20);
    }, 320);
  });
  button.addEventListener("pointermove", (event) => {
    if (draggedQueueTrackId !== trackId || event.pointerId !== pointerId) return;
    event.preventDefault();
    pointerY = event.clientY;
    button.classList.add("dragging");
    if (preview) {
      preview.style.left = `${event.clientX + 14}px`;
      preview.style.top = `${event.clientY + 12}px`;
    }
    updateDropTarget(event.clientX, event.clientY);
    const surface = document.querySelector("#detail-queue-list");
    const bounds = surface.getBoundingClientRect();
    const edge = Math.min(110, Math.max(54, bounds.height * .2));
    const top = Math.max(0, Math.min(1, (bounds.top + edge - event.clientY) / edge));
    const bottom = Math.max(0, Math.min(1, (event.clientY - bounds.bottom + edge) / edge));
    scrollVelocity = top ? -(4 + 44 * top * top) : bottom ? 4 + 44 * bottom * bottom : 0;
    if (scrollVelocity && !queueDragFrame) {
      const autoScroll = () => {
        if (!scrollVelocity || draggedQueueTrackId !== trackId) {
          queueDragFrame = null;
          return;
        }
        surface.scrollTop += scrollVelocity;
        updateDropTarget(event.clientX, pointerY);
        queueDragFrame = requestAnimationFrame(autoScroll);
      };
      queueDragFrame = requestAnimationFrame(autoScroll);
    }
  });
  ["pointerup", "pointercancel"].forEach((eventName) => {
    button.addEventListener(eventName, (event) => {
      clearTimeout(longPressTimer);
      if (draggedQueueTrackId === trackId) {
        suppressQueueClickUntil = Date.now() + 350;
        if (eventName === "pointerup" && dropTargetId && dropTargetId !== trackId) {
          const from = playbackQueueIds.indexOf(trackId);
          const to = playbackQueueIds.indexOf(dropTargetId);
          if (from >= 0 && to >= 0) {
            playbackQueueIds.splice(from, 1);
            playbackQueueIds.splice(to, 0, trackId);
            persist();
          }
        }
        cleanup();
        renderPlaybackDetail();
      } else {
        cleanup();
      }
    });
  });
}

function renderPlaybackDetail() {
  const track = tracks[currentIndex];
  if (!track) return;
  [
    document.querySelector("#lyric-translation-toggle"),
    document.querySelector("#toggle-detail-track"),
    document.querySelector("#toggle-detail-queue")
  ].forEach((button) => {
    button.getAnimations().forEach((animation) => animation.cancel());
    button.style.removeProperty("opacity");
    button.style.removeProperty("transform");
    button.style.removeProperty("visibility");
  });
  document.querySelector("#toggle-detail-track").hidden = false;
  document.querySelector("#toggle-detail-queue").hidden = false;
  const cover = track.cover || missingArt;
  applyCoverTheme(cover);
  document.querySelector("#detail-cover").src = cover;
  document.querySelector("#detail-backdrop").style.backgroundImage = `url("${cover.replace(/"/g, '\\"')}")`;
  document.querySelector("#detail-title").textContent = track.title;
  document.querySelector("#detail-artist").textContent = track.artist || "未知艺术家";
  document.querySelector("#detail-album").textContent = track.album || "未知专辑";
  document.querySelector("#detail-format").textContent = detailFormat(track);
  renderLyrics(track);
  ensureLyrics(track);

  const tracksById = new Map(tracks.map((item) => [item.id, item]));
  const queue = playbackQueueIds.map((id) => tracksById.get(id)).filter(Boolean);
  document.querySelector("#detail-queue-count").textContent = `${queue.length} 首歌曲`;
  const container = document.querySelector("#detail-queue-list");
  cancelAnimationFrame(detailQueueRenderFrame);
  detailQueueRenderFrame = null;
  delete container.dataset.windowStart;
  const queueRowHeight = 64;
  const queueWindowSize = 20;
  const queueWindowChunk = 5;
  const queueCanvas = document.createElement("div");
  queueCanvas.className = "queue-virtual-content";
  queueCanvas.style.height = `${queue.length * queueRowHeight}px`;
  container.replaceChildren(queueCanvas);
  const renderQueueWindow = (requestedStart) => {
    const start = Math.max(0, Math.min(requestedStart, Math.max(0, queue.length - queueWindowSize)));
    if (Number(container.dataset.windowStart) === start && queueCanvas.children.length) return;
    container.dataset.windowStart = String(start);
    queueCanvas.replaceChildren();
    queue.slice(start, start + queueWindowSize).forEach((item, offset) => {
      const index = start + offset;
      const button = document.createElement("button");
      button.className = `queue-item${item.id === track.id ? " active" : ""}`;
      button.dataset.trackId = item.id;
      button.style.top = `${index * queueRowHeight}px`;
      button.innerHTML = '<span class="queue-index"></span><span class="queue-copy"><strong></strong><small></small></span>';
      button.querySelector(".queue-index").textContent = index + 1;
      button.querySelector("strong").textContent = item.title;
      button.querySelector("small").textContent = item.artist || "未知艺术家";
      button.addEventListener("click", () => {
        if (Date.now() < suppressQueueClickUntil) return;
        playTrack(tracks.findIndex((candidate) => candidate.id === item.id), true);
      });
      attachQueueDrag(button, item.id);
      queueCanvas.append(button);
    });
  };
  const activeQueueIndex = Math.max(0, queue.findIndex((item) => item.id === track.id));
  const activeTrackChanged = detailQueueActiveTrackId !== track.id;
  detailQueueActiveTrackId = track.id;
  if (activeTrackChanged) {
    container.scrollTop = Math.max(0, activeQueueIndex * queueRowHeight - container.clientHeight / 2 + queueRowHeight / 2);
  }
  const windowStartForScroll = () =>
    Math.floor((Math.floor(container.scrollTop / queueRowHeight) - queueWindowChunk) / queueWindowChunk) * queueWindowChunk;
  renderQueueWindow(windowStartForScroll());
  container.onscroll = () => {
    if (detailQueueRenderFrame) return;
    detailQueueRenderFrame = requestAnimationFrame(() => {
      detailQueueRenderFrame = null;
      renderQueueWindow(windowStartForScroll());
    });
  };
}

function togglePlayback() {
  if (!audio.src) {
    const available = visibleTracks().filter((track) => track && !track.transient);
    const first = available[0] || tracks.find((track) => !track.transient);
    if (first) {
      if (!playbackQueueIds.length) {
        playbackQueueIds = [first.id];
        persist();
      }
      playTrack(tracks.findIndex((track) => track.id === first.id), true);
    }
  } else if (audio.paused) {
    ensureOutputGain();
    applyOutputVolume();
    audio.play().catch(() => recoverPlaybackFailure(tracks[currentIndex]));
  } else {
    audio.pause();
  }
}

function clearCurrentPlayback() {
  playbackGeneration += 1;
  switchingPlaybackGeneration = 0;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  currentIndex = -1;
  activeLyricIndex = -1;
  document.querySelectorAll(".track-row.active").forEach((row) => row.classList.remove("active"));
  updatePlayButtonState(false);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  progress.value = 0;
  updateRangeGradient(progress, 0);
  document.querySelector("#current-time").textContent = formatTime(0);
  document.querySelector("#duration").textContent = formatTime(0);
  document.querySelector("#now-title").textContent = "未选择歌曲";
  document.querySelector("#now-album").textContent = "MedoMusic";
  document.querySelector("#mini-cover").src = missingArt;
  updateFavoriteButton();
  if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  window.medo.updateLyricsWindow({
    title: "MedoMusic",
    current: "等待播放歌曲",
    next: "",
    playing: false
  });
}

function nextTrack(direction = 1) {
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  let queue = playbackQueueIds.map((id) => tracksById.get(id)).filter(Boolean);
  const currentId = tracks[currentIndex]?.id;
  if (!queue.length && direction > 0) {
    const available = visibleTracks().filter((track) => track && !track.transient);
    const candidate = available[0] || tracks.find((track) => !track.transient);
    if (candidate) {
      const queueIds = queue.map((track) => track.id);
      if (!queueIds.includes(candidate.id)) {
        queueIds.splice(0, 0, candidate.id);
        playbackQueueIds = queueIds;
        persist();
      }
      return playTrack(tracks.findIndex((track) => track.id === candidate.id), true);
    }
  }
  if (!queue.length) return;
  let continuingPreviousNavigation = false;
  if (direction < 0 && currentId && !audio.paused) {
    const now = Date.now();
    const repeatedPrevious = lastPreviousRestartAt > 0 && now - lastPreviousRestartAt <= 3000;
    if (!repeatedPrevious) {
      audio.currentTime = 0;
      progress.value = 0;
      updateRangeGradient(progress, 0);
      document.querySelector("#current-time").textContent = formatTime(0);
      lastPreviousRestartAt = now;
      lastPreviousRestartTrackId = currentId;
      schedulePersist();
      return;
    }
    continuingPreviousNavigation = true;
    lastPreviousRestartAt = now;
    lastPreviousRestartTrackId = currentId;
  }
  if (!continuingPreviousNavigation) {
    lastPreviousRestartAt = 0;
    lastPreviousRestartTrackId = null;
  }
  if (playMode === "shuffle") {
    const queueIds = queue.map((track) => track.id);
    const signature = [...queueIds].sort().join("\u001f");
    if (shuffleQueueSignature !== signature) {
      shuffleQueueSignature = signature;
      shuffleHistoryIds = currentId && queueIds.includes(currentId) ? [currentId] : [];
      shuffleHistoryIndex = shuffleHistoryIds.length - 1;
      shuffleRemainingIds = queueIds.filter((id) => id !== currentId);
      for (let index = shuffleRemainingIds.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffleRemainingIds[index], shuffleRemainingIds[swapIndex]] =
          [shuffleRemainingIds[swapIndex], shuffleRemainingIds[index]];
      }
    }
    if (currentId && shuffleHistoryIds[shuffleHistoryIndex] !== currentId) {
      shuffleHistoryIds = shuffleHistoryIds.slice(0, shuffleHistoryIndex + 1);
      shuffleHistoryIds.push(currentId);
      shuffleHistoryIndex = shuffleHistoryIds.length - 1;
      shuffleRemainingIds = shuffleRemainingIds.filter((id) => id !== currentId);
    }
    if (direction < 0 && shuffleHistoryIndex > 0) {
      shuffleHistoryIndex -= 1;
      const previousId = shuffleHistoryIds[shuffleHistoryIndex];
      return playTrack(tracks.findIndex((track) => track.id === previousId), true, continuingPreviousNavigation);
    }
    if (direction > 0 && shuffleHistoryIndex < shuffleHistoryIds.length - 1) {
      shuffleHistoryIndex += 1;
      const forwardId = shuffleHistoryIds[shuffleHistoryIndex];
      return playTrack(tracks.findIndex((track) => track.id === forwardId), true);
    }
    if (!shuffleRemainingIds.length) {
      shuffleRemainingIds = queueIds.filter((id) => id !== currentId);
      for (let index = shuffleRemainingIds.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffleRemainingIds[index], shuffleRemainingIds[swapIndex]] =
          [shuffleRemainingIds[swapIndex], shuffleRemainingIds[index]];
      }
      shuffleHistoryIds = currentId ? [currentId] : [];
      shuffleHistoryIndex = shuffleHistoryIds.length - 1;
    }
    const nextId = shuffleRemainingIds.pop();
    if (!nextId) return;
    shuffleHistoryIds = shuffleHistoryIds.slice(0, shuffleHistoryIndex + 1);
    shuffleHistoryIds.push(nextId);
    shuffleHistoryIndex = shuffleHistoryIds.length - 1;
    return playTrack(tracks.findIndex((track) => track.id === nextId), true);
  }
  const queueIndex = queue.findIndex((track) => track.id === currentId);
  const nextIndex = queueIndex < 0
    ? (direction < 0 ? queue.length - 1 : 0)
    : (queueIndex + direction + queue.length) % queue.length;
  playTrack(
    tracks.findIndex((track) => track.id === queue[nextIndex].id),
    true,
    direction < 0 && continuingPreviousNavigation
  );
}

function toggleFavorite(id = tracks[currentIndex]?.id) {
  if (!id) return;
  favorites.has(id) ? favorites.delete(id) : favorites.add(id);
  schedulePersist();
  updateFavoriteButton();
  renderPlaylists();
  document.querySelectorAll(".track-row").forEach((row) => {
    if (row.dataset.trackId === id) {
      const button = row.querySelector(".row-favorite");
      button?.classList.toggle("active", favorites.has(id));
      if (button) button.textContent = favorites.has(id) ? "♥" : "♡";
    }
  });
}

function updateFavoriteButton() {
  const active = favorites.has(tracks[currentIndex]?.id);
  favoriteButton.classList.toggle("active", active);
  favoriteButton.textContent = active ? "♥" : "♡";
}

function extensionTrack(track) {
  if (!track) return null;
  return {
    id: track.id,
    path: track.path,
    title: track.title,
    artist: track.artist || null,
    album: track.album || null,
    format: track.format || null,
    duration: Number(track.duration) || 0,
    playCount: mergedPlayCount(track),
    playlists: [...(track.playlists || [])],
    favorite: favorites.has(track.id),
    addedAt: Number(track.addedAt) || null,
    sourceDirectory: track.sourceDirectory || null
  };
}

function extensionPlaybackState() {
  return {
    currentTrack: extensionTrack(tracks[currentIndex]),
    playing: Boolean(audio.src && !audio.paused),
    currentTime: Number(audio.currentTime) || 0,
    duration: Number(audio.duration) || 0,
    volume: desiredVolume,
    muted: audio.muted,
    playMode,
    queue: [...playbackQueueIds],
    libraryCount: tracks.filter((track) => !track.transient).length,
    playlistCount: playlists.length
  };
}

function setFavoriteFromExtension(trackId, favorite) {
  const track = tracks.find((item) => item.id === trackId);
  if (!track) throw new Error("track-not-found");
  const shouldFavorite = favorite !== false;
  if (shouldFavorite) favorites.add(trackId);
  else favorites.delete(trackId);
  persist();
  updateFavoriteButton();
  renderPlaylists();
  return extensionTrack(track);
}

function validTrackIds(values) {
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
  persist();
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
  persist();
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
  persist();
  render();
  return { deleted: name };
}

async function handleMyFireflyCommand(payload = {}) {
  switch (payload.command) {
    case "get-state":
      return extensionPlaybackState();
    case "get-library":
      return {
        tracks: tracks.filter((track) => !track.transient).map(extensionTrack),
        playlists: playlists.map((playlist) => ({ ...playlist, trackIds: [...(playlist.trackIds || [])] })),
        favorites: [...favorites],
        musicFolders: [...musicFolders]
      };
    case "add-tracks": {
      const paths = [...new Set((Array.isArray(payload.paths) ? payload.paths : [])
        .filter((value) => typeof value === "string" && value.trim()).slice(0, 200))];
      if (!paths.length) throw new Error("no-track-paths");
      const incoming = await window.medo.getExternalTracks(paths);
      incoming.forEach((track) => { track.transient = false; });
      mergeTracks(incoming);
      return { added: incoming.map(extensionTrack) };
    }
    case "create-playlist":
      return createPlaylistFromExtension(payload.name, payload.trackIds);
    case "update-playlist":
      return updatePlaylistFromExtension(payload.name, payload);
    case "delete-playlist":
      return deletePlaylistFromExtension(payload.name);
    case "set-favorite":
      return setFavoriteFromExtension(payload.trackId, payload.favorite);
    case "control": {
      const action = String(payload.action || "");
      if (action === "play") {
        if (!audio.src || audio.paused) togglePlayback();
      } else if (action === "pause") {
        audio.pause();
      } else if (action === "toggle") {
        togglePlayback();
      } else if (action === "next") {
        nextTrack(1);
      } else if (action === "previous") {
        nextTrack(-1);
      } else if (action === "set-volume") {
        const nextVolume = Number(payload.value);
        if (!Number.isFinite(nextVolume)) throw new Error("invalid-volume");
        desiredVolume = Math.min(1, Math.max(0, nextVolume));
        volume.value = desiredVolume;
        ensureOutputGain();
        applyOutputVolume();
        updateVolumeDisplay();
      } else if (action === "set-muted") {
        audio.muted = Boolean(payload.value);
        updateMuteButton();
        window.medo.setTrayMuted(audio.muted);
      } else if (action === "seek") {
        const seconds = Number(payload.value);
        if (!Number.isFinite(seconds) || !audio.src) throw new Error("invalid-seek");
        audio.currentTime = Math.min(Math.max(0, seconds), Number(audio.duration) || seconds);
      } else if (action === "play-track") {
        const index = tracks.findIndex((track) => track.id === payload.trackId && !track.transient);
        if (index < 0) throw new Error("track-not-found");
        await playTrack(index, false);
      } else if (action === "set-mode") {
        if (!["list-once", "sequence", "shuffle", "repeat-one"].includes(payload.value)) throw new Error("invalid-play-mode");
        playMode = payload.value;
        updatePlayModeButton();
      } else {
        throw new Error("unsupported-control-action");
      }
      persist();
      return extensionPlaybackState();
    }
    default:
      throw new Error("unsupported-extension-command");
  }
}

function updateMuteButton() {
  const button = document.querySelector("#volume-button");
  const muted = audio.muted;
  button.innerHTML = muted ? "&#xE74F;" : "&#xE767;";
  button.title = muted ? "取消静音" : "静音";
  button.setAttribute("aria-label", button.title);
  button.classList.remove("active");
}

function updatePlayModeButton() {
  const button = document.querySelector("#play-mode-button");
  const modes = {
    "list-once": { icon: "&#xE8EE;", title: "列表播放（播放完暂停）" },
    sequence: { icon: "&#xE8EE;", title: "列表循环" },
    shuffle: { icon: "&#xE8B1;", title: "随机播放" },
    "repeat-one": { icon: "&#xE8ED;", title: "单曲循环" }
  };
  const current = modes[playMode] || modes.sequence;
  button.innerHTML = current.icon;
  button.title = current.title;
  button.dataset.mode = playMode;
  button.classList.toggle("active", playMode !== "list-once");
}

async function renderAppInfo() {
  const info = await window.medo.getAppInfo();
  document.querySelector("#about-version").textContent = `${info.name} ${info.version}`;
  document.querySelector("#about-install-directory").textContent = info.installDirectory;
}

document.querySelector("#check-for-updates").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const label = button.querySelector("span:last-child");
  if (button.disabled) return;
  button.disabled = true;
  button.classList.remove("latest", "failed");
  button.classList.add("checking");
  label.textContent = "\u6b63\u5728\u68c0\u67e5";
  const result = await window.medo.checkForUpdates();
  button.classList.remove("checking");
  if (result?.error) {
    button.classList.add("failed");
    label.textContent = "\u68c0\u67e5\u5931\u8d25";
  } else if (result?.updateAvailable) {
    label.textContent = `\u53d1\u73b0 ${result.latestVersion}`;
  } else {
    button.classList.add("latest");
    label.textContent = "\u8f6f\u4ef6\u5df2\u6700\u65b0";
  }
  button.disabled = false;
});

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function updateRangeGradient(input, ratio) {
  const percent = Math.max(0, Math.min(100, ratio * 100));
  input.style.setProperty("--range-progress", `${percent}%`);
  input.style.setProperty("--range-mid", `${percent / 2}%`);
}

function updateVolumeDisplay() {
  const percent = Math.round(Math.max(0, Math.min(1, desiredVolume)) * 100);
  const output = document.querySelector("#volume-percent");
  output.textContent = `${percent}%`;
  output.style.setProperty("--volume-percent", percent);
  updateRangeGradient(volume, desiredVolume);
}

function showVolumeBubble(autoHide = false) {
  const control = document.querySelector(".volume-control");
  clearTimeout(volumeBubbleHideTimer);
  control.classList.add("adjusting");
  if (autoHide) {
    volumeBubbleHideTimer = setTimeout(() => control.classList.remove("adjusting"), 780);
  }
}

function hideVolumeBubble() {
  clearTimeout(volumeBubbleHideTimer);
  volumeBubbleHideTimer = setTimeout(() => document.querySelector(".volume-control").classList.remove("adjusting"), 90);
}

function updateMediaSession(track) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    album: track.album,
    artist: track.artist || "未知艺术家",
    artwork: track.cover ? [{ src: track.cover }] : []
  });
}

function setActiveNav(activeButton) {
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => item.classList.toggle("active", item === activeButton));
}

function goBack() {
  if (currentView === "player") {
    closePlaybackDetail();
    return;
  } else if (selectedTrackIds.size || multiSelectionMode) {
    selectedTrackIds.clear();
    multiSelectionMode = false;
    render();
    animateContentChange();
    return;
  } else if (currentCollection) {
    currentCollection = null;
  } else if (currentPlaylist) {
    currentPlaylist = null;
    currentView = "library";
    setActiveNav(document.querySelector('[data-view="library"]'));
  } else if (currentView !== "library") {
    currentView = "library";
    setActiveNav(document.querySelector('[data-view="library"]'));
  } else {
    return;
  }
  render();
  animateViewSurface();
}

function animatePlaybackDetail(entering) {
  const surface = document.querySelector("#playback-detail");
  const layout = surface?.querySelector(".detail-layout");
  const backdrop = surface?.querySelector(".detail-backdrop");
  if (!surface || !layout || !backdrop) return Promise.resolve();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const surfaceStyle = getComputedStyle(surface);
  const layoutStyle = getComputedStyle(layout);
  [surface, layout, backdrop].forEach((element) => element.getAnimations().forEach((animation) => animation.cancel()));
  const duration = reduced ? 80 : entering ? 220 : 210;
  const easing = "cubic-bezier(0.23, 1, 0.32, 1)";
  const animations = [
    surface.animate(
      entering
        ? [{ opacity: 0.35, transform: "scale(1.006)" }, { opacity: 1, transform: "scale(1)" }]
        : [{ opacity: surfaceStyle.opacity, transform: "scale(1)" }, { opacity: 0, transform: "translateY(7px) scale(.996)" }],
      { duration, easing, fill: "forwards" }
    )
  ];
  if (!reduced) {
    animations.push(
      layout.animate(
        entering
          ? [{ opacity: 0.58, transform: "scale(0.985)" }, { opacity: 1, transform: "scale(1)" }]
          : [{ opacity: layoutStyle.opacity, transform: layoutStyle.transform }, { opacity: 0.45, transform: "scale(0.992)" }],
        { duration: entering ? 250 : 150, easing, fill: "forwards" }
      ),
      ...(entering ? [backdrop.animate(
        [{ opacity: 0 }, { opacity: 0.52 }],
        { duration: 240, easing, fill: "forwards" }
      )] : [])
    );
  }
  return Promise.allSettled(animations.map((animation) => animation.finished));
}

function openPlaybackDetail() {
  if (!tracks[currentIndex]) return;
  const transitionId = ++playbackTransitionId;
  viewBeforePlayer = currentView;
  currentView = "player";
  render();
  requestAnimationFrame(() => {
    if (currentView === "player" && transitionId === playbackTransitionId) animatePlaybackDetail(true);
  });
}

async function closePlaybackDetail() {
  if (currentView !== "player") return;
  const transitionId = ++playbackTransitionId;
  const main = document.querySelector("main");
  main.classList.add("playback-detail-closing");
  currentView = viewBeforePlayer;
  applyViewShellState({ preservePlaybackDetailActive: true });
  document.querySelector("#back-button").disabled =
    currentView === "library" && !currentPlaylist && !currentCollection;
  const detailOnlyTools = [
    document.querySelector("#lyric-translation-toggle"),
    document.querySelector("#toggle-detail-track"),
    document.querySelector("#toggle-detail-queue")
  ].filter((button) => button && !button.hidden);
  detailOnlyTools.forEach((button) => button.getAnimations().forEach((animation) => animation.cancel()));
  void main.offsetWidth;
  document.body.classList.add("playback-detail-exiting");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await animatePlaybackDetail(false);
  if (transitionId !== playbackTransitionId) return;
  const persistentTools = [
    document.querySelector("#desktop-lyrics-button"),
    document.querySelector(".volume-icon"),
    document.querySelector("#volume")
  ].filter(Boolean);
  persistentTools.forEach((element) => element.getAnimations().forEach((animation) => animation.cancel()));
  const previousRects = new Map(persistentTools.map((element) => [element, element.getBoundingClientRect()]));
  main.classList.remove("playback-detail-closing");
  document.body.classList.remove("playback-detail-active");
  document.body.classList.remove("playback-detail-exiting");
  persistentTools.forEach((element) => {
    const before = previousRects.get(element);
    const after = element.getBoundingClientRect();
    const deltaX = before.left - after.left;
    const deltaY = before.top - after.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
    element.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: "translate(0, 0)" }
      ],
      { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" }
    );
  });
  persist();
}

function animateViewSurface() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const surfaces = currentView === "settings"
    ? [document.querySelector("#settings-panel")]
    : currentView === "player"
      ? [document.querySelector("#playback-detail")]
    : currentPlaylist || currentCollection
      ? [document.querySelector("#playlist-hero"), document.querySelector(".content-area")]
      : [document.querySelector(".page-header"), document.querySelector(".pivot-bar"), document.querySelector(".content-area")];
  surfaces.filter(Boolean).forEach((surface) => {
    const runningAnimations = surface.getAnimations();
    const liveStyle = runningAnimations.length ? getComputedStyle(surface) : null;
    const startOpacity = liveStyle ? liveStyle.opacity : "0.72";
    const startTransform = liveStyle && liveStyle.transform !== "none"
      ? liveStyle.transform
      : "translateY(5px)";
    runningAnimations.forEach((animation) => animation.cancel());
    surface.animate(
      reduceMotion
        ? [{ opacity: startOpacity }, { opacity: 1 }]
        : [{ opacity: startOpacity, transform: startTransform }, { opacity: 1, transform: "translateY(0)" }],
      { duration: reduceMotion ? 80 : 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  });
}

function animateContentChange() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const surface = trackList;
  const runningAnimations = surface.getAnimations();
  const startOpacity = runningAnimations.length ? getComputedStyle(surface).opacity : "0.78";
  runningAnimations.forEach((animation) => animation.cancel());
  surface.animate(
    reduceMotion
      ? [{ opacity: startOpacity }, { opacity: 1 }]
      : [{ opacity: startOpacity, transform: "translateY(3px)" }, { opacity: 1, transform: "translateY(0)" }],
    { duration: reduceMotion ? 80 : 170, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
  );
}

async function choosePlaylistCover() {
  if (!currentPlaylist || currentCollection) return;
  const cover = await window.medo.chooseCover();
  if (!cover) return;
  const playlist = playlists.find((item) => item.name === currentPlaylist);
  if (!playlist) return;
  playlist.cover = cover;
  persist();
  renderPlaylistHero(visibleTracks());
}

document.querySelector("#add-folder").addEventListener("click", chooseFolder);
document.querySelector("#settings-add-folder").addEventListener("click", chooseFolder);
document.querySelector("#refresh-library").addEventListener("click", rebuildMusicLibraryIndex);
document.querySelector("#empty-add").addEventListener("click", chooseFolder);
document.querySelector("#add-files").addEventListener("click", chooseFiles);
document.querySelector("#header-playlist").addEventListener("click", choosePlaylist);
document.querySelector("#empty-zpl").addEventListener("click", choosePlaylist);
document.querySelector("#shuffle-all").addEventListener("click", () => {
  const queue = visibleTracks()
    .map((track) => track.id)
    .sort(() => Math.random() - 0.5);
  if (!queue.length) return;
  playbackQueueIds = queue;
  playMode = "shuffle";
  shuffleQueueSignature = [...queue].sort().join("\u001f");
  shuffleHistoryIds = [queue[0]];
  shuffleHistoryIndex = 0;
  shuffleRemainingIds = queue.slice(1);
  updatePlayModeButton();
  playTrack(tracks.findIndex((track) => track.id === queue[0]), true);
});
document.querySelector("#recent-play-count-sort").addEventListener("click", (event) => {
  recentSortByPlays = !recentSortByPlays;
  event.currentTarget.classList.toggle("active", recentSortByPlays);
  event.currentTarget.setAttribute("aria-pressed", String(recentSortByPlays));
  persist();
  render();
  animateContentChange();
});
document.querySelector("#detail-clear-queue").addEventListener("click", (event) => {
  animatePlayerToolButton(event.currentTarget);
  clearCurrentPlayback();
  playbackQueueIds = [];
  playbackFailedIds.clear();
  shuffleQueueSignature = "";
  shuffleRemainingIds = [];
  shuffleHistoryIds = [];
  shuffleHistoryIndex = -1;
  lastPreviousRestartAt = 0;
  lastPreviousRestartTrackId = null;
  persist();
  closePlaybackDetail();
});
document.querySelector("#detail-refresh-lyrics").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const track = tracks[currentIndex];
  if (!track || button.classList.contains("loading")) return;
  button.classList.add("loading");
  button.setAttribute("aria-busy", "true");
  await refreshCurrentLyricsFromNetwork();
  button.classList.remove("loading");
  button.removeAttribute("aria-busy");
  animatePlayerToolButton(button);
});
document.querySelector("#cancel-selection").addEventListener("click", () => {
  selectedTrackIds.clear();
  multiSelectionMode = false;
  render();
});
document.querySelector("#select-all").addEventListener("click", () => {
  visibleTracks().forEach((track) => selectedTrackIds.add(track.id));
  render();
});
document.querySelector("#play-selected").addEventListener("click", () => {
  const selected = visibleTracks().filter((track) => selectedTrackIds.has(track.id));
  if (!selected.length) return;
  playbackQueueIds = selected.map((track) => track.id);
  selectedTrackIds.clear();
  playTrack(tracks.findIndex((track) => track.id === playbackQueueIds[0]), true);
  render();
});
document.querySelector("#next-selected").addEventListener("click", () => {
  const selected = visibleTracks().filter((track) => selectedTrackIds.has(track.id)).map((track) => track.id);
  const currentId = tracks[currentIndex]?.id;
  const remaining = playbackQueueIds.filter((id) => !selected.includes(id));
  const insertAt = Math.max(0, remaining.indexOf(currentId) + 1);
  remaining.splice(insertAt, 0, ...selected);
  playbackQueueIds = remaining;
  selectedTrackIds.clear();
  persist();
  render();
});
document.querySelector("#queue-selected").addEventListener("click", () => {
  visibleTracks().forEach((track) => {
    if (selectedTrackIds.has(track.id) && !playbackQueueIds.includes(track.id)) playbackQueueIds.push(track.id);
  });
  selectedTrackIds.clear();
  persist();
  render();
});
document.querySelector("#playlist-play-all").addEventListener("click", () => {
  const first = visibleTracks()[0];
  if (first) playTrack(tracks.findIndex((track) => track.id === first.id));
});
document.querySelector("#playlist-add-songs").addEventListener("click", addSongsToCurrentPlaylist);
document.querySelector("#playlist-rename").addEventListener("click", renameCurrentPlaylist);
document.querySelector("#playlist-delete").addEventListener("click", deleteCurrentPlaylist);
document.querySelector("#detail-save-queue").addEventListener("click", savePlaybackQueueAsPlaylist);
document.querySelector("#playlist-art").addEventListener("click", choosePlaylistCover);
document.querySelector("#open-playback-detail").addEventListener("click", () => {
  if (currentView === "player") {
    closePlaybackDetail();
    return;
  }
  openPlaybackDetail();
});
document.querySelector("#back-button").addEventListener("click", goBack);
document.querySelector(".menu-button").addEventListener("click", () => {
  sidebarCollapsed = !sidebarCollapsed;
  document.querySelector(".app-shell").classList.toggle("sidebar-collapsed", sidebarCollapsed);
  localStorage.setItem("medo.sidebarCollapsed", String(sidebarCollapsed));
});
const sidebarResizer = document.querySelector("#sidebar-resizer");
sidebarResizer.addEventListener("pointerdown", (event) => {
  if (sidebarCollapsed || event.button !== 0) return;
  const startX = event.clientX;
  const startWidth = sidebarWidth;
  sidebarResizer.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing-sidebar");
  const move = (moveEvent) => {
    sidebarWidth = Math.min(360, Math.max(190, startWidth + moveEvent.clientX - startX));
    document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  };
  const finish = () => {
    sidebarResizer.removeEventListener("pointermove", move);
    document.body.classList.remove("resizing-sidebar");
    localStorage.setItem("medo.sidebarWidth", String(Math.round(sidebarWidth)));
  };
  sidebarResizer.addEventListener("pointermove", move);
  sidebarResizer.addEventListener("pointerup", finish, { once: true });
  sidebarResizer.addEventListener("pointercancel", finish, { once: true });
});
document.querySelector("#window-minimize").addEventListener("click", window.medo.minimizeWindow);
document.querySelector("#window-maximize").addEventListener("click", window.medo.toggleMaximizeWindow);
document.querySelector("#window-close").addEventListener("click", window.medo.closeWindow);
document.querySelector("#collection-back").addEventListener("click", () => {
  currentCollection = null;
  render();
  animateViewSurface();
});
playButton.addEventListener("click", togglePlayback);
document.querySelector("#previous-button").addEventListener("click", () => nextTrack(-1));
document.querySelector("#next-button").addEventListener("click", () => nextTrack(1));
favoriteButton.addEventListener("click", () => toggleFavorite());

document.querySelector("#play-mode-button").addEventListener("click", () => {
  playMode = playMode === "list-once" ? "sequence" :
    playMode === "sequence" ? "shuffle" :
      playMode === "shuffle" ? "repeat-one" : "list-once";
  localStorage.setItem("medo.playMode", playMode);
  if (playMode === "shuffle") {
    shuffleQueueSignature = "";
    shuffleRemainingIds = [];
    shuffleHistoryIds = [];
    shuffleHistoryIndex = -1;
  }
  updatePlayModeButton();
});
document.querySelector("#playlists-overview").addEventListener("click", () => {
  selectedTrackIds.clear();
  multiSelectionMode = false;
  currentPlaylist = null;
  currentCollection = null;
  currentView = "playlists";
  setActiveNav(null);
  render();
  animateViewSurface();
});
function animatePlayerToolButton(button) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  button.getAnimations().forEach((animation) => animation.cancel());
  button.animate(
    [
      { transform: "scale(.82) rotate(-7deg)" },
      { transform: "scale(1.08) rotate(2deg)", offset: .58 },
      { transform: "scale(1) rotate(0)" }
    ],
    { duration: 320, easing: "cubic-bezier(.22,1,.36,1)" }
  );
}

function animateDetailPanelToggle(button, panel, visible) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  animatePlayerToolButton(button);
  panel.getAnimations().forEach((animation) => animation.cancel());
  panel.animate(
    visible
      ? [{ opacity: 0, transform: "translateX(24px) scale(.97)" }, { opacity: 1, transform: "translateX(0) scale(1)" }]
      : [{ filter: "brightness(1.08)" }, { filter: "brightness(1)" }],
    { duration: visible ? 360 : 220, easing: "cubic-bezier(.22,1,.36,1)" }
  );
}

document.querySelector("#toggle-detail-track").addEventListener("click", () => {
  detailTrackVisible = !detailTrackVisible;
  const button = document.querySelector("#toggle-detail-track");
  document.body.classList.toggle("detail-track-hidden", !detailTrackVisible);
  button.classList.toggle("active", detailTrackVisible);
  animateDetailPanelToggle(button, document.querySelector(".detail-track"), detailTrackVisible);
});
document.querySelector("#toggle-detail-queue").addEventListener("click", () => {
  detailQueueVisible = !detailQueueVisible;
  const button = document.querySelector("#toggle-detail-queue");
  document.body.classList.toggle("detail-queue-hidden", !detailQueueVisible);
  button.classList.toggle("active", detailQueueVisible);
  animateDetailPanelToggle(button, document.querySelector(".detail-queue"), detailQueueVisible);
});
document.querySelector("#desktop-lyrics-button").addEventListener("click", () => {
  animatePlayerToolButton(document.querySelector("#desktop-lyrics-button"));
  window.medo.toggleLyricsWindow();
  activeLyricIndex = -1;
  updateLyricsAtTime();
});
document.querySelector("#volume-button").addEventListener("click", () => {
  const button = document.querySelector("#volume-button");
  animatePlayerToolButton(button);
  audio.muted = !audio.muted;
  updateMuteButton();
  window.medo.setTrayMuted(audio.muted);
  schedulePersist();
});
window.medo.onLyricsWindowVisibility((visible) => {
  document.querySelector("#desktop-lyrics-button").classList.toggle("active", visible);
});
window.medo.onLyricsWindowLockState((locked) => {
  syncDesktopLyricLockSetting(locked);
});

const lyricsStage = document.querySelector(".lyrics-stage");
const lyricsLines = document.querySelector("#lyrics-lines");
function scheduleLyricFollowRestore() {
  clearTimeout(lyricInspectionRestoreTimer);
  lyricInspectionRestoreTimer = setTimeout(() => {
    selectedLyricElement?.classList.remove("selected");
    selectedLyricElement = null;
    lyricInspectionActive = false;
    lyricInspectionOffset = 0;
    activeLyricIndex = -1;
    lyricsStage.classList.remove("inspecting");
    updateLyricsAtTime();
  }, 5000);
}
lyricsStage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !lyricsCache.get(tracks[currentIndex]?.id)?.synced) return;
  lyricDragPointerId = event.pointerId;
  lyricDragStartY = event.clientY;
  lyricDraggedDistance = 0;
  const transform = getComputedStyle(lyricsLines).transform;
  lyricDragStartOffset = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
  clearTimeout(lyricInspectionRestoreTimer);
});
lyricsStage.addEventListener("pointermove", (event) => {
  if (event.pointerId !== lyricDragPointerId) return;
  lyricDraggedDistance = Math.max(lyricDraggedDistance, Math.abs(event.clientY - lyricDragStartY));
  if (lyricDraggedDistance <= 5) return;
  event.preventDefault();
  if (!lyricInspectionActive) {
    lyricInspectionActive = true;
    lyricsStage.classList.add("inspecting");
    lyricsStage.setPointerCapture(event.pointerId);
  }
  lyricInspectionOffset = lyricDragStartOffset + event.clientY - lyricDragStartY;
  lyricsLines.style.transform = `translateY(${lyricInspectionOffset}px)`;
});
lyricsStage.addEventListener("click", (event) => {
  if (lyricDraggedDistance > 6) {
    event.preventDefault();
    event.stopPropagation();
    lyricDraggedDistance = 0;
    return;
  }
  const line = event.target.closest(".lyric-line[data-start]");
  if (!line) return;
  if (selectedLyricElement !== line) {
    selectedLyricElement?.classList.remove("selected");
    selectedLyricElement = line;
    selectedLyricElement.classList.add("selected");
    lyricInspectionActive = true;
    lyricsStage.classList.add("inspecting");
    scheduleLyricFollowRestore();
    return;
  }
  audio.currentTime = Math.max(0, Number(line.dataset.start) || 0);
  selectedLyricElement.classList.remove("selected");
  selectedLyricElement = null;
  clearTimeout(lyricInspectionRestoreTimer);
  lyricInspectionActive = false;
  activeLyricIndex = -1;
  lyricsStage.classList.remove("inspecting");
  updateLyricsAtTime();
}, true);
["pointerup", "pointercancel"].forEach((eventName) => {
  lyricsStage.addEventListener(eventName, (event) => {
    if (event.pointerId !== lyricDragPointerId) return;
    lyricDragPointerId = null;
    if (lyricInspectionActive) scheduleLyricFollowRestore();
  });
});
lyricsStage.addEventListener("wheel", (event) => {
  if (!lyricsCache.get(tracks[currentIndex]?.id)?.synced) return;
  event.preventDefault();
  if (!lyricInspectionActive) {
    const transform = getComputedStyle(lyricsLines).transform;
    lyricInspectionOffset = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
  }
  lyricInspectionActive = true;
  lyricsStage.classList.add("inspecting");
  lyricInspectionOffset -= event.deltaY * .72;
  lyricsLines.style.transform = `translateY(${lyricInspectionOffset}px)`;
  scheduleLyricFollowRestore();
}, { passive: false });
const searchInput = document.querySelector("#search-input");
searchInput.addEventListener("input", (event) => {
  query = event.target.value.trim().toLowerCase();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 100);
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  clearTimeout(searchTimer);
  query = searchInput.value.trim().toLowerCase();
  render();
  searchInput.blur();
});

document.querySelectorAll(".nav-item[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedTrackIds.clear();
    multiSelectionMode = false;
    if (button.dataset.view === "settings") {
      if (currentView === "settings" && viewBeforeSettings) {
        const previous = viewBeforeSettings;
        viewBeforeSettings = null;
        currentView = previous.view;
        currentPlaylist = previous.playlist;
        currentCollection = previous.collection;
        const previousNav = previous.navView
          ? document.querySelector(`.nav-item[data-view="${previous.navView}"]`)
          : null;
        setActiveNav(previousNav);
      } else {
        viewBeforeSettings = {
          view: currentView,
          playlist: currentPlaylist,
          collection: currentCollection,
          navView: document.querySelector(".nav-item[data-view].active")?.dataset.view || null
        };
        currentPlaylist = null;
        currentCollection = null;
        currentView = "settings";
        setActiveNav(button);
      }
      render();
      animateViewSurface();
      return;
    }
    viewBeforeSettings = null;
    currentPlaylist = null;
    currentCollection = null;
    currentView = button.dataset.view;
    setActiveNav(button);
    render();
    animateViewSurface();
  });
});
document.querySelectorAll(".pivot").forEach((button) => {
  button.addEventListener("click", () => {
    selectedTrackIds.clear();
    currentSort = button.dataset.sort;
    document.querySelectorAll(".pivot").forEach((item) => item.classList.toggle("active", item === button));
    render();
    animateContentChange();
  });
});
document.querySelector("#library-sort").addEventListener("change", (event) => {
  librarySort = event.target.value;
  localStorage.setItem("medo.librarySort", librarySort);
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    event.target.closest(".sort-choice")?.querySelector(".sort-value")?.animate(
      [
        { filter: "saturate(1.28) brightness(1.08)" },
        { filter: "saturate(1) brightness(1)" }
      ],
      { duration: 220, easing: "ease-out" }
    );
  }
  event.target.blur();
  render();
  animateContentChange();
});
document.querySelectorAll(".theme-option").forEach((button) => {
  button.addEventListener("click", () => {
    applyTheme(button.dataset.themeValue);
    localStorage.setItem("medo.theme", theme);
  });
});
document.querySelector("#theme-primary-color").addEventListener("input", (event) => {
  applyThemeColors(event.target.value, themeSecondaryColor);
});
document.querySelector("#theme-primary-color").addEventListener("change", (event) => {
  applyThemeColors(event.target.value, themeSecondaryColor, true);
});
document.querySelector("#theme-secondary-color").addEventListener("input", (event) => {
  applyThemeColors(themePrimaryColor, event.target.value);
});
document.querySelector("#theme-secondary-color").addEventListener("change", (event) => {
  applyThemeColors(themePrimaryColor, event.target.value, true);
});
document.querySelector("#reset-theme-colors").addEventListener("click", () => {
  localStorage.removeItem("medo.themePrimaryColor");
  localStorage.removeItem("medo.themeSecondaryColor");
  applyThemeColors("#2864ff", "#d934ff");
});
document.querySelectorAll(".display-option").forEach((button) => {
  button.addEventListener("click", () => {
    applyDisplayMode(button.dataset.displayValue);
    localStorage.setItem("medo.displayMode", displayMode);
    render();
  });
});
document.querySelectorAll(".close-behavior-option").forEach((button) => {
  button.addEventListener("click", () => applyCloseBehavior(button.dataset.closeValue));
});
document.querySelectorAll(".global-play-shortcut-option").forEach((button) => {
  button.addEventListener("click", () => applyGlobalShortcutSettings("playPause", button.dataset.enabled === "true"));
});
document.querySelectorAll(".global-lyrics-shortcut-option").forEach((button) => {
  button.addEventListener("click", () => applyGlobalShortcutSettings("lyricsRefresh", button.dataset.enabled === "true"));
});
document.querySelectorAll(".global-previous-shortcut-option").forEach((button) => {
  button.addEventListener("click", () => applyGlobalShortcutSettings("previous", button.dataset.enabled === "true"));
});
document.querySelectorAll(".global-next-shortcut-option").forEach((button) => {
  button.addEventListener("click", () => applyGlobalShortcutSettings("next", button.dataset.enabled === "true"));
});
document.querySelectorAll(".lyric-translation-option").forEach((button) => {
  button.addEventListener("click", () => applyLyricTranslationSetting(button.dataset.translationValue === "on"));
});
document.querySelectorAll(".word-lyrics-option").forEach((button) => {
  button.addEventListener("click", () => applyWordLyricsSetting(button.dataset.wordLyricsValue === "on", true));
});
document.querySelector("#lyric-translation-toggle").addEventListener("click", () => {
  animatePlayerToolButton(document.querySelector("#lyric-translation-toggle"));
  const track = tracks[currentIndex];
  if (!track) return;
  hiddenLyricTranslations.has(track.id)
    ? hiddenLyricTranslations.delete(track.id)
    : hiddenLyricTranslations.add(track.id);
  renderLyrics(track);
});
document.querySelector("#desktop-lyric-size").addEventListener("input", (event) => {
  applyDesktopLyricSize(event.target.value);
});
document.querySelector("#desktop-lyric-primary-color").addEventListener("input", (event) => {
  applyDesktopLyricColors(event.target.value, desktopLyricSecondaryColor);
});
document.querySelector("#desktop-lyric-primary-color").addEventListener("change", (event) => {
  applyDesktopLyricColors(event.target.value, desktopLyricSecondaryColor, true);
});
document.querySelector("#desktop-lyric-secondary-color").addEventListener("input", (event) => {
  applyDesktopLyricColors(desktopLyricPrimaryColor, event.target.value);
});
document.querySelector("#desktop-lyric-secondary-color").addEventListener("change", (event) => {
  applyDesktopLyricColors(desktopLyricPrimaryColor, event.target.value, true);
});
document.querySelector("#reset-desktop-lyric-colors").addEventListener("click", () => {
  localStorage.removeItem("medo.desktopLyricPrimaryColor");
  localStorage.removeItem("medo.desktopLyricSecondaryColor");
  applyDesktopLyricColors("#2864ff", "#d934ff");
});
document.querySelector("#detail-lyric-size").addEventListener("input", (event) => {
  applyDetailLyricSize(event.target.value);
});
document.querySelectorAll(".desktop-lyric-lock-option").forEach((button) => {
  button.addEventListener("click", () => {
    const locked = button.dataset.lockedValue === "true";
    syncDesktopLyricLockSetting(locked);
    window.medo.lockLyricsWindow(locked);
  });
});
document.querySelector("#reset-desktop-lyric-position").addEventListener("click", (event) => {
  window.medo.resetLyricsWindowPosition();
  const button = event.currentTarget;
  button.animate(
    [{ transform: "scale(.96)", filter: "brightness(1.12)" }, { transform: "scale(1)", filter: "brightness(1)" }],
    { duration: 220, easing: "cubic-bezier(.22,1,.36,1)" }
  );
});

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (theme === "system") applyTheme("system");
});
window.medo.onResolvedTheme((resolvedTheme) => {
  if (theme !== "system" || !["light", "dark"].includes(resolvedTheme)) return;
  document.documentElement.dataset.theme = resolvedTheme;
});
document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]") || event.defaultPrevented) return;
  if (event.key === "Escape") {
    event.preventDefault();
    goBack();
    return;
  }
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("input, textarea, select, button, [contenteditable='true'], [role='slider']")) return;
  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    togglePlayback();
    return;
  }
  const volumeOffset = event.key === "ArrowUp" ? .05 : event.key === "ArrowDown" ? -.05 : 0;
  if (volumeOffset) {
    event.preventDefault();
    desiredVolume = Math.round(Math.max(0, Math.min(1, desiredVolume + volumeOffset)) * 100) / 100;
    volume.value = desiredVolume;
    ensureOutputGain();
    applyOutputVolume();
    updateVolumeDisplay();
    showVolumeBubble(true);
    schedulePersist();
    return;
  }
  if (!audio.src || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const seekOffset = event.key === "ArrowLeft" ? -5 : event.key === "ArrowRight" ? 5 : 0;
  if (!seekOffset) return;
  event.preventDefault();
  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seekOffset));
  progress.value = audio.duration ? audio.currentTime / audio.duration * 100 : 0;
  updateRangeGradient(progress, audio.duration ? audio.currentTime / audio.duration : 0);
  document.querySelector("#current-time").textContent = formatTime(audio.currentTime);
  updateLyricsAtTime();
  schedulePersist();
});

audio.addEventListener("play", () => {
  const completedTrackSwitch = switchingPlaybackGeneration !== 0;
  switchingPlaybackGeneration = 0;
  updatePlayButtonState(true);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  activeLyricIndex = -1;
  updateLyricsAtTime();
  if (!completedTrackSwitch && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    playButton.animate(
      [
        { opacity: 0.65, transform: "scale(0.92)" },
        { opacity: 1, transform: "scale(1)" }
      ],
      { duration: 150, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
    );
  }
});
audio.addEventListener("pause", () => {
  if (switchingPlaybackGeneration !== 0) return;
  updatePlayButtonState(false);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  activeLyricIndex = -1;
  updateLyricsAtTime();
  schedulePersist();
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    playButton.animate(
      [
        { opacity: 0.65, transform: "scale(0.92)" },
        { opacity: 1, transform: "scale(1)" }
      ],
      { duration: 150, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
    );
  }
});
audio.addEventListener("timeupdate", () => {
  if (backgroundMode) updateLyricsAtTime();
  if (backgroundMode && performance.now() - lastBackgroundUiUpdate < 1000) return;
  lastBackgroundUiUpdate = performance.now();
  if (performance.now() - lastPlaybackStateSave > 5000) {
    lastPlaybackStateSave = performance.now();
    persist();
  }
  progress.value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  updateRangeGradient(progress, audio.duration ? audio.currentTime / audio.duration : 0);
  document.querySelector("#current-time").textContent = formatTime(audio.currentTime);
  if (!backgroundMode) updateLyricsAtTime();
  if ("mediaSession" in navigator && audio.duration && performance.now() - lastMediaSessionUpdate > 1000) {
    lastMediaSessionUpdate = performance.now();
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate,
        position: Math.min(audio.currentTime, audio.duration)
      });
    } catch {}
  }
});
audio.addEventListener("loadedmetadata", () => {
  document.querySelector("#duration").textContent = formatTime(audio.duration);
});
audio.addEventListener("ended", () => {
  if (playMode === "repeat-one") return playTrack(currentIndex, true);
  if (playMode === "list-once") {
    const queueIndex = playbackQueueIds.indexOf(tracks[currentIndex]?.id);
    if (queueIndex < 0 || queueIndex >= playbackQueueIds.length - 1) {
      audio.pause();
      audio.currentTime = audio.duration || 0;
      return;
    }
  }
  nextTrack();
});
audio.addEventListener("error", () => recoverPlaybackFailure(tracks[currentIndex]));

progress.addEventListener("input", () => {
  if (audio.duration) audio.currentTime = (Number(progress.value) / 100) * audio.duration;
});
volume.addEventListener("input", () => {
  desiredVolume = Number(volume.value);
  ensureOutputGain();
  applyOutputVolume();
  updateVolumeDisplay();
  showVolumeBubble(!volumePointerActive);
  schedulePersist();
});
volume.addEventListener("pointerdown", () => {
  volumePointerActive = true;
  showVolumeBubble();
});
["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
  volume.addEventListener(eventName, () => {
    volumePointerActive = false;
    hideVolumeBubble();
  });
});
volume.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
    showVolumeBubble();
  }
});
volume.addEventListener("keyup", hideVolumeBubble);
volume.addEventListener("blur", hideVolumeBubble);

async function restorePlaybackState() {
  desiredVolume = Math.min(1, Math.max(0, Number(restoredPlaybackState.volume ?? .7)));
  volume.value = desiredVolume;
  updateVolumeDisplay();
  applyOutputVolume();
  audio.muted = Boolean(restoredPlaybackState.muted);
  updateMuteButton();
  const index = tracks.findIndex((track) => track.id === restoredPlaybackState.trackId);
  if (index < 0) return;
  currentIndex = index;
  const track = tracks[index];
  const source = await window.medo.resolveMediaSource(track.path);
  if (!source) return;
  track.url = source;
  audio.src = source;
  audio.load();
  audio.addEventListener("loadedmetadata", () => {
    audio.currentTime = Math.min(Number(restoredPlaybackState.currentTime) || 0, Math.max(0, audio.duration - .1));
  }, { once: true });
  updateNowPlaying(track);
  loadMetadata(track).catch(() => {});
  ensureLyrics(track);
  audio.pause();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
}

window.addEventListener("beforeunload", persist);

document.addEventListener("visibilitychange", () => {
  backgroundMode = document.hidden;
  document.body.classList.toggle("background-mode", backgroundMode);
  if (!backgroundMode) {
    lastBackgroundUiUpdate = 0;
    if (currentView === "player") {
      updateLyricsAtTime();
      renderPlaybackDetail();
    }
  }
});

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => audio.play());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => nextTrack(-1));
  navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack(1));
}

desiredVolume = Math.min(1, Math.max(0, Number(restoredPlaybackState.volume ?? desiredVolume)));
volume.value = desiredVolume;
applyOutputVolume();
window.medo.setTrayMuted(audio.muted);
updateVolumeDisplay();
updateRangeGradient(progress, 0);
applyTheme(theme);
applyThemeColors();
applyDisplayMode(displayMode);
applyCloseBehavior(closeBehavior);
applyGlobalShortcutSettings();
applyLyricTranslationSetting(lyricTranslationEnabled);
applyWordLyricsSetting(wordLyricsEnabled);
applyDesktopLyricSize(desktopLyricSize);
applyDesktopLyricColors();
applyDetailLyricSize(detailLyricSize);
window.medo.getLyricsWindowState().then((state) => {
  syncDesktopLyricLockSetting(state?.locked);
  document.querySelector("#desktop-lyrics-button").classList.toggle("active", Boolean(state?.visible));
}).catch(() => {});
removeRedundantMusicFolders();
document.querySelector("#toggle-detail-track").classList.add("active");
document.querySelector("#toggle-detail-queue").classList.add("active");
updatePlayModeButton();
document.querySelector(".app-shell").classList.toggle("sidebar-collapsed", sidebarCollapsed);
document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
render();
migratePlaylistOrder();
initializeDefaultLibrary();
renderAppInfo();
restorePlaybackState();
window.medo.onOpenAudioFiles((filePaths) => {
  openExternalAudioFiles(filePaths).catch(() => {});
});
window.medo.onLibraryFolderChanged(scheduleAutomaticFolderScan);
syncMusicFolderWatchers();
setInterval(() => scanManagedFoldersIncrementally().catch(() => {}), 120000);

window.medo.onMyFireflyCommand(async (payload) => {
  try {
    const result = await handleMyFireflyCommand(payload);
    window.medo.respondToMyFirefly({ id: payload.id, ok: true, result });
  } catch (error) {
    window.medo.respondToMyFirefly({
      id: payload.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

window.medo.onTrayCommand(({ command, value }) => {
  if (command === "volume-up" || command === "volume-down") {
    desiredVolume = Math.max(0, Math.min(1, desiredVolume + (command === "volume-up" ? 0.05 : -0.05)));
    volume.value = desiredVolume;
    ensureOutputGain();
    applyOutputVolume();
    updateVolumeDisplay();
  } else if (command === "toggle-mute") {
    audio.muted = !audio.muted;
    updateMuteButton();
    window.medo.setTrayMuted(audio.muted);
  } else if (command === "set-mode") {
    playMode = value;
    if (playMode === "shuffle") {
      shuffleQueueSignature = "";
      shuffleRemainingIds = [];
      shuffleHistoryIds = [];
      shuffleHistoryIndex = -1;
    }
    persist();
    updatePlayModeButton();
  } else if (command === "desktop-lyric-size") {
    applyDesktopLyricSize(value);
  } else if (command === "previous") nextTrack(-1);
  else if (command === "next") nextTrack(1);
  else if (command === "toggle-play") togglePlayback();
  else if (command === "refresh-lyrics") refreshCurrentLyricsFromNetwork();
  else if (command === "open-settings" || command === "open-desktop-lyric-settings") {
    selectedTrackIds.clear();
    multiSelectionMode = false;
    if (currentView !== "settings") {
      viewBeforeSettings = {
        view: currentView,
        playlist: currentPlaylist,
        collection: currentCollection,
        navView: document.querySelector(".nav-item[data-view].active")?.dataset.view || null
      };
    }
    currentPlaylist = null;
    currentCollection = null;
    currentView = "settings";
    setActiveNav(document.querySelector('.nav-item[data-view="settings"]'));
    render();
    animateViewSurface();
    if (command === "open-desktop-lyric-settings") {
      requestAnimationFrame(() => {
        const setting = document.querySelector(".desktop-lyric-size-setting");
        setting?.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => document.querySelector("#desktop-lyric-size")?.focus(), 240);
      });
    }
  }
});
