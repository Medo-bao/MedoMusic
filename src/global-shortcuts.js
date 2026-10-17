const { validate } = require("./shortcut-keys");
const SHORTCUT_DEFINITIONS = [
  { type: "playPause", label: "播放/暂停", accelerator: "Alt+S", command: "toggle-play" },
  { type: "desktopLyrics", label: "桌面歌词", accelerator: "Alt+W", command: "toggle-desktop-lyrics" },
  { type: "lyricsRefresh", label: "刷新歌词", accelerator: "Alt+D", command: "refresh-lyrics" },
  { type: "previous", label: "上一首", accelerator: "Alt+Q", command: "previous" },
  { type: "next", label: "下一首", accelerator: "Alt+E", command: "next" }
];

function createGlobalShortcutManager(nativeShortcuts, { onCommand, onStateChange, retryDelay = 5000 }) {
  const requested = Object.fromEntries(SHORTCUT_DEFINITIONS.map(({ type }) => [type, true]));
  const bindings = Object.fromEntries(SHORTCUT_DEFINITIONS.map(({ type, accelerator }) => [type, accelerator]));
  const states = new Map();
  let retryTimer = null;
  let stopped = false;
  let lastPublished = "";

  const getState = () => [...states.values()].map(state => ({ ...state }));
  function register(accelerator, definition) {
    try { return nativeShortcuts.register(accelerator, () => {
      if (!stopped && requested[definition.type] && bindings[definition.type] === accelerator) onCommand(definition.command);
    }); }
    catch { return false; }
  }

  function validateBinding(type, value) {
    if (!SHORTCUT_DEFINITIONS.some(item => item.type === type)) return { ok: false, code: "invalid", message: "未知的快捷键功能。" };
    const result = validate(value);
    if (!result.ok) return result;
    const duplicate = SHORTCUT_DEFINITIONS.find(item => item.type !== type && bindings[item.type] === result.accelerator);
    return duplicate ? { ok: false, code: "duplicate", message: `与“${duplicate.label}”快捷键重复，请使用其他组合。` } : result;
  }

  function checkBinding(type, value) {
    if (stopped) return { ok: false, code: "stopped", message: "快捷键服务已停止。" };
    const result = validateBinding(type, value);
    if (!result.ok) return result;
    const active = states.get(type)?.accelerator;
    if (active === result.accelerator && nativeShortcuts.isRegistered(active)) return result;
    let registered = false;
    try { registered = nativeShortcuts.register(result.accelerator, () => {}); }
    catch { /* Invalid or occupied native registrations are reported below. */ }
    if (registered) nativeShortcuts.unregister(result.accelerator);
    return registered ? result : { ok: false, code: "occupied", message: `${result.accelerator} 注册失败，可能被其他程序占用，请换一个组合或释放占用后重新检查。` };
  }

  function reconcile(forcePublish = false) {
    if (stopped) return getState();
    for (const definition of SHORTCUT_DEFINITIONS) {
      const { type, accelerator: defaultAccelerator, label } = definition;
      const preferredAccelerator = bindings[type];
      const previous = states.get(type);
      const active = previous?.accelerator && nativeShortcuts.isRegistered(previous.accelerator)
        ? previous.accelerator : null;
      let accelerator = active;
      if (!requested[type]) {
        if (active) nativeShortcuts.unregister(active);
        accelerator = null;
      } else if (active !== preferredAccelerator) {
        if (register(preferredAccelerator, definition)) {
          if (active) nativeShortcuts.unregister(active);
          accelerator = preferredAccelerator;
        }
      }
      states.set(type, {
        type, label, enabled: requested[type], defaultAccelerator, preferredAccelerator,
        accelerator, registered: Boolean(accelerator)
      });
    }
    const needsRetry = [...states.values()].some(state => state.enabled && !state.registered);
    if (needsRetry && !retryTimer) {
      retryTimer = setInterval(() => reconcile(), retryDelay);
      retryTimer.unref();
    } else if (!needsRetry && retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
    const result = getState();
    const serialized = JSON.stringify(result);
    if (forcePublish || serialized !== lastPublished) {
      lastPublished = serialized;
      onStateChange(result);
    }
    return result;
  }

  return {
    update(settings = {}) {
      if (!states.size && settings.bindings && typeof settings.bindings === "object") {
        const candidates = SHORTCUT_DEFINITIONS.map(item => [item.type, validate(settings.bindings[item.type] ?? item.accelerator)]);
        if (candidates.every(([, result]) => result.ok) && new Set(candidates.map(([, result]) => result.accelerator)).size === candidates.length) {
          for (const [type, result] of candidates) bindings[type] = result.accelerator;
        }
      }
      for (const { type } of SHORTCUT_DEFINITIONS) {
        if (Object.hasOwn(settings, type)) requested[type] = settings[type] !== false;
      }
      return reconcile(true);
    },
    checkBinding,
    setBinding(type, value) {
      if (stopped) return { ok: false, code: "stopped", message: "快捷键服务已停止。" };
      const result = validateBinding(type, value);
      if (!result.ok) return result;
      const definition = SHORTCUT_DEFINITIONS.find(item => item.type === type);
      const previous = states.get(type);
      const active = previous?.accelerator && nativeShortcuts.isRegistered(previous.accelerator) ? previous.accelerator : null;
      if (requested[type]) {
        if (active !== result.accelerator && !register(result.accelerator, definition)) {
          return { ok: false, code: "occupied", message: `${result.accelerator} 无法注册，原快捷键保持不变。请释放占用或选择其他组合。` };
        }
        if (active && active !== result.accelerator) nativeShortcuts.unregister(active);
      } else {
        const checked = checkBinding(type, result.accelerator);
        if (!checked.ok) return checked;
      }
      bindings[type] = result.accelerator;
      states.set(type, { ...previous, accelerator: requested[type] ? result.accelerator : null });
      return { ...result, states: reconcile(true) };
    },
    retry: () => reconcile(),
    getState,
    stop() {
      stopped = true;
      clearInterval(retryTimer);
      retryTimer = null;
      for (const state of states.values()) {
        if (state.accelerator) nativeShortcuts.unregister(state.accelerator);
      }
      states.clear();
    }
  };
}

module.exports = { createGlobalShortcutManager, SHORTCUT_DEFINITIONS };
