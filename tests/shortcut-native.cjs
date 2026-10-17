const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");
const root = path.resolve(__dirname, "..");
const artifacts = path.join(__dirname, "artifacts", "custom-shortcuts");
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;

async function helper(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), name));
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0", main: "main.cjs" }));
  fs.writeFileSync(path.join(directory, "main.cjs"), `const { app } = require('electron'); app.setPath('userData', ${JSON.stringify(path.join(directory, "Profile"))}); app.whenReady().then(() => {});`);
  const application = await _electron.launch({ executablePath: path.join(root, ".electron-dist", "electron.exe"), args: [directory], env });
  await application.evaluate(async ({ app }) => { await app.whenReady(); });
  return application;
}

async function native() {
  let holder, application;
  try {
    holder = await helper("medo-hotkey-holder-");
    const occupied = await holder.evaluate(({ globalShortcut }) => ["Ctrl+Alt+Shift+F2", "Ctrl+Alt+Shift+F4", "Ctrl+Alt+Shift+F6"].find(key => globalShortcut.register(key, () => {})));
    assert.ok(occupied, "No free key for the isolated conflict holder");
    application = await helper("medo-hotkey-check-");
    const evidence = await application.evaluate(({ globalShortcut }, { source, occupied }) => {
      const createRequire = process.getBuiltinModule("module").createRequire;
      const manager = globalThis.__nativeManager = createRequire(source)(source).createGlobalShortcutManager(globalShortcut, { onCommand() {}, onStateChange() {} });
      manager.update({ playPause: false, desktopLyrics: false, lyricsRefresh: false, previous: false, next: false });
      const original = ["Ctrl+Alt+Shift+F1", "Ctrl+Alt+Shift+F5", "Ctrl+Alt+Shift+F7"].find(key => manager.setBinding("playPause", key).ok);
      manager.update({ playPause: true });
      const check = manager.checkBinding("playPause", occupied);
      const rejected = manager.setBinding("playPause", occupied);
      return { original, originalActive: globalShortcut.isRegistered(original), check, rejected, state: manager.getState().find(item => item.type === "playPause") };
    }, { source: path.join(root, "src", "global-shortcuts.js"), occupied });
    assert.ok(evidence.original && evidence.originalActive);
    assert.equal(evidence.check.code, "occupied");
    assert.equal(evidence.rejected.ok, false);
    assert.equal(evidence.state.accelerator, evidence.original);
    await holder.evaluate(({ globalShortcut }, key) => globalShortcut.unregister(key), occupied);
    const recovered = await application.evaluate(({ globalShortcut }, key) => {
      const check = __nativeManager.checkBinding("playPause", key);
      const probeReleased = !globalShortcut.isRegistered(key);
      const saved = __nativeManager.setBinding("playPause", key);
      const active = globalShortcut.isRegistered(key);
      __nativeManager.stop();
      return { check, probeReleased, saved: saved.ok, active, cleaned: !globalShortcut.isRegistered(key) };
    }, occupied);
    assert.equal(recovered.check.ok, true);
    assert.equal(recovered.probeReleased && recovered.saved && recovered.active && recovered.cleaned, true);
    fs.writeFileSync(path.join(artifacts, "native-checks.json"), JSON.stringify({ scenario: 9, passed: true, occupied, evidence, recovered }, null, 2));
    console.log("9/10: actual Windows conflict with a separate process, rejected save preserves old key, release/recheck/save succeeds");
  } finally {
    if (application) await application.close();
    if (holder) await holder.close();
  }
}

async function packaged(output) {
  const asar = require("@electron/asar");
  const unpacked = path.join(path.resolve(root, output), "win-unpacked");
  const bundle = path.join(unpacked, "resources", "app.asar");
  const version = require("../package.json").version;
  assert.equal(JSON.parse(asar.extractFile(bundle, "package.json")).version, version);
  const files = ["src/global-shortcuts.js", "src/shortcut-keys.js", "src/shortcut-settings.js", "src/renderer.js", "src/styles.css", "src/index.html", "src/main.js", "src/preload.js"];
  for (const file of files) assert.ok(asar.extractFile(bundle, file).equals(fs.readFileSync(path.join(root, file))), `Packaged source differs: ${file}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "medo-shortcut-packaged-"));
  let application;
  try {
    application = await _electron.launch({ executablePath: path.join(unpacked, "MedoMusic.exe"), args: [`--user-data-dir=${profile}`], env });
    const identity = await application.evaluate(({ app }) => ({ version: app.getVersion(), profile: app.getPath("userData") }));
    assert.equal(identity.version, version);
    assert.equal(path.resolve(identity.profile).toLowerCase(), profile.toLowerCase());
    const page = await application.firstWindow(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.waitForFunction(() => lastShortcutStates.size === 5);
    await page.evaluate(() => { applyAutoUpdateSetting(false); currentView = "settings"; render(); });
    assert.equal(await page.locator(".shortcut-edit").count(), 5);
    const result = await page.evaluate(async () => {
      for (const candidate of ["Ctrl+Alt+Shift+F2", "Ctrl+Alt+Shift+F4", "Ctrl+Alt+Shift+F6"]) {
        const check = await window.medo.checkGlobalShortcut("playPause", candidate);
        if (check.ok) return window.medo.setGlobalShortcut("playPause", candidate);
      }
      throw new Error("No free custom key for packaged smoke check");
    });
    assert.equal(result.ok, true);
    await page.waitForFunction(key => lastShortcutStates.get("playPause").preferredAccelerator === key, result.accelerator);
    assert.equal(await application.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), result.accelerator), true);
    assert.equal(result.states.some(item => "fallback" in item || "fallbackAccelerator" in item), false);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("medo.globalShortcutBindings")).playPause), result.accelerator);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(artifacts, "package-checks.json"), JSON.stringify({ scenario: 10, passed: true, identity, files, result, errors }, null, 2));
    console.log(`10/10: packaged ${version} starts with exact sources, five editors, native custom-key checking/save and no alternatives`);
  } finally { if (application) await application.close(); }
}

fs.mkdirSync(artifacts, { recursive: true });
(process.argv[2] === "--packaged" ? packaged(process.argv[3]) : native()).catch(error => { console.error(error); process.exitCode = 1; });
