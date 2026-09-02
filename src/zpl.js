const path = require("node:path");
const fs = require("node:fs/promises");

function decodePlaylist(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function decodeXml(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function resolvePlaylistPath(source, playlistPath) {
  let decoded = decodeXml(source.trim());
  if (/^file:/i.test(decoded)) {
    let url;
    try {
      url = new URL(decoded);
      decoded = decodeURIComponent(url.pathname)
        .replace(/^\/([A-Za-z]:)/, "$1")
        .replace(/\//g, path.sep);
    } catch {
      throw new Error("invalid-playlist-path");
    }
    if (url.host && url.hostname.toLowerCase() !== "localhost") throw new Error("remote-playlist-path");
  }
  const normalized = decoded.replace(/[\\/]/g, path.sep);
  if (/^(?:\\\\|\\\?\\|\\\.\\|\\\?\?\\)/.test(normalized)) throw new Error("remote-playlist-path");
  return path.isAbsolute(normalized)
    ? path.normalize(normalized)
    : path.resolve(path.dirname(playlistPath), normalized);
}

async function parseZpl(playlistPath, trackFactory = (filePath) => ({ path: filePath })) {
  const text = decodePlaylist(await fs.readFile(playlistPath));
  const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const name = titleMatch?.[1]?.trim()
    ? decodeXml(titleMatch[1].trim())
    : path.basename(playlistPath, path.extname(playlistPath));
  const sources = [];
  const mediaPattern = /<(?:media|ref)\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  let match;
  while ((match = mediaPattern.exec(text))) {
    sources.push(match[2]);
  }

  const tracks = sources.map((source) => {
    const track = trackFactory(resolvePlaylistPath(source, playlistPath));
    track.playlists = [name];
    return track;
  });
  return { name, path: playlistPath, tracks };
}

module.exports = { decodePlaylist, decodeXml, resolvePlaylistPath, parseZpl };
