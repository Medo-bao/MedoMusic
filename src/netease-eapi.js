const crypto = require("node:crypto");
const { removeLiveQualifier } = require("./lyrics-source-priority");

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

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
}

function rankNeteaseSongs(songs, options) {
  const title = String(options?.title || "").trim();
  const artist = String(options?.artist || "").trim();
  const expectedDuration = Number(options?.duration) || 0;
  const normalizedTitle = normalize(title);
  const normalizedArtist = normalize(artist);
  return (Array.isArray(songs) ? songs : []).map((song) => {
    const artistNames = (song.artists || song.ar || []).map((item) => String(item?.name || "").trim()).filter(Boolean);
    const songArtists = artistNames.join(" ");
    const candidateTitle = normalize(song.name);
    const titleScore = candidateTitle === normalizedTitle ? 1 : candidateTitle.includes(normalizedTitle) ? .76 : 0;
    const normalizedArtists = artistNames.map(normalize);
    const exactArtist = !artist || normalizedArtists.includes(normalizedArtist);
    const partialArtist = !artist || normalizedArtists.some((name) => {
      if (!name || !normalizedArtist) return false;
      const contains = name.includes(normalizedArtist) || normalizedArtist.includes(name);
      const longer = Math.max(name.length, normalizedArtist.length);
      const shorter = Math.max(1, Math.min(name.length, normalizedArtist.length));
      return contains && longer <= shorter * 2;
    });
    const artistScore = !artist ? .5 : exactArtist ? 1 : partialArtist ? .68 : 0;
    const duration = Number(song.duration || song.dt || 0) / 1000;
    const durationDelta = expectedDuration && duration ? Math.abs(duration - expectedDuration) : 0;
    const durationScore = !expectedDuration || !duration ? .5 : Math.max(0, 1 - durationDelta / 12);
    const plausibleMatch = titleScore > 0 && (exactArtist || partialArtist) &&
      (!expectedDuration || !duration || durationDelta <= (exactArtist ? 24 : 16));
    return {
      song,
      artist: songArtists,
      score: plausibleMatch ? titleScore * .58 + artistScore * .27 + durationScore * .15 : 0
    };
  }).sort((left, right) => right.score - left.score);
}

async function searchNeteaseSongs(options, fetchImplementation = fetch) {
  const title = String(options?.title || "").trim();
  const artist = String(options?.artist || "").trim();
  if (!title) return [];
  const query = new URLSearchParams({
    s: `${title} ${artist}`.trim(), type: "1", offset: "0", total: "true", limit: "12"
  });
  const response = await fetchImplementation(`https://music.163.com/api/cloudsearch/pc?${query}`, {
    headers: { Referer: "https://music.163.com/", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) return [];
  return (await response.json())?.result?.songs || [];
}

async function fetchNeteaseLyricsOnce(options, fetchImplementation) {
  const ranked = rankNeteaseSongs(await searchNeteaseSongs(options, fetchImplementation), options);
  const best = ranked[0];
  if (!best || best.score < .62 || !best.song.id) return null;
  const payload = await fetchNeteaseNewLyrics(best.song.id, fetchImplementation);
  const text = payload?.yrc?.lyric || payload?.lrc?.lyric || "";
  if (!text) return null;
  return {
    text,
    source: payload?.yrc?.lyric ? "netease-word" : "netease-line",
    confidence: Math.round(best.score * 100),
    match: { title: best.song.name, artist: best.artist }
  };
}

async function fetchNeteaseLyrics(options, fetchImplementation = fetch) {
  const result = await fetchNeteaseLyricsOnce(options, fetchImplementation);
  if (result) return result;
  const retryTitle = removeLiveQualifier(options?.title);
  if (!retryTitle) return null;
  return fetchNeteaseLyricsOnce({ ...options, title: retryTitle }, fetchImplementation);
}

module.exports = {
  createNeteaseEapiRequest,
  fetchNeteaseNewLyrics,
  rankNeteaseSongs,
  searchNeteaseSongs,
  fetchNeteaseLyrics
};
