const { fetchQqMusicLyrics } = require("./qq-music");
const { fetchNeteaseLyrics } = require("./netease-eapi");
const { hasNativeWordTiming } = require("./lyrics-timing");
const { resolveOnlineLyricProviders, removeLiveQualifier, removeEnglishSuffixFromChineseTitle } = require("./lyrics-source-priority");
const { normalizeLyricOptions, normalizeLyricTag, rankLyricCandidates, isUsableLyricText } = require("./lyrics-matching");

const LYRICS_CACHE_VERSION = 3;
const EMPTY_RESULT = { text: "", source: null };

async function withinDeadline(task, parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Lyrics search timed out", "TimeoutError")), timeoutMs);
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  try {
    signal.throwIfAborted();
    return await task(signal);
  } finally {
    clearTimeout(timer);
  }
}

function createOnlineLyricsSearch({
  getCache, onCacheChange = () => {}, fetchImplementation = fetch,
  userAgent = "MedoMusic", now = Date.now,
  totalTimeoutMs = 24000, providerTimeoutMs = 5000, requestTimeoutMs = 3500,
  maxRequests = 24
}) {
  return async function searchOnlineLyrics(rawOptions, { signal } = {}) {
    const options = normalizeLyricOptions(rawOptions);
    if (!options.title) return { ...EMPTY_RESULT };
    if (signal?.aborted) return { ...EMPTY_RESULT, cancelled: true };
    const requireWordTiming = options.requireWordTiming === true || options.mode === "network";
    const providers = resolveOnlineLyricProviders(options.mode, requireWordTiming);
    if (!providers.length) return { ...EMPTY_RESULT };
    const cache = await getCache();
    if (signal?.aborted) return { ...EMPTY_RESULT, cancelled: true };
    const cacheKey = JSON.stringify([normalizeLyricTag(options.title), normalizeLyricTag(options.artist),
      normalizeLyricTag(options.album), options.duration, providers, requireWordTiming]);
    const cached = cache[cacheKey];
    if (!options.force && cached?.version === LYRICS_CACHE_VERSION && cached.expiresAt > now() &&
        cached.result && (!cached.result.text || isUsableLyricText(cached.result.text))) {
      return { ...cached.result, retryAt: cached.expiresAt };
    }

    let fallback = null;
    let networkFailed = false;
    let requests = 0;
    let result;
    try {
      result = await withinDeadline(async searchSignal => {
        const runProvider = async task => {
          try {
            return await withinDeadline(async providerSignal => {
              const lyricFetch = async (url, init = {}) => {
                searchSignal.throwIfAborted();
                providerSignal.throwIfAborted();
                if (++requests > maxRequests) throw new Error("lyrics-request-limit");
                const requestSignal = AbortSignal.any([providerSignal, AbortSignal.timeout(requestTimeoutMs),
                  ...(init.signal ? [init.signal] : [])]);
                try {
                  const response = await fetchImplementation(url, { ...init, signal: requestSignal });
                  if (!response.ok && response.status !== 404) networkFailed = true;
                  return response;
                } catch (error) {
                  if (!signal?.aborted) networkFailed = true;
                  throw error;
                }
              };
              return await task(lyricFetch);
            }, searchSignal, providerTimeoutMs);
          } catch {
            if (!signal?.aborted) networkFailed = true;
            return null;
          }
        };

        const searchPublicLyrics = async (searchOptions, lyricFetch) => {
          const readJson = async query => {
            const response = await lyricFetch(query, { headers: { "User-Agent": userAgent } });
            return response.ok ? await response.json() : null;
          };
          const choose = values => {
            const candidates = (Array.isArray(values) ? values : [values]).filter(item => item && !item.instrumental &&
              isUsableLyricText(item.syncedLyrics || item.plainLyrics)).map(item => ({
                item, title: item.trackName, artist: item.artistName, album: item.albumName, duration: Number(item.duration)
              }));
            const best = rankLyricCandidates(candidates, searchOptions)[0];
            if (!best) return null;
            return {
              text: best.item.syncedLyrics || best.item.plainLyrics, source: "lrclib",
              confidence: Math.round(best.score * 100),
              match: { title: best.title, artist: best.artist, album: best.album || "", duration: best.duration }
            };
          };
          const { title, artist, album, duration } = searchOptions;
          if (artist && album && duration) {
            const exactQuery = new URLSearchParams({ track_name: title, artist_name: artist, album_name: album, duration: String(duration) });
            const exact = choose(await readJson(`https://lrclib.net/api/get?${exactQuery}`));
            if (exact) return exact;
          }
          const query = new URLSearchParams({ track_name: title });
          if (artist) query.set("artist_name", artist);
          const selected = choose(await readJson(`https://lrclib.net/api/search?${query}`));
          if (selected || !artist) return selected;
          return choose(await readJson(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: title })}`));
        };

        const chineseTitle = removeEnglishSuffixFromChineseTitle(options.title);
        const titles = [...new Set([options.title, removeLiveQualifier(options.title), chineseTitle,
          chineseTitle && removeLiveQualifier(chineseTitle)].filter(Boolean))];
        // Exhaust original metadata before relaxing Live qualifiers or bilingual title suffixes.
        for (const title of titles) {
          searchSignal.throwIfAborted();
          const searchOptions = { ...options, title, requireWordTiming };
          for (const provider of providers) {
            searchSignal.throwIfAborted();
            const found = await runProvider(lyricFetch => provider === "qq"
              ? fetchQqMusicLyrics(searchOptions, lyricFetch)
              : fetchNeteaseLyrics(searchOptions, lyricFetch));
            if (!found || !isUsableLyricText(found.text)) continue;
            if (!requireWordTiming || hasNativeWordTiming(found.text)) return found;
            fallback ||= found;
          }
          // LRCLIB supplies line lyrics; it cannot improve an existing word-mode line fallback.
          if (!fallback) {
            const found = await runProvider(lyricFetch => searchPublicLyrics(searchOptions, lyricFetch));
            if (found) {
              if (!requireWordTiming) return found;
              fallback = found;
            }
          }
        }
        return fallback || (networkFailed ? { ...EMPTY_RESULT, error: "network" } : { ...EMPTY_RESULT });
      }, signal, totalTimeoutMs);
    } catch {
      result = fallback || { ...EMPTY_RESULT, error: "timeout" };
    }
    if (signal?.aborted) return { ...EMPTY_RESULT, cancelled: true };
    const lifetime = result.text
      ? requireWordTiming && !hasNativeWordTiming(result.text) ? 60000 : 30 * 86400000
      : result.error ? 15000 : 120000;
    const timestamp = now();
    delete cache[cacheKey];
    cache[cacheKey] = { version: LYRICS_CACHE_VERSION, savedAt: timestamp, expiresAt: timestamp + lifetime, result };
    onCacheChange();
    return { ...result, retryAt: timestamp + lifetime };
  };
}

module.exports = { createOnlineLyricsSearch, LYRICS_CACHE_VERSION };
