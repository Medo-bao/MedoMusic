const os = require('node:os');

let blurApi;
function setLegacyBlur(window, enabled) {
  if (!blurApi) {
    const koffi = require('koffi');
    const policy = koffi.struct({ state: 'int32_t', flags: 'uint32_t', color: 'uint32_t', animation: 'uint32_t' });
    const data = koffi.struct({ attribute: 'int32_t', policy: koffi.pointer(policy), size: 'size_t' });
    const user32 = koffi.load('user32.dll');
    blurApi = {
      set: user32.func('__stdcall', 'SetWindowCompositionAttribute', 'int', ['uintptr_t', koffi.pointer(data)]),
      size: koffi.sizeof(policy)
    };
  }
  const handle = window.getNativeWindowHandle();
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE();
  // WCA_ACCENT_POLICY (19), ACCENT_ENABLE_BLURBEHIND (3).
  // Blur keeps native moving/resizing responsive on Windows 10; acrylic (4)
  // can stall its move loop. The renderer supplies the light/dark tint.
  return Boolean(blurApi.set(hwnd, {
    attribute: 19, policy: { state: enabled ? 3 : 0, flags: 0, color: 0, animation: 0 }, size: blurApi.size
  }));
}

function attachWindowMaterial(window, nativeTheme) {
  const build = Number(os.release().split('.')[2]);
  const supported = process.platform === 'win32' && build >= 10240;
  let material = 'none';
  const publish = () => {
    if (!window.isDestroyed()) window.webContents.send('window:material', material);
  };
  const update = () => {
    if (window.isDestroyed()) return;
    const enabled = supported && !nativeTheme.shouldUseHighContrastColors;
    try {
      if (supported && build >= 22621) {
        window.setBackgroundMaterial(enabled ? 'acrylic' : 'none');
        material = enabled ? 'acrylic' : 'none';
      } else if (supported) {
        material = setLegacyBlur(window, enabled) && enabled ? 'blur' : 'none';
      }
    } catch (error) {
      material = 'none';
      console.warn('Desktop glass unavailable:', error.message);
    }
    window.setBackgroundColor(material === 'none'
      ? (nativeTheme.shouldUseDarkColors ? '#12151c' : '#f1f3f8') : '#00000000');
    publish();
  };
  nativeTheme.on('updated', update);
  window.on('show', update);
  window.webContents.on('did-finish-load', publish);
  window.once('closed', () => nativeTheme.removeListener('updated', update));
  update();
  return { update, get: () => material };
}

module.exports = { attachWindowMaterial };
