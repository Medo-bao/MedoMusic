const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const app = await _electron.launch({
    executablePath: path.join(root, process.argv.includes('--packaged')?'release/win-unpacked/MedoMusic.exe':'.electron-dist/electron.exe'),
    args: [...(process.argv.includes('--packaged')?[]:[root]), `--user-data-dir=${path.join(__dirname, 'artifacts/fx-worklet-profile')}`]
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.MedoSound);
    const results = await page.evaluate(async () => {
      const checks = [];
      {
        // Verify Chromium's live channel negotiation, not a fixed-output node.
        const rate=48000,frames=49152,context=new OfflineAudioContext(8,frames,rate);
        context.destination.channelInterpretation='discrete';await MedoSound.prepare(context);
        const counts=[2,6,8,4,1,8],entry=context.createGain();entry.channelInterpretation='discrete';
        const buffers=counts.map(channels=>{const b=context.createBuffer(channels,frames,rate);
          for(let c=0;c<channels;c++)for(let i=0;i<frames;i++)b.getChannelData(c)[i]=.04*Math.sin(i*(.031+c*.027));return b;});
        let playing=context.createBufferSource();playing.buffer=buffers[0];playing.connect(entry);playing.start();
        const gains=[2,-1,3,-2,1,-1,2,-2,1,-1];
        MedoSound.create(context,entry,context.destination).update({enabled:true,clarity:2,bass:3,ambience:50,surround:50,dynamics:50,eq:gains});
        const events=[{frame:0,index:0}];
        const pendingSwitches=counts.slice(1).map((_,i)=>context.suspend((i+1)*8192/rate).then(()=>{
          const index=i+1;playing.disconnect(entry);playing.stop();playing=context.createBufferSource();playing.buffer=buffers[index];playing.connect(entry);
          playing.start(context.currentTime,context.currentTime);events.push({frame:Math.round(context.currentTime*rate),index});return context.resume();
        }));
        const pending=context.startRendering();await Promise.all(pendingSwitches);const rendered=await pending;
        const reference=new FxSoundCore.Chain(rate);
        MedoSound.frequencies.forEach((hz,i)=>reference.eq.setBand(i,hz,gains[i]));
        const settings={bypass:0,clarityOn:1,surroundOn:1,bassOn:1,bass:64,ambience:64,
          clarity:FxSoundCore.clarityDrive(64),surround:FxSoundCore.surroundIntensity(64),dynamics:FxSoundCore.dynamicsGain(FxSoundCore.dynamicMidi(64))};
        let event=0,error=0;
        for(let start=0;start<frames;start+=128){
          if(event+1<events.length && start===events[event+1].frame)event++;
          const index=events[event].index,channels=counts[index];
          const input=Array.from({length:channels},(_,c)=>buffers[index].getChannelData(c).subarray(start,start+128));
          const output=Array.from({length:channels},()=>new Float32Array(128));reference.process(input,output,settings);
          for(let c=0;c<8;c++)for(let i=0;i<128;i++)error=Math.max(error,Math.abs(rendered.getChannelData(c)[start+i]-(output[c]?.[i]||0)));
        }
        checks.push({multichannelSwitchError:error});
      }

      for(const channels of [4,6,8])for(const rate of [48000,96000])for(const equalize of [false,true]){
        const frames=32768,context=new OfflineAudioContext(channels,frames,rate);await MedoSound.prepare(context);
        const input=context.createBuffer(channels,frames,rate),source=context.createBufferSource();
        for(let c=0;c<channels;c++)for(let i=0;i<frames;i++)
          if(i<8192 || i>=16384)input.getChannelData(c)[i]=.08*Math.sin(i*(.017+c*.041));
        source.buffer=input;const gains=equalize?[2,2,1.5,1,0,0,0,0,.5,1]:Array(10).fill(0);
        MedoSound.create(context,source,context.destination).update({enabled:true,clarity:2,bass:3,ambience:50,surround:50,dynamics:50,eq:gains});
        source.start();const rendered=await context.startRendering(),ratio=FxSoundCore.internalRateRatio(rate),internal=rate/ratio;
        const eq=new FxSoundCore.Equalizer(rate),data=Array.from({length:channels},()=>new Float32Array(frames));
        MedoSound.frequencies.forEach((hz,i)=>eq.setBand(i,hz,gains[i]));
        for(let c=0;c<channels;c++)for(let i=0;i<frames;i++)data[c][i]=channels===4?input.getChannelData(c)[i]:eq.processSample(input.getChannelData(c)[i],c,channels);
        const layout=channels===4?[[0,2,true,true,true],[2,2,true,true,false]]:
          [[0,2,true,true,true],[2,1,true,false,false],[3,1,false,false,true],[4,2,true,true,false],...(channels===8?[[6,2,true,true,false]]:[])];
        let error=0;
        for(const [offset,count,bright,wide,low] of layout){
          const clarity=new FxSoundCore.Clarity(internal),bass=new FxSoundCore.Bass(internal),max=new FxSoundCore.Maximizer(internal);
          const room=new FxSoundCore.Reverb(internal,FxSoundCore.reverbParameters(internal,FxSoundCore.ambienceMidi(64))),pair=new Float32Array(2),mono=count===1;
          for(let start=0;start<frames;start+=128){
            let active=offset===0;
            for(let c=offset;c<offset+count;c++)if(data[c].subarray(start,start+128).some(value=>value!==0))active=true;
            for(let i=start;i<start+128;i++){
              if(active && i%ratio===0){
                pair[0]=data[offset][i];pair[1]=mono?pair[0]:data[offset+1][i];
                if(bright){for(let c=0;c<count;c++)pair[c]=clarity.processSample(pair[c],c,FxSoundCore.clarityDrive(64));room.processStereo(pair[0],mono?pair[0]:pair[1],pair,mono);}
                if(wide)FxSoundCore.widenStereo(pair[0],pair[1],FxSoundCore.surroundIntensity(64),pair);
                if(low)for(let c=0;c<count;c++)pair[c]=bass.processSample(pair[c],c,64);
                max.processStereo(pair[0],pair[1],FxSoundCore.dynamicsGain(FxSoundCore.dynamicMidi(64)),pair,mono);
              }
              for(let c=0;c<count;c++)error=Math.max(error,Math.abs(rendered.getChannelData(offset+c)[i]-(active?pair[c]:data[offset+c][i])));
            }
          }
        }
        checks.push({channels,rate,equalize,surroundChainError:error});
      }

      {
        const rate=48000,context=new OfflineAudioContext(2,rate,rate);await MedoSound.prepare(context);
        const entry=context.createGain(),buffers=[1,2].map(channels=>context.createBuffer(channels,rate,rate));
        buffers.forEach(buffer=>{for(let ch=0;ch<buffer.numberOfChannels;ch++)for(let i=0;i<rate;i++)buffer.getChannelData(ch)[i]=.08*Math.sin(i*(.11+ch*.13));});
        let playing=context.createBufferSource();playing.buffer=buffers[0];playing.connect(entry);playing.start();
        MedoSound.create(context,entry,context.destination).update({enabled:true,ambience:100});
        const events=[{frame:0,index:0}];
        const switches=[[.25,1],[.75,0]].map(([time,index])=>context.suspend(time).then(()=>{
          playing.disconnect(entry);playing.stop();playing=context.createBufferSource();playing.buffer=buffers[index];playing.connect(entry);
          playing.start(context.currentTime,context.currentTime);events.push({frame:Math.round(context.currentTime*rate),index});return context.resume();
        }));
        const pending=context.startRendering();await Promise.all(switches);const rendered=await pending;
        const params=FxSoundCore.reverbParameters(rate,FxSoundCore.ambienceMidi(127)),pair=new Float32Array(2);
        let room=new FxSoundCore.Reverb(rate,params),maximizer=new FxSoundCore.Maximizer(rate),event=0,error=0,firstMismatch=null;
        for(let i=0;i<rate;i++){
          if(event+1<events.length&&i===events[event+1].frame){event++;room=new FxSoundCore.Reverb(rate,params);maximizer=new FxSoundCore.Maximizer(rate);}
          const index=events[event].index,mono=index===0,input=buffers[index];
          room.processStereo(input.getChannelData(0)[i],input.getChannelData(mono?0:1)[i],pair,mono);
          maximizer.processStereo(pair[0],pair[1],1,pair,mono);
          for(let ch=0;ch<2;ch++){const difference=Math.abs(rendered.getChannelData(ch)[i]-pair[mono?0:ch]);if(difference>2e-6&&!firstMismatch)firstMismatch={frame:i,ch,actual:rendered.getChannelData(ch)[i],expected:pair[mono?0:ch]};error=Math.max(error,difference);}
        }
        checks.push({channelSwitchError:error,firstMismatch});
      }
      for(const rate of [44100,48000,96000,192000]){
        const ratio=FxSoundCore.internalRateRatio(rate),internal=rate/ratio,frames=Math.ceil(rate/128)*128;
        const context=new OfflineAudioContext(2,frames,rate);await MedoSound.prepare(context);
        const input=context.createBuffer(1,frames,rate),source=context.createBufferSource();
        for(let i=0;i<frames/2;i++)input.getChannelData(0)[i]=.07*Math.sin(i*.19)+.02*Math.sin(i*.013);
        source.buffer=input;const settings={enabled:true,clarity:2,bass:3,ambience:50,surround:50,dynamics:50,eq:[2,2,1.5,1,0,0,0,0,.5,1]};
        MedoSound.create(context,source,context.destination).update(settings);source.start();const rendered=await context.startRendering();
        const eq=new FxSoundCore.Equalizer(rate),clarity=new FxSoundCore.Clarity(internal),bass=new FxSoundCore.Bass(internal),maximizer=new FxSoundCore.Maximizer(internal);
        MedoSound.frequencies.forEach((frequency,i)=>eq.setBand(i,frequency,settings.eq[i]));
        const midi=FxSoundCore.normalizedToMidi(.5),room=new FxSoundCore.Reverb(internal,FxSoundCore.reverbParameters(internal,FxSoundCore.ambienceMidi(midi))),pair=new Float32Array(2);
        let error=0,last=0;
        for(let i=0;i<frames;i++){
          const equalized=eq.processSample(input.getChannelData(0)[i],0);
          if(i%ratio===0){
            const clear=clarity.processSample(equalized,0,FxSoundCore.clarityDrive(midi));
            room.processStereo(clear,clear,pair,true);
            FxSoundCore.widenStereo(pair[0],pair[0],FxSoundCore.surroundIntensity(midi),pair);
            const widened=Math.fround(Math.fround(pair[0]*.5)+Math.fround(pair[1]*.5));
            maximizer.processStereo(bass.processSample(widened,0,midi),0,FxSoundCore.dynamicsGain(FxSoundCore.dynamicMidi(midi)),pair,true);last=pair[0];
          }
          for(let ch=0;ch<2;ch++)error=Math.max(error,Math.abs(rendered.getChannelData(ch)[i]-last));
        }
        checks.push({rate,monoError:error});
      }
      {
        const rate=48000,context=new OfflineAudioContext(2,rate,rate);await MedoSound.prepare(context);
        const input=context.createBuffer(2,rate,rate),source=context.createBufferSource();
        for(let i=0;i<rate;i++)for(let ch=0;ch<2;ch++)input.getChannelData(ch)[i]=.05*Math.sin(i*(.017+ch*.23));
        source.buffer=input;const engine=MedoSound.create(context,source,context.destination);
        const setting=percent=>({enabled:true,clarity:percent/25,bass:percent*.06,surround:percent});
        engine.update(setting(100));source.start();const events=[{frame:0,percent:100}];
        const switches=[[.25,.1],[.5,0],[.75,100]].map(([time,percent])=>context.suspend(time).then(()=>{
          events.push({frame:Math.round(context.currentTime*rate),percent});engine.update(setting(percent));return context.resume();
        }));
        const pending=context.startRendering();await Promise.all(switches);const rendered=await pending;
        const clarity=new FxSoundCore.Clarity(rate),bass=new FxSoundCore.Bass(rate),maximizer=new FxSoundCore.Maximizer(rate),pair=new Float32Array(2);
        let event=0,error=0;
        for(let i=0;i<rate;i++){
          if(event+1<events.length&&i===events[event+1].frame)event++;
          const percent=events[event].percent,midi=FxSoundCore.normalizedToMidi(percent/100);
          pair[0]=input.getChannelData(0)[i];pair[1]=input.getChannelData(1)[i];
          if(percent>0){
            pair[0]=clarity.processSample(pair[0],0,FxSoundCore.clarityDrive(midi));pair[1]=clarity.processSample(pair[1],1,FxSoundCore.clarityDrive(midi));
            FxSoundCore.widenStereo(pair[0],pair[1],FxSoundCore.surroundIntensity(midi),pair);
          }
          maximizer.processStereo(bass.processSample(pair[0],0,midi,percent>0),bass.processSample(pair[1],1,midi,percent>0),1,pair);
          for(let ch=0;ch<2;ch++)error=Math.max(error,Math.abs(rendered.getChannelData(ch)[i]-pair[ch]));
        }
        checks.push({fractionalControlError:error});
      }
      for(const percent of [1,10,20,50,100]) {
        const rate=48000,frames=24000,context=new OfflineAudioContext(2,frames,rate);await MedoSound.prepare(context);
        const source=context.createBufferSource(),input=context.createBuffer(2,frames,rate);
        for(let i=0;i<frames;i++){
          input.getChannelData(0)[i]=.08*Math.sin(i*.21)+.03*Math.sin(i*.011);
          input.getChannelData(1)[i]=.07*Math.sin(i*.29);
        }
        source.buffer=input;
        MedoSound.create(context,source,context.destination).update({enabled:true,clarity:percent/25,bass:percent*.06,ambience:percent,surround:percent,dynamics:percent},false,true);
        source.start();const rendered=await context.startRendering();
        const midi=FxSoundCore.normalizedToMidi(percent/100),clarity=new FxSoundCore.Clarity(rate),bass=new FxSoundCore.Bass(rate),maximizer=new FxSoundCore.Maximizer(rate);
        const room=new FxSoundCore.Reverb(rate,FxSoundCore.reverbParameters(rate,FxSoundCore.ambienceMidi(midi))),pair=new Float32Array(2);
        const drive=FxSoundCore.clarityDrive(midi),wide=FxSoundCore.surroundIntensity(midi),boost=FxSoundCore.dynamicsGain(FxSoundCore.dynamicMidi(midi));
        let error=0;
        for(let i=0;i<frames;i++){
          pair[0]=clarity.processSample(input.getChannelData(0)[i],0,drive);pair[1]=clarity.processSample(input.getChannelData(1)[i],1,drive);
          if(midi>12)room.processStereo(pair[0],pair[1],pair);
          FxSoundCore.widenStereo(pair[0],pair[1],wide,pair);
          maximizer.processStereo(bass.processSample(pair[0],0,midi),bass.processSample(pair[1],1,midi),boost,pair);
          for(let channel=0;channel<2;channel++)error=Math.max(error,Math.abs(rendered.getChannelData(channel)[i]-pair[channel]));
        }
        checks.push({percent,controlsError:error});
      }
      for(const rate of [32000,44100,48000,88200,96000,192000]) {
        const ratio=FxSoundCore.internalRateRatio(rate),internal=rate/ratio;
        const context=new OfflineAudioContext(2,rate,rate);await MedoSound.prepare(context);
        const source=context.createBufferSource(),input=context.createBuffer(2,rate,rate);
        const centers=[31,63,109,267,354,1000,2000,4000,8600,16000],gains=[2,-2,1.5,-1,0,0,6,-6,.5,12];
        for(let i=0;i<rate;i++) {
          input.getChannelData(0)[i]=.03*Math.sin(i*.17)+.02*Math.sin(i*.021);
          input.getChannelData(1)[i]=.02*Math.sin(i*.73);
        }
        source.buffer=input;MedoSound.create(context,source,context.destination).update({enabled:true,centers,eq:gains},false,true);
        source.start();const rendered=await context.startRendering();
        const eq=new FxSoundCore.Equalizer(rate),maximizer=new FxSoundCore.Maximizer(internal),pair=new Float32Array(2);
        centers.forEach((frequency,i)=>eq.setBand(i,frequency,gains[i]));let error=0;
        for(let i=0;i<rate;i++) {
          const left=eq.processSample(input.getChannelData(0)[i],0),right=eq.processSample(input.getChannelData(1)[i],1);
          if(i%ratio===0)maximizer.processStereo(left,right,1,pair);
          for(let channel=0;channel<2;channel++)error=Math.max(error,Math.abs(rendered.getChannelData(channel)[i]-pair[channel]));
        }
        checks.push({rate,eqError:error});
      }
      for (const rate of [44100,48000,96000,192000]) {
        const ratio=FxSoundCore.internalRateRatio(rate),internal=rate/ratio;
        const context=new OfflineAudioContext(2,rate,rate);await MedoSound.prepare(context);
        const source=context.createBufferSource(),input=context.createBuffer(2,rate,rate);
        for(let i=0;i<rate;i++) {
          input.getChannelData(0)[i]=.06*Math.sin(2*Math.PI*90*i/rate);
          input.getChannelData(1)[i]=.04*Math.sin(2*Math.PI*397*i/rate);
        }
        source.buffer=input;
        MedoSound.create(context,source,context.destination).update({enabled:true,bass:6},false,true);
        source.start();const rendered=await context.startRendering();
        const bass=new FxSoundCore.Bass(internal),maximizer=new FxSoundCore.Maximizer(internal),pair=new Float32Array(2);
        let error=0;
        for(let i=0;i<rate;i++) {
          if(i%ratio===0)maximizer.processStereo(bass.processSample(input.getChannelData(0)[i],0,127),bass.processSample(input.getChannelData(1)[i],1,127),1,pair);
          for(let channel=0;channel<2;channel++) error=Math.max(error,Math.abs(rendered.getChannelData(channel)[i]-pair[channel]));
        }
        checks.push({rate,bassError:error});
      }
      for (const rate of [44100,48000,96000,192000]) {
        const ratio=FxSoundCore.internalRateRatio(rate),internal=rate/ratio;
        const frames=rate*3, context=new OfflineAudioContext(2,frames,rate);
        await MedoSound.prepare(context);
        const source=context.createBufferSource(), input=context.createBuffer(2,frames,rate);
        for(let i=0;i<rate/2;i++) {
          input.getChannelData(0)[i]=.1*Math.sin(i*.29);
          input.getChannelData(1)[i]=.08*Math.sin(i*.73);
        }
        input.getChannelData(0)[0]=.5;source.buffer=input;
        const node=new AudioWorkletNode(context,'fxsound-stage',{
          numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{kind:'reverb'}
        });
        // Include native bypass threshold, live decay changes, and frozen tail resume.
        const events=[[0,127],[Math.ceil(rate/128)*128,12],[Math.ceil(rate*1.5/128)*128,40],[Math.ceil(rate*2/128)*128,13]];
        // Place events half a sample before the intended k-rate boundary, avoiding
        // floating time rounding into the following 128-frame quantum.
        for(const [frame,midi] of events) node.parameters.get('ambience').setValueAtTime(midi,Math.max(0,frame-.5)/rate);
        source.connect(node).connect(context.destination);source.start();
        const rendered=await context.startRendering(), reference=new FxSoundCore.Reverb(internal,FxSoundCore.reverbParameters(internal,FxSoundCore.ambienceMidi(127))),pair=new Float32Array(2);
        let error=0,event=0,firstMismatch=null;
        for(let i=0;i<frames;i++) {
          if(event+1<events.length && i>=events[event+1][0]) {
            event++;reference.parameters=FxSoundCore.reverbParameters(internal,FxSoundCore.ambienceMidi(events[event][1]));
          }
          const left=input.getChannelData(0)[i],right=input.getChannelData(1)[i];
          if(i%ratio===0){
            if(events[event][1]<=12) { pair[0]=left;pair[1]=right; }
            else reference.processStereo(left,right,pair);
          }
          for(let channel=0;channel<2;channel++) {
            const difference=Math.abs(rendered.getChannelData(channel)[i]-pair[channel]);
            if(difference>2e-6 && !firstMismatch) firstMismatch={frame:i,channel,actual:rendered.getChannelData(channel)[i],expected:pair[channel],event};
            error=Math.max(error,difference);
          }
        }
        checks.push({rate,reverbError:error,firstMismatch});
      }
      for (const rate of [44100,48000,96000,192000]) {
        const ratio=FxSoundCore.internalRateRatio(rate),internal=rate/ratio;
        const context = new OfflineAudioContext(2,8192,rate);
        await MedoSound.prepare(context);
        const source = context.createBufferSource();
        const input = context.createBuffer(2,8192,rate);
        for (let channel=0;channel<2;channel++) {
          const data=input.getChannelData(channel);
          for (let i=0;i<data.length;i++) data[i]=.4*Math.sin(i*.29+channel)+.1*Math.sin(i*.73);
        }
        source.buffer=input;
        MedoSound.create(context,source,context.destination).update({enabled:true,clarity:2},false,true);
        source.start();
        const rendered=await context.startRendering(), reference=new FxSoundCore.Clarity(internal), limiter=new FxSoundCore.Maximizer(internal), pair=new Float32Array(2);
        const drive=FxSoundCore.clarityDrive(FxSoundCore.normalizedToMidi(2/4));
        let error=0;
        for(let i=0;i<8192;i++) {
          if(i%ratio===0)limiter.processStereo(reference.processSample(input.getChannelData(0)[i],0,drive),reference.processSample(input.getChannelData(1)[i],1,drive),1,pair);
          for(let channel=0;channel<2;channel++) error=Math.max(error,Math.abs(rendered.getChannelData(channel)[i]-pair[channel]));
        }
        checks.push({rate,workletError:error});
      }
      for(const rate of [44100,48000,96000,192000]) {
        const ratio=FxSoundCore.internalRateRatio(rate),internal=rate/ratio;
        const context=new OfflineAudioContext(2,rate,rate);await MedoSound.prepare(context);
        const input=context.createBuffer(2,rate,rate),source=context.createBufferSource();
        for(let i=0;i<rate;i++)for(let ch=0;ch<2;ch++)input.getChannelData(ch)[i]=.1*Math.sin(2*Math.PI*(125+ch*251)*i/rate);
        source.buffer=input;
        const settings={enabled:false,clarity:2,bass:3,ambience:50,surround:50,dynamics:50,eq:[6,0,0,0,0,0,0,0,0,0]};
        const engine=MedoSound.create(context,source,context.destination);engine.update(settings,false,true);source.start();
        const events=[];
        const switches=[[.25,true,false],[.5,true,true],[.75,true,false]].map(([time,enabled,compare])=>context.suspend(time).then(()=>{
          events.push({frame:Math.round(context.currentTime*rate),active:enabled&&!compare});
          engine.update({...settings,enabled},compare);return context.resume();
        }));
        const pending=context.startRendering();await Promise.all(switches);const rendered=await pending;
        const eq=new FxSoundCore.Equalizer(rate);MedoSound.frequencies.forEach((frequency,i)=>eq.setBand(i,frequency,settings.eq[i]));
        const clarity=new FxSoundCore.Clarity(internal),bass=new FxSoundCore.Bass(internal),limiter=new FxSoundCore.Maximizer(internal);
        const midi=FxSoundCore.normalizedToMidi(.5),room=new FxSoundCore.Reverb(internal,FxSoundCore.reverbParameters(internal,FxSoundCore.ambienceMidi(midi)));
        const drive=FxSoundCore.clarityDrive(midi),wide=FxSoundCore.surroundIntensity(midi),boost=FxSoundCore.dynamicsGain(FxSoundCore.dynamicMidi(midi)),pair=new Float32Array(2);
        let error=0,active=false,event=0;
        for(let i=0;i<rate;i++){
          if(event<events.length&&i===events[event].frame){active=events[event].active;event++;}
          const left=input.getChannelData(0)[i],right=input.getChannelData(1)[i];
          if(active){
            const eqLeft=eq.processSample(left,0),eqRight=eq.processSample(right,1);
            if(i%ratio===0){
              pair[0]=clarity.processSample(eqLeft,0,drive);pair[1]=clarity.processSample(eqRight,1,drive);
              room.processStereo(pair[0],pair[1],pair);FxSoundCore.widenStereo(pair[0],pair[1],wide,pair);
              limiter.processStereo(bass.processSample(pair[0],0,midi),bass.processSample(pair[1],1,midi),boost,pair);
            }
          }else{pair[0]=left;pair[1]=right;}
          for(let ch=0;ch<2;ch++)error=Math.max(error,Math.abs(rendered.getChannelData(ch)[i]-pair[ch]));
        }
        checks.push({rate,switchError:error});
      }
      return checks;
    });
    for(const result of results) {
      if ('multichannelSwitchError' in result) assert.ok(result.multichannelSwitchError<2e-6,JSON.stringify(result));
      if ('surroundChainError' in result) assert.ok(result.surroundChainError<2e-6,JSON.stringify(result));
      if ('workletError' in result) assert.ok(result.workletError<2e-5,JSON.stringify(result));
      if ('reverbError' in result) assert.ok(result.reverbError<2e-6,JSON.stringify(result));
      if ('bassError' in result) assert.ok(result.bassError<2e-6,JSON.stringify(result));
      if ('eqError' in result) assert.ok(result.eqError<2e-6,JSON.stringify(result));
      if ('controlsError' in result) assert.ok(result.controlsError<2e-6,JSON.stringify(result));
      if ('fractionalControlError' in result) assert.ok(result.fractionalControlError<2e-6,JSON.stringify(result));
      if ('monoError' in result) assert.ok(result.monoError<2e-6,JSON.stringify(result));
      if ('channelSwitchError' in result) assert.ok(result.channelSwitchError<2e-6,JSON.stringify(result));
      if ('switchError' in result) assert.ok(result.switchError<2e-6,JSON.stringify(result));
    }
    console.log('Electron worklet and native bypass/history checks passed: '+JSON.stringify(results));
  } finally { await app.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
