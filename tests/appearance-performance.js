const fs = require('node:fs');
const path = require('node:path');

module.exports = async function measureAppearance(page) {
  const metrics = await page.evaluate(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    tracks = Array.from({ length: 10000 }, (_, i) => ({ id: `perf-${i}`, title: `Song ${i}`, artist: 'Artist', album: 'Album', duration: 240, metadataLoaded: true, playlists: [] }));
    currentIndex = 0; currentSort = 'songs'; currentCollection = null; currentPlaylist = null; query = ''; selectedTrackIds.clear();
    lyricsCache.set(tracks[0].id, { networkOnly: true, synced: true, lines: Array.from({length: 100}, (_, i) => ({ start: i * 2, text: `Reading line ${i}` })) });
    applyTheme('dark'); updatePlayButtonState(true);
    const measure = async (scene) => {
      currentView = scene; render(); await frame(); await frame();
      const intervals = [];
      let previous = await frame();
      for (let i = 0; i < 120; i++) {
        if (scene === 'library') document.querySelector('main').scrollTop = i * 180;
        else { audio.currentTime = i * .1; updateLyricsAtTime(); }
        const now = await frame(); intervals.push(now - previous); previous = now;
      }
      intervals.sort((a, b) => a - b);
      return { medianFrameMs: intervals[60], p95FrameMs: intervals[114], framesOver34Ms: intervals.filter(value => value > 34).length,
        rows: document.querySelectorAll('.track-row').length };
    };
    return { library: await measure('library'), lyrics: await measure('player') };
  });
  const name = process.env.MEDO_BENCHMARK_ROOT ? 'before' : 'after';
  const output = path.join(__dirname, 'artifacts', 'appearance', `performance-${name}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(metrics, null, 2));
  console.log(`Appearance performance ${name}: ${JSON.stringify(metrics)}`);
};
