// Compile the original dfxpProcessReal channel reorder/dispatch/unreorder code.
// The DSP callback is a stateful probe so incorrect routing or silent-block
// advancement cannot be hidden by effects whose output happens to be zero.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');const {Chain}=require('../src/fxsound-core.js');
const directory=path.join(__dirname,'artifacts/fxsound-routing');fs.mkdirSync(directory,{recursive:true});
const source=fs.readFileSync(path.join(__dirname,'reference/fxsound/dfxpProcessReal.cpp'),'utf8');
function excerpt(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const dispatch=excerpt('// Zero "zero check" flags','\t/* Analyse the output buffer');
const restore=excerpt('// If input is Quad','\t/* Take care of recording */');
fs.writeFileSync(path.join(directory,'oracle.cpp'),`
#include <cstdio>
#include <cstdlib>
#include <vector>
using realtype=float;
#define OKAY 0
#define NOT_OKAY 1
#define IS_TRUE 1
#define IS_FALSE 0
#define COM_32_BIT_FLOAT_SAMPLES 0
#define FIRST_LINE 0
struct Probe {int id,count=0;};
struct Log {void Message_Wide(int,const wchar_t*){}};
struct Context {
 int num_channels_out,internal_rate_ratio=1;
 float r_samples_reordered[1024];
 Probe front{1},center{2},sub{3},rear{4},side{5};
 Probe *com_hdl_front=&front,*com_hdl_center=&center,*com_hdl_subwoofer=&sub,*com_hdl_rear=&rear,*com_hdl_side=&side;
 struct {int mode=0,i_process_real_samples_done=0;}trace;
 Log logger;Log* slout1=&logger;
};
int realSampleForceLegalValues_ArrayOnly(float*,long){return OKAY;}
int comProcessWaveBuffer(Probe* handle,long* data,float*,long frames,int stereo,int,int,int){
 auto* samples=(float*)data;int channels=stereo?2:1;
 for(int i=0;i<frames;i++){
  handle->count++;
  samples[i*channels]+=(float)(handle->id*10000+handle->count);
  if(stereo)samples[i*channels+1]-=(float)(handle->id*10000+handle->count);
 }
 return OKAY;
}
int process(Context* cast_handle,float* rp_samples,int i_num_sample_sets,int bypass_all){
 int i_reorder=1,stereo_in_mode=cast_handle->num_channels_out>1,stereo_out_mode=stereo_in_mode;
 int total_buffer_length=cast_handle->num_channels_out*i_num_sample_sets;
 int i,j,k,center_nonzero,sub_nonzero,side_nonzero,rear_nonzero;bool b_lean_and_mean=true;
 float tmp_float,ftmp,*rp_channels,*rp_buf;
 ${dispatch}
 ${restore}
 return OKAY;
}
int main(int argc,char**argv){
 if(argc!=4)return 2;Context context;context.num_channels_out=atoi(argv[3]);
 FILE* input=fopen(argv[1],"rb"),*output=fopen(argv[2],"wb");if(!input||!output)return 3;
 std::vector<float> block(context.num_channels_out*128);int index=0;
 while(fread(block.data(),4,block.size(),input)==block.size()){
  if(process(&context,block.data(),128,index%5==2))return 4;
  fwrite(block.data(),4,block.size(),output);index++;
 }
 fclose(input);fclose(output);
}
`);
const installation=execFileSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();
fs.writeFileSync(path.join(directory,'build.cmd'),`@echo off\r\ncall "${installation}\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od oracle.cpp /Fe:oracle.exe\r\n`);
try{execFileSync('cmd.exe',['/d','/c','build.cmd'],{cwd:directory,stdio:'pipe'});}catch(e){console.error(e.stdout?.toString());throw e;}
let cases=0;
for(const channels of [1,2,3,4,5,6,7,8]){
 const blocks=32,input=new Float32Array(channels*128*blocks);
 for(let block=0;block<blocks;block++)for(let c=0;c<channels;c++){
  // Entirely silent groups, one active side of a pair, end-of-buffer impulses,
  // and resumed buffers exercise the original whole-buffer activity flags.
  if((block+c)%4===0)for(let i=0;i<128;i++)input[(block*128+i)*channels+c]=(i%3-1)*.25;
  if((block+c)%7===0)input[(block*128+127)*channels+c]=.5;
 }
 fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(input.buffer));
 execFileSync(path.join(directory,'oracle.exe'),['input.f32','output.f32',String(channels)],{cwd:directory});
 const bytes=fs.readFileSync(path.join(directory,'output.f32')),expected=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
 const chain=new Chain(48000);chain.configureChannels(channels);
 const roles={front:1,center:2,sub:3,rear:4,side:5};
 for(const group of chain.groups){let count=0;group.maximizer.processStereo=(left,right,gain,pair,mono)=>{
  const amount=roles[group.role]*10000+(++count);pair[0]=Math.fround(left+amount);if(!mono)pair[1]=Math.fround(right-amount);return pair;
 };}
 const block=Array.from({length:channels},()=>new Float32Array(128)),output=Array.from({length:channels},()=>new Float32Array(128));
 for(let n=0;n<blocks;n++){
  for(let c=0;c<channels;c++)for(let i=0;i<128;i++)block[c][i]=input[(n*128+i)*channels+c];
  chain.process(block,output,{bypass:n%5===2,ambience:0,clarityOn:0,surroundOn:0,bassOn:0,dynamics:1});
  for(let c=0;c<channels;c++)for(let i=0;i<128;i++)assert.equal(output[c][i],expected[(n*128+i)*channels+c],JSON.stringify({channels,block:n,frame:i,c}));
 }cases++;
}
console.log(`Native channel dispatcher: ${cases} layouts, 32 stateful blocks each, exact routing/bypass/silence parity`);
