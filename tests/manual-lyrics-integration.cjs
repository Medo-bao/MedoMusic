// Exactly two integration scenarios; run only after the feature is complete.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const artifacts = path.join(__dirname, `artifacts/manual-lyrics-${version}`);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-manual-lyrics-'));
const selected = Number(process.argv.find(a => a.startsWith('--case='))?.split('=')[1]) || null;
const reportFile = path.join(artifacts, 'results.json');
fs.mkdirSync(artifacts, { recursive: true });
const report = selected && fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { total: 2, version, scenarios: [] };
const applications = new Set();
const music = path.join(directory, 'Music'); fs.mkdirSync(music);
const files = [path.join(music, 'a.wav'), path.join(music, 'b.wav')];
const local = '[00:00.00]本地自动第一句\n[00:05.00]本地自动第二句';
const qqLine = '[00:00.00]手动QQ第一句\n[00:05.00]手动QQ第二句';
const netWord = '[0,5000](0,2500,0)手动(2500,2500,0)逐字\n[5000,5000](5000,5000,0)手动逐字第二句';
const publicLine = '[00:00.00]LRCLIB第一句\n[00:05.00]LRCLIB第二句';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const data = Buffer.alloc(44 + 8000 * 120 * 2);
data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
for (const file of files) { fs.writeFileSync(file, data); fs.writeFileSync(file.replace('.wav', '.lrc'), local); }

async function launch(label) {
  const fixture = path.join(directory, label); fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'medo-manual-lyrics-test', version: require('../package.json').version, main: 'main.cjs' }));
  fs.writeFileSync(path.join(fixture, 'main.cjs'), `
    const {app,globalShortcut}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(fixture, 'Profile'))});app.setPath('music',${JSON.stringify(music)});
    globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};globalShortcut.isRegistered=()=>true;
    const extension=require.resolve(${JSON.stringify(path.join(root, 'src/myfirefly-extension.js'))});
    require.cache[extension]={id:extension,filename:extension,loaded:true,exports:{startMyFireflyExtension:async()=>({stop:async()=>{}})}};
    const state=globalThis.__manualFixture={mode:'normal',calls:[],aborted:0};
    const response=value=>({ok:true,status:200,json:async()=>value,text:async()=>String(value)});
    const pending=signal=>new Promise((resolve,reject)=>{
      state.startedResolve?.();const stop=()=>{state.aborted++;state.abortResolve?.();reject(new DOMException('Cancelled','AbortError'));};
      if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
    });
    globalThis.fetch=async(input,init={})=>{
      const url=String(input);
      if(url.includes('api.github.com'))return response({tag_name:'v${version}'});
      state.calls.push({url,body:String(init.body||'')});
      if(state.mode==='fail')throw new Error('fixture network failure');
      if(url.includes('musicu.fcg')){
        if(state.mode==='pending-search')return pending(init.signal);
        return response({req_1:{data:{body:{song:{list:[{id:11,mid:'qq11',name:'手动QQ候选',singer:[{name:'候选歌手'}],album:{name:'手动专辑'},interval:120}]}}}}});
      }
      if(url.includes('lyric_download'))return response('');
      if(url.includes('fcg_query_lyric'))return response(${JSON.stringify('MusicJsonCallback_lrc(' + JSON.stringify({ code: 0, lyric: Buffer.from(qqLine).toString('base64') }) + ');')});
      if(url.includes('cloudsearch'))return response({result:{songs:[{id:22,name:'自动歌曲',ar:[{name:'自动歌手'}],al:{name:'本地专辑'},dt:120000}]}});
      if(url.includes('/eapi/')){
        if(state.mode==='pending-preview')return pending(init.signal);
        return response({code:200,yrc:{lyric:${JSON.stringify(netWord)}},lrc:{lyric:${JSON.stringify(local)}}});
      }
      if(url.includes('lrclib.net'))return response([{id:33,trackName:'LRCLIB候选',artistName:'第三方歌手',albumName:'公开专辑',duration:120,syncedLyrics:${JSON.stringify(publicLine)}}]);
      return response([]);
    };
    require(${JSON.stringify(path.join(root, 'src/main.js'))});
  `);
  const app = await _electron.launch({ executablePath: path.join(root, '.electron-dist/electron.exe'), args: [fixture], cwd: root, env });
  applications.add(app);
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof ensureLyrics === 'function' && localStorage.getItem('medo.initialScanComplete') === 'true');
  await app.evaluate(({ BrowserWindow }) => { const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));win.setSize(1280,820);win.show(); });
  await page.evaluate(async files => {
    applyAutoUpdateSetting(false); lyricTranslationEnabled=false; wordLyricsEnabled=false;
    cancelPendingLyrics();lyricsCache.clear();
    tracks=files.map((file,i)=>({id:file,path:file,title:i?'第二首歌曲':'自动歌曲',artist:'自动歌手',album:'本地专辑',duration:120,metadataLoaded:true,format:'WAV',playlists:[]}));
    currentIndex=-1;playbackQueueIds=tracks.map(t=>t.id);currentView='library';query='';audio.muted=true;render();
    await playTrack(0,true);await ensureLyrics(tracks[0]);openPlaybackDetail();
  }, files);
  return {app,page,errors,fixture};
}
async function close(context) {applications.delete(context.app);await context.app.close();}
async function mode(context,value) {
  await context.app.evaluate((_electron,value)=>{
    const state=globalThis.__manualFixture;state.mode=value;
    state.started=new Promise(resolve=>{state.startedResolve=resolve;});
    state.abort=new Promise(resolve=>{state.abortResolve=resolve;});
  },value);
}
async function openSearch(context,provider='all') {
  await context.page.getByRole('button',{name:'手动搜索网络歌词',exact:true}).click();
  await waitSearch(context);
  await context.page.locator('#lyric-search-title').fill('修正的歌名');
  await context.page.locator('#lyric-search-artist').fill('修正的歌手');
  await context.page.locator('#lyric-search-provider').selectOption(provider);
}
async function search(context) {
  await context.page.locator('#lyric-search-submit').click();
  await waitSearch(context);
}
async function waitSearch(context) {
  await context.page.waitForFunction(()=>!document.querySelector('#lyric-search-submit').disabled &&
    document.querySelector('#lyric-search-preview').textContent !== '正在获取歌词…');
}
async function choose(context,title) {
  await context.page.locator('#lyric-search-results').getByRole('option').filter({hasText:title}).click();
  await context.page.waitForFunction(()=>!document.querySelector('#lyric-search-apply').disabled);
}
async function apply(context) {
  await context.page.locator('#lyric-search-apply').click();
  await context.page.waitForFunction(()=>!document.querySelector('#lyric-search-dialog').open);
}
const scenarios=[
  ['Automatic dialog search, remembered provider, manual choices and restore',async()=>{
    let context=await launch('complete-flow');
    const checkpoints=[];
    try {
      const placement=await context.page.evaluate(()=>{
        const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};
        document.querySelector('#detail-queue-count').textContent='192 首歌曲';
        return {count:rect('detail-queue-count'),search:rect('detail-search-lyrics'),refresh:rect('detail-refresh-lyrics')};
      });
      assert.ok(placement.count.right<=placement.search.left+.5);assert.ok(placement.search.right<=placement.refresh.left+.5);assert.ok(placement.search.width>20);
      await context.page.evaluate(()=>applyTheme('light'));
      await context.page.locator('.detail-queue > header').screenshot({path:path.join(artifacts,'toolbar-light.png')});
      await context.page.getByRole('button',{name:'手动搜索网络歌词',exact:true}).click();
      await waitSearch(context);
      assert.equal(await context.page.locator('#lyric-search-provider').inputValue(),'auto');
      assert.equal(await context.page.locator('.lyric-search-result').count(),1);
      assert.ok((await context.page.locator('#lyric-search-preview').textContent()).includes('手动逐字'));
      assert.equal(await context.page.evaluate(()=>lyricsCache.get(tracks[0].id).source),'sidecar');
      const initialCalls=await context.app.evaluate(()=>globalThis.__manualFixture.calls.map(call=>call.url));
      assert.ok(initialCalls.some(url=>url.includes('musicu.fcg'))&&initialCalls.some(url=>url.includes('cloudsearch')));
      assert.ok(initialCalls.findIndex(url=>url.includes('musicu.fcg')) < initialCalls.findIndex(url=>url.includes('cloudsearch')));
      assert.equal(initialCalls.some(url=>url.includes('lrclib.net')),false);
      checkpoints.push('First open starts original ordered automatic matching without submitting or replacing current lyrics');
      await context.page.keyboard.press('Escape');
      await openSearch(context);await search(context);
      assert.equal(await context.page.locator('.lyric-search-result').count(),3);
      await choose(context,'手动QQ候选');
      assert.ok((await context.page.locator('#lyric-search-preview').textContent()).includes('手动QQ第一句'));
      assert.equal(await context.page.locator('#lyric-preview-kind').textContent(),'逐行歌词');
      await context.page.screenshot({path:path.join(artifacts,'search-light.png')});
      await context.page.evaluate(()=>applyTheme('dark'));
      await context.page.screenshot({path:path.join(artifacts,'search-dark.png')});
      await apply(context);
      assert.deepEqual(await context.page.evaluate(()=>({manual:lyricsCache.get(tracks[0].id).manual,source:lyricsCache.get(tracks[0].id).source})),{manual:true,source:'qq-line'});
      checkpoints.push('Requested toolbar position; editable tags; all three sources; mismatched candidates remain selectable; preview/apply; both themes');
      await close(context);context=await launch('complete-flow');
      assert.equal(await context.page.evaluate(()=>lyricsCache.get(tracks[0].id).manual),true);
      assert.ok(await context.page.evaluate(()=>lyricsCache.get(tracks[0].id).lines.some(line=>line.text.includes('手动QQ'))));
      await context.page.getByRole('button',{name:'手动搜索网络歌词',exact:true}).click();
      await waitSearch(context);
      assert.equal(await context.page.locator('#lyric-search-provider').inputValue(),'qq');
      assert.ok((await context.page.locator('#lyric-search-preview').textContent()).includes('手动QQ'));
      assert.equal(await context.app.evaluate(()=>globalThis.__manualFixture.calls.length),0);
      await context.page.keyboard.press('Escape');
      await context.page.evaluate(()=>{wordLyricsEnabled=true;scheduleLyricRetry(tracks[0]);});
      assert.equal(await context.page.evaluate(()=>lyricRetryState),null);
      checkpoints.push('Actual restart restores the chosen provider and lyric preview without network calls; automatic word retries do not replace it');
      await openSearch(context,'netease');await search(context);
      assert.equal(await context.page.locator('.lyric-search-result').count(),1);
      await choose(context,'自动歌曲');
      assert.equal(await context.page.locator('#lyric-preview-kind').textContent(),'逐字歌词');
      await apply(context);
      assert.equal(await context.page.evaluate(()=>lyricsCache.get(tracks[0].id).source),'netease-word');
      const desktopOpened=context.app.waitForEvent('window');
      await context.page.evaluate(()=>window.medo.toggleLyricsWindow());
      const desktop=await desktopOpened;
      await context.page.waitForFunction(async()=> (await window.medo.getLyricsWindowState()).visible);
      await desktop.waitForFunction(()=>document.querySelector('#desktop-lyric')?.getAttribute('data-text')?.includes('手动'));
      checkpoints.push('NetEase YRC selection and desktop lyric synchronization');
      await openSearch(context,'lrclib');await search(context);await choose(context,'LRCLIB候选');await apply(context);
      assert.equal(await context.page.evaluate(()=>lyricsCache.get(tracks[0].id).source),'lrclib');
      await context.page.evaluate(()=>{wordLyricsEnabled=false;});
      await context.page.getByRole('button',{name:'手动搜索网络歌词',exact:true}).click();
      await waitSearch(context);
      assert.equal(await context.page.locator('#lyric-search-provider').inputValue(),'lrclib');
      assert.equal(await context.page.locator('#lyric-search-reset').isEnabled(),true);
      await context.page.locator('#lyric-search-reset').click();
      await context.page.waitForFunction(()=>!manualLyricDialog.open&&!lyricsRequests.size&&lyricsCache.get(tracks[0].id)?.source==='sidecar');
      assert.equal(await context.page.evaluate(()=>lyricsCache.get(tracks[0].id).manual),false);
      const saved=JSON.parse(fs.readFileSync(path.join(context.fixture,'Profile/lyric-selections.json'),'utf8'));
      assert.deepEqual(saved,{});
      await context.page.getByRole('button',{name:'手动搜索网络歌词',exact:true}).click();
      await waitSearch(context);
      assert.equal(await context.page.locator('#lyric-search-provider').inputValue(),'auto');
      await context.page.keyboard.press('Escape');
      checkpoints.push('LRCLIB selection and explicit restoration of automatic/local lyrics');
      assert.deepEqual(context.errors,[]);return {placement,checkpoints};
    } finally {await close(context);}
  }],
  ['Automatic lyrics, network refresh, cancellation and track-switch isolation',async()=>{
    const context=await launch('regression');const checkpoints=[];
    try {
      assert.equal(await context.page.evaluate(()=>lyricsCache.get(tracks[0].id).source),'sidecar');
      assert.equal(await context.app.evaluate(()=>globalThis.__manualFixture.calls.length),0);
      await context.page.locator('#detail-refresh-lyrics').click();
      await context.page.waitForFunction(()=>!document.querySelector('#detail-refresh-lyrics').classList.contains('loading'));
      assert.equal(await context.page.evaluate(()=>lyricsCache.get(tracks[0].id).source),'netease-word');
      const previous=await context.page.evaluate(()=>lyricsCache.get(tracks[0].id).lines.map(line=>line.text));
      await mode(context,'fail');
      await context.page.locator('#detail-refresh-lyrics').click();
      await context.page.waitForFunction(()=>!document.querySelector('#detail-refresh-lyrics').classList.contains('loading'));
      assert.deepEqual(await context.page.evaluate(()=>lyricsCache.get(tracks[0].id).lines.map(line=>line.text)),previous);
      assert.ok((await context.page.locator('#lyric-status').textContent()).includes('保留原歌词'));
      checkpoints.push('Automatic local precedence, original network refresh and failed-refresh preservation');
      await mode(context,'normal');await openSearch(context,'qq');await mode(context,'pending-search');
      await context.page.locator('#lyric-search-submit').click();
      await context.app.evaluate(()=>globalThis.__manualFixture.started);
      await context.page.keyboard.press('Escape');
      await context.app.evaluate(()=>globalThis.__manualFixture.abort);
      assert.equal(await context.page.evaluate(()=>manualLyricDialog.open),false);
      checkpoints.push('Escape closes the dialog and aborts its pending network request');
      await mode(context,'normal');await openSearch(context,'netease');await search(context);
      await mode(context,'pending-preview');
      await context.page.locator('#lyric-search-results').getByRole('option').click();
      await context.app.evaluate(()=>globalThis.__manualFixture.started);
      await context.page.evaluate(async()=>{await playTrack(1,true);await ensureLyrics(tracks[1]);});
      await context.app.evaluate(()=>globalThis.__manualFixture.abort);
      assert.deepEqual(await context.page.evaluate(()=>({index:currentIndex,open:manualLyricDialog.open,source:lyricsCache.get(tracks[1].id)?.source,manual:lyricsCache.get(tracks[1].id)?.manual})),{index:1,open:false,source:'sidecar',manual:false});
      checkpoints.push('Switching the playing track closes the old preview, aborts it and keeps the new track lyrics intact');
      await mode(context,'normal');
      await context.page.evaluate(async()=>{await playTrack(0,true);renderPlaybackDetail();});
      await openSearch(context,'qq');await search(context);await choose(context,'手动QQ候选');await apply(context);
      await mode(context,'fail');
      await context.page.locator('#detail-refresh-lyrics').click();
      await context.page.waitForFunction(()=>!document.querySelector('#detail-refresh-lyrics').classList.contains('loading'));
      const retained=await context.page.evaluate(track=>window.medo.readLyrics({filePath:track.path,title:track.title,artist:track.artist,mode:'auto'}),{path:files[0],title:'自动歌曲',artist:'自动歌手'});
      assert.equal(retained.manual,true);assert.ok(retained.text.includes('手动QQ'));
      checkpoints.push('A failed network refresh also retains the remembered manual choice');
      assert.deepEqual(context.errors,[]);return {checkpoints,aborted:await context.app.evaluate(()=>globalThis.__manualFixture.aborted)};
    }finally{await close(context);}
  }]
];
(async()=>{
  assert.equal(scenarios.length,2);
  try{
    for(const [index,[name,run]] of scenarios.entries()){
      const id=index+1;if(selected&&selected!==id)continue;
      console.log(`START ${id}/2 ${name}`);let result;
      try{result={id,name,pass:true,evidence:await run()};}catch(error){result={id,name,pass:false,error:error.stack};}
      report.scenarios=report.scenarios.filter(s=>s.id!==id).concat(result).sort((a,b)=>a.id-b.id);
      fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.log(`${result.pass?'PASS':'FAIL'} ${id}/2 ${result.pass?JSON.stringify(result.evidence):result.error}`);
    }
  }finally{
    for(const app of applications)await app.close().catch(()=>{});
    const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));
    assert.ok(/^medo-manual-lyrics-[A-Za-z0-9]+$/.test(path.basename(target)));
    fs.rmSync(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
  console.log(JSON.stringify({total:2,passed:report.scenarios.filter(s=>s.pass).length,reportFile}));
  if(report.scenarios.some(s=>!s.pass))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
