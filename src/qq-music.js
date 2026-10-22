const { decryptQrc } = require("qrc-decoder");
const { hasNativeWordTiming, lyricTimingQuality } = require("./lyrics-timing");
const { findNativeWordCandidate } = require("./lyrics-candidates");
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

// fcg_query_lyric_new returns both `lyric` and `trans` as base64 LRC. The
// translation is line-for-line aligned with the original, so both are decoded
// from the same payload and returned together.
function decodeQqLyricJsonp(raw, callback) {
  const text = String(raw || "").trim().replace(/;\s*$/u, "");
  const prefix = `${callback}(`;
  if (!text.startsWith(prefix) || !text.endsWith(")")) return null;
  const payload = JSON.parse(text.slice(prefix.length, -1));
  if (payload.code !== 0 || !payload.lyric) return null;
  const lyric = Buffer.from(payload.lyric, "base64").toString("utf8");
  const translation = typeof payload.trans === "string" && payload.trans
    ? Buffer.from(payload.trans, "base64").toString("utf8")
    : "";
  return { lyric, translation };
}

// Provider result shape expects a plain LRC string; callers that want the
// translation use decodeQqLyricPayload instead.
function decodeQqLyricText(raw, callback) {
  const decoded = decodeQqLyricJsonp(raw, callback);
  return decoded ? decoded.lyric : null;
}

// Pair each original line with its translated counterpart by timestamp. QQ
// emits both files line-aligned, but blank translation lines are normal, so the
// match is positional-with-timestamp-check rather than a strict index walk.
function alignQqTranslation(lyricText, translationText) {
  if (!translationText) return null;
  const lines = [];
  for (const rawLine of String(translationText).split(/\r\n?|\n/)) {
    const stamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const content = rawLine.replace(/\[[^\]]*\]/g, "").trim();
    for (const stamp of stamps) {
      const fraction = stamp[3] ? Number(stamp[3]) / (10 ** stamp[3].length) : 0;
      lines.push({ start: Number(stamp[1]) * 60 + Number(stamp[2]) + fraction, text: content });
    }
  }
  if (!lines.length) return null;
  const originalStarts = [];
  for (const rawLine of String(lyricText).split(/\r\n?|\n/)) {
    const stamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    for (const stamp of stamps) {
      const fraction = stamp[3] ? Number(stamp[3]) / (10 ** stamp[3].length) : 0;
      originalStarts.push(Number(stamp[1]) * 60 + Number(stamp[2]) + fraction);
    }
  }
  return originalStarts.map(start => {
    let best = null;
    for (const candidate of lines) {
      const distance = Math.abs(candidate.start - start);
      if (distance <= .35 && (!best || distance < best.distance)) best = { ...candidate, distance };
    }
    return best?.text || "";
  });
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
      // Short clips and covers can push the matching recording past the first
      // eight results; rank a wider page before limiting lyric downloads.
      param: { num_per_page: 30, page_num: 1, query, search_type: 0 }
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
  return response.ok ? decodeQqLyricText(await response.text(), callback) : null;
}

// Like fetchLineLyric but keeps the payload so the translation can be aligned
// against the original timestamps.
async function fetchLineLyricWithTranslation(songMid, fetchImplementation) {
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
  if (!response.ok) return null;
  const decoded = decodeQqLyricJsonp(await response.text(), callback);
  if (!decoded) return null;
  return { lyric: decoded.lyric, translation: alignQqTranslation(decoded.lyric, decoded.translation) };
}

async function fetchQqMusicLyricsOnce(options, fetchImplementation, onCandidate, onFailure) {
  options = normalizeLyricOptions(options);
  const { title, artist } = options;
  if (!title) return null;
  const rankSongs = songs => rankLyricCandidates(songs.filter(song =>
    song.id || song.songid || song.mid || song.songmid).map(song => ({
    song, title: song.name || song.title || song.songname,
    artists: (song.singer || []).map(item => item.name),
    album: song.album?.name || song.albumname,
    duration: Number(song.interval) || 0
  })), options);
  const requireWords = options.requireWordTiming || options.mode === "network";
  let fallback = null;
  let failure = null;
  const recordFailure = error => { failure = error; onFailure?.(error); };
  const checked = new Set();
  const makeResult = (best, text, linePayload = null) => {
    const result = {
      text,
      source: hasNativeWordTiming(text) ? "qq-word" : "qq-line",
      confidence: Math.round(best.score * 100),
      match: { title: best.title, artist: best.artists.join(" / "), album: best.album || "", duration: best.duration }
    };
    if (Array.isArray(linePayload?.translation) && linePayload.translation.some(Boolean)) {
      result.translation = linePayload.translation;
    }
    return result;
  };
  for (const [pass, queryArtist] of (artist ? [artist, ""] : [""]).entries()) {
    // A ranked recording can have no usable lyrics. In that case the title-only
    // query can expose another release, still matched against the original tags.
    if (pass && lyricTimingQuality(fallback?.text) >= 1) break;
    let ranked;
    try { ranked = rankSongs(await searchQqSongs(`${title} ${queryArtist}`.trim(), fetchImplementation)); }
    catch (error) {
      if (!pass) throw error;
      recordFailure(error);
      break;
    }
    const candidates = [];
    for (const best of ranked) {
      const id = best.song.id || best.song.songid || best.song.mid || best.song.songmid;
      if (!id || checked.has(String(id))) continue;
      checked.add(String(id));
      candidates.push(best);
      if (candidates.length === 4) break;
    }
    const offset = pass * 4;
    // A slow ordinary lyric download must not consume the word-search window
    // before later matching recordings have had their QRC checked.
    if (requireWords) {
      const native = await findNativeWordCandidate(candidates, async (best, signal) => {
        const fetchCandidate = (url, init) => fetchImplementation(url, { ...init,
          signal: AbortSignal.any([init.signal, signal]) });
        const text = await fetchQrcBySongId(best.song.id || best.song.songid, fetchCandidate);
        return isUsableLyricText(text) ? makeResult(best, text) : null;
      }, (found, index) => onCandidate?.(found, offset + index), recordFailure);
      if (native) return native;
    }
    for (const [index, best] of candidates.entries()) {
      let qrcText = null;
      let linePayload = null;
      if (!requireWords) {
        try { qrcText = await fetchQrcBySongId(best.song.id || best.song.songid, fetchImplementation); } catch (error) { recordFailure(error); }
      }
      if (!isUsableLyricText(qrcText)) qrcText = null;
      try { linePayload = qrcText ? null : await fetchLineLyricWithTranslation(best.song.mid || best.song.songmid, fetchImplementation); } catch (error) { recordFailure(error); }
      const text = qrcText || linePayload?.lyric || null;
      if (!isUsableLyricText(text)) continue;
      const result = makeResult(best, text, linePayload);
      onCandidate?.(result, offset + index);
      if (lyricTimingQuality(text) >= (requireWords ? 2 : 1)) return result;
      if (lyricTimingQuality(text) > lyricTimingQuality(fallback?.text)) fallback = result;
    }
  }
  if (!fallback && failure) throw failure;
  return fallback;
}

async function fetchQqMusicLyrics(options, fetchImplementation = fetch, onCandidate = null, onFailure = null) {
  return fetchQqMusicLyricsOnce(options, fetchImplementation, onCandidate, onFailure);
}

module.exports = {
  decodeQqLyricJsonp,
  decodeQqLyricText,
  alignQqTranslation,
  extractQrcLyric,
  searchSongsFromPayload,
  fetchLineLyricWithTranslation,
  fetchQqMusicLyrics
};
