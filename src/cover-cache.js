const fs = require("node:fs/promises");
const path = require("node:path");

// The metadata index owns at most 1,200 covers. Consult live references so a
// metadata read completing during cleanup cannot lose its newly written cover.
async function pruneCoverCache(directory, isReferenced) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{40}\.jpg$/.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    if (!isReferenced(filePath)) await fs.rm(filePath, { force: true }).catch(() => {});
  }
}

module.exports = { pruneCoverCache };
