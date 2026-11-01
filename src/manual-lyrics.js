const fs = require("node:fs/promises");
const path = require("node:path");
const { searchQqSongs, fetchQrcBySongId, fetchLineLyricWithTranslation } = require("./qq-music");
const { searchNeteaseSongs, fetchNeteaseNewLyrics } = require("./netease-eapi");
const { withinDeadline } = require("./lyrics-search");
const { cleanLyricTag, scoreLyricCandidate, isUsableLyricText } = require("./lyrics-matching");
const { hasNativeWordTiming } = require("./lyrics-timing");

function manualRequest(task, signal, fetchImplementation, timeoutMs = 6500) {
  return withinDeadline(operationSignal => task((url, init = {}) => fetchImplementation(url, {
    ...init,
    signal: AbortSignal.any([operationSignal, AbortSignal.timeout(3500), ...(init.signal ? [init.signal] : [])])
  })), signal, timeoutMs);
}

async function searchManualLyrics(rawOptions, { signal, fetchImplementation = fetch } = {}) {
  const title = cleanLyricTag(rawOptions?.title), artist = cleanLyricTag(rawOptions?.artist);
  if (!title) return { candidates: [], failedSources: [] };
  const providers = ["qq", "netease", "lrclib"].includes(rawOptions.provider)
    ? [rawOptions.provider] : ["qq", "netease", "lrclib"];
  const searches = await Promise.all(providers.map(async provider => {
    try {
      const candidates = await manualRequest(async request => {
        if (provider === "qq") {
          const songs = await searchQqSongs(`${title} ${artist}`.trim(), request);
          return songs.map(song => ({
            provider, id: String(song.id || song.songid || song.mid || song.songmid || ""),
            songId: song.id || song.songid, mid: song.mid || song.songmid,
            title: song.name || song.title || song.songname || "",
            artist: (song.singer || []).map(singer => singer.name).filter(Boolean).join(" / "),
            album: song.album?.name || song.albumname || "", duration: Number(song.interval) || 0
          }));
        }
        if (provider === "netease") {
          const songs = await searchNeteaseSongs({ title, artist }, request);
          return songs.map(song => ({
            provider, id: String(song.id || ""), title: song.name || "",
            artist: (song.artists || song.ar || []).map(singer => singer.name).filter(Boolean).join(" / "),
            album: song.album?.name || song.al?.name || "", duration: Number(song.duration || song.dt || 0) / 1000
          }));
        }
        const query = new URLSearchParams({ track_name: title });
        if (artist) query.set("artist_name", artist);
        const response = await request(`https://lrclib.net/api/search?${query}`);
        if (!response.ok) throw new Error("lrclib-search-unavailable");
        const songs = await response.json();
        return (Array.isArray(songs) ? songs : []).filter(song => !song.instrumental &&
          isUsableLyricText(song.syncedLyrics || song.plainLyrics)).slice(0, 30).map(song => ({
            provider, id: String(song.id), title: song.trackName || "", artist: song.artistName || "",
            album: song.albumName || "", duration: Number(song.duration) || 0,
            text: song.syncedLyrics || song.plainLyrics
          }));
      }, signal, fetchImplementation);
      return { provider, candidates: candidates.filter(candidate => candidate.id && candidate.title).map(candidate => ({
        ...candidate, key: `${provider}:${candidate.id}`,
        score: scoreLyricCandidate(candidate, { title, artist })
      })) };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { provider, candidates: [], failed: true };
    }
  }));
  // Manual choices include recordings that automatic matching would reject.
  const unique = new Map(searches.flatMap(result => result.candidates).map(candidate => [candidate.key, candidate]));
  return {
    candidates: [...unique.values()].sort((left, right) => right.score - left.score),
    failedSources: searches.filter(result => result.failed).map(result => result.provider)
  };
}

async function readManualLyrics(candidate, { signal, fetchImplementation = fetch } = {}) {
  return manualRequest(async request => {
    let text = "", translation = null;
    if (candidate.provider === "qq") {
      try { text = await fetchQrcBySongId(candidate.songId, request) || ""; }
      catch (error) { if (signal?.aborted) throw error; }
      if (!isUsableLyricText(text)) {
        const line = await fetchLineLyricWithTranslation(candidate.mid, request);
        text = line?.lyric || ""; translation = line?.translation;
      }
    } else if (candidate.provider === "netease") {
      const payload = await fetchNeteaseNewLyrics(candidate.id, request);
      text = hasNativeWordTiming(payload?.yrc?.lyric) && isUsableLyricText(payload.yrc.lyric)
        ? payload.yrc.lyric : payload?.lrc?.lyric || "";
    } else if (candidate.provider === "lrclib") text = candidate.text;
    if (!isUsableLyricText(text)) return null;
    return {
      text, source: candidate.provider === "lrclib" ? "lrclib" : `${candidate.provider}-${hasNativeWordTiming(text) ? "word" : "line"}`,
      ...(Array.isArray(translation) ? { translation } : {}),
      match: { title: candidate.title, artist: candidate.artist, album: candidate.album, duration: candidate.duration }
    };
  }, signal, fetchImplementation, 10000);
}

function createLyricSelections(filename) {
  let selections, loading, writing = Promise.resolve();
  const load = async () => {
    if (selections) return selections;
    loading ||= fs.readFile(filename, "utf8").then(JSON.parse).catch(() => ({})).then(value => {
      selections = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      return selections;
    });
    return loading;
  };
  const keyFor = filePath => path.resolve(filePath).toLowerCase();
  const change = (filePath, value) => {
    const operation = writing.then(async () => {
      const current = await load(), key = keyFor(filePath);
      if (!value && !current[key]) return;
      const next = { ...current };
      if (value) next[key] = value; else delete next[key];
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, JSON.stringify(next), "utf8");
      selections = next;
    });
    writing = operation.catch(() => {});
    return operation;
  };
  return {
    async get(filePath) {
      const selected = (await load())[keyFor(filePath)];
      return isUsableLyricText(selected?.text) ? { ...selected, manual: true, retryAt: Number.MAX_SAFE_INTEGER } : null;
    },
    save: (filePath, value) => change(filePath, value),
    clear: filePath => change(filePath, null)
  };
}

module.exports = { searchManualLyrics, readManualLyrics, createLyricSelections };
