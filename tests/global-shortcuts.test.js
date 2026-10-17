const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createGlobalShortcutManager, SHORTCUT_DEFINITIONS } = require("../src/global-shortcuts");
const { validate } = require("../src/shortcut-keys");

function fixture(blockedKeys = [], options = {}) {
  const blocked = new Set(blockedKeys), owned = new Map(), calls = [], commands = [], changes = [];
  const native = {
    register(key, callback) {
      calls.push(["register", key]);
      if (blocked.has(key) || owned.has(key)) return false;
      owned.set(key, callback); return true;
    },
    isRegistered: key => owned.has(key),
    unregister(key) { calls.push(["unregister", key]); owned.delete(key); }
  };
  const manager = createGlobalShortcutManager(native, {
    onCommand: command => commands.push(command),
    onStateChange: states => { changes.push(states); options.onStateChange?.(states); },
    retryDelay: options.retryDelay || 5000
  });
  return { blocked, owned, calls, commands, changes, manager, status: type => manager.getState().find(item => item.type === type) };
}

test("1: combination normalization, invalid/reserved keys and common-key warnings; no fallback definitions", () => {
  assert.equal(validate("shift+control+alt+k").accelerator, "Ctrl+Alt+Shift+K");
  assert.equal(validate("alt+F24").accelerator, "Alt+F24");
  assert.equal(validate("Ctrl+Space").code, "reserved");
  for (const value of ["K", "Shift+K", "Ctrl+Alt", "Ctrl+Ctrl+K", "Alt+K+L", "Win+K", null]) assert.equal(validate(value).ok, false);
  assert.equal(validate("Alt+F4").code, "reserved");
  assert.match(validate("Ctrl+C").warning, /复制/);
  assert.equal(SHORTCUT_DEFINITIONS.length, 5);
  assert.equal(SHORTCUT_DEFINITIONS.some(item => Object.hasOwn(item, "fallback")), false);
  const state = fixture();
  try {
    state.manager.update();
    assert.deepEqual([...state.owned.keys()], ["Alt+S", "Alt+W", "Alt+D", "Alt+Q", "Alt+E"]);
    assert.equal(state.manager.getState().some(item => Object.hasOwn(item, "fallbackAccelerator")), false);
  } finally { state.manager.stop(); }
});

test("2: duplicate and native-conflict checks preserve current keys; valid edits switch commands atomically", () => {
  const state = fixture(["Ctrl+Alt+J"]);
  try {
    state.manager.update();
    state.manager.update({ previous: false });
    assert.equal(state.manager.checkBinding("playPause", "Alt+Q").code, "duplicate");
    assert.equal(state.manager.checkBinding("playPause", "Ctrl+Alt+J").code, "occupied");
    assert.equal(state.manager.setBinding("playPause", "Ctrl+Alt+J").ok, false);
    assert.equal(state.status("playPause").accelerator, "Alt+S");
    assert.equal(state.owned.has("Alt+S"), true);
    const oldCallback = state.owned.get("Alt+S");
    assert.equal(state.manager.checkBinding("playPause", "Ctrl+Alt+K").ok, true);
    assert.equal(state.owned.has("Ctrl+Alt+K"), false);
    assert.equal(state.manager.setBinding("playPause", "Ctrl+Alt+K").ok, true);
    assert.equal(state.owned.has("Alt+S"), false);
    oldCallback();
    assert.deepEqual(state.commands, []);
    state.owned.get("Ctrl+Alt+K")();
    assert.deepEqual(state.commands, ["toggle-play"]);
    for (const definition of SHORTCUT_DEFINITIONS.slice(1)) {
      const candidate = `Ctrl+Alt+${definition.type === "desktopLyrics" ? "L" : definition.type === "lyricsRefresh" ? "R" : definition.type === "previous" ? "P" : "N"}`;
      state.manager.update({ [definition.type]: true });
      assert.equal(state.manager.setBinding(definition.type, candidate).ok, true);
      state.owned.get(candidate)();
    }
    assert.deepEqual(state.commands, SHORTCUT_DEFINITIONS.map(item => item.command));
  } finally { state.manager.stop(); }
});

test("3: startup restores unique custom bindings; disabled edits stay disabled and invalid stored maps do not apply", () => {
  const state = fixture();
  try {
    state.manager.update({ playPause: false, bindings: { playPause: "Ctrl+Alt+K", desktopLyrics: "Alt+S" } });
    assert.equal(state.status("playPause").preferredAccelerator, "Ctrl+Alt+K");
    assert.equal(state.status("desktopLyrics").accelerator, "Alt+S");
    assert.equal(state.manager.setBinding("playPause", "Ctrl+Shift+F8").ok, true);
    assert.equal(state.owned.has("Ctrl+Shift+F8"), false);
    assert.equal(state.status("playPause").enabled, false);
    state.manager.update({ playPause: true });
    assert.equal(state.owned.has("Ctrl+Shift+F8"), true);
    assert.equal(state.status("playPause").defaultAccelerator, "Alt+S");
    const copy = state.manager.getState(); copy[0].preferredAccelerator = "changed";
    assert.equal(state.status("playPause").preferredAccelerator, "Ctrl+Shift+F8");
  } finally { state.manager.stop(); }
  const invalid = fixture();
  try {
    invalid.manager.update({ bindings: { playPause: "Alt+Q" } });
    assert.equal(invalid.status("playPause").preferredAccelerator, "Alt+S");
  } finally { invalid.manager.stop(); }
});

test("4: occupied custom keys automatically retry without alternatives; disabling/stopping removes only owned keys", async () => {
  let recover;
  const recovery = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Custom key recovery did not run")), 1000);
    recover = () => { clearTimeout(timeout); resolve(); };
  });
  const state = fixture(["Ctrl+Alt+K"], { retryDelay: 20, onStateChange(states) {
    if (states.find(item => item.type === "playPause")?.registered) recover();
  } });
  try {
    state.manager.update({ bindings: { playPause: "Ctrl+Alt+K" } });
    assert.equal(state.status("playPause").registered, false);
    assert.equal(state.owned.size, 4);
    for (let index = 0; index < 3; index++) state.manager.retry();
    assert.equal(state.calls.some(([, key]) => key.includes("F1") || key === "Alt+Shift+W"), false);
    state.blocked.clear(); await recovery;
    assert.equal(state.status("playPause").accelerator, "Ctrl+Alt+K");
    const callback = state.owned.get("Ctrl+Alt+K");
    state.manager.update({ playPause: false }); callback();
    assert.deepEqual(state.commands, []);
    state.owned.set("unrelated", () => {});
    state.manager.stop();
    assert.deepEqual([...state.owned.keys()], ["unrelated"]);
    const count = state.calls.length;
    state.manager.retry();
    assert.equal(state.manager.checkBinding("playPause", "Ctrl+Alt+K").ok, false);
    assert.equal(state.manager.setBinding("playPause", "Ctrl+Alt+K").ok, false);
    assert.equal(state.calls.length, count);
  } finally { state.manager.stop(); }
});
