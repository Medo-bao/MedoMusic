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

module.exports = { resolveOnlineLyricProviders, selectLocalLyrics };
