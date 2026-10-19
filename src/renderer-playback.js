// Renderer playback. Loaded before renderer.js; shares its application state.

function formatListeningTime(milliseconds) {
  const totalMinutes = Math.floor(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  return `${hours} 小时 ${String(totalMinutes % 60).padStart(2, "0")} 分钟`;
}

function normalizeListeningDays(value) {
  const days = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return days;
  for (const [key, milliseconds] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(milliseconds) || milliseconds <= 0) continue;
    const date = new Date(`${key}T00:00:00`);
    if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1 || listeningDateKey(date) !== key) continue;
    const rounded = Math.round(milliseconds);
    if (Number.isSafeInteger(rounded) && rounded > 0) days[key] = rounded;
  }
  return days;
}

function updateListeningTimeDisplay() {
  const formatted = formatListeningTime(listeningTimeMs);
  for (const id of ["recent-listening-time", "settings-listening-time"]) {
    const label = document.getElementById(id);
    if (label.textContent !== formatted) label.textContent = formatted;
  }
  document.querySelector("#reset-listening-time").disabled = listeningTimeMs <= 0;
  if (currentView === "settings") renderListeningCalendar();
}

function listeningDateKey(date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function recordListeningTime(milliseconds, endedAt = Date.now()) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || !Number.isFinite(endedAt)) return;
  const duration = Math.floor(milliseconds + listeningFractionalMs);
  const end = Math.floor(endedAt);
  if (!Number.isFinite(new Date(end - duration).getTime()) || !Number.isFinite(new Date(end).getTime())) return;
  listeningFractionalMs = milliseconds + listeningFractionalMs - duration;
  let cursor = end - duration;
  while (cursor < end) {
    const date = new Date(cursor);
    const key = listeningDateKey(date);
    date.setHours(24, 0, 0, 0);
    const next = Math.min(end, date.getTime());
    listeningDailyMs[key] = (listeningDailyMs[key] || 0) + next - cursor;
    listeningTimeMs += next - cursor;
    cursor = next;
  }
}

function compactListeningTime(milliseconds) {
  if (!milliseconds) return "—";
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return "不足 1 分";
  if (minutes < 60) return `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ""}`;
}

function showListeningMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1) {
    return;
  }
  const today = listeningDateKey(new Date());
  listeningCalendarMonth = month > today.slice(0, 7) ? today.slice(0, 7) : month;
  if (!listeningSelectedDate.startsWith(listeningCalendarMonth)) {
    listeningSelectedDate = listeningCalendarMonth === today.slice(0, 7) ? today : `${listeningCalendarMonth}-01`;
  }
  renderListeningCalendar();
}

function positionListeningMonthPicker() {
  const picker = document.querySelector("#listening-month-picker");
  const anchor = document.querySelector("#listening-calendar-month").getBoundingClientRect();
  const bounds = picker.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8));
  const top = anchor.bottom + bounds.height + 8 <= innerHeight - 8
    ? anchor.bottom + 8 : Math.max(8, anchor.top - bounds.height - 8);
  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;
}

function renderListeningMonthPicker() {
  const today = listeningDateKey(new Date());
  const yearInput = document.querySelector("#listening-picker-year");
  yearInput.value = listeningPickerYear;
  yearInput.max = today.slice(0, 4);
  document.querySelector("#listening-picker-previous-year").disabled = listeningPickerYear <= 1;
  document.querySelector("#listening-picker-next-year").disabled = listeningPickerYear >= Number(today.slice(0, 4));
  const grid = document.querySelector("#listening-picker-months");
  if (!grid.children.length) {
    for (let month = 1; month <= 12; month += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${month} 月`;
      button.addEventListener("click", () => {
        showListeningMonth(`${String(listeningPickerYear).padStart(4, "0")}-${String(month).padStart(2, "0")}`);
        document.querySelector("#listening-month-picker").hidePopover();
        document.querySelector("#listening-calendar-month").focus({ preventScroll: true });
      });
      grid.append(button);
    }
  }
  for (const [index, button] of [...grid.children].entries()) {
    const key = `${String(listeningPickerYear).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`;
    button.dataset.listeningMonth = key;
    button.setAttribute("aria-label", `${listeningPickerYear} 年 ${index + 1} 月`);
    button.setAttribute("aria-pressed", String(key === listeningCalendarMonth));
    if (key === today.slice(0, 7)) button.setAttribute("aria-current", "date");
    else button.removeAttribute("aria-current");
    button.disabled = key > today.slice(0, 7);
  }
}

function moveListeningMonth(offset) {
  const date = new Date(`${listeningCalendarMonth}-01T12:00:00`);
  date.setMonth(date.getMonth() + offset);
  showListeningMonth(listeningDateKey(date).slice(0, 7));
}

function scheduleListeningCalendarRollover() {
  clearTimeout(listeningCalendarRolloverTimer);
  const nextDay = new Date();
  nextDay.setHours(24, 0, 0, 0);
  listeningCalendarRolloverTimer = setTimeout(() => {
    updateListeningTimeDisplay();
    scheduleListeningCalendarRollover();
  }, nextDay.getTime() - Date.now() + 50);
}

function renderListeningCalendar() {
  const today = listeningDateKey(new Date());
  if (today !== listeningCalendarToday) {
    if (listeningSelectedDate === listeningCalendarToday) {
      listeningSelectedDate = today;
      listeningCalendarMonth = today.slice(0, 7);
    }
    listeningCalendarToday = today;
  }
  const [year, month] = listeningCalendarMonth.split("-").map(Number);
  let monthMilliseconds = 0;
  let yearMilliseconds = 0;
  const monthDays = [];
  for (const [key, milliseconds] of Object.entries(listeningDailyMs)) {
    if (key.startsWith(listeningCalendarMonth)) {
      monthMilliseconds += milliseconds;
      monthDays.push([key, Math.floor(milliseconds / 60000), milliseconds > 0]);
    }
    if (key.startsWith(`${String(year).padStart(4, "0")}-`)) yearMilliseconds += milliseconds;
  }
  const signature = JSON.stringify([today, listeningCalendarMonth, listeningSelectedDate, monthDays,
    Math.floor(monthMilliseconds / 60000), Math.floor(yearMilliseconds / 60000)]);
  if (signature === listeningCalendarSignature) return;
  listeningCalendarSignature = signature;
  const grid = document.querySelector("#listening-calendar");
  if (grid.dataset.month !== listeningCalendarMonth) {
    grid.dataset.month = listeningCalendarMonth;
    const cells = document.createDocumentFragment();
    const firstDay = new Date(`${listeningCalendarMonth}-01T12:00:00`);
    const offset = (firstDay.getDay() + 6) % 7;
    const lastDay = new Date(firstDay);
    lastDay.setMonth(lastDay.getMonth() + 1, 0);
    const days = lastDay.getDate();
    const slots = Math.ceil((offset + days) / 7) * 7;
    for (let index = 0; index < slots; index += 1) {
      const day = index - offset + 1;
      if (day < 1 || day > days) {
        const blank = document.createElement("span");
        blank.setAttribute("aria-hidden", "true");
        cells.append(blank);
        continue;
      }
      const button = document.createElement("button");
      button.className = "listening-calendar-day";
      button.dataset.listeningDate = `${listeningCalendarMonth}-${String(day).padStart(2, "0")}`;
      button.innerHTML = `<span>${day}</span><small></small>`;
      button.addEventListener("click", () => {
        listeningSelectedDate = button.dataset.listeningDate;
        renderListeningCalendar();
      });
      cells.append(button);
    }
    grid.replaceChildren(cells);
  }
  for (const button of grid.querySelectorAll("[data-listening-date]")) {
    const key = button.dataset.listeningDate;
    const milliseconds = listeningDailyMs[key] || 0;
    const formatted = compactListeningTime(milliseconds);
    const label = button.querySelector("small");
    if (label.textContent !== formatted) label.textContent = formatted;
    button.classList.toggle("has-listening", milliseconds > 0);
    button.classList.toggle("selected", key === listeningSelectedDate);
    button.setAttribute("aria-pressed", String(key === listeningSelectedDate));
    if (key === today) button.setAttribute("aria-current", "date");
    else button.removeAttribute("aria-current");
    button.disabled = key > today;
    button.setAttribute("aria-label", `${key}，听歌 ${formatListeningTime(milliseconds)}`);
  }
  const monthLabel = `${year}年${String(month).padStart(2, "0")}月`;
  document.querySelector("#listening-calendar-month-label").textContent = monthLabel;
  document.querySelector("#listening-calendar-month").setAttribute("aria-label", `选择统计月份，当前 ${monthLabel}`);
  document.querySelector("#listening-calendar-previous").disabled = listeningCalendarMonth === "0001-01";
  document.querySelector("#listening-calendar-next").disabled = listeningCalendarMonth >= today.slice(0, 7);
  document.querySelector("#listening-day-label").textContent = listeningSelectedDate === today ? "今日" : `${Number(listeningSelectedDate.slice(5, 7))} 月 ${Number(listeningSelectedDate.slice(8))} 日`;
  document.querySelector("#listening-month-label").textContent = listeningCalendarMonth === today.slice(0, 7) ? "本月" : `${month} 月`;
  document.querySelector("#listening-year-label").textContent = String(year) === today.slice(0, 4) ? "今年" : `${year} 年`;
  for (const [id, milliseconds] of [
    ["listening-day-time", listeningDailyMs[listeningSelectedDate] || 0],
    ["listening-month-time", monthMilliseconds],
    ["listening-year-time", yearMilliseconds]
  ]) {
    const label = document.getElementById(id);
    const formatted = formatListeningTime(milliseconds);
    if (label.textContent !== formatted) label.textContent = formatted;
  }
}

function accumulateListeningTime() {
  if (listeningPosition === null) return;
  const position = audio.currentTime;
  // The media clock stops during buffering and sleep. Seeking never counts as
  // listening, while replaying a section counts again after playback resumes.
  const previousMinute = Math.floor(listeningTimeMs / 60000);
  if (!audio.seeking && position > listeningPosition && listeningPlaybackRate > 0) {
    recordListeningTime((position - listeningPosition) * 1000 / listeningPlaybackRate);
  }
  listeningPosition = position;
  listeningPlaybackRate = audio.playbackRate;
  updateListeningTimeDisplay();
  if (Math.floor(listeningTimeMs / 60000) !== previousMinute) storeListeningDays(listeningDailyMs);
}

function seekPlaybackTo(seconds) {
  accumulateListeningTime();
  audio.currentTime = seconds;
}

function startListeningTime() {
  if (audio.paused || audio.ended || audio.seeking || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
  accumulateListeningTime();
  listeningPosition = audio.currentTime;
  listeningPlaybackRate = audio.playbackRate;
}

function stopListeningTime() {
  accumulateListeningTime();
  listeningPosition = null;
  persistListeningTime();
}

function resetListeningTime() {
  accumulateListeningTime();
  if (!storeListeningDays({})) return false;
  listeningTimeMs = 0;
  listeningDailyMs = {};
  listeningFractionalMs = 0;
  if (listeningPosition !== null) listeningPosition = audio.currentTime;
  updateListeningTimeDisplay();
  return true;
}

function playbackFadeValue() {
  if (!playbackFadeEnvelope) return outputFadeGain?.gain.value ?? 1;
  const { from, to, startedAt, duration } = playbackFadeEnvelope;
  const progress = duration ? Math.max(0, Math.min(1, (outputAudioContext.currentTime - startedAt) / duration)) : 1;
  return from + (to - from) * progress;
}

function setPlaybackFadeTarget(value, duration = 0) {
  if (!outputFadeGain) return;
  const now = outputAudioContext.currentTime;
  const from = playbackFadeValue();
  const gain = outputFadeGain.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(from, now);
  if (duration > 0) gain.linearRampToValueAtTime(value, now + duration);
  else gain.setValueAtTime(value, now);
  playbackFadeEnvelope = { from, to: value, startedAt: now, duration };
}

function resetPlaybackFade(value = 1) {
  clearTimeout(playbackFadePauseTimer);
  playbackFadePauseTimer = null;
  playbackPausePending = false;
  setPlaybackFadeTarget(value);
}

function resumePlayback() {
  ensureAudioProcessing();
  if (playbackPausePending) {
    clearTimeout(playbackFadePauseTimer);
    playbackFadePauseTimer = null;
    playbackPausePending = false;
    setPlaybackFadeTarget(1, playbackFadeEnabled ? .24 : 0);
    updatePlayButtonState(true);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  } else if (audio.paused) {
    resetPlaybackFade(playbackFadeEnabled ? 0 : 1);
  }
  return audio.play();
}

function pausePlayback() {
  if (audio.paused || playbackPausePending) return;
  if (!playbackFadeEnabled || !outputFadeGain || outputAudioContext.state !== "running" || audio.ended) {
    resetPlaybackFade();
    audio.pause();
    return;
  }
  playbackPausePending = true;
  setPlaybackFadeTarget(0, .24);
  updatePlayButtonState(false);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  playbackFadePauseTimer = setTimeout(() => {
    if (!playbackPausePending) return;
    audio.pause();
    resetPlaybackFade();
  }, 240);
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
  ensureAudioProcessing();
  if (!preserveQueue) playbackFailedIds.clear();
  const generation = ++playbackGeneration;
  if (!preserveQueue && currentView !== "now") {
    playbackQueueIds = visibleTracks().map((track) => track.id);
  }
  if (!playbackQueueIds.length) playbackQueueIds = [tracks[index].id];
  const track = tracks[index];
  window.medo.updateLyricsWindow({ noLyrics: false, playing: true });
  const resolvedSource = await window.medo.resolveMediaSource(track.path).catch(() => null);
  if (generation !== playbackGeneration) return;
  index = tracks.findIndex((candidate) => candidate.id === track.id);
  if (index < 0) return;
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
  resetPlaybackFade();
  stopListeningTime();
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
  resumePlayback().then(() => {
    if (generation !== playbackGeneration) return;
    playbackFailedIds.delete(track.id);
  }).catch((error) => {
    if (generation !== playbackGeneration || error?.name === "AbortError") return;
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
  } else if (audio.paused || playbackPausePending) {
    const generation = playbackGeneration;
    const track = tracks[currentIndex];
    resumePlayback().catch((error) => {
      if (generation === playbackGeneration && error?.name !== "AbortError") recoverPlaybackFailure(track);
    });
  } else {
    pausePlayback();
  }
}

function clearCurrentPlayback() {
  cancelPendingLyrics();
  playbackGeneration += 1;
  switchingPlaybackGeneration = 0;
  resetPlaybackFade();
  stopListeningTime();
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  currentIndex = -1;
  applyCoverTheme(missingArt);
  updateMiniCoverState();
  activeLyricIndex = -1;
  renderedLyricsState = null;
  clearTimeout(lyricInspectionRestoreTimer);
  lyricInspectionActive = false;
  lyricFollowAnimation?.cancel();
  lyricsStage.classList.remove("inspecting");
  renderLyricStatus(null);
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
      seekPlaybackTo(0);
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
    if (queue.length === 1) {
      return playTrack(tracks.findIndex((track) => track.id === queue[0].id), true, continuingPreviousNavigation);
    }
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

async function restorePlaybackState() {
  desiredVolume = Math.min(1, Math.max(0, Number(restoredPlaybackState.volume ?? .7)));
  volume.value = desiredVolume;
  updateVolumeDisplay();
  applyOutputVolume();
  audio.muted = Boolean(restoredPlaybackState.muted);
  updateMuteButton();
  const index = tracks.findIndex((track) => track.id === restoredPlaybackState.trackId);
  if (index < 0) return;
  const track = tracks[index];
  const generation = ++playbackGeneration;
  const source = await window.medo.resolveMediaSource(track.path).catch(() => null);
  if (!source || generation !== playbackGeneration) return;
  const restoredIndex = tracks.findIndex((candidate) => candidate.id === track.id);
  if (restoredIndex < 0) return;
  currentIndex = restoredIndex;
  track.url = source;
  audio.src = source;
  audio.load();
  audio.addEventListener("loadedmetadata", () => {
    if (generation !== playbackGeneration) return;
    seekPlaybackTo(Math.min(Number(restoredPlaybackState.currentTime) || 0, Math.max(0, audio.duration - .1)));
  }, { once: true });
  updateNowPlaying(track);
  loadMetadata(track).catch(() => {});
  ensureLyrics(track);
  audio.pause();
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
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
