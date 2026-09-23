const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Maximizer, maximizerRelease, dynamicsGain } = require('../src/fxsound-core.js');
const directory = path.join(__dirname,'artifacts/fxsound-maximizer');
fs.mkdirSync(directory,{recursive:true});
const original = fs.readFileSync(path.join(__dirname,'reference/fxsound/Maxi32.c'),'utf8');
function excerpt(start,end) {
  const from=original.indexOf(start), to=original.indexOf(end,from);
  assert.ok(from>=0 && to>from); return original.slice(from,to);
}
const body=excerpt('in_sqr = in1 * in1;', 'if( s->quantize_on_flag )');
const design=excerpt('double r_omega =', '\n\t\t}');
const quantizer=fs.readFileSync(path.join(__dirname,'reference/fxsound/Qntitor.cpp'),'utf8');
const mapping=quantizer.slice(quantizer.indexOf('/* Now handle special case for maximizer boost */'),quantizer.indexOf('*hpp_qnt = (PT_HANDLE *)cast_handle;'));
assert.ok(mapping.includes('QNT_RESPONSE_MAXI_BOOST_DSP'));
fs.writeFileSync(path.join(directory,'oracle.cpp'),`// AGPL-3.0-or-later FxSound original sample loop, test-only.
#include <cmath>
#include <cstdio>
#include <cstdlib>
using realtype=float;
#define MAXIMIZE_LEVEL_FILT_CUTOFF 0.1
#define MAXI_ENVELOPE_BIAS 1.0e-24
enum { QNT_RESPONSE_MAXI_BOOST=1,QNT_RESPONSE_MAXI_MAX_OUTPUT,QNT_RESPONSE_MAXI_BOOST_DSP,QNT_RESPONSE_MAXI_MAX_OUTPUT_DSP };
float nativeGain(int midi) {
 struct Quantizer { float real_array[128]={}; int array_size=128; } quantizer;
 auto* cast_handle=&quantizer; int index; int i_response_type=QNT_RESPONSE_MAXI_BOOST_DSP;
 ${mapping}
 return cast_handle->real_array[(int)((realtype)midi*(realtype).7)];
}
float nativeRelease(float rate) {
 float milliseconds=.1f, factor=(float)pow((double)(100.0f/.1f),1.0/127);
 for(int i=0;i<85;i++) milliseconds*=factor;
 float exp_arg=1.0f/(milliseconds*.001f*rate);
 return (float)exp(-exp_arg);
}
struct State {
 float a0,filt_gain,level=0,gain_boost,max_output=.966051f,target_level=.32f,release_time_beta;
 int max_delay,stereo_in_flag=1,ramp_count_l=0,ramp_count_r=0;
 float env_l=0,env_r=0,max_abs_l=0,max_abs_r=0,delta_l=0,delta_r=0;
 float dly_start_l[96]={},dly_start_r[96]={};
 float *ptr_l=dly_start_l,*ptr_r=dly_start_r;
};
int main(int argc,char** argv) {
 if(argc!=7) return 2;
 FILE* input=fopen(argv[1],"rb"),*output=fopen(argv[2],"wb");
 if(!input||!output) return 3;
 float r_samp_freq=(float)atof(argv[3]); State state; State* s=&state;s->stereo_in_flag=atoi(argv[6])?0:1;
 ${design}
 s->max_delay=(int)(r_samp_freq*(realtype).00075);
 s->gain_boost=(float)atof(argv[4]); s->release_time_beta=(float)atof(argv[5]);
 float coefficients[]={s->a0,s->filt_gain,(float)s->max_delay}; fwrite(coefficients,4,3,output);
 float beta=nativeRelease(r_samp_freq); fwrite(&beta,4,1,output);
 for(int midi=0;midi<128;midi++) { float gain=nativeGain(midi); fwrite(&gain,4,1,output); }
 float pair[2],peak_in1=0,peak_in2=0,peak_out1=0,peak_out2=0;
 while(fread(pair,4,2,input)==2) {
  float in1=pair[0],in2=pair[1],out1=0,out2=0,in_sqr,sqrt_level,gain_boost;
  float dly_l_out,dly_r_out,new_abs_l,new_abs_r;
  ${body}
  pair[0]=out1;pair[1]=out2;fwrite(pair,4,2,output);
 }
 fclose(input);fclose(output);
}
`);
const installation=execFileSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();
assert.ok(installation);
fs.writeFileSync(path.join(directory,'build.cmd'),`@echo off\r\ncall "${installation}\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od oracle.cpp /Fe:oracle.exe\r\n`);
execFileSync('cmd.exe',['/d','/c','build.cmd'],{cwd:directory,stdio:'pipe'});
let worst=0,cases=0;
for(const rate of [32000,44100,48000,96000]) {
  const input=new Float32Array(rate*4*2);
  for(let frame=0;frame<rate*4;frame++) {
    const time=frame/rate, amplitude=time<.25 ? .01 : time<2 ? 1.4 : time<2.25 ? 0 : .7;
    input[2*frame]=amplitude*Math.sin(2*Math.PI*397*time);
    input[2*frame+1]=amplitude*Math.sin(2*Math.PI*631*time+.6);
    if(frame%1981===0) input[2*frame]=2.3;
  }
  fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(input.buffer));
  for(const gain of [1,1.5,3.801893963205612,8]) for(const mono of [false,true]) {
    const beta=maximizerRelease(rate);
    execFileSync(path.join(directory,'oracle.exe'),['input.f32','output.f32',String(rate),String(gain),String(beta),mono?'1':'0'],{cwd:directory});
    const bytes=fs.readFileSync(path.join(directory,'output.f32'));
    const output=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const engine=new Maximizer(rate,beta), pair=new Float32Array(2);
    assert.equal(engine.pole,output[0]); assert.equal(engine.feed,output[1]); assert.equal(engine.delay,output[2]);
    assert.equal(beta,output[3],'Release-time MIDI mapping matches native');
    for(let midi=0;midi<128;midi++) assert.equal(dynamicsGain(midi),output[4+midi],`Gain mapping at MIDI ${midi}`);
    for(let i=0;i<input.length;i+=2) {
      engine.processStereo(input[i],input[i+1],gain,pair,mono);
      for(let channel=0;channel<(mono?1:2);channel++) {
        const error=Math.abs(pair[channel]-output[132+i+channel]); worst=Math.max(worst,error);
        assert.ok(error<2e-6,JSON.stringify({rate,gain,frame:i/2,channel,error}));
        assert.ok(Math.abs(pair[channel])<=engine.maximum+1e-6,'Original peak control bounds output');
      }
    }
    cases++;
  }
}
console.log(`FxSound native Maximizer: ${cases} four-second cases passed, maximum sample error ${worst}`);
