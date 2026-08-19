function resolveOnlineLyricProviders(mode) {
  if (mode === "local") return [];
  if (mode === "auto" || mode === "network" || !mode) return ["qq", "netease"];
  return [mode === "netease" ? "netease" : "qq"];
}

function selectLocalLyrics(embeddedText, sidecarText) {
  if (embeddedText) return { text: embeddedText, source: "embedded", confidence: null };
  if (sidecarText) return { text: sidecarText, source: "sidecar", confidence: null };
  return { text: "", source: null };
}

function removeLiveQualifier(title) {
  const original = String(title || "").trim();
  if (!original) return null;
  const withoutBracketedLive = original.replace(
    /[\[(（【][^)\]）】]*\blive\b[^)\]）】]*[\])）】]/giu,
    " "
  );
  const cleaned = withoutBracketedLive
    .replace(/\s*(?:[-–—_·]\s*)?\blive\b(?:\s*(?:version|ver\.?|版))?\s*$/iu, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—_·]+\s*$/u, "")
    .trim();
  return cleaned && cleaned !== original ? cleaned : null;
}

module.exports = { resolveOnlineLyricProviders, selectLocalLyrics, removeLiveQualifier };
