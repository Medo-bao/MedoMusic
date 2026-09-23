const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {_electron}=require('playwright');
const {Chain}=require('../src/fxsound-core.js');
const root=path.resolve(__dirname,'..'),directory=path.join(__dirname,'artifacts/fxsound-rate');fs.mkdirSync(directory,{recursive:true});
const source=fs.readFileSync(path.join(__dirname,'reference/fxsound/Comwave.cpp'),'utf8');
function excerpt(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const down=excerpt('// Downsample the data','\n\tif (cast_handle->softdsp_mode)');
const up=source.slice(source.indexOf('if(i_down_sample_ratio > 1)',source.indexOf('/* Hardware currently not supported */')),source.indexOf('if ( i_format_flag == COM_24_BIT_SAMPLES',source.indexOf('/* Hardware currently not supported */')));
assert.ok(up.includes('leftover_samples'));
fs.writeFileSync(path.join(directory,'oracle.cpp'),`// FxSound Comwave conversion excerpts, AGPL-3.0-or-later.
#include <cstdio>
#include <cstdlib>
int main(int argc,char**argv){
 if(argc!=4 && argc!=6)return 2;FILE* input=fopen(argv[1],"rb"),*output=fopen(argv[2],"wb");if(!input||!output)return 3;
 int i_down_sample_ratio=atoi(argv[3]),i_stereo_in_mode=argc==6?atoi(argv[5]):1,i_stereo_out_mode=i_stereo_in_mode;
 int channels=i_stereo_in_mode?2:1,blockFrames=argc==6?atoi(argv[4]):128;
 float data[512];int count;
 while((count=(int)fread(data,4,blockFrames*channels,input))!=0){
  int l_length=count/channels,num_sample_sets_to_process=l_length,num_down_sample_sets,leftover_samples,i,j;
  float* f_ptr=data;auto* l_ptr=(long*)data;
  ${down}
  // Identity effect isolates conversion from independently tested effect kernels.
  ${up}
  fwrite(data,4,count,output);
 }fclose(input);fclose(output);
}
`);
const installation=execFileSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();assert.ok(installation);
fs.writeFileSync(path.join(directory,'build.cmd'),`@echo off\r\ncall "${installation}\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od oracle.cpp /Fe:oracle.exe\r\n`);
try{execFileSync('cmd.exe',['/d','/c','build.cmd'],{cwd:directory,stdio:'pipe'});}catch(e){console.error(e.stdout?.toString());throw e;}
// Exercise native leftover handling independently of Chromium's 128-frame quantum.
let boundaryCases=0;
for(const ratio of [1,2,4])for(const channels of [1,2])for(const frames of [4,5,7,127,128,129,255]){
 const input=Array.from({length:channels},(_,c)=>Float32Array.from({length:frames},(_,i)=>Math.sin(i*.31+c)));
 const interleaved=Float32Array.from({length:frames*channels},(_,i)=>input[i%channels][Math.floor(i/channels)]);
 fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(interleaved.buffer));
 execFileSync(path.join(directory,'oracle.exe'),['input.f32','output.f32',String(ratio),String(frames),String(channels===2?1:0)],{cwd:directory});
 const bytes=fs.readFileSync(path.join(directory,'output.f32')),expected=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
 const chain=new Chain(ratio===1?48000:ratio===2?96000:192000);chain.configureChannels(channels);
 let calls=0;chain.groups[0].maximizer.processStereo=(left,right,gain,pair)=>{calls++;pair[0]=left;pair[1]=right;return pair;};
 const output=Array.from({length:channels},()=>new Float32Array(frames));
 chain.process(input,output,{bypass:0,ambience:0,clarityOn:0,surroundOn:0,bassOn:0,dynamics:1});
 for(let i=0;i<expected.length;i++)assert.equal(output[i%channels][Math.floor(i/channels)],expected[i],`Boundary ${ratio}/${channels}/${frames}/${i}`);
 assert.equal(calls,Math.floor(frames/ratio),'Partial group must not advance effects');boundaryCases++;
}
console.log(`Native rate boundary checks: ${boundaryCases} mono/stereo cases passed`);
(async()=>{
 const app=await _electron.launch({executablePath:path.join(root,'.electron-dist/electron.exe'),args:[root,`--user-data-dir=${path.join(directory,'profile')}`]});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.MedoSound);
  for(const [rate,ratio] of [[44100,1],[48000,1],[88200,2],[96000,2],[176400,2],[192000,4]]){
   const result=await page.evaluate(async rate=>{
    const frames=8192,context=new OfflineAudioContext(2,frames,rate);await MedoSound.prepare(context);
    const input=context.createBuffer(2,frames,rate),data=[];
    for(let i=0;i<frames;i++)for(let channel=0;channel<2;channel++){
     const value=Math.fround(.2*Math.sin(i*.19+channel)+((i%67===0)? .5:0));input.getChannelData(channel)[i]=value;data.push(value);
    }
    const source=context.createBufferSource();source.buffer=input;
    const node=new AudioWorkletNode(context,'fxsound-stage',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{kind:'clarity'}});
    source.connect(node).connect(context.destination);source.start();const rendered=await context.startRendering(),output=[];
    for(let i=0;i<frames;i++)for(let channel=0;channel<2;channel++)output.push(rendered.getChannelData(channel)[i]);
    return {data,output};
   },rate);
   fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(new Float32Array(result.data).buffer));
   execFileSync(path.join(directory,'oracle.exe'),['input.f32','output.f32',String(ratio)],{cwd:directory});
   const bytes=fs.readFileSync(path.join(directory,'output.f32')),expected=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
   result.output.forEach((value,i)=>assert.equal(value,expected[i],`Rate ${rate}, sample ${i}`));
  }
  console.log('FxSound native rate conversion: six rates, Electron output exactly matches original Comwave loops');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
