// Shares renderer.js state, like the other renderer feature scripts.
const manualLyricDialog = document.querySelector("#lyric-search-dialog");
const manualLyricForm = document.querySelector("#lyric-search-form");
const manualLyricResults = document.querySelector("#lyric-search-results");
const manualLyricPreview = document.querySelector("#lyric-search-preview");
const manualLyricStatus = document.querySelector("#lyric-search-status");
const manualLyricApply = document.querySelector("#lyric-search-apply");
const manualLyricReset = document.querySelector("#lyric-search-reset");
const manualLyricSubmit = document.querySelector("#lyric-search-submit");
let manualLyricsTrackId = null;
let manualLyricsGeneration = 0;
let manualLyricsCandidateKey = null;
let manualLyricsPreviewResult = null;
let manualLyricsSelectionPending = false;

function closeManualLyricSearch() {
  manualLyricsGeneration++;
  manualLyricsTrackId = null;
  manualLyricsCandidateKey = null;
  manualLyricsPreviewResult = null;
  window.medo.cancelManualLyrics();
  if (manualLyricDialog.open) manualLyricDialog.close();
}

function openManualLyricSearch() {
  const track = tracks[currentIndex];
  if (!track) return;
  closeManualLyricSearch();
  manualLyricsTrackId = track.id;
  document.querySelector("#lyric-search-target").textContent = `为「${track.title || "当前歌曲"}」选择歌词`;
  document.querySelector("#lyric-search-title").value = track.title || "";
  document.querySelector("#lyric-search-artist").value = track.artist === "未知艺术家" ? "" : track.artist || "";
  const remembered = lyricsCache.get(track.id);
  document.querySelector("#lyric-search-provider").value = remembered?.manual ? remembered.source.split("-")[0] : "auto";
  manualLyricResults.replaceChildren();
  manualLyricPreview.textContent = "选择左侧结果预览歌词";
  document.querySelector("#lyric-preview-kind").textContent = "";
  manualLyricStatus.textContent = "输入歌名，搜索后选择结果预览";
  manualLyricApply.disabled = true;
  manualLyricReset.disabled = manualLyricsSelectionPending || !lyricsCache.get(track.id)?.manual;
  manualLyricSubmit.disabled = false;
  manualLyricSubmit.textContent = "搜索";
  manualLyricDialog.showModal();
  runManualLyricSearch({ initial: true });
}

const manualLyricProviderNames = { qq: "QQ 音乐", netease: "网易云音乐", lrclib: "LRCLIB" };

async function previewManualLyric(candidate, button) {
  const generation = ++manualLyricsGeneration;
  manualLyricsCandidateKey = candidate.key;
  manualLyricsPreviewResult = null;
  manualLyricApply.disabled = true;
  for (const item of manualLyricResults.children) item.setAttribute("aria-selected", String(item === button));
  manualLyricPreview.textContent = "正在获取歌词…";
  document.querySelector("#lyric-preview-kind").textContent = "";
  try {
    const result = await window.medo.previewLyricsCandidate(candidate.key);
    if (generation !== manualLyricsGeneration || !manualLyricDialog.open) return;
    if (result?.cancelled) return;
    if (result?.error || !result?.text) {
      manualLyricPreview.textContent = result?.error === "no-lyrics" ? "这条结果没有可用歌词，请选择其他版本" : "歌词获取失败，请重试或选择其他结果";
      return;
    }
    const parsed = parseLyrics(result.text, candidate.duration || tracks[currentIndex]?.duration);
    manualLyricPreview.textContent = parsed.lines.map(line => line.text).join("\n") || "这条结果没有可用歌词";
    document.querySelector("#lyric-preview-kind").textContent = ({word:"逐字歌词",mixed:"混合歌词",line:"逐行歌词",plain:"纯文本歌词"})[parsed.level] || "歌词";
    manualLyricsPreviewResult = parsed.lines.length ? result : null;
    manualLyricApply.disabled = manualLyricsSelectionPending || !manualLyricsPreviewResult;
  } catch {
    if (generation === manualLyricsGeneration) manualLyricPreview.textContent = "歌词获取失败，请重试";
  }
}

async function runManualLyricSearch({ initial = false } = {}) {
  const track = tracks[currentIndex];
  if (!track || track.id !== manualLyricsTrackId) return;
  const title = document.querySelector("#lyric-search-title").value.trim();
  if (!title) return;
  const generation = ++manualLyricsGeneration;
  manualLyricsCandidateKey = null;
  manualLyricsPreviewResult = null;
  manualLyricApply.disabled = true;
  manualLyricSubmit.disabled = true;
  manualLyricSubmit.textContent = "搜索中…";
  manualLyricResults.replaceChildren();
  manualLyricPreview.textContent = "选择左侧结果预览歌词";
  document.querySelector("#lyric-preview-kind").textContent = "";
  manualLyricStatus.textContent = "正在搜索网络歌词…";
  let preferredCandidate = null, preferredButton = null;
  const provider = document.querySelector("#lyric-search-provider").value;
  try {
    if (initial && (!track.metadataLoaded || !track.duration)) {
      const previousArtist = document.querySelector("#lyric-search-artist").value;
      await loadMetadata(track);
      if (generation !== manualLyricsGeneration || !manualLyricDialog.open) return;
      if (document.querySelector("#lyric-search-title").value.trim() === title) document.querySelector("#lyric-search-title").value = track.title || title;
      if (document.querySelector("#lyric-search-artist").value === previousArtist) document.querySelector("#lyric-search-artist").value = track.artist === "未知艺术家" ? "" : track.artist || "";
    }
    const result = await window.medo.searchLyricsCandidates({
      title: document.querySelector("#lyric-search-title").value.trim(),
      artist: document.querySelector("#lyric-search-artist").value.trim(),
      album: track.album || "", duration: track.duration || 0,
      provider, initial, filePath: track.path, requireWordTiming: wordLyricsEnabled });
    if (generation !== manualLyricsGeneration || !manualLyricDialog.open || result?.cancelled) return;
    const candidates = result?.candidates || [];
    const fragment = document.createDocumentFragment();
    for (const candidate of candidates) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "lyric-search-result";
      button.setAttribute("role", "option"); button.setAttribute("aria-selected", "false");
      const title = document.createElement("strong"), artist = document.createElement("span"), detail = document.createElement("span");
      title.textContent = candidate.title;
      artist.textContent = [candidate.artist, candidate.album].filter(Boolean).join(" · ") || "歌曲信息未提供";
      detail.textContent = [manualLyricProviderNames[candidate.provider], candidate.duration ? formatTime(candidate.duration) : ""].filter(Boolean).join(" · ");
      button.append(title, artist, detail);
      button.addEventListener("click", () => previewManualLyric(candidate, button));
      fragment.append(button);
      if (candidate.key === result.preferredKey) { preferredCandidate = candidate; preferredButton = button; }
    }
    manualLyricResults.append(fragment);
    const failed = (result?.failedSources || []).map(provider => manualLyricProviderNames[provider]);
    if (initial && result.provider && document.querySelector("#lyric-search-provider").value === provider) {
      document.querySelector("#lyric-search-provider").value = result.provider;
    }
    if (result.remembered) manualLyricReset.disabled = manualLyricsSelectionPending;
    manualLyricStatus.textContent = result.remembered
      ? `已记住 ${manualLyricProviderNames[result.provider]} 的歌词；可重新搜索或恢复自动匹配`
      : candidates.length
      ? `找到 ${candidates.length} 条结果，选择后可预览${failed.length ? `；${failed.join("、")}暂不可用` : ""}`
      : result?.error || failed.length ? "搜索失败或来源暂不可用，请稍后重试或切换来源" : "没有找到结果，请调整歌名、歌手或来源";
  } catch {
    if (generation === manualLyricsGeneration) manualLyricStatus.textContent = "搜索失败，请检查网络后重试";
  } finally {
    if (generation === manualLyricsGeneration && manualLyricDialog.open) { manualLyricSubmit.disabled = false; manualLyricSubmit.textContent = "搜索"; }
  }
  if (generation === manualLyricsGeneration && preferredCandidate) await previewManualLyric(preferredCandidate, preferredButton);
}

manualLyricForm.addEventListener("submit", event => { event.preventDefault(); runManualLyricSearch(); });

manualLyricApply.addEventListener("click", async () => {
  const track = tracks[currentIndex];
  if (!track || track.id !== manualLyricsTrackId || !manualLyricsPreviewResult || manualLyricApply.disabled || manualLyricsSelectionPending) return;
  manualLyricsSelectionPending = true;
  manualLyricApply.disabled = true;
  manualLyricReset.disabled = true;
  try {
    const result = await window.medo.applyLyricsCandidate({ filePath: track.path, key: manualLyricsCandidateKey });
    if (result?.error || !result?.text) {
      if (manualLyricDialog.open && manualLyricsTrackId === track.id) manualLyricStatus.textContent = "歌词保存失败，请重试";
      return;
    }
    lyricsCache.delete(track.id);
    if (tracks[currentIndex]?.id !== track.id) return;
    cancelPendingLyrics();
    storeTrackLyrics(track, result, parseLyrics(result.text, track.duration), wordLyricsEnabled);
    renderedLyricsState = null; activeLyricIndex = -1;
    sendLyricsWindowState({title:track.title,artist:track.artist,album:track.album,noLyrics:false,playing:!audio.paused});
    if (currentView === "player") renderLyrics(track);
    updateLyricsAtTime();
    showActionFeedback("已使用所选歌词，并为这首歌曲记住选择");
  } catch {
    if (manualLyricDialog.open && manualLyricsTrackId === track.id) manualLyricStatus.textContent = "歌词保存失败，请重试";
  } finally {
    manualLyricsSelectionPending = false;
    if (manualLyricDialog.open) {
      manualLyricApply.disabled = !manualLyricsPreviewResult;
      manualLyricReset.disabled = !lyricsCache.get(manualLyricsTrackId)?.manual;
    }
  }
});

manualLyricReset.addEventListener("click", async () => {
  const track = tracks[currentIndex];
  if (!track || track.id !== manualLyricsTrackId || manualLyricsSelectionPending) return;
  manualLyricsSelectionPending = true;
  manualLyricReset.disabled = true;
  manualLyricApply.disabled = true;
  try {
    const result = await window.medo.clearLyricsSelection(track.path);
    if (!result?.ok) throw new Error("selection-not-cleared");
    // A completed storage change belongs to the song, not the preview request.
    // Invalidate it even if the user previewed another result or changed songs.
    lyricsCache.delete(track.id);
    if (tracks[currentIndex]?.id !== track.id) return;
    cancelPendingLyrics();
    ensureLyrics(track);
    if (currentView === "player") renderLyrics(track);
    showActionFeedback("已恢复自动匹配歌词");
  } catch {
    if (manualLyricDialog.open && manualLyricsTrackId === track.id) manualLyricStatus.textContent = "恢复自动匹配失败，请重试";
  } finally {
    manualLyricsSelectionPending = false;
    if (manualLyricDialog.open) {
      manualLyricApply.disabled = !manualLyricsPreviewResult;
      manualLyricReset.disabled = !lyricsCache.get(manualLyricsTrackId)?.manual;
    }
  }
});

manualLyricResults.addEventListener("keydown", event => {
  if (!["ArrowDown","ArrowUp","Home","End"].includes(event.key)) return;
  const buttons = [...manualLyricResults.children];
  if (!buttons.length) return;
  event.preventDefault();
  const index = buttons.indexOf(document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
  buttons[next].focus(); buttons[next].click();
});
manualLyricDialog.addEventListener("keydown", event => event.stopPropagation());
manualLyricDialog.addEventListener("cancel", event => { event.preventDefault(); closeManualLyricSearch(); });
document.querySelector("#lyric-search-close").addEventListener("click", closeManualLyricSearch);
document.querySelector("#detail-search-lyrics").addEventListener("click", openManualLyricSearch);
