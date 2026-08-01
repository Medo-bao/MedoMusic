const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const destination = path.resolve(root, "release");
const expected = path.join(root, "release");

if (destination !== expected || path.dirname(destination) !== root) {
  throw new Error(`Refusing to clean unexpected directory: ${destination}`);
}

fs.mkdirSync(destination, { recursive: true });
const marker = path.join(destination, ".medomusic-install");
const existingEntries = fs.readdirSync(destination, { withFileTypes: true });
if (existingEntries.length && !fs.existsSync(marker)) {
  const legacyInstall = fs.existsSync(path.join(destination, "MedoMusic.exe")) &&
    fs.existsSync(path.join(destination, "Uninstall MedoMusic.exe"));
  const builderOutput = fs.existsSync(path.join(destination, "win-unpacked")) &&
    existingEntries.some((entry) => /^MedoMusic-Setup-\d+\.\d+\.\d+-x64\.exe(?:\.blockmap)?$/.test(entry.name));
  if (!legacyInstall && !builderOutput) {
    throw new Error(`Refusing to clean unmarked directory: ${destination}`);
  }
}
for (const entry of existingEntries) {
  const target = path.join(destination, entry.name);
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

console.log(`Cleaned previous MedoMusic installation files from ${destination}`);
