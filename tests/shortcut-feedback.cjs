const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");

async function run() {
  const root = path.resolve(__dirname, "..");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "medo-custom-shortcuts-"));
  const artifacts = path.join(__dirname, "artifacts", "custom-shortcuts");
  fs.mkdirSync(path.join(fixture, "Music")); fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "medo-custom-shortcuts-test", version: require("../package.json").version, main: "bootstrap.cjs" }));
  fs.writeFileSync(path.join(fixture, "bootstrap.cjs"), `
    const { app, globalShortcut } = require("electron");
    app.setPath("userData", ${JSON.stringify(path.join(fixture, "Profile"))});
    app.setPath("music", ${JSON.stringify(path.join(fixture, "Music"))});
    const fixture = globalThis.__shortcuts = { blocked: new Set(), owned: new Map(), attempts: [] };
    globalShortcut.register = (key, callback) => { fixture.attempts.push(key); if (fixture.blocked.has(key) || fixture.owned.has(key)) return false; fixture.owned.set(key, callback); return true; };
    globalShortcut.isRegistered = key => fixture.owned.has(key);
    globalShortcut.unregister = key => fixture.owned.delete(key);
    const shortcuts = require(${JSON.stringify(path.join(root, "src/global-shortcuts.js"))});
    const create = shortcuts.createGlobalShortcutManager;
    shortcuts.createGlobalShortcutManager = (native, options) => fixture.manager = create(native, options);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ tag_name: "v${require("../package.json").version}" }) });
    require(${JSON.stringify(path.join(root, "src/main.js"))});
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let application, page;
  const errors = [], checks = [];
  async function launch() {
    application = await _electron.launch({ executablePath: path.join(root, ".electron-dist", "electron.exe"), args: [fixture], cwd: root, env });
    page = await application.firstWindow();
    page.on("pageerror", error => errors.push(error.message));
    await page.waitForFunction(() => lastShortcutStates.size === 5 && localStorage.getItem("medo.initialScanComplete") === "true");
    await page.evaluate(() => { applyAutoUpdateSetting(false); currentView = "settings"; render(); });
  }
  const row = type => page.locator(type === "playPause" ? ".global-play-shortcut-setting" : type === "desktopLyrics" ? ".global-desktop-lyrics-shortcut-setting" : ".global-previous-shortcut-setting");
  async function draft(type, modifiers, key) {
    const editor = row(type).locator(".shortcut-editor");
    for (const modifier of ["Ctrl", "Alt", "Shift"]) {
      const label = editor.locator(`.shortcut-modifiers label:has(input[value="${modifier}"])`);
      if (await label.locator("input").isChecked() !== modifiers.includes(modifier)) await label.click();
    }
    await editor.locator(".shortcut-key-input").fill(key);
    await page.waitForFunction(type => {
      const selector = type === "playPause" ? ".global-play-shortcut-setting" : ".global-desktop-lyrics-shortcut-setting";
      return document.querySelector(`${selector} .shortcut-editor`).dataset.checkState !== "checking";
    }, type);
    return editor;
  }
  async function save(type, accelerator) {
    await row(type).locator(".shortcut-save").click();
    await page.waitForFunction(({ type, accelerator }) => lastShortcutStates.get(type).preferredAccelerator === accelerator, { type, accelerator });
    assert.equal(await row(type).locator(".shortcut-editor").count(), 0);
  }
  try {
    await launch();
    assert.equal(await page.locator(".shortcut-edit").count(), 5);
    assert.equal(await page.locator("#settings-shortcuts").textContent().then(text => text.includes("备用")), false);
    await row("playPause").locator(".shortcut-edit").click();
    let editor = await draft("playPause", ["Ctrl", "Alt"], "K");
    assert.match(await editor.locator(".shortcut-draft").textContent(), /Ctrl\+Alt\+K/);
    assert.match(await editor.locator(".shortcut-check-message").textContent(), /检查通过/);
    await save("playPause", "Ctrl+Alt+K");
    assert.deepEqual(await application.evaluate(() => ({ current: __shortcuts.owned.has("Ctrl+Alt+K"), old: __shortcuts.owned.has("Alt+S") })), { current: true, old: false });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("medo.globalShortcutBindings")).playPause), "Ctrl+Alt+K");
    checks.push("5/10: five custom controls, combination builder, real IPC save and persisted binding without alternatives"); console.log(checks.at(-1));

    await row("previous").locator('[data-enabled="false"]').click();
    await row("playPause").locator(".shortcut-edit").click();
    editor = await draft("playPause", ["Alt"], "Q");
    assert.match(await editor.locator(".shortcut-check-message").textContent(), /上一首.*重复/);
    assert.equal(await editor.locator(".shortcut-save").isDisabled(), true);
    editor = await draft("playPause", ["Ctrl", "Alt"], "J");
    assert.equal(await editor.locator(".shortcut-save").isEnabled(), true);
    await application.evaluate(() => __shortcuts.blocked.add("Ctrl+Alt+J"));
    await editor.locator(".shortcut-save").click();
    await page.waitForFunction(() => document.querySelector(".shortcut-check-message").textContent.includes("原快捷键保持不变"));
    assert.equal(await application.evaluate(() => __shortcuts.owned.has("Ctrl+Alt+K")), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("medo.globalShortcutBindings")).playPause), "Ctrl+Alt+K");
    await editor.locator(".shortcut-cancel").click();
    await application.evaluate(() => { __shortcuts.blocked.add("Alt+W"); __shortcuts.owned.delete("Alt+W"); __shortcuts.manager.retry(); });
    await page.waitForFunction(() => lastShortcutStates.get("desktopLyrics").registered === false);
    assert.match(await row("desktopLyrics").locator(".shortcut-conflict strong").textContent(), /Alt\+W 无法启用/);
    assert.equal(await application.evaluate(() => __shortcuts.manager.getState().some(state => "fallback" in state)), false);
    checks.push("6/10: duplicate checks include disabled actions; save rechecks native conflicts and retains old key"); console.log(checks.at(-1));

    await row("playPause").locator(".shortcut-edit").click();
    editor = await draft("playPause", ["Ctrl"], "C");
    assert.match(await editor.locator(".shortcut-check-message").textContent(), /复制/);
    editor = await draft("playPause", ["Ctrl", "Alt"], "Delete");
    assert.match(await editor.locator(".shortcut-check-message").textContent(), /系统常用/);
    assert.equal(await editor.locator(".shortcut-save").isDisabled(), true);
    await editor.locator(".shortcut-key-input").press("Escape");
    assert.equal(await row("playPause").locator("kbd").textContent(), "Ctrl+Alt+K");
    await row("playPause").locator(".shortcut-edit").click();
    await row("playPause").locator(".shortcut-default").click();
    await page.waitForFunction(() => document.querySelector(".shortcut-save").disabled === false);
    await save("playPause", "Alt+S");
    await row("playPause").locator(".shortcut-edit").click();
    await draft("playPause", ["Ctrl", "Shift"], "F8"); await save("playPause", "Ctrl+Shift+F8");
    await row("desktopLyrics").locator('[data-enabled="false"]').click();
    await row("desktopLyrics").locator(".shortcut-edit").click();
    await draft("desktopLyrics", ["Ctrl", "Alt"], "L"); await save("desktopLyrics", "Ctrl+Alt+L");
    assert.equal(await application.evaluate(() => __shortcuts.owned.has("Ctrl+Alt+L")), false);
    checks.push("7/10: common-key warning, reserved-key rejection, Esc cancellation, restore default and editing while disabled"); console.log(checks.at(-1));

    await application.close(); application = null; await launch();
    assert.equal(await row("playPause").locator("kbd").textContent(), "Ctrl+Shift+F8");
    assert.equal(await row("desktopLyrics").locator("kbd").textContent(), "Ctrl+Alt+L");
    assert.equal(await row("desktopLyrics").getAttribute("data-shortcut-state"), "disabled");
    assert.equal(await application.evaluate(() => __shortcuts.owned.has("Ctrl+Shift+F8")), true);
    await row("playPause").locator(".shortcut-edit").click();
    await draft("playPause", ["Ctrl", "Alt", "Shift"], "F8");
    await page.evaluate(() => { const toast = document.querySelector("#action-feedback"); if (toast) toast.hidden = true; });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await row("playPause").screenshot({ path: path.join(artifacts, `editor-${theme}.png`) });
    }
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.interfaceScaling).setSize(1000, 760));
    await row("playPause").scrollIntoViewIfNeeded();
    assert.equal(await row("playPause").locator(".shortcut-editor").evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    await row("playPause").screenshot({ path: path.join(artifacts, "editor-narrow.png") });
    checks.push("8/10: process restart restores bindings and enable flags; light/dark and narrow editor layout"); console.log(checks.at(-1));
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(artifacts, "ui-checks.json"), JSON.stringify({ total: 4, passed: checks.length, checks, errors }, null, 2));
  } finally { if (application) await application.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
