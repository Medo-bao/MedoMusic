// Real AudioContext acceptance. The observer silences output after inspecting
// production effects, so this verifies scheduling without playing test noise.
// --sample-reference additionally compares every actual effect sample with an
// independent instance fed the identical raw block. currentFrame anomalies remain
// diagnostic in this mode: continuity is checked in the actual sample stream.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright');const root=path.resolve(__dirname,'..');
(async()=>{
 const app=await _electron.launch({executablePath:path.join(root,process.argv.includes('--packaged')?'release/win-unpacked/MedoMusic.exe':'.electron-dist/electron.exe'),args:[...(process.argv.includes('--packaged')?[]:[root]),`--user-data-dir=${path.join(__dirname,'artifacts/fx-realtime-profile')}`]});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.MedoSound);
  const results=[],seconds=Number(process.argv.find(value=>value.startsWith('--seconds='))?.split('=')[1]||8);
  assert.ok(Number.isFinite(seconds)&&seconds>=8&&seconds<=120);
  for(const sampleRate of [48000,192000]){
   const result=await page.evaluate(async ({sampleRate,control,seconds,sampleReference})=>{
    const context=new AudioContext({sampleRate,latencyHint:'interactive'});await MedoSound.prepare(context);
    const observerSource=`class Observer extends AudioWorkletProcessor{
     constructor(options){super();this.sampleReference=options.processorOptions.sampleReference;this.control=options.processorOptions.control;this.sampleError=0;this.comparedSamples=0;this.reference=new FxSoundCore.Chain(sampleRate);this.referenceOutput=Array.from({length:8},()=>new Float32Array(128));this.referenceViews=Array.from({length:9},(_,n)=>this.referenceOutput.slice(0,n));[31,62,125,250,500,1000,2000,4000,8000,16000].forEach((hz,i)=>this.reference.eq.setBand(i,hz,i%2?-12:12));this.settings={bypass:0,clarityOn:1,surroundOn:1,bassOn:1,bass:127,ambience:127,clarity:FxSoundCore.clarityDrive(127),surround:FxSoundCore.surroundIntensity(127),dynamics:FxSoundCore.dynamicsGain(FxSoundCore.dynamicMidi(127))};this.frames=0;this.nonfinite=0;this.peak=0;this.lastFrame=null;this.discontinuities=0;this.gaps=[];this.channels=[];this.blocks=0;this.clockChangesWithinProcess=0;this.nextMarker=null;this.markerSamples=0;this.markerDiscontinuities=0;this.markerGaps=[];}
     process(inputs,outputs){const frameAtStart=currentFrame;const input=inputs[0],output=outputs[0],length=output[0].length;
      if(this.lastFrame!==null && frameAtStart!==this.lastFrame){this.discontinuities++;this.gaps.push({expected:this.lastFrame,actual:frameAtStart,channels:input.length});}
      this.lastFrame=frameAtStart+length;this.frames+=length;this.blocks++;
      if(this.channels[this.channels.length-1]!==input.length)this.channels.push(input.length);
      for(const channel of input)for(const value of channel){if(!Number.isFinite(value))this.nonfinite++;this.peak=Math.max(this.peak,Math.abs(value));}
      for(const value of inputs[1]?.[0]||[]){
       if(this.nextMarker!==null && value!==this.nextMarker){this.markerDiscontinuities++;if(this.markerGaps.length<16)this.markerGaps.push({expected:this.nextMarker,actual:value,frame:frameAtStart});}
       this.nextMarker=(value+1)%1048576;this.markerSamples++;
      }
      if(this.sampleReference && input.length){
       const raw=inputs[2],referenceOutput=this.referenceViews[input.length];
       if(!this.control)this.reference.process(raw,referenceOutput,this.settings);
       for(let c=0;c<input.length;c++)for(let i=0;i<length;i++){
        const expected=this.control?(raw[c]?.[i]||0):referenceOutput[c][i];
        this.sampleError=Math.max(this.sampleError,Math.abs(input[c][i]-expected));this.comparedSamples++;
       }
      }
      for(const channel of output)channel.fill(0);
      if(currentFrame!==frameAtStart)this.clockChangesWithinProcess++;
      if(this.blocks%128===0)this.port.postMessage({frames:this.frames,nonfinite:this.nonfinite,peak:this.peak,discontinuities:this.discontinuities,gaps:this.gaps,clockChangesWithinProcess:this.clockChangesWithinProcess,markerSamples:this.markerSamples,markerDiscontinuities:this.markerDiscontinuities,markerGaps:this.markerGaps,sampleError:this.sampleError,comparedSamples:this.comparedSamples,channels:this.channels});return true;
     }}registerProcessor('fx-observer',Observer);
     class Marker extends AudioWorkletProcessor{constructor(){super();this.index=0;}process(inputs,outputs){for(let i=0;i<outputs[0][0].length;i++){outputs[0][0][i]=this.index;this.index=(this.index+1)%1048576;}return true;}}
     registerProcessor('fx-marker',Marker);`;
    const url=URL.createObjectURL(new Blob([observerSource],{type:'text/javascript'}));
    await context.audioWorklet.addModule(url);URL.revokeObjectURL(url);
    const entry=context.createGain(),observer=new AudioWorkletNode(context,'fx-observer',{numberOfInputs:3,channelCount:8,channelCountMode:'clamped-max',processorOptions:{control,sampleReference}});
    const marker=new AudioWorkletNode(context,'fx-marker',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});marker.connect(observer,0,1);entry.connect(observer,0,2);
    observer.connect(context.destination);const engine=control?{update(){}}:MedoSound.create(context,entry,observer);if(control)entry.connect(observer);
    const settings={enabled:true,clarity:4,bass:6,ambience:100,surround:100,dynamics:100,eq:[12,-12,12,-12,12,-12,12,-12,12,-12]};
    engine.update(settings);
    const formats=[2,8,1,6],sources=[];let playing=null,last=null,changes=0;
    const buffers=formats.map(channels=>{const buffer=context.createBuffer(channels,context.sampleRate,context.sampleRate);
      for(let c=0;c<channels;c++)for(let i=0;i<buffer.length;i++)buffer.getChannelData(c)[i]=.1*Math.sin(2*Math.PI*(173+c*71)*i/context.sampleRate);return buffer;});
    function switchSource(index){if(playing){playing.stop();playing.disconnect();}playing=context.createBufferSource();playing.buffer=buffers[index];playing.loop=true;playing.connect(entry);playing.start();sources.push(playing);}
    const resultPromise=new Promise((resolve,reject)=>{
     const timeout=setTimeout(()=>reject(new Error('Real AudioContext did not finish its requested duration')),(seconds+12)*1000);
     observer.port.onmessage=event=>{last=event.data;
      const renderedSeconds=last.frames/context.sampleRate;
      if(changes<Math.ceil(seconds/2)-1 && renderedSeconds>=(changes+1)*2){changes++;switchSource(changes%formats.length);if(!sampleReference)engine.update({...settings,eq:settings.eq.map(value=>changes%2?-value:value),ambience:changes%2?20:100});}
      if(renderedSeconds>=seconds){clearTimeout(timeout);resolve(last);}
     };
    });
    try{
     switchSource(0);await context.resume();const firstTimestamp=context.getOutputTimestamp();const started=performance.now();
     const telemetry=await resultPromise;
     const finalTimestamp=context.getOutputTimestamp();
     const playbackStats=context.playbackStats?.toJSON?.()||null;
     return {control,sampleReference,requestedRate:sampleRate,sampleRate:context.sampleRate,state:context.state,wallSeconds:(performance.now()-started)/1000,
      baseLatency:context.baseLatency,outputLatency:context.outputLatency,firstTimestamp,finalTimestamp,playbackStats,changes,...telemetry};
    }finally{if(playing){playing.stop();playing.disconnect();}await context.close();}
   },{sampleRate,control:process.argv.includes('--control'),seconds,sampleReference:process.argv.includes('--sample-reference')});
   console.log(JSON.stringify(result));fs.writeFileSync(path.join(__dirname,`artifacts/fxsound-realtime-${Date.now()}-${result.requestedRate}.json`),JSON.stringify(result,null,2));fs.writeFileSync(path.join(__dirname,'artifacts/fxsound-realtime-latest.json'),JSON.stringify(result,null,2));
   assert.equal(result.state,'running');assert.equal(result.nonfinite,0);assert.equal(result.markerDiscontinuities,0);assert.ok(result.markerSamples>=result.sampleRate*seconds);if(result.sampleReference){assert.ok(result.comparedSamples>0);assert.ok(result.sampleError<2e-6,JSON.stringify(result));}else assert.equal(result.discontinuities,0);
   assert.equal(result.changes,Math.ceil(seconds/2)-1);assert.ok(result.peak>0);assert.ok(result.frames>=result.sampleRate*seconds);
   assert.ok(result.finalTimestamp.contextTime>result.firstTimestamp.contextTime+seconds-1);
   for(const count of [2,8,1,6])assert.ok(result.channels.includes(count),JSON.stringify(result));
   results.push(result);
  }
  fs.writeFileSync(path.join(__dirname,process.argv.includes('--control')?'artifacts/fxsound-realtime-control.json':'artifacts/fxsound-realtime.json'),JSON.stringify(results,null,2));
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
