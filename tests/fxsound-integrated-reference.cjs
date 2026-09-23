// Original dispatcher + original Comwave conversion + persistent native kernels.
// Parameter tables are supplied from mappings independently validated against C.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');const core=require('../src/fxsound-core.js');
const artifacts=path.join(__dirname,'artifacts'),directory=path.join(artifacts,'fxsound-integrated');fs.mkdirSync(directory,{recursive:true});
if(!process.argv.includes('--reuse-oracles'))for(const name of ['chain','routing'])execFileSync(process.execPath,[path.join(__dirname,`fxsound-${name}-reference.cjs`)],{stdio:'inherit'});
const nativeKernels=require('./helpers/fxsound-native-kernels.cjs')(artifacts);
const wave=fs.readFileSync(path.join(__dirname,'reference/fxsound/Comwave.cpp'),'utf8');
function cut(s,a,b){const x=s.indexOf(a),y=s.indexOf(b,x);assert.ok(x>=0&&y>x);return s.slice(x,y);}
const down=cut(wave,'// Downsample the data','\n\tif (cast_handle->softdsp_mode)');
const up=cut(wave.slice(wave.indexOf('/* Hardware currently not supported */')),'if(i_down_sample_ratio > 1)','if ( i_format_flag == COM_24_BIT_SAMPLES');
let source=fs.readFileSync(path.join(artifacts,'fxsound-routing/oracle.cpp'),'utf8');
source=source.replace('#include <vector>','#include <vector>\n#include <cmath>\n#include <cstdint>\n#include <memory>');
source=source.replace('struct Probe {int id,count=0;};',`${nativeKernels}
float rate=48000,table[128][12];int midi=0,cMidi=0,aMidi=0,sMidi=0,bMidi=0,dMidi=0;
struct Probe {
 int id;aural::Kernel clarity;room::Kernel reverb;bass::Kernel bass;maxi::Kernel maximizer;
 Probe(int role):id(role),clarity(rate),reverb(rate,table[0]+3),bass(rate),maximizer(rate){}
 void process(float* pair,bool mono){
  if(id!=3 && cMidi>0)clarity.process(pair,mono,table[cMidi][0],cMidi);
  if(id!=3 && aMidi>12){reverb.parameters(table[aMidi]+3);reverb.process(pair,mono,0,aMidi);}
  if(id!=3 && id!=2 && sMidi>0)wide::process(pair,mono,table[sMidi][1]);
  if((id==1 || id==3) && bMidi>0)bass.process(pair,mono,0,bMidi);
  maximizer.process(pair,mono,table[dMidi][2],dMidi);
 }
};`);
const begin=source.indexOf('int comProcessWaveBuffer('),end=source.indexOf('int process(Context*',begin);
source=source.slice(0,begin)+`int comProcessWaveBuffer(Probe* handle,long* data,float*,long l_length,int i_stereo_in_mode,int i_stereo_out_mode,int i_down_sample_ratio,int){
 auto* l_ptr=data;float* f_ptr=(float*)data;int num_sample_sets_to_process=l_length,num_down_sample_sets,leftover_samples,i,j;
 ${down}
 int channels=i_stereo_in_mode?2:1;
 for(int frame=0;frame<num_sample_sets_to_process;frame++){
  float pair[]={f_ptr[frame*channels],f_ptr[frame*channels+(channels==2?1:0)]};
  handle->process(pair,channels==1);f_ptr[frame*channels]=pair[0];if(channels==2)f_ptr[frame*channels+1]=pair[1];
 }
 ${up}
 return OKAY;
}
`+source.slice(end);
source=source.slice(0,source.indexOf('int main('))+`int main(int argc,char**argv){
 if(argc!=6 && argc!=7)return 2;bool fixture=argc==7;float hostRate=(float)atof(argv[3]);int ratio=hostRate>48000?(hostRate<192000?2:4):1;rate=hostRate/ratio;
 FILE* parameters=fopen(argv[5],"rb");if(!parameters)return 3;if(fread(table,4,128*12,parameters)!=128*12)return 4;float eqValues[80];if(fread(eqValues,4,80,parameters)!=80)return 4;if(fixture){float controls[5];if(fread(controls,4,5,parameters)!=5)return 4;cMidi=(int)controls[0];aMidi=(int)controls[1];sMidi=(int)controls[2];bMidi=(int)controls[3];dMidi=(int)controls[4];}fclose(parameters);equalizer::Kernel eq(hostRate,eqValues);
 int layout=atoi(argv[4]),storageChannels=layout?layout:8,formats[]={2,6,8,4,1,8};
 std::unique_ptr<Context> context(new Context);context->num_channels_out=layout?layout:2;context->internal_rate_ratio=ratio;
 FILE* input=fopen(argv[1],"rb"),*output=fopen(argv[2],"wb");if(!input||!output)return 5;
 std::vector<float> block(storageChannels*128);int index=0,values[]={0,13,64,127};
 while(fread(block.data(),4,block.size(),input)==block.size()){
  int channels=layout?layout:formats[(index/64)%6];
  if(channels!=context->num_channels_out){context.reset(new Context);context->num_channels_out=channels;context->internal_rate_ratio=ratio;}
  if(channels!=storageChannels)for(int frame=0;frame<128;frame++)for(int c=0;c<channels;c++)block[frame*channels+c]=block[frame*storageChannels+c];
  if(!fixture){midi=values[(index/32)%4];cMidi=aMidi=sMidi=bMidi=dMidi=midi;if(index%17==0)eq.update(hostRate,eqValues+20*((index/17)%4));}bool bypass=!fixture && index%19==7;if(!bypass)eq.process(block.data(),128,channels);if(process(context.get(),block.data(),128,bypass))return 6;
  if(channels!=storageChannels)for(int frame=127;frame>=0;frame--){
   for(int c=channels-1;c>=0;c--)block[frame*storageChannels+c]=block[frame*channels+c];
   for(int c=channels;c<storageChannels;c++)block[frame*storageChannels+c]=0;
  }
  fwrite(block.data(),4,block.size(),output);index++;
 }fclose(input);fclose(output);
}
`;
fs.writeFileSync(path.join(directory,'oracle.cpp'),source);
const installation=execFileSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();
fs.writeFileSync(path.join(directory,'build.cmd'),`@echo off\r\ncall "${installation}\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od oracle.cpp /Fe:oracle.exe\r\n`);
try{execFileSync('cmd.exe',['/d','/c','build.cmd'],{cwd:directory,stdio:'pipe'});}catch(e){console.error(e.stdout?.toString());throw e;}
let worst=0;const reports=[];
for(const layout of [0,1,2,4,6,8])for(const rate of [48000,96000,192000])for(const equalize of [false,true]){
 const channels=layout||8;
 const blocks=384,frames=blocks*128,input=new Float32Array(frames*channels),internal=rate/core.internalRateRatio(rate);
 for(let c=0;c<channels;c++)for(let i=0;i<frames;i++)if((Math.floor(i/4096)+c)%3!==1)input[i*channels+c]=.15*Math.sin(i*(.03+c*.09));
 const table=Float32Array.from(Array.from({length:128},(_,midi)=>[core.clarityDrive(midi),core.surroundIntensity(midi),core.dynamicsGain(core.dynamicMidi(midi)),...Object.values(core.reverbParameters(internal,core.ambienceMidi(midi)))]).flat());
 const centers=[31,62,125,250,500,1000,2000,4000,8000,16000],gains=equalize?[2,-1,3,-2,1,-1,2,-2,1,-1]:Array(10).fill(0);
 const eqModes=[[centers,gains],[[20,88,109,267,354,1100,2600,5500,11000,20000],[12,-12,.1,-.1,5,-5,6,-6,12,-12]],[centers,Array(10).fill(0)],[centers,gains.map(v=>-v)]];
 fs.writeFileSync(path.join(directory,'parameters.f32'),Buffer.concat([Buffer.from(table.buffer),Buffer.from(new Float32Array(eqModes.flat(2)).buffer)]));fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(input.buffer));
 execFileSync(path.join(directory,'oracle.exe'),['input.f32','output.f32',String(rate),String(layout),'parameters.f32'],{cwd:directory});
 const bytes=fs.readFileSync(path.join(directory,'output.f32')),expected=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
 const chain=new core.Chain(rate),block=Array.from({length:channels},()=>new Float32Array(128)),output=Array.from({length:channels},()=>new Float32Array(128));let error=0,firstMismatch=null,worstAt=null;centers.forEach((hz,i)=>chain.eq.setBand(i,hz,gains[i]));
 for(let n=0;n<blocks;n++){
  const midi=[0,13,64,127][Math.floor(n/32)%4];
  if(n%17===0){const [hz,db]=eqModes[Math.floor(n/17)%4];hz.forEach((frequency,i)=>chain.eq.setBand(i,frequency,db[i]));}
  for(let c=0;c<channels;c++)for(let i=0;i<128;i++)block[c][i]=input[(n*128+i)*channels+c];
  const activeChannels=layout||[2,6,8,4,1,8][Math.floor(n/64)%6];
  chain.process(block.slice(0,activeChannels),output.slice(0,activeChannels),{bypass:n%19===7,ambience:midi,bass:midi,clarityOn:midi>0,surroundOn:midi>0,bassOn:midi>0,clarity:table[midi*12],surround:table[midi*12+1],dynamics:table[midi*12+2]});
  for(let c=activeChannels;c<channels;c++)output[c].fill(0);
  for(let c=0;c<channels;c++)for(let i=0;i<128;i++){const difference=Math.abs(output[c][i]-expected[(n*128+i)*channels+c]);if(difference>2e-6&&!firstMismatch)firstMismatch={block:n,frame:i,channel:c,actual:output[c][i],expected:expected[(n*128+i)*channels+c]};if(difference>error){error=difference;worstAt={block:n,frame:i,channel:c};}}
 }
 assert.ok(error<2e-6,JSON.stringify({layout,channels,rate,equalize,error,firstMismatch,worstAt}));worst=Math.max(worst,error);reports.push({layout,channels,rate,equalize,error});
}
reports.push(...require('./helpers/fxsound-stimuli.cjs')(directory));
fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(reports,null,2));
console.log(`Integrated native dispatcher/converter/effects: ${reports.length} cases passed, maximum error ${worst}`);
