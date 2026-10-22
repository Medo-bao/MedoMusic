const { parseLyricMetadataLine, parseLyricInformationLine } = require("./lyrics-timing");
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

// Common Chinese renderings of Western artist names. Chinese metadata rarely
// matches a provider's Latin spelling, so both sides expand to every known
// alias before comparison. Deliberately small: only pairs that actually show up
// as 中英文标签差异. Keys and values are normalized again at load time.
const ARTIST_ALIAS_PAIRS = [
  ["Taylor Swift", "泰勒·斯威夫特", "泰勒丝", "霉霉"],
  ["Adele", "阿黛尔"],
  ["Ed Sheeran", "艾德·希兰", "黄老板"],
  ["Beyoncé", "碧昂丝"],
  ["Coldplay", "酷玩乐队", "酷玩"],
  ["Maroon 5", "魔力红"],
  ["Linkin Park", "林肯公园"],
  ["Green Day", "绿日乐队"],
  ["The Beatles", "披头士", "甲壳虫乐队"],
  ["Queen", "皇后乐队"],
  ["OneRepublic", "共和时代", "一体共和"],
  ["Imagine Dragons", "谜幻乐队"],
  ["Bruno Mars", "布鲁诺·马尔斯", "火星哥"],
  ["Billie Eilish", "比莉·艾利什"],
  ["Ariana Grande", "爱莉安娜·格兰德"],
  ["Lady Gaga", "嘎嘎小姐"],
  ["Rihanna", "蕾哈娜"],
  ["Eminem", "埃米纳姆", "姆爷"],
  ["Drake", "德雷克"],
  ["The Weeknd", "盆栽", "周末"],
  ["Post Malone", "波兹·马龙"],
  ["Dua Lipa", "杜阿·利帕"],
  ["Justin Bieber", "贾斯汀·比伯"],
  ["Justin Timberlake", "贾斯汀·汀布莱克"],
  ["Katy Perry", "凯蒂·佩里", "水果姐"],
  ["Bon Jovi", "邦乔维"],
  ["Metallica", "金属乐队"],
  ["Nirvana", "涅槃乐队"],
  ["Radiohead", "电台司令"],
  ["ABBA", "阿巴乐队"],
  ["Avicii", "艾维奇"],
  ["Alan Walker", "艾伦·沃克"],
  ["Martin Garrix", "马丁·盖瑞斯"],
  ["Kygo", "凯戈"],
  ["Zedd", "捷德"],
  ["Mike Posner", "迈克·波斯纳"],
  ["One Direction", "单向组合"],
  ["Harry Styles", "哈里·斯泰尔斯"],
  ["Shawn Mendes", "肖恩·蒙德兹"],
  ["Camila Cabello", "卡米拉·卡贝洛"],
  ["Halsey", "海尔希"],
  ["Lorde", "洛德"],
  ["Sia", "希雅"],
  ["Sam Smith", "萨姆·史密斯"],
  ["John Legend", "约翰·传奇"],
  ["Charlie Puth", "查理·普斯", "断眉"],
  ["Wiz Khalifa", "维兹·卡利法"],
  ["The Chainsmokers", "烟鬼组合"],
  ["Calvin Harris", "加尔文·哈里斯"],
  ["David Guetta", "大卫·库塔"],
  ["Backstreet Boys", "后街男孩"],
  ["Westlife", "西城男孩"],
  ["Mariah Carey", "玛丽亚·凯莉"],
  ["Whitney Houston", "惠特妮·休斯顿"],
  ["Celine Dion", "席琳·迪翁"],
  ["Enrique Iglesias", "安立奎·伊格莱西亚斯"],
  ["Shakira", "夏奇拉"],
  ["Ricky Martin", "瑞奇·马丁"],
  ["Jennifer Lopez", "詹妮弗·洛佩兹"],
  ["Alicia Keys", "艾莉西亚·凯斯"],
  ["Norah Jones", "诺拉·琼斯"],
  ["J Balvin", "J·巴尔文"],
  ["Bad Bunny", "坏痞兔"],
  ["Karol G", "卡罗尔·G"],
  ["Rosalía", "罗莎莉亚"],
  ["Aimer", "爱缪"]
];

// Expand one artist token to every normalized alias it could be compared with.
function artistAliases(normalized) {
  if (!normalized) return [];
  const entry = ARTIST_ALIASES.get(normalized);
  return entry ? [...entry] : [normalized];
}

// Longest-common-subsequence similarity in percent, used as the fuzzy fallback
// when exact normalized equality fails (spelling, full/half width, punctuation).
function textSimilarity(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || !b) return 0;
  if (a === b) return 100;
  const rows = Math.max(a.length, b.length) + 1;
  const table = new Uint16Array(rows * rows);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i * rows + j] = a[i - 1] === b[j - 1]
        ? table[(i - 1) * rows + (j - 1)] + 1
        : Math.max(table[(i - 1) * rows + j], table[i * rows + (j - 1)]);
    }
  }
  return table[a.length * rows + b.length] / Math.max(a.length, b.length) * 100;
}

function cleanLyricTag(value) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  return UNKNOWN_TAG.test(text) ? "" : text;
}

function normalizeLyricTag(value) {
  return cleanLyricTag(value).toLowerCase().normalize("NFKD")
    .replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

const ARTIST_ALIASES = new Map();
for (const [latin, ...chinese] of ARTIST_ALIAS_PAIRS) {
  const key = normalizeLyricTag(latin);
  if (!key) continue;
  const aliases = new Set([key, ...chinese.map(normalizeLyricTag).filter(Boolean)]);
  for (const alias of aliases) {
    const entry = ARTIST_ALIASES.get(alias) || new Set();
    for (const value of aliases) entry.add(value);
    ARTIST_ALIASES.set(alias, entry);
  }
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
  // Exact normalization first, then version-stripped, then alias list, and
  // finally an LCS similarity floor for spelling/full-width/punctuation drift.
  let titleScore = wanted.full === actual.full ? 1 : wanted.base && wanted.base === actual.base ? .96 :
    (candidate.aliases || []).some(alias => titleParts(alias).full === wanted.full) ? .94 : 0;
  if (!titleScore) {
    const fuzzy = Math.max(
      textSimilarity(wanted.full, actual.full),
      wanted.base ? textSimilarity(wanted.base, actual.base) : 0,
      ...(candidate.aliases || []).map(alias => textSimilarity(wanted.full, titleParts(alias).full))
    );
    if (fuzzy > 68) titleScore = fuzzy > 80 ? .85 : .7;
  }
  if (!titleScore) return 0;

  const artists = (Array.isArray(candidate.artists) ? candidate.artists : [candidate.artist])
    .map(cleanLyricTag).filter(Boolean);
  const artistNames = new Set(artists.flatMap(name => [normalizeLyricTag(name), ...artistParts(name)]));
  const requestedArtists = artistParts(options.artist);
  const requestedAliases = new Set(requestedArtists.flatMap(artistAliases));
  const candidateAliases = new Set([...artistNames].flatMap(artistAliases));
  const sharesAlias = [...requestedAliases].some(alias => candidateAliases.has(alias));
  const fuzzyArtist = !sharesAlias && [...requestedAliases].some(requested =>
    [...candidateAliases].some(candidateName => textSimilarity(requested, candidateName) > 80));
  const artistMatch = !options.artist || artistNames.has(normalizeLyricTag(options.artist)) ||
    (requestedArtists.length > 0 && requestedArtists.every(name => artistNames.has(name))) ||
    sharesAlias || fuzzyArtist;
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
  if (/<(?:[\w.-]+:)?tt(?:\s|>)/i.test(text)) {
    const ttml = require('./ttml').parseTtml(text);
    return Boolean(ttml?.lines.some(line => isUsableLyricText(line.text)));
  }
  if (!text || /^(?:<!doctype|<html|<\?xml)/iu.test(text)) return false;
  return text.split(/\r\n?|\n/u).some(line => {
    if (parseLyricMetadataLine(line)) return false;
    const information = parseLyricInformationLine(line);
    const content = (information ? information.text : line)
      .replace(/\[[\d:.,]+\]|<\d[\d:.,]*>|\([\d,]+\)/gu, "").trim();
    return content && !/^(?:纯音乐[，,]?请欣赏|此歌曲为没有填词的纯音乐[，,]?请您欣赏[。.]?|instrumental|no lyrics)$/iu.test(content);
  });
}

module.exports = {
  cleanLyricTag, normalizeLyricTag, normalizeLyricOptions, scoreLyricCandidate,
  rankLyricCandidates, isUsableLyricText, textSimilarity, artistAliases, ARTIST_ALIASES
};
