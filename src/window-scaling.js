// Electron window bounds use logical pixels; Windows handles the monitor DPI.
const MIN_WIDTH = 960;
const MIN_HEIGHT = 640;
const SCALE_OPTIONS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

function startupBounds(area) {
  const width = Math.min(area.width, Math.max(MIN_WIDTH, Math.min(1280, area.width - 48)));
  const height = Math.min(area.height, Math.max(MIN_HEIGHT, Math.min(820, area.height - 48)));
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width, height,
    minWidth: Math.min(MIN_WIDTH, area.width),
    minHeight: Math.min(MIN_HEIGHT, area.height)
  };
}

function fittedScale(requested, bounds) {
  if (!Number.isFinite(requested) || requested <= 0 ||
      !Number.isFinite(bounds.width) || bounds.width <= 0 ||
      !Number.isFinite(bounds.height) || bounds.height <= 0) return null;
  return Math.max(.001, Math.floor(Math.min(requested, bounds.width / MIN_WIDTH, bounds.height / MIN_HEIGHT) * 1000) / 1000);
}

function attachWindowScaling(window, screen) {
  let requested = 1;
  let displayId = null;
  const state = () => ({ requested, effective: window.webContents.getZoomFactor() });
  const update = (fit = false) => {
    if (window.isDestroyed() || window.webContents.isDestroyed() || window.isMinimized()) return;
    const bounds = window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    fit ||= displayId !== null && displayId !== display.id;
    displayId = display.id;
    const area = display.workArea;
    const minimum = [Math.min(MIN_WIDTH, area.width), Math.min(MIN_HEIGHT, area.height)];
    if (window.getMinimumSize().some((value, index) => value !== minimum[index])) window.setMinimumSize(...minimum);
    if (fit && !window.isMaximized() && !window.isMinimized()) {
      const width = Math.min(bounds.width, area.width);
      const height = Math.min(bounds.height, area.height);
      const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width));
      const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
      if (x !== bounds.x || y !== bounds.y || width !== bounds.width || height !== bounds.height) {
        window.setBounds({ x, y, width, height });
      }
    }
    const effective = fittedScale(requested, window.getContentBounds());
    if (effective === null) return;
    if (Math.abs(window.webContents.getZoomFactor() - effective) > 0.0001) window.webContents.setZoomFactor(effective);
    window.webContents.send("window:scale", state());
  };
  const resize = () => update();
  const displayChanged = () => update(true);
  window.on("resize", resize);
  window.on("move", resize);
  window.on("restore", resize);
  window.on("show", resize);
  window.on("maximize", resize);
  window.on("unmaximize", resize);
  window.webContents.on("did-finish-load", resize);
  for (const event of ["display-metrics-changed", "display-added", "display-removed"]) screen.on(event, displayChanged);
  window.once("closed", () => {
    for (const event of ["display-metrics-changed", "display-added", "display-removed"]) screen.removeListener(event, displayChanged);
  });
  update();
  return {
    set(value) {
      requested = SCALE_OPTIONS.includes(Number(value)) ? Number(value) : 1;
      update();
      return state();
    }
  };
}

module.exports = { startupBounds, fittedScale, attachWindowScaling };
