(function exposeLyricTiming(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MedoLyricsTiming = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  function fallbackLineEnd(line, duration) {
    const start = Number(line?.start) || 0;
    if (Number.isFinite(duration) && duration > start) return duration;
    const characterCount = Math.max(1, [...String(line?.text || "")].length);
    return start + Math.min(10, Math.max(1.6, characterCount * .3));
  }

  function resolveYrcWordStart(lineStart, wordStart, offsetMilliseconds = 0) {
    const rawLineStart = Number(lineStart) || 0;
    const rawWordStart = Number(wordStart) || 0;
    const absoluteStart = rawWordStart + .5 < rawLineStart
      ? rawLineStart + rawWordStart
      : rawWordStart;
    return absoluteStart + (Number(offsetMilliseconds) || 0) / 1000;
  }

  function hasNativeWordTiming(text) {
    const value = String(text || "");
    return /^\[\d+,\d+\].*\(\d+,\d+,\d+\)/m.test(value) ||
      /^\[\d+,\d+\].+\(\d+,\d+\)/m.test(value) ||
      /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>[^<\r\n]+/.test(value);
  }

  function standardizeNativeWords(words) {
    const normalized = [];
    for (const source of Array.isArray(words) ? words : []) {
      const word = { ...source, text: String(source?.text || "") };
      if (!word.text) continue;
      const standaloneSpace = /^\s+$/u.test(word.text);
      const punctuation = /^[,.?!"，。？！、；：…]+$/u.test(word.text);
      if ((standaloneSpace || punctuation) && normalized.length) {
        const previous = normalized[normalized.length - 1];
        previous.text += word.text;
        if (Number(word.end) > Number(previous.end || 0)) previous.end = Number(word.end);
        continue;
      }
      normalized.push(word);
    }
    while (normalized.length && /^\s+$/u.test(normalized[normalized.length - 1].text)) normalized.pop();
    return normalized;
  }

  function completeWordTimings(lines, duration = 0) {
    if (!Array.isArray(lines)) return [];
    return lines.map((line, lineIndex) => {
      const start = Number(line?.start);
      if (line?.start === null || line?.start === undefined || !Number.isFinite(start) || !line?.text) return line;
      let nextLineStart = null;
      for (let index = lineIndex + 1; index < lines.length; index += 1) {
        const candidateValue = lines[index]?.start;
        const candidate = Number(candidateValue);
        if (candidateValue !== null && candidateValue !== undefined && Number.isFinite(candidate) && candidate > start) {
          nextLineStart = candidate;
          break;
        }
      }
      const lineEnd = Math.max(start + .12, nextLineStart ?? fallbackLineEnd(line, Number(duration)));
      const sourceWords = standardizeNativeWords(line.words);
      if (!sourceWords.length) {
        const approximateEnd = start + (lineEnd - start) * .85;
        return {
          ...line,
          words: [{ start, end: approximateEnd, text: line.text, approximate: true }],
          approximateWords: true
        };
      }
      const words = sourceWords.map((word, wordIndex) => {
        const wordStart = Number.isFinite(Number(word.start)) ? Number(word.start) : start;
        const storedEnd = Number(word.end);
        const followingStart = Number(sourceWords[wordIndex + 1]?.start);
        const end = storedEnd > wordStart
          ? storedEnd
          : followingStart > wordStart ? followingStart : lineEnd;
        return { ...word, start: wordStart, end: Math.max(wordStart + .08, end) };
      });
      return { ...line, words };
    });
  }

  return { completeWordTimings, resolveYrcWordStart, hasNativeWordTiming, standardizeNativeWords };
});
