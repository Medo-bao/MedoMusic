const audio = document.querySelector("#audio");
audio.crossOrigin = "anonymous";
const trackList = document.querySelector("#track-list");
const emptyState = document.querySelector("#empty-state");
const playButton = document.querySelector("#play-button");
const progress = document.querySelector("#progress");
const volume = document.querySelector("#volume");
const favoriteButton = document.querySelector("#favorite-button");
const missingArt = "../Groove/Assets/MissingAlbumArt.jpg";
const { completeWordTimings, resolveYrcWordStart, parseLyricMetadataLine, parseLyricInformationLine } = window.MedoLyricsTiming;

function updatePlayButtonState(playing) {
  document.body.classList.toggle("is-playing", playing);
  const action = playing ? "暂停" : "播放";
  playButton.innerHTML = playing ? "&#xE769;" : "&#xE768;";
  playButton.title = action;
  playButton.setAttribute("aria-label", action);
}

let tracks = loadJson("medo.tracks", []);
if (localStorage.getItem("medo.coverSizing") !== "proportional") {
  let refreshed = false;
  for (const track of tracks) {
    if (!track.cover?.startsWith("medo-media://local/cover?")) continue;
    track.cover = null;
    track.metadataLoaded = false;
    refreshed = true;
  }
  if (refreshed) localStorage.setItem("medo.tracks", JSON.stringify(tracks));
  localStorage.setItem("medo.coverSizing", "proportional");
}
let playlists = loadJson("medo.playlists", []);
let musicFolders = loadJson("medo.musicFolders", []);
let favorites = new Set(loadJson("medo.favorites", []));
let recent = loadJson("medo.recent", []);
let playStats = loadJson("medo.playStats", {});
const storedListeningStats = loadJson("medo.listeningStats", {});
let listeningDailyMs = normalizeListeningDays(storedListeningStats.dailyMs);
let listeningTimeMs = Object.values(listeningDailyMs).reduce((sum, milliseconds) => sum + milliseconds, 0);
let listeningFractionalMs = 0;
let listeningStatsSaveFailed = false;
let listeningPosition = null;
let listeningPlaybackRate = 1;
let listeningCalendarMonth = listeningDateKey(new Date()).slice(0, 7);
let listeningSelectedDate = listeningDateKey(new Date());
let listeningCalendarToday = listeningSelectedDate;
let listeningCalendarSignature = "";
let listeningCalendarRolloverTimer = null;
let listeningPickerYear = Number(listeningCalendarMonth.slice(0, 4));
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
let inactiveLyricColor = localStorage.getItem("medo.inactiveLyricColor");
let desktopLyricPrimaryColor = localStorage.getItem("medo.desktopLyricPrimaryColor") || "#2864ff";
let desktopLyricSecondaryColor = localStorage.getItem("medo.desktopLyricSecondaryColor") || "#d934ff";
let displayMode = localStorage.getItem("medo.displayMode") || "thumbnail";
let coverFit = localStorage.getItem("medo.coverFit") || "cover";
let closeBehavior = localStorage.getItem("medo.closeBehavior") || "background";
let trayEnabled = localStorage.getItem("medo.trayEnabled") === "true";
let autoCheckUpdates = localStorage.getItem("medo.autoCheckUpdates") !== "false";
let globalPlayPauseShortcutEnabled = localStorage.getItem("medo.globalPlayPauseShortcutEnabled") !== "false";
let globalDesktopLyricsShortcutEnabled = localStorage.getItem("medo.globalDesktopLyricsShortcutEnabled") !== "false";
let globalLyricsRefreshShortcutEnabled = localStorage.getItem("medo.globalLyricsRefreshShortcutEnabled") !== "false";
let globalPreviousShortcutEnabled = localStorage.getItem("medo.globalPreviousShortcutEnabled") !== "false";
let globalNextShortcutEnabled = localStorage.getItem("medo.globalNextShortcutEnabled") !== "false";
let pendingShortcutFeedback = null;
const lastShortcutStates = new Map();
let globalShortcutBindings = loadJson("medo.globalShortcutBindings", {});
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
let lyricRetryState = null;
const automaticFolderScans = new Map();
const folderScanTickets = new Map();
let nextFolderScanTicket = 0;
let libraryFolderRevision = 0;
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
let renderedLyricsState = null;
let renderedLyricElements = [];
let lastDesktopLyricsState = null;
let lyricPresentationSuspended = true;
const lyricWordMetrics = new WeakMap();
let lyricPointerInside = false;
let detailTrackVisible = true;
let detailQueueVisible = true;
let desktopLyricsLocked = false;
const INITIAL_TRACK_RENDER_LIMIT = 48;
let disposeTrackWindow = () => {};
let backgroundMode = document.hidden;
let nativeWindowVisible = true;
let lastBackgroundUiUpdate = 0;
let lastMediaSessionUpdate = 0;
let playbackGeneration = 0;
let switchingPlaybackGeneration = 0;
const playbackFailedIds = new Set();
let lastPreviousRestartAt = 0;
let lastPreviousRestartTrackId = null;
let desiredVolume = Number(volume.value);
let outputAudioContext = null;
let outputAudioSource = null;
let outputFadeGain = null;
let playbackFadeEnabled = localStorage.getItem("medo.playbackFadeEnabled") === "true";
let playbackFadeEnvelope = null;
let playbackPausePending = false;
let playbackFadePauseTimer = null;
let soundEngine = null;
let soundInitialization = null;
let soundFailure = null;
let soundCompare = false;
let soundSettings = MedoSound.fromStorage(loadJson("medo.sound", {preset:"flat"}));
const soundPresetRecords = loadJson("medo.soundPresets", {});
for (const record of Object.values(soundPresetRecords)) {
  if (record?.settings) record.settings = MedoSound.fromStorage(record.settings);
}
localStorage.setItem("medo.soundPresets", JSON.stringify(soundPresetRecords));
const storedSoundCustom = loadJson("medo.soundCustom", null);
if (storedSoundCustom) localStorage.setItem("medo.soundCustom", JSON.stringify(MedoSound.fromStorage(storedSoundCustom)));
const deletedSoundPresets = new Set(loadJson("medo.deletedSoundPresets", []));
if (deletedSoundPresets.has(soundSettings.preset)) {
  soundSettings = MedoSound.normalize({...savedSoundPreset("flat"),preset:"flat",enabled:soundSettings.enabled});
}
function soundPresetSnapshot(settings) {
  const { enabled, preset, ...values } = MedoSound.normalize(settings);
  return JSON.stringify(values);
}
function savedSoundPreset(id) {
  return soundPresetRecords[id]?.settings || (id === "custom" ? MedoSound.fromStorage(loadJson("medo.soundCustom", {})) : MedoSound.presets[id]);
}
function saveSoundPresetRecords() {
  localStorage.setItem("medo.soundPresets", JSON.stringify(soundPresetRecords));
}

let selectionActionsHideTimer = null;
let selectionActionsShowFrame = null;
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
const coverAtmosphere = window.MedoAppearance.create({
  getCurrentCover: () => tracks[currentIndex]?.cover || missingArt,
  missingArt
});
const favoriteMetadataPrimed = new Set();
const restoredPlaybackState = loadJson("medo.playbackState", {});
let lastPlaybackStateSave = 0;

function ensureAudioProcessing() {
  if (!outputAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    // Transport controls need a short output buffer. Keep the prepared context
    // running during pauses so resuming never waits for the audio device to wake.
    outputAudioContext = new AudioContextClass({ latencyHint: "interactive" });
    outputAudioSource = outputAudioContext.createMediaElementSource(audio);
    outputFadeGain = outputAudioContext.createGain();
    outputAudioSource.connect(outputFadeGain).connect(outputAudioContext.destination);
  }
  if (!soundEngine && !soundInitialization && (!soundFailure || soundSettings.enabled)) {
    soundFailure = null;
    const restoreOriginalAudio = error => {
      soundEngine?.dispose();
      soundEngine = null;
      // Web Audio deduplicates an existing connection; this also covers a
      // failure before the initial dry connection was removed.
      outputAudioSource.connect(outputFadeGain);
      soundSettings.enabled = false;
      soundCompare = false;
      soundFailure = '声音增强暂不可用，已恢复原声，可重新开启重试';
      console.error('Sound processing failed', error);
      updateSoundSettings();
    };
    soundInitialization = MedoSound.prepare(outputAudioContext).then(() => {
      const engine = MedoSound.create(outputAudioContext, outputAudioSource, outputFadeGain, restoreOriginalAudio);
      try {
        engine.update(soundSettings, soundCompare, true);
        outputAudioSource.disconnect(outputFadeGain);
        soundEngine = engine;
      } catch (error) {
        engine.dispose();
        throw error;
      }
    }).catch(restoreOriginalAudio).finally(() => { soundInitialization = null; });
  }
  if (outputAudioContext.state === "suspended") {
    outputAudioContext.resume().catch(() => {});
  }
  applyOutputVolume();
}

function applyOutputVolume() {
  const normalizedVolume = Math.min(1, Math.max(0, desiredVolume));
  audio.volume = normalizedVolume;
}

function applyPlaybackFadeSetting(enabled) {
  playbackFadeEnabled = Boolean(enabled);
  localStorage.setItem("medo.playbackFadeEnabled", String(playbackFadeEnabled));
  document.querySelectorAll(".playback-fade-option").forEach(button => {
    const selected = (button.dataset.playbackFadeValue === "on") === playbackFadeEnabled;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-checked", String(selected));
  });
  if (!playbackFadeEnabled) {
    const shouldPause = playbackPausePending;
    resetPlaybackFade(shouldPause || audio.paused ? 0 : 1);
    if (shouldPause) audio.pause();
  }
}

document.querySelectorAll(".playback-fade-option").forEach(button => {
  button.addEventListener("click", () => applyPlaybackFadeSetting(button.dataset.playbackFadeValue === "on"));
});

function formatGainDb(value) {
  const db = Number(value) || 0;
  if (db === 0) return "0 dB";
  return `${db > 0 ? "+" : ""}${db} dB`;
}

function formatBalance(value) {
  const db = Number(value) || 0;
  if (db === 0) return "居中";
  return db > 0 ? `右 +${db} dB` : `左 +${Math.abs(db)} dB`;
}

function updateSoundSettings() {
  soundSettings = MedoSound.normalize(soundSettings);
  soundEngine?.update(soundSettings, soundCompare);
  localStorage.setItem("medo.sound", JSON.stringify(soundSettings));
  document.querySelector("#sound-enabled").checked = soundSettings.enabled;
  document.querySelector("#sound-quick-enabled").checked = soundSettings.enabled;
  const presetSelect = document.querySelector("#sound-preset");
  for (const option of [...presetSelect.options]) {
    if (option.value !== "flat" && deletedSoundPresets.has(option.value)) option.remove();
  }
  for (const [id, record] of Object.entries(soundPresetRecords)) {
    if (id.startsWith("user-") && ![...presetSelect.options].some(option => option.value === id)) {
      presetSelect.add(new Option(record.name, id));
    }
  }
  const modified = soundPresetSnapshot(soundSettings) !== soundPresetSnapshot(savedSoundPreset(soundSettings.preset));
  document.querySelector("#sound-save").disabled = !modified;
  document.querySelector("#sound-save-as").disabled = !modified;
  for (const option of presetSelect.options) {
    const name = soundPresetRecords[option.value]?.name || MedoSound.presets[option.value]?.name || "自定义";
    option.textContent = name + (option.value === soundSettings.preset && modified ? " *" : "");
  }
  presetSelect.value = soundSettings.preset;
  document.querySelector("#sound-delete").disabled = soundSettings.preset === "flat";
  const compare = document.querySelector("#sound-compare");
  compare.disabled = !soundSettings.enabled;
  compare.setAttribute("aria-pressed", String(soundCompare));
  compare.textContent = soundCompare ? "返回增强" : "对比原声";
  const effectMax = MedoSound.EFFECT_RANGE.max;
  for (const key of MedoSound.EFFECT_KEYS) {
    const percent = soundSettings[key] / effectMax * 100;
    document.querySelector(`#sound-${key}`).value = percent;
    document.querySelector(`#sound-${key}`).style.setProperty("--fill", `${percent}%`);
    document.querySelector(`#sound-${key}-value`).textContent = `${Math.round(percent)}%`;
  }
  const gainRange = MedoSound.MASTER_GAIN_RANGE, balanceRange = MedoSound.BALANCE_RANGE;
  const gainFill = (soundSettings.masterGain - gainRange.min) / (gainRange.max - gainRange.min) * 100;
  const balanceFill = (soundSettings.balance - balanceRange.min) / (balanceRange.max - balanceRange.min) * 100;
  document.querySelector("#sound-master-gain").value = soundSettings.masterGain;
  document.querySelector("#sound-master-gain").style.setProperty("--fill", `${gainFill}%`);
  document.querySelector("#sound-master-gain-value").textContent = formatGainDb(soundSettings.masterGain);
  document.querySelector("#sound-balance").value = soundSettings.balance;
  document.querySelector("#sound-balance").style.setProperty("--fill", `${balanceFill}%`);
  document.querySelector("#sound-balance-value").textContent = formatBalance(soundSettings.balance);
  const normalization = document.querySelector("#sound-normalization");
  normalization.value = soundSettings.normalization;
  normalization.style.setProperty("--fill", `${(soundSettings.normalization + 40) / 40 * 100}%`);
  document.querySelector("#sound-normalization-value").textContent = soundSettings.normalization ? `${soundSettings.normalization} dBFS` : "关闭";
  const leveling = document.querySelector("#sound-volume-leveling");
  leveling.value = soundSettings.volumeLeveling;
  leveling.style.setProperty("--fill", `${soundSettings.volumeLeveling / 4 * 100}%`);
  document.querySelector("#sound-volume-leveling-value").textContent = soundSettings.volumeLeveling ? `${soundSettings.volumeLeveling.toFixed(1)} / 4` : "关闭";
  document.querySelectorAll(".sound-band").forEach((label, i) => {
    label.querySelector("input").value = soundSettings.eq[i];
    label.querySelector("output").textContent = `${soundSettings.eq[i] > 0 ? "+" : ""}${soundSettings.eq[i]} dB`;
    const hz = soundSettings.centers[i];
    label.querySelector(".sound-frequency").textContent = `${hz} Hz`;
    label.querySelector("input").setAttribute("aria-label", `${hz} Hz 增益`);
    const knob = label.querySelector(".frequency-knob");
    const [min, max] = MedoSound.frequencyRanges[i];
    const center = MedoSound.frequencies[i];
    const progress = hz <= center
      ? .5 * (hz - min) / (center - min)
      : .5 + .5 * (hz - center) / (max - center);
    knob.setAttribute("aria-valuenow", hz);
    knob.setAttribute("aria-valuetext", `${hz} Hz`);
    knob.querySelector(".knob-value").setAttribute("stroke-dasharray", `${progress * (300 / 360 * 100)} 100`);
    const angle = (120 + progress * 300) * Math.PI / 180;
    knob.querySelector(".knob-dot").setAttribute("cx", 22 + 17 * Math.cos(angle));
    knob.querySelector(".knob-dot").setAttribute("cy", 22 + 17 * Math.sin(angle));
  });
  // The 184px track has a 14px thumb: centers span 7..177, with 0 dB at 92.
  document.querySelector("#sound-eq-line").setAttribute("points", soundSettings.eq.map((gain, i) => `${(i + .5) * 100},${92 - gain * (85 / 12)}`).join(" "));
  document.querySelector("#sound-entry-status").textContent = soundSettings.enabled ? "已启用" : "已关闭";
  document.querySelector("#sound-settings-entry").dataset.enabled = String(soundSettings.enabled);
  document.querySelector("#sound-status").textContent = soundFailure || (!soundSettings.enabled ? "声音增强已关闭" : soundCompare ? "正在试听原声，音效设置已保留" : "声音增强已启用");
}
for (const [i, frequency] of MedoSound.frequencies.entries()) {
  const label = document.createElement("div");
  label.className = "sound-band";
  const text = frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`;
  label.innerHTML = '<output></output><input type="range" min="-12" max="12" step="0.5"><span class="sound-frequency"></span>';
  label.querySelector("span").textContent = text;
  label.querySelector("input").setAttribute("aria-label", `${text} 增益`);
  label.querySelector("input").addEventListener("input", event => {
    soundSettings.eq[i] = Number(event.target.value); updateSoundSettings();
  });
  label.querySelector("input").addEventListener("dblclick", () => {
    soundSettings.eq[i] = 0; updateSoundSettings();
  });
  const [min, max] = MedoSound.frequencyRanges[i];
  const knob = document.createElement("button");
  knob.type = "button";
  knob.className = "frequency-knob";
  knob.setAttribute("role", "slider");
  knob.setAttribute("aria-label", `第 ${i + 1} 段中心频率`);
  knob.setAttribute("aria-valuemin", min);
  knob.setAttribute("aria-valuemax", max);
  knob.dataset.soundHelp = `沿圆环拖动，按住 Shift 精细调节（${min}–${max} Hz），方向键调节，右键或双击恢复 ${frequency} Hz`;
  knob.style.setProperty("--knob-gradient", `url(#sound-knob-gradient-${i})`);
  knob.innerHTML = `<svg viewBox="0 0 44 44" aria-hidden="true"><defs><linearGradient id="sound-knob-gradient-${i}" x1="0" y1="0" x2="1" y2="1"><stop class="sound-gradient-start"/><stop class="sound-gradient-end" offset="1"/></linearGradient></defs><path class="knob-center-mark" d="M22 0v3"/><circle class="knob-face" cx="22" cy="22" r="11"/><circle class="knob-track" cx="22" cy="22" r="17" pathLength="100" stroke-dasharray="83.333 16.667" transform="rotate(120 22 22)"/><circle class="knob-value" cx="22" cy="22" r="17" pathLength="100" transform="rotate(120 22 22)"/><circle class="knob-dot" r="3.5"/></svg>`;
  const setFrequency = value => {
    soundSettings.centers[i] = Math.max(min, Math.min(max, Math.round(value)));
    updateSoundSettings();
  };
  const frequencyText = label.querySelector(".sound-frequency");
  frequencyText.tabIndex = 0;
  frequencyText.setAttribute("role", "button");
  frequencyText.setAttribute("aria-label", `编辑第 ${i + 1} 段频率`);
  frequencyText.title = `双击输入频率（${min}–${max} Hz），回车确认，Esc 取消`;
  const frequencyInput = document.createElement("input");
  frequencyInput.type = "number";
  frequencyInput.className = "sound-frequency-input";
  frequencyInput.min = min;
  frequencyInput.max = max;
  frequencyInput.step = 1;
  frequencyInput.required = true;
  frequencyInput.hidden = true;
  frequencyInput.setAttribute("aria-label", `第 ${i + 1} 段频率，${min} 至 ${max} Hz`);
  frequencyText.after(frequencyInput);
  const openFrequencyEditor = () => {
    frequencyInput.value = soundSettings.centers[i];
    frequencyText.hidden = true;
    frequencyInput.hidden = false;
    frequencyInput.focus(); frequencyInput.select();
  };
  const closeFrequencyEditor = (save, restoreFocus = false) => {
    if (frequencyInput.hidden) return;
    const valid = frequencyInput.validity.valid;
    if (save && !valid && restoreFocus) { frequencyInput.reportValidity(); return; }
    frequencyInput.hidden = true;
    frequencyText.hidden = false;
    if (save && valid) setFrequency(frequencyInput.valueAsNumber);
    if (restoreFocus) frequencyText.focus();
  };
  frequencyText.addEventListener("dblclick", openFrequencyEditor);
  frequencyText.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openFrequencyEditor(); }
  });
  frequencyInput.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      closeFrequencyEditor(event.key === "Enter", true);
    }
  });
  frequencyInput.addEventListener("blur", () => closeFrequencyEditor(true));
  let drag = null;
  const pointerAngle = event => {
    const rect = knob.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    return Math.hypot(x,y) < 5 ? null : Math.atan2(y,x) * 180 / Math.PI;
  };
  const stopDrag = () => {
    drag = null;
    knob.classList.remove("is-dragging");
    label.classList.remove("is-tuning");
  };
  knob.addEventListener("contextmenu", event => { event.preventDefault(); setFrequency(frequency); });
  knob.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault(); knob.focus();
    const hz = soundSettings.centers[i];
    const progress = hz <= frequency ? .5 * (hz-min)/(frequency-min) : .5 + .5*(hz-frequency)/(max-frequency);
    drag = {id:event.pointerId, lastAngle:pointerAngle(event), position:progress*300};
    knob.setPointerCapture(event.pointerId);
    knob.classList.add("is-dragging");
    label.classList.add("is-tuning");
  });
  knob.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    const angle = pointerAngle(event);
    if (angle === null) return;
    if (drag.lastAngle === null) { drag.lastAngle = angle; return; }
    const delta = ((angle-drag.lastAngle+540)%360)-180;
    drag.lastAngle = angle;
    drag.position = Math.max(0,Math.min(300,drag.position + delta * (event.shiftKey ? .2 : 1)));
    const position = !event.shiftKey && Math.abs(drag.position-150)<2 ? 150 : drag.position;
    const progress = position/300;
    setFrequency(progress <= .5 ? min+progress*2*(frequency-min) : frequency+(progress-.5)*2*(max-frequency));
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) knob.addEventListener(name, stopDrag);
  knob.addEventListener("dblclick", () => setFrequency(frequency));
  knob.addEventListener("keydown", event => {
    const directions = {ArrowUp:1, ArrowRight:1, ArrowDown:-1, ArrowLeft:-1};
    if (directions[event.key]) { event.preventDefault(); setFrequency(soundSettings.centers[i] + directions[event.key] * (event.shiftKey ? 10 : 1)); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); setFrequency(event.key === "Home" ? min : max); }
  });
  label.append(knob);
  document.querySelector("#sound-bands").append(label);
}
for (const key of MedoSound.EFFECT_KEYS) {
  document.querySelector(`#sound-${key}`).addEventListener("input", event => {
    soundSettings[key] = Number(event.target.value) / 100 * MedoSound.EFFECT_RANGE.max; updateSoundSettings();
  });
  document.querySelector(`#sound-${key}`).addEventListener("dblclick", () => {
    soundSettings[key] = 0; updateSoundSettings();
  });
}
document.querySelector("#sound-master-gain").addEventListener("input", event => {
  soundSettings.masterGain = Number(event.target.value); updateSoundSettings();
});
document.querySelector("#sound-master-gain").addEventListener("dblclick", () => {
  soundSettings.masterGain = 0; updateSoundSettings();
});
document.querySelector("#sound-balance").addEventListener("input", event => {
  soundSettings.balance = Number(event.target.value); updateSoundSettings();
});
document.querySelector("#sound-balance").addEventListener("dblclick", () => {
  soundSettings.balance = 0; updateSoundSettings();
});
for (const [id, key] of [["sound-normalization", "normalization"], ["sound-volume-leveling", "volumeLeveling"]]) {
  document.querySelector(`#${id}`).addEventListener("input", event => {
    soundSettings[key] = Number(event.target.value); updateSoundSettings();
  });
  document.querySelector(`#${id}`).addEventListener("dblclick", () => {
    soundSettings[key] = 0; updateSoundSettings();
  });
}
document.querySelectorAll("[data-sound-help]").forEach(element => {
  element.title = element.dataset.soundHelp;
});
document.querySelectorAll("#sound-enabled, #sound-quick-enabled").forEach(input => input.addEventListener("change", event => {
  soundSettings.enabled = event.target.checked; soundCompare = false; ensureAudioProcessing(); updateSoundSettings();
}));
document.querySelector("#sound-compare").addEventListener("click", () => { soundCompare = !soundCompare; updateSoundSettings(); });
document.querySelector("#sound-preset").addEventListener("change", event => {
  const preset = event.target.value;
  const values = savedSoundPreset(preset);
  soundSettings = MedoSound.normalize({...values, enabled: soundSettings.enabled, preset});
  soundCompare = false; updateSoundSettings();
});
document.querySelector("#sound-save").addEventListener("click", () => {
  const id = soundSettings.preset;
  soundPresetRecords[id] = {name:soundPresetRecords[id]?.name || MedoSound.presets[id]?.name || "自定义", settings:MedoSound.normalize(soundSettings)};
  saveSoundPresetRecords();
  updateSoundSettings();
  document.querySelector("#sound-status").textContent = "预设已保存";
});
const soundRenameDialog = document.querySelector("#sound-rename-dialog");
let soundPresetNameMode = "rename";
function openSoundPresetNameDialog(mode) {
  soundPresetNameMode = mode;
  const currentName = soundPresetRecords[soundSettings.preset]?.name || MedoSound.presets[soundSettings.preset]?.name || "自定义";
  document.querySelector("#sound-rename-form h2").textContent = mode === "create" ? "另存为新预设" : "重命名预设";
  document.querySelector('#sound-rename-form button[type="submit"]').textContent = mode === "create" ? "保存新预设" : "保存名称";
  document.querySelector("#sound-preset-name").value = mode === "create" ? `${currentName.slice(0, 34)} 副本` : currentName;
  document.querySelector("#sound-name-error").textContent = "";
  soundRenameDialog.showModal();
  document.querySelector("#sound-preset-name").select();
}
document.querySelector("#sound-rename").addEventListener("click", () => openSoundPresetNameDialog("rename"));
document.querySelector("#sound-save-as").addEventListener("click", () => openSoundPresetNameDialog("create"));

const soundDeleteDialog = document.querySelector("#sound-delete-dialog");
let soundPresetToDelete = null;
document.querySelector("#sound-delete").addEventListener("click", () => {
  if (soundSettings.preset === "flat") return;
  soundPresetToDelete = soundSettings.preset;
  const name = soundPresetRecords[soundPresetToDelete]?.name || MedoSound.presets[soundPresetToDelete]?.name || "自定义";
  document.querySelector("#sound-delete-message").textContent = `删除“${name}”？删除后将切换到默认预设。`;
  soundDeleteDialog.showModal();
});
document.querySelector("#sound-delete-cancel").addEventListener("click", () => soundDeleteDialog.close());
document.querySelector("#sound-delete-confirm").addEventListener("click", () => {
  const id = soundPresetToDelete;
  if (!id || id === "flat") return;
  delete soundPresetRecords[id];
  deletedSoundPresets.add(id);
  if (id === "custom") localStorage.removeItem("medo.soundCustom");
  saveSoundPresetRecords();
  localStorage.setItem("medo.deletedSoundPresets", JSON.stringify([...deletedSoundPresets]));
  soundSettings = MedoSound.normalize({...savedSoundPreset("flat"),preset:"flat",enabled:soundSettings.enabled});
  soundCompare = false;
  updateSoundSettings(); soundDeleteDialog.close();
  document.querySelector("#sound-status").textContent = "预设已删除，已切换到默认预设";
  document.querySelector("#sound-preset").focus();
});
soundDeleteDialog.addEventListener("close", () => { soundPresetToDelete = null; });

const soundPresetMenu = document.querySelector("#sound-preset-menu");
document.querySelector("#sound-preset").addEventListener("contextmenu", event => {
  event.preventDefault();
  const id = event.target.closest("option")?.value || soundSettings.preset;
  if (id !== soundSettings.preset) {
    soundSettings = MedoSound.normalize({...savedSoundPreset(id),preset:id,enabled:soundSettings.enabled});
    soundCompare = false; updateSoundSettings();
  }
  soundPresetMenu.querySelector('[data-preset-action="delete"]').disabled = id === "flat";
  soundPresetMenu.showModal();
  const bounds = soundPresetMenu.getBoundingClientRect();
  soundPresetMenu.style.left = `${Math.max(8,Math.min(event.clientX,window.innerWidth-bounds.width-8))}px`;
  soundPresetMenu.style.top = `${Math.max(8,Math.min(event.clientY,window.innerHeight-bounds.height-8))}px`;
});
soundPresetMenu.addEventListener("click", event => {
  const action = event.target.closest("[data-preset-action]")?.dataset.presetAction;
  if (!action) {
    const rect = soundPresetMenu.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) soundPresetMenu.close();
    return;
  }
  soundPresetMenu.close();
  if (action === "rename") openSoundPresetNameDialog("rename");
  else if (action === "delete") document.querySelector("#sound-delete").click();
  else if (action === "copy") {
    const currentName = soundPresetRecords[soundSettings.preset]?.name || MedoSound.presets[soundSettings.preset]?.name || "自定义";
    const names = new Set([...document.querySelector("#sound-preset").options].map(option => (soundPresetRecords[option.value]?.name || MedoSound.presets[option.value]?.name || "自定义").toLocaleLowerCase()));
    const baseName = `${currentName.slice(0,30)} 副本`;
    let name = baseName, number = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${baseName} ${number++}`;
    const id = `user-${crypto.randomUUID()}`;
    soundSettings = MedoSound.normalize({...soundSettings,preset:id});
    soundPresetRecords[id] = {name,settings:MedoSound.normalize(soundSettings)};
    saveSoundPresetRecords(); updateSoundSettings();
    document.querySelector("#sound-status").textContent = `已复制为“${name}”`;
  }
});
soundPresetMenu.addEventListener("keydown", event => {
  if (!["ArrowDown","ArrowUp","Home","End"].includes(event.key)) return;
  event.preventDefault();
  const items = [...soundPresetMenu.querySelectorAll("button:not(:disabled)")];
  const index = items.indexOf(document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length-1 : (index+(event.key === "ArrowDown" ? 1 : -1)+items.length)%items.length;
  items[next].focus();
});
document.querySelector("#sound-rename-cancel").addEventListener("click", () => soundRenameDialog.close());
document.querySelector("#sound-rename-form").addEventListener("submit", event => {
  event.preventDefault();
  const name = document.querySelector("#sound-preset-name").value.trim();
  const id = soundPresetNameMode === "create" ? `user-${crypto.randomUUID()}` : soundSettings.preset;
  const duplicate = [...document.querySelector("#sound-preset").options].some(option => option.value !== id && (soundPresetRecords[option.value]?.name || MedoSound.presets[option.value]?.name || "自定义").toLocaleLowerCase() === name.toLocaleLowerCase());
  if (!name || duplicate) {
    document.querySelector("#sound-name-error").textContent = !name ? "请输入预设名称" : "此名称已存在";
    return;
  }
  soundPresetRecords[id] = {name, settings:MedoSound.normalize(soundPresetNameMode === "create" ? {...soundSettings, preset:id} : savedSoundPreset(id))};
  if (soundPresetNameMode === "create") soundSettings.preset = id;
  saveSoundPresetRecords(); updateSoundSettings(); soundRenameDialog.close();
  document.querySelector("#sound-status").textContent = soundPresetNameMode === "create" ? `已另存为“${name}”` : "预设已重命名";
});
document.querySelector("#sound-reset").addEventListener("click", () => {
  soundSettings = MedoSound.normalize({...MedoSound.presets.flat, enabled: soundSettings.enabled, preset:"flat"});
  soundCompare = false; updateSoundSettings();
});
document.querySelector("#open-sound-settings").addEventListener("click", () => document.querySelector("#sound-dialog").showModal());
document.querySelector("#close-sound-settings").addEventListener("click", () => document.querySelector("#sound-dialog").close());
document.querySelector("#sound-dialog").addEventListener("close", () => {
  soundCompare = false; updateSoundSettings(); document.querySelector("#open-sound-settings").focus();
});
document.querySelector("#sound-eq-reset").addEventListener("click", () => {
  soundSettings.eq = Array(10).fill(0); soundSettings.centers = [...MedoSound.frequencies]; updateSoundSettings();
});
updateSoundSettings();

function setBoundedCache(cache, key, value, limit = 160) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
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
  const byId = new Map();
  const preferred = new Map();
  for (const track of tracks) {
    if (track.transient) continue;
    byId.set(track.id, track);
    const identity = normalizedSongIdentity(track);
    if (!preferred.has(identity) || String(track.format).toUpperCase() === "FLAC" &&
        String(preferred.get(identity).format).toUpperCase() !== "FLAC") preferred.set(identity, track);
  }
  const seen = new Set();
  recent = recent.flatMap(id => {
    const track = byId.get(id);
    if (!track) return [];
    const identity = normalizedSongIdentity(track);
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [preferred.get(identity).id];
  }).slice(0, 100);
}

document.addEventListener("error", event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.src.startsWith("medo-media://local/cover?")) return;
  const affected = tracks.filter(track => track.cover === image.src);
  image.src = missingArt;
  for (const track of affected) {
    track.cover = null;
    track.metadataLoaded = false;
    loadMetadata(track).catch(() => {});
  }
}, true);

function scheduleMetadataRender() {
  clearTimeout(metadataRenderTimer);
  metadataRenderTimer = setTimeout(render, 240);
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
  updateThemeInkColors();
  applyInactiveLyricColor();
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

function updateThemeInkColors() {
  const root = document.documentElement;
  const light = root.dataset.theme === "light";
  const channels = (hex) => hex.slice(1).match(/../g).map(value => parseInt(value, 16));
  const luminance = (rgb) => rgb.reduce((sum, value, index) => {
    const channel = value / 255;
    return sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index];
  }, 0);
  const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  const desktopGlass = ["transparent", "blur", "acrylic"].includes(root.dataset.windowMaterial);
  // Bound contrast against a black desktop in light mode and a white desktop
  // in dark mode after the 82% reading tint; no desktop pixels are sampled.
  const readingBase = desktopGlass ? (light ? "#c8cbce" : "#3d4148") : (light ? "#edf1f7" : "#1b2230");
  const background = luminance(channels(readingBase));
  const colors = [themePrimaryColor, themeSecondaryColor].map(value => channels(/^#[0-9a-f]{6}$/i.test(value) ? value : "#2864ff"));
  colors.forEach((rgb, index) => {
    let ink = rgb;
    for (let mix = 0; mix <= 1 && contrast(luminance(ink), background) < 5.2; mix += .04) {
      ink = rgb.map(value => Math.round(value * (1 - mix) + (light ? 20 : 245) * mix));
    }
    root.style.setProperty(index ? "--accent-secondary-readable" : "--accent-readable", `rgb(${ink.join(" ")})`);
  });
  const contrastWith = value => Math.min(...colors.map(rgb => contrast(luminance(rgb), value)));
  root.style.setProperty("--on-accent", contrastWith(1) >= contrastWith(.012) ? "#ffffff" : "#1c2330");
}

function applyThemeColors(primary = themePrimaryColor, secondary = themeSecondaryColor, save = false) {
  const validColor = /^#[0-9a-f]{6}$/i;
  themePrimaryColor = validColor.test(primary) ? primary : "#2864ff";
  themeSecondaryColor = validColor.test(secondary) ? secondary : "#d934ff";
  updateThemeInkColors();
  const root = document.documentElement;
  root.style.setProperty("--accent", themePrimaryColor);
  root.style.setProperty("--accent-secondary", themeSecondaryColor);
  root.style.setProperty("--accent-soft", `color-mix(in srgb, ${themePrimaryColor} 15%, transparent)`);
  root.style.setProperty("--accent-gradient", `linear-gradient(105deg, ${themePrimaryColor} 0%, color-mix(in srgb, ${themePrimaryColor} 46%, ${themeSecondaryColor}) 50%, ${themeSecondaryColor} 100%)`);
  root.style.setProperty("--accent-gradient-hover", `linear-gradient(105deg, color-mix(in srgb, ${themePrimaryColor} 84%, white) 0%, color-mix(in srgb, ${themePrimaryColor} 46%, ${themeSecondaryColor}) 48%, color-mix(in srgb, ${themeSecondaryColor} 84%, white) 100%)`);
  document.querySelector("#theme-primary-color").value = themePrimaryColor;
  document.querySelector("#theme-secondary-color").value = themeSecondaryColor;
  if (save) {
    localStorage.setItem("medo.themePrimaryColor", themePrimaryColor);
    localStorage.setItem("medo.themeSecondaryColor", themeSecondaryColor);
  }
}

function applyCoverFit(nextFit) {
  coverFit = ["cover", "contain", "fill"].includes(nextFit) ? nextFit : "cover";
  document.documentElement.style.setProperty("--cover-fit", coverFit);
  document.querySelector("#cover-fit").value = coverFit;
  document.querySelector("#cover-fit-description").textContent = {
    cover: "保持原始比例铺满封面区域，超出部分会被裁切。",
    contain: "完整显示封面，保留原始比例。",
    fill: "将封面拉伸铺满显示区域。"
  }[coverFit];
  localStorage.setItem("medo.coverFit", coverFit);
}

function applyDisplayMode(nextMode) {
  displayMode = nextMode === "compact" ? "compact" : "thumbnail";
  const main = document.querySelector("main");
  main.classList.toggle("display-compact", displayMode === "compact");
  main.classList.toggle("display-thumbnail", displayMode === "thumbnail");
  document.querySelectorAll("[data-display-value]").forEach((button) => {
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
  const traySetting = document.querySelector("#tray-setting");
  if (traySetting) traySetting.hidden = closeBehavior !== "quit";
  if (closeBehavior !== "quit" && !trayEnabled) applyTrayEnabled(true);
}

function reloadCurrentLyrics({ networkProvider = null } = {}) {
  const track = tracks[currentIndex];
  if (!track) return Promise.resolve();
  cancelPendingLyrics();
  const request = ensureLyrics(track, true, networkProvider);
  if (currentView === "player") renderLyrics(track);
  return request;
}

function applyGlobalShortcutSettings(type, enabled) {
  pendingShortcutFeedback = type || null;
  if (type === "playPause") {
    globalPlayPauseShortcutEnabled = Boolean(enabled);
    localStorage.setItem("medo.globalPlayPauseShortcutEnabled", String(globalPlayPauseShortcutEnabled));
  } else if (type === "desktopLyrics") {
    globalDesktopLyricsShortcutEnabled = Boolean(enabled);
    localStorage.setItem("medo.globalDesktopLyricsShortcutEnabled", String(globalDesktopLyricsShortcutEnabled));
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
  document.querySelectorAll(".global-desktop-lyrics-shortcut-option").forEach((button) => {
    const active = (button.dataset.enabled === "true") === globalDesktopLyricsShortcutEnabled;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  window.medo.setGlobalShortcuts({
    ...(!lastShortcutStates.size ? { bindings: globalShortcutBindings } : {}),
    desktopLyrics: globalDesktopLyricsShortcutEnabled,
    playPause: globalPlayPauseShortcutEnabled,
    lyricsRefresh: globalLyricsRefreshShortcutEnabled,
    previous: globalPreviousShortcutEnabled,
    next: globalNextShortcutEnabled
  });
}

function syncGlobalShortcutStatus(states) {
  const selectors = {
    playPause: ".global-play-shortcut-setting",
    desktopLyrics: ".global-desktop-lyrics-shortcut-setting",
    lyricsRefresh: ".global-lyrics-shortcut-setting",
    previous: ".global-previous-shortcut-setting",
    next: ".global-next-shortcut-setting"
  };
  const problems = [];
  const recovered = [];
  let feedback = null;
  const messageFor = (state) => !state.enabled ? `已关闭 ${state.preferredAccelerator} 快捷键` :
    !state.registered ? `${state.preferredAccelerator} 无法启用，可能被其他程序占用；可更改组合键，释放占用后也会自动恢复` :
    `${state.accelerator} 快捷键已启用`;
  for (const state of states) {
    const row = document.querySelector(selectors[state.type]);
    if (!row) continue;
    const previous = lastShortcutStates.get(state.type);
    const changed = !previous || previous.enabled !== state.enabled || previous.accelerator !== state.accelerator ||
      previous.registered !== state.registered || previous.preferredAccelerator !== state.preferredAccelerator;
    lastShortcutStates.set(state.type, { ...state });
    const description = row.querySelector("p");
    description.id = `shortcut-status-${state.type}`;
    description.setAttribute("role", "status");
    description.setAttribute("aria-atomic", "true");
    description.classList.add("shortcut-binding");
    row.dataset.shortcutState = !state.enabled ? "disabled" : !state.registered ? "unavailable" : "registered";
    const hasProblem = state.enabled && !state.registered;
    if (changed) {
      description.replaceChildren();
      if (hasProblem) {
        const tag = document.createElement("span");
        tag.className = "shortcut-status-tag";
        tag.textContent = "快捷键未生效";
        description.append(tag);
      }
      const label = document.createElement("span");
      label.textContent = !state.enabled ? "已关闭" : "快捷键";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "shortcut-edit";
      edit.setAttribute("aria-label", `更改${state.label}快捷键`);
      edit.title = "点击自定义组合键";
      const key = document.createElement("kbd");
      key.textContent = state.preferredAccelerator;
      edit.append(key);
      edit.addEventListener("click", () => window.MedoShortcutEditor.open(row, lastShortcutStates.get(state.type), result => {
        syncGlobalShortcutStatus(result.states);
        row.querySelector(".shortcut-edit").focus({ preventScroll: true });
        showActionFeedback(`${state.label}快捷键已保存：${result.accelerator}`);
      }));
      description.append(label, edit);

      let notice = row.querySelector(".shortcut-conflict");
      if (hasProblem && !notice) {
        notice = document.createElement("div");
        notice.className = "shortcut-conflict";
        notice.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 6v4.5m0 3h.01"/></svg><div><strong></strong><span></span></div><button type="button" class="secondary-button shortcut-retry">立即重试</button>';
        const retry = notice.querySelector("button");
        retry.setAttribute("aria-label", `重试 ${state.preferredAccelerator} 快捷键`);
        retry.addEventListener("click", () => applyGlobalShortcutSettings(state.type, true));
        row.append(notice);
      }
      if (notice) {
        if (hasProblem) {
          notice.id = `shortcut-conflict-${state.type}`;
          notice.querySelector("div").id = `${notice.id}-description`;
          notice.querySelector("strong").textContent = `${state.preferredAccelerator} 无法启用`;
          notice.querySelector("span").textContent = "可能被其他程序占用，可点击上方按键更改组合；释放占用后会自动恢复。";
          notice.title = "系统未返回占用程序名称。";
          notice.querySelector("button").setAttribute("aria-describedby", `${description.id} ${notice.id}-description`);
        } else if (notice.contains(document.activeElement)) {
          row.querySelector('[data-enabled="true"]').focus({ preventScroll: true });
        }
        notice.hidden = !hasProblem;
      }
    }
    row.querySelectorAll('[role="radio"]').forEach(button => button.setAttribute("aria-describedby",
      hasProblem ? `${description.id} shortcut-conflict-${state.type}-description` : description.id));
    if (state.type === pendingShortcutFeedback) {
      feedback = messageFor(state);
    } else if (changed && hasProblem) {
      problems.push(state);
    } else if (previous?.enabled && !previous.registered && state.enabled && state.registered && previous.preferredAccelerator === state.preferredAccelerator) {
      recovered.push(state.accelerator);
    }
  }
  pendingShortcutFeedback = null;
  globalShortcutBindings = Object.fromEntries([...lastShortcutStates.values()].map(state => [state.type, state.preferredAccelerator]));
  localStorage.setItem("medo.globalShortcutBindings", JSON.stringify(globalShortcutBindings));
  if (feedback) showActionFeedback(feedback);
  else if (problems.length) {
    showActionFeedback(problems.length === 1 ? messageFor(problems[0]) : `${problems.length} 项快捷键未能使用默认按键，请查看当前可用按键`, () => {
      if (currentView !== "settings") document.querySelector("#settings-button").click();
      requestAnimationFrame(() => {
        const row = document.querySelector(selectors[problems[0].type]);
        row.scrollIntoView({ block: "center" });
        (row.querySelector(".shortcut-conflict:not([hidden]) .shortcut-retry") || row.querySelector('[data-enabled="true"]')).focus({ preventScroll: true });
      });
    }, "查看设置");
  } else if (recovered.length) showActionFeedback(`快捷键已恢复：${recovered.join("、")}`);
}

window.medo.onGlobalShortcutStatus(syncGlobalShortcutStatus);

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
  const input = document.querySelector("#desktop-lyric-size");
  input.value = desktopLyricSize;
  updateRangeGradient(input, (desktopLyricSize - Number(input.min)) / (Number(input.max) - Number(input.min)));
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
  sendLyricsWindowState({
    colorsOnly: true,
    primary: desktopLyricPrimaryColor,
    secondary: desktopLyricSecondaryColor
  });
}

function applyInactiveLyricColor(value = inactiveLyricColor, save = false) {
  inactiveLyricColor = /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : null;
  const root = document.documentElement;
  root.toggleAttribute("data-custom-lyric-color", Boolean(inactiveLyricColor));
  if (inactiveLyricColor) {
    const channels = inactiveLyricColor.slice(1).match(/../g).map(value => parseInt(value, 16));
    root.style.setProperty("--inactive-lyric-custom-rgb", channels.join(", "));
  } else root.style.removeProperty("--inactive-lyric-custom-rgb");
  document.querySelector("#inactive-lyric-color").value = inactiveLyricColor || getComputedStyle(root).getPropertyValue("--inactive-lyric-default").trim();
  document.querySelector("#reset-inactive-lyric-color").disabled = !inactiveLyricColor;
  if (save) {
    if (inactiveLyricColor) localStorage.setItem("medo.inactiveLyricColor", inactiveLyricColor);
    else localStorage.removeItem("medo.inactiveLyricColor");
  }
}

function applyDetailLyricSize(value) {
  detailLyricSize = Math.min(38, Math.max(18, Number(value) || 26));
  localStorage.setItem("medo.detailLyricSize", String(detailLyricSize));
  document.documentElement.style.setProperty("--detail-lyric-size", `${detailLyricSize}px`);
  const input = document.querySelector("#detail-lyric-size");
  input.value = detailLyricSize;
  updateRangeGradient(input, (detailLyricSize - Number(input.min)) / (Number(input.max) - Number(input.min)));
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
  if (!wordLyricsEnabled || userInitiated) clearLyricRetry();
  localStorage.setItem("medo.wordLyricsEnabled", String(wordLyricsEnabled));
  if (userInitiated) localStorage.setItem("medo.wordLyricsPreferenceSet", "true");
  document.querySelectorAll(".word-lyrics-option").forEach((button) => {
    const active = (button.dataset.wordLyricsValue === "on") === wordLyricsEnabled;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  const track = tracks[currentIndex];
  if (userInitiated && track) ensureLyrics(track);
  if (track && currentView === "player") renderLyrics(track);
  activeLyricIndex = -1;
  updateLyricsAtTime();
}

function parseLyrics(text, duration = 0) {
  let offset = 0;
  const lines = [];
  // Offline TTML carries syllable timing, background vocals and per-line
  // translations in one document; when it is present every other branch is
  // skipped because the parser already produced the final line list.
  const ttml = typeof window !== "undefined" && window.MedoTtml
    ? window.MedoTtml.parseTtml(text)
    : null;
  if (ttml) {
    lines.push(...ttml.lines.filter(line => line.text));
    return finishLyricLines(lines, duration, ttml);
  }
  for (const rawLine of String(text || "").replace(/^\uFEFF/, "").split(/\r\n?|\n/)) {
    const information = parseLyricInformationLine(rawLine);
    if (information) {
      if (information.text) lines.push({ start: information.start + offset / 1000,
        text: information.text, information: true });
      continue;
    }
    const metadata = parseLyricMetadataLine(rawLine);
    if (metadata) {
      if (metadata.offset !== undefined && /^[+-]?\d+$/.test(metadata.offset.trim())) {
        offset = Number(metadata.offset) || 0;
      }
      continue;
    }
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
  return finishLyricLines(lines, duration);
}

// Shared tail of both parsers: estimate missing timelines, sort, fill word
// ends, then classify the file as plain/line/mixed/word.
function finishLyricLines(lines, duration = 0, metadata = null) {
  lines = lines.map(convertLyricLine);
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
  const level = window.MedoLyricSync
    ? window.MedoLyricSync.lyricSyncLevel(timedLines, hasTimeline)
    : (timedLines.some((line) => line.words?.length) ? "word" : hasTimeline ? "line" : "plain");
  const result = { synced: hasTimeline, level, lines: timedLines };
  if (metadata?.writers?.length) result.writers = metadata.writers;
  return result;
}

// Simplifies traditional Chinese and keeps per-line translation/background
// data in the shape the renderer and desktop lyric window consume.
function convertLyricLine(line) {
  const convert = (value) => typeof value === "string" && window.MedoZhConvert?.isTraditional(value)
    ? window.MedoZhConvert.toSimplified(value)
    : value;
  const converted = { ...line, text: convert(line.text) };
  if (Array.isArray(line.words)) {
    converted.words = line.words.map(word => ({ ...word, text: convert(word.text) }));
  }
  if (line.translations && typeof line.translations === "object") {
    converted.translations = Object.fromEntries(
      Object.entries(line.translations).map(([language, value]) => [language, convert(value)])
    );
  }
  if (line.subline) {
    converted.subline = {
      ...line.subline,
      text: convert(line.subline.text),
      ...(Array.isArray(line.subline.words)
        ? { words: line.subline.words.map(word => ({ ...word, text: convert(word.text) })) }
        : {})
    };
  }
  return converted;
}

function lyricMetadataKey(track) {
  // Track identity for lyric caching. The track id already scopes the entry to a file, so the signature only needs the tags that change what a provider returns; including the path would invalidate entries whenever a caller synthesises a track without one.
  return JSON.stringify([track.title || "", track.artist || "", track.album || "", Math.round(track.duration || 0)]);
}

// Cache entries written by ensureLyrics carry the metadata signature plus a
// retry deadline. Seeds that only pass line data are completed here so a valid
// entry is never discarded just for missing bookkeeping fields.
function cacheLyricEntry(trackId, entry, track = tracks.find(item => item.id === trackId) || null) {
  if (!entry) return entry;
  if (track && !entry.metadataKey) entry.metadataKey = lyricMetadataKey(track);
  if (!Number.isFinite(entry.retryAt)) {
    entry.retryAt = Date.now() + (entry.error ? 15000 : entry.text || entry.lines?.length ? 30 * 86400000 : 120000);
  }
  return entry;
}

function clearLyricRetry() {
  clearTimeout(lyricRetryState?.timer);
  lyricRetryState = null;
}

function scheduleLyricRetry(track, mode = null) {
  const entry = lyricsCache.get(track.id);
  if (!wordLyricsEnabled || tracks[currentIndex]?.id !== track.id ||
      !entry?.wordTimingRequested || MedoLyricSync.hasWordLevelLines(entry.lines)) {
    if (lyricRetryState?.trackId === track.id) clearLyricRetry();
    return;
  }
  if (lyricsRequests.has(track.id) || !Number.isFinite(entry.retryAt)) return;
  const metadataKey = lyricMetadataKey(track);
  if (!lyricRetryState || lyricRetryState.trackId !== track.id || lyricRetryState.metadataKey !== metadataKey) {
    clearLyricRetry();
    lyricRetryState = { trackId: track.id, metadataKey, attempts: 0, timer: null, mode: mode || "auto" };
  }
  const state = lyricRetryState;
  clearTimeout(state.timer);
  state.timer = null;
  if (state.attempts >= 3) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    if (lyricRetryState !== state) return;
    if (!wordLyricsEnabled || tracks[currentIndex]?.id !== track.id || lyricMetadataKey(track) !== state.metadataKey) {
      clearLyricRetry();
      return;
    }
    if (lyricsRequests.has(track.id)) return;
    if (lyricsCache.get(track.id)?.retryAt > Date.now()) {
      scheduleLyricRetry(track);
      return;
    }
    state.attempts++;
    ensureLyrics(track, false, state.mode === "auto" ? null : state.mode);
  }, Math.min(2147483647, Math.max(1, entry.retryAt - Date.now())));
}

function cancelPendingLyrics(exceptTrackId = null) {
  if (!exceptTrackId || lyricRetryState?.trackId !== exceptTrackId) clearLyricRetry();
  let cancelled = false;
  for (const id of lyricsRequests.keys()) {
    if (id === exceptTrackId) continue;
    lyricsRequests.delete(id);
    cancelled = true;
  }
  if (cancelled) window.medo.cancelLyrics();
}

async function ensureLyrics(track, force = false, modeOverride = null) {
  if (!track) return;
  if (force) clearLyricRetry();
  cancelPendingLyrics(track.id);
  const requestMode = modeOverride || "auto";
  const requireWordTiming = wordLyricsEnabled || requestMode === "network";
  const cachedLyrics = cacheLyricEntry(track.id, lyricsCache.get(track.id), track);
  const metadataKey = lyricMetadataKey(track);
  // Entries loaded by ensureLyrics always carry a metadataKey; seeds that only
  // supplied line data get one from cacheLyricEntry, so a missing key means
  // "older seed" rather than "different track". Only a real mismatch
  // invalidates the cache.
  const storedKey = cachedLyrics?.metadataKey;
  const metadataChanged = Boolean(cachedLyrics) && typeof storedKey === "string" && storedKey !== metadataKey;
  const previousLyrics = !metadataChanged && cachedLyrics?.lines?.length ? cachedLyrics : null;
  const compatibleCache = Boolean(cachedLyrics) && !metadataChanged && cachedLyrics.retryAt > Date.now() &&
    (!requireWordTiming || MedoLyricSync.hasWordLevelLines(cachedLyrics.lines) || cachedLyrics.wordTimingRequested === true);
  const existingRequest = lyricsRequests.get(track.id);
  const compatibleRequest = existingRequest && existingRequest.metadataKey === metadataKey &&
    (!requireWordTiming || existingRequest.wordTimingRequested === true);
  if (!force && (compatibleCache || compatibleRequest)) {
    scheduleLyricRetry(track);
    return existingRequest;
  }
  if (cachedLyrics && !compatibleCache && !previousLyrics) lyricsCache.delete(track.id);
  if (existingRequest) cancelPendingLyrics();
  if (metadataChanged) {
    clearLyricRetry();
    lyricTranslations.delete(track.id);
    lyricTranslationRequests.delete(track.id);
  }
  const retainPreviousLyrics = result => {
    previousLyrics.wordTimingRequested = requireWordTiming;
    previousLyrics.refreshError = result?.error || (!result?.text ? "not-found" : null);
    previousLyrics.retryAt = result?.retryAt || Date.now() + (result?.error ? 15000 : 60000);
    setBoundedCache(lyricsCache, track.id, previousLyrics);
    if (force && tracks[currentIndex]?.id === track.id) {
      showActionFeedback(result?.error ? "歌词重新查找失败，已保留原歌词" :
        requireWordTiming && MedoLyricSync.hasWordLevelLines(previousLyrics.lines)
          ? "未找到新的逐字歌词，已保留原歌词" : "未找到可用歌词，已保留原歌词");
    }
  };
  let request;
  request = (async () => {
    if (requestMode !== "local" && (!track.metadataLoaded || !track.duration)) {
      await loadMetadata(track);
    }
    if (request && lyricsRequests.get(track.id) !== request) return { cancelled: true };
    if (request) request.metadataKey = lyricMetadataKey(track);
    const playingDuration = tracks[currentIndex]?.id === track.id && Number.isFinite(audio.duration) ? audio.duration : 0;
    return window.medo.readLyrics({
      filePath: track.path,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration || playingDuration,
      mode: requestMode,
      force,
      ignoreLocal: requestMode !== "local" && (force || Boolean(modeOverride)),
      requireWordTiming
    });
  })()
    .then((result) => {
      if (lyricsRequests.get(track.id) !== request || result?.cancelled) return;
      const parsed = parseLyrics(result?.text, track.duration);
      const previousIsWord = previousLyrics && MedoLyricSync.hasWordLevelLines(previousLyrics.lines);
      if (previousLyrics && (!parsed.lines.length ||
          ((requireWordTiming || !force && !modeOverride) && previousIsWord && !MedoLyricSync.hasWordLevelLines(parsed.lines)))) {
        retainPreviousLyrics(result);
        return;
      }
      // Provider-supplied translations (QQ `trans`) are line-aligned and win
      // over machine translation for the lines they cover.
      if (Array.isArray(result?.translation) && result.translation.length === parsed.lines.length) {
        parsed.lines.forEach((line, index) => {
          const value = window.MedoZhConvert.toSimplified(String(result.translation[index] || "").trim());
          if (value && value !== line.text) {
            line.translations = { ...(line.translations || {}), "zh-hans": value };
          }
        });
      }
      lyricTranslations.delete(track.id);
      lyricTranslationRequests.delete(track.id);
      setBoundedCache(lyricsCache, track.id, {
        ...parsed,
        source: result?.source || null,
        confidence: result?.confidence || null,
        match: result?.match || null,
        wordTimingRequested: requireWordTiming,
        error: result?.error || null,
        metadataKey: lyricMetadataKey(track),
        retryAt: result?.retryAt || Date.now() + (result?.error ? 15000 : result?.text ? 30 * 86400000 : 120000)
      });
      if (lyricTranslationEnabled) ensureLyricTranslation(track);
    })
    .catch(() => {
      if (lyricsRequests.get(track.id) !== request) return;
      if (previousLyrics) retainPreviousLyrics({ error: "network" });
      else setBoundedCache(lyricsCache, track.id, {
        synced: false, lines: [], wordTimingRequested: requireWordTiming, error: "network",
        metadataKey: lyricMetadataKey(track), retryAt: Date.now() + 15000
      });
    })
    .finally(() => {
      if (lyricsRequests.get(track.id) !== request) return;
      lyricsRequests.delete(track.id);
      if (tracks[currentIndex]?.id !== track.id) return;
      const loadedLyrics = lyricsCache.get(track.id);
      scheduleLyricRetry(track, requestMode);
      sendLyricsWindowState({
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
  request.wordTimingRequested = requireWordTiming;
  request.metadataKey = lyricMetadataKey(track);
  lyricsRequests.set(track.id, request);
  return request;
}

function lyricsNeedChineseTranslation(lines = []) {
  // Existing inline translations cover only their own rows.
  const uncovered = lines.filter(line => !line.information && !pickChineseTranslation(line));
  const text = uncovered.map((line) => line.text).join("").replace(/[♪\s\d\p{P}\p{S}]/gu, "");
  if (!text) return false;
  const han = (text.match(/\p{Script=Han}/gu) || []).length;
  const hasJapanese = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
  const hasKorean = /\p{Script=Hangul}/u.test(text);
  if (hasJapanese || hasKorean) return true;
  return han / [...text].length < .45;
}

// Languages are normalized to lowercase in the parser, so `zh-hans`,
// `zh-cn` and `zh` all count as Chinese; Simplified wins over Traditional
// because the app's UI and the 简繁 conversion both target Simplified.
function translationLanguageScore(language) {
  const value = String(language || "").toLowerCase();
  if (value === "zh-hans" || value === "zh-cn" || value === "zh-sg") return 3;
  if (value === "zh") return 2;
  if (value === "zh-hant" || value === "zh-tw" || value === "zh-hk") return 1;
  return 0;
}

function pickChineseTranslation(line) {
  const translations = line?.translations;
  if (!translations || typeof translations !== "object") return null;
  let best = null;
  let bestScore = 0;
  for (const [language, value] of Object.entries(translations)) {
    const score = translationLanguageScore(language);
    if (!score || !value) continue;
    if (score > bestScore) {
      best = value;
      bestScore = score;
    }
  }
  return best;
}

function lyricTranslationIndices(lines = []) {
  return lines.map((line, index) => pickChineseTranslation(line) ? index : -1).filter(index => index >= 0);
}

async function ensureLyricTranslation(track) {
  const lyrics = lyricsCache.get(track?.id);
  if (!lyricTranslationEnabled || !track || !lyrics?.lines?.length ||
      lyricTranslationRequests.has(track.id)) return;
  const indices = lyrics.lines.map((line, index) => !lyricTranslationFor(track.id, lyrics, index) &&
    lyricsNeedChineseTranslation([line]) ? index : -1).filter(index => index >= 0);
  if (!indices.length) return;
  const texts = indices.map(index => lyrics.lines[index].text);
  const starts = indices.map(index => lyrics.lines[index].start);
  let request;
  request = window.medo.translateLyrics({
    cacheKey: JSON.stringify([track.title, track.artist, track.album, starts, texts]),
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration || audio.duration,
    starts,
    lines: texts
  }).then((translated) => {
    if (lyricTranslationRequests.get(track.id) !== request || lyricsCache.get(track.id) !== lyrics) return;
    if (!Array.isArray(translated) || translated.length !== indices.length || !translated.some(Boolean)) return;
    const previous = lyricTranslations.get(track.id);
    const map = previous instanceof Map ? new Map(previous) : new Map();
    const values = [...(map.get('zh') || (Array.isArray(previous) ? previous : []))];
    indices.forEach((index, position) => {
      values[index] = window.MedoZhConvert.toSimplified(translated[position] || '');
    });
    map.set('zh', values);
    setBoundedCache(lyricTranslations, track.id, map);
    if (tracks[currentIndex]?.id !== track.id) return;
    activeLyricIndex = -1;
    if (currentView === "player") renderLyrics(track);
    else updateLyricsAtTime();
  }).finally(() => {
    if (lyricTranslationRequests.get(track.id) === request) lyricTranslationRequests.delete(track.id);
  });
  lyricTranslationRequests.set(track.id, request);
  return request;
}

// Resolve one line's translation from the per-track language map, preferring
// the line's own provider translation when it exists. Older callers and tests
// stored a plain array for the default language; both shapes are accepted.
function lyricTranslationFor(trackId, lyrics, index) {
  const inline = pickChineseTranslation(lyrics?.lines?.[index]);
  if (inline) return inline;
  const map = lyricTranslations.get(trackId);
  if (!map) return null;
  if (Array.isArray(map)) return map[index] || null;
  if (typeof map.get !== "function") return null;
  const best = [...map.keys()].filter(key => translationLanguageScore(key) > 0).sort((left, right) =>
    translationLanguageScore(right) - translationLanguageScore(left));
  for (const language of best) {
    const lines = map.get(language);
    if (Array.isArray(lines) && lines[index]) return lines[index];
  }
  return null;
}

function renderLyricStatus(lyrics) {
  const status = document.querySelector("#lyric-status");
  const hasLines = Boolean(lyrics?.lines?.length);
  const level = hasLines ? lyrics.level || MedoLyricSync.lyricSyncLevel(lyrics.lines, lyrics.synced) : null;
  const failure = lyrics?.refreshError || lyrics?.error;
  let message = "";
  if (failure) {
    message = hasLines
      ? failure === "not-found" ? "未找到新歌词，已保留原歌词" : "歌词重新查找失败，已保留原歌词"
      : failure === "timeout" ? "歌词搜索超时，请重新查找" : "歌词加载失败，请重新查找";
  } else if (wordLyricsEnabled && (level === "plain" || level === "line")) {
    message = "暂未找到逐字歌词";
  } else if (wordLyricsEnabled && level === "mixed") {
    const ordinary = lyrics.lines.filter(line => !line.information && !MedoLyricSync.hasNativeLineTiming(line)).length;
    message = `部分逐字，其余 ${ordinary} 行逐行`;
  }
  // Source information accompanies an exceptional state, never a normal song.
  status.hidden = !message;
  if (status.hidden) {
    status.querySelector(".lyric-status-message").textContent = "";
    status.querySelector(".lyric-status-source").textContent = "";
    status.removeAttribute("title");
    return;
  }
  const source = lyrics.source || "";
  const sourceName = source === "embedded" ? "内嵌歌词" : source === "sidecar" ? "本地 LRC"
    : source === "qq" || source.startsWith("qq-") ? "QQ 音乐"
    : source === "netease" || source.startsWith("netease-") ? "网易云音乐"
    : source === "lrclib" ? "LRCLIB" : "未知来源";
  const kind = { plain: "纯文本歌词", line: "逐行歌词", mixed: "混合歌词", word: "逐字歌词" }[level];
  status.querySelector(".lyric-status-message").textContent = message;
  status.querySelector(".lyric-status-source").textContent = hasLines ? `${sourceName} · ${kind}` : "";
  status.title = lyrics.match?.title
    ? `匹配曲目：${[lyrics.match.title, lyrics.match.artist].filter(Boolean).join(" · ")}` : "";
}

function renderLyrics(track) {
  const container = document.querySelector("#lyrics-lines");
  const lyrics = lyricsCache.get(track.id);
  renderLyricStatus(lyrics);
  const state = [track.id, lyrics, lyricTranslations.get(track.id), lyricTranslationEnabled,
    hiddenLyricTranslations.has(track.id), wordLyricsEnabled];
  if (renderedLyricsState?.every((value, index) => value === state[index])) {
    updateLyricsAtTime();
    return;
  }
  const preserveInspection = renderedLyricsState?.[0] === track.id && lyricInspectionActive && lyrics?.synced;
  const selectedStart = selectedLyricElement?.dataset.start;
  const oldLines = [...container.querySelectorAll(".lyric-line[data-start]")];
  const oldOffset = freezeLyricFollow();
  const anchor = preserveInspection && oldLines.reduce((nearest, line) =>
    !nearest || Math.abs(line.offsetTop + line.offsetHeight / 2 + oldOffset) <
      Math.abs(nearest.offsetTop + nearest.offsetHeight / 2 + oldOffset) ? line : nearest, null);
  const anchorPosition = anchor ? anchor.offsetTop + anchor.offsetHeight / 2 + oldOffset : 0;
  renderedLyricsState = state;
  renderedLyricElements = [];
  if (!preserveInspection) {
    clearTimeout(lyricInspectionRestoreTimer);
    lyricInspectionActive = false;
    lyricInspectionOffset = 0;
    lyricDragPointerId = null;
    lyricsStage.classList.remove("inspecting");
  }
  selectedLyricElement?.classList.remove("selected");
  selectedLyricElement = null;
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
    container.innerHTML = '<div class="lyrics-empty"><strong>未找到歌词</strong><span>可将同名 .lrc 文件放在歌曲旁边</span></div>';
    if (lyrics.error) {
      container.querySelector("strong").textContent = "歌词加载失败";
      container.querySelector("span").textContent = lyrics.error === "timeout"
        ? "搜索超时，请检查网络后重新查找。"
        : "网络或歌词服务暂时不可用，请稍后重试。";
    }
    const retry = document.createElement("button");
    retry.className = "secondary-button lyric-retry";
    retry.textContent = "重新查找";
    retry.onclick = () => { ensureLyrics(track, true); renderLyrics(track); };
    container.querySelector(".lyrics-empty").append(retry);
    sendLyricsWindowState({
      title: track.title,
      artist: track.artist,
      album: track.album,
      noLyrics: true,
      playing: !audio.paused
    });
    return;
  }
  // Provider translations (offline TTML, QQ trans, Netease tlyric) can be shown
  // as soon as lyrics load; machine translation arrives later via the map.
  const inlineTranslations = lyricTranslationIndices(lyrics.lines).length > 0;
  const translationAvailable = inlineTranslations || lyricsNeedChineseTranslation(lyrics.lines);
  const translations = lyricTranslations.get(track.id);
  const loadedTranslation = lyricTranslations.get(track.id);
  const translationsReady = loadedTranslation instanceof Map || Array.isArray(loadedTranslation);
  const translationsAvailableNow = translationAvailable || translationsReady;
  const showTranslations = lyricTranslationEnabled && translationsAvailableNow &&
    !hiddenLyricTranslations.has(track.id) && (inlineTranslations || translationsReady);
  translationButton.hidden = !lyricTranslationEnabled || !translationsAvailableNow;
  const translationTitle = showTranslations ? "隐藏中文翻译" : "显示中文翻译";
  translationButton.title = translationTitle;
  translationButton.setAttribute("aria-label", translationTitle);
  translationButton.classList.toggle("active", showTranslations);
  if (lyricTranslationEnabled && translationAvailable) ensureLyricTranslation(track);
  container.classList.toggle("unsynced", !lyrics.synced);
  container.innerHTML = "";
  lyrics.lines.forEach((line, lineIndex) => {
    const item = document.createElement(lyrics.synced ? "button" : "p");
    item.className = "lyric-line";
    if (line.start !== null) item.dataset.start = String(line.start);
    if (wordLyricsEnabled && MedoLyricSync.hasNativeLineTiming(line)) {
      const karaoke = document.createElement("span");
      karaoke.className = "lyric-karaoke";
      karaoke.innerHTML = '<span class="lyric-karaoke-base"></span><span class="lyric-karaoke-fill"></span>';
      karaoke.querySelector(".lyric-karaoke-base").textContent = line.text;
      karaoke.querySelector(".lyric-karaoke-fill").textContent = line.text;
      item.append(karaoke);
    } else {
      item.textContent = line.text;
    }
    if (showTranslations) {
      const translationText = lyricTranslationFor(track.id, lyrics, lineIndex);
      if (translationText) {
        const translation = document.createElement("span");
        if (wordLyricsEnabled && MedoLyricSync.hasNativeLineTiming(line)) {
          translation.className = "lyric-translation lyric-karaoke lyric-translation-karaoke";
          translation.innerHTML = '<span class="lyric-karaoke-base"></span><span class="lyric-karaoke-fill"></span>';
          translation.querySelector(".lyric-karaoke-base").textContent = translationText;
          translation.querySelector(".lyric-karaoke-fill").textContent = translationText;
        } else {
          translation.className = "lyric-translation";
          translation.textContent = translationText;
        }
        item.append(translation);
      }
    }
    if (line.subline?.text) {
      const background = document.createElement("span");
      background.className = "lyric-subline";
      background.textContent = line.subline.text;
      item.append(background);
    }
    container.append(item);
    renderedLyricElements.push(item);
  });
  if (preserveInspection) {
    const lines = [...container.querySelectorAll(".lyric-line[data-start]")];
    const nextAnchor = lines.find((line) => line.dataset.start === anchor?.dataset.start);
    lyricInspectionOffset = clampLyricInspectionOffset(nextAnchor
      ? anchorPosition - nextAnchor.offsetTop - nextAnchor.offsetHeight / 2 : oldOffset);
    container.style.transform = `translateY(${lyricInspectionOffset}px)`;
    selectedLyricElement = lines.find((line) => line.dataset.start === selectedStart) || null;
    selectedLyricElement?.classList.add("selected");
  }
  updateLyricsAtTime();
}

function updateWordHighlight(line, element) {
  if (!line?.words?.length || !element) return;
  const karaoke = element.querySelector(".lyric-karaoke");
  if (!karaoke) return;
  let metrics = lyricWordMetrics.get(line.words);
  if (!metrics) {
    const lengths = line.words.map(word => [...word.text].length);
    metrics = { lengths, total: Math.max(1, lengths.reduce((sum, value) => sum + value, 0)) };
    lyricWordMetrics.set(line.words, metrics);
  }
  let completedCharacters = 0;
  for (let index = 0; index < line.words.length; index += 1) {
    const word = line.words[index];
    const start = Number(word.start) || 0;
    const nextStart = Number(line.words[index + 1]?.start);
    const end = Number(word.end) > start ? Number(word.end) : Number.isFinite(nextStart) ? nextStart : start + .48;
    const progress = Math.max(0, Math.min(1, (audio.currentTime + .04 - start) / Math.max(.08, end - start)));
    const length = metrics.lengths[index];
    if (progress >= 1) completedCharacters += length;
    else {
      completedCharacters += length * progress;
      break;
    }
  }
  const value = `${Math.max(0, Math.min(100, completedCharacters / metrics.total * 100))}%`;
  if (element.style.getPropertyValue("--line-progress") !== value) element.style.setProperty("--line-progress", value);
}

function sendLyricsWindowState(payload) {
  lastDesktopLyricsState = null;
  window.medo.updateLyricsWindow(payload);
}

function updateDesktopLyrics(track, lyrics, index) {
  const line = lyrics.lines[index];
  const translation = lyricTranslationEnabled && !hiddenLyricTranslations.has(track.id)
    ? lyricTranslationFor(track.id, lyrics, index) : null;
  const state = [track.id, lyrics, index, wordLyricsEnabled, translation, desktopLyricPrimaryColor,
    desktopLyricSecondaryColor, track.title, track.artist, track.album, !audio.paused];
  if (lastDesktopLyricsState?.every((value, offset) => value === state[offset])) {
    window.medo.updateLyricsWindow({ positionOnly: true, position: audio.currentTime, playing: !audio.paused });
    return;
  }
  lastDesktopLyricsState = state;
  window.medo.updateLyricsWindow({
    current: line?.text,
    words: wordLyricsEnabled && MedoLyricSync.hasNativeLineTiming(line) ? line.words.map((word) => ({ start: word.start, end: word.end, text: word.text })) : [],
    position: audio.currentTime,
    currentTranslation: translation,
    subline: line?.subline?.text || null,
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
  const liveTransform = getComputedStyle(container).transform;
  lyricFollowAnimation?.cancel();
  if (lyricPresentationSuspended || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    container.style.transform = target;
    lyricPresentationSuspended = false;
    return;
  }
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
  let low = 0, high = lyrics.lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lyrics.lines[middle].start <= audio.currentTime + .08) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  updateDesktopLyrics(track, lyrics, index);
  if (backgroundMode || currentView !== "player") { lyricPresentationSuspended = true; return; }
  const container = document.querySelector("#lyrics-lines");
  if (renderedLyricElements[0]?.parentElement !== container) renderedLyricElements = [...container.querySelectorAll(".lyric-line")];
  const elements = renderedLyricElements;
  if (index === activeLyricIndex) {
    updateWordHighlight(lyrics.lines[index], elements[index]);
    return;
  }
  activeLyricIndex = index;
  elements.forEach((element, itemIndex) => {
    element.classList.toggle("active", itemIndex === index);
    element.classList.toggle("past", itemIndex < index);
    element.classList.toggle("near", Math.abs(itemIndex - index) === 1);
    if (itemIndex !== index) element.style.setProperty("--line-progress", "0%");
  });
  const active = elements[index];
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
    : currentView === "now" ? playbackQueueIds.map(id => tracksById.get(id)).filter(Boolean)
      : currentView === "recent" ? recent.map(id => tracksById.get(id)).filter(Boolean) : [...tracks];

  const recentIds = new Set(recent);
  const queueIds = new Set(playbackQueueIds);
  result = result.filter((track) => {
    if (track.transient && !currentPlaylist && currentView !== "now") return false;
    if (currentPlaylist && !selectedPlaylist?.trackIds?.length && !track.playlists?.includes(currentPlaylist)) return false;
    if (currentView === "recent" && !recentIds.has(track.id)) return false;
    if (currentView === "now" && !queueIds.has(track.id)) return false;
    if (currentView === "favorites" && !favorites.has(track.id)) return false;
    if (currentCollection) {
      const value = currentCollection.type === "artists" ? (track.artist || "未知艺术家") : (track.album || "未知专辑");
      if (value !== currentCollection.name) return false;
      if (currentCollection.format && String(track.format || "").toUpperCase() !== currentCollection.format) return false;
    }
    if (!query) return true;
    return `${track.title} ${track.artist || ""} ${track.album} ${(track.playlists || []).join(" ")}`
      .toLowerCase().includes(query);
  });

  // A playlist is an explicitly ordered sequence. Never apply library sorting
  // to it, otherwise the order stored in Groove's ZPL file is lost.
  if (currentView === "now") {
    const visibleById = new Map(result.map(track => [track.id, track]));
    result = playbackQueueIds.map(id => visibleById.get(id)).filter(Boolean);
  } else if (currentView === "recent") {
    const visibleById = new Map(result.map(track => [track.id, track]));
    result = recent.map(id => visibleById.get(id)).filter(Boolean);
    if (recentSortByPlays) {
      result.sort((left, right) => mergedPlayCount(right) - mergedPlayCount(left));
    }
  } else if (!currentPlaylist && !currentCollection && currentView === "library") {
    const comparators = {
      manual: () => 0,
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
    schedulePersist("tracks");
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
    showPlaylistContextMenu(null, true, event);
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
      showPlaylistContextMenu(playlist.name, false, event);
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
            persist("playlists");
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
  if (!selectedTrackIds.size) multiSelectionMode = false;
  const visible = multiSelectionMode && currentView !== "settings" && currentView !== "player";
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
  for (const id of ["play-selected", "next-selected", "append-selected", "queue-selected", "remove-selected"]) {
    document.getElementById(id).disabled = selectedTrackIds.size === 0;
  }
  updatePlaylistSaveControls();
  document.querySelector("#remove-selected").hidden = !playlists.some(playlist => playlist.name === currentPlaylist);
  const actions = document.querySelector("#selection-actions");
  clearTimeout(selectionActionsHideTimer);
  cancelAnimationFrame(selectionActionsShowFrame);
  selectionActionsShowFrame = null;
  actions.inert = !visible;
  if (visible) {
    actions.hidden = false;
    selectionActionsShowFrame = requestAnimationFrame(() => {
      selectionActionsShowFrame = null;
      actions.classList.add("visible");
    });
    return;
  }
  actions.classList.remove("visible");
  if (currentView === "player" || currentView === "settings") {
    actions.hidden = true;
    return;
  }
  if (actions.hidden) return;
  selectionActionsHideTimer = setTimeout(() => {
    if (!actions.classList.contains("visible")) actions.hidden = true;
  }, 220);
}

function formatCollectionDuration(tracksInView) {
  if (!tracksInView.length) return "0 分钟";
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
  document.querySelector("#playlist-play-all").disabled = tracksInView.length === 0;
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
  const compact = displayMode === "compact";
  trackList.classList.add(compact ? "collection-list" : "collection-grid", `collection-${currentSort}`);
  for (const group of groups) {
    const { name, tracks: groupTracks, format } = group;
    const representative = groupTracks.find((track) => track.cover) || groupTracks[0];
    const card = document.createElement("button");
    card.className = "collection-card";
    card.dataset.trackId = representative.id;
    const subtitle = currentSort === "artists"
      ? compact ? `${new Set(groupTracks.map(track => track.album || "未知专辑")).size} 张专辑` : `${groupTracks.length} 首歌曲`
      : `${representative.artist || "未知艺术家"}${format ? ` · ${format}` : ""}`;
    card.innerHTML = `<img class="collection-cover" alt="" loading="lazy" decoding="async"><strong></strong><small></small>`;
    card.querySelector("img").src = representative.cover || missingArt;
    card.querySelector("strong").textContent = name;
    const totalPlays = groupTracks.reduce((total, track) => total + (track.playCount || 0), 0);
    card.querySelector("small").textContent = currentView === "recent"
      ? `${subtitle} · ${totalPlays} 次播放`
      : subtitle;
    if (compact) {
      const count = document.createElement("span");
      count.className = "collection-count";
      count.textContent = `${groupTracks.length} 首歌曲`;
      const arrow = document.createElement("span");
      arrow.className = "collection-open glyph";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "\uE76C";
      card.append(count, arrow);
    }
    card.title = name;
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
  const currentId = tracks[currentIndex]?.id;
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
    const visibleIds = visibleTracks().map(track => track.id);
    const visibleSet = new Set(visibleIds);
    const orderedIds = [...moveBefore(visibleIds), ...tracks.filter(track => !visibleSet.has(track.id)).map(track => track.id)];
    const byId = new Map(tracks.map((track) => [track.id, track]));
    tracks = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    librarySort = "manual";
  }
  reconcileCurrentTrack(currentId);
  persist();
  render();
}

function closePageMenus() {
  window.MedoMenus.close();
  const picker = document.querySelector("#listening-month-picker");
  if (picker.matches(":popover-open")) picker.hidePopover();
}

function applyViewShellState({ preservePlaybackDetailActive = false } = {}) {
  persistNavigation();
  updateMiniCoverState();
  const settingsOpen = currentView === "settings";
  const playbackDetailOpen = currentView === "player";
  document.querySelector(".sidebar").inert = playbackDetailOpen;
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
  document.querySelector("#recent-listening-summary").hidden = currentView !== "recent" || Boolean(currentPlaylist || currentCollection);
  updateListeningTimeDisplay();
  if (!playbackDetailOpen) coverAtmosphere.finish();
  return { main, settingsOpen, playbackDetailOpen };
}

const pageScrollPositions = new Map();
let renderedPageKey = null;
let renderedSearch = "";
function render() {
  updatePlaylistSaveControls();
  const main = document.querySelector("main");
  const key = JSON.stringify([currentView, currentPlaylist, currentSort, currentCollection]);
  if (key !== renderedPageKey) closePageMenus();
  if (renderedPageKey !== null) pageScrollPositions.set(renderedPageKey, main.scrollTop);
  const savedScrollTop = query !== renderedSearch ? 0 : (pageScrollPositions.get(key) || 0);
  renderedPageKey = key;
  renderedSearch = query;
  if (!selectedTrackIds.size) multiSelectionMode = false;
  renderPage(savedScrollTop);
  main.scrollTop = savedScrollTop;
}

function renderEmptyState(count) {
  emptyState.classList.toggle("hidden", count > 0);
  const searching = Boolean(query) && currentView !== "playlists";
  const states = {
    favorites: ["还没有喜欢的歌曲", "点击歌曲旁的爱心，将它收藏到这里。"],
    recent: ["还没有播放记录", "播放歌曲后，你可以在这里快速找到它。"],
    now: ["正在播放列表为空", "播放歌曲，或将歌曲添加到正在播放。"],
    playlists: ["还没有歌单", "创建歌单，或导入已有的播放列表。"]
  };
  const [title, detail] = searching ? ["没有匹配的歌曲", "试试其他关键词，或者清空搜索查看全部歌曲。"]
    : currentPlaylist ? ["歌单尚未添加歌曲", "使用上方的添加歌曲按钮，充实这个歌单。"]
    : states[currentView] || ["这里还没有音乐", "添加电脑上的歌曲，或者导入已有的播放列表。"];
  emptyState.querySelector("h2").textContent = title;
  emptyState.querySelector("p").textContent = detail;
  emptyState.querySelector("#empty-add").hidden = searching || Boolean(currentPlaylist) || currentView !== "library";
  emptyState.querySelector("#empty-zpl").hidden = searching || Boolean(currentPlaylist) || !["library", "playlists"].includes(currentView);
  let clear = emptyState.querySelector(".clear-empty-search");
  if (!clear) {
    clear = document.createElement("button");
    clear.className = "secondary-button clear-empty-search";
    clear.textContent = "清空搜索";
    clear.addEventListener("click", () => {
      clearTimeout(searchTimer);
      query = "";
      document.querySelector("#search-input").value = "";
      render();
    });
    emptyState.querySelector("div").append(clear);
  }
  clear.hidden = !searching;
}

function renderPage(savedScrollTop) {
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
  const selectionVisible = multiSelectionMode && !settingsOpen && !playbackDetailOpen;
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

  disposeTrackWindow();
  disposeTrackWindow = () => {};
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
  renderEmptyState(currentView === "playlists" ? playlists.length : visible.length);
  trackList.innerHTML = "";
  trackList.className = "track-list";
  trackList.style.removeProperty("height");
  const compactHeading = document.querySelector("#compact-track-heading");
  compactHeading.hidden = true;

  if (currentView === "playlists") {
    trackList.className = "track-list playlist-overview-list";
    const playlistOverviewIndex = new Map(tracks.map(track => [track.id, track]));
    const items = playlists.map((playlist) => {
      const firstId = playlist.trackIds?.find(id => playlistOverviewIndex.has(id));
      const firstTrack = playlistOverviewIndex.get(firstId);
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
      button.title = item.name;
      if (item.firstTrackId) button.dataset.trackId = item.firstTrackId;
    button.innerHTML = '<img class="playlist-overview-cover" alt="" loading="lazy" decoding="async"><strong></strong><small></small>';
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
      (currentSort === "artists" || currentSort === "albums")) {
    renderCollectionCards(visible);
    return;
  }

  const trackIndexes = new Map(tracks.map((track, index) => [track.id, index]));
  compactHeading.hidden = displayMode !== "compact" || !visible.length;
  compactHeading.classList.toggle("with-play-count", currentView === "recent");
  compactHeading.querySelector(".heading-play-count").hidden = currentView !== "recent";
  const createTrackRow = (track, rowIndex) => {
    const actualIndex = trackIndexes.get(track.id) ?? -1;
    const row = document.createElement("div");
    row.className = `track-row${actualIndex === currentIndex ? " active" : ""}${selectedTrackIds.has(track.id) ? " selected" : ""}`;
    row.dataset.trackId = track.id;
    row.innerHTML = `
      <span class="row-leading" title="选择歌曲"><span class="row-number" aria-hidden="true">${rowIndex + 1}</span><img class="row-cover" src="${track.cover || missingArt}" alt="" loading="lazy" decoding="async"><span class="selection-check glyph">&#xE73E;</span></span>
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
    playCount.textContent = playCount.hidden ? "" : `${mergedPlayCount(track)} 次播放`;
    let longPressTimer = null;
    let beginTrackDrag = null;
    let dragReadyAt = 0;
    let pointerId = null;
    let dropTargetId = null;
    let dragPreview = null;
    let dragPointerX = 0;
    let dragPointerY = 0;
    let suppressCheckboxPlaybackUntil = 0;
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
      if (multiSelectionMode || event.target.closest("button, .selection-check") || Date.now() < suppressCheckboxPlaybackUntil) return;
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
      event.stopPropagation();
      suppressCheckboxPlaybackUntil = Date.now() + 500;

      if (!multiSelectionMode) {
        selectedTrackIds.clear();
        multiSelectionMode = true;
      }
      selectedTrackIds.has(track.id) ? selectedTrackIds.delete(track.id) : selectedTrackIds.add(track.id);
      if (!selectedTrackIds.size) multiSelectionMode = false;
      syncSelectionState();
    });
    row.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button, .row-leading")) return;
      clearTimeout(longPressTimer);
      pointerId = event.pointerId;
      dragPointerX = event.clientX;
      dragPointerY = event.clientY;
      dragReadyAt = performance.now() + 220;
      beginTrackDrag = () => {
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
      };
    });
    row.addEventListener("pointermove", (event) => {
      if (!(event.buttons & 1)) {
        beginTrackDrag = null;
        return;
      }
      if (event.pointerId === pointerId && draggedTrackId !== track.id && beginTrackDrag &&
          Math.hypot(event.clientX - dragPointerX, event.clientY - dragPointerY) >= 6) {
        if (performance.now() >= dragReadyAt) beginTrackDrag();
        else beginTrackDrag = null;
      }
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
        beginTrackDrag = null;
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
    row.querySelector(".row-queue").disabled = Boolean(track.transient);
    if (track.transient) row.querySelector(".row-queue").title = "外部歌曲无法保存到歌单，请先导入音乐库";
    row.querySelector(".row-queue").addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!canSavePlaylistTracks([track])) return;
      const result = await window.MedoMenus.chooseTarget(playlists.map((playlist) => playlist.name), event.currentTarget);
      if (result?.action === "create-playlist") {
        await createPlaylistWithTracks([track.id]);
        return;
      }
      const target = playlists.find((playlist) => playlist.name === result?.playlist);
      if (!target) return;
      showActionFeedback(target.trackIds?.includes(track.id) ? "歌曲已在该歌单中" : `已添加到“${target.name}”`);
      if (!addTracksToPlaylist(target, [track.id])) return;
      persist();
      renderPlaylists();
    });
    row.querySelector(".row-favorite").addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(track.id);
      if (event.detail) animateTransportControl(event.currentTarget);
    });
    row.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      const result = await window.MedoMenus.track({
        trackId: track.id,
        canSave: !track.transient,
        playlists: playlists.map((item) => item.name),
        currentPlaylist
      }, event);
      if (!result) return;
      if (result.action === "play") {
        playTrack(actualIndex);
      } else if (result.action === "play-next") {
        const queueWasEmpty = !playbackQueueIds.some((id) => tracks.some((item) => item.id === id));
        playbackQueueIds = playbackQueueIds.filter((id) => id !== track.id);
        const queueIndex = Math.max(-1, playbackQueueIds.indexOf(tracks[currentIndex]?.id));
        playbackQueueIds.splice(queueIndex + 1, 0, track.id);
        showActionFeedback("已安排为下一首播放");
        schedulePersist(["queue", "playback"]);
        if (queueWasEmpty) playTrack(actualIndex, true);
      } else if (result.action === "add-to-queue") {
        const queueWasEmpty = !playbackQueueIds.some((id) => tracks.some((item) => item.id === id));
        playbackQueueIds = playbackQueueIds.filter((id) => id !== track.id);
        playbackQueueIds.push(track.id);
        showActionFeedback("已添加到正在播放");
        schedulePersist(["queue", "playback"]);
        if (queueWasEmpty) playTrack(actualIndex, true);
      } else if (result.action === "create-playlist") {
        await createPlaylistWithTracks([track.id]);
      } else if (result.action === "add-to-playlist") {
        if (!canSavePlaylistTracks([track])) return;
        const playlist = playlists.find((item) => item.name === result.playlist);
        if (playlist) showActionFeedback(playlist.trackIds?.includes(track.id) ? "歌曲已在该歌单中" : `已添加到“${playlist.name}”`);
        if (playlist && !playlist.trackIds?.includes(track.id)) {
          if (!addTracksToPlaylist(playlist, [track.id])) return;
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
        if (!await confirmPlaylistAction("删除歌曲", `从 MedoMusic 音乐库中删除“${track.title}”？\n不会删除本地音频文件。`)) return;
        const currentId = tracks[currentIndex]?.id;
        tracks = tracks.filter((item) => item.id !== track.id);
        playbackQueueIds = playbackQueueIds.filter((id) => id !== track.id);
        recent = recent.filter((id) => id !== track.id);
        favorites.delete(track.id);
        playlists.forEach((playlist) => {
          playlist.trackIds = (playlist.trackIds || []).filter((id) => id !== track.id);
        });
        reconcileCurrentTrack(currentId);
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
    return row;
  };
  const rowHeight = displayMode === "compact" ? 48 : 66;
  const stride = rowHeight + 2;
  const rows = new Map();
  let frame = null;
  trackList.classList.add("virtual-track-list");
  trackList.style.height = `${Math.max(0, visible.length * stride - 2)}px`;
  main.scrollTop = savedScrollTop;
  const renderWindow = () => {
    frame = null;
    if (!trackList.getClientRects().length) return;
    const listTop = trackList.getBoundingClientRect().top - main.getBoundingClientRect().top - main.clientTop + main.scrollTop;
    const windowSize = Math.max(INITIAL_TRACK_RENDER_LIMIT, Math.ceil(main.clientHeight / stride) + 16);
    const start = Math.max(0, Math.min(
      Math.floor((Math.floor((main.scrollTop - listTop) / stride) - 8) / 8) * 8,
      Math.max(0, visible.length - windowSize)
    ));
    const end = Math.min(visible.length, start + windowSize);
    for (const [index, row] of rows) {
      if (index >= start && index < end) continue;
      // Keep pointer capture and keyboard focus when their row leaves the viewport.
      if (row.dataset.trackId === draggedTrackId || row.contains(document.activeElement) || row.matches(":active")) continue;
      metadataObserver.unobserve(row);
      row.remove();
      rows.delete(index);
    }
    for (let index = start; index < end; index += 1) {
      if (rows.has(index)) continue;
      const track = visible[index];
      const row = createTrackRow(track, index);
      row.style.top = `${index * stride}px`;
      row.style.height = `${rowHeight}px`;
      const next = [...rows.keys()].filter((key) => key > index).sort((a, b) => a - b)[0];
      trackList.insertBefore(row, rows.get(next) || null);
      rows.set(index, row);
      observeMetadataRow(row, track);
    }
  };
  const scheduleWindow = () => { if (frame === null) frame = requestAnimationFrame(renderWindow); };
  main.addEventListener("scroll", scheduleWindow, { passive: true });
  const resizeObserver = new ResizeObserver(scheduleWindow);
  resizeObserver.observe(main);
  resizeObserver.observe(trackList);
  renderWindow();
  disposeTrackWindow = () => {
    main.removeEventListener("scroll", scheduleWindow);
    resizeObserver.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
  };
}

function showActionFeedback(message, undo = null, actionLabel = "撤销") {
  let toast = document.querySelector("#action-feedback");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "action-feedback";
    toast.className = "action-feedback";
    toast.setAttribute("role", "status");
    document.body.append(toast);
  }
  clearTimeout(showActionFeedback.timer);
  toast.replaceChildren();
  const label = document.createElement("span");
  label.textContent = message;
  toast.append(label);
  if (undo) {
    const button = document.createElement("button");
    button.textContent = actionLabel;
    button.addEventListener("click", undo, { once: true });
    toast.append(button);
  }
  toast.hidden = false;
  showActionFeedback.timer = setTimeout(() => { toast.hidden = true; }, undo ? 8000 : 3500);
}

function updateMiniCoverState() {
  const button = document.querySelector("#open-playback-detail");
  const available = Boolean(tracks[currentIndex]);
  const expanded = currentView === "player";
  button.disabled = !available;
  button.setAttribute("aria-label", available ? (expanded ? "返回上一页" : "打开歌词页") : "请先选择歌曲");
  button.setAttribute("aria-expanded", String(expanded));
}

function updateNowPlaying(track) {
  updateMiniCoverState();
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
  const available = await coverAtmosphere.setCover(cover);
  if ((tracks[currentIndex]?.cover || missingArt) !== cover) return;
  const resolved = available ? cover : missingArt;
  for (const id of ["detail-cover", "mini-cover"]) {
    const image = document.getElementById(id);
    if (image.getAttribute("src") !== resolved) image.src = resolved;
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
  button.addEventListener("pointerleave", () => {
    if (draggedQueueTrackId !== trackId) clearTimeout(longPressTimer);
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
            persist(["queue", "playback"]);
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
  updatePlaylistSaveControls();
  const track = tracks[currentIndex];
  if (!track) return;
  [
    document.querySelector("#lyric-translation-toggle"),
    document.querySelector("#toggle-detail-track"),
    document.querySelector("#toggle-detail-queue")
  ].forEach((button) => {
    button.style.removeProperty("opacity");
    button.style.removeProperty("transform");
    button.style.removeProperty("visibility");
  });
  document.querySelector("#toggle-detail-track").hidden = false;
  document.querySelector("#toggle-detail-queue").hidden = false;
  const cover = track.cover || missingArt;
  applyCoverTheme(cover);
  document.querySelector("#detail-title").textContent = track.title;
  document.querySelector("#detail-title").title = track.title;
  document.querySelector("#detail-artist").textContent = track.artist || "未知艺术家";
  document.querySelector("#detail-album").textContent = track.album || "未知专辑";
  document.querySelector("#detail-format").textContent = detailFormat(track);
  renderLyrics(track);
  ensureLyrics(track);

  const tracksById = new Map(tracks.map((item) => [item.id, item]));
  const queue = playbackQueueIds.map((id) => tracksById.get(id)).filter(Boolean);
  document.querySelector("#detail-queue-count").textContent = `${queue.length} 首歌曲`;
  const container = document.querySelector("#detail-queue-list");
  const savedQueueScrollTop = container.scrollTop;
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
  container.scrollTop = savedQueueScrollTop;
  const queueRows = new Map();
  const renderQueueWindow = (requestedStart) => {
    const start = Math.max(0, Math.min(requestedStart, Math.max(0, queue.length - queueWindowSize)));
    if (Number(container.dataset.windowStart) === start && queueCanvas.children.length) return;
    container.dataset.windowStart = String(start);
    for (const [index, button] of queueRows) {
      if (index >= start && index < start + queueWindowSize) continue;
      if (button.dataset.trackId === draggedQueueTrackId || button.contains(document.activeElement) || button.matches(":active")) continue;
      button.remove();
      queueRows.delete(index);
    }
    queue.slice(start, start + queueWindowSize).forEach((item, offset) => {
      const index = start + offset;
      if (queueRows.has(index)) return;
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
      const next = [...queueRows.keys()].filter((key) => key > index).sort((a, b) => a - b)[0];
      queueCanvas.insertBefore(button, queueRows.get(next) || null);
      queueRows.set(index, button);
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

function toggleFavorite(id = tracks[currentIndex]?.id) {
  if (!id) return;
  favorites.has(id) ? favorites.delete(id) : favorites.add(id);
  schedulePersist("favorites");
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

function applyTrayEnabled(enabled) {
  trayEnabled = Boolean(enabled);
  localStorage.setItem("medo.trayEnabled", String(trayEnabled));
  document.querySelectorAll(".tray-option").forEach((button) => {
    const active = (button.dataset.trayValue === "true") === trayEnabled;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  window.medo.setTrayEnabled(trayEnabled);
}

function scheduleStartupMaintenance() {
  const run = () => {
    migratePlaylistOrder();
    initializeDefaultLibrary();
    renderAppInfo();
    if (autoCheckUpdates) checkForAppUpdates(true);
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 300);
  }
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
    playing: Boolean(audio.src && !audio.paused && !playbackPausePending),
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
  persist("favorites");
  updateFavoriteButton();
  renderPlaylists();
  return extensionTrack(track);
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
      return { added: mergeTracks(incoming).map(extensionTrack) };
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
        if (!audio.src || audio.paused || playbackPausePending) togglePlayback();
      } else if (action === "pause") {
        pausePlayback();
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
        ensureAudioProcessing();
        applyOutputVolume();
        updateVolumeDisplay();
      } else if (action === "set-muted") {
        audio.muted = Boolean(payload.value);
        updateMuteButton();
        window.medo.setTrayMuted(audio.muted);
      } else if (action === "seek") {
        const seconds = Number(payload.value);
        if (!Number.isFinite(seconds) || !audio.src) throw new Error("invalid-seek");
        seekPlaybackTo(Math.min(Math.max(0, seconds), Number(audio.duration) || seconds));
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
      persist(["playback", "settings"]);
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

function applyAutoUpdateSetting(enabled) {
  autoCheckUpdates = Boolean(enabled);
  localStorage.setItem("medo.autoCheckUpdates", String(autoCheckUpdates));
  document.querySelector("#auto-check-updates").checked = autoCheckUpdates;
}

document.querySelector("#auto-check-updates").addEventListener("change", event => applyAutoUpdateSetting(event.target.checked));
document.querySelector("#check-for-updates").addEventListener("click", () => checkForAppUpdates());
document.querySelector("#open-github-page").addEventListener("click", async event => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await window.medo.openGitHub();
  } catch {
    showActionFeedback("无法打开 GitHub，请检查默认浏览器设置");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
});
document.querySelector("#reset-listening-time").addEventListener("click", async () => {
  if (listeningTimeMs <= 0 || document.querySelector("dialog[open]")) return;
  if (!await confirmPlaylistAction("重置听歌统计", "确认清空每日、每月、每年和总累计听歌时长？\n此操作不可撤销，最近播放记录和播放次数会保留。", "确认重置")) return;
  if (resetListeningTime()) showActionFeedback("听歌时长统计已重置");
});
const listeningMonthTrigger = document.querySelector("#listening-calendar-month");
const listeningMonthPicker = document.querySelector("#listening-month-picker");
listeningMonthPicker.addEventListener("beforetoggle", event => {
  if (event.newState === "open") {
    listeningPickerYear = Number(listeningCalendarMonth.slice(0, 4));
    renderListeningMonthPicker();
  }
});
listeningMonthPicker.addEventListener("toggle", event => {
  listeningMonthTrigger.setAttribute("aria-expanded", String(event.newState === "open"));
  if (event.newState === "open") {
    positionListeningMonthPicker();
    const selected = listeningMonthPicker.querySelector('[aria-pressed="true"]:not(:disabled)') ||
      listeningMonthPicker.querySelector("#listening-picker-months button:not(:disabled)");
    selected?.focus({ preventScroll: true });
  }
});
document.querySelector("#listening-picker-previous-year").addEventListener("click", () => {
  listeningPickerYear -= 1;
  renderListeningMonthPicker();
});
document.querySelector("#listening-picker-next-year").addEventListener("click", () => {
  listeningPickerYear += 1;
  renderListeningMonthPicker();
});
document.querySelector("#listening-picker-year").addEventListener("change", event => {
  const year = event.target.valueAsNumber;
  if (Number.isInteger(year) && year >= 1 && year <= new Date().getFullYear()) listeningPickerYear = year;
  renderListeningMonthPicker();
});
document.querySelector("#listening-picker-year").addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.stopPropagation();
  event.target.dispatchEvent(new Event("change"));
  listeningMonthPicker.querySelector("#listening-picker-months button:not(:disabled)")?.focus();
});
listeningMonthPicker.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    listeningMonthPicker.hidePopover();
    listeningMonthTrigger.focus({ preventScroll: true });
    return;
  }
  const buttons = [...listeningMonthPicker.querySelectorAll("#listening-picker-months button")];
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
  if (event.key in offsets || event.key === "Home" || event.key === "End") {
    event.preventDefault();
    let next = event.key === "Home" ? 0 : event.key === "End" ? buttons.findLastIndex(button => !button.disabled) : index + offsets[event.key];
    next = Math.max(0, Math.min(buttons.length - 1, next));
    if (!buttons[next].disabled) buttons[next].focus();
  }
});
document.querySelector("#listening-picker-current").addEventListener("click", () => {
  listeningSelectedDate = listeningDateKey(new Date());
  showListeningMonth(listeningSelectedDate.slice(0, 7));
  listeningMonthPicker.hidePopover();
  listeningMonthTrigger.focus({ preventScroll: true });
});
document.addEventListener("scroll", event => {
  if (listeningMonthPicker.matches(":popover-open") && !listeningMonthPicker.contains(event.target)) listeningMonthPicker.hidePopover();
}, { capture: true });
window.addEventListener("resize", () => {
  if (listeningMonthPicker.matches(":popover-open")) listeningMonthPicker.hidePopover();
});
window.addEventListener("blur", () => {
  if (listeningMonthPicker.matches(":popover-open")) listeningMonthPicker.hidePopover();
});
document.querySelector("#listening-calendar-previous").addEventListener("click", () => moveListeningMonth(-1));
document.querySelector("#listening-calendar-next").addEventListener("click", () => moveListeningMonth(1));
document.querySelector("#listening-calendar-today").addEventListener("click", () => {
  listeningSelectedDate = listeningDateKey(new Date());
  showListeningMonth(listeningSelectedDate.slice(0, 7));
});

async function checkForAppUpdates(automatic = false) {
  const button = document.querySelector("#check-for-updates");
  const label = button.querySelector("span:last-child");
  if (button.disabled) return;
  button.disabled = true;
  button.classList.remove("latest", "failed");
  button.classList.add("checking");
  label.textContent = "\u6b63\u5728\u68c0\u67e5";
  let result;
  try {
    result = await window.medo.checkForUpdates({ automatic });
  } catch {
    result = { error: "unavailable" };
  }
  button.classList.remove("checking");
  if (result?.error) {
    button.classList.toggle("failed", !automatic);
    label.textContent = automatic ? "检查更新" : "检查失败";
  } else if (result?.updateAvailable) {
    label.textContent = `发现 ${result.latestVersion}`;
    if (automatic && autoCheckUpdates) {
      showActionFeedback(`发现新版本 MedoMusic ${result.latestVersion}`, async () => {
        try {
          await window.medo.openUpdateRelease(result.releaseUrl);
        } catch {
          showActionFeedback("更新页面未能打开，请稍后在设置中检查更新");
        }
      }, "查看更新");
    }
  } else {
    button.classList.add("latest");
    label.textContent = "\u8f6f\u4ef6\u5df2\u6700\u65b0";
  }
  button.disabled = false;
}

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
  const snapshot = (element) => {
    const style = getComputedStyle(element);
    return { opacity: style.opacity, transform: style.transform };
  };
  const surfaceStyle = snapshot(surface);
  const layoutStyle = snapshot(layout);
  const backdropStyle = snapshot(backdrop);
  const interrupted = surface.getAnimations().some((animation) => animation.playState === "running");
  [surface, layout, backdrop].forEach((element) => element.getAnimations().forEach((animation) => animation.cancel()));
  const duration = reduced ? 80 : entering ? 220 : 210;
  const easing = "cubic-bezier(0.23, 1, 0.32, 1)";
  const animations = [
    surface.animate(
      reduced
        ? [{ opacity: entering && !interrupted ? .35 : surfaceStyle.opacity }, { opacity: entering ? 1 : 0 }]
        : entering
          ? [interrupted ? surfaceStyle : { opacity: .35, transform: "translateY(12px) scale(1.012)" }, { opacity: 1, transform: "translateY(0) scale(1)" }]
          : [surfaceStyle, { opacity: 0, transform: "translateY(7px) scale(.996)" }],
      { duration, easing, fill: "forwards" }
    )
  ];
  if (!reduced) {
    animations.push(
      layout.animate(
        entering
          ? [interrupted ? layoutStyle : { opacity: 0.58, transform: "translateY(9px) scale(0.975)" }, { opacity: 1, transform: "translateY(0) scale(1)" }]
          : [{ opacity: layoutStyle.opacity, transform: layoutStyle.transform }, { opacity: 0.45, transform: "scale(0.992)" }],
        { duration: entering ? 340 : 180, easing, fill: "forwards" }
      ),
      ...(entering ? [backdrop.animate(
        [{ opacity: interrupted ? backdropStyle.opacity : 0 }, { opacity: 1 }],
        { duration: 380, easing, fill: "forwards" }
      )] : [])
    );
  }
  return Promise.allSettled(animations.map((animation) => animation.finished));
}

function openPlaybackDetail() {
  if (!tracks[currentIndex]) return;
  if (currentView === "player") return;
  const transitionId = ++playbackTransitionId;
  viewBeforePlayer = currentView;
  currentView = "player";
  if (!lyricInspectionActive) activeLyricIndex = -1;
  document.querySelector("main").classList.remove("playback-detail-closing");
  document.body.classList.remove("playback-detail-exiting");
  render();
  requestAnimationFrame(() => {
    if (currentView === "player" && transitionId === playbackTransitionId) animatePlaybackDetail(true);
  });
}

async function closePlaybackDetail() {
  if (currentView !== "player") return;
  closePageMenus();
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
  if (transitionId !== playbackTransitionId) return;
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
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
  persist("playback");
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
  persist("playlists");
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
  persist("settings");
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
  persist(["queue", "playback"]);
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
  multiSelectionMode = false;
  playTrack(tracks.findIndex((track) => track.id === playbackQueueIds[0]), true);
  render();
});
function queueSelectedTracks(playNext) {
  const currentId = tracks[currentIndex]?.id;
  const selected = visibleTracks().filter((track) => selectedTrackIds.has(track.id) && track.id !== currentId).map((track) => track.id);
  const remaining = playbackQueueIds.filter((id) => !selected.includes(id));
  if (currentId && !remaining.includes(currentId)) remaining.unshift(currentId);
  const insertAt = playNext ? Math.max(0, remaining.indexOf(currentId) + 1) : remaining.length;
  remaining.splice(insertAt, 0, ...selected);
  showActionFeedback(selected.length ? `已将 ${selected.length} 首歌曲${playNext ? "安排为下一首播放" : "添加到正在播放"}` : "所选歌曲已是当前播放歌曲");
  playbackQueueIds = remaining;
  selectedTrackIds.clear();
  multiSelectionMode = false;
  persist(["queue", "playback"]);
  render();
}
document.querySelector("#next-selected").addEventListener("click", () => queueSelectedTracks(true));
document.querySelector("#append-selected").addEventListener("click", () => queueSelectedTracks(false));
document.querySelector("#queue-selected").addEventListener("click", () => {
  const selected = visibleTracks().filter(track => selectedTrackIds.has(track.id));
  if (!selected.length || !canSavePlaylistTracks(selected) || document.querySelector(".playlist-picker-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.className = "track-info-dialog playlist-picker-dialog";
  dialog.setAttribute("aria-labelledby", "playlist-picker-title");
  dialog.innerHTML = '<form method="dialog"><header><h2 id="playlist-picker-title">添加到歌单</h2><p></p></header><div class="playlist-picker-options"></div><footer><button value="cancel">取消</button></footer></form>';
  dialog.querySelector("header p").textContent = `将 ${selected.length} 首歌曲添加到：`;
  const list = dialog.querySelector(".playlist-picker-options");
  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "playlist-picker-create";
  createButton.textContent = "创建新播放列表";
  createButton.setAttribute("aria-label", "创建新播放列表");
  createButton.addEventListener("click", async () => {
    dialog.close();
    // Remove the picker before opening the naming dialog in the same modal layer.
    dialog.remove();
    const playlist = await createPlaylistWithTracks(selected.map(track => track.id));
    if (!playlist) return;
    selectedTrackIds.clear();
    multiSelectionMode = false;
    render();
  });
  list.append(createButton);
  if (playlists.length) {
    const separator = document.createElement("div");
    separator.setAttribute("role", "separator");
    list.append(separator);
  }
  playlists.forEach(playlist => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = playlist.name;
    button.addEventListener("click", () => {
      if (!playlists.includes(playlist)) return;
      const addedCount = selected.filter(track => !(playlist.trackIds || []).includes(track.id)).length;
      if (!addTracksToPlaylist(playlist, selected.map(track => track.id))) return;
      showActionFeedback(addedCount ? `已添加 ${addedCount} 首到“${playlist.name}”` : "所选歌曲已在该歌单中");
      selectedTrackIds.clear();
      multiSelectionMode = false;
      persist();
      dialog.close();
      render();
    });
    list.append(button);
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
});
document.querySelector("#remove-selected").addEventListener("click", () => {
  const playlist = playlists.find(item => item.name === currentPlaylist);
  if (!playlist) return;
  const ids = new Set(visibleTracks().filter(track => selectedTrackIds.has(track.id)).map(track => track.id));
  const originalOrder = [...(playlist.trackIds || [])];
  showActionFeedback(`已从列表中移除 ${ids.size} 首歌曲`, () => {
    if (!playlists.includes(playlist)) return;
    const existing = new Set(playlist.trackIds || []);
    const valid = new Set(tracks.map(track => track.id));
    playlist.trackIds = [...originalOrder.filter(id => valid.has(id) && (ids.has(id) || existing.has(id))),
      ...(playlist.trackIds || []).filter(id => !originalOrder.includes(id))];
    tracks.forEach(track => {
      if (ids.has(track.id)) track.playlists = [...new Set([...(track.playlists || []), playlist.name])];
    });
    persist();
    render();
    showActionFeedback("已恢复移除的歌曲");
  });
  playlist.trackIds = (playlist.trackIds || []).filter(id => !ids.has(id));
  tracks.forEach(track => {
    if (ids.has(track.id)) track.playlists = (track.playlists || []).filter(name => name !== playlist.name);
  });
  selectedTrackIds.clear();
  multiSelectionMode = false;
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
  const button = document.querySelector("#open-playback-detail");
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const flash = button.querySelector(".mini-cover-flash");
    const pose = getComputedStyle(flash);
    const start = { opacity: pose.opacity, transform: pose.transform };
    flash.getAnimations().forEach((animation) => animation.cancel());
    flash.animate([start, { opacity: .85, transform: "scale(1.02)", offset: .15 },
      { opacity: 0, transform: "scale(1.45)" }], { duration: 420, easing: "cubic-bezier(.22,1,.36,1)" });
  }
  if (currentView === "player") {
    closePlaybackDetail();
    return;
  }
  openPlaybackDetail();
});
document.querySelector("#back-button").addEventListener("click", goBack);
function syncSidebarState() {
  document.querySelector(".app-shell").classList.toggle("sidebar-collapsed", sidebarCollapsed);
  document.querySelector(".menu-button").setAttribute("aria-expanded", String(!sidebarCollapsed));
  document.querySelector(".side-search input").inert = sidebarCollapsed;
  document.querySelector(".playlist-list").inert = sidebarCollapsed;
}
document.querySelector(".menu-button").addEventListener("click", () => {
  sidebarCollapsed = !sidebarCollapsed;
  syncSidebarState();
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
window.medo.onWindowMaximized((maximized) => {
  const button = document.querySelector("#window-maximize");
  button.classList.toggle("is-maximized", maximized);
  button.title = maximized ? "还原" : "最大化";
  button.setAttribute("aria-label", button.title);
});
document.querySelector("#window-close").addEventListener("click", window.medo.closeWindow);
document.querySelector("#collection-back").addEventListener("click", () => {
  currentCollection = null;
  render();
  animateViewSurface();
});
playButton.addEventListener("click", togglePlayback);

const transportAnimations = new WeakMap();
function animateTransportControl(button) {
  if (!button || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const from = getComputedStyle(button).transform;
  transportAnimations.get(button)?.cancel();
  const resting = getComputedStyle(button).transform;
  if (button === playButton) {
    const scale = button.matches(':hover') ? 1.045 : 1;
    const animation = button.animate([
      {transform:from,easing:'cubic-bezier(.2,.8,.3,1)'},
      {transform:`scale(${scale + .03})`,offset:.48,easing:'cubic-bezier(.4,0,.2,1)'},
      {transform:`scale(${scale - .008})`,offset:.78,easing:'cubic-bezier(.2,0,.2,1)'},
      {transform:`scale(${scale})`}
    ],{duration:260,easing:'linear'});
    transportAnimations.set(button,animation);
    return;
  }
  const direction = button.id === 'previous-button' ? -1 : button.id === 'next-button' ? 1 : 0;
  if (direction) {
    const hover = button.matches(':hover');
    const y = hover ? -2 : 0;
    const scale = hover ? 1.1 : 1;
    const animation = button.animate([
      {transform:from,easing:'cubic-bezier(.2,.8,.3,1)'},
      {transform:`translate(${direction * 4}px,${y}px) scale(${scale - .03})`,offset:.38,easing:'cubic-bezier(.4,0,.2,1)'},
      {transform:`translate(${-direction * .5}px,${y}px) scale(${scale})`,offset:.76,easing:'cubic-bezier(.2,0,.2,1)'},
      {transform:`translateY(${y}px) scale(${scale})`}
    ],{duration:240,easing:'linear'});
    transportAnimations.set(button,animation);
    return;
  }
  if (button.id === 'play-mode-button') {
    const hover = button.matches(':hover');
    const y = hover ? -2 : 0;
    const scale = hover ? 1.1 : 1;
    const animation = button.animate([
      {transform:from,easing:'cubic-bezier(.2,.8,.3,1)'},
      {transform:`translateY(${y}px) scale(${scale + .015}) rotate(12deg)`,offset:.4,easing:'cubic-bezier(.4,0,.2,1)'},
      {transform:`translateY(${y}px) scale(${scale}) rotate(-1deg)`,offset:.78,easing:'cubic-bezier(.2,0,.2,1)'},
      {transform:`translateY(${y}px) scale(${scale}) rotate(0deg)`}
    ],{duration:250,easing:'linear'});
    transportAnimations.set(button,animation);
    return;
  }
  const accent = button.matches('.heart-button,.row-favorite') ? 'scale(1.23) rotate(-9deg)' : 'scale(1.13)';
  const animation = button.animate([
    {transform:from},
    {transform:'scale(.9)',offset:.18},
    {transform:accent,offset:.52},
    {transform:resting}
  ],{duration:280,easing:'cubic-bezier(.22,1,.36,1)'});
  transportAnimations.set(button,animation);
}
playButton.addEventListener('pointerdown', event => {
  if (event.button !== 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const from = getComputedStyle(playButton).transform;
  transportAnimations.get(playButton)?.cancel();
  transportAnimations.set(playButton,playButton.animate(
    [{transform:from},{transform:'scale(.94)'}],
    {duration:85,easing:'cubic-bezier(.2,.8,.3,1)'}
  ));
});
document.querySelector('.controls').addEventListener('click', event => {
  if (event.detail) animateTransportControl(event.target.closest('button'));
});
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
  const liveTransform = getComputedStyle(button).transform;
  button.getAnimations().forEach((animation) => animation.cancel());
  button.animate(
    [
      { transform: liveTransform },
      { transform: "scale(.88) rotate(-5deg)", offset: .16 },
      { transform: "scale(1.09) rotate(2deg)", offset: .54 },
      { transform: "scale(1) rotate(0)" }
    ],
    { duration: 320, easing: "cubic-bezier(.22,1,.36,1)" }
  );
  let ring = button.querySelector(".tool-feedback-ring");
  if (!ring) {
    ring = document.createElement("span");
    ring.className = "tool-feedback-ring";
    ring.setAttribute("aria-hidden", "true");
    button.append(ring);
  }
  const running = ring.getAnimations().length > 0;
  const ringStyle = getComputedStyle(ring);
  const start = { opacity: running ? ringStyle.opacity : .8, transform: running ? ringStyle.transform : "scale(.65)" };
  ring.getAnimations().forEach((animation) => animation.cancel());
  ring.animate([start, { opacity: 0, transform: "scale(1.65)" }],
    { duration: 480, easing: "cubic-bezier(.22,1,.36,1)" });
}

function animateDetailPanelToggle(button, panel, visible, hiddenClass) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const surfaces = [...document.querySelector(".detail-layout").children];
  const before = new Map(surfaces.map((element) => [element, {
    rect: element.getBoundingClientRect(), opacity: getComputedStyle(element).opacity
  }]));
  surfaces.forEach((element) => {
    element.getAnimations().forEach((animation) => animation.cancel());
    element.style.removeProperty("width");
  });
  document.body.classList.toggle(hiddenClass, !visible);
  button.classList.toggle("active", visible);
  button.setAttribute("aria-pressed", String(visible));
  if (reduced) return;
  animatePlayerToolButton(button);
  if (!visible) panel.style.width = `${before.get(panel).rect.width}px`;
  surfaces.forEach((element) => {
    const previous = before.get(element);
    const after = element.getBoundingClientRect();
    const isPanel = element === panel;
    if (!isPanel && getComputedStyle(element).visibility === "hidden") return;
    const deltaX = previous.rect.left - after.left +
      (element.classList.contains("lyrics-stage") ? (previous.rect.width - after.width) / 2 : 0);
    const deltaY = previous.rect.top - after.top;
    const direction = element.classList.contains("detail-track") ? -1 : 1;
    const animation = element.animate([
      { transform: `translate(${deltaX}px, ${deltaY}px) scale(${isPanel && visible && Number(previous.opacity) === 0 ? .94 : 1})`,
        opacity: previous.opacity, visibility: "visible" },
      { transform: isPanel && !visible ? `translateX(${direction * 28}px) scale(.95)` : "translate(0, 0) scale(1)",
        opacity: isPanel && !visible ? 0 : 1, visibility: "visible" }
    ], { duration: isPanel && !visible ? 240 : 380, easing: "cubic-bezier(.22,1,.36,1)" });
    animation.finished.then(() => {
      if (isPanel && !visible) panel.style.removeProperty("width");
    }).catch(() => {});
  });
}

document.querySelector("#toggle-detail-track").addEventListener("click", () => {
  detailTrackVisible = !detailTrackVisible;
  const button = document.querySelector("#toggle-detail-track");
  animateDetailPanelToggle(button, document.querySelector(".detail-track"), detailTrackVisible, "detail-track-hidden");
});
document.querySelector("#toggle-detail-queue").addEventListener("click", () => {
  detailQueueVisible = !detailQueueVisible;
  const button = document.querySelector("#toggle-detail-queue");
  animateDetailPanelToggle(button, document.querySelector(".detail-queue"), detailQueueVisible, "detail-queue-hidden");
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
  schedulePersist("playback");
});
window.medo.onLyricsWindowVisibility((visible) => {
  document.querySelector("#desktop-lyrics-button").classList.toggle("active", visible);
  if (visible) {
    activeLyricIndex = -1;
    updateLyricsAtTime();
  }
});
window.medo.onLyricsWindowLockState((locked) => {
  syncDesktopLyricLockSetting(locked);
});

const lyricsStage = document.querySelector(".lyrics-stage");
const lyricsLines = document.querySelector("#lyrics-lines");
const lyricLayoutObserver = new ResizeObserver(() => {
  if (currentView !== "player" || lyricInspectionActive || lyricsLines.classList.contains("unsynced")) return;
  const active = lyricsLines.querySelector(".lyric-line.active");
  if (active && lyricsLines.style.transform !== `translateY(${-active.offsetTop - active.offsetHeight / 2}px)`) {
    animateLyricFollow(lyricsLines, active);
  }
});
lyricLayoutObserver.observe(lyricsLines);
lyricLayoutObserver.observe(lyricsLines.parentElement);
function freezeLyricFollow() {
  const transform = getComputedStyle(lyricsLines).transform;
  const offset = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
  lyricFollowAnimation?.cancel();
  lyricFollowAnimation = null;
  lyricsLines.style.transform = `translateY(${offset}px)`;
  return offset;
}

function restoreLyricFollow() {
  clearTimeout(lyricInspectionRestoreTimer);
  selectedLyricElement?.classList.remove("selected");
  selectedLyricElement = null;
  lyricInspectionActive = false;
  lyricInspectionOffset = 0;
  activeLyricIndex = -1;
  lyricsStage.classList.remove("inspecting");
  updateLyricsAtTime();
}

function scheduleLyricFollowRestore() {
  clearTimeout(lyricInspectionRestoreTimer);
  if (lyricPointerInside || lyricDragPointerId !== null) return;
  lyricInspectionRestoreTimer = setTimeout(restoreLyricFollow, 5000);
}
lyricsStage.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "touch") return;
  lyricPointerInside = true;
  clearTimeout(lyricInspectionRestoreTimer);
});
lyricsStage.addEventListener("pointerleave", () => {
  lyricPointerInside = false;
  if (lyricInspectionActive) scheduleLyricFollowRestore();
});
document.querySelector("#restore-lyric-follow").addEventListener("click", restoreLyricFollow);
function clampLyricInspectionOffset(offset) {
  const lines = [...lyricsLines.querySelectorAll(".lyric-line[data-start]")];
  if (!lines.length) return offset;
  const firstLine = lines[0];
  const lastLine = lines.at(-1);
  const maximum = -(firstLine.offsetTop + firstLine.offsetHeight / 2);
  const minimum = -(lastLine.offsetTop + lastLine.offsetHeight / 2);
  return Math.max(minimum, Math.min(maximum, offset));
}
lyricsStage.addEventListener("pointerdown", (event) => {
  if (event.target.closest("#restore-lyric-follow") || lyricDragPointerId !== null ||
      event.button !== 0 || !lyricsCache.get(tracks[currentIndex]?.id)?.synced) return;
  lyricDragStartOffset = freezeLyricFollow();
  lyricDragPointerId = event.pointerId;
  lyricDragStartY = event.clientY;
  lyricDraggedDistance = 0;
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
  }
  if (!lyricsStage.hasPointerCapture(event.pointerId)) lyricsStage.setPointerCapture(event.pointerId);
  lyricInspectionOffset = clampLyricInspectionOffset(lyricDragStartOffset + event.clientY - lyricDragStartY);
  lyricsLines.style.transform = `translateY(${lyricInspectionOffset}px)`;
});
lyricsStage.addEventListener("click", (event) => {
  if (event.target.closest("#restore-lyric-follow")) return;
  if (lyricDraggedDistance > 6) {
    event.preventDefault();
    event.stopPropagation();
    lyricDraggedDistance = 0;
    return;
  }
  const line = event.target.closest(".lyric-line[data-start]");
  if (!line) return;
  if (selectedLyricElement !== line) {
    lyricInspectionOffset = freezeLyricFollow();
    selectedLyricElement?.classList.remove("selected");
    selectedLyricElement = line;
    selectedLyricElement.classList.add("selected");
    lyricInspectionActive = true;
    lyricsStage.classList.add("inspecting");
    scheduleLyricFollowRestore();
    return;
  }
  seekPlaybackTo(Math.max(0, Number(line.dataset.start) || 0));
  selectedLyricElement.classList.remove("selected");
  selectedLyricElement = null;
  clearTimeout(lyricInspectionRestoreTimer);
  lyricInspectionActive = false;
  activeLyricIndex = -1;
  lyricsStage.classList.remove("inspecting");
  updateLyricsAtTime();
}, true);
["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
  lyricsStage.addEventListener(eventName, (event) => {
    if (event.pointerId !== lyricDragPointerId) return;
    lyricDragPointerId = null;
    if (lyricInspectionActive) scheduleLyricFollowRestore();
  });
});
lyricsStage.addEventListener("wheel", (event) => {
  if (!lyricsCache.get(tracks[currentIndex]?.id)?.synced || event.ctrlKey || !event.deltaY) return;
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? lyricsStage.clientHeight : 1;
  const delta = event.deltaY * unit * .72;
  const liveOffset = freezeLyricFollow();
  // Reverse immediately instead of finishing the previous wheel movement first.
  if (!lyricInspectionActive || Math.sign(lyricInspectionOffset - liveOffset) === Math.sign(delta)) {
    lyricInspectionOffset = liveOffset;
  }
  lyricInspectionActive = true;
  lyricsStage.classList.add("inspecting");
  lyricInspectionOffset = clampLyricInspectionOffset(lyricInspectionOffset - delta);
  const target = `translateY(${lyricInspectionOffset}px)`;
  lyricsLines.style.transform = target;
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    lyricFollowAnimation = lyricsLines.animate(
      [{ transform: `translateY(${liveOffset}px)` }, { transform: target }],
      { duration: 200, easing: "cubic-bezier(.16,1,.3,1)" }
    );
  }
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
const interfaceScaleSelect = document.querySelector("#interface-scale");
function syncInterfaceScale(state) {
  if (!state) return;
  interfaceScaleSelect.value = String(state.requested);
  const fitted = state.effective + .001 < state.requested;
  document.querySelector("#interface-scale-status").textContent = fitted
    ? `当前适配为 ${Math.round(state.effective * 100)}%，扩大窗口可使用所选比例。`
    : "跟随系统显示缩放，可按需调整界面大小。";
}
window.medo.onWindowScale(syncInterfaceScale);
interfaceScaleSelect.addEventListener("change", async () => {
  const requested = interfaceScaleSelect.value;
  const state = await window.medo.setWindowScale(Number(requested));
  localStorage.setItem("medo.interfaceScale", requested);
  syncInterfaceScale(state);
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
document.querySelector("#cover-fit").addEventListener("change", (event) => applyCoverFit(event.target.value));

document.querySelectorAll("[data-display-value]").forEach((button) => {
  button.addEventListener("click", () => {
    applyDisplayMode(button.dataset.displayValue);
    localStorage.setItem("medo.displayMode", displayMode);
    render();
  });
});
document.querySelectorAll(".close-behavior-option").forEach((button) => {
  button.addEventListener("click", () => applyCloseBehavior(button.dataset.closeValue));
});
document.querySelectorAll(".tray-option").forEach((button) => {
  button.addEventListener("click", () => applyTrayEnabled(button.dataset.trayValue === "true"));
});
document.querySelectorAll(".global-play-shortcut-option").forEach((button) => {
  button.addEventListener("click", () => applyGlobalShortcutSettings("playPause", button.dataset.enabled === "true"));
});
document.querySelectorAll(".global-desktop-lyrics-shortcut-option").forEach((button) => {
  button.addEventListener("click", () => applyGlobalShortcutSettings("desktopLyrics", button.dataset.enabled === "true"));
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
document.querySelector("#inactive-lyric-color").addEventListener("input", (event) => {
  applyInactiveLyricColor(event.target.value);
});
document.querySelector("#inactive-lyric-color").addEventListener("change", (event) => {
  applyInactiveLyricColor(event.target.value, true);
});
document.querySelector("#reset-inactive-lyric-color").addEventListener("click", () => {
  applyInactiveLyricColor(null, true);
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
const applyWindowMaterial = (material) => {
  document.documentElement.dataset.windowMaterial = ["transparent", "blur", "acrylic"].includes(material) ? material : "none";
  // index.html paints an opaque startup color before styles load. It must be
  // cleared as well as the body background to expose the native backdrop.
  document.documentElement.style.backgroundColor = document.documentElement.dataset.windowMaterial === "none" ? "var(--background)" : "transparent";
  updateThemeInkColors();
};
window.medo.onWindowMaterial?.(applyWindowMaterial);
window.medo.getWindowMaterial?.().then(applyWindowMaterial);
const glassBackground = window.MedoGlassBackground.create({ onChange: updateThemeInkColors, updateRange: updateRangeGradient });
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
    ensureAudioProcessing();
    applyOutputVolume();
    updateVolumeDisplay();
    showVolumeBubble(true);
    schedulePersist("playback");
    return;
  }
  if (!audio.src || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const seekOffset = event.key === "ArrowLeft" ? -5 : event.key === "ArrowRight" ? 5 : 0;
  if (!seekOffset) return;
  event.preventDefault();
  seekPlaybackTo(Math.max(0, Math.min(audio.duration, audio.currentTime + seekOffset)));
  progress.value = audio.duration ? audio.currentTime / audio.duration * 100 : 0;
  updateRangeGradient(progress, audio.duration ? audio.currentTime / audio.duration : 0);
  document.querySelector("#current-time").textContent = formatTime(audio.currentTime);
  updateLyricsAtTime();
  schedulePersist("playback");
});

audio.addEventListener("play", () => {
  switchingPlaybackGeneration = 0;
  updatePlayButtonState(!playbackPausePending);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playbackPausePending ? "paused" : "playing";
  activeLyricIndex = -1;
  updateLyricsAtTime();
});
audio.addEventListener("playing", () => {
  if (playbackFadeEnabled && !playbackPausePending) setPlaybackFadeTarget(1, .24);
  startListeningTime();
});
audio.addEventListener("seeked", startListeningTime);
audio.addEventListener("ratechange", accumulateListeningTime);
["pause", "waiting", "seeking", "ended", "emptied", "error", "abort"].forEach(eventName => {
  audio.addEventListener(eventName, stopListeningTime);
});
audio.addEventListener("pause", () => {
  if (!audio.paused) return;
  resetPlaybackFade(0);
  if (switchingPlaybackGeneration !== 0) return;
  updatePlayButtonState(false);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  activeLyricIndex = -1;
  updateLyricsAtTime();
  schedulePersist("playback");
});
audio.addEventListener("timeupdate", () => {
  accumulateListeningTime();
  updateLyricsAtTime();

  if (performance.now() - lastPlaybackStateSave > 5000) {
    lastPlaybackStateSave = performance.now();
    persistPlaybackState();
  }
  if (!backgroundMode) {
    progress.value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    updateRangeGradient(progress, audio.duration ? audio.currentTime / audio.duration : 0);
    const time = document.querySelector("#current-time"), value = formatTime(audio.currentTime);
    if (time.textContent !== value) time.textContent = value;
  }
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
      seekPlaybackTo(audio.duration || 0);
      return;
    }
  }
  nextTrack();
});
audio.addEventListener("error", () => recoverPlaybackFailure(tracks[currentIndex]));

progress.addEventListener("input", () => {
  if (audio.duration) seekPlaybackTo((Number(progress.value) / 100) * audio.duration);
});
volume.addEventListener("input", () => {
  desiredVolume = Number(volume.value);
  ensureAudioProcessing();
  applyOutputVolume();
  updateVolumeDisplay();
  showVolumeBubble(!volumePointerActive);
  schedulePersist("playback");
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

window.addEventListener("beforeunload", persist);

function updateBackgroundMode() {
  backgroundMode = document.hidden || !nativeWindowVisible;
  document.body.classList.toggle("background-mode", backgroundMode);
  if (backgroundMode) {
    coverAtmosphere.finish();
    lyricPresentationSuspended = true;
    lyricFollowAnimation?.finish();
  }
  if (!backgroundMode) {
    lastBackgroundUiUpdate = 0;
    updateListeningTimeDisplay();
    scheduleListeningCalendarRollover();
    if (currentView === "player") {
      updateLyricsAtTime();
      renderPlaybackDetail();
    }
  }
}
document.addEventListener("visibilitychange", updateBackgroundMode);
window.medo.onWindowVisibility((visible) => {
  nativeWindowVisible = visible;
  updateBackgroundMode();
});

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => {
    if (!audio.src || audio.paused || playbackPausePending) togglePlayback();
  });
  navigator.mediaSession.setActionHandler("pause", pausePlayback);
  navigator.mediaSession.setActionHandler("previoustrack", () => nextTrack(-1));
  navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack(1));
}

repairPlaylistMemberships();
restoreNavigation();
desiredVolume = Math.min(1, Math.max(0, Number(restoredPlaybackState.volume ?? desiredVolume)));
volume.value = desiredVolume;
applyOutputVolume();
applyPlaybackFadeSetting(playbackFadeEnabled);
window.medo.setTrayMuted(audio.muted);
updateVolumeDisplay();
updateRangeGradient(progress, 0);
applyTheme(theme);
window.medo.setWindowScale(Number(localStorage.getItem("medo.interfaceScale")) || 1).then(syncInterfaceScale);
applyThemeColors();
applyCoverFit(coverFit);
applyDisplayMode(displayMode);
applyCloseBehavior(closeBehavior);
applyTrayEnabled(trayEnabled);
applyAutoUpdateSetting(autoCheckUpdates);
applyGlobalShortcutSettings();
applyLyricTranslationSetting(lyricTranslationEnabled);
applyWordLyricsSetting(wordLyricsEnabled);
localStorage.removeItem("medo.appleMusicEnabled");
localStorage.removeItem("medo.appleMusicStorefront");
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
syncSidebarState();
document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
render();
scheduleListeningCalendarRollover();
scheduleStartupMaintenance();
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
    ensureAudioProcessing();
    applyOutputVolume();
    updateVolumeDisplay();
    schedulePersist("playback");
  } else if (command === "toggle-mute") {
    audio.muted = !audio.muted;
    updateMuteButton();
    window.medo.setTrayMuted(audio.muted);
    schedulePersist("playback");
  } else if (command === "set-mode") {
    playMode = value;
    if (playMode === "shuffle") {
      shuffleQueueSignature = "";
      shuffleRemainingIds = [];
      shuffleHistoryIds = [];
      shuffleHistoryIndex = -1;
    }
    persist("settings");
    updatePlayModeButton();
  } else if (command === "desktop-lyric-size") {
    applyDesktopLyricSize(value);
  } else if (command === "previous") nextTrack(-1);
  else if (command === "next") nextTrack(1);
  else if (command === "toggle-play") togglePlayback();
  else if (command === "toggle-desktop-lyrics") {
    window.medo.toggleLyricsWindow();
    activeLyricIndex = -1;
    updateLyricsAtTime();
  }
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
