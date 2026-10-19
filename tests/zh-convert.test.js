const assert = require("node:assert/strict");
const { toSimplified, isTraditional, TABLE_SIZE } = require("../src/zh-convert");

// The table is a real OpenCC extract, not a stub.
assert.ok(TABLE_SIZE > 2500, `expected a substantial table, received ${TABLE_SIZE}`);

// Common lyric characters convert.
assert.equal(toSimplified("這樣的話，我們的愛還能不能繼續？"), "这样的话，我们的爱还能不能继续？");
assert.equal(toSimplified("後來"), "后来");
assert.equal(toSimplified("夢醒時分"), "梦醒时分");
assert.equal(toSimplified("萬里長城"), "万里长城");
assert.equal(toSimplified("臺灣"), "台湾");
assert.equal(toSimplified("練習"), "练习");
assert.equal(toSimplified("憂鬱"), "忧郁");
assert.equal(toSimplified("乾淨"), "干净");
assert.equal(toSimplified("裏面"), "里面");

// Simplified input comes back untouched (same reference so callers can detect).
const simplified = "我们已经是简体了，不需要转换。";
assert.equal(toSimplified(simplified), simplified);
assert.equal(isTraditional(simplified), false);

// Mixed text only rewrites the traditional run.
assert.equal(toSimplified("我愛 MedoMusic 播放器"), "我爱 MedoMusic 播放器");
assert.equal(isTraditional("我愛 MedoMusic 播放器"), true);

// Latin, digits, punctuation and emoji pass through.
const neutral = "Just a 1234 test — (demo) ♪ 😀";
assert.equal(toSimplified(neutral), neutral);
assert.equal(isTraditional(neutral), false);

// Empty and non-string inputs do not throw.
assert.equal(toSimplified(""), "");
assert.equal(toSimplified(null), "");
assert.equal(toSimplified(undefined), "");
assert.equal(isTraditional(""), false);

// Idempotent: converting twice equals converting once.
const once = toSimplified("這是一個測試");
assert.equal(toSimplified(once), once);

console.log("Traditional to Simplified conversion passed");
