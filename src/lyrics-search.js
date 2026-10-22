const { fetchQqMusicLyrics } = require("./qq-music");
const { fetchNeteaseLyrics } = require("./netease-eapi");
const { hasNativeWordTiming, lyricTimingQuality } = require("./lyrics-timing");
const { resolveOnlineLyricProviders, removeLiveQualifier, removeEnglishSuffixFromChineseTitle } = require("./lyrics-source-priority");
const { normalizeLyricOptions, normalizeLyricTag, rankLyricCandidates, isUsableLyricText } = require("./lyrics-matching");

const LYRICS_CACHE_VERSION = 12;
const EMPTY_RESULT = { text: "", source: null };

async function withinDeadline(task, parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Lyrics search timed out", "TimeoutError")), timeoutMs);
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    signal.throwIfAborted();
    // Body readers and provider cleanup can fail to settle after aborting.
    // Enforce the deadline while late results remain guarded by this signal.
    return await Promise.race([task(signal), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
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
    let fallbackTitleIndex = Infinity;
    let fallbackProviderIndex = Infinity;
    let fallbackCandidateIndex = Infinity;
    const targetQuality = requireWordTiming ? 2 : 1;
    // Manual word refresh still exhausts the word sources, but its line
    // fallback follows the same provider/candidate order as a line lookup.
    // Reuse the lines already fetched instead of starting a second search.
    const keepLineSourceOrder = requireWordTiming && options.force;
    const retainFallback = (found, titleIndex, providerIndex = providers.length, candidateIndex = Infinity) => {
      const quality = lyricTimingQuality(found.text), previousQuality = lyricTimingQuality(fallback?.text);
      const earlierCandidate = providerIndex < fallbackProviderIndex ||
        providerIndex === fallbackProviderIndex && candidateIndex < fallbackCandidateIndex;
      if (quality > previousQuality || quality === previousQuality &&
          (titleIndex < fallbackTitleIndex || titleIndex === fallbackTitleIndex &&
            (keepLineSourceOrder ? earlierCandidate : (Number(found.confidence) || 0) > (Number(fallback?.confidence) || 0)))) {
        fallback = found;
        fallbackTitleIndex = titleIndex;
        fallbackProviderIndex = providerIndex;
        fallbackCandidateIndex = candidateIndex;
      }
    };
    let networkFailed = false;
    let requests = 0;
    let result;
    try {
      result = await withinDeadline(async searchSignal => {
        const runProvider = async (task, wordSource = false) => {
          try {
            return await withinDeadline(async providerSignal => {
              const lyricFetch = async (url, init = {}) => {
                const canRetry = wordSource && !String(url).includes("fcg_query_lyric_new");
                let attempts = 0;
                const reportFailure = () => { if (!signal?.aborted && !init.signal?.aborted) networkFailed = true; };
                const canTryAgain = () => canRetry && attempts < 2 && requests < maxRequests &&
                  !providerSignal.aborted && !searchSignal.aborted && !init.signal?.aborted;
                const send = async () => {
                  for (;;) {
                    searchSignal.throwIfAborted();
                    providerSignal.throwIfAborted();
                    init.signal?.throwIfAborted();
                    if (++requests > maxRequests) throw new Error("lyrics-request-limit");
                    attempts++;
                    const requestSignal = AbortSignal.any([providerSignal, AbortSignal.timeout(requestTimeoutMs),
                      ...(init.signal ? [init.signal] : [])]);
                    try {
                      const response = await fetchImplementation(url, { ...init, signal: requestSignal });
                      if (!response.ok && response.status !== 404) reportFailure();
                      if (response.status >= 500 && canTryAgain()) continue;
                      return response;
                    } catch (error) {
                      reportFailure();
                      if (canTryAgain()) continue;
                      throw error;
                    }
                  }
                };
                let response = await send();
                // Keep the same retry allowance and deadline through body reads.
                const read = async method => {
                  try {
                    return await response[method]();
                  } catch (error) {
                    reportFailure();
                    if (!canTryAgain()) throw error;
                    response = await send();
                    if (!response.ok) throw new Error(`lyrics-body-http-${response.status}`);
                    return read(method);
                  }
                };
                return {
                  ok: response.ok, status: response.status,
                  text: () => read("text"), json: () => read("json")
                };
              };
              return await task(lyricFetch, providerSignal);
            }, searchSignal, providerTimeoutMs);
          } catch {
            if (!signal?.aborted) networkFailed = true;
            return null;
          }
        };

        const searchPublicLyrics = async (searchOptions, lyricFetch, onCandidate) => {
          const readJson = async query => {
            const response = await lyricFetch(query, { headers: { "User-Agent": userAgent } });
            return response.ok ? await response.json() : null;
          };
          const choose = values => {
            const candidates = (Array.isArray(values) ? values : [values]).filter(item => item && !item.instrumental &&
              isUsableLyricText(item.syncedLyrics || item.plainLyrics)).map(item => ({
                item, title: item.trackName, artist: item.artistName, album: item.albumName, duration: Number(item.duration)
              }));
            const best = rankLyricCandidates(candidates, searchOptions).sort((left, right) =>
              lyricTimingQuality(right.item.syncedLyrics || right.item.plainLyrics) - lyricTimingQuality(left.item.syncedLyrics || left.item.plainLyrics) || right.score - left.score)[0];
            if (!best) return null;
            const found = {
              text: best.item.syncedLyrics || best.item.plainLyrics, source: "lrclib",
              confidence: Math.round(best.score * 100),
              match: { title: best.title, artist: best.artist, album: best.album || "", duration: best.duration }
            };
            onCandidate(found);
            return found;
          };
          const { title, artist, album, duration } = searchOptions;
          let fallback = null;
          const retain = found => {
            if (found && (lyricTimingQuality(found.text) > lyricTimingQuality(fallback?.text) ||
                lyricTimingQuality(found.text) === lyricTimingQuality(fallback?.text) && found.confidence > fallback.confidence)) fallback = found;
            return fallback;
          };
          if (artist && album && duration) {
            const exactQuery = new URLSearchParams({ track_name: title, artist_name: artist, album_name: album, duration: String(duration) });
            const exact = retain(choose(await readJson(`https://lrclib.net/api/get?${exactQuery}`)));
            if (lyricTimingQuality(exact?.text) >= 1) return exact;
          }
          const query = new URLSearchParams({ track_name: title });
          if (artist) query.set("artist_name", artist);
          const selected = retain(choose(await readJson(`https://lrclib.net/api/search?${query}`)));
          if (lyricTimingQuality(selected?.text) >= 1 || !artist) return selected;
          return retain(choose(await readJson(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: title })}`)));
        };

        const chineseTitle = removeEnglishSuffixFromChineseTitle(options.title);
        const titles = [...new Set([options.title, removeLiveQualifier(options.title), chineseTitle,
          chineseTitle && removeLiveQualifier(chineseTitle)].filter(Boolean))];
        const findPublicFallback = async (searchOptions, titleIndex) => {
          const found = await runProvider((lyricFetch, providerSignal) => searchPublicLyrics(searchOptions, lyricFetch,
            found => { if (!providerSignal.aborted) retainFallback(found, titleIndex); }));
          if (found) retainFallback(found, titleIndex);
        };
        // Exhaust original metadata before relaxing Live qualifiers or bilingual title suffixes.
        for (const [titleIndex, title] of titles.entries()) {
          searchSignal.throwIfAborted();
          const searchOptions = { ...options, title, requireWordTiming };
          for (const [providerIndex, provider] of providers.entries()) {
            searchSignal.throwIfAborted();
            const captureCandidate = (found, candidateIndex) => retainFallback(found, titleIndex, providerIndex, candidateIndex);
            const found = await runProvider((lyricFetch, providerSignal) => {
              const publish = (found, index) => { if (!providerSignal.aborted) captureCandidate(found, index); };
              const failed = () => { if (!signal?.aborted) networkFailed = true; };
              return provider === "qq" ? fetchQqMusicLyrics(searchOptions, lyricFetch, publish, failed)
                : fetchNeteaseLyrics(searchOptions, lyricFetch, publish, failed);
            }, requireWordTiming);
            if (found && isUsableLyricText(found.text)) captureCandidate(found);
            if (lyricTimingQuality(fallback?.text) >= targetQuality) return fallback;
          }
          // LRCLIB can improve plain text, but cannot improve timed line lyrics.
          if (!requireWordTiming && lyricTimingQuality(fallback?.text) < 1) {
            await findPublicFallback(searchOptions, titleIndex);
            if (lyricTimingQuality(fallback?.text) >= targetQuality) return fallback;
          }
        }
        // Line-only services come after every word-capable title/source pass.
        if (requireWordTiming && lyricTimingQuality(fallback?.text) < 1) {
          for (const [titleIndex, title] of titles.entries()) {
            searchSignal.throwIfAborted();
            await findPublicFallback({ ...options, title, requireWordTiming }, titleIndex);
            if (lyricTimingQuality(fallback?.text) >= 1) break;
          }
        }
        return fallback || (networkFailed ? { ...EMPTY_RESULT, error: "network" } : { ...EMPTY_RESULT });
      }, signal, totalTimeoutMs);
    } catch {
      networkFailed = true;
      result = fallback || { ...EMPTY_RESULT, error: "timeout" };
    }
    if (signal?.aborted) return { ...EMPTY_RESULT, cancelled: true };
    const lifetime = result.text
      ? requireWordTiming && !hasNativeWordTiming(result.text)
        ? networkFailed ? 15000 : 60000 : 30 * 86400000
      : result.error ? 15000 : 120000;
    const timestamp = now();
    delete cache[cacheKey];
    cache[cacheKey] = { version: LYRICS_CACHE_VERSION, savedAt: timestamp, expiresAt: timestamp + lifetime, result };
    onCacheChange();
    return { ...result, retryAt: timestamp + lifetime };
  };
}

module.exports = { createOnlineLyricsSearch, LYRICS_CACHE_VERSION };
