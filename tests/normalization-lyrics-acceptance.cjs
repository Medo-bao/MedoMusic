// Fixed eight-scenario acceptance after the complete loudness/provider change.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {_electron}=require('playwright');
const core=require('../src/fxsound-core');
const {build}=require('./fxsound-leveling-reference.cjs');
const {createOnlineLyricsSearch,LYRICS_CACHE_VERSION}=require('../src/lyrics-search');
const root=path.resolve(__dirname,'..'),output=path.join(__dirname,'artifacts/normalization-lyrics');
fs.mkdirSync(output,{recursive:true});
const runFolder=fs.mkdtempSync(path.join(output,'run-'));
const results=[],errors=[];
let oracle;
async function scenario(id,name,action){
  try{results.push({id,name,status:'PASS',...await action()});}
  catch(error){results.push({id,name,status:'FAIL',error:error.stack||String(error)});}
  console.log(JSON.stringify(results.at(-1)));
}
function unit(file){return execFileSync(process.execPath,[path.join(__dirname,file)],{cwd:root,encoding:'utf8',timeout:180000,stdio:'pipe'}).trim();}
function soundModule(){
  const sandbox={FxSoundCore:core,FxSoundCoreModule:core.FxSoundCoreModule,URL,Blob,WeakMap,console};
  sandbox.window=sandbox;vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root,'src/sound-enhancement.js'),'utf8'),sandbox);
  return sandbox.MedoSound;
}
function createFixture(){
  const folder=path.join(runFolder,'app'),profile=path.join(folder,'Profile');
  fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(path.join(folder,'Music'),{recursive:true});
  fs.writeFileSync(path.join(profile,'apple-music.json'),JSON.stringify({mediaUserToken:'synthetic-retired-token',enabled:true,storefront:'us'}));
  fs.writeFileSync(path.join(folder,'package.json'),JSON.stringify({name:'medo-loudness-acceptance',version:'1.6.3',main:'main.cjs'}));
  fs.writeFileSync(path.join(folder,'main.cjs'),`
    const {app,globalShortcut,shell,ipcMain}=require('electron');
    app.setPath('userData',${JSON.stringify(profile)});app.setPath('music',${JSON.stringify(path.join(folder,'Music'))});
    const keys=new Set();globalShortcut.register=key=>{if(keys.has(key))return false;keys.add(key);return true;};
    globalShortcut.isRegistered=key=>keys.has(key);globalShortcut.unregister=key=>keys.delete(key);
    shell.openExternal=async()=>{};
    const state=globalThis.__acceptance={calls:[],handlers:[],translationRequests:[]};
    const handle=ipcMain.handle.bind(ipcMain);
    ipcMain.handle=(name,listener)=>{state.handlers.push(name);return handle(name,(event,...args)=>{if(name==='lyrics:translate')state.translationRequests.push(args[0]);return listener(event,...args);});};
    globalThis.fetch=async(input,init={})=>{
      const url=String(input);state.calls.push(url);
      if(url.includes('music.apple.com'))throw Error('Retired provider was requested');
      const response=(data,text='')=>({ok:true,status:200,json:async()=>data,text:async()=>text});
      if(url.startsWith('https://api.github.com/'))return response({tag_name:'v1.6.3'});
      if(url.startsWith('https://translate.googleapis.com/'))return response([[['再見','Goodbye']]]);
      return response({result:{songs:[]}});
    };
    require(${JSON.stringify(path.join(root,'src/main.js'))});
  `);
  return folder;
}

async function main(){
  await scenario(1,'Anonymous Apple access evidence and provider removal',()=>{
    const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/retired-provider-access.json')));
    assert.equal(evidence.results.length,4);assert.ok(evidence.results.every(item=>!item.hasTtml));
    assert.equal(evidence.accountEndpoint.status,403);
    assert.ok(evidence.followup.every(item=>item.status===200 && !item.lyricRelationship));
    for(const file of ['src/apple-music.js','src/apple-music-settings.js','tests/apple-music-provider.test.js'])assert.equal(fs.existsSync(path.join(root,file)),false,file);
    for(const file of ['src/main.js','src/renderer.js','src/preload.js','src/lyrics-search.js','src/lyrics-source-priority.js']){
      const source=fs.readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(source,/createAppleLyricsFetcher|getAppleMusicSettings|apple-music:(get|update|clear)|amp-api\.music\.apple\.com/);
    }
    return {checkedAt:evidence.checkedAt,anonymousLyrics:false,accountStatus:403,probes:evidence.results.map(({name,variant,status})=>({name,variant,status})),providerRemoved:true};
  });

  await scenario(2,'Default-off loudness controls, range mapping and preset migration',()=>{
    const log=unit('sound-master-gain.test.js'),sound=soundModule();
    for(const preset of Object.values(sound.presets)){
      const state=sound.normalize(preset);assert.equal(state.normalization,0);assert.equal(state.volumeLeveling,0);
    }
    const legacy=sound.fromStorage({clarity:2,bass:3});
    assert.equal(legacy.clarity,50);assert.equal(legacy.bass,50);assert.equal(legacy.normalization,0);assert.equal(legacy.volumeLeveling,0);
    const settings=sound.normalize({normalization:-99,volumeLeveling:2.3});
    assert.equal(settings.normalization,-40);assert.equal(settings.volumeLeveling,2.5);
    assert.equal(sound.normalize({normalization:10,volumeLeveling:-3}).normalization,0);
    assert.equal(sound.normalize({volumeLeveling:99}).volumeLeveling,4);
    return {log,defaults:{normalization:0,volumeLeveling:0},legacy:{clarity:legacy.clarity,bass:legacy.bass},ranges:{normalization:[-40,0],volumeLeveling:[0,4,.5]}};
  });

  await scenario(3,'Normalization matches original C SOS attenuation and channel rules',()=>{
    oracle=build(path.join(runFolder,'native'));
    const vectors=[
      {channels:2,normalization:-18},{channels:2,normalization:-40},{channels:2,normalization:-6,rate:192000},
      {channels:1,normalization:-18},{channels:6,normalization:-18},{channels:8,normalization:-18}
    ].map(vector=>oracle({...vector,seconds:1}));
    return {vectors,maximumError:Math.max(...vectors.map(item=>item.maximumError))};
  });

  await scenario(4,'Volume leveling matches original C: quiet window, transients, LFE and control changes',()=>{
    oracle ||= build(path.join(runFolder,'native'));
    const vectors=[
      {channels:2,seconds:34,profile:'quiet',level:.5},
      {channels:2,seconds:3,profile:'dynamic',level:2,normalization:-18},
      {channels:1,rate:44100,profile:'dynamic',level:4},
      {channels:2,rate:96000,profile:'tones',level:4},
      {channels:6,profile:'dynamic',level:2},
      {channels:8,rate:192000,seconds:1,profile:'impulse',level:4},
      {channels:2,profile:'dynamic',transition:true},
      {channels:2,profile:'silence',level:2}
    ].map(vector=>oracle(vector));
    return {vectors,maximumError:Math.max(...vectors.map(item=>item.maximumError))};
  });

  await scenario(5,'Disabled new controls preserve the original five-effect/EQ chain and bypass',()=>{
    const log=unit('fxsound-chain-reference.cjs');
    const reports=JSON.parse(fs.readFileSync(path.join(__dirname,'artifacts/fxsound-chain/report.json')));
    assert.equal(reports.length,24);assert.equal(Math.max(...reports.map(item=>item.error)),0);
    for(const channels of [1,2,4,6,8]){
      const chain=new core.Chain(48000),input=Array.from({length:channels},(_,c)=>Float32Array.from({length:128},(_,i)=>.2*Math.sin(i*.12+c+.3)));
      const target=input.map(()=>new Float32Array(128));
      chain.process(input,target,{bypass:true,normalization:-40,volumeLeveling:4,masterGain:20,balance:20});
      input.forEach((source,c)=>assert.deepEqual(target[c],source));
    }
    return {log,vectors:24,maximumError:0,bypassChannels:[1,2,4,6,8]};
  });

  const fixture=createFixture(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const application=await _electron.launch({executablePath:path.join(root,'.electron-dist/electron.exe'),args:[fixture],cwd:root,env});
  try{
    const page=await application.firstWindow();page.on('pageerror',error=>errors.push(error.message));
    const ready=()=>page.waitForFunction(()=>typeof lastShortcutStates!=='undefined' && lastShortcutStates.size===5);
    await ready();

    await scenario(6,'Actual AudioWorklet runs both controls with native routing and default bypass',async()=>{
      const cases=[];
      for(const channels of [1,2,4,6,8]){
        const measured=await page.evaluate(async channels=>{
          const context=new OfflineAudioContext(channels,4096,48000);await MedoSound.prepare(context);
          const source=context.createBufferSource(),buffer=context.createBuffer(channels,4096,48000);
          for(let c=0;c<channels;c++)for(let i=0;i<4096;i++)buffer.getChannelData(c)[i]=.08*Math.sin(i*.17+c+.5);
          source.buffer=buffer;MedoSound.create(context,source,context.destination).update({...MedoSound.presets.flat,enabled:true,normalization:-18,volumeLeveling:2});
          source.start();const result=await context.startRendering();return Array.from({length:channels},(_,c)=>Array.from(result.getChannelData(c)));
        },channels);
        const chain=new core.Chain(48000),input=Array.from({length:channels},()=>new Float32Array(128)),target=input.map(()=>new Float32Array(128));let error=0;
        const settings={bypass:false,clarity:0,clarityOn:0,surround:0,surroundOn:0,ambience:0,bass:0,bassOn:0,dynamics:1,normalization:-18,volumeLeveling:2};
        for(let start=0;start<4096;start+=128){
          for(let c=0;c<channels;c++)for(let i=0;i<128;i++)input[c][i]=.08*Math.sin((start+i)*.17+c+.5);
          chain.process(input,target,settings);
          for(let c=0;c<channels;c++)for(let i=0;i<128;i++)error=Math.max(error,Math.abs(target[c][i]-measured[c][start+i]));
        }
        assert.ok(error<3e-6,JSON.stringify({channels,error}));cases.push({channels,maximumError:error});
      }
      return {cases};
    });

    await scenario(7,'UI, preset persistence, reset and retired credential cleanup',async()=>{
      assert.equal(fs.existsSync(path.join(fixture,'Profile/apple-music.json')),false);
      await page.evaluate(()=>{
        localStorage.setItem('medo.appleMusicEnabled','true');localStorage.setItem('medo.appleMusicStorefront','us');
        soundSettings=MedoSound.normalize({...MedoSound.presets.recommended,preset:'recommended',enabled:true});updateSoundSettings();
      });
      await page.reload();await ready();
      const retired=await page.evaluate(()=>({ui:!!document.querySelector('[id^="apple-music"]'),methods:Object.keys(window.medo).filter(key=>/apple/i.test(key)),oldStorage:localStorage.getItem('medo.appleMusicEnabled')}));
      assert.deepEqual(retired,{ui:false,methods:[],oldStorage:null});
      await page.evaluate(()=>document.querySelector('#sound-dialog').showModal());
      await page.locator('#sound-normalization').focus();await page.keyboard.press('Home');
      await page.locator('#sound-volume-leveling').focus();await page.keyboard.press('End');
      assert.deepEqual(await page.evaluate(()=>[soundSettings.normalization,soundSettings.volumeLeveling]),[-40,4]);
      await page.locator('#sound-save').click();await page.reload();await ready();
      assert.deepEqual(await page.evaluate(()=>[soundSettings.normalization,soundSettings.volumeLeveling]),[-40,4]);
      const layouts=[];
      for(const [width,height,theme] of [[1440,960,'light'],[960,720,'dark']]){
        await application.evaluate(({BrowserWindow},size)=>{const window=BrowserWindow.getAllWindows()[0];window.unmaximize();window.setContentSize(...size);},[width,height]);
        await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.querySelector('#sound-dialog').showModal();},theme);
        await page.waitForFunction(()=>!document.getAnimations().some(item=>item.playState==='running' && item.effect?.target?.id==='sound-dialog'));
        const geometry=await page.evaluate(()=>{const dialog=document.querySelector('#sound-dialog'),a=document.querySelector('#sound-normalization').getBoundingClientRect(),b=document.querySelector('#sound-volume-leveling').getBoundingClientRect();return {leftEffects:document.querySelectorAll('.sound-controls label').length,overflow:dialog.scrollWidth-dialog.clientWidth,gainVisible:a.width>100 && a.height>0,levelVisible:b.width>100 && b.height>0};});
        assert.equal(geometry.leftEffects,5);assert.ok(geometry.overflow<=1);assert.ok(geometry.gainVisible && geometry.levelVisible);
        const screenshot=path.join(runFolder,`controls-${theme}.png`);await page.locator('#sound-dialog').screenshot({path:screenshot});
        await page.evaluate(()=>document.querySelector('#sound-dialog').close());layouts.push({width,height,theme,...geometry,screenshot});
      }
      await page.evaluate(()=>document.querySelector('#sound-dialog').showModal());
      await page.locator('#sound-normalization').dblclick();await page.locator('#sound-volume-leveling').dblclick();
      assert.deepEqual(await page.evaluate(()=>[soundSettings.normalization,soundSettings.volumeLeveling]),[0,0]);
      await page.locator('#sound-reset').click();
      assert.deepEqual(await page.evaluate(()=>[soundSettings.normalization,soundSettings.volumeLeveling]),[0,0]);
      await page.evaluate(()=>document.querySelector('#sound-dialog').close());
      const runtime=await application.evaluate(()=>({handlers:globalThis.__acceptance.handlers.filter(name=>name.startsWith('apple-music:')),requests:globalThis.__acceptance.calls.filter(url=>url.includes('music.apple.com'))}));
      assert.deepEqual(runtime,{handlers:[],requests:[]});
      return {retired,credentialDeleted:true,layouts,saved:[-40,4],reset:[0,0],runtime};
    });

    await scenario(8,'Account-free lyric sources, offline TTML, mixed sync and partial translation',async()=>{
      const logs=['ttml.test.js','lyrics-source-priority.test.js','lyrics-matching.test.js','word-lyrics-search.test.js'].map(unit);
      const cache={},requests=[];
      const search=createOnlineLyricsSearch({getCache:async()=>cache,now:()=>100000,fetchImplementation:async url=>{
        requests.push(String(url));const isLrc=String(url).startsWith('https://lrclib.net/');
        return {ok:true,status:200,json:async()=>isLrc?[{trackName:'Example',artistName:'Singer',duration:120,syncedLyrics:'[00:01.00]Hello'}]:{result:{songs:[]}},text:async()=>''};
      }});
      const found=await search({title:'Example',artist:'Singer',duration:120,mode:'auto'});
      assert.equal(found.source,'lrclib');assert.equal(found.retryAt,100000+30*86400000);assert.equal(LYRICS_CACHE_VERSION,8);
      assert.ok(requests.every(url=>!url.includes('music.apple.com')));
      const state=await page.evaluate(async()=>{
        const mixed=parseLyrics('[1000,1000]你(1000,500)好(1500,500)\n[00:03.00]普通歌词',8);
        const track={id:'partial-translation',title:'Partial',artist:'Fixture'};
        const lyrics={synced:true,level:'line',lines:[{start:1,text:'Hello',translations:{'zh-hans':'你好'}},{start:2,text:'Goodbye'}]};
        lyricsCache.set(track.id,lyrics);lyricTranslationEnabled=true;await ensureLyricTranslation(track);
        return {mixed:mixed.level,rows:lyrics.lines.map((_,index)=>lyricTranslationFor(track.id,lyrics,index)),ttmlAvailable:typeof MedoTtml.parseTtml==='function'};
      });
      assert.equal(state.mixed,'mixed');assert.deepEqual(state.rows,['你好','再见']);assert.equal(state.ttmlAvailable,true);
      const translation=await application.evaluate(()=>globalThis.__acceptance.translationRequests);
      assert.deepEqual(translation.at(-1).lines,['Goodbye']);
      return {logs,source:found.source,cacheVersion:LYRICS_CACHE_VERSION,...state};
    });
  }finally{await application.close();}
  assert.equal(results.length,8,'exactly eight acceptance scenarios');
  const report={total:8,passed:results.filter(item=>item.status==='PASS').length,failed:results.filter(item=>item.status!=='PASS').length,rendererErrors:errors,runFolder,results};
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
  console.log('SUMMARY '+JSON.stringify({total:8,passed:report.passed,failed:report.failed,rendererErrors:errors,runFolder}));
  if(report.failed||errors.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
