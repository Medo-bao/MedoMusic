// Exactly eight scenarios: six metadata checks and two build/export checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');
const { isUsableLyricText } = require('../src/lyrics-matching');
const { createOnlineLyricsSearch, LYRICS_CACHE_VERSION } = require('../src/lyrics-search');
const { alignQqTranslation } = require('../src/qq-music');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'artifacts/lyrics-metadata-audit-20261021');
fs.mkdirSync(output, { recursive: true });
const reportPath = path.join(output, 'checks.json');
const phase = process.argv[2] || 'source';
const reuse = process.argv.includes('--retry-failed');
const report = phase !== 'source' || reuse ? JSON.parse(fs.readFileSync(reportPath)) : { total: 8, checks: [], rendererErrors: [] };
const finalText = '出てこなかったんだ';

async function scenario(id, name, action) {
  if (reuse && report.checks.some(check => check.id === id && check.status === 'PASS')) return;
  let timer, result;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Scenario deadline exceeded')), 30000); });
  try { result = { id, name, status: 'PASS', ...await Promise.race([action(), deadline]) }; }
  catch (error) { result = { id, name, status: 'FAIL', error: error.stack }; process.exitCode = 1; }
  finally { clearTimeout(timer); }
  report.checks = [...report.checks.filter(check => check.id !== id), result].sort((a, b) => a.id - b.id);
  report.passed = report.checks.filter(c => c.status === 'PASS').length;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(result));
}

async function main() {
  if (phase === 'bundle') return checkBundle();
  if (phase === 'export') return checkExport();
  assert.equal(phase, 'source');
  // Read only the reported entry. Never modify the real profile or copy lyric
  // contents into the report; screenshots stay in the ignored artifact folder.
  const cache = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'medo-music/online-lyrics-cache.json'), 'utf8'));
  const [cacheKey, cached] = Object.entries(cache).find(([key]) => key.includes('思い出は奇麗')) || [];
  assert.ok(cached?.result?.text.includes('[kana:'), 'The reported raw cached lyric is required');
  const raw = cached.result.text;
  const expectedRows = raw.split(/\r?\n/).filter(line => /^\[\d+,\d+\]/.test(line)).length;
  const folder = fs.mkdtempSync(path.join(output, 'app-'));
  fs.mkdirSync(path.join(folder, 'Music'));
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'medo-kana-check', version: '1.6.4', main: 'main.cjs' }));
  fs.writeFileSync(path.join(folder, 'main.cjs'), `
    const {app,globalShortcut,ipcMain,shell}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(folder, 'Profile'))});
    app.setPath('music',${JSON.stringify(path.join(folder, 'Music'))});
    globalThis.__kanaPayloads=[];
    ipcMain.on('lyrics-window:update',(_event,payload)=>globalThis.__kanaPayloads.push(payload));
    const keys=new Set();globalShortcut.register=key=>{keys.add(key);return true;};globalShortcut.isRegistered=key=>keys.has(key);globalShortcut.unregister=key=>keys.delete(key);
    shell.openExternal=async()=>{};
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({tag_name:'v1.6.4'}),text:async()=>''});
    require(${JSON.stringify(path.join(root, 'src/main.js'))});
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, '.electron-dist/electron.exe'), args: [folder], cwd: root, env });
  try {
    const page = await app.firstWindow(); page.on('pageerror', error => report.rendererErrors.push(error.message));
    await page.waitForFunction(() => typeof lastShortcutStates !== 'undefined' && lastShortcutStates.size === 5 && localStorage.getItem('medo.initialScanComplete') === 'true');
    await page.evaluate(() => applyAutoUpdateSetting(false));
    await page.evaluate(text => { window.__kanaParsed = parseLyrics(text, 212); }, raw);

    await scenario(1, 'Actual cached QQ lyrics contain only the original timed rows and correct final sentence', async () => {
      const result = await page.evaluate(text => {
        const parsed = parseLyrics(text, 212);
        window.__kanaParsed = parsed;
        return { lineCount: parsed.lines.length, level: parsed.level, untimedRows: parsed.lines.filter(line => line.start === null).length,
          metadataVisible: parsed.lines.some(line => /\[kana:/i.test(line.text)),
          final: parsed.lines.at(-1).text, start: parsed.lines.at(-1).start,
          words: parsed.lines.at(-1).words.map(word => ({ start: word.start, end: word.end, text: word.text })) };
      }, raw);
      assert.equal(result.lineCount, expectedRows); assert.equal(result.level, 'word'); assert.equal(result.untimedRows, 0);
      assert.equal(result.metadataVisible, false); assert.equal(result.final, finalText);
      assert.equal(result.start, 172.005); assert.equal(result.words.length, 9);
      assert.equal(result.words[0].start, 172.005); assert.ok(Math.abs(result.words.at(-1).end - 177.254) < 1e-8);
      return { lineCount: result.lineCount, level: result.level, metadataVisible: false, lastStart: result.start, lastEnd: result.words.at(-1).end };
    });

    await scenario(2, 'QRC, YRC, enhanced LRC and plain text retain their content and offsets', async () => {
      const samples = [
        { name: 'qrc', body: '[1000,1000]正(1000,500)文(1500,500)' },
        { name: 'yrc', body: '[1000,1000](1000,500,0)正(1500,500,0)文' },
        { name: 'enhanced-lrc', body: '[00:01.00]<00:01.00>正<00:01.50>文' },
        { name: 'lrc', body: '[00:01.00]正文' }
      ];
      const results = await page.evaluate(samples => {
        const header = '\uFEFF \t[KaNa:1ふ(0,100)り1が1な]';
        return samples.map(sample => {
          const leading = parseLyrics(`${header}\n [offset:250]\n${sample.body}`, 6);
          const trailing = parseLyrics(`${sample.body}\n${header}`, 6);
          return { name: sample.name, text: leading.lines.map(line => line.text), count: leading.lines.length,
            start: leading.lines[0].start, trailingCount: trailing.lines.length, trailingStart: trailing.lines[0].start };
        }).concat([{ name: 'plain', lines: parseLyrics(`${header}\n纯文本正文\n尾句`, 0).lines.map(line => line.text) },
          { name: 'literal-body', text: parseLyrics('[00:02.00]正文里的 [kana:注音] 字样', 6).lines[0].text }]);
      }, samples);
      for (const result of results.slice(0, 4)) {
        assert.deepEqual(result.text, ['正文']); assert.equal(result.count, 1); assert.equal(result.start, 1.25);
        assert.equal(result.trailingCount, 1); assert.equal(result.trailingStart, 1);
      }
      assert.deepEqual(results[4].lines, ['纯文本正文', '尾句']);
      assert.equal(results[5].text, '正文里的 [kana:注音] 字样');
      return { formats: results.map(result => result.name), offsetMs: 250, leadingAndTrailingMetadataFiltered: true };
    });

    await scenario(3, 'Kana-only metadata is unusable while the existing valid raw cache needs no network refresh', async () => {
      for (const text of ['[kana:1ひ(0,100)ら1が1な]', ' \t[KANA:注音]', '[ar:Aimer]\n[kana:注音]']) {
        assert.equal(isUsableLyricText(text), false);
      }
      assert.equal(isUsableLyricText(raw), true); assert.equal(isUsableLyricText('[00:01.00]正文'), true);
      let networkRequests = 0;
      const search = createOnlineLyricsSearch({ getCache: async () => ({ [cacheKey]: { ...cached, version: LYRICS_CACHE_VERSION, expiresAt: Date.now() + 60000 } }),
        fetchImplementation: async () => { networkRequests++; throw new Error('Cache should be reused'); } });
      const found = await search({ title: '思い出は奇麗で', artist: 'Aimer', album: 'Black Bird / Tiny Dancers / 思い出は奇麗で', duration: 212, mode: 'network', requireWordTiming: true });
      assert.equal(found.text, raw); assert.equal(networkRequests, 0);
      const last = await page.evaluate(text => parseLyrics(text, 212).lines.at(-1).text, found.text);
      assert.equal(last, finalText);
      return { metadataOnlyRejected: true, cacheVersion: LYRICS_CACHE_VERSION, networkRequests, existingCacheParsesCorrectly: true };
    });

    await scenario(4, 'Actual lyric UI and desktop-lyric IPC show the correct final text with translation', async () => {
      await page.setViewportSize({ width: 1440, height: 960 });
      const ui = await page.evaluate(track => {
        applyTheme('light'); wordLyricsEnabled = true; lyricTranslationEnabled = true;
        tracks = [track]; currentIndex = 0; playbackQueueIds = [track.id];
        const parsed = window.__kanaParsed;
        lyricsCache.set(track.id, { ...parsed, source: 'qq-word', metadataKey: lyricMetadataKey(track), wordTimingRequested: true, retryAt: Date.now() + 86400000 });
        lyricTranslations.set(track.id, parsed.lines.map(() => '翻译示例'));
        Object.defineProperty(audio, 'currentTime', { configurable: true, value: 173 });
        openPlaybackDetail(); renderLyrics(track); updateLyricsAtTime();
        const rows = [...document.querySelectorAll('#lyrics-lines .lyric-line')];
        const last = rows.at(-1);
        return { count: rows.length, final: last.querySelector('.lyric-karaoke-base').textContent,
          translation: last.querySelector('.lyric-translation .lyric-karaoke-base').textContent,
          active: last.classList.contains('active'), metadataVisible: rows.some(row => /\[kana:/i.test(row.textContent)) };
      }, { id: 'kana-final', title: '思い出は奇麗で', artist: 'Aimer', album: 'Black Bird / Tiny Dancers / 思い出は奇麗で', duration: 212, path: path.join(folder, 'Music/Fixture.mp3'), metadataLoaded: true });
      assert.equal(ui.count, expectedRows); assert.equal(ui.final, finalText); assert.equal(ui.translation, '翻译示例');
      assert.equal(ui.active, true); assert.equal(ui.metadataVisible, false);
      await page.screenshot({ path: path.join(output, 'correct-final-line.png'), animations: 'disabled' });
      const desktop = await app.evaluate(() => globalThis.__kanaPayloads.at(-1));
      assert.equal(desktop.current, finalText); assert.equal(desktop.currentTranslation, '翻译示例');
      assert.equal(desktop.words.map(word => word.text).join(''), finalText); assert.equal(desktop.next, undefined);
      assert.deepEqual(report.rendererErrors, []);
      return { count: ui.count, finalActive: true, metadataVisible: false, translationPreserved: true, desktopWordCount: desktop.words.length, rendererErrors: [] };
    });
    await scenario(5, 'Additional attributes and reordered credits never become raw lyric rows', async () => {
      const fields = { ar: 'Artist', ti: 'Title [Live]', al: 'Album', au: 'Writer', by: 'Editor', la: 'ja', re: 'Tool', ve: '1',
        length: '03:00', offset: '250', kana: '1かな(0,100)', id: '123', hash: 'value', sign: 'value', total: '180000', language: 'ja', tool: 'Editor' };
      const result = await page.evaluate(fields => {
        const attributes = Object.entries(fields).map(([name, value]) => {
          const parsed = parseLyrics(`[${name}:${value}]\n[00:01.00]正文`, 6);
          return { name, rows: parsed.lines.map(line => line.text), start: parsed.lines[0].start };
        });
        const chained = parseLyrics('[ti:Title [Live]][la:ja][offset:250]\n[00:01.00]正文', 6);
        const credits = parseLyrics('[offset:250]\n{ "c" : [{"tx":"作词："},{"tx":"作者"}], "t" : 0 }\n' +
          '{"t":500,"c":[{"tx":{"invalid":"object"}},{"tx":"作曲：作者"}]}\n' +
          '{"t":0,"c":[]}\n{"t":0,"c":{}}\n{"c":[oops],"t":500}\n[1000,1000](1000,500,0)正(1500,500,0)文', 6);
        return { attributes, chained: { count: chained.lines.length, start: chained.lines[0].start },
          credits: { count: credits.lines.length, level: credits.level, info: credits.lines.filter(line => line.information).map(line => ({ text: line.text, start: line.start })),
            rawDataVisible: credits.lines.some(line => /[{}]|\[object Object\]/.test(line.text)) },
          preserved: ['[Chorus: Repeat]', '[ar:Artist] 正文', '{"message":"literal"}'].map(text => parseLyrics(text, 0).lines[0]?.text) };
      }, fields);
      for (const item of result.attributes) { assert.deepEqual(item.rows, ['正文']); assert.equal(item.start, item.name === 'offset' ? 1.25 : 1); }
      assert.deepEqual(result.chained, { count: 1, start: 1.25 });
      assert.deepEqual(result.credits, { count: 3, level: 'word', info: [{ text: '作词：作者', start: .25 }, { text: '作曲：作者', start: .75 }], rawDataVisible: false });
      assert.deepEqual(result.preserved, ['[Chorus: Repeat]', '[ar:Artist] 正文', '{"message":"literal"}']);
      assert.equal(isUsableLyricText(Object.entries(fields).map(([name, value]) => `[${name}:${value}]`).join('\n')), false);
      assert.equal(isUsableLyricText('{"c":[],"t":0}'), false);
      assert.equal(isUsableLyricText('{"c":[oops],"t":500}'), false);
      assert.equal(isUsableLyricText('{"c":[{"tx":"作词：作者"}],"t":0}'), true);
      return { attributeNames: Object.keys(fields), reorderedCreditsPreserved: true, emptyAndDamagedCreditsHidden: true, literalTextPreserved: true };
    });

    await scenario(6, 'LF, CRLF and CR preserve lyrics, metadata filtering and translation alignment', async () => {
      const results = await page.evaluate(text => {
        const separators = ['\n', '\r\n', '\r'];
        const formats = [
          ['[1000,1000]甲(1000,500)乙(1500,500)', '[3000,1000]丙(3000,500)丁(3500,500)'],
          ['[1000,1000](1000,500,0)甲(1500,500,0)乙', '[3000,1000](3000,500,0)丙(3500,500,0)丁'],
          ['[00:01.00]甲乙', '[00:03.00]丙丁']
        ];
        return { formats: separators.flatMap(separator => formats.map(body => {
          const parsed = parseLyrics(['[language:ja][kana:注音]', '[offset:250]', ...body].join(separator), 6);
          return { text: parsed.lines.map(line => line.text), start: parsed.lines.map(line => line.start) };
        })), actualCr: (() => { const parsed = parseLyrics(text.replace(/\n/g, '\r'), 212); return { count: parsed.lines.length, level: parsed.level, final: parsed.lines.at(-1).text }; })() };
      }, raw);
      for (const parsed of results.formats) { assert.deepEqual(parsed.text, ['甲乙', '丙丁']); assert.deepEqual(parsed.start, [1.25, 3.25]); }
      assert.deepEqual(results.actualCr, { count: expectedRows, level: 'word', final: finalText });
      for (const separator of ['\n', '\r\n', '\r']) {
        assert.deepEqual(alignQqTranslation(['[00:01.00]甲', '[00:03.00]乙'].join(separator), ['[00:01.00]一', '[00:03.00]二'].join(separator)), ['一', '二']);
        assert.equal(isUsableLyricText(['[language:ja]', '[id:123]'].join(separator)), false);
      }
      assert.deepEqual(report.rendererErrors, []);
      return { lineEndings: 3, formatVectors: results.formats.length, actualCrRows: expectedRows, translationAligned: true, rendererErrors: [] };
    });
    assert.equal(report.passed, 6); console.log('FUNCTIONAL 6/6 PASS');
  } finally { await app.close(); }
}

function files(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
}
async function checkBundle() {
  await scenario(7, 'Installer version and every bundled source match the complete repair', async () => {
    assert.equal(report.passed, 6);
    const asar = require('@electron/asar');
    const bundle = path.join(output, 'build/win-unpacked/resources/app.asar');
    const pkg = require('../package.json'), lock = require('../package-lock.json');
    assert.equal(pkg.version, '1.6.4'); assert.equal(lock.version, '1.6.4'); assert.equal(lock.packages[''].version, '1.6.4');
    const { scripts, devDependencies, build, ...expected } = pkg;
    assert.deepEqual(JSON.parse(asar.extractFile(bundle, 'package.json')), expected);
    const sources = files(path.join(root, 'src'));
    for (const file of sources) assert.ok(asar.extractFile(bundle, path.relative(root, file)).equals(fs.readFileSync(file)), file);
    const info = JSON.parse(fs.readFileSync(path.join(output, 'installer-info.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(info.productVersion, '1.6.4'); assert.ok(info.size > 0);
    return { version: '1.6.4', exactSourceFiles: sources.length, cacheVersion: LYRICS_CACHE_VERSION, ...info };
  });
}
async function checkExport() {
  await scenario(8, 'Actual exported app renders existing cached lyrics with no metadata or JSON leakage', async () => {
    assert.equal(report.passed, 7);
    const release = path.join(root, 'release');
    assert.deepEqual(fs.readdirSync(release).filter(name => /^MedoMusic-Setup-.*\.exe$/.test(name)), ['MedoMusic-Setup-1.6.4-x64.exe']);
    assert.ok(fs.existsSync(path.join(release, 'MedoMusic-Setup-1.6.4-x64.exe.blockmap')));
    const cache = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'medo-music/online-lyrics-cache.json'), 'utf8'));
    const [key, entry] = Object.entries(cache).find(([key]) => key.includes('思い出は奇麗'));
    const profile = path.join(output, 'ExportProfile'), music = path.join(output, 'ExportMusic');
    fs.mkdirSync(profile, { recursive: true }); fs.mkdirSync(music, { recursive: true });
    fs.writeFileSync(path.join(profile, 'online-lyrics-cache.json'), JSON.stringify({ [key]: { ...entry, expiresAt: Date.now() + 86400000 } }));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath: path.join(release, 'win-unpacked/MedoMusic.exe'), args: [`--user-data-dir=${profile}`], env });
    const errors = [];
    try {
      const runtime = await app.evaluate(({ app }, music) => { app.setPath('music', music); return { version: app.getVersion(), profile: app.getPath('userData'), appPath: app.getAppPath() }; }, music);
      assert.equal(runtime.version, '1.6.4'); assert.equal(path.resolve(runtime.profile).toLowerCase(), profile.toLowerCase());
      assert.equal(path.resolve(runtime.appPath).toLowerCase(), path.join(release, 'win-unpacked/resources/app.asar').toLowerCase());
      const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
      await page.waitForFunction(() => typeof lastShortcutStates !== 'undefined' && lastShortcutStates.size === 5);
      const ui = await page.evaluate(async track => {
        applyAutoUpdateSetting(false); wordLyricsEnabled = true; lyricTranslationEnabled = false;
        tracks = [track]; currentIndex = 0; playbackQueueIds = [track.id];
        await ensureLyrics(track);
        const parsed = lyricsCache.get(track.id);
        lyricTranslations.set(track.id, parsed.lines.map(() => '翻译示例')); lyricTranslationEnabled = true;
        Object.defineProperty(audio, 'currentTime', { configurable: true, value: 173 });
        openPlaybackDetail(); renderLyrics(track); await renderAppInfo();
        const synthetic = parseLyrics('[language:ja][id:123]\n{ "c": [{"tx":"作词：作者"}], "t": 0 }\n[1000,1000](1000,500,0)正(1500,500,0)文', 6);
        return { about: document.querySelector('#about-version').textContent, source: parsed.source, level: parsed.level,
          count: parsed.lines.length, final: parsed.lines.at(-1).text,
          active: document.querySelector('#lyrics-lines .lyric-line.active .lyric-karaoke-base')?.textContent,
          metadataVisible: /\[kana:|\[language:|\[id:/.test(document.querySelector('#lyrics-lines').textContent),
          statusHidden: document.querySelector('#lyric-status').hidden,
          synthetic: synthetic.lines.map(line => line.text), information: synthetic.lines[0].information };
      }, { id: 'export-metadata', title: '思い出は奇麗で', artist: 'Aimer', album: 'Black Bird / Tiny Dancers / 思い出は奇麗で', duration: 212, path: path.join(music, 'Fixture.mp3'), metadataLoaded: true });
      assert.match(ui.about, /1\.6\.4$/); assert.equal(ui.source, 'qq-word'); assert.equal(ui.level, 'word');
      assert.equal(ui.count, 43); assert.equal(ui.final, finalText); assert.equal(ui.active, finalText);
      assert.equal(ui.metadataVisible, false); assert.equal(ui.statusHidden, true);
      assert.deepEqual(ui.synthetic, ['作词：作者', '正文']); assert.equal(ui.information, true); assert.deepEqual(errors, []);
      return { ...runtime, ui, rendererErrors: errors, installer: path.join(release, 'MedoMusic-Setup-1.6.4-x64.exe'), size: fs.statSync(path.join(release, 'MedoMusic-Setup-1.6.4-x64.exe')).size };
    } finally { await app.close(); }
  });
  assert.equal(report.passed, 8); console.log('SUMMARY 8/8 PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
