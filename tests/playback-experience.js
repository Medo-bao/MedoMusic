const assert = require("node:assert/strict");

// Runs in the UI smoke page after its normal checks, with isolated in-memory tracks.
module.exports = async function checkPlaybackExperience(page) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const functional = await page.evaluate(async () => {
    const make = (id, folder = "Y") => ({
      id, path: id, title: id, artist: "Artist", album: "Album", duration: 180,
      metadataLoaded: true, playlists: [], sourceDirectory: folder
    });
    const reports = {};
    const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
    currentView = "library";
    currentPlaylist = null;
    currentCollection = null;
    musicFolders = ["X", "Y"];
    tracks = [make("A", "X"), make("B"), make("C")];
    currentIndex = 1;
    playbackQueueIds = ["A", "B", "C"];
    updateNowPlaying(tracks[1]);
    removeFolder("X");
    reports.removal = { current: tracks[currentIndex]?.id, saved: JSON.parse(localStorage.getItem("medo.playbackState")).trackId };
    reorderTrack("C", "B");
    reports.reorder = tracks[currentIndex]?.id;

    tracks = [make("A"), make("B"), make("C")];
    currentIndex = 1;
    playbackQueueIds = ["A", "B", "C"];
    applyFolderScan({ folder: "Y", tracks: [make("B"), make("C")] });
    reports.scan = { current: tracks[currentIndex]?.id, queue: [...playbackQueueIds] };
    removeFolder("Y");
    reports.removedCurrent = { index: currentIndex, source: audio.getAttribute("src"), title: document.querySelector("#now-title").textContent };

    tracks = ["A", "B", "C"].map((id) => make(id));
    playbackQueueIds = ["A", "B", "C"];
    playbackFailedIds.clear();
    const originalPlay = audio.play;
    let rejectOld;
    let playCalls = 0;
    audio.play = () => {
      playCalls += 1;
      return playCalls === 1 ? new Promise((_resolve, reject) => { rejectOld = reject; }) : Promise.resolve();
    };
    await playTrack(0, true);
    await playTrack(2, true);
    rejectOld(new Error("late decoder failure"));
    await tick();
    reports.staleFailure = { current: tracks[currentIndex]?.id, playCalls };

    let rejectCleared;
    audio.play = () => new Promise((_resolve, reject) => { rejectCleared = reject; });
    await playTrack(0, true);
    clearCurrentPlayback();
    rejectCleared(new Error("failure after clearing playback"));
    await tick();
    reports.clearedFailure = { index: currentIndex, source: audio.getAttribute("src") };

    // A genuine failure of the current request must still recover.
    playbackFailedIds.clear();
    playCalls = 0;
    audio.play = () => ++playCalls === 1 ? Promise.reject(new Error("decoder failure")) : Promise.resolve();
    await playTrack(0, true);
    await tick();
    reports.currentFailure = tracks[currentIndex]?.id;

    tracks = [make("Solo")];
    currentIndex = 0;
    playbackQueueIds = ["Solo"];
    playMode = "shuffle";
    shuffleQueueSignature = "";
    playCalls = 0;
    audio.play = () => { playCalls += 1; return Promise.resolve(); };
    audio.dispatchEvent(new Event("ended"));
    await tick();
    reports.singleShuffle = playCalls;
    audio.play = originalPlay;
    lyricsCache.set("Solo", { synced: true, lines: Array.from({ length: 30 }, (_, i) => ({ start: i, text: `阅读歌词 ${i}` })) });
    renderedLyricsState = null;
    currentView = "player";
    render();
    audio.currentTime = 15;
    activeLyricIndex = -1;
    updateLyricsAtTime();
    // Pause at an exact intermediate frame so the interruption assertion is deterministic.
    lyricFollowAnimation.pause();
    lyricFollowAnimation.currentTime = 60;
    const y = () => new DOMMatrixReadOnly(getComputedStyle(lyricsLines).transform).m42;
    const live = y();
    lyricsStage.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, cancelable: true }));
    reports.interruptionDelta = y() - live;
    lyricsStage.dispatchEvent(new WheelEvent("wheel", { deltaY: 350, cancelable: true }));
    const inspected = y();
    const firstLine = lyricsLines.firstElementChild;
    renderPlaybackDetail();
    reports.rerender = { delta: y() - inspected, sameNode: firstLine === lyricsLines.firstElementChild, inspecting: lyricInspectionActive };
    lyricsStage.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    scheduleLyricFollowRestore();
    return reports;
  });
  assert.deepEqual(functional.removal, { current: "B", saved: "B" });
  assert.equal(functional.reorder, "B");
  assert.deepEqual(functional.scan, { current: "B", queue: ["B", "C"] });
  assert.deepEqual(functional.removedCurrent, { index: -1, source: null, title: "未选择歌曲" });
  assert.deepEqual(functional.staleFailure, { current: "C", playCalls: 2 });
  assert.deepEqual(functional.clearedFailure, { index: -1, source: null });
  assert.equal(functional.currentFailure, "B");
  assert.equal(functional.singleShuffle, 1);
  assert.ok(Math.abs(functional.interruptionDelta + .72) < 1, JSON.stringify(functional));
  assert.deepEqual(functional.rerender, { delta: 0, sameNode: true, inspecting: true });
  await page.waitForTimeout(5100);
  assert.equal(await page.evaluate(() => lyricInspectionActive), true, "Hovering readers must retain their place");
  await page.locator("#restore-lyric-follow").click();
  assert.equal(await page.evaluate(() => lyricInspectionActive), false);

  const motion = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const button = document.querySelector("#volume-button");
    animatePlayerToolButton(button);
    await wait(70);
    const previous = getComputedStyle(button).transform;
    animatePlayerToolButton(button);
    const restart = button.getAnimations().find((animation) => animation.effect.target === button).effect.getKeyframes()[0].transform;
    for (let i = 0; i < 6; i += 1) {
      document.querySelector("#toggle-detail-queue").click();
      await wait(45);
    }
    await wait(420);
    const queue = document.querySelector(".detail-queue");
    const queueState = { visible: getComputedStyle(queue).visibility, opacity: getComputedStyle(queue).opacity, width: queue.style.width };
    const closing = closePlaybackDetail();
    await wait(60);
    openPlaybackDetail();
    await closing;
    await wait(430);
    return { previous, restart, queueState, view: currentView,
      closingClass: document.querySelector("main").classList.contains("playback-detail-closing"),
      exitingClass: document.body.classList.contains("playback-detail-exiting") };
  });
  assert.equal(motion.restart, motion.previous, "Repeated effects must continue from the visible pose");
  assert.deepEqual(motion.queueState, { visible: "visible", opacity: "1", width: "" });
  assert.equal(motion.view, "player");
  assert.equal(motion.closingClass, false);
  assert.equal(motion.exitingClass, false);

  await page.evaluate(() => {
    lyricsStage.dispatchEvent(new WheelEvent("wheel", { deltaY: 200, cancelable: true }));
    animatePlayerToolButton(document.querySelector("#volume-button"));
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: require("node:path").join(__dirname, "artifacts", "experience-detail.png") });

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(async () => {
    animatePlaybackDetail(true);
    const entryFrames = document.querySelector("#playback-detail").getAnimations().flatMap((animation) => animation.effect.getKeyframes());
    await closePlaybackDetail();
    return { entryMovement: entryFrames.some((frame) => Boolean(frame.transform)),
      toolMovement: [...document.querySelectorAll(".player-right button, #volume")].some((element) =>
        element.getAnimations().some((animation) => animation.effect.getKeyframes().some((frame) => Boolean(frame.transform)))) };
  });
  assert.deepEqual(reduced, { entryMovement: false, toolMovement: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  console.log("Playback and experience regressions passed: identity, stale requests, single shuffle, lyric reading, interruptible motion");
};
