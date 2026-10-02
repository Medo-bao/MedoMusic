const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'medo-cover-protocol-'));
  const executablePath = process.env.MEDO_TEST_EXECUTABLE || path.resolve(__dirname, '../release/win-unpacked/MedoMusic.exe');
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({executablePath, args:[`--user-data-dir=${profile}`], env, timeout:30000});
  try {
    const currentProfile = await app.evaluate(({app})=>app.getPath('userData'));
    assert.equal(path.resolve(currentProfile).toLowerCase(), profile.toLowerCase());
    const page = await app.firstWindow();
    await page.waitForFunction(()=>typeof coverAtmosphere === 'object');
    const result = await page.evaluate(async musicPath => {
      const metadata = await window.medo.readMetadata(musicPath);
      if (!metadata.cover) throw new Error('The fixture must have embedded album art');
      tracks = [{...metadata,id:'cover-protocol',path:musicPath,metadataLoaded:true}];
      currentIndex=0;currentView='player';playbackQueueIds=['cover-protocol'];
      lyricsCache.set('cover-protocol',{networkOnly:true,synced:false,lines:[]});
      applyTheme('light');render();
      const decoding = [];
      for (const cors of [false,true]) {
        const image = new Image(); if(cors) image.crossOrigin='anonymous'; image.src=metadata.cover;
        await image.decode();
        const canvas=Object.assign(document.createElement('canvas'),{width:10,height:10});
        const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,10,10);
        let pixelRead='ok';try{ctx.getImageData(0,0,1,1);}catch(error){pixelRead=error.name;}
        decoding.push({cors,decoded:image.naturalWidth>0,pixelRead});
      }
      await applyCoverTheme(metadata.cover);
      await Promise.all(['detail-cover','mini-cover'].map(id=>document.getElementById(id).decode()));
      return {cover:metadata.cover,decoding,detail:document.querySelector('#detail-cover').getAttribute('src'),mini:document.querySelector('#mini-cover').getAttribute('src'),tone:document.documentElement.style.getPropertyValue('--cover-tone')};
    }, process.argv[2]);
    console.log(JSON.stringify(result,null,2));
    assert.match(result.cover,/^medo-media:\/\/local\/cover/);
    assert.equal(result.detail,result.cover,'Decoded album artwork must not be replaced by the missing-art placeholder');
    assert.equal(result.mini,result.cover);
    assert.notEqual(result.tone,'var(--ambient-fallback)');
    const samplingFailure = await page.evaluate(async () => {
      const originalCover = tracks[0].cover;
      const samplingCover = `${originalCover}&sampling-test=1`;
      const originalRead = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = () => { throw new DOMException('sampling fixture', 'SecurityError'); };
      let preserved;
      try {
        tracks[0].cover = samplingCover;
        await applyCoverTheme(samplingCover);
        preserved = ['detail-cover','mini-cover'].every(id=>document.getElementById(id).getAttribute('src')===samplingCover);
      } finally { CanvasRenderingContext2D.prototype.getImageData = originalRead; }
      tracks[0].cover = originalCover; await applyCoverTheme(originalCover);
      return preserved;
    });
    assert.equal(samplingFailure,true,'Canvas failures must not hide successfully decoded artwork');
    result.samplingFailurePreservesCover = samplingFailure;
    await page.waitForTimeout(550);
    const output=path.join(__dirname,'artifacts','appearance');fs.mkdirSync(output,{recursive:true});
    await page.screenshot({path:path.join(output,'real-album-cover.png')});
    fs.writeFileSync(path.join(output,'real-cover-checks.json'),JSON.stringify(result,null,2));
    console.log('Real embedded-cover regression passed: metadata, custom protocol, original images and atmosphere');
  } finally {await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
