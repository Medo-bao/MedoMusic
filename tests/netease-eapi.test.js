const assert = require("node:assert/strict");
const { createNeteaseEapiRequest } = require("../src/netease-eapi");

const request = createNeteaseEapiRequest("123456", 1700000000000, 7);
assert.equal(request.url, "https://interface3.music.163.com/eapi/song/lyric/v1");
assert.match(request.body, /^params=[0-9A-F]+$/);
assert.match(request.headers.Cookie, /appver=8\.0\.0/);
assert.match(request.headers.Cookie, /requestId=1700000000000_0007/);
assert.equal(request.headers.Referer, "https://music.163.com/");

console.log("Netease EAPI tests passed");
