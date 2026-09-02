const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { parseZpl, resolvePlaylistPath } = require("../src/zpl");

async function run() {
  const fixture = path.join(__dirname, "fixtures", "groove-sample.zpl");
  const result = await parseZpl(fixture);

  assert.equal(result.name, "夜晚 & 驾驶");
  assert.equal(result.tracks.length, 3);
  assert.equal(result.tracks[0].path, path.resolve(__dirname, "Music", "第一首歌.mp3"));
  assert.equal(result.tracks[1].path, "C:\\Music\\Second Song.flac");
  assert.equal(result.tracks[2].path, path.resolve(__dirname, "fixtures", "subfolder", "third song.wav"));
  assert.deepEqual(result.tracks[0].playlists, ["夜晚 & 驾驶"]);

  assert.throws(() => resolvePlaylistPath("\\\\attacker.example\\share\\song.mp3", fixture), /remote-playlist-path/);
  assert.throws(() => resolvePlaylistPath("//attacker.example/share/song.mp3", fixture), /remote-playlist-path/);
  assert.throws(() => resolvePlaylistPath("file://attacker.example/share/song.mp3", fixture), /remote-playlist-path/);
  assert.throws(() => resolvePlaylistPath("file:////attacker.example/share/song.mp3", fixture), /remote-playlist-path/);
  assert.throws(() => resolvePlaylistPath("file:///%5C%5Cattacker.example%5Cshare%5Csong.mp3", fixture), /remote-playlist-path/);
  assert.throws(() => resolvePlaylistPath("\\\\?\\UNC\\attacker.example\\share\\song.mp3", fixture), /remote-playlist-path/);
  assert.throws(() => resolvePlaylistPath(String.raw`\\.\pipe\medo`, fixture), /remote-playlist-path/);
  assert.throws(() => resolvePlaylistPath(String.raw`\??\UNC\attacker.example\share\song.mp3`, fixture), /remote-playlist-path/);
  assert.equal(resolvePlaylistPath("C:\\Music\\Safe.mp3", fixture), "C:\\Music\\Safe.mp3");
  assert.equal(resolvePlaylistPath("file://localhost/C:/Music/Safe.mp3", fixture), "C:\\Music\\Safe.mp3");

  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "medo-zpl-test-"));
  try {
    const unrestricted = path.join(temporary, "unrestricted.zpl");
    const entries = Array.from({ length: 5001 }, (_, index) =>
      `<media src="song-${index}.mp3"/>`
    ).join("");
    const padding = " ".repeat(1024 * 1024 + 1);
    await fs.writeFile(unrestricted, `<smil><body>${entries}</body></smil>${padding}`);
    assert.equal((await parseZpl(unrestricted)).tracks.length, 5001);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
  console.log("ZPL parser tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
