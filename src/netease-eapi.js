const crypto = require("node:crypto");

const EAPI_URL = "https://interface3.music.163.com/eapi/song/lyric/v1";
const EAPI_PATH = "/api/song/lyric/v1";
const EAPI_KEY = Buffer.from("e82ckenh8dichen8", "ascii");
const DELIMITER = "-36cd479b6b5-";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 Chrome/70.0 Mobile Safari/537.36";

function createNeteaseEapiRequest(songId, now = Date.now(), requestSuffix = crypto.randomInt(0, 1000)) {
  const header = {
    __csrf: "",
    appver: "8.0.0",
    buildver: String(Math.floor(now / 1000)),
    channel: "",
    deviceId: "",
    mobilename: "",
    resolution: "1920x1080",
    os: "android",
    osver: "",
    requestId: `${now}_${String(requestSuffix).padStart(4, "0")}`,
    versioncode: "140",
    MUSIC_U: ""
  };
  const data = {
    id: String(songId), cp: "false", lv: "0", kv: "0", tv: "0", rv: "0",
    yv: "0", ytv: "0", yrv: "0", csrf_token: "", header: JSON.stringify(header)
  };
  const json = JSON.stringify(data);
  const digest = crypto.createHash("md5").update(`nobody${EAPI_PATH}use${json}md5forencrypt`).digest("hex");
  const plaintext = `${EAPI_PATH}${DELIMITER}${json}${DELIMITER}${digest}`;
  const cipher = crypto.createCipheriv("aes-128-ecb", EAPI_KEY, null);
  cipher.setAutoPadding(true);
  const params = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("hex").toUpperCase();
  return {
    url: EAPI_URL,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://music.163.com/",
      "User-Agent": USER_AGENT,
      Cookie: Object.entries(header).map(([key, value]) => `${key}=${value}`).join("; ")
    },
    body: new URLSearchParams({ params }).toString()
  };
}

async function fetchNeteaseNewLyrics(songId, fetchImplementation = fetch) {
  const request = createNeteaseEapiRequest(songId);
  const response = await fetchImplementation(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) return null;
  return await response.json();
}

module.exports = { createNeteaseEapiRequest, fetchNeteaseNewLyrics };
