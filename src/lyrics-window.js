const island = document.querySelector(".lyrics-island");
const current = document.querySelector("#desktop-lyric");
const next = document.querySelector("#desktop-next-lyric");
let lyricSize = Math.min(64, Math.max(16, Number(localStorage.getItem("medo.desktopLyricSize")) || 34));
if (lyricSize === 28) lyricSize = 34;
let dragPointerId = null;
let lastScreenX = 0;
let lastScreenY = 0;
let activeWords = [];
let lyricLayoutFrame = null;
let lastRequestedHeight = 0;
let lastRequestedWidth = 0;

function measureTextWidth(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  return Math.ceil(range.getBoundingClientRect().width);
}

function updateLyricLayout() {
  cancelAnimationFrame(lyricLayoutFrame);
  lyricLayoutFrame = requestAnimationFrame(() => {
    const islandStyle = getComputedStyle(island);
    const verticalPadding = parseFloat(islandStyle.paddingTop) + parseFloat(islandStyle.paddingBottom);
    const horizontalPadding = parseFloat(islandStyle.paddingLeft) + parseFloat(islandStyle.paddingRight);
    const currentHeight = Math.ceil(current.getBoundingClientRect().height);
    const nextHeight = Math.ceil(next.getBoundingClientRect().height);
    const preferredGap = Math.max(6, Math.min(14, Math.round(lyricSize * .18)));
    const availableGap = island.clientHeight - verticalPadding - currentHeight - nextHeight;
    const gap = Math.max(3, Math.min(preferredGap, availableGap));
    island.style.setProperty("--desktop-lyric-gap", `${gap}px`);
    const requiredHeight = currentHeight + nextHeight + preferredGap + verticalPadding + 4;
    if (requiredHeight > window.innerHeight + 1 && requiredHeight !== lastRequestedHeight) {
      lastRequestedHeight = requiredHeight;
      window.medo.fitLyricsWindowHeight(requiredHeight);
    }
    const requiredWidth = Math.max(680, Math.max(measureTextWidth(current), measureTextWidth(next)) + horizontalPadding + 8);
    if (requiredWidth !== lastRequestedWidth) {
      lastRequestedWidth = requiredWidth;
      window.medo.fitLyricsWindowWidth(requiredWidth);
    }
  });
}

function applyLyricSize() {
  document.documentElement.style.setProperty("--desktop-lyric-size", `${lyricSize}px`);
  document.documentElement.style.setProperty("--desktop-next-size", `${Math.max(13, Math.round(lyricSize * .58))}px`);
  localStorage.setItem("medo.desktopLyricSize", String(lyricSize));
  updateLyricLayout();
}

function animateLyricChange() {
  current.getAnimations().forEach((animation) => animation.cancel());
  next.getAnimations().forEach((animation) => animation.cancel());
  current.animate(
    [
      { opacity: .08, filter: "blur(4px)", transform: "translateY(13px) scale(.985)" },
      { opacity: 1, filter: "blur(0)", transform: "translateY(0) scale(1)" }
    ],
    { duration: 380, easing: "cubic-bezier(.23,1,.32,1)" }
  );
  next.animate(
    [
      { opacity: 0, filter: "blur(2px)", transform: "translateY(9px)" },
      { opacity: .66, filter: "blur(0)", transform: "translateY(0)" }
    ],
    { duration: 460, easing: "cubic-bezier(.23,1,.32,1)" }
  );
}

function renderKaraokeText(element, text, enabled) {
  element.replaceChildren();
  if (!enabled) {
    element.textContent = text;
    return;
  }
  const base = document.createElement("span");
  base.className = "desktop-karaoke-base";
  base.textContent = text;
  const fill = document.createElement("span");
  fill.className = "desktop-karaoke-fill";
  fill.textContent = text;
  element.append(base, fill);
}

function updateWordProgress(position) {
  const time = Number(position) || 0;
  if (!activeWords.length) return;
  const totalCharacters = Math.max(1, activeWords.reduce((total, word) => total + [...word.text].length, 0));
  let completedCharacters = 0;
  for (let index = 0; index < activeWords.length; index += 1) {
    const word = activeWords[index];
    const start = Number(word.start) || 0;
    const storedEnd = Number(word.end) || 0;
    const nextStart = Number(activeWords[index + 1]?.start);
    const end = storedEnd > start ? storedEnd : Number.isFinite(nextStart) ? nextStart : start + .48;
    const progress = Math.max(0, Math.min(1, (time + .04 - start) / Math.max(.08, end - start)));
    const length = [...word.text].length;
    if (progress >= 1) completedCharacters += length;
    else {
      completedCharacters += length * progress;
      break;
    }
  }
  const value = `${Math.max(0, Math.min(100, completedCharacters / totalCharacters * 100))}%`;
  current.style.setProperty("--line-progress", value);
  if (next.classList.contains("translation-karaoke")) next.style.setProperty("--line-progress", value);
}

applyLyricSize();
window.medo.onLyricsWindowLine((payload = {}) => {
  document.documentElement.style.setProperty("--lyric-primary", payload.primary || "#2864ff");
  document.documentElement.style.setProperty("--lyric-secondary", payload.secondary || "#d934ff");
  if (payload.colorsOnly) return;
  const nextCurrent = payload.current || payload.title || "暂无歌词";
  const nextLine = payload.currentTranslation
    ? payload.currentTranslation
    : payload.next || [payload.artist, payload.album].filter(Boolean).join(" · ") || "MedoMusic";
  const incomingWords = Array.isArray(payload.words) ? payload.words : [];
  const wordMode = incomingWords.length ? "word" : "line";
  const lineChanged = current.dataset.text !== nextCurrent || next.textContent !== nextLine || current.dataset.wordMode !== wordMode;
  if (lineChanged) {
    current.dataset.text = nextCurrent;
    current.dataset.wordMode = wordMode;
    activeWords = incomingWords;
    renderKaraokeText(current, nextCurrent, activeWords.length > 0);
    const translationKaraoke = Boolean(payload.currentTranslation && activeWords.length);
    next.classList.toggle("translation-karaoke", translationKaraoke);
    renderKaraokeText(next, nextLine, translationKaraoke);
    updateLyricLayout();
    animateLyricChange();
  }
  updateWordProgress(payload.position);
});

window.medo.onLyricsWindowSize((size) => {
  lyricSize = Math.min(64, Math.max(16, Number(size) || 34));
  applyLyricSize();
});
window.medo.onLyricsWindowLockState((locked) => {
  document.body.classList.toggle("locked", locked);
  if (!locked) document.body.classList.remove("pointer-inside");
});
window.medo.onLyricsWindowPointerInside((inside) => {
  document.body.classList.toggle("pointer-inside", inside && document.body.classList.contains("locked"));
});

new ResizeObserver(updateLyricLayout).observe(island);
document.fonts?.ready.then(updateLyricLayout);

island.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || document.body.classList.contains("locked")) return;
  dragPointerId = event.pointerId;
  lastScreenX = event.screenX;
  lastScreenY = event.screenY;
  island.setPointerCapture(event.pointerId);
  document.body.classList.add("dragging");
});
island.addEventListener("pointermove", (event) => {
  if (event.pointerId !== dragPointerId) return;
  const x = event.screenX - lastScreenX;
  const y = event.screenY - lastScreenY;
  lastScreenX = event.screenX;
  lastScreenY = event.screenY;
  if (x || y) window.medo.moveLyricsWindow({ x, y });
});
["pointerup", "pointercancel"].forEach((eventName) => {
  island.addEventListener(eventName, (event) => {
    if (event.pointerId !== dragPointerId) return;
    dragPointerId = null;
    document.body.classList.remove("dragging");
  });
});
