const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const root=path.resolve(__dirname, '..');
const version = require('../package.json').version;
const artifacts=path.join(__dirname,'artifacts/manual-lyrics-regressions');
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

(async()=>{
const results=[];let context;
try{
 const {searchManualLyrics}=require('../src/manual-lyrics');
 const responses={};for(const provider of ['qq','netease','lrclib'])responses[provider]=await searchManualLyrics({title:'Song',provider},{fetchImplementation:async()=>({ok:false,status:503})});
 assert.deepEqual(responses.qq.failedSources,['qq']);assert.deepEqual(responses.netease.failedSources,['netease']);assert.deepEqual(responses.lrclib.failedSources,['lrclib']);
 for(const provider of ['qq','netease','lrclib']) {
 const empty=await searchManualLyrics({title:'Song',provider},{fetchImplementation:async()=>({ok:true,json:async()=>provider==='lrclib'?[]:{code:0,result:{songs:[]}}})});
 assert.deepEqual(empty.failedSources,[]);assert.deepEqual(empty.candidates,[]);
 }
 const mixed=await searchManualLyrics({title:'Song',provider:'all'},{fetchImplementation:async url=>String(url).includes('lrclib')?{ok:true,json:async()=>[{id:1,trackName:'Song',plainLyrics:'Valid lyric text'}]}:{ok:false,status:503}});
 assert.deepEqual(mixed.failedSources,['qq','netease']);assert.equal(mixed.candidates.length,1);
 results.push({case:1,pass:true,name:'Source failures, empty matches and partial success',responses});console.log(JSON.stringify(results.at(-1)));
 context=await launch('reset-race');
 await openSearch(context,'qq');await search(context);await choose(context,'手动QQ候选');await apply(context);
 await context.page.getByRole('button',{name:'手动搜索网络歌词',exact:true}).click();await waitSearch(context);
 await context.app.evaluate(()=>{
   const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');
   const f=req('node:fs/promises'),original=f.writeFile;
   globalThis.__resetStarted=false;
   f.writeFile=async function(file,data,...args){
     if(String(file).endsWith('lyric-selections.json')&&data==='{}'){
       globalThis.__resetStarted=true;await new Promise(resolve=>globalThis.__releaseReset=resolve);
     }
     return original.call(this,file,data,...args);
   };
 });
 await context.page.locator('#lyric-search-reset').click();
 for(let i=0;i<50&&!await context.app.evaluate(()=>globalThis.__resetStarted);i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(await context.app.evaluate(()=>globalThis.__resetStarted),true);
 await context.page.locator('.lyric-search-result').first().click();
 await context.page.waitForFunction(()=>manualLyricsPreviewResult!==null);
 assert.equal(await context.page.locator('#lyric-search-apply').isDisabled(),true);
 await context.app.evaluate(()=>globalThis.__releaseReset());
 const selectionFile=path.join(context.fixture,'Profile/lyric-selections.json');
 for(let i=0;i<50&&fs.readFileSync(selectionFile,'utf8')!=='{}';i++)await new Promise(r=>setTimeout(r,20));
 await context.page.waitForFunction(()=>!manualLyricDialog.open&&!lyricsRequests.size&&lyricsCache.get(tracks[currentIndex].id)?.source==='sidecar');
 const state=await context.page.evaluate(()=>({manual:lyricsCache.get(tracks[currentIndex].id)?.manual,resetDisabled:manualLyricReset.disabled,dialogOpen:manualLyricDialog.open}));
 assert.equal(fs.readFileSync(selectionFile,'utf8'),'{}');assert.equal(state.manual,false);assert.equal(state.dialogOpen,false);assert.deepEqual(context.errors,[]);
 results.push({case:2,pass:true,name:'Reset remains consistent while preview changes',state,stored:JSON.parse(fs.readFileSync(selectionFile,'utf8')),pageErrors:context.errors});console.log(JSON.stringify(results.at(-1)));
}finally{if(context)await close(context);fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify(results,null,2));console.log('Evidence: '+artifacts);}
})().catch(e=>{console.error(e);process.exitCode=1;});