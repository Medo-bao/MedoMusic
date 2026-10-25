// Four fixed scenarios for the pause/play latency repair. Run after the repair.
// A real Windows system-loopback stream measures sound, not play() completion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const before = process.env.MEDO_AUDIO_BEFORE;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-audio-latency-'));
const artifacts = path.join(__dirname, 'artifacts', 'audio-transport-latency');
const reportFile = path.join(artifacts, 'results.json');
const selected = Number(process.argv.find(a => a.startsWith('--case='))?.split('=')[1]) || null;
const report = selected && fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { total: 4, before, scenarios: [] };
const applications = new Set();
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
fs.mkdirSync(artifacts, { recursive: true });
const music = path.join(work, 'Music'); fs.mkdirSync(music);
for (let track = 0; track < 2; track++) {
  const rate = 48000, frames = rate * 40, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(3000 * Math.sin(2 * Math.PI * (19013 - track * 1000) * i / rate));
    wav.writeInt16LE(value, 44 + i * 4); wav.writeInt16LE(value, 46 + i * 4);
  }
  fs.writeFileSync(path.join(music, `${track}.wav`), wav);
}

async function launch(source, label, executable = path.join(root, '.electron-dist', 'electron.exe')) {
  const fixture = path.join(work, label); fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'medo-audio-latency', version: '1.6.4', main: 'main.cjs' }));
  fs.writeFileSync(path.join(fixture, 'main.cjs'), `
    const {app,globalShortcut,session}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(fixture, 'profile'))});app.setPath('music',${JSON.stringify(music)});
    globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.isRegistered=()=>true;
    const extension=require.resolve(${JSON.stringify(path.join(source, 'src/myfirefly-extension.js'))});
    require.cache[extension]={id:extension,filename:extension,loaded:true,exports:{startMyFireflyExtension:async()=>({stop:async()=>{}})}};
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({tag_name:'v1.6.4',result:{songs:[]}}),text:async()=>''});
    app.whenReady().then(()=>session.defaultSession.setDisplayMediaRequestHandler((request,callback)=>callback({video:request.frame,audio:'loopback'})));
    require(${JSON.stringify(path.join(source, 'src/main.js'))});
  `);
  let args = [fixture];
  if (executable !== path.join(root, '.electron-dist', 'electron.exe')) {
    await asar.createPackage(fixture, path.join(path.dirname(executable), 'resources/app.asar'));
    args = [];
  }
  const app = await _electron.launch({ executablePath: executable, args, env, cwd: root }); applications.add(app);
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof tracks !== 'undefined' && localStorage.getItem('medo.initialScanComplete') === 'true');
  await page.evaluate(music => {
    applyAutoUpdateSetting(false); applyPlaybackFadeSetting(false);
    tracks = [0, 1].map(i => ({ id: `${music}\\${i}.wav`, path: `${music}\\${i}.wav`, title: `Latency ${i}`, artist: 'MedoMusic', album: 'Transport',
      duration: 40, format: 'WAV', metadataLoaded: true, playlists: [] }));
    playbackQueueIds = tracks.map(t => t.id); currentIndex = -1;
    ensureLyrics = async () => ({ synced: false, lines: [] });
    desiredVolume = .15; volume.value = .15;
    soundSettings = MedoSound.normalize({ ...MedoSound.presets.flat, enabled: false }); updateSoundSettings(); render();
  }, music);
  await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    if (!stream.getAudioTracks().length) throw new Error('Windows system loopback did not provide audio');
    const monitor = new AudioContext({ latencyHint: 'interactive' });
    const url = URL.createObjectURL(new Blob([`class Probe extends AudioWorkletProcessor {
      constructor(){
        super();this.on=false;this.silent=0;this.blocks=0;this.index=0;this.s1=0;this.s2=0;
        this.coefficient=2*Math.cos(2*Math.PI*19013/sampleRate);
        this.window=Float64Array.from({length:512},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/512));
      }
      process(inputs,outputs){
        const channel=inputs[0][0];
        for(let i=0;i<128;i++){
          const sample=(channel?.[i]||0)*this.window[this.index++];
          const next=sample+this.coefficient*this.s1-this.s2;this.s2=this.s1;this.s1=next;
          if(this.index===512){
            const level=4*Math.sqrt(Math.max(0,this.s1*this.s1+this.s2*this.s2-this.coefficient*this.s1*this.s2))/512;
            this.index=0;this.s1=0;this.s2=0;
            if(++this.blocks%8===0)this.port.postMessage({level,channels:inputs[0].length});
            if(level>.001){this.silent=0;if(!this.on){this.on=true;this.port.postMessage({on:true,level});}}
            else if(this.on && ++this.silent>=3){this.on=false;this.port.postMessage({on:false,level});}
          }
        }
        for(const channel of outputs[0])channel.fill(0);return true;
      }
    }registerProcessor('transport-probe',Probe);`], { type: 'text/javascript' }));
    await monitor.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(monitor, 'transport-probe');
    monitor.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(node).connect(monitor.destination);
    globalThis.transportProbe = { stream, monitor, node, events: [], levels: [], on: false };
    node.port.onmessage = ({ data }) => {
      if (!('on' in data)) { transportProbe.levels.push(data); if(transportProbe.levels.length>12)transportProbe.levels.shift(); return; }
      transportProbe.on = data.on; transportProbe.events.push({ ...data, at: performance.now() });
    };
    await monitor.resume();
  });
  await page.evaluate(async () => { await playTrack(0, true); await soundInitialization; });
  try {
    await page.waitForFunction(() => !audio.paused && audio.currentTime > .2 && transportProbe.on, null, { timeout: 5000 });
  } catch (error) {
    throw new Error(JSON.stringify(await page.evaluate(() => ({ paused: audio.paused, time: audio.currentTime, volume: audio.volume, base: outputAudioContext.baseLatency, state: outputAudioContext.state, levels: transportProbe.levels, tracks: transportProbe.stream.getAudioTracks().map(t => t.getSettings()) }))), { cause: error });
  }
  return { app, page, errors };
}
async function close(context) { applications.delete(context.app); await context.app.close(); }
async function transition(context, playing, expectedImmediate = true) {
  const action = await context.page.evaluate(playing => {
    const at = performance.now(), offset = transportProbe.events.length;
    playButton.click();
    return { at, offset, immediate: audio.paused === !playing, pending: playbackPausePending };
  }, playing);
  try {
    await context.page.waitForFunction(({ offset, playing }) => transportProbe.events.slice(offset).some(e => e.on === playing), { offset: action.offset, playing }, { timeout: 5000 });
  } catch (error) {
    throw new Error(JSON.stringify(await context.page.evaluate(() => ({ paused: audio.paused, context: outputAudioContext.state, probe: { on: transportProbe.on, events: transportProbe.events, levels: transportProbe.levels } }))), { cause: error });
  }
  const edge = await context.page.evaluate(({ offset, playing }) => transportProbe.events.slice(offset).find(e => e.on === playing), { offset: action.offset, playing });
  if (expectedImmediate) assert.equal(action.immediate, true, 'Transport must update the media element in the click handler');
  return { loopbackMs: edge.at - action.at, immediate: action.immediate, pending: action.pending };
}
async function cycles(context, expectedImmediate) {
  const result = [];
  for (let i = 0; i < 3; i++) {
    const pause = await transition(context, false, expectedImmediate);
    await sleep(1600);
    const stateWhilePaused = await context.page.evaluate(() => outputAudioContext.state);
    const resume = await transition(context, true, expectedImmediate);
    await sleep(400);
    result.push({ pause, resume, stateWhilePaused });
  }
  const latency = await context.page.evaluate(() => ({ baseMs: outputAudioContext.baseLatency * 1000, outputMs: outputAudioContext.outputLatency * 1000, sampleRate: outputAudioContext.sampleRate }));
  return { cycles: result, latency };
}
function checkDirect(result) {
  assert.ok(result.latency.baseMs <= 25, JSON.stringify(result));
  for (const cycle of result.cycles) {
    assert.equal(cycle.stateWhilePaused, 'running');
    assert.ok(cycle.pause.loopbackMs < 150 && cycle.resume.loopbackMs < 150, JSON.stringify(cycle));
  }
}
const scenarios = [
  ['Direct pause/resume measured through Windows system loopback', async () => {
    assert.ok(before && fs.existsSync(path.join(before, 'src/main.js')), 'Set MEDO_AUDIO_BEFORE to the pre-repair snapshot');
    const old = await launch(before, 'before'); const baseline = await cycles(old, false); await close(old);
    const fixed = await launch(root, 'after'); const repaired = await cycles(fixed, true); checkDirect(repaired);
    assert.deepEqual(fixed.errors, []); await close(fixed); return { baseline, repaired };
  }],
  ['Optional fade and interrupted fade preserve transport state', async () => {
    const fixed = await launch(root, 'fade');
    await fixed.page.evaluate(() => applyPlaybackFadeSetting(true));
    const fadePause = await transition(fixed, false, false);
    assert.equal(fadePause.pending, true); assert.equal(fadePause.immediate, false);
    assert.ok(fadePause.loopbackMs >= 190 && fadePause.loopbackMs < 450, JSON.stringify(fadePause));
    await sleep(500);
    const fadeResume = await transition(fixed, true);
    await sleep(350);
    const interrupted = await fixed.page.evaluate(async () => {
      const engine = soundEngine; pausePlayback();
      await new Promise(resolve => setTimeout(resolve, 70)); await resumePlayback();
      await new Promise(resolve => setTimeout(resolve, 350));
      return { paused: audio.paused, pending: playbackPausePending, gain: playbackFadeValue(), reused: soundEngine === engine, context: outputAudioContext.state };
    });
    assert.deepEqual(interrupted, { paused: false, pending: false, gain: 1, reused: true, context: 'running' });
    assert.ok(fadeResume.loopbackMs < 150, JSON.stringify(fadeResume));
    assert.deepEqual(fixed.errors, []); await close(fixed); return { fadePause, fadeResume, interrupted };
  }],
  ['Hidden window, idle resume and tray transport', async () => {
    const fixed = await launch(root, 'background');
    await fixed.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).hide());
    await fixed.page.waitForFunction(() => backgroundMode);
    const measurements = await cycles(fixed, true); checkDirect(measurements);
    await fixed.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')).webContents.send('tray:command', { command: 'toggle-play' }));
    await fixed.page.waitForFunction(() => audio.paused && !transportProbe.on);
    await sleep(800);
    await fixed.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html')); w.webContents.send('tray:command', { command: 'toggle-play' }); w.show(); });
    await fixed.page.waitForFunction(() => !audio.paused && transportProbe.on && !backgroundMode);
    assert.deepEqual(fixed.errors, []); await close(fixed); return measurements;
  }],
  ['Packaged audio path, enhancement and rapid repeated controls', async () => {
    const archive = path.join(root, 'release/win-unpacked/resources/app.asar');
    for (const file of ['src/renderer.js', 'src/renderer-playback.js']) assert.deepEqual(asar.extractFile(archive, path.normalize(file)), fs.readFileSync(path.join(root, file)));
    const packagedSource = path.join(work, 'packaged-source'); asar.extractAll(archive, packagedSource);
    // Launch the delivered executable in an isolated copy, with only the fixture
    // bootstrap substituted; all product modules/assets come from its archive.
    const runtime = path.join(work, 'packaged-runtime'); fs.cpSync(path.join(root, 'release/win-unpacked'), runtime, { recursive: true });
    const fixed = await launch(packagedSource, 'packaged', path.join(runtime, 'MedoMusic.exe'));
    await fixed.page.evaluate(() => { soundSettings.enabled = true; updateSoundSettings(); });
    const measurements = await cycles(fixed, true); checkDirect(measurements);
    const rapid = await fixed.page.evaluate(async () => {
      const engine = soundEngine;
      for (let i = 0; i < 15; i++) { pausePlayback(); const promise = resumePlayback(); if (audio.paused) throw new Error('Resume deferred'); await promise; }
      await Promise.all([playTrack(1, true), playTrack(0, true)]);
      await new Promise(resolve => setTimeout(resolve, 350));
      const playing = !audio.paused && currentIndex === 0 && !playbackPausePending;
      clearCurrentPlayback();
      return { playing, reused: soundEngine === engine, cleared: audio.paused && !audio.getAttribute('src') && currentIndex === -1 };
    });
    assert.deepEqual(rapid, { playing: true, reused: true, cleared: true });
    assert.deepEqual(fixed.errors, []); await close(fixed); return { measurements, rapid, packageBytes: fs.statSync(path.join(root, 'release/MedoMusic-Setup-1.6.4-x64.exe')).size };
  }]
];
(async () => {
  assert.equal(scenarios.length, 4);
  try {
    for (const [index, [name, run]] of scenarios.entries()) {
      const id = index + 1; if (selected && selected !== id) continue;
      console.log(`START ${id}/4 ${name}`);
      let result; try { result = { id, name, pass: true, evidence: await run() }; }
      catch (error) { result = { id, name, pass: false, error: error.stack }; }
      report.scenarios = report.scenarios.filter(r => r.id !== id).concat(result).sort((a, b) => a.id - b.id);
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); console.log(`${result.pass ? 'PASS' : 'FAIL'} ${id}/4 ${result.pass ? JSON.stringify(result.evidence) : result.error}`);
      for (const app of applications) { await app.close().catch(() => {}); applications.delete(app); }
    }
  } finally {
    for (const app of applications) await app.close().catch(() => {});
    const target = path.resolve(work);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir())); assert.ok(path.basename(target).startsWith('medo-audio-latency-'));
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  console.log(JSON.stringify({ total: report.total, passed: report.scenarios.filter(r => r.pass).length, reportFile }));
  if (report.scenarios.some(r => !r.pass)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
