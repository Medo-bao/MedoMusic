const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Reverb, reverbParameters } = require('../src/fxsound-core.js');
const directory = path.join(__dirname,'artifacts/fxsound-reverb');
fs.mkdirSync(directory,{recursive:true});
const reference = name => fs.readFileSync(path.join(__dirname,'reference/fxsound',name),'utf8');
const original = reference('Lex32.c');
function excerpt(source,start,end) {
  const from=source.indexOf(start), to=source.indexOf(end,from);
  assert.ok(from>=0 && to>from); return source.slice(from,to);
}
const init=excerpt(original,'s->MasterStart =','\n\t}',);
// Only pointer comparisons are widened for this 64-bit harness; sample arithmetic
// is extracted unchanged from the native DFX branch (not the modulated DSPFX branch).
const body=excerpt(original,'in1 += (float)DSP_DENORM_BIAS;','dutilSetClipStatus').replace(/\(long\)(rp_MACRO|tmp_ptr|s->MasterStart)/g,'(intptr_t)$1');
const header=reference('c_lex.h').replace('#include "dspfxp_studioverb.h"','');
const wetDry=excerpt(reference('kerdelay.h'),'#define kerWetDry(', '\n\n');
const exponential=excerpt(reference('Qntitor.cpp'),'factor = (realtype)pow((double)(r_output_max/r_output_min)', '\n\t  if (i_force_value_flag)');
const lowpass=excerpt(reference('Fil12But.cpp'),'void PT_DECLSPEC filtDesignSimple1rstLowPass','/*').replace('PT_DECLSPEC','');
const mapping=excerpt(reference('dfxpComm.cpp'),'dsp_decay = (realtype)pow(dsp_decay, roomsize);','// Ambience will always be bypassed');
fs.writeFileSync(path.join(directory,'oracle.cpp'),`// AGPL-3.0-or-later FxSound original reverb, test-only.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <vector>
using realtype=float;
#define PT_DSP_BUILD 1
#define PT_DSP_DSPFX 2
#define DSP_DENORM_BIAS 1.0e-36
${header}
${wetDry}
${lowpass}
float exponential(float r_output_min,float r_output_max,int midi) {
 struct Table { float real_array[128]; int array_size=128; } table;
 auto* cast_handle=&table;int i_input_max=127,i_input_min=0,index;float factor;
 ${exponential}
 return table.real_array[midi];
}
float lowpass(float rate,int midi) {
 float omega=(float)(2*3.14159265358979323846)*(exponential(1,20,midi)*1000.0f)*(1.0f/rate),coeff;
 filtDesignSimple1rstLowPass(omega,&coeff); return coeff;
}
int main(int argc,char** argv) {
 if(argc!=6) return 2;
 FILE* input=fopen(argv[1],"rb"),*output=fopen(argv[2],"wb"),*parameters=fopen(argv[4],"rb");
 if(!input||!output||!parameters) return 3;
 float values[9]; if(fread(values,4,9,parameters)!=9) return 4; fclose(parameters);
 float r_samp_freq=(float)atof(argv[3]),r_roomsize;
 dspLexStructType state={}; auto* s=&state;
 s->roomsize=values[0];s->bandwidth=values[1];s->one_minus_bandwidth=values[2];
 s->damping=values[3];s->one_minus_damping=values[4];s->decay=values[5];
 s->lat6_coeff=values[6];s->wet_gain=values[7];s->dry_gain=values[8];
 s->lat1_coeff=.75f;s->lat3_coeff=.625f;s->lat5_coeff=.7f;s->pre_delay=1;s->stereo_in_flag=atoi(argv[5])?0:1;
 std::vector<float> memory((int)(r_samp_freq*3)+LEX_NUM_OSC_PTS);
 s->osc_plus_table=memory.data();
 ${init}
 float length=(float)s->MasterLen;fwrite(&length,4,1,output);
 for(int pc_liveliness=0;pc_liveliness<128;pc_liveliness++) {
  float roomsize=.5f+(1.0f/127)*64;
  float dsp_decay=exponential(.095f,.95f,pc_liveliness),dsp_lat6_coeff,wet_gain,dry_gain;
  ${mapping}
  float bandwidth=lowpass(r_samp_freq,89),damping=lowpass(r_samp_freq,81);
  float mapped[]={roomsize,bandwidth,1.0f-bandwidth,damping,1.0f-damping,dsp_decay,dsp_lat6_coeff,wet_gain,dry_gain};
  fwrite(mapped,4,9,output);
 }
 float pair[2];
 while(fread(pair,4,2,input)==2) {
  float in1=pair[0],in2=s->stereo_in_flag?pair[1]:pair[0],out1=0,out2=0,tmp_a,tmp_b;
  float tap1_out,tap2_out,tap3_out,tap4_out,input_diffuser_out,next_out;
  ${body}
  pair[0]=s->stereo_in_flag?out1:out1+out2;pair[1]=out2;fwrite(pair,4,2,output);
 }
 fclose(input);fclose(output);
}
`);
const installation=execFileSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();
assert.ok(installation);
fs.writeFileSync(path.join(directory,'build.cmd'),`@echo off\r\ncall "${installation}\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od oracle.cpp /Fe:oracle.exe\r\n`);
try { execFileSync('cmd.exe',['/d','/c','build.cmd'],{cwd:directory,stdio:'pipe'}); }
catch(error) { console.error(error.stdout?.toString()); throw error; }
let worst=0,cases=0;
for(const rate of [32000,44100,48000,96000]) {
  const input=new Float32Array(rate*3*2);
  let seed=23;
  for(let frame=0;frame<rate*3;frame++) {
    if(frame<rate/2) {
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      input[frame*2]=((seed/4294967296)*2-1)*.15;
      input[frame*2+1]=.1*Math.sin(frame*2*Math.PI*397/rate);
    }
  }
  input[0]=1;input[1]=0;
  fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(input.buffer));
  for(const roomsize of [.5,1,1.5]) for(const mono of [false,true]) {
    const p={roomsize,bandwidth:.350110,oneMinusBandwidth:.649890,damping:.408290,oneMinusDamping:.591710,decay:roomsize===1?.565664:.92,lat6:.5,wet:.273,dry:.897};
    fs.writeFileSync(path.join(directory,'parameters.f32'),Buffer.from(new Float32Array(Object.values(p)).buffer));
    execFileSync(path.join(directory,'oracle.exe'),['input.f32','output.f32',String(rate),'parameters.f32',mono?'1':'0'],{cwd:directory});
    const bytes=fs.readFileSync(path.join(directory,'output.f32'));
    const output=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const engine=new Reverb(rate,p), pair=new Float32Array(2);
    assert.equal(engine.memory.length,output[0],'Native ring allocation');
    for(let midi=0;midi<128;midi++) {
      const values=Object.values(reverbParameters(rate,midi));
      for(let index=0;index<9;index++) assert.equal(values[index],output[1+midi*9+index],`Native mapping at rate ${rate}, MIDI ${midi}, parameter ${index}`);
    }
    for(let i=0;i<input.length;i+=2) {
      engine.processStereo(input[i],mono?input[i]:input[i+1],pair,mono);
      for(let channel=0;channel<(mono?1:2);channel++) {
        const error=Math.abs(pair[channel]-output[1153+i+channel]);worst=Math.max(worst,error);
        assert.ok(error<2e-6,JSON.stringify({rate,roomsize,frame:i/2,channel,error,actual:pair[channel],expected:output[1153+i+channel]}));
      }
    }
    cases++;
  }
}
console.log(`FxSound native reverb: ${cases} three-second cases passed, maximum sample error ${worst}`);
