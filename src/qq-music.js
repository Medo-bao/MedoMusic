const { decryptQrc } = require("qrc-decoder");
const { hasNativeWordTiming } = require("./lyrics-timing");
const { removeLiveQualifier } = require("./lyrics-source-priority");

const HEADERS = {
  Referer: "https://c.y.qq.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MedoMusic"
};

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function decodeQqLyricJsonp(raw, callback) {
  const text = String(raw || "").trim();
  const prefix = `${callback}(`;
  if (!text.startsWith(prefix) || !text.endsWith(")")) return null;
  const payload = JSON.parse(text.slice(prefix.length, -1));
  if (payload.code !== 0 || !payload.lyric) return null;
  return Buffer.from(payload.lyric, "base64").toString("utf8");
}

function extractQrcLyric(raw) {
  const response = String(raw || "").replace(/^\uFEFF/, "");
  const encrypted = response.match(/<content\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/content>/i)?.[1]?.trim();
  if (!encrypted) return null;
  try {
    const decrypted = decryptQrc(encrypted);
    const lyricContent = decrypted.match(/\bLyricContent="([\s\S]*?)"\s*\/?\s*>/i)?.[1];
    const text = lyricContent ? decodeXmlEntities(lyricContent) : decrypted;
    return hasNativeWordTiming(text) ? text : null;
  } catch {
    return null;
  }
}

function searchSongsFromPayload(payload) {
  return payload?.["music.search.SearchCgiService"]?.data?.body?.song?.list ||
    payload?.req_1?.data?.body?.song?.list || [];
}

async function searchQqSongs(query, fetchImplementation) {
  const searchBody = {
    comm: { ct: "19", cv: "1859", uin: "0" },
    "music.search.SearchCgiService": {
      method: "DoSearchForQQMusicDesktop",
      module: "music.search.SearchCgiService",
      param: { num_per_page: 8, page_num: 1, query, search_type: 0 }
    }
  };
  const response = await fetchImplementation("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(searchBody),
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) return [];
  return searchSongsFromPayload(await response.json());
}

async function fetchQrcBySongId(songId, fetchImplementation) {
  if (!songId) return null;
  const body = new URLSearchParams({
    version: "15",
    miniversion: "82",
    lrctype: "4",
    musicid: String(songId)
  });
  const response = await fetchImplementation("https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg", {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(6500)
  });
  return response.ok ? extractQrcLyric(await response.text()) : null;
}

async function fetchLineLyric(songMid, fetchImplementation) {
  if (!songMid) return null;
  const callback = "MusicJsonCallback_lrc";
  const query = new URLSearchParams({
    callback, pcachetime: String(Date.now()), songmid: songMid,
    g_tk: "5381", jsonpCallback: callback, loginUin: "0", hostUin: "0",
    format: "jsonp", inCharset: "utf8", outCharset: "utf8", notice: "0",
    platform: "yqq", needNewCode: "0"
  });
  const response = await fetchImplementation(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${query}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(6500)
  });
  return response.ok ? decodeQqLyricJsonp(await response.text(), callback) : null;
}

async function fetchQqMusicLyricsOnce(options, fetchImplementation) {
  const title = String(options?.title || "").trim();
  const artist = String(options?.artist || "").trim();
  const expectedDuration = Number(options?.duration) || 0;
  if (!title) return null;
  const songs = await searchQqSongs(`${title} ${artist}`.trim(), fetchImplementation);
  const ranked = songs.map((song) => {
    const songArtists = (song.singer || []).map((item) => item.name).join(" ");
    const normalizedTitle = normalize(title);
    const candidateTitle = normalize(song.name || song.title || song.songname);
    const titleScore = candidateTitle === normalizedTitle ? 1 : candidateTitle.includes(normalizedTitle) ? .76 : 0;
    const artistScore = !artist ? .5 : normalize(songArtists).includes(normalize(artist)) ? 1 : 0;
    const duration = Number(song.interval) || 0;
    const durationScore = !expectedDuration ? .5 : Math.max(0, 1 - Math.abs(duration - expectedDuration) / 12);
    return { song, artist: songArtists, score: titleScore * .58 + artistScore * .27 + durationScore * .15 };
  }).sort((left, right) => right.score - left.score);
  const requireWords = options.requireWordTiming || options.mode === "network";
  let fallback = null;
  for (const best of ranked.filter(item => item.score >= .62)) {
    let qrcText = null;
    let text = null;
    try { qrcText = await fetchQrcBySongId(best.song.id || best.song.songid, fetchImplementation); } catch {}
    try { text = qrcText || await fetchLineLyric(best.song.mid || best.song.songmid, fetchImplementation); } catch {}
    if (!text) continue;
    const wordTimed = hasNativeWordTiming(text);
    const result = {
      text,
      source: wordTimed ? "qq-word" : "qq-line",
      confidence: Math.round(best.score * 100),
      match: { title: best.song.name || best.song.title || best.song.songname, artist: best.artist }
    };
    if (!requireWords || wordTimed) return result;
    fallback ||= result;
  }
  return fallback;
}

async function fetchQqMusicLyrics(options, fetchImplementation = fetch) {
  const result = await fetchQqMusicLyricsOnce(options, fetchImplementation).catch(() => null);
  if (result && (!(options.requireWordTiming || options.mode === "network") || hasNativeWordTiming(result.text))) return result;
  const retryTitle = removeLiveQualifier(options?.title);
  if (!retryTitle) return result;
  try {
    const retry = await fetchQqMusicLyricsOnce({ ...options, title: retryTitle }, fetchImplementation);
    return retry && hasNativeWordTiming(retry.text) ? retry : result || retry;
  } catch { return result; }
}

module.exports = {
  decodeQqLyricJsonp,
  extractQrcLyric,
  searchSongsFromPayload,
  fetchQqMusicLyrics
};
