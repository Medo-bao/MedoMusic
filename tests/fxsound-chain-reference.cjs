// Serial original-C kernel oracle. This does not yet compile the original host
// dispatcher: its scope is accumulated numerical error across the effect chain.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const core=require('../src/fxsound-core.js');
const artifacts=path.join(__dirname,'artifacts'),directory=path.join(artifacts,'fxsound-chain');
fs.mkdirSync(directory,{recursive:true});
for(const name of ['native','reverb','bass','maximizer','eq'])
 execFileSync(process.execPath,[path.join(__dirname,`fxsound-${name}-reference.cjs`)],{stdio:'inherit'});
const native=fs.readFileSync(path.join(artifacts,'fxsound-reference/oracle.cpp'),'utf8');
// Separate the existing original Aural/Wide loops at their buffer boundary.
const wideStart=native.indexOf('float mono_signal,l_minus_mono,r_minus_mono;'),wideEnd=native.indexOf('pair[0]=out1; pair[1]=out2;',wideStart);
assert.ok(wideStart>0&&wideEnd>wideStart);
const clarity=native.slice(0,wideStart)+'out1=in1;out2=in2;'+native.slice(wideEnd);
const a=native.indexOf('filtH1 = s->out1_minus1'),b=native.indexOf('float mono_signal,l_minus_mono,r_minus_mono;',a);
assert.ok(a>0&&b>a);
const wide=(native.slice(0,a)+native.slice(b)).replace('in2=pair[1],out1=0','in2=s->stereo_in_flag?pair[1]:pair[0],out1=0');
const eq=fs.readFileSync(path.join(artifacts,'fxsound-eq/oracle.cpp'),'utf8').replaceAll('if(frame<(int)(rate*.5)||frame>=(int)(rate*.75))','if(true)');
fs.writeFileSync(path.join(directory,'clarity.cpp'),clarity);fs.writeFileSync(path.join(directory,'wide.cpp'),wide);fs.writeFileSync(path.join(directory,'eq.cpp'),eq);
const installation=execFileSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();
fs.writeFileSync(path.join(directory,'build.cmd'),`@echo off\r\ncall "${installation}\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od clarity.cpp /Fe:clarity.exe\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od wide.cpp /Fe:wide.exe\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od eq.cpp /Fe:eq.exe\r\n`);
try{execFileSync('cmd.exe',['/d','/c','build.cmd'],{cwd:directory,stdio:'pipe'});}catch(e){console.error(e.stdout?.toString());throw e;}
function run(executable,input,header,args){
 fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(input.buffer,input.byteOffset,input.byteLength));
 execFileSync(executable,['input.f32','output.f32',...args.map(String)],{cwd:directory});
 const bytes=fs.readFileSync(path.join(directory,'output.f32')).subarray(header*4);
 return new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
}
let worst=0;const reports=[];
for(const rate of [44100,48000,96000,192000])for(const midi of [13,64,127])for(const mono of [false,true]){
 const ratio=core.internalRateRatio(rate),internal=rate/ratio,frames=Math.ceil(rate/128)*128;
 const input=new Float32Array(frames*2);let seed=853;
 for(let i=0;i<frames;i++)if(i<frames*.6){seed=(Math.imul(seed,1664525)+1013904223)>>>0;input[i*2]=.3*Math.sin(i*.039);input[i*2+1]=.2*(seed/4294967296-.5);}
 input[0]=1.5;
 const centers=[31,62,125,250,500,1000,2000,4000,8000,16000],gains=[2,-1,3,-2,1,-1,2,-2,1,-1];
 const parameters=path.join(directory,'eq.f32');fs.writeFileSync(parameters,Buffer.from(new Float32Array([...centers,...gains]).buffer));
 let samples=run(path.join(directory,'eq.exe'),input,40,[rate,parameters,2]);
 const reduced=new Float32Array(frames*2/ratio);
 for(let i=0;i<frames/ratio;i++){reduced[i*2]=samples[i*ratio*2];reduced[i*2+1]=samples[i*ratio*2+1];}
 samples=run(path.join(directory,'clarity.exe'),reduced,3,[internal,core.clarityDrive(midi),0,mono?1:0]);
 const room=path.join(directory,'room.f32');fs.writeFileSync(room,Buffer.from(new Float32Array(Object.values(core.reverbParameters(internal,core.ambienceMidi(midi)))).buffer));
 samples=run(path.join(artifacts,'fxsound-reverb/oracle.exe'),samples,1153,[internal,room,mono?1:0]);
 samples=run(path.join(directory,'wide.exe'),samples,3,[internal,0,core.surroundIntensity(midi),mono?1:0]);
 samples=run(path.join(artifacts,'fxsound-bass/oracle.exe'),samples,512,[internal,midi]);
 samples=run(path.join(artifacts,'fxsound-maximizer/oracle.exe'),samples,132,[internal,core.dynamicsGain(core.dynamicMidi(midi)),core.maximizerRelease(internal),mono?1:0]);
 const chain=new core.Chain(rate);centers.forEach((hz,i)=>chain.eq.setBand(i,hz,gains[i]));
 const settings={bypass:0,clarityOn:1,surroundOn:1,bassOn:1,bass:midi,ambience:midi,clarity:core.clarityDrive(midi),surround:core.surroundIntensity(midi),dynamics:core.dynamicsGain(core.dynamicMidi(midi))};
 const channels=mono?1:2,block=Array.from({length:channels},()=>new Float32Array(128)),output=Array.from({length:channels},()=>new Float32Array(128));let error=0;
 for(let start=0;start<frames;start+=128){
  for(let i=0;i<128;i++)for(let c=0;c<channels;c++)block[c][i]=input[(start+i)*2+c];
  chain.process(block,output,settings);
  for(let i=0;i<128;i++)for(let c=0;c<channels;c++)error=Math.max(error,Math.abs(output[c][i]-samples[Math.floor((start+i)/ratio)*2+c]));
 }
 assert.ok(error<2e-6,JSON.stringify({rate,midi,mono,error}));worst=Math.max(worst,error);reports.push({rate,midi,mono,error});
}
fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(reports,null,2));
console.log(`Serial native C chain: ${reports.length} cases passed, maximum sample error ${worst}`);
