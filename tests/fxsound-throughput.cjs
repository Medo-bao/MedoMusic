// Diagnostic throughput for the exact app kernel; not a device drop-out test.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const core=require('../src/fxsound-core.js');
const settings={bypass:0,clarityOn:1,surroundOn:1,bassOn:1,bass:127,ambience:127,
 clarity:core.clarityDrive(127),surround:core.surroundIntensity(127),dynamics:core.dynamicsGain(core.dynamicMidi(127))};
const results=[];
for(const channels of [2,8])for(const rate of [48000,96000,192000]){
 const chain=new core.Chain(rate),frequencies=[31,62,125,250,500,1000,2000,4000,8000,16000];
 frequencies.forEach((hz,i)=>chain.eq.setBand(i,hz,i%2?-12:12));
 const input=Array.from({length:channels},(_,c)=>Float32Array.from({length:128},(_,i)=>.1*Math.sin(i*(.07+c*.03))));
 const output=Array.from({length:channels},()=>new Float32Array(128));
 for(let i=0;i<1000;i++)chain.process(input,output,settings);
 const blocks=Math.ceil(rate*10/128),durations=new Float64Array(blocks),begin=performance.now();
 for(let i=0;i<blocks;i++){const start=performance.now();chain.process(input,output,settings);durations[i]=performance.now()-start;}
 const elapsed=performance.now()-begin;durations.sort();
 assert.ok(output.every(channel=>channel.every(Number.isFinite)));
 results.push({channels,rate,audioSeconds:blocks*128/rate,computeSeconds:elapsed/1000,
  realtimeFraction:elapsed/(blocks*128/rate*1000),blockBudgetMs:128/rate*1000,
  blockP99Ms:durations[Math.floor(blocks*.99)],blockMaxMs:durations[blocks-1]});
}
const report={runtime:process.version,platform:process.platform,results};
fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'artifacts/fxsound-throughput.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
