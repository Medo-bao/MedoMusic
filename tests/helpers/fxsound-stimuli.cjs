// Deterministic generated music (bass/chords/melody/percussion), not a recording.
// Every shipped preset is read from the production preset registry.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),core=require('../../src/fxsound-core.js');
require('../../src/sound-enhancement.js');
module.exports=function runStimuli(directory){
 const reports=[];
 for(const rate of [44100,48000,96000,192000])for(const signal of ['sweep','generated-music']){
  const frames=Math.ceil(rate*4/128)*128,input=new Float32Array(frames*2);let seed=983;
  for(let i=0;i<frames;i++){
   const t=i/rate;if(t>=3)continue;
   if(signal==='sweep'){
    const end=Math.min(20000,rate*.45),k=Math.log(end/20)/3,phase=2*Math.PI*20*(Math.exp(k*t)-1)/k;
    input[i*2]=Math.sin(phase)*(.05+.6*t/3);input[i*2+1]=Math.sin(phase+.7)*(.65-.6*t/3);
   }else{
    const beat=t%.5,bar=Math.floor(t/1.5)%2,notes=bar?[110,130.8128,164.8138]:[98,123.4708,146.8324];
    const kick=.35*Math.sin(2*Math.PI*(48*beat+5*(1-Math.exp(-30*beat))))*Math.exp(-24*beat);
    const bass=.2*Math.sin(2*Math.PI*notes[0]*t)*Math.exp(-4*beat);
    const melody=.1*Math.sin(2*Math.PI*notes[Math.floor(t*4)%3]*4*t)*Math.exp(-8*(t%.25));
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const hat=(seed/4294967296-.5)*.1*Math.exp(-70*(t%.125));
    for(let c=0;c<2;c++){
     const chord=notes.reduce((sum,hz)=>sum+.045*Math.sin(2*Math.PI*hz*2*t+c*.4),0);
     input[i*2+c]=(kick+bass+chord+melody+hat)*(.15+.85*Math.min(1,t));
    }
   }
  }
  fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(input.buffer));
  const internal=rate/core.internalRateRatio(rate),table=Float32Array.from(Array.from({length:128},(_,midi)=>[core.clarityDrive(midi),core.surroundIntensity(midi),core.dynamicsGain(core.dynamicMidi(midi)),...Object.values(core.reverbParameters(internal,core.ambienceMidi(midi)))]).flat());
  for(const [preset,values] of Object.entries(globalThis.MedoSound.presets)){
   const state=globalThis.MedoSound.normalize({...values,preset,enabled:true});
   const controls=[state.clarity/4,state.ambience/100,state.surround/100,state.bass/6,state.dynamics/100].map(core.normalizedToMidi);
   const eq=[...state.centers,...state.eq];
   fs.writeFileSync(path.join(directory,'parameters.f32'),Buffer.concat([Buffer.from(table.buffer),Buffer.from(new Float32Array([...eq,...eq,...eq,...eq,...controls]).buffer)]));
   execFileSync(path.join(directory,'oracle.exe'),['input.f32','output.f32',String(rate),'2','parameters.f32','fixture'],{cwd:directory});
   const bytes=fs.readFileSync(path.join(directory,'output.f32')),expected=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
   const chain=new core.Chain(rate);state.centers.forEach((hz,i)=>chain.eq.setBand(i,hz,state.eq[i]));
   const [clarity,ambience,surround,bass,dynamics]=controls;
   const settings={bypass:0,clarityOn:state.clarity>0,surroundOn:state.surround>0,bassOn:state.bass>0,bass,ambience,clarity:core.clarityDrive(clarity),surround:core.surroundIntensity(surround),dynamics:core.dynamicsGain(core.dynamicMidi(dynamics))};
   const block=[new Float32Array(128),new Float32Array(128)],output=[new Float32Array(128),new Float32Array(128)];let error=0;
   for(let start=0;start<frames;start+=128){
    for(let c=0;c<2;c++)for(let i=0;i<128;i++)block[c][i]=input[(start+i)*2+c];chain.process(block,output,settings);
    for(let c=0;c<2;c++)for(let i=0;i<128;i++)error=Math.max(error,Math.abs(output[c][i]-expected[(start+i)*2+c]));
   }
   assert.ok(error<2e-6,JSON.stringify({preset,signal,rate,error}));reports.push({preset,signal,rate,error});
  }
 }
 console.log(`Native preset/sweep/generated-music: ${reports.length} cases passed, max error ${Math.max(...reports.map(r=>r.error))}`);
 return reports;
};
