const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");
const { fittedScale } = require("../src/window-scaling");

async function run() {
  const root = path.resolve(__dirname, "..");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "medo-calendar-scaling-"));
  const artifacts = path.join(__dirname, "artifacts", "calendar-scaling");
  fs.mkdirSync(path.join(fixture, "Music"));
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
    name: "calendar-scaling-check", version: "1.6.2", main: "bootstrap.cjs"
  }));
  fs.writeFileSync(path.join(fixture, "bootstrap.cjs"), `
    const {app} = require("electron");
    app.setPath("userData", ${JSON.stringify(path.join(fixture, "Profile"))});
    app.setPath("music", ${JSON.stringify(path.join(fixture, "Music"))});
    require(${JSON.stringify(path.join(root, "src/main.js"))});
  `);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: path.join(root, ".electron-dist", "electron.exe"), args: [fixture], cwd: root, env
  });
  const cases = [];
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on("pageerror", error => errors.push(error.message));
    await page.waitForFunction(() => localStorage.getItem("medo.initialScanComplete") === "true");
    await page.evaluate(() => {
      applyAutoUpdateSetting(false);
      currentView = "settings";
      render();
      recordListeningTime(2.5 * 3600000, new Date(2024, 1, 29, 12).getTime());
      updateListeningTimeDisplay();
    });

    for (const content of [
      { width: 0, height: 640 }, { width: 960, height: 0 },
      { width: NaN, height: 640 }, { width: 960, height: Infinity }
    ]) assert.equal(fittedScale(1, content), null);
    assert.ok(fittedScale(1, { width: 1, height: 1 }) > 0);
    const transient = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.interfaceScaling);
      const originalBounds = window.getContentBounds;
      const originalZoom = window.webContents.setZoomFactor;
      const factors = [];
      const before = window.webContents.getZoomFactor();
      window.webContents.setZoomFactor = function (factor) {
        factors.push(factor);
        if (!Number.isFinite(factor) || factor <= 0) throw new Error("Invalid zoom factor");
        return originalZoom.call(this, factor);
      };
      try {
        for (const content of [{ width: 0, height: 0 }, { width: 1280, height: 0 }]) {
          window.getContentBounds = () => content;
          window.emit("resize");
          window.emit("move");
          window.interfaceScaling.set(2);
        }
        const during = window.webContents.getZoomFactor();
        window.getContentBounds = originalBounds;
        window.emit("restore");
        return { before, during, factors, after: window.webContents.getZoomFactor() };
      } finally {
        window.getContentBounds = originalBounds;
        window.webContents.setZoomFactor = originalZoom;
        window.interfaceScaling.set(1);
      }
    });
    assert.equal(transient.during, transient.before, "Transient zero content must preserve the valid zoom");
    assert.ok(transient.after > 0 && transient.factors.every(factor => Number.isFinite(factor) && factor > 0));
    cases.push("Transient zero or invalid content preserves valid scaling and never sends zero to Electron");
    console.log("1/6: zero-size scaling regression verified");

    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.interfaceScaling);
      window.minimize();
    });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.interfaceScaling);
      if (!window.isMinimized()) throw new Error("Window did not minimize");
      window.interfaceScaling.set(1.25);
    });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.interfaceScaling);
      window.restore();
      window.show();
      window.focus();
    });
    for (const scale of [.8, 1, 2]) {
      await page.evaluate(scale => window.medo.setWindowScale(scale), scale);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.interfaceScaling).maximize());
      await page.waitForTimeout(120);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.interfaceScaling).unmaximize());
      await page.waitForTimeout(120);
      const state = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(window => window.interfaceScaling);
        return { zoom: window.webContents.getZoomFactor(), content: window.getContentBounds() };
      });
      assert.equal(state.zoom, fittedScale(scale, state.content));
      assert.ok(Number.isFinite(state.zoom) && state.zoom > 0);
    }
    await page.evaluate(() => window.medo.setWindowScale(1));
    cases.push("Minimize, restore, maximize and unmaximize remain valid at multiple requested scales");
    console.log("2/6: native window transitions and scaling verified");

    await page.locator("#settings-listening").scrollIntoViewIfNeeded();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.locator("#listening-calendar-month").click();
      await page.waitForFunction(() => document.querySelector("#listening-calendar-month").getAttribute("aria-expanded") === "true");
      assert.equal(await page.locator("#listening-picker-months button").count(), 12);
      assert.equal(await page.locator('input[type="month"]').count(), 0);
      const material = await page.locator("#listening-month-picker").evaluate(picker => {
        const reference = document.createElement("div");
        reference.className = "glass-menu";
        document.body.append(reference);
        const properties = ["background", "backdropFilter", "borderColor", "borderRadius", "boxShadow"];
        const current = getComputedStyle(picker);
        const shared = getComputedStyle(reference);
        const result = { current: properties.map(property => current[property]), shared: properties.map(property => shared[property]),
          bounds: picker.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight };
        reference.remove();
        return result;
      });
      assert.deepEqual(material.current, material.shared, "Month picker must use the shared popup material");
      assert.ok(material.bounds.left >= 8 && material.bounds.top >= 8);
      assert.ok(material.bounds.right <= material.width - 7 && material.bounds.bottom <= material.height - 7);
      await page.screenshot({ path: path.join(artifacts, `month-picker-${theme}.png`) });
      await page.locator("#listening-month-picker").press("Escape");
    }
    cases.push("Month picker uses the shared glass material in both themes and fits inside the window");
    console.log("3/6: themed popup material and placement verified");

    await page.locator("#listening-calendar-month").click();
    await page.locator("#listening-picker-year").fill("2024");
    await page.locator("#listening-picker-year").press("Enter");
    await page.locator('[data-listening-month="2024-02"]').click();
    assert.equal(await page.locator("#listening-calendar-month-label").textContent(), "2024年02月");
    assert.equal(await page.locator(".listening-calendar-day").count(), 29);
    await page.locator('[data-listening-date="2024-02-29"]').click();
    for (const id of ["listening-day-time", "listening-month-time", "listening-year-time", "settings-listening-time"]) {
      assert.equal(await page.locator(`#${id}`).textContent(), "2 小时 30 分钟");
    }
    await page.locator("#listening-calendar-month").click();
    for (const invalid of ["", "0", "9999"]) {
      await page.locator("#listening-picker-year").fill(invalid);
      await page.locator("#listening-picker-year").press("Enter");
      assert.equal(await page.locator("#listening-picker-year").inputValue(), "2024");
    }
    await page.locator("#listening-picker-year").fill("1");
    await page.locator("#listening-picker-year").press("Enter");
    assert.equal(await page.locator("#listening-picker-previous-year").isDisabled(), true);
    await page.locator('[data-listening-month="0001-01"]').click();
    assert.equal(await page.locator(".listening-calendar-day").count(), 31);
    await page.locator("#listening-calendar-month").click();
    await page.locator("#listening-picker-current").click();
    const today = await page.evaluate(() => listeningDateKey(new Date()));
    assert.equal(await page.locator("#listening-day-label").textContent(), "今日");
    await page.locator("#listening-calendar-month").click();
    assert.equal(await page.locator("#listening-picker-next-year").isDisabled(), true);
    for (const button of await page.locator("#listening-picker-months button").all()) {
      const month = await button.getAttribute("data-listening-month");
      assert.equal(await button.isDisabled(), month > today.slice(0, 7));
    }
    await page.locator("#listening-month-picker").press("Escape");
    cases.push("Month/year selection handles leap years, invalid years, boundaries and future months without changing statistics");
    console.log("4/6: year input, month selection and calendar statistics verified");

    await page.locator("#listening-calendar-month").focus();
    await page.locator("#listening-calendar-month").press("Enter");
    await page.waitForFunction(() => document.querySelector("#listening-month-picker").matches(":popover-open"));
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.listeningMonth), `${today.slice(0, 4)}-06`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector("#listening-month-picker").matches(":popover-open"));
    assert.equal(await page.evaluate(() => document.activeElement.id), "listening-calendar-month");
    await page.locator("#listening-calendar-month").click();
    await page.waitForFunction(() => document.activeElement.matches("#listening-picker-months button"));
    await page.keyboard.press("End");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.listeningMonth), today.slice(0, 7));
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.activeElement.id), "listening-calendar-month");
    await page.locator("#listening-calendar-month").click();
    await page.locator("#settings-listening-title").click();
    await page.waitForFunction(() => !document.querySelector("#listening-month-picker").matches(":popover-open"));
    cases.push("Keyboard month navigation, Escape, outside click and focus restoration work correctly");
    console.log("5/6: keyboard navigation, dismissal and focus verified");

    await page.evaluate(() => {
      applyTheme("light");
      listeningSelectedDate = listeningDateKey(new Date());
      showListeningMonth(listeningSelectedDate.slice(0, 7));
    });
    for (const [name, width, columns] of [["wide", 1280, 4], ["narrow", 1000, 2]]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(window => window.interfaceScaling).setSize(width, 800), width);
      await page.waitForTimeout(250);
      await page.locator("#settings-listening").scrollIntoViewIfNeeded();
      const layout = await page.locator("#settings-listening").evaluate(card => {
        const stats = card.querySelector(".listening-statistics");
        const trigger = card.querySelector("#listening-calendar-month");
        const label = trigger.querySelector("span");
        const textRange = document.createRange();
        textRange.selectNodeContents(label);
        const text = textRange.getBoundingClientRect();
        const labelBounds = label.getBoundingClientRect();
        const icon = trigger.querySelector("svg").getBoundingClientRect();
        const triggerBounds = trigger.getBoundingClientRect();
        const controls = card.querySelector(".listening-calendar-controls").getBoundingClientRect();
        const today = card.querySelector("#listening-calendar-today").getBoundingClientRect();
        return {
          columns: getComputedStyle(stats).gridTemplateColumns.split(" ").length,
          height: stats.getBoundingClientRect().height,
          statsOverflow: stats.scrollWidth - stats.clientWidth,
          itemOverflow: [...stats.children].map(item => item.scrollWidth - item.clientWidth),
          cardOverflow: card.scrollWidth - card.clientWidth,
          textOffset: Math.abs(text.left + text.width / 2 - labelBounds.left - labelBounds.width / 2),
          iconGap: icon.left - labelBounds.right,
          iconCenterOffset: Math.abs(icon.top + icon.height / 2 - triggerBounds.top - triggerBounds.height / 2),
          todayGap: today.left - controls.right
        };
      });
      assert.equal(layout.columns, columns);
      assert.ok(layout.height <= (columns === 4 ? 55 : 108), "Statistic strip must remain compact");
      assert.ok(layout.statsOverflow <= 1 && layout.cardOverflow <= 1 && layout.itemOverflow.every(value => value <= 1));
      assert.ok(layout.textOffset < 1 && layout.iconGap >= 7 && layout.iconCenterOffset < 1);
      assert.ok(layout.todayGap > 0 && layout.todayGap <= 16);
      await page.screenshot({ path: path.join(artifacts, `compact-calendar-${name}.png`) });
    }
    cases.push("Compact statistics and centered month text reserve icon space and fit both normal and narrow windows");
    console.log("6/6: compact statistics, text/icon spacing and responsive layout verified");
    assert.deepEqual(errors, []);
    assert.equal(cases.length, 6);
    fs.writeFileSync(path.join(artifacts, "checks.json"), JSON.stringify({ passed: true, cases, errors }, null, 2));
    console.log("Calendar and scaling passed: 6/6 scenarios");
  } finally {
    await app.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
