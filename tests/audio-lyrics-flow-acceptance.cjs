// Exactly eight scenarios, run only after the whole retrieval/audio change.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');
const core = require('../src/fxsound-core');
const { createOnlineLyricsSearch, LYRICS_CACHE_VERSION } = require('../src/lyrics-search');
const { selectLocalLyrics } = require('../src/lyrics-source-priority');
const { build } = require('./fxsound-leveling-reference.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'artifacts/audio-lyrics-flow');
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, 'run-'));
const results = [], errors = [];
const previousRun = process.argv.includes('--retry-failed')
  ? JSON.parse(fs.readFileSync(path.join(output, 'results.json'), 'utf8')) : null;
const line = '[00:01.00]Local timed line';
const word = '[1000,1000]Native(1000,500) words(1500,500)';
const yrc = '[1000,1000](1000,500,0)Native(1500,500,0) words';

async function scenario(id, name, action) {
  const previous = previousRun?.results.find(item => item.id === id);
  if (previous?.status === 'PASS') {
    results.push({ ...previous, reusedFrom: previousRun.runFolder });
    return;
  }
  try { results.push({ id, name, status: 'PASS', ...await action() }); }
  catch (error) { results.push({ id, name, status: 'FAIL', error: error.stack || String(error) }); }
  console.log(JSON.stringify(results.at(-1)));
}

function wav(embedded = '') {
  const samples = Buffer.alloc(48000 * 4);
  for (let i = 0; i < 48000; i++) {
    const value = Math.round(Math.sin(i * Math.PI * 880 / 48000) * 3276);
    samples.writeInt16LE(value, i * 4); samples.writeInt16LE(value, i * 4 + 2);
  }
  const chunk = (name, data) => {
    const header = Buffer.alloc(8); header.write(name); header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]);
  };
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1); format.writeUInt16LE(2, 2); format.writeUInt32LE(48000, 4);
  format.writeUInt32LE(192000, 8); format.writeUInt16LE(4, 12); format.writeUInt16LE(16, 14);
  const chunks = [chunk('fmt ', format), chunk('data', samples)];
  if (embedded) {
    const payload = Buffer.concat([Buffer.from([3]), Buffer.from('eng\0'), Buffer.from(embedded)]);
    const frame = Buffer.alloc(10); frame.write('USLT'); frame.writeUInt32BE(payload.length, 4);
    const tag = Buffer.alloc(10); tag.write('ID3'); tag[3] = 3;
    const size = frame.length + payload.length;
    for (let i = 0; i < 4; i++) tag[9 - i] = size >> (i * 7) & 127;
    chunks.push(chunk('id3 ', Buffer.concat([tag, frame, payload])));
  }
  const data = Buffer.concat(chunks), header = Buffer.alloc(12);
  header.write('RIFF'); header.writeUInt32LE(data.length + 4, 4); header.write('WAVE', 8);
  return Buffer.concat([header, data]);
}

function createFixture() {
  const appFolder = path.join(folder, 'app');
  fs.mkdirSync(path.join(appFolder, 'Music'), { recursive: true });
  fs.writeFileSync(path.join(appFolder, 'package.json'), JSON.stringify({ name: 'medo-flow-acceptance', version: '1.6.3', main: 'main.cjs' }));
  fs.writeFileSync(path.join(appFolder, 'main.cjs'), `
    const {app,globalShortcut,shell,ipcMain}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(appFolder, 'Profile'))});
    app.setPath('music',${JSON.stringify(path.join(appFolder, 'Music'))});
    const keys=new Set();globalShortcut.register=key=>{keys.add(key);return true;};
    globalShortcut.isRegistered=key=>keys.has(key);globalShortcut.unregister=key=>keys.delete(key);
    shell.openExternal=async()=>{};
    const state=globalThis.__flow={mode:'empty',title:'Fixture',calls:[],invocations:[],aborted:0};
    const handle=ipcMain.handle.bind(ipcMain);
    ipcMain.handle=(name,listener)=>handle(name,(event,...args)=>{
      if(name==='music:lyrics')state.invocations.push(args[0]);return listener(event,...args);
    });
    const response=(data,status=200)=>({ok:status<400,status,json:async()=>data,text:async()=>String(data)});
    globalThis.fetch=async(input,init={})=>{
      const url=String(input);
      if(url.startsWith('https://api.github.com/'))return response({tag_name:'v1.6.3'});
      state.calls.push(url);state.started?.();state.started=null;
      if(state.mode==='pending')return new Promise((resolve,reject)=>{
        const abort=()=>{state.aborted++;reject(init.signal.reason);};
        if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});
      });
      if(state.mode==='failure')return response(null,503);
      if(url.includes('musicu.fcg'))return response({req_1:{data:{body:{song:{list:[]}}}}});
      if(url.includes('cloudsearch'))return response({result:{songs:state.mode==='word'?[{id:1,name:state.title,ar:[{name:'Singer'}],dt:120000}]:[]}});
      if(url.includes('/eapi/'))return response({yrc:{lyric:${JSON.stringify(yrc)}}});
      return response([]);
    };
    require(${JSON.stringify(path.join(root, 'src/main.js'))});
  `);
  return appFolder;
}

async function main() {
  const appFolder = createFixture();
  const localFile = path.join(folder, 'native.wav'), fallbackFile = path.join(folder, 'fallback.wav');
  const onlineFile = path.join(folder, 'online.wav');
  fs.writeFileSync(localFile, wav('Plain embedded lyrics')); fs.writeFileSync(localFile.replace('.wav', '.lrc'), word);
  fs.writeFileSync(fallbackFile, wav('Plain embedded lyrics')); fs.writeFileSync(fallbackFile.replace('.wav', '.lrc'), line);
  fs.writeFileSync(onlineFile, wav());
  const track = (id, filePath, title = 'Fixture') => ({ id, path: filePath, title, artist: 'Singer', album: 'Album', duration: 120, metadataLoaded: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, '.electron-dist/electron.exe'), args: [appFolder], cwd: root, env });
  try {
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    const ready = async () => {
      await page.waitForFunction(() => typeof lastShortcutStates !== 'undefined' && lastShortcutStates.size === 5 && localStorage.getItem('medo.initialScanComplete') === 'true');
      await page.evaluate(() => { applyAutoUpdateSetting(false); applyLyricTranslationSetting(false); audio.pause(); });
    };
    await ready();
    const read = options => page.evaluate(options => window.medo.readLyrics(options), options);
    const state = values => app.evaluate((_electron, values) => Object.assign(globalThis.__flow, values), values);

    await scenario(1, 'Local synchronization priority and real embedded/sidecar IPC', async () => {
      assert.equal(selectLocalLyrics('plain', line).source, 'sidecar');
      assert.equal(selectLocalLyrics(line, word).source, 'sidecar');
      assert.equal(selectLocalLyrics(line, line).source, 'embedded');
      const options = { filePath: localFile, title: 'Local', mode: 'auto', requireWordTiming: true };
      const found = await read(options);
      assert.equal(found.source, 'sidecar'); assert.equal(found.text, word);
      assert.equal((await read({ ...options, mode: 'local', force: true })).text, word);
      const embedded = await read({ filePath: fallbackFile, mode: 'local' });
      assert.equal(embedded.source, 'sidecar'); assert.equal(embedded.text, line);
      assert.equal((await app.evaluate(() => globalThis.__flow.calls)).length, 0);
      return { nativeSource: found.source, timedSidecarWins: true, networkRequests: 0 };
    });

    await scenario(2, 'Word setting preserves local words, retries line fallback and upgrades through IPC', async () => {
      await state({ mode: 'failure', invocations: [], calls: [] });
      const native = await page.evaluate(async track => {
        tracks = [track]; currentIndex = 0; wordLyricsEnabled = false; lyricsCache.clear();
        await ensureLyrics(track); applyWordLyricsSetting(true, true); await ensureLyrics(track);
        return { source: lyricsCache.get(track.id).source, worded: MedoLyricSync.hasWordLevelLines(lyricsCache.get(track.id).lines) };
      }, track('native', localFile, 'Local Native'));
      assert.deepEqual(native, { source: 'sidecar', worded: true });
      assert.equal((await app.evaluate(() => globalThis.__flow.calls)).length, 0);
      await state({ invocations: [] });
      const fallback = await page.evaluate(async track => {
        tracks = [track]; currentIndex = 0; await ensureLyrics(track); await ensureLyrics(track);
        const entry = lyricsCache.get(track.id);
        return { source: entry.source, level: entry.level, retryMs: entry.retryAt - Date.now(), requested: entry.wordTimingRequested };
      }, track('fallback', fallbackFile, 'Local Fallback'));
      assert.equal(fallback.source, 'sidecar'); assert.equal(fallback.level, 'line');
      assert.ok(fallback.retryMs > 0 && fallback.retryMs <= 15000); assert.equal(fallback.requested, true);
      assert.equal((await app.evaluate(() => globalThis.__flow.invocations)).length, 1);
      await state({ mode: 'word', title: 'Network Upgrade', invocations: [] });
      const upgraded = await page.evaluate(async track => {
        tracks = [track]; currentIndex = 0; await ensureLyrics(track); const entry = lyricsCache.get(track.id);
        return { source: entry.source, level: entry.level };
      }, track('upgrade', fallbackFile, 'Network Upgrade'));
      assert.deepEqual(upgraded, { source: 'netease-word', level: 'word' });
      const request = (await app.evaluate(() => globalThis.__flow.invocations))[0];
      assert.equal(request.ignoreLocal, false); assert.equal(request.mode, 'auto'); assert.equal(request.requireWordTiming, true);
      return { native, fallback, upgraded };
    });

    await scenario(3, 'Timed online fallback, later provider candidates and current cache', async () => {
      const cases = [];
      for (const mode of ['netease', 'lrclib', 'later-qq']) {
        const cache = {}, calls = []; let qqLyrics = 0;
        const search = createOnlineLyricsSearch({ getCache: async () => cache, now: () => 100000, fetchImplementation: async (url, init = {}) => {
          calls.push(String(url)); const response = value => ({ ok: true, status: 200, json: async () => value, text: async () => String(value) });
          if (String(url).includes('musicu.fcg')) return response({ req_1: { data: { body: { song: { list: [1, 2].map(id => ({ id, mid: `m${id}`, name: 'Fixture', singer: [{ name: 'Singer' }], interval: 120 })) } } } } });
          if (String(url).includes('lyric_download')) return response('');
          if (String(url).includes('fcg_query_lyric')) return response('MusicJsonCallback_lrc(' + JSON.stringify({ code: 0, lyric: Buffer.from(mode === 'later-qq' && ++qqLyrics === 2 ? line : 'Plain lyrics').toString('base64') }) + ')');
          if (String(url).includes('cloudsearch')) return response({ result: { songs: mode === 'netease' ? [{ id: 1, name: 'Fixture', ar: [{ name: 'Singer' }], dt: 120000 }] : [] } });
          if (init.method === 'POST') return response({ lrc: { lyric: line } });
          return response([{ trackName: 'Fixture', artistName: 'Singer', duration: 120, syncedLyrics: line }]);
        } });
        const found = await search({ title: 'Fixture', artist: 'Singer', duration: 120, mode: 'auto' });
        assert.equal(found.text, line);
        assert.equal(found.source, mode === 'later-qq' ? 'qq-line' : mode === 'netease' ? 'netease-line' : 'lrclib');
        const count = calls.length; await search({ title: 'Fixture', artist: 'Singer', duration: 120, mode: 'auto' }); assert.equal(calls.length, count);
        assert.equal(Object.values(cache)[0].version, LYRICS_CACHE_VERSION); cases.push({ mode, source: found.source, requests: count });
      }
      return { cases, cacheVersion: LYRICS_CACHE_VERSION };
    });

    await scenario(4, 'Failed refresh retains lyrics/translations; cancellation and metadata prevent stale results', async () => {
      await state({ mode: 'failure', calls: [], invocations: [] });
      const retained = await page.evaluate(async track => {
        cancelPendingLyrics(); tracks = [track]; currentIndex = 0; wordLyricsEnabled = true;
        const entry = { ...parseLyrics('[00:01.00]Original lyrics', 120), source: 'sidecar', metadataKey: lyricMetadataKey(track), retryAt: Date.now() + 10000 };
        lyricsCache.set(track.id, entry); lyricTranslations.set(track.id, ['原歌词']);
        await ensureLyrics(track, true);
        return { source: lyricsCache.get(track.id).source, same: lyricsCache.get(track.id) === entry, translation: lyricTranslations.get(track.id), text: lyricsCache.get(track.id).lines[0].text };
      }, track('retain', onlineFile, 'Keep Original'));
      assert.deepEqual(retained, { source: 'sidecar', same: true, translation: ['原歌词'], text: 'Original lyrics' });
      await state({ mode: 'pending', calls: [], aborted: 0 });
      await page.evaluate(() => { window.__oldRequest = ensureLyrics(tracks[0], true); });
      await app.evaluate(async () => { if (!globalThis.__flow.calls.length) await new Promise(resolve => { globalThis.__flow.started = resolve; }); });
      await state({ mode: 'word', title: 'New Metadata' });
      await page.evaluate(async () => {
        tracks[0].title = 'New Metadata';
        await ensureLyrics(tracks[0], true); await window.__oldRequest;
      });
      const fresh = await page.evaluate(() => ({ source: lyricsCache.get('retain').source, title: JSON.parse(lyricsCache.get('retain').metadataKey)[0], pending: lyricsRequests.size, translations: lyricTranslations.has('retain') }));
      assert.deepEqual(fresh, { source: 'netease-word', title: 'New Metadata', pending: 0, translations: false });
      assert.ok(await app.evaluate(() => globalThis.__flow.aborted > 0));
      return { retained, fresh, cancelled: true };
    });

    async function playTone() {
      await page.evaluate(async bytes => {
        audio.pause(); desiredVolume = 1; applyOutputVolume(); audio.loop = true;
        audio.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }));
        await audio.play(); await outputAudioContext.resume();
        window.__analyser = outputAudioContext.createAnalyser(); window.__analyser.fftSize = 2048;
        outputFadeGain.connect(window.__analyser);
      }, [...wav()]);
    }
    async function audible() {
      await page.waitForFunction(() => {
        const data = new Float32Array(window.__analyser.fftSize); window.__analyser.getFloatTimeDomainData(data);
        window.__rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
        return window.__rms > .055 && window.__rms < .085;
      });
      return page.evaluate(() => window.__rms);
    }

    await scenario(5, 'Module, constructor and initial-update failures keep real audio audible; retry succeeds', async () => {
      await page.reload(); await ready();
      await page.evaluate(async () => {
        soundSettings = MedoSound.normalize({ preset: 'flat', enabled: true });
        const add = AudioWorklet.prototype.addModule; let fail = true;
        AudioWorklet.prototype.addModule = function (...args) { if (fail) { fail = false; return Promise.reject(new Error('Fixture module failure')); } return add.apply(this, args); };
        window.__restoreAddModule = () => { AudioWorklet.prototype.addModule = add; };
        ensureAudioProcessing(); await soundInitialization;
      });
      assert.equal(await page.evaluate(() => soundSettings.enabled), false);
      await playTone(); const moduleRms = await audible();
      await page.evaluate(async () => {
        window.__restoreAddModule(); const Node = AudioWorkletNode;
        window.AudioWorkletNode = class { constructor() { throw new Error('Fixture constructor failure'); } };
        soundSettings.enabled = true; ensureAudioProcessing(); await soundInitialization; window.AudioWorkletNode = Node;
      });
      const constructorRms = await audible();
      await page.evaluate(async () => {
        const create = MedoSound.create;
        MedoSound.create = (...args) => { const engine = create(...args); engine.update = () => { throw new Error('Fixture initial-update failure'); }; return engine; };
        soundSettings.enabled = true; ensureAudioProcessing(); await soundInitialization; MedoSound.create = create;
      });
      const updateRms = await audible();
      assert.deepEqual(await page.evaluate(() => [!!soundEngine, soundSettings.enabled, JSON.parse(localStorage.getItem('medo.sound')).enabled]), [false, false, false]);
      await page.evaluate(async () => { soundSettings.enabled = true; ensureAudioProcessing(); await soundInitialization; updateSoundSettings(); });
      await page.waitForFunction(() => soundEngine && !soundFailure);
      const retryRms = await audible();
      return { moduleRms, constructorRms, updateRms, retryRms, duplicateAudio: false, retrySucceeded: true };
    });

    await scenario(6, 'Real processorerror restores dry audio and allows a new processor', async () => {
      await page.evaluate(() => { audio.pause(); soundSettings.enabled = false; updateSoundSettings(); });
      await page.reload(); await ready();
      await page.evaluate(async () => {
        let registered = false;
        MedoSound.prepare = async context => {
          if (registered) return;
          const source = `(${FxSoundCoreModule.toString()})(globalThis);`
            .replace('constructor(){super();this.chain=new FxSoundCore.Chain(sampleRate);this.settings={};}', 'constructor(){super();this.chain=new FxSoundCore.Chain(sampleRate);this.settings={};this.port.onmessage=()=>{this.failNext=true;};}')
            .replace('this.chain.process(inputs[0],outputs[0],this.settings);return true;', 'if(this.failNext)throw new Error("Injected processor failure");this.chain.process(inputs[0],outputs[0],this.settings);return true;');
          const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
          await context.audioWorklet.addModule(url); URL.revokeObjectURL(url); registered = true;
        };
        const Node = AudioWorkletNode;
        window.AudioWorkletNode = class extends Node { constructor(...args) { super(...args); window.__processor = this; } };
        soundSettings = MedoSound.normalize({ preset: 'flat', enabled: true }); ensureAudioProcessing(); await soundInitialization;
      });
      await playTone(); const before = await audible();
      await page.evaluate(() => window.__processor.port.postMessage('fail'));
      await page.waitForFunction(() => !!soundFailure && !soundEngine && !soundSettings.enabled);
      const after = await audible();
      assert.match(await page.locator('#sound-status').textContent(), /已恢复原声/);
      await page.evaluate(async () => { soundSettings.enabled = true; ensureAudioProcessing(); await soundInitialization; updateSoundSettings(); });
      await page.waitForFunction(() => !!soundEngine && !soundFailure);
      const retry = await audible();
      return { before, after, retry, recovered: true };
    });

    await scenario(7, 'Actual Worklet routing and bypass remain sample-correct on 1/2/4/6/8 channels', async () => {
      // Restore the unmodified module loader in a new document/context.
      await page.evaluate(() => { audio.pause(); soundSettings.enabled = false; updateSoundSettings(); });
      await page.reload(); await ready();
      const cases = [];
      for (const channels of [1, 2, 4, 6, 8]) for (const enabled of [false, true]) {
        const measured = await page.evaluate(async ({ channels, enabled }) => {
          const context = new OfflineAudioContext(channels, 4096, 48000); await MedoSound.prepare(context);
          const source = context.createBufferSource(), buffer = context.createBuffer(channels, 4096, 48000);
          for (let c = 0; c < channels; c++) for (let i = 0; i < 4096; i++) buffer.getChannelData(c)[i] = .08 * Math.sin(i * .17 + c + .5);
          source.buffer = buffer;
          MedoSound.create(context, source, context.destination).update({ ...MedoSound.presets.flat, enabled, normalization: -18, volumeLeveling: 2, masterGain: 6, balance: -6 });
          source.start(); const result = await context.startRendering();
          return Array.from({ length: channels }, (_, c) => Array.from(result.getChannelData(c)));
        }, { channels, enabled });
        const chain = new core.Chain(48000), input = Array.from({ length: channels }, () => new Float32Array(128)), target = input.map(() => new Float32Array(128));
        const settings = { bypass: !enabled, clarity: 0, clarityOn: 0, surround: 0, surroundOn: 0, ambience: 0, bass: 0, bassOn: 0, dynamics: 1, normalization: -18, volumeLeveling: 2, masterGain: 6, balance: -6 }; let maximumError = 0;
        for (let start = 0; start < 4096; start += 128) {
          for (let c = 0; c < channels; c++) for (let i = 0; i < 128; i++) input[c][i] = .08 * Math.sin((start + i) * .17 + c + .5);
          chain.process(input, target, settings);
          for (let c = 0; c < channels; c++) for (let i = 0; i < 128; i++) maximumError = Math.max(maximumError, Math.abs(target[c][i] - measured[c][start + i]));
        }
        assert.ok(maximumError < 3e-6); cases.push({ channels, enabled, maximumError });
      }
      return { cases };
    });

    await scenario(8, 'Native C loudness regression: quiet window, normalization and surround LFE', () => {
      const oracle = build(path.join(folder, 'native'));
      const vectors = [
        { channels: 2, seconds: 34, profile: 'quiet', level: .5 },
        { channels: 2, seconds: 3, profile: 'dynamic', level: 2, normalization: -18 },
        { channels: 6, profile: 'dynamic', level: 2 },
        { channels: 8, rate: 192000, seconds: 1, profile: 'impulse', level: 4 }
      ].map(vector => oracle(vector));
      return { vectors, maximumError: Math.max(...vectors.map(vector => vector.maximumError)) };
    });
  } finally { await app.close(); }
  assert.equal(results.length, 8);
  const report = { total: 8, passed: results.filter(item => item.status === 'PASS').length, failed: results.filter(item => item.status !== 'PASS').length, rendererErrors: errors, runFolder: folder, results };
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log('SUMMARY ' + JSON.stringify({ total: 8, passed: report.passed, failed: report.failed, rendererErrors: errors, runFolder: folder }));
  if (report.failed || errors.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
