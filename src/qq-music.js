const { hasNativeWordTiming } = require("./lyrics-timing");

const HEADERS = {
  Referer: "https://c.y.qq.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MedoMusic"
};

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
}

function decodeQqLyricJsonp(raw, callback) {
  const text = String(raw || "").trim();
  const prefix = `${callback}(`;
  if (!text.startsWith(prefix) || !text.endsWith(")")) return null;
  const payload = JSON.parse(text.slice(prefix.length, -1));
  if (payload.code !== 0 || !payload.lyric) return null;
  return Buffer.from(payload.lyric, "base64").toString("utf8");
}

async function fetchQqMusicLyrics(options, fetchImplementation = fetch) {
  const title = String(options?.title || "").trim();
  const artist = String(options?.artist || "").trim();
  const expectedDuration = Number(options?.duration) || 0;
  if (!title) return null;
  const searchBody = {
    req_1: {
      method: "DoSearchForQQMusicDesktop",
      module: "music.search.SearchCgiService",
      param: { num_per_page: "8", page_num: "1", query: `${title} ${artist}`.trim(), search_type: 0 }
    }
  };
  const searchResponse = await fetchImplementation("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(searchBody),
    signal: AbortSignal.timeout(6500)
  });
  if (!searchResponse.ok) return null;
  const songs = (await searchResponse.json())?.req_1?.data?.body?.song?.list || [];
  const ranked = songs.map((song) => {
    const songArtists = (song.singer || []).map((item) => item.name).join(" ");
    const normalizedTitle = normalize(title);
    const candidateTitle = normalize(song.name || song.title);
    const titleScore = candidateTitle === normalizedTitle ? 1 : candidateTitle.includes(normalizedTitle) ? .76 : 0;
    const artistScore = !artist ? .5 : normalize(songArtists).includes(normalize(artist)) ? 1 : 0;
    const duration = Number(song.interval) || 0;
    const durationScore = !expectedDuration ? .5 : Math.max(0, 1 - Math.abs(duration - expectedDuration) / 12);
    return { song, artist: songArtists, score: titleScore * .58 + artistScore * .27 + durationScore * .15 };
  }).sort((left, right) => right.score - left.score);
  if (!ranked[0] || ranked[0].score < .62 || !ranked[0].song.mid) return null;
  const callback = "MusicJsonCallback_lrc";
  const query = new URLSearchParams({
    callback, pcachetime: String(Date.now()), songmid: ranked[0].song.mid,
    g_tk: "5381", jsonpCallback: callback, loginUin: "0", hostUin: "0",
    format: "jsonp", inCharset: "utf8", outCharset: "utf8", notice: "0",
    platform: "yqq", needNewCode: "0"
  });
  const lyricResponse = await fetchImplementation(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${query}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(6500)
  });
  if (!lyricResponse.ok) return null;
  const text = decodeQqLyricJsonp(await lyricResponse.text(), callback);
  if (!text) return null;
  const wordTimed = hasNativeWordTiming(text);
  return {
    text,
    source: wordTimed ? "qq-word" : "qq-line",
    confidence: Math.round(ranked[0].score * 100),
    match: { title: ranked[0].song.name || ranked[0].song.title, artist: ranked[0].artist }
  };
}

module.exports = { decodeQqLyricJsonp, fetchQqMusicLyrics };
