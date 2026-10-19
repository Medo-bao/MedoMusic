// Original FxSound C++ oracle for the two SOS loudness stages. Invoked only
// by the completed integration acceptance, not as a per-subtask test runner.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const core=require('../src/fxsound-core');
const reference=name=>fs.readFileSync(path.join(__dirname,'reference/fxsound',name),'utf8').replace(/\r\n/g,'\n');

function originalFunction(text,name){
  const start=text.indexOf(name),open=text.indexOf('{',start);assert.ok(start>=0 && open>start);
  let depth=1,end=open+1;
  while(depth && end<text.length){if(text[end]==='{')depth++;else if(text[end]==='}')depth--;end++;}
  assert.equal(depth,0);return text.slice(start,end);
}

function build(directory){
  fs.mkdirSync(directory,{recursive:true});
  const source=reference('SosProcess.cpp'),header=reference('u_sos.h');
  const helperStart=source.indexOf('namespace\n{'),helperEnd=source.indexOf('int PT_DECLSPEC sosProcessBuffer_MasterGainOnly');
  assert.ok(helperStart>0 && helperEnd>helperStart);
  const structs=header.slice(header.indexOf('struct sosSectionType'),header.lastIndexOf('#endif'));
  const normalizationStart=source.indexOf('    if (cast_handle->target_rms != 1.0f && i_num_channels == 2)',source.indexOf('NORMALIZATION NEW'));
  const normalizationEnd=source.indexOf('    applyVolumeLeveling(',normalizationStart);
  assert.ok(normalizationStart>0 && normalizationEnd>normalizationStart);
  const setter=originalFunction(reference('SosSet.cpp'),'int PT_DECLSPEC sosSetVolumeLeveling(');
  const cpp=`// FxSound AGPL-3.0-or-later: unmodified SOS state/helpers/setter/normalization excerpts.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
using realtype=float;using PT_HANDLE=void;class CSlout {};
#define PT_DECLSPEC
#define OKAY 0
#define NOT_OKAY 1
#define SOS_MAX_NUM_SOS_SECTIONS 32
#define SOS_VOLUME_LEVELING_HISTORY_SIZE 6
#define SOS_VOLUME_LEVELING_PEAK_WINDOW_SIZE 30
${structs}
${source.slice(helperStart,helperEnd)}
${setter}
int main(int argc,char**argv){
 if(argc!=6)return 2;
 FILE* input=fopen(argv[1],"rb"),*output=fopen(argv[2],"wb");if(!input||!output)return 3;
 int i_num_channels=atoi(argv[3]),i_num_sample_sets=atoi(argv[5]);float r_samp_freq=(float)atof(argv[4]);
 float* rp_out_buf=new float[i_num_channels*i_num_sample_sets];
 sosHdlType state={};auto* cast_handle=&state;state.normalization_gain=1;state.volume_leveling_gain=1;state.volume_leveling_quiet_gain_floor=1;
 float settings[3],previous=-1;
 while(fread(settings,4,3,input)==3){
  if(fread(rp_out_buf,4,i_num_channels*i_num_sample_sets,input)!=(size_t)(i_num_channels*i_num_sample_sets))return 4;
  state.target_rms=powf(10.0f,settings[0]/20.0f);
  if(previous!=settings[1]){sosSetVolumeLeveling(&state,(settings[1]/4.0f)*0.5f);previous=settings[1];}
  if(!settings[2] && i_num_channels!=4){
   float sum_squares=0;int j,k;
   if(i_num_channels==2 && state.target_rms!=1){for(int i=0;i<i_num_sample_sets;i++)sum_squares+=(rp_out_buf[i*2]*rp_out_buf[i*2])+(rp_out_buf[i*2+1]*rp_out_buf[i*2+1]);}
${source.slice(normalizationStart,normalizationEnd)}
   applyVolumeLeveling(cast_handle,rp_out_buf,i_num_sample_sets,i_num_channels,r_samp_freq,i_num_channels>=6?3:-1);
  }
  fwrite(rp_out_buf,4,i_num_channels*i_num_sample_sets,output);
 }
 delete[] rp_out_buf;fclose(input);fclose(output);
}
`;
  fs.writeFileSync(path.join(directory,'oracle.cpp'),cpp);
  const installation=execFileSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();assert.ok(installation);
  fs.writeFileSync(path.join(directory,'build.cmd'),`@echo off\r\ncall "${installation}\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od oracle.cpp /Fe:oracle.exe\r\n`);
  try{execFileSync('cmd.exe',['/d','/c','build.cmd'],{cwd:directory,stdio:'pipe'});}catch(error){throw new Error(error.stdout?.toString()||error.message);}
  return vector=>compare(directory,vector);
}

function compare(directory,{rate=48000,channels=2,seconds=2,profile='dynamic',normalization=0,level=0,transition=false}){
  const frames=128,blocks=Math.ceil(rate*seconds/frames),stride=3+frames*channels;
  const data=new Float32Array(blocks*stride),expected=new Float32Array(blocks*frames*channels);
  const model=new core.Loudness(rate),planar=Array.from({length:channels},()=>new Float32Array(frames));
  let index=0,outIndex=0,lfeError=0,seed=183;
  for(let block=0;block<blocks;block++){
    const amount=transition ? (block<blocks*.25?2:block<blocks*.5?0:block<blocks*.75?4:1) : level;
    data[index++]=normalization;data[index++]=amount;data[index++]=0;
    for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){
      const frame=block*frames+i,time=frame/rate;
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      let value=0;
      if(profile==='quiet')value=.006*Math.sin(time*Math.PI*2*900+c*.3);
      else if(profile==='tones')value=.35*Math.sin(time*Math.PI*2*80)+.08*Math.sin(time*Math.PI*2*6000+c);
      else if(profile==='impulse')value=frame%10000===0?2: .05*Math.sin(time*750+c);
      else if(profile!=='silence'){
        const amplitude=time%1<.35?.6:time%1<.65?.025:0;
        value=amplitude*(.7*Math.sin(time*Math.PI*2*730+c)+.3*(seed/4294967296-.5));
      }
      if(channels>=6 && c===3)value=.4*Math.sin(time*190);
      data[index++]=value;planar[c][i]=value;
    }
    model.configure(amount);
    if(channels!==4)model.process(planar,normalization);
    for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){
      expected[outIndex++]=planar[c][i];
      if(channels>=6 && c===3)lfeError=Math.max(lfeError,Math.abs(planar[c][i]-data[block*stride+3+i*channels+c]));
    }
  }
  fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(data.buffer));
  execFileSync(path.join(directory,'oracle.exe'),['input.f32','output.f32',String(channels),String(rate),String(frames)],{cwd:directory});
  const bytes=fs.readFileSync(path.join(directory,'output.f32'));
  const actual=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));assert.equal(actual.length,expected.length);
  let maximumError=0,firstMismatch=-1,peak=0;
  for(let i=0;i<actual.length;i++){
    assert.ok(Number.isFinite(expected[i]),`Non-finite JS sample at ${i}`);
    assert.ok(Number.isFinite(actual[i]),`Non-finite native sample at ${i}`);
    const error=Math.abs(expected[i]-actual[i]);
    if(error>maximumError){maximumError=error;firstMismatch=i;}
    peak=Math.max(peak,Math.abs(expected[i]));
  }
  const detail={rate,channels,seconds,profile,normalization,level,transition,maximumError,firstMismatch,peak,lfeError};
  assert.ok(maximumError<3e-6,JSON.stringify(detail));assert.equal(lfeError,0);
  return detail;
}

module.exports={build};
