const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pruneCoverCache } = require("../src/cover-cache");

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "medo-cover-cache-"));
  try {
    const names = ["a".repeat(40) + ".jpg", "b".repeat(40) + ".jpg", "c".repeat(40) + ".jpg", "notes.txt"];
    await Promise.all(names.map(name => fs.writeFile(path.join(directory, name), "fixture")));
    const referenced = new Set([path.join(directory, names[0]), path.join(directory, names[2])]);
    await fs.mkdir(path.join(directory, "d".repeat(40) + ".jpg"));
    await pruneCoverCache(directory, file => referenced.has(file));
    assert.deepEqual((await fs.readdir(directory)).sort(), [names[0], names[2], names[3], "d".repeat(40) + ".jpg"].sort());
    referenced.clear();
    await pruneCoverCache(directory, file => referenced.has(file));
    assert.deepEqual((await fs.readdir(directory)).sort(), [names[3], "d".repeat(40) + ".jpg"].sort());
    console.log("Cover cache passed: referenced and pending files retained; stale owned files removed; unmanaged files and directories preserved");
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
