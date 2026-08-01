const assert = require("node:assert/strict");
const path = require("node:path");
const { parseZpl } = require("../src/zpl");

async function run() {
  const fixture = path.join(__dirname, "fixtures", "groove-sample.zpl");
  const result = await parseZpl(fixture);

  assert.equal(result.name, "夜晚 & 驾驶");
  assert.equal(result.tracks.length, 3);
  assert.equal(result.tracks[0].path, path.resolve(__dirname, "Music", "第一首歌.mp3"));
  assert.equal(result.tracks[1].path, "C:\\Music\\Second Song.flac");
  assert.equal(result.tracks[2].path, path.resolve(__dirname, "fixtures", "subfolder", "third song.wav"));
  assert.deepEqual(result.tracks[0].playlists, ["夜晚 & 驾驶"]);
  console.log("ZPL parser tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
