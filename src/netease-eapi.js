const crypto = require("node:crypto");
const { hasNativeWordTiming, lyricTimingQuality } = require("./lyrics-timing");
const { normalizeLyricOptions, scoreLyricCandidate, rankLyricCandidates, isUsableLyricText } = require("./lyrics-matching");

const EAPI_URL = "https://interface3.music.163.com/eapi/song/lyric/v1";
const EAPI_PATH = "/api/song/lyric/v1";
const EAPI_KEY = Buffer.from("e82ckenh8dichen8", "ascii");
const DELIMITER = "-36cd479b6b5-";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 Chrome/70.0 Mobile Safari/537.36";

function createNeteaseEapiRequest(songId, now = Date.now(), requestSuffix = crypto.randomInt(0, 1000)) {
  const header = {
    __csrf: "",
    appver: "8.0.0",
    buildver: String(Math.floor(now / 1000)),
    channel: "",
    deviceId: "",
    mobilename: "",
    resolution: "1920x1080",
    os: "android",
    osver: "",
    requestId: `${now}_${String(requestSuffix).padStart(4, "0")}`,
    versioncode: "140",
    MUSIC_U: ""
  };
  const data = {
    id: String(songId), cp: "false", lv: "0", kv: "0", tv: "0", rv: "0",
    yv: "0", ytv: "0", yrv: "0", csrf_token: "", header: JSON.stringify(header)
  };
  const json = JSON.stringify(data);
  const digest = crypto.createHash("md5").update(`nobody${EAPI_PATH}use${json}md5forencrypt`).digest("hex");
  const plaintext = `${EAPI_PATH}${DELIMITER}${json}${DELIMITER}${digest}`;
  const cipher = crypto.createCipheriv("aes-128-ecb", EAPI_KEY, null);
  cipher.setAutoPadding(true);
  const params = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("hex").toUpperCase();
  return {
    url: EAPI_URL,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://music.163.com/",
      "User-Agent": USER_AGENT,
      Cookie: Object.entries(header).map(([key, value]) => `${key}=${value}`).join("; ")
    },
    body: new URLSearchParams({ params }).toString()
  };
}

async function fetchNeteaseNewLyrics(songId, fetchImplementation = fetch) {
  const request = createNeteaseEapiRequest(songId);
  const response = await fetchImplementation(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) return null;
  return await response.json();
}

function rankNeteaseSongs(songs, options) {
  return (Array.isArray(songs) ? songs : []).map((song) => {
    const artistNames = (song.artists || song.ar || []).map((item) => String(item?.name || "").trim()).filter(Boolean);
    const candidate = { song, title: song.name, artists: artistNames, artist: artistNames.join(" / "),
      album: song.album?.name || song.al?.name, aliases: song.alias || song.alia || [],
      duration: Number(song.duration || song.dt || 0) / 1000 };
    return { ...candidate, score: scoreLyricCandidate(candidate, options) };
  }).sort((left, right) => right.score - left.score);
}

async function searchNeteaseSongs(options, fetchImplementation = fetch) {
  const { title, artist } = normalizeLyricOptions(options);
  if (!title) return [];
  const query = new URLSearchParams({
    s: `${title} ${artist}`.trim(), type: "1", offset: "0", total: "true", limit: "12"
  });
  const response = await fetchImplementation(`https://music.163.com/api/cloudsearch/pc?${query}`, {
    headers: { Referer: "https://music.163.com/", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) return [];
  const payload = await response.json();
  if (payload.code && payload.code !== 200) throw new Error("netease-search-unavailable");
  const songs = payload?.result?.songs;
  return Array.isArray(songs) ? songs : [];
}

async function fetchNeteaseLyricsOnce(options, fetchImplementation, onCandidate) {
  options = normalizeLyricOptions(options);
  const rankSongs = songs => rankLyricCandidates(rankNeteaseSongs(songs, options), options);
  let ranked = rankSongs(await searchNeteaseSongs(options, fetchImplementation));
  if (!ranked.length && options.artist) ranked = rankSongs(await searchNeteaseSongs({ ...options, artist: "" }, fetchImplementation));
  const requireWords = options.requireWordTiming || options.mode === "network";
  let fallback = null;
  let failure = null;
  for (const best of ranked.filter(item => item.song.id).slice(0, 4)) {
    let payload;
    try {
      payload = await fetchNeteaseNewLyrics(best.song.id, fetchImplementation);
      if (payload?.code && payload.code !== 200) throw new Error("netease-lyrics-unavailable");
    } catch (error) { failure = error; continue; }
    const wordTimed = hasNativeWordTiming(payload?.yrc?.lyric);
    const text = wordTimed ? payload.yrc.lyric : payload?.lrc?.lyric || "";
    if (!isUsableLyricText(text)) continue;
    const result = {
      text,
      source: wordTimed ? "netease-word" : "netease-line",
      confidence: Math.round(best.score * 100),
      match: { title: best.title, artist: best.artist, album: best.album || "", duration: best.duration }
    };
    onCandidate?.(result);
    if (lyricTimingQuality(text) >= (requireWords ? 2 : 1)) return result;
    if (lyricTimingQuality(text) > lyricTimingQuality(fallback?.text)) fallback = result;
  }
  if (!fallback && failure) throw failure;
  return fallback;
}

async function fetchNeteaseLyrics(options, fetchImplementation = fetch, onCandidate = null) {
  return fetchNeteaseLyricsOnce(options, fetchImplementation, onCandidate);
}

module.exports = {
  createNeteaseEapiRequest,
  fetchNeteaseNewLyrics,
  rankNeteaseSongs,
  searchNeteaseSongs,
  fetchNeteaseLyrics
};
