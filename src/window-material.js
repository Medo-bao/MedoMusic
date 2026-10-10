const os = require('node:os');

let blurApi;
let clearApi;
function setClearGlass(window, enabled) {
  if (!clearApi) {
    const koffi = require('koffi');
    const blurBehind = koffi.struct({ flags: 'uint32_t', enabled: 'int32_t', region: 'uintptr_t', transition: 'int32_t' });
    const dwm = koffi.load('dwmapi.dll');
    const gdi = koffi.load('gdi32.dll');
    clearApi = {
      set: dwm.func('__stdcall', 'DwmEnableBlurBehindWindow', 'int32_t', ['uintptr_t', koffi.pointer(blurBehind)]),
      region: gdi.func('uintptr_t __stdcall CreateRectRgn(int left, int top, int right, int bottom)'),
      free: gdi.func('int __stdcall DeleteObject(uintptr_t object)')
    };
  }
  const handle = window.getNativeWindowHandle();
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : handle.readUInt32LE();
  // Register an explicit empty blur region so DWM honors client alpha without
  // retaining the opaque composition left by the previous glass material.
  const region = enabled ? clearApi.region(0, 0, -1, -1) : 0;
  if (enabled && !region) return false;
  try {
    return clearApi.set(hwnd, { flags: enabled ? 3 : 1, enabled: enabled ? 1 : 0, region, transition: 0 }) >= 0;
  } finally {
    if (region) clearApi.free(region);
  }
}
function setLegacyMaterial(window, state) {
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
    attribute: 19, policy: { state, flags: 0, color: 0, animation: 0 }, size: blurApi.size
  }));
}

function attachWindowMaterial(window, nativeTheme, mode = 'frosted') {
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
      if (material === 'transparent') setClearGlass(window, false);
      if (supported && build >= 22621) {
        if (enabled && mode === 'transparent') {
          window.setBackgroundMaterial('none');
          setLegacyMaterial(window, 0);
          material = setClearGlass(window, true) ? 'transparent' : 'none';
        } else {
          setLegacyMaterial(window, 0);
          window.setBackgroundMaterial(enabled ? 'acrylic' : 'none');
          material = enabled ? 'acrylic' : 'none';
        }
      } else if (supported) {
        if (enabled && mode === 'transparent') {
          setLegacyMaterial(window, 0);
          material = setClearGlass(window, true) ? 'transparent' : 'none';
        } else {
          material = setLegacyMaterial(window, enabled ? 3 : 0) && enabled ? 'blur' : 'none';
        }
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
  return {
    update,
    get: () => material,
    set: next => {
      const selected = next === 'transparent' ? 'transparent' : 'frosted';
      if (selected !== mode) { mode = selected; update(); }
      return material;
    }
  };
}

module.exports = { attachWindowMaterial };
