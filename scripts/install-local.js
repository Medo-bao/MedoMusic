const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { version } = require("../package.json");

const root = path.resolve(__dirname, "..");
const installer = path.join(
  root,
  "release",
  `MedoMusic-Setup-${version}-x64.exe`
);
const destination = path.join(root, "release");

if (!fs.existsSync(installer)) {
  throw new Error(`Installer not found: ${installer}`);
}

const result = spawnSync(installer, ["/S", `/D=${destination}`], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Installer exited with code ${result.status}`);
}

const executable = path.join(destination, "MedoMusic.exe");
if (!fs.existsSync(executable)) {
  throw new Error(`Installed executable not found: ${executable}`);
}
fs.writeFileSync(
  path.join(destination, ".medomusic-install"),
  JSON.stringify({ product: "MedoMusic", version, installedAt: new Date().toISOString() }, null, 2)
);

console.log(`Installed MedoMusic ${version} to ${destination}`);
