const UNKNOWN_TAG = /^(?:未知(?:艺术家|歌手|专辑)?|unknown(?:\s+(?:artist|album))?|n\/a)$/iu;
const VERSION_TAGS = [
  ["live", /\blive\b|现场|演唱会/iu],
  ["remix", /\bremix\b|混音|混音版/iu],
  ["instrumental", /\binstrumental\b|\bkaraoke\b|伴奏|纯音乐/iu],
  ["acoustic", /\bacoustic\b|不插电/iu],
  ["cover", /\bcover\b|翻唱/iu],
  ["demo", /\bdemo\b|小样/iu],
  ["sped", /\bsped\b|加速/iu],
  ["slowed", /\bslowed\b|降速|慢速/iu]
];

function cleanLyricTag(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  return UNKNOWN_TAG.test(text) ? "" : text;
}

function normalizeLyricTag(value) {
  return cleanLyricTag(value).toLowerCase().normalize("NFKD")
    .replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeLyricOptions(options = {}) {
  const duration = Number(options.duration);
  return {
    ...options,
    title: cleanLyricTag(options.title),
    artist: cleanLyricTag(options.artist),
    album: cleanLyricTag(options.album),
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0
  };
}

function titleParts(value) {
  const title = cleanLyricTag(value);
  const versions = VERSION_TAGS.filter(([, pattern]) => pattern.test(title)).map(([name]) => name).join(",");
  const base = title.replace(/[\[(【]([^\])】]*)[\])】]/gu, (original, contents) => {
    if (VERSION_TAGS.some(([, pattern]) => pattern.test(contents)) ||
        /^(?:official\s*(?:audio|video|mv)|lyrics?\s*video|歌词版|无损版?)$/iu.test(contents.trim())) return " ";
    return original;
  }).replace(/\s*(?:[-–—_]\s*)?(?:live(?:\s*(?:version|ver\.?|版))?|现场版|伴奏版|acoustic|instrumental)\s*$/iu, "");
  return { full: normalizeLyricTag(title), base: normalizeLyricTag(base), versions };
}

function artistParts(value) {
  return cleanLyricTag(value).split(/\s*(?:[、,，;&；/\\|×]|\bfeat\.?\s|\bft\.?\s|\bwith\s)\s*/iu)
    .map(normalizeLyricTag).filter(Boolean);
}

function scoreLyricCandidate(candidate, rawOptions) {
  const options = normalizeLyricOptions(rawOptions);
  const wanted = titleParts(options.title);
  const actual = titleParts(candidate.title);
  if (!wanted.full || !actual.full || wanted.versions !== actual.versions) return 0;
  const titleScore = wanted.full === actual.full ? 1 : wanted.base && wanted.base === actual.base ? .96 :
    (candidate.aliases || []).some(alias => titleParts(alias).full === wanted.full) ? .94 : 0;
  if (!titleScore) return 0;

  const artists = (Array.isArray(candidate.artists) ? candidate.artists : [candidate.artist])
    .map(cleanLyricTag).filter(Boolean);
  const artistNames = new Set(artists.flatMap(name => [normalizeLyricTag(name), ...artistParts(name)]));
  const requestedArtists = artistParts(options.artist);
  const artistMatch = !options.artist || artistNames.has(normalizeLyricTag(options.artist)) ||
    (requestedArtists.length > 0 && requestedArtists.every(name => artistNames.has(name)));
  if (!artistMatch) return 0;

  const candidateDuration = Number(candidate.duration);
  const hasDuration = Number.isFinite(candidateDuration) && candidateDuration > 0 && options.duration > 0;
  const delta = hasDuration ? Math.abs(candidateDuration - options.duration) : 0;
  const tolerance = options.artist ? Math.min(12, Math.max(3, options.duration * .035)) : 3;
  if (hasDuration && delta > tolerance) return 0;
  const durationScore = hasDuration ? Math.max(0, 1 - delta / Math.max(1, tolerance)) : .35;
  const candidateAlbum = normalizeLyricTag(candidate.album);
  const albumScore = options.album && candidateAlbum ? Number(candidateAlbum === normalizeLyricTag(options.album)) : .35;
  return titleScore * .6 + (options.artist ? 1 : .4) * .25 + durationScore * .1 + albumScore * .05;
}

function rankLyricCandidates(candidates, options) {
  const ranked = candidates.map(candidate => ({ ...candidate, score: scoreLyricCandidate(candidate, options) }))
    .filter(candidate => candidate.score >= .68).sort((left, right) => right.score - left.score);
  // With no artist tag, equally plausible recordings by different artists cannot be chosen safely.
  if (!cleanLyricTag(options.artist) && ranked.length > 1 && ranked[0].score - ranked[1].score < .035) {
    const artistKey = candidate => (candidate.artists || [candidate.artist]).map(normalizeLyricTag).sort().join("|");
    if (artistKey(ranked[0]) !== artistKey(ranked[1])) return [];
  }
  return ranked;
}

function isUsableLyricText(value) {
  const text = String(value || "").trim();
  if (!text || /^(?:<!doctype|<html|<\?xml)/iu.test(text)) return false;
  return text.split(/\r?\n/u).some(line => {
    const content = line.replace(/^\[(?:ar|ti|al|by|offset|length|re|ve):[^\]]*\]\s*$/iu, "")
      .replace(/\[[\d:.,]+\]|<\d[\d:.,]*>|\([\d,]+\)/gu, "").trim();
    return content && !/^(?:纯音乐[，,]?请欣赏|此歌曲为没有填词的纯音乐[，,]?请您欣赏[。.]?|instrumental|no lyrics)$/iu.test(content);
  });
}

module.exports = { cleanLyricTag, normalizeLyricTag, normalizeLyricOptions, scoreLyricCandidate, rankLyricCandidates, isUsableLyricText };
