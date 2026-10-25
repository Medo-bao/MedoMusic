// Mixed-sync classification.
//
// The app models four lyric sync states like Lyricify's SyncTypes: plain,
// line, mixed and word. Credit/info rows do not change the synchronization
// level of the actual lyrics; estimated word intervals never count as native.
function hasNativeLineTiming(line) {
  return !line?.information && !line?.approximateWords && Array.isArray(line?.words) &&
    line.words.some(word => word.approximate !== true);
}

function lyricSyncLevel(lines = [], hasTimeline = false) {
  if (!hasTimeline) return "plain";
  const timed = lines.filter(line => !line.information);
  if (!timed.length) return "line";
  const worded = timed.filter(hasNativeLineTiming).length;
  if (worded === 0) return "line";
  if (worded === timed.length) return "word";
  return "mixed";
}

function hasWordLevelLines(lines = []) {
  return lines.some(hasNativeLineTiming);
}

const SYNC_API = { lyricSyncLevel, hasWordLevelLines, hasNativeLineTiming };
if (typeof module === "object" && module.exports) module.exports = SYNC_API;
if (typeof window !== "undefined") window.MedoLyricSync = SYNC_API;
