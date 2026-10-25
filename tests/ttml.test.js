const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ttml = require("../src/ttml");

const fixtures = path.join(__dirname, "fixtures", "apple");

// 1. Time parsing covers the forms Apple and other TTML producers emit.
assert.equal(ttml.parseTime("0.358"), 0.358);
assert.equal(ttml.parseTime("4:17.286"), 257.286);
assert.equal(ttml.parseTime("1:02:03.500"), 3723.5);
assert.equal(ttml.parseTime("250ms"), 0.25);
assert.equal(ttml.parseTime("1.5s"), 1.5);
assert.equal(ttml.parseTime("48f", 24), 2);
assert.equal(ttml.parseTime(""), null);
assert.equal(ttml.parseTime("nonsense"), null);

// 2. Entities and attributes.
assert.equal(ttml.decodeEntities("a &amp; b &lt;c&gt; &#39;d&#39;"), "a & b <c> 'd'");
assert.deepEqual(ttml.parseAttributes('begin="1.5" end=\'2.5\' ttm:role="x-bg"'), {
  begin: "1.5", end: "2.5", "ttm:role": "x-bg"
});

// 3. Real Apple sample: syllable spans become per-word timings.
const real = JSON.parse(fs.readFileSync(path.join(fixtures, "syllable-demo.json"), "utf8"));
const realTtml = real.data[0].attributes.ttml;
assert.equal(ttml.hasNativeWordTiming(realTtml), true);
const realParsed = ttml.parseTtml(realTtml);
assert.ok(realParsed, "real Apple TTML parses");
assert.equal(realParsed.format, "ttml");
assert.ok(realParsed.lines.length > 50, `expected many lines, received ${realParsed.lines.length}`);
assert.deepEqual(realParsed.writers, ["Ryan Tedder"]);
const first = realParsed.lines[0];
assert.equal(first.text, "Lately I've been, I've been losing sleep");
assert.equal(first.words[0].text.trim(), "Lately");
assert.equal(first.words.map(word => word.text).join(''), first.text, 'syllables preserve spaces in the visible lyric');
assert.ok(Math.abs(first.words[0].start - 0.358) < 1e-6, `first word start ${first.words[0].start}`);
assert.ok(Math.abs(first.words[0].end - 1.694) < 1e-6, `first word end ${first.words[0].end}`);
assert.equal(first.words.length, 7, "one entry per syllable, spaces collapsed");
// Every non-final word must have a usable interval.
for (let index = 0; index < first.words.length - 1; index += 1) {
  const word = first.words[index];
  assert.ok(word.end > word.start, `word ${index} has a positive interval`);
}
// Two-letter alignment: the sample is a single singer, so every line is left.
assert.ok(realParsed.lines.every(line => line.alignment === "left"));
// Background vocals are extracted into a subline rather than folded in.
assert.ok(realParsed.lines.some(line => line.subline?.text), "the sample carries background vocals");

// 4. Synthetic sample exercises translations, transliteration and duet agents.
const synthetic = fs.readFileSync(path.join(fixtures, "synthetic-translations.ttml"), "utf8");
const parsed = ttml.parseTtml(synthetic);
assert.ok(parsed);
assert.deepEqual(parsed.writers, ["Ryan Tedder", "Tyler Spry"]);
assert.equal(parsed.lines.length, 3);
const [firstLine, duetLine, groupLine] = parsed.lines;
assert.equal(firstLine.start, 0.3);
assert.equal(firstLine.text, "Lately I've been losing sleep");
assert.deepEqual(firstLine.words.map(word => word.text.trim()), ["Lately", "I've", "been", "losing", "sleep"]);
assert.deepEqual(firstLine.translations, { "zh-hans": "最近我总是睡不着" });
assert.deepEqual(firstLine.pronunciation, { "ja-latn": "reitari aibu biin ruuzingu suuriipu" });
assert.equal(firstLine.alignment, "left");
assert.equal(duetLine.alignment, "right", "second person agent alternates side");
assert.equal(duetLine.subline.text, "(dreaming about)");
assert.equal(duetLine.text, 'Dreaming about', 'background vocals never repeat inside the main line');
assert.equal(duetLine.subline.words[0].start, 5.245);
assert.equal(groupLine.alignment, "unspecified", "group agents are not positioned");

// 5. Translations and background never leak between lines.
assert.equal(duetLine.translations, undefined);
assert.ok(firstLine.words.every(word => !/dreaming/i.test(word.text)));

// 6. Non-TTML input is rejected so the LRC/QRC branches keep working.
assert.equal(ttml.parseTtml("[00:01.00]plain lrc"), null);
assert.equal(ttml.parseTtml(""), null);
assert.equal(ttml.hasNativeWordTiming("[1000,1000]逐(1000,500)字(1500,500)"), false);

console.log("Offline TTML parser passed");
