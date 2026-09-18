const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");

const MIME_TYPES = {
  ".mp3": "audio/mpeg", ".flac": "audio/flac", ".wav": "audio/wav",
  ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
  ".opus": "audio/ogg", ".wma": "audio/x-ms-wma"
};

function parseSingleRange(value, size) {
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim());
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    end = Math.min(end, size - 1);
  }
  if (start < 0 || start > end || start >= size) return null;
  return { start, end, partial: true };
}

async function createMediaFileResponse(filePath, range) {
  const stat = await fsPromises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) return new Response("Media file unavailable", { status: 404 });

  const selected = parseSingleRange(range, stat.size);
  if (!selected) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${stat.size}` }
    });
  }

  const stream = fs.createReadStream(filePath, { start: selected.start, end: selected.end });
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Accept-Ranges": "bytes",
    "Content-Length": String(selected.end - selected.start + 1),
    "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream"
  };
  if (selected.partial) headers["Content-Range"] = `bytes ${selected.start}-${selected.end}/${stat.size}`;
  return new Response(Readable.toWeb(stream), { status: selected.partial ? 206 : 200, headers });
}

module.exports = { createMediaFileResponse, parseSingleRange };
