const { decryptQrc } = require("qrc-decoder");
const { hasNativeWordTiming } = require("./lyrics-timing");
const { normalizeLyricOptions, rankLyricCandidates, isUsableLyricText } = require("./lyrics-matching");

const HEADERS = {
  Referer: "https://c.y.qq.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MedoMusic"
};

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
  const text = String(raw || "").trim().replace(/;\s*$/u, "");
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
  const payload = await response.json();
  if (payload.code || payload["music.search.SearchCgiService"]?.code || payload.req_1?.code) throw new Error("qq-search-unavailable");
  const songs = searchSongsFromPayload(payload);
  return Array.isArray(songs) ? songs : [];
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
  options = normalizeLyricOptions(options);
  const { title, artist } = options;
  if (!title) return null;
  const rankSongs = songs => rankLyricCandidates(songs.map(song => ({
    song, title: song.name || song.title || song.songname,
    artists: (song.singer || []).map(item => item.name),
    album: song.album?.name || song.albumname,
    duration: Number(song.interval) || 0
  })), options);
  let ranked = rankSongs(await searchQqSongs(`${title} ${artist}`.trim(), fetchImplementation));
  if (!ranked.length && artist) ranked = rankSongs(await searchQqSongs(title, fetchImplementation));
  const requireWords = options.requireWordTiming || options.mode === "network";
  let fallback = null;
  let failure = null;
  for (const best of ranked.slice(0, 4)) {
    let qrcText = null;
    let text = null;
    try { qrcText = await fetchQrcBySongId(best.song.id || best.song.songid, fetchImplementation); } catch (error) { failure = error; }
    try { text = qrcText || await fetchLineLyric(best.song.mid || best.song.songmid, fetchImplementation); } catch (error) { failure = error; }
    if (!isUsableLyricText(text)) continue;
    const wordTimed = hasNativeWordTiming(text);
    const result = {
      text,
      source: wordTimed ? "qq-word" : "qq-line",
      confidence: Math.round(best.score * 100),
      match: { title: best.title, artist: best.artists.join(" / "), album: best.album || "", duration: best.duration }
    };
    if (!requireWords || wordTimed) return result;
    fallback ||= result;
  }
  if (!fallback && failure) throw failure;
  return fallback;
}

async function fetchQqMusicLyrics(options, fetchImplementation = fetch) {
  return fetchQqMusicLyricsOnce(options, fetchImplementation);
}

module.exports = {
  decodeQqLyricJsonp,
  extractQrcLyric,
  searchSongsFromPayload,
  fetchQqMusicLyrics
};
