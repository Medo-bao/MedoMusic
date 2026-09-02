const path = require("node:path");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function run() {
  const root = path.resolve(__dirname, "..");
  const artifacts = path.join(__dirname, "artifacts");
  const startupOnly = process.env.MEDO_STARTUP_ONLY === "1";
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__lyricRequests = [];
    window.__mediaPlayCalls = 0;
    window.__folderScanCalls = 0;
    window.__globalShortcutSettings = [];
    HTMLMediaElement.prototype.load = function load() {
      queueMicrotask(() => this.dispatchEvent(new Event("canplay")));
    };
    HTMLMediaElement.prototype.play = async function play() { window.__mediaPlayCalls += 1; };
    HTMLMediaElement.prototype.pause = function pause() {};
    window.medo = {
      chooseFiles: async () => [],
      chooseFolder: async () => ({
        folder: "E:\\Music",
        tracks: Array.from({ length: 1000 }, (_, index) => ({
          id: `E:\\Music\\Demo-${index}.mp3`,
          path: `E:\\Music\\Demo-${index}.mp3`,
          url: `file:///E:/Music/Demo-${index}.mp3`,
          title: `Demo ${index}`,
          album: "Music",
          artist: "Demo Artist",
          format: "MP3",
          playlists: [],
          sourceDirectory: "E:\\Music",
          metadataLoaded: true
        }))
      }),
      scanFolder: async () => { window.__folderScanCalls += 1; return null; },
      setWatchedMusicFolders: (folders) => { window.__watchedMusicFolders = [...folders]; },
      onLibraryFolderChanged: (callback) => { window.__libraryFolderChanged = callback; return () => {}; },
      discoverDefaultLibrary: async () => ({ folder: null, tracks: [], playlists: [] }),
      choosePlaylist: async () => ({
        name: "夜间驾驶",
        path: "E:\\Music\\夜间驾驶.zpl",
        tracks: [
          {
            id: "E:\\Music\\One.mp3",
            path: "E:\\Music\\One.mp3",
            url: "file:///E:/Music/One.mp3",
            title: "One",
            album: "Album",
            artist: "Artist",
            format: "MP3",
            playlists: ["夜间驾驶"],
            duration: 180,
            metadataLoaded: true
          },
          {
            id: "E:\\Music\\Two.mp3",
            path: "E:\\Music\\Two.mp3",
            url: "file:///E:/Music/Two.mp3",
            title: "Two",
            album: "Album",
            artist: "Artist",
            format: "MP3",
            playlists: ["夜间驾驶"],
            duration: 240,
            metadataLoaded: true
          }
        ]
      }),
      chooseCover: async () => "file:///E:/Music/custom-cover.jpg",
      chooseTargetPlaylist: async () => null,
      clearMetadataCache: async () => {},
      getExternalTracks: async () => [],
      getLyricsWindowState: async () => ({ locked: false, visible: false }),
      lockLyricsWindow: () => {},
      onLyricsWindowLockState: () => () => {},
      readLyrics: async (options) => {
        window.__lyricRequests.push({ ...options });
        return { text: "[00:00.00]Demo lyric", source: options.ignoreLocal ? `${options.mode}-line` : "sidecar" };
      },
      resetLyricsWindowPosition: () => {},
      resolveMediaSource: async () => "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
      setLyricsWindowSize: () => {},
      setTrayMuted: () => {},
      showPlaylistMenu: async () => null,
      showTrackMenu: async () => null,
      showTrackProperties: async (filePath) => ({ name: "Demo.mp3", path: filePath, extension: "MP3", size: 1024 }),
      showTrackInFolder: async () => true,
      toggleLyricsWindow: () => {},
      translateLyrics: async () => [],
      updateLyricsWindow: () => {},
      setCloseBehavior: () => {},
      setTrayEnabled: (enabled) => { window.__trayEnabled = enabled; },
      setGlobalShortcuts: (settings) => window.__globalShortcutSettings.push({ ...settings }),
      onLyricsWindowVisibility: () => () => {},
      onResolvedTheme: () => () => {},
      onOpenAudioFiles: () => () => {},
      onMyFireflyCommand: () => () => {},
      respondToMyFirefly: () => {},
      onTrayCommand: () => () => {},
      loadPlaylist: async () => null,
      readMetadata: async () => null,
      setTitleBarTheme: () => {},
      minimizeWindow: () => {},
      toggleMaximizeWindow: () => {},
      onWindowMaximized: (callback) => { window.__setMaximized = callback; },
      closeWindow: () => {},
      getAppInfo: async () => ({
        name: "MedoMusic",
        version: "0.1.8",
        electron: "39.8.10",
        chromium: "142.0.0",
        node: "22.0.0",
        platform: "win32",
        arch: "x64",
        installDirectory: "E:\\Medo_music\\release"
      }),
      checkForUpdates: async () => ({ currentVersion: "1.4.0", latestVersion: "1.4.0", updateAvailable: false })
    };
  });

  if (startupOnly) {
    await page.addInitScript(() => {
      const tracks = Array.from({ length: 1000 }, (_, index) => ({
        id: `E:\\Music\\Startup-${index}.mp3`,
        path: `E:\\Music\\Startup-${index}.mp3`,
        title: `Startup ${index}`,
        album: "Startup Album",
        artist: "Startup Artist",
        format: "MP3",
        playlists: [],
        sourceDirectory: "E:\\Music",
        metadataLoaded: true
      }));
      localStorage.setItem("medo.tracks", JSON.stringify(tracks));
      localStorage.setItem("medo.musicFolders", JSON.stringify(["E:\\Music"]));
      localStorage.setItem("medo.initialScanComplete", "true");
      localStorage.setItem("medo.indexSchema", "2");
    });
  }

  const navigationStarted = Date.now();
  await page.goto(pathToFileURL(path.join(root, "src", "index.html")).href);
  await page.waitForFunction(() => typeof window.__setMaximized === "function");
  await page.evaluate(() => window.__setMaximized(true));
  assert.equal(await page.locator("#window-maximize").getAttribute("aria-label"), "还原");
  assert.equal(await page.locator("#window-maximize").evaluate((button) => button.classList.contains("is-maximized")), true);
  await page.evaluate(() => window.__setMaximized(false));
  assert.equal(await page.locator("#window-maximize").getAttribute("aria-label"), "最大化");
  assert.equal(await page.locator("#window-maximize").evaluate((button) => button.classList.contains("is-maximized")), false);
  if (startupOnly) {
    const snapshot = await page.evaluate(() => ({
      rows: document.querySelectorAll(".track-row").length,
      covers: [...document.querySelectorAll(".row-cover")].map((image) => ({
        loading: image.loading,
        decoding: image.decoding,
        naturalWidth: image.naturalWidth
      })),
      total: document.querySelector("#track-count")?.textContent,
      errors: window.__folderScanCalls
    }));
    if (snapshot.rows !== 48 || snapshot.total !== "1000 首歌曲") {
      throw new Error(`Startup library was not segmented: ${JSON.stringify(snapshot)}`);
    }
    if (snapshot.covers.some((cover) => cover.loading !== "lazy" || cover.decoding !== "async")) {
      throw new Error(`Startup covers are not lazily decoded at full source quality: ${JSON.stringify(snapshot.covers[0])}`);
    }
    if (errors.length) throw new Error(`Startup browser errors: ${errors.join(" | ")}`);
    console.log(`Startup UI smoke passed; 1000-track navigation: ${Date.now() - navigationStarted}ms; initial rows: ${snapshot.rows}`);
    await browser.close();
    return;
  }
  const parsedNativeLyrics = await page.evaluate(() => ({
    yrc: parseLyrics('{"t":1000,"c":[{"tx":"作词: "},{"tx":"测试作者"}]}\n[2000,1000](2000,500,0)逐(2500,500,0)字', 5),
    qrc: parseLyrics('[2000,1000]逐(2000,500)字(2500,500)', 5)
  }));
  if (parsedNativeLyrics.yrc.lines[0]?.text !== "作词: 测试作者" || parsedNativeLyrics.yrc.lines[0]?.start !== 1) {
    throw new Error("YRC JSON credit line was not preserved");
  }
  if (parsedNativeLyrics.yrc.lines[1]?.words?.length !== 2 || parsedNativeLyrics.qrc.lines[0]?.words?.length !== 2) {
    throw new Error("YRC or QRC word timing parsing failed");
  }
  if (await page.locator("#volume-percent").textContent() !== "70%") throw new Error("Default volume percentage mismatch");
  await page.locator("#volume").hover();
  await page.waitForTimeout(220);
  if (Number(await page.locator("#volume-percent").evaluate((element) => getComputedStyle(element).opacity)) < .95) throw new Error("Volume percentage is not visible on hover");
  await page.locator("#volume").evaluate((element) => {
    element.value = "0.75";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (await page.locator("#volume-percent").textContent() !== "75%") throw new Error("Volume percentage did not update");
  if (!await page.locator(".volume-control").evaluate((element) => element.classList.contains("adjusting"))) {
    throw new Error("Volume percentage bubble did not appear while adjusting");
  }
  await page.waitForTimeout(900);
  if (await page.locator(".volume-control").evaluate((element) => element.classList.contains("adjusting"))) {
    throw new Error("Volume percentage bubble did not hide after adjustment");
  }
  await page.locator(".menu-button").click();
  if (!await page.locator(".app-shell").evaluate((element) => element.classList.contains("sidebar-collapsed"))) {
    throw new Error("Sidebar collapse failed");
  }
  await page.locator(".menu-button").click();
  await page.locator("#settings-button").click();
  if (!await page.locator("#settings-panel").isVisible()) {
    const mainClass = await page.locator("main").getAttribute("class");
    throw new Error(`Settings panel is hidden; main=${mainClass}; browser=${errors.join(" | ")}`);
  }
  if (await page.locator(".settings-action").count() !== 3) throw new Error("Settings actions mismatch");
  await page.locator("#check-for-updates").click();
  if (await page.locator("#check-for-updates span:last-child").textContent() !== "\u8f6f\u4ef6\u5df2\u6700\u65b0") throw new Error("Update check latest state mismatch");
  if (await page.locator("#about-version").innerText() !== "MedoMusic 0.1.8") throw new Error("App info mismatch");
  if (await page.locator(".page-header .header-actions").count() !== 0) throw new Error("Header actions remain");
  if (await page.locator(".theme-option").count() !== 3) throw new Error("Theme options mismatch");
  if (await page.locator(".lyric-source-option").count() !== 0) throw new Error("Manual lyric source options remain in settings");
  if (await page.locator(".global-play-shortcut-option").count() !== 2 ||
      await page.locator(".global-lyrics-shortcut-option").count() !== 2 ||
      await page.locator(".global-previous-shortcut-option").count() !== 2 ||
      await page.locator(".global-next-shortcut-option").count() !== 2) {
    throw new Error("Global shortcut settings are incomplete");
  }
  await page.locator('.global-lyrics-shortcut-option[data-enabled="false"]').click();
  const shortcutSettings = await page.evaluate(() => window.__globalShortcutSettings.at(-1));
  if (shortcutSettings?.playPause !== true || shortcutSettings?.lyricsRefresh !== false ||
      shortcutSettings?.previous !== true || shortcutSettings?.next !== true) {
    throw new Error(`Global shortcut setting did not persist: ${JSON.stringify(shortcutSettings)}`);
  }
  if (await page.locator('[data-theme-value="system"]').innerText().then((text) => !text.includes("跟随系统"))) {
    throw new Error("System theme option missing");
  }
  if (await page.locator(".app-info > div").count() !== 2) throw new Error("About details mismatch");
  if (!await page.locator("#tray-setting").isHidden() || await page.evaluate(() => window.__trayEnabled) !== true) {
    throw new Error("Tray is not forced on while minimizing to tray");
  }
  await page.locator('.close-behavior-option[data-close-value="quit"]').click();
  if (await page.locator("#tray-setting").isHidden()) throw new Error("Tray setting did not appear for quit behavior");
  await page.locator('.tray-option[data-tray-value="true"]').click();
  if (await page.evaluate(() => window.__trayEnabled) !== true || await page.locator('.tray-option[data-tray-value="true"]').getAttribute("aria-checked") !== "true") {
    throw new Error("Tray enable setting failed");
  }
  await page.locator('.tray-option[data-tray-value="false"]').click();
  if (await page.evaluate(() => window.__trayEnabled) !== false || await page.locator('.tray-option[data-tray-value="false"]').getAttribute("aria-checked") !== "true") {
    throw new Error("Tray disable setting failed");
  }
  await page.locator('.close-behavior-option[data-close-value="background"]').click();
  if (!await page.locator("#tray-setting").isHidden() || await page.evaluate(() => window.__trayEnabled) !== true) {
    throw new Error("Minimize-to-tray did not force tray on and hide its setting");
  }

  await page.locator('[data-theme-value="light"]').click();
  if (await page.locator("html").getAttribute("data-theme") !== "light") throw new Error("Light theme failed");
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(artifacts, "settings-light.png"), fullPage: true });
  await page.locator(".about-group").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, "settings-about.png") });

  await page.locator("#settings-add-folder").click();
  if (await page.locator(".folder-row").count() !== 1) throw new Error("Folder was not added");
  if (!await page.evaluate(() => window.__watchedMusicFolders?.includes("E:\\Music"))) throw new Error("Managed music folder watcher was not registered");
  await page.evaluate(() => window.__libraryFolderChanged("E:\\Music"));
  await page.waitForFunction(() => window.__folderScanCalls > 0);
  await page.locator('[data-view="library"]').click();
  await page.locator("#search-input").fill("Demo 99");
  await page.waitForFunction(() => document.querySelectorAll(".track-row").length === 11);
  if (await page.locator("#search-input").evaluate((element) => document.activeElement !== element)) throw new Error("Automatic search unexpectedly blurred the search field");
  await page.locator("#search-input").fill("Demo 999");
  await page.locator("#search-input").press("Enter");
  if (await page.locator(".track-row").count() !== 1) throw new Error("Enter did not immediately finish the pending search");
  if (await page.locator("#search-input").evaluate((element) => document.activeElement === element)) throw new Error("Enter did not leave the search field");
  await page.locator("#search-input").fill("");
  await page.locator("#search-input").press("Enter");
  await page.waitForTimeout(150);
  const restoredSearch = await page.evaluate(() => ({
    value: document.querySelector("#search-input").value,
    rows: document.querySelectorAll(".track-row").length
  }));
  if (restoredSearch.value !== "" || restoredSearch.rows !== 48) throw new Error(`Clearing search did not restore the initial library window: ${JSON.stringify(restoredSearch)}`);
  const initialCoverLoading = await page.locator(".row-cover").first().evaluate((image) => ({
    loading: image.loading,
    decoding: image.decoding
  }));
  if (initialCoverLoading.loading !== "lazy" || initialCoverLoading.decoding !== "async") {
    throw new Error(`Track covers are not deferred without changing quality: ${JSON.stringify(initialCoverLoading)}`);
  }
  await page.locator(".track-row").first().click();
  await page.waitForTimeout(250);
  if (!await page.locator(".track-row").first().evaluate((element) => element.classList.contains("selected"))) {
    throw new Error("Track selection failed");
  }
  await page.locator(".track-row").first().locator(".row-play").click();
  await page.locator("#open-playback-detail").click();
  if (!await page.locator("#playback-detail").isVisible()) throw new Error("Playback detail is hidden");
  await page.locator("#lyrics-lines").evaluate((container) => {
    window.__lyricsFixtureState = {
      html: container.innerHTML,
      className: container.className,
      transform: container.style.transform
    };
    container.className = "lyrics-lines";
    container.style.transform = "translateY(0px)";
    container.innerHTML = Array.from({ length: 24 }, (_, index) =>
      `<button class="lyric-line" data-start="${index}">滚动边界测试歌词 ${index + 1}</button>`
    ).join("");
  });
  await page.locator(".lyrics-stage").dispatchEvent("wheel", { deltaY: 100000 });
  const lastLyricCenterDelta = await page.locator(".lyrics-stage").evaluate((stage) => {
    const line = stage.querySelector(".lyric-line:last-child");
    const stageRect = stage.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    return Math.abs(lineRect.top + lineRect.height / 2 - (stageRect.top + stageRect.height / 2));
  });
  if (lastLyricCenterDelta > 2) throw new Error(`Last lyric cannot be fully reached: ${lastLyricCenterDelta}`);
  await page.locator(".lyrics-stage").dispatchEvent("wheel", { deltaY: -100000 });
  const firstLyricCenterDelta = await page.locator(".lyrics-stage").evaluate((stage) => {
    const line = stage.querySelector(".lyric-line:first-child");
    const stageRect = stage.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    return Math.abs(lineRect.top + lineRect.height / 2 - (stageRect.top + stageRect.height / 2));
  });
  if (firstLyricCenterDelta > 2) throw new Error(`First lyric cannot be fully reached: ${firstLyricCenterDelta}`);
  await page.locator("#lyrics-lines .lyric-line:first-child").dblclick();
  await page.locator("#lyrics-lines").evaluate((container) => {
    const state = window.__lyricsFixtureState;
    container.innerHTML = state.html;
    container.className = state.className;
    container.style.transform = state.transform;
    delete window.__lyricsFixtureState;
  });
  const queueItemCount = await page.locator(".queue-item").count();
  if (queueItemCount !== 20) throw new Error(`Playback queue window mismatch: ${queueItemCount}`);
  const queueRowsOverlap = await page.locator(".queue-item").evaluateAll((items) => items.some((item, index) => {
    if (!items[index + 1]) return false;
    return item.getBoundingClientRect().bottom > items[index + 1].getBoundingClientRect().top + .5;
  }));
  if (queueRowsOverlap) throw new Error("Playback queue rows overlap");
  if (!await page.locator("#detail-refresh-lyrics").isVisible()) throw new Error("Queue lyric refresh is hidden");
  if (!await page.evaluate(() => window.__lyricRequests.some((request) => request.mode === "auto" && request.ignoreLocal === false))) {
    throw new Error("Normal lyric mode did not prefer local lyrics before QQ Music fallback");
  }
  await page.locator('[data-word-lyrics-value="on"]').evaluate((element) => element.click());
  await page.waitForFunction(() => window.__lyricRequests.at(-1)?.mode === "network" && window.__lyricRequests.at(-1)?.ignoreLocal === true && window.__lyricRequests.at(-1)?.requireWordTiming === true);
  await page.locator('[data-word-lyrics-value="off"]').evaluate((element) => element.click());
  await page.waitForFunction(() => window.__lyricRequests.at(-1)?.mode === "auto" && window.__lyricRequests.at(-1)?.ignoreLocal === false);
  await page.locator("#detail-refresh-lyrics").click();
  await page.waitForFunction(() => window.__lyricRequests.at(-1)?.mode === "netease" && window.__lyricRequests.at(-1)?.ignoreLocal === true);
  await page.locator("#detail-refresh-lyrics").click();
  await page.waitForFunction(() => window.__lyricRequests.at(-1)?.mode === "qq" && window.__lyricRequests.at(-1)?.ignoreLocal === true);
  await page.locator("#detail-queue-list").evaluate((element) => {
    element.scrollTop = 700 * 64;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.waitForFunction(() => Number(document.querySelector(".queue-index")?.textContent) > 600);
  const distantQueueScroll = await page.locator("#detail-queue-list").evaluate((element) => element.scrollTop);
  if (distantQueueScroll < 30000) throw new Error("Playback queue scroll position was reset");
  await page.locator("#next-button").click();
  await page.waitForFunction(() => Boolean(document.querySelector(".queue-item.active")) && document.querySelector("#detail-queue-list").scrollTop < 200);
  if (await page.locator("#detail-queue-count").innerText() !== "1000 首歌曲") throw new Error("Playback queue total mismatch");
  await page.locator("body").press("Escape");
  await page.waitForFunction(() => !document.querySelector("main")?.classList.contains("playback-detail-open"));
  const playCallsBeforeShortcut = await page.evaluate(() => window.__mediaPlayCalls);
  await page.locator("body").press("Space");
  if (await page.evaluate(() => window.__mediaPlayCalls) !== playCallsBeforeShortcut + 1) throw new Error("Space playback shortcut failed");
  await page.locator("#search-input").focus();
  await page.locator("#search-input").press("Space");
  if (await page.evaluate(() => window.__mediaPlayCalls) !== playCallsBeforeShortcut + 1) throw new Error("Space shortcut intercepted text input");
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    const audio = document.querySelector("#audio");
    Object.defineProperty(audio, "duration", { configurable: true, value: 120 });
    let currentTime = 30;
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value) => { currentTime = Number(value); }
    });
  });
  await page.locator("body").press("ArrowRight");
  if (await page.locator("#audio").evaluate((audio) => audio.currentTime) !== 35) throw new Error("Right arrow seek shortcut failed");
  await page.locator("body").press("ArrowLeft");
  if (await page.locator("#audio").evaluate((audio) => audio.currentTime) !== 30) throw new Error("Left arrow seek shortcut failed");
  await page.locator("#volume").evaluate((control) => { control.value = "0.7"; control.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.locator("body").press("ArrowUp");
  if (await page.locator("#volume").inputValue() !== "0.75") throw new Error("Up arrow volume shortcut failed");
  await page.locator("body").press("ArrowDown");
  if (await page.locator("#volume").inputValue() !== "0.7") throw new Error("Down arrow volume shortcut failed");
  await page.locator('[data-view="recent"]').click();
  if (!await page.locator(".play-count").first().isVisible()) throw new Error("Recent play count is hidden");
  await page.locator('[data-sort="artists"]').click();
  if (await page.locator(".collection-card").count() !== 1) throw new Error("Recent artist cards mismatch");
  await page.locator("#settings-button").click();
  await page.locator("#header-playlist").click();
  if (!await page.locator("#playlist-hero").isVisible()) throw new Error("Playlist detail is hidden");
  if (await page.locator("#playlist-name").innerText() !== "夜间驾驶") throw new Error("Playlist name mismatch");
  if (!await page.locator("#playlist-meta").innerText().then((text) => text.includes("2 首歌曲"))) {
    throw new Error("Playlist metadata mismatch");
  }
  await page.screenshot({ path: path.join(artifacts, "playlist-detail.png"), fullPage: true });

  const timings = await page.evaluate(async () => {
    const library = document.querySelector('[data-view="library"]');
    const settings = document.querySelector("#settings-button");
    const start = performance.now();
    library.click();
    await new Promise(requestAnimationFrame);
    const libraryMs = performance.now() - start;
    const settingsStart = performance.now();
    settings.click();
    await new Promise(requestAnimationFrame);
    return {
      libraryMs,
      settingsMs: performance.now() - settingsStart
    };
  });
  if (timings.libraryMs >= 1000) throw new Error(`Large library was slow: ${timings.libraryMs.toFixed(1)}ms`);
  if (timings.settingsMs >= 1000) throw new Error(`Settings entry was slow: ${timings.settingsMs.toFixed(1)}ms`);

  await page.locator('[data-theme-value="dark"]').click();
  if (await page.locator("html").getAttribute("data-theme") !== "dark") throw new Error("Dark theme failed");
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(artifacts, "settings-dark.png"), fullPage: true });
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);

  const inactiveLyricColors = await page.evaluate(() => {
    const previousTheme = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = "light";
    const plain = document.createElement("span");
    plain.className = "lyric-line near";
    plain.textContent = "plain";
    const karaoke = document.createElement("span");
    karaoke.className = "lyric-line near";
    karaoke.innerHTML = '<span class="lyric-karaoke"><span class="lyric-karaoke-base">karaoke</span></span>';
    document.body.append(plain, karaoke);
    const colors = {
      plain: getComputedStyle(plain).color,
      karaoke: getComputedStyle(karaoke.querySelector(".lyric-karaoke-base")).color
    };
    plain.remove();
    karaoke.remove();
    document.documentElement.dataset.theme = previousTheme;
    return colors;
  });
  if (inactiveLyricColors.plain !== inactiveLyricColors.karaoke) {
    throw new Error(`Inactive karaoke color changed: ${JSON.stringify(inactiveLyricColors)}`);
  }
  await page.evaluate(() => {
    const stage = document.createElement("section");
    stage.id = "inspection-hover-fixture";
    stage.className = "lyrics-stage inspecting";
    stage.innerHTML = '<div class="lyrics-lines"><button class="lyric-line past">上一句歌词</button><button class="lyric-line">鼠标指向的歌词</button><button class="lyric-line active">当前歌词</button></div>';
    document.body.append(stage);
  });
  const inspectionLines = page.locator("#inspection-hover-fixture .lyric-line");
  await inspectionLines.nth(1).hover();
  await page.waitForTimeout(180);
  const inspectionHover = await page.evaluate(() => {
    const lines = [...document.querySelectorAll("#inspection-hover-fixture .lyric-line")];
    const hovered = getComputedStyle(lines[1]);
    const sibling = getComputedStyle(lines[0]);
    return {
      hoveredOpacity: Number(hovered.opacity),
      siblingOpacity: Number(sibling.opacity),
      background: hovered.backgroundColor,
      shadow: hovered.boxShadow
    };
  });
  await page.locator("#inspection-hover-fixture").evaluate((element) => element.remove());
  if (inspectionHover.hoveredOpacity < .99 || inspectionHover.siblingOpacity >= inspectionHover.hoveredOpacity ||
      inspectionHover.background === "rgba(0, 0, 0, 0)" || inspectionHover.shadow === "none") {
    throw new Error(`Lyric inspection hover feedback is incomplete: ${JSON.stringify(inspectionHover)}`);
  }
  const longLyricLayers = await page.evaluate(() => {
    const line = document.createElement("span");
    line.className = "lyric-line active";
    line.style.width = "260px";
    const text = "这是一句很长很长并且需要在详情页自动换行但两层必须始终完全重合的测试歌词";
    line.innerHTML = `<span class="lyric-karaoke"><span class="lyric-karaoke-base"></span><span class="lyric-karaoke-fill"></span></span>`;
    line.querySelector(".lyric-karaoke-base").textContent = text;
    line.querySelector(".lyric-karaoke-fill").textContent = text;
    document.body.append(line);
    const base = line.querySelector(".lyric-karaoke-base").getBoundingClientRect();
    const fill = line.querySelector(".lyric-karaoke-fill").getBoundingClientRect();
    const result = { baseX: base.x, fillX: fill.x, baseY: base.y, fillY: fill.y, baseWidth: base.width, fillWidth: fill.width, baseHeight: base.height, fillHeight: fill.height };
    line.remove();
    return result;
  });
  if (Math.abs(longLyricLayers.baseX - longLyricLayers.fillX) > .5 ||
      Math.abs(longLyricLayers.baseY - longLyricLayers.fillY) > .5 ||
      Math.abs(longLyricLayers.baseWidth - longLyricLayers.fillWidth) > .5 ||
      Math.abs(longLyricLayers.baseHeight - longLyricLayers.fillHeight) > .5) {
    throw new Error(`Long detail lyric layers are misaligned: ${JSON.stringify(longLyricLayers)}`);
  }
  const translatedKaraokeProgress = await page.evaluate(() => {
    const line = document.createElement("span");
    line.className = "lyric-line active";
    line.style.setProperty("--line-progress", "42%");
    line.innerHTML = `
      <span class="lyric-karaoke"><span class="lyric-karaoke-base">Original</span><span class="lyric-karaoke-fill">Original</span></span>
      <span class="lyric-translation lyric-karaoke lyric-translation-karaoke"><span class="lyric-karaoke-base">翻译</span><span class="lyric-karaoke-fill">翻译</span></span>`;
    document.body.append(line);
    const fills = [...line.querySelectorAll(".lyric-karaoke-fill")].map((element) => getComputedStyle(element).clipPath);
    line.remove();
    return fills;
  });
  if (translatedKaraokeProgress.length !== 2 || translatedKaraokeProgress[0] !== translatedKaraokeProgress[1] || translatedKaraokeProgress[0] === "none") {
    throw new Error(`Detail translation does not share word progress: ${JSON.stringify(translatedKaraokeProgress)}`);
  }

  const lyricPage = await browser.newPage({ viewport: { width: 1024, height: 150 } });
  await lyricPage.addInitScript(() => {
    window.__lyricAnimationCount = 0;
    const nativeAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.__lyricAnimationCount += 1;
      return nativeAnimate.apply(this, args);
    };
    window.medo = {
      fitLyricsWindowHeight: () => {},
      fitLyricsWindowWidth: (width) => { window.__requestedLyricWidth = width; },
      moveLyricsWindow: () => {},
      onLyricsWindowLine: (callback) => { window.__lyricsLine = callback; },
      onLyricsWindowSize: () => {},
      onLyricsWindowLockState: () => {},
      onLyricsWindowPointerInside: () => {}
    };
  });
  await lyricPage.goto(pathToFileURL(path.join(root, "src", "lyrics.html")).href);
  const initialLyricsState = await lyricPage.evaluate(() => ({
    opacity: getComputedStyle(document.querySelector(".lyrics-island")).opacity,
    current: document.querySelector("#desktop-lyric").textContent,
    next: document.querySelector("#desktop-next-lyric").textContent
  }));
  if (initialLyricsState.opacity !== "0" || initialLyricsState.current || initialLyricsState.next) {
    throw new Error(`Desktop lyrics expose startup placeholders: ${JSON.stringify(initialLyricsState)}`);
  }
  await lyricPage.evaluate(() => window.__lyricsLine({
    current: "这段缘分没有人转身转身",
    next: "下一句歌词",
    position: 2,
    words: [{ start: 0, end: 4, text: "这段缘分没有人转身转身" }]
  }));
  await lyricPage.waitForTimeout(250);
  const firstLyricsState = await lyricPage.evaluate(() => ({
    ready: document.body.classList.contains("lyrics-ready"),
    animationCount: window.__lyricAnimationCount
  }));
  if (!firstLyricsState.ready || firstLyricsState.animationCount !== 0) {
    throw new Error(`Desktop lyrics animate or remain hidden on first render: ${JSON.stringify(firstLyricsState)}`);
  }
  const lyricLayers = await lyricPage.evaluate(() => {
    const base = document.querySelector(".desktop-karaoke-base").getBoundingClientRect();
    const fill = document.querySelector(".desktop-karaoke-fill").getBoundingClientRect();
    return { baseX: base.x, fillX: fill.x, baseWidth: base.width, fillWidth: fill.width };
  });
  if (Math.abs(lyricLayers.baseX - lyricLayers.fillX) > .5 || Math.abs(lyricLayers.baseWidth - lyricLayers.fillWidth) > .5) {
    throw new Error(`Desktop lyric layers are misaligned: ${JSON.stringify(lyricLayers)}`);
  }
  await lyricPage.evaluate(() => window.__lyricsLine({
    current: "Current lyric",
    currentTranslation: "当前歌词翻译",
    next: "Actual next lyric",
    position: 2,
    words: []
  }));
  await lyricPage.waitForTimeout(500);
  const translatedLineStyle = await lyricPage.locator("#desktop-next-lyric").evaluate((element) => ({
    isCurrentTranslation: element.classList.contains("current-translation"),
    opacity: getComputedStyle(element).opacity,
    text: element.textContent
  }));
  if (!translatedLineStyle.isCurrentTranslation || translatedLineStyle.opacity !== "1" || translatedLineStyle.text !== "当前歌词翻译") {
    throw new Error(`Current lyric translation is visually faded: ${JSON.stringify(translatedLineStyle)}`);
  }
  const translatedWordPayload = {
    current: "Current lyric",
    currentTranslation: "当前歌词翻译",
    next: "Actual next lyric",
    position: 2,
    words: [{ start: 0, end: 4, text: "Current lyric" }]
  };
  await lyricPage.evaluate((payload) => window.__lyricsLine(payload), translatedWordPayload);
  const animationCount = await lyricPage.evaluate(() => window.__lyricAnimationCount);
  await lyricPage.evaluate((payload) => window.__lyricsLine({ ...payload, position: 2.1 }), translatedWordPayload);
  if (await lyricPage.evaluate(() => window.__lyricAnimationCount) !== animationCount) {
    throw new Error("Word lyric translation restarted its animation without a line change");
  }
  await lyricPage.evaluate(() => window.__lyricsLine({
    current: "Mon démon intérieur ne me laisse aucun répit et cette ligne volontairement très longue doit rester entièrement visible",
    next: "罪恶烙印 永不能解",
    position: 2,
    words: []
  }));
  await lyricPage.waitForTimeout(250);
  const longDesktopLyric = await lyricPage.locator("#desktop-lyric").evaluate((element) => ({
    textOverflow: getComputedStyle(element).textOverflow,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    fontSize: parseFloat(getComputedStyle(element).fontSize),
    requestedWidth: window.__requestedLyricWidth
  }));
  if (longDesktopLyric.textOverflow === "ellipsis" || longDesktopLyric.scrollWidth > longDesktopLyric.clientWidth + 1 || longDesktopLyric.requestedWidth <= 1024) {
    throw new Error(`Long desktop lyric is truncated: ${JSON.stringify(longDesktopLyric)}`);
  }
  await lyricPage.screenshot({ path: path.join(artifacts, "desktop-lyrics-karaoke.png"), omitBackground: true });
  await lyricPage.close();

  console.log(
    `UI smoke passed; 1000-track library: ${timings.libraryMs.toFixed(1)}ms; ` +
    `settings entry: ${timings.settingsMs.toFixed(1)}ms`
  );
  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
