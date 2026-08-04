function isJayChouArtist(artist) {
  const normalized = String(artist || "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
  return normalized.includes("周杰伦") || normalized.includes("jaychou");
}

function resolveOnlineLyricProviders(mode, artist = "") {
  if (mode === "local") return [];
  if (mode === "auto" || mode === "network" || !mode) {
    return isJayChouArtist(artist) ? ["qq", "netease"] : ["netease", "qq"];
  }
  return [mode === "netease" ? "netease" : "qq"];
}

function selectLocalLyrics(embeddedText, sidecarText) {
  if (embeddedText) return { text: embeddedText, source: "embedded", confidence: null };
  if (sidecarText) return { text: sidecarText, source: "sidecar", confidence: null };
  return { text: "", source: null };
}

module.exports = { isJayChouArtist, resolveOnlineLyricProviders, selectLocalLyrics };
