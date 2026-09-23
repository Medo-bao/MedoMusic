const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {Bass}=require('../src/fxsound-core.js');
const directory=path.join(__dirname,'artifacts/fxsound-bass');fs.mkdirSync(directory,{recursive:true});
const reference=name=>fs.readFileSync(path.join(__dirname,'reference/fxsound',name),'utf8');
function excerpt(source,start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);
}
const design=excerpt(reference('FiltCalcBiqd.cpp'),'/* Floating absolute-value macro */','/* ------------------------------------------------------------------------\n\tfiltCalcShelf');
const structure=excerpt(reference('filt.h'),'struct filt2ndOrderBoostCutShelfFilterType','#define FILT_LO_SHELF');
const body=excerpt(reference('Play32.c'),'out1 = s->in1_w1 + s->b0','\n\t\t\t\tdutilPutOutputsAndMeter(out1, out2, status);');
fs.writeFileSync(path.join(directory,'oracle.cpp'),`// FxSound original filter and bass sample kernel, AGPL-3.0-or-later.
#include <cmath>
#include <cstdio>
#include <cstdlib>
using realtype=float;
using biqdRealtype=float;
#define IS_TRUE 1
#define IS_FALSE 0
#define OKAY 0
${structure}
${design}
struct State {float b0,b1,b2,a2,in1_w1=0,in1_w2=0,in2_w1=0,in2_w2=0;int stereo_in_flag=1;};
int main(int argc,char** argv) {
 if(argc!=5)return 2;
 FILE* input=fopen(argv[1],"rb"),*output=fopen(argv[2],"wb");if(!input||!output)return 3;
 float rate=(float)atof(argv[3]);int midi=atoi(argv[4]);State state;auto* s=&state;float table[128][4];
 for(int index=0;index<128;index++) {
  filt2ndOrderBoostCutShelfFilterType filter={};filter.r_center_freq=90;filter.r_samp_freq=rate;filter.Q=2.5f;
  filter.boost=index*(15.0f/127);filtCalcParametric(&filter);
  float coefficients[]={filter.b0,filter.b1,filter.b2,filter.a2};fwrite(coefficients,4,4,output);
  for(int k=0;k<4;k++)table[index][k]=coefficients[k];
  if(index==midi) {s->b0=filter.b0;s->b1=filter.b1;s->b2=filter.b2;s->a2=filter.a2;}
 }
 float pair[2];int frame=0;while(fread(pair,4,2,input)==2) {
  float in1=pair[0],in2=pair[1],out1,out2;
  if(midi==-1){int index=(frame>=rate/4 && frame<rate/2)?0:127;s->b0=table[index][0];s->b1=table[index][1];s->b2=table[index][2];s->a2=table[index][3];}
  if(midi==0){out1=in1;out2=in2;}else{${body}}
  frame++;
  pair[0]=out1;pair[1]=out2;fwrite(pair,4,2,output);
 }
 fclose(input);fclose(output);
}
`);
const installation=execFileSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();
assert.ok(installation);
fs.writeFileSync(path.join(directory,'build.cmd'),`@echo off\r\ncall "${installation}\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od oracle.cpp /Fe:oracle.exe\r\n`);
try {execFileSync('cmd.exe',['/d','/c','build.cmd'],{cwd:directory,stdio:'pipe'});}catch(e){console.error(e.stdout?.toString());throw e;}
let worst=0,cases=0;
for(const rate of [32000,44100,48000,96000]) {
 const input=new Float32Array(rate*2*2);let seed=73;
 for(let i=0;i<rate*2;i++) {
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  input[2*i]=i<rate?.2*Math.sin(i*2*Math.PI*90/rate):0;
  input[2*i+1]=i<rate?(seed/4294967296-.5)*.1:0;
 }input[0]=1;
 fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(input.buffer));
 for(const midi of [0,1,5,12,51,127,-1]) {
  execFileSync(path.join(directory,'oracle.exe'),['input.f32','output.f32',String(rate),String(midi)],{cwd:directory});
  const bytes=fs.readFileSync(path.join(directory,'output.f32'));
  const output=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const bass=new Bass(rate);
  bass.table.forEach((c,index)=>Object.values(c).forEach((value,k)=>assert.equal(value,output[index*4+k],`Coefficient at ${rate}, MIDI ${index}, ${k}`)));
  for(let i=0;i<input.length;i++) {
   const frame=Math.floor(i/2),effectiveMidi=midi===-1?(frame>=rate/4&&frame<rate/2?0:127):midi;
   const value=bass.processSample(input[i],i%2,effectiveMidi,midi!==0),error=Math.abs(value-output[512+i]);worst=Math.max(worst,error);
   assert.ok(error<2e-6,JSON.stringify({rate,midi,frame:Math.floor(i/2),error,value,expected:output[512+i]}));
  }cases++;
 }
}
console.log(`FxSound native bass: ${cases} two-second cases passed, maximum sample error ${worst}`);
