const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");

assert.match(mainSource, /WINDOWS_APP_USER_MODEL_ID\s*=\s*"com\.medomusic\.desktop"/);
assert.match(mainSource, /WINDOWS_TRAY_GUID\s*=\s*"[0-9a-f-]{36}"/i);
assert.match(mainSource, /app\.setAppUserModelId\(WINDOWS_APP_USER_MODEL_ID\)/);
assert.match(mainSource, /new Tray\(trayImage\.resize\([^;]+, trayGuid\)/s);

console.log("Tray identity tests passed");
