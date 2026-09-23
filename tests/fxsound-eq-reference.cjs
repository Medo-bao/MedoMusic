const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {Equalizer}=require('../src/fxsound-core.js');
const directory=path.join(__dirname,'artifacts/fxsound-eq');fs.mkdirSync(directory,{recursive:true});
const reference=name=>fs.readFileSync(path.join(__dirname,'reference/fxsound',name),'utf8');
function excerpt(source,start,end) {
 const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);
}
const design=excerpt(reference('FiltCalcBiqd.cpp'),'/* Floating absolute-value macro */','/* ------------------------------------------------------------------------\n\tfiltCalcShelf');
const structure=excerpt(reference('filt.h'),'struct filt2ndOrderBoostCutShelfFilterType','#define FILT_LO_SHELF');
const source=reference('SosProcess.cpp');
const stereo=source.slice(source.indexOf('else /* Stereo case */',source.indexOf('int PT_DECLSPEC sosProcessBuffer(')));
const loop=excerpt(stereo,'for (i = 0; i < cast_handle->num_active_sections; i++)','\n            rp_out_buf[k]');
const surroundLoop=excerpt(source,'//Ordering for 5.1 is:', '\n    applyVolumeLeveling(cast_handle, rp_out_buf, i_num_sample_sets, i_num_channels, r_samp_freq, 3);');
fs.writeFileSync(path.join(directory,'oracle.cpp'),`// FxSound filter design and original stereo SOS loop, AGPL-3.0-or-later.
#include <cmath>
#include <cstdio>
#include <cstdlib>
using realtype=float;using biqdRealtype=float;
#define IS_TRUE 1
#define IS_FALSE 0
#define OKAY 0
#define SOS_FLOAT_BIAS 1.0e-30
${structure}
${design}
struct Section{float b0,b1,b2,a2,state1=0,state2=0,state3=0,state4=0,state_1[8]={},state_2[8]={};};
struct State{Section sections[10];int section_on_flag[10],num_active_sections=10;float master_gain=1;};
int main(int argc,char**argv){
 if(argc!=6)return 2;
 int channels=atoi(argv[5]);
 FILE* input=fopen(argv[1],"rb"),*output=fopen(argv[2],"wb"),*parameters=fopen(argv[4],"rb");
 if(!input||!output||!parameters)return 3;
 float rate=(float)atof(argv[3]),values[20];if(fread(values,4,20,parameters)!=20)return 4;fclose(parameters);
 State state;auto* cast_handle=&state;
 double ratio=pow(16000.0/62.5,1.0/9);float quality=(float)(sqrt(ratio)/(ratio-1.0));
 for(int band=0;band<10;band++){
  filt2ndOrderBoostCutShelfFilterType filter={};filter.r_center_freq=values[band];filter.r_samp_freq=rate;filter.Q=quality;
  filter.boost=values[10+band];
  if(filter.r_center_freq*2>=rate)filter.boost=0;
  filtCalcParametric(&filter);
  state.section_on_flag[band]=filter.section_on_flag;
  auto* s=&state.sections[band];s->b0=filter.b0;s->b1=filter.b1;s->b2=filter.b2;s->a2=filter.a2;
  float coefficients[]={s->b0,s->b1,s->b2,s->a2};fwrite(coefficients,4,4,output);
 }
 float pair[8];int frame=0;while(fread(pair,4,channels,input)==channels){
 if(channels>2){
  auto* rp_in_buf=pair;auto* rp_out_buf=pair;int i_num_sample_sets=1,i_num_channels=channels,i,j,k;Section* s;
  if(frame<(int)(rate*.5)||frame>=(int)(rate*.75)){${surroundLoop}}
  frame++;fwrite(pair,4,channels,output);continue;
 }
  float in1=pair[0],in2=pair[1],out1=in1,out2=in2;int i,active_flag;Section* s;
  // Freeze every section for a quarter second, then resume its saved history.
  if(frame<(int)(rate*.5)||frame>=(int)(rate*.75)){${loop}}
  frame++;pair[0]=out1;pair[1]=out2;fwrite(pair,4,2,output);
 }fclose(input);fclose(output);
}
`);
const installation=execFileSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();
assert.ok(installation);
fs.writeFileSync(path.join(directory,'build.cmd'),`@echo off\r\ncall "${installation}\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od oracle.cpp /Fe:oracle.exe\r\n`);
try{execFileSync('cmd.exe',['/d','/c','build.cmd'],{cwd:directory,stdio:'pipe'});}catch(e){console.error(e.stdout?.toString());throw e;}
let cases=0,worst=0;
for(const channels of [2,6,8])for(const rate of [32000,44100,48000,96000,192000]){
 const input=new Float32Array(rate*channels);let seed=73;
 for(let i=0;i<rate;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;for(let channel=0;channel<channels;channel++)input[channels*i+channel]=channel%2 ? (seed/4294967296-.5)*.1*(channel+1) : .1*Math.sin(i*.021*(channel+1));}input[0]=1;
 fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(input.buffer));
 for(const [centers,gains] of [
 [[31,62,125,250,500,1000,2000,4000,8000,16000],[2,2,1.5,1,0,0,0,0,.5,1]],
 [[20,88,109,267,354,1100,2600,5500,11000,20000],[12,-12,.1,-.1,5,-5,6,-6,12,-12]],
 [[31,62,125,250,500,1000,2000,4000,8000,16000],Array(10).fill(12)]]){
  fs.writeFileSync(path.join(directory,'parameters.f32'),Buffer.from(new Float32Array([...centers,...gains]).buffer));
  execFileSync(path.join(directory,'oracle.exe'),['input.f32','output.f32',String(rate),'parameters.f32',String(channels)],{cwd:directory});
  const bytes=fs.readFileSync(path.join(directory,'output.f32')),output=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const eq=new Equalizer(rate);centers.forEach((frequency,i)=>eq.setBand(i,frequency,gains[i]));
  eq.coefficients.forEach((c,i)=>Object.values(c||{b0:1,b1:0,b2:0,a2:0}).forEach((value,k)=>assert.equal(value,output[i*4+k],`Coefficient ${rate}/${i}/${k}`)));
  for(let frame=0;frame<rate;frame++){
   if(frame===Math.trunc(rate*.5))centers.forEach((frequency,i)=>eq.setBand(i,frequency,0));
   if(frame===Math.trunc(rate*.75))centers.forEach((frequency,i)=>eq.setBand(i,frequency,gains[i]));
   for(let channel=0;channel<channels;channel++){
    const value=eq.processSample(input[frame*channels+channel],channel,channels),error=Math.abs(value-output[40+frame*channels+channel]);worst=Math.max(worst,error);
    assert.ok(error<2e-6,JSON.stringify({rate,frame,channel,error}));
   }
  }cases++;
 }
}
console.log(`FxSound native EQ: ${cases} cases including bypass/resume passed, maximum sample error ${worst}`);
