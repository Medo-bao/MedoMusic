const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");

async function run() {
  const root = path.resolve(__dirname, "..");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "medo-listening-time-"));
  const music = path.join(fixture, "Music");
  const artifacts = path.join(__dirname, "artifacts", "listening-time");
  fs.mkdirSync(music);
  fs.mkdirSync(artifacts, { recursive: true });
  const samples = 8000 * 120;
  const wave = Buffer.alloc(44 + samples * 2);
  wave.write("RIFF");
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(samples * 2, 40);
  const songs = ["one", "two"].map(id => ({
    id, path: path.join(music, `${id}.wav`), title: `统计测试 ${id}`,
    artist: "MedoMusic", album: "听歌时长", duration: 120, metadataLoaded: true, playlists: []
  }));
  for (const song of songs) {
    fs.writeFileSync(song.path, wave);
    fs.writeFileSync(song.path.replace(".wav", ".lrc"), "[00:00.00]听歌时长统计");
  }
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
    name: "medo-listening-time-test", version: "1.6.2", main: "bootstrap.cjs"
  }));
  fs.writeFileSync(path.join(fixture, "bootstrap.cjs"), `
    const {app} = require("electron");
    app.setPath("userData", ${JSON.stringify(path.join(fixture, "Profile"))});
    app.setPath("music", ${JSON.stringify(music)});
    require(${JSON.stringify(path.join(root, "src", "main.js"))});
  `);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await _electron.launch({
    executablePath: path.join(root, ".electron-dist", "electron.exe"), args: [fixture], cwd: root, env
  });
  const cases = [];
  const errors = [];
  try {
    const page = await application.firstWindow();
    const chooseMonth = async month => {
      await page.locator("#listening-calendar-month").click();
      await page.locator("#listening-picker-year").fill(String(Number(month.slice(0, 4))));
      await page.locator("#listening-picker-year").dispatchEvent("change");
      await page.locator(`[data-listening-month="${month}"]`).click();
    };
    page.on("pageerror", error => errors.push(error.message));
    await page.waitForFunction(() => localStorage.getItem("medo.initialScanComplete") === "true");
    await page.evaluate(testSongs => {
      applyAutoUpdateSetting(false);
      applyLyricTranslationSetting(false);
      tracks = testSongs;
      playlists = [{ name: "统计测试歌单", trackIds: ["one"] }];
      favorites = new Set(["one"]);
      recent = [];
      playStats = {};
      currentView = "recent";
      currentPlaylist = null;
      currentCollection = null;
      currentSort = "songs";
      playbackQueueIds = ["one", "two"];
      playMode = "list-once";
      audio.muted = true;
      render();
    }, songs);
    assert.equal(await page.locator("#recent-listening-summary").isVisible(), true);
    assert.equal(await page.locator("#recent-listening-time").textContent(), "0 小时 00 分钟");
    assert.equal(await page.locator("#reset-listening-time").isDisabled(), true);
    await page.evaluate(() => playTrack(0, true));
    await page.waitForFunction(() => listeningTimeMs >= 1200);
    await page.evaluate(() => audio.pause());
    await page.waitForFunction(() => listeningPosition === null);
    const paused = await page.evaluate(() => listeningTimeMs);
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => listeningTimeMs), paused, "Pausing must stop the statistic");
    await page.evaluate(() => audio.play());
    await page.waitForFunction(() => listeningPosition !== null);
    await page.evaluate(() => audio.dispatchEvent(new Event("waiting")));
    const waiting = await page.evaluate(() => listeningTimeMs);
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => listeningTimeMs), waiting, "Buffering must not count");
    await page.evaluate(() => audio.dispatchEvent(new Event("playing")));
    await page.waitForFunction(value => listeningTimeMs > value + 350, waiting);
    await page.evaluate(() => audio.pause());
    await page.waitForFunction(() => listeningPosition === null);
    assert.equal(await page.evaluate(() => formatListeningTime(59999)), "0 小时 00 分钟");
    assert.equal(await page.evaluate(() => formatListeningTime(60000)), "0 小时 01 分钟");
    assert.equal(await page.evaluate(() => compactListeningTime(500)), "不足 1 分");
    const rateBefore = await page.evaluate(() => {
      audio.playbackRate = 2;
      return listeningTimeMs;
    });
    await page.evaluate(() => audio.play());
    await page.waitForFunction(() => listeningPosition !== null);
    await page.waitForTimeout(750);
    await page.evaluate(() => audio.pause());
    await page.waitForFunction(() => listeningPosition === null);
    const rateAdded = await page.evaluate(value => listeningTimeMs - value, rateBefore);
    assert.ok(rateAdded >= 500 && rateAdded < 1400, "Double-speed playback must count actual listening time");
    await page.evaluate(() => { audio.playbackRate = 1; });
    cases.push("Minute precision and actual listening time are correct; pause and buffering do not count");
    console.log("1/6: minute precision, playback rates, pause and buffering verified");

    await page.evaluate(() => {
      currentView = "library";
      render();
      seekPlaybackTo(45);
    });
    assert.equal(await page.locator("#recent-listening-summary").isVisible(), false);
    await page.waitForFunction(() => !audio.seeking);
    const beforeSeek = await page.evaluate(() => listeningTimeMs);
    await page.evaluate(() => audio.play());
    await page.waitForFunction(value => listeningTimeMs > value + 350, beforeSeek);
    const beforeForward = await page.evaluate(() => listeningTimeMs);
    await page.evaluate(() => { seekPlaybackTo(95); });
    await page.waitForFunction(() => !audio.seeking);
    const afterForward = await page.evaluate(() => listeningTimeMs);
    assert.ok(afterForward - beforeForward < 500, "A forward seek must not add skipped seconds");
    await page.evaluate(() => { seekPlaybackTo(15); });
    await page.waitForFunction(() => !audio.seeking && listeningPosition !== null);
    const afterBackward = await page.evaluate(() => listeningTimeMs);
    assert.ok(afterBackward >= afterForward, "A backward seek must not subtract time");
    await page.waitForFunction(value => listeningTimeMs > value + 350, afterBackward);
    const beforeSwitch = await page.evaluate(() => listeningTimeMs);
    await page.evaluate(() => playTrack(1, true));
    await page.waitForFunction(value => listeningTimeMs > value + 350, beforeSwitch);
    await page.evaluate(() => audio.pause());
    await page.waitForFunction(() => listeningPosition === null);
    await page.evaluate(() => {
      currentView = "recent";
      render();
    });
    await page.screenshot({ path: path.join(artifacts, "recent-listening-time.png") });
    cases.push("Seeking skips no time, replay counts again and switching songs keeps accumulating");
    console.log("2/6: seeks, replay and track changes verified");

    const expected = await page.evaluate(() => {
      // Exercise a month of listening and a session crossing a local year boundary.
      recordListeningTime(27 * 3600000 + 8 * 60000, new Date(2025, 0, 31, 12).getTime());
      recordListeningTime(2000, new Date(2025, 0, 1, 0, 0, 1).getTime());
      persistListeningTime();
      updateListeningTimeDisplay();
      return { milliseconds: listeningTimeMs, formatted: formatListeningTime(listeningTimeMs), daily: { ...listeningDailyMs } };
    });
    assert.equal(expected.daily["2024-12-31"], 1000);
    assert.equal(expected.daily["2025-01-01"], 1000);
    await page.reload();
    await page.waitForFunction(() => typeof listeningTimeMs === "number" && typeof render === "function");
    assert.ok(Math.abs(await page.evaluate(() => listeningTimeMs) - expected.milliseconds) < 1);
    assert.deepEqual(await page.evaluate(() => listeningDailyMs), expected.daily);
    assert.equal(expected.formatted, "27 小时 08 分钟");
    assert.equal(await page.locator("#recent-listening-time").textContent(), expected.formatted);
    assert.equal(await page.locator("#settings-listening-time").textContent(), expected.formatted);
    await page.locator("#settings-button").click();
    await page.locator("#settings-listening").scrollIntoViewIfNeeded();
    await chooseMonth("2025-01");
    assert.equal(await page.locator(".listening-calendar-day").count(), 31);
    assert.equal(await page.locator("#listening-calendar-month-label").textContent(), "2025年01月");
    assert.equal(await page.locator("#listening-month-time").textContent(), "27 小时 08 分钟");
    assert.equal(await page.locator("#listening-year-time").textContent(), "27 小时 08 分钟");
    await page.locator('[data-listening-date="2025-01-31"]').click();
    assert.equal(await page.locator("#listening-day-time").textContent(), "12 小时 00 分钟");
    await page.screenshot({ path: path.join(artifacts, "listening-calendar-history.png") });
    await page.locator("#listening-calendar-previous").click();
    await page.locator('[data-listening-date="2024-12-31"]').click();
    assert.equal(await page.locator("#listening-day-time").textContent(), "0 小时 00 分钟");
    assert.equal(await page.locator("#listening-month-time").textContent(), "0 小时 00 分钟");
    assert.equal(await page.locator("#listening-year-time").textContent(), "0 小时 00 分钟");
    await chooseMonth("2024-02");
    assert.equal(await page.locator(".listening-calendar-day").count(), 29, "Leap-year calendar must contain February 29");
    await page.locator("#listening-calendar-month").click();
    await page.locator("#listening-picker-year").fill("");
    await page.locator("#listening-picker-year").dispatchEvent("change");
    assert.equal(await page.locator("#listening-picker-year").inputValue(), "2024", "Clearing the year must restore its current value");
    await page.locator("#listening-picker-year").press("Escape");
    await page.evaluate(() => showListeningMonth("0001-01"));
    assert.equal(await page.locator("#listening-calendar-previous").isDisabled(), true);
    assert.equal(await page.locator(".listening-calendar-day").count(), 31);
    await page.evaluate(() => showListeningMonth("9999-12"));
    assert.equal(await page.locator("#listening-calendar-next").isDisabled(), true);
    await page.locator("#listening-calendar-today").click();
    assert.equal(await page.locator("#listening-calendar-next").isDisabled(), true);
    assert.equal(await page.locator("#listening-day-label").textContent(), "今日");
    assert.equal(await page.locator('.listening-calendar-day[aria-current="date"]').getAttribute("aria-pressed"), "true");
    const bounds = await page.locator("#settings-listening").evaluate(element => ({
      width: element.clientWidth, scroll: element.scrollWidth
    }));
    assert.ok(bounds.scroll <= bounds.width + 1, "Calendar and statistics must fit the settings card");
    const rollover = await page.evaluate(() => {
      const OriginalDate = Date;
      const midnight = new OriginalDate(2025, 0, 1, 0, 0, 1).getTime();
      try {
        window.Date = class extends OriginalDate {
          constructor(...args) { super(...(args.length ? args : [midnight])); }
          static now() { return midnight; }
        };
        listeningCalendarToday = "2024-12-31";
        listeningSelectedDate = "2024-12-31";
        listeningCalendarMonth = "2024-12";
        renderListeningCalendar();
        const todaySelection = { date: listeningSelectedDate, month: listeningCalendarMonth };
        listeningCalendarToday = "2024-12-31";
        listeningSelectedDate = "2024-12-30";
        listeningCalendarMonth = "2024-12";
        renderListeningCalendar();
        return { todaySelection, historySelection: listeningSelectedDate };
      } finally {
        window.Date = OriginalDate;
        listeningCalendarToday = listeningDateKey(new Date());
        listeningSelectedDate = listeningCalendarToday;
        showListeningMonth(listeningCalendarToday.slice(0, 7));
      }
    });
    assert.deepEqual(rollover.todaySelection, { date: "2025-01-01", month: "2025-01" });
    assert.equal(rollover.historySelection, "2024-12-30", "Midnight must preserve a historical selection");
    const originalWindowSize = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
    await page.waitForFunction(() => window.innerWidth <= 1100);
    await page.locator("#settings-listening").scrollIntoViewIfNeeded();
    const narrow = await page.locator("#settings-listening").evaluate(element => {
      const statistics = element.querySelector(".listening-statistics");
      const calendar = element.querySelector(".listening-calendar-grid");
      const controls = element.querySelector(".listening-calendar-controls").getBoundingClientRect();
      const today = element.querySelector("#listening-calendar-today").getBoundingClientRect();
      return {
        width: element.clientWidth, scroll: element.scrollWidth,
        columns: getComputedStyle(statistics).gridTemplateColumns.split(" ").length,
        calendarColumns: getComputedStyle(calendar).gridTemplateColumns.split(" ").length,
        controlsRight: controls.right, todayLeft: today.left,
        controlsCenterY: controls.top + controls.height / 2, todayCenterY: today.top + today.height / 2,
        cardHeights: [...statistics.children].map(card => card.getBoundingClientRect().height)
      };
    });
    assert.ok(narrow.scroll <= narrow.width + 1, "Narrow layout must not overflow");
    assert.equal(narrow.columns, 2);
    assert.equal(narrow.calendarColumns, 7);
    assert.ok(narrow.controlsRight < narrow.todayLeft, "Month controls must sit to the left of today");
    assert.ok(Math.abs(narrow.controlsCenterY - narrow.todayCenterY) < 1, "Month controls must align vertically with today");
    assert.ok(Math.max(...narrow.cardHeights) - Math.min(...narrow.cardHeights) < 1, "Statistic cards must have equal heights");
    await page.screenshot({ path: path.join(artifacts, "listening-calendar-narrow.png") });
    await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), originalWindowSize);
    await page.locator("#settings-listening").scrollIntoViewIfNeeded();
    cases.push("Calendar layout, persistence, period totals, leap years, month input and midnight rollover are correct");
    console.log("3/6: calendar layout, navigation, rollover and daily/monthly/yearly totals verified");

    await page.locator("#reset-listening-time").scrollIntoViewIfNeeded();
    assert.equal(await page.locator("#reset-listening-time").isEnabled(), true);
    const preserved = await page.evaluate(() => ({
      recent: [...recent], playStats: { ...playStats }, tracks: tracks.map(track => track.id),
      favorites: [...favorites], playlists: structuredClone(playlists)
    }));
    await page.locator("#reset-listening-time").click();
    await page.locator('dialog[open] button[value="cancel"]').click();
    assert.ok(Math.abs(await page.evaluate(() => listeningTimeMs) - expected.milliseconds) < 1);
    await page.screenshot({ path: path.join(artifacts, "settings-listening-time.png") });
    await page.evaluate(() => audio.play());
    await page.waitForFunction(() => listeningPosition !== null);
    await page.locator("#reset-listening-time").click();
    await page.locator('dialog[open] button[value="confirm"]').click();
    await page.waitForFunction(() => listeningTimeMs < 1000);
    assert.equal(await page.locator("#action-feedback").textContent(), "听歌时长统计已重置");
    assert.ok(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("medo.listeningStats")).dailyMs).reduce((sum, value) => sum + value, 0)) < 1000);
    assert.deepEqual(await page.evaluate(() => ({
      recent: [...recent], playStats: { ...playStats }, tracks: tracks.map(track => track.id),
      favorites: [...favorites], playlists: structuredClone(playlists)
    })), preserved, "Reset must affect only listening duration");
    await page.waitForFunction(() => listeningTimeMs >= 350);
    await page.evaluate(() => audio.pause());
    await page.waitForFunction(() => listeningPosition === null);
    await page.locator("#reset-listening-time").click();
    await page.locator('dialog[open] button[value="confirm"]').click();
    assert.equal(await page.evaluate(() => listeningTimeMs), 0);
    assert.deepEqual(await page.evaluate(() => listeningDailyMs), {});
    for (const id of ["listening-day-time", "listening-month-time", "listening-year-time", "settings-listening-time"]) {
      assert.equal(await page.locator(`#${id}`).textContent(), "0 小时 00 分钟");
    }
    assert.equal(await page.locator("#reset-listening-time").isDisabled(), true);
    await page.reload();
    await page.waitForFunction(() => typeof listeningTimeMs === "number");
    assert.equal(await page.evaluate(() => listeningTimeMs), 0);
    assert.equal(await page.locator("#settings-listening-time").textContent(), "0 小时 00 分钟");
    cases.push("Cancel preserves statistics; confirmed reset clears only duration and live playback keeps counting");
    console.log("4/6: independent reset, cancellation and continued counting verified");

    await page.evaluate(() => {
      listeningDailyMs = {
        "2025-01-01": 60000.4, "2024-02-29": 0.6,
        "2025-02-29": 60000, "2025-13-01": 60000, "0000-01-01": 60000,
        "bad-date": 60000, "2025-01-02": -1, "2025-01-03": "60000",
        "2025-01-04": null, "2025-01-05": 1e308
      };
      localStorage.setItem("medo.listeningStats", JSON.stringify({ dailyMs: listeningDailyMs }));
    });
    await page.reload();
    await page.waitForFunction(() => typeof listeningTimeMs === "number");
    assert.deepEqual(await page.evaluate(() => listeningDailyMs), { "2025-01-01": 60000, "2024-02-29": 1 });
    const fractionResult = await page.evaluate(() => {
      const before = listeningTimeMs;
      const endedAt = new Date(2025, 0, 2, 12).getTime();
      for (let index = 0; index < 12; index += 1) recordListeningTime(0.25, endedAt);
      for (const invalid of [NaN, Infinity, -10, "60000", null]) recordListeningTime(invalid, endedAt);
      recordListeningTime(100, NaN);
      persistListeningTime();
      updateListeningTimeDisplay();
      return {
        added: listeningTimeMs - before, total: listeningTimeMs,
        dailyTotal: Object.values(listeningDailyMs).reduce((sum, value) => sum + value, 0),
        array: normalizeListeningDays([60000]), empty: normalizeListeningDays(null)
      };
    });
    assert.equal(fractionResult.added, 3, "Fractional milliseconds must carry over between samples");
    assert.equal(fractionResult.total, fractionResult.dailyTotal, "Lifetime total must exactly equal the sum of days");
    assert.deepEqual(fractionResult.array, {});
    assert.deepEqual(fractionResult.empty, {});
    await page.reload();
    await page.waitForFunction(() => typeof listeningTimeMs === "number");
    assert.equal(await page.evaluate(() => listeningTimeMs), fractionResult.total);
    cases.push("Corrupt dates and values are ignored; fractional samples persist and lifetime equals daily sums");
    console.log("5/6: corrupt data, fractional accounting and exact persisted totals verified");

    const beforeFailure = await page.evaluate(() => {
      window.originalListeningSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "medo.listeningStats") throw new DOMException("Test storage quota", "QuotaExceededError");
        return window.originalListeningSetItem.call(this, key, value);
      };
      recordListeningTime(60000);
      const before = listeningTimeMs;
      const dailyBefore = JSON.stringify(listeningDailyMs);
      const saved = persistListeningTime();
      const reset = resetListeningTime();
      return { before, dailyBefore, saved, reset, after: listeningTimeMs, dailyAfter: JSON.stringify(listeningDailyMs) };
    });
    assert.equal(beforeFailure.saved, false);
    assert.equal(beforeFailure.reset, false);
    assert.equal(beforeFailure.before, beforeFailure.after);
    assert.equal(beforeFailure.dailyBefore, beforeFailure.dailyAfter, "Failed reset must preserve statistics");
    assert.equal(await page.locator("#action-feedback").textContent(), "听歌统计保存失败，请检查可用存储空间");
    await page.evaluate(() => playTrack(0, true));
    await page.waitForFunction(value => !audio.paused && listeningTimeMs > value + 350, beforeFailure.before);
    await page.evaluate(() => playTrack(1, true));
    await page.waitForFunction(() => tracks[currentIndex]?.id === "two" && !audio.paused && listeningPosition !== null);
    await page.evaluate(() => audio.pause());
    await page.waitForFunction(() => listeningPosition === null);
    const recovery = await page.evaluate(() => {
      Storage.prototype.setItem = window.originalListeningSetItem;
      delete window.originalListeningSetItem;
      const saved = persistListeningTime();
      return {
        saved, failed: listeningStatsSaveFailed, total: listeningTimeMs,
        storedTotal: Object.values(JSON.parse(localStorage.getItem("medo.listeningStats")).dailyMs).reduce((sum, value) => sum + value, 0)
      };
    });
    assert.equal(recovery.saved, true);
    assert.equal(recovery.failed, false);
    assert.equal(recovery.total, recovery.storedTotal);
    assert.equal(await page.evaluate(() => playbackFadeEnabled), false, "Fading is opt-in");
    await page.locator('.playback-fade-option[data-playback-fade-value="on"]').click();
    assert.equal(await page.locator('.playback-fade-option[data-playback-fade-value="on"]').getAttribute("aria-checked"), "true");
    const materials = await page.evaluate(() => {
      const fade = getComputedStyle(document.querySelector(".playback-fade-option.active"));
      const existing = getComputedStyle(document.querySelector(".word-lyrics-option.active"));
      return { fade: [fade.backgroundImage, fade.borderRadius, fade.padding, fade.fontSize],
        existing: [existing.backgroundImage, existing.borderRadius, existing.padding, existing.fontSize] };
    });
    assert.deepEqual(materials.fade, materials.existing, "Fade buttons must share the existing settings button material");
    await page.reload();
    await page.waitForFunction(() => playbackFadeEnabled === true);
    await page.evaluate(() => playTrack(0, true));
    await page.waitForFunction(() => !audio.paused && outputFadeGain?.gain.value >= .99);
    await page.evaluate(() => pausePlayback());
    const fadeOut = await page.evaluate(() => ({ pending: playbackPausePending, paused: audio.paused, target: playbackFadeEnvelope.to }));
    assert.deepEqual(fadeOut, { pending: true, paused: false, target: 0 }, "Pause must fade before stopping audio");
    await page.waitForTimeout(80);
    const reversal = await page.evaluate(async () => {
      const before = playbackFadeValue();
      await resumePlayback();
      return { before, from: playbackFadeEnvelope.from, target: playbackFadeEnvelope.to,
        pending: playbackPausePending, paused: audio.paused };
    });
    assert.ok(reversal.before > 0 && reversal.before < 1, "Fade-out must contain intermediate volume levels");
    assert.ok(Math.abs(reversal.before - reversal.from) < .1, "Rapid play must reverse from the current volume");
    assert.equal(reversal.target, 1);
    assert.equal(reversal.pending, false);
    assert.equal(reversal.paused, false);
    await page.waitForTimeout(320);
    assert.equal(await page.evaluate(() => audio.paused), false, "The cancelled pause must not stop resumed playback");
    await page.evaluate(() => {
      pausePlayback();
      desiredVolume = .37;
      volume.value = desiredVolume;
      applyOutputVolume();
      soundSettings.enabled = true;
      updateSoundSettings();
    });
    await page.waitForFunction(() => audio.paused);
    assert.deepEqual(await page.evaluate(() => ({ volume: desiredVolume, actual: audio.volume })), { volume: .37, actual: .37 });
    const fadeIn = await page.evaluate(async () => {
      await resumePlayback();
      return { from: playbackFadeEnvelope.from, target: playbackFadeEnvelope.to, duration: playbackFadeEnvelope.duration };
    });
    assert.ok(fadeIn.from < .2, "Resuming must start near silence");
    assert.equal(fadeIn.target, 1);
    assert.equal(fadeIn.duration, .24);
    await page.waitForFunction(() => outputFadeGain.gain.value >= .99);
    await page.evaluate(() => {
      pausePlayback();
      nextTrack(1);
    });
    await page.waitForFunction(() => tracks[currentIndex]?.id === "two" && !audio.paused);
    await page.waitForTimeout(320);
    assert.equal(await page.evaluate(() => audio.paused), false, "An old fade-out must not pause the next track");
    await page.evaluate(() => {
      soundSettings.enabled = false;
      updateSoundSettings();
      pausePlayback();
      applyPlaybackFadeSetting(false);
    });
    assert.equal(await page.evaluate(() => audio.paused), true, "Disabling fading must complete a pending pause");
    const immediate = await page.evaluate(async () => {
      await resumePlayback();
      const gain = outputFadeGain.gain.value;
      pausePlayback();
      return { gain, paused: audio.paused, pending: playbackPausePending };
    });
    assert.deepEqual(immediate, { gain: 1, paused: true, pending: false }, "Disabled fading must play and pause immediately");
    await page.locator("#settings-sound").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, "playback-fade-settings.png") });
    cases.push("Storage failure safely recovers; fade settings persist, share materials, reverse smoothly and survive track changes");
    console.log("6/6: storage recovery and optional playback fades, reversal, sound effects and track changes verified");
    assert.deepEqual(errors, []);
    assert.equal(cases.length, 6);
    fs.writeFileSync(path.join(artifacts, "checks.json"), JSON.stringify({ passed: true, cases, errors }, null, 2));
    console.log("Listening time passed: 6/6 scenarios");
  } finally {
    await application.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
