function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function decodeWith(label, bytes, fatal = false) {
  return stripBom(new TextDecoder(label, { fatal }).decode(bytes));
}

function looksLikeUtf16(bytes, littleEndian) {
  const sampleLength = Math.min(bytes.length, 512);
  if (sampleLength < 4) return false;
  let expectedNulls = 0;
  let oppositeNulls = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] !== 0) continue;
    const expectedParity = littleEndian ? 1 : 0;
    if (index % 2 === expectedParity) expectedNulls += 1;
    else oppositeNulls += 1;
  }
  return expectedNulls >= 2 && expectedNulls > oppositeNulls * 3;
}

function decodedTextScore(text, preference = 0) {
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  const controlCount = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  const readableCount = (text.match(/[\p{L}\p{N}\p{P}\p{Zs}]/gu) || []).length;
  const cjkCount = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
  const timelineCount = (text.match(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g) || []).length;
  return readableCount + cjkCount * 1.5 + timelineCount * 12 - replacementCount * 120 - controlCount * 60 + preference;
}

function decodeTextBuffer(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
  if (!bytes.length) return "";

  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return decodeWith("utf-8", bytes.subarray(3));
  }
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return decodeWith("utf-16le", bytes.subarray(2));
  }
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return decodeWith("utf-16be", bytes.subarray(2));
  }
  if (looksLikeUtf16(bytes, true)) return decodeWith("utf-16le", bytes);
  if (looksLikeUtf16(bytes, false)) return decodeWith("utf-16be", bytes);

  try {
    return decodeWith("utf-8", bytes, true);
  } catch {}

  const candidates = [
    ["gb18030", 3],
    ["big5", 2],
    ["shift_jis", 1],
    ["windows-1252", 0]
  ].map(([label, preference]) => {
    try {
      const text = decodeWith(label, bytes);
      return { text, score: decodedTextScore(text, preference) };
    } catch {
      return { text: "", score: Number.NEGATIVE_INFINITY };
    }
  });
  return candidates.sort((left, right) => right.score - left.score)[0]?.text || decodeWith("utf-8", bytes);
}

module.exports = { decodeTextBuffer };
