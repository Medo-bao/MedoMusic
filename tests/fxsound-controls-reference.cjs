const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const core=require('../src/fxsound-core.js');
const directory=path.join(__dirname,'artifacts/fxsound-controls');fs.mkdirSync(directory,{recursive:true});
const read=name=>fs.readFileSync(path.join(__dirname,'reference/fxsound',name),'utf8');
function excerpt(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const linear=excerpt(read('Qntitor.cpp'),'realtype scale = (r_output_max - r_output_min)/(i_input_max - i_input_min);','\n    }');
const rounding=excerpt(read('Qntrtoi.cpp'),'*ip_output = (int) ((r_input -','\n\n\treturn(OKAY);');
const ambience=read('dfxpComm.cpp').match(/pc_liveliness = \(int\)\(\(realtype\)pc_liveliness \* DFXP_MUSIC_MODE2_AMBIENCE_FACTOR\);/)[0];
const dynamics=read('dfxpComm.cpp').match(/pc_gain_boost = \(int\)\(\(realtype\)\(DFXP_MUSIC_MODE2_DYNAMIC_BOOST_FACTOR\) \* pc_gain_boost\);/)[0];
fs.writeFileSync(path.join(directory,'oracle.cpp'),`// AGPL-3.0-or-later FxSound control quantizer excerpts.
#include <cmath>
#include <cstdio>
using realtype=float;
#define TWO_PI 6.283185307
#define DFXP_MUSIC_MODE2_AMBIENCE_FACTOR .34
#define DFXP_MUSIC_MODE2_DYNAMIC_BOOST_FACTOR 1.8
float linear(float r_output_max,int midi){
 struct Table{float real_array[128];} table;auto* cast_handle=&table;
 float r_output_min=0;int i_input_max=127,i_input_min=0,index,array_size=128;
 ${linear}
 table.real_array[127]=r_output_max;return table.real_array[midi];
}
int main(int argc,char**argv){
 if(argc!=3)return 2;FILE* input=fopen(argv[1],"rb"),*output=fopen(argv[2],"wb");if(!input||!output)return 3;
 for(int midi=0;midi<128;midi++){
  int pc_liveliness=midi,pc_gain_boost=midi;${ambience}${dynamics}
  if(pc_gain_boost>127)pc_gain_boost=127;
  float values[]={linear((realtype)(TWO_PI/4.0*1.8*2.0*.75)*(realtype).8,midi),linear((realtype).7,midi),(float)pc_liveliness,(float)pc_gain_boost};
  fwrite(values,4,4,output);
 }
 struct Quantizer{float r_input_min=0,r_scale=127;int i_output_min=0;} quantizer;auto* cast_handle=&quantizer;
 float r_input;int result;auto* ip_output=&result;
 while(fread(&r_input,4,1,input)==1){${rounding}float value=(float)result;fwrite(&value,4,1,output);}
 fclose(input);fclose(output);
}
`);
const installation=execFileSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();assert.ok(installation);
fs.writeFileSync(path.join(directory,'build.cmd'),`@echo off\r\ncall "${installation}\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od oracle.cpp /Fe:oracle.exe\r\n`);
try{execFileSync('cmd.exe',['/d','/c','build.cmd'],{cwd:directory,stdio:'pipe'});}catch(e){console.error(e.stdout?.toString());throw e;}
const values=Array.from({length:101},(_,i)=>i/100);
for(let midi=0;midi<127;midi++)for(const offset of [-1e-7,0,1e-7])values.push((midi+.5)/127+offset);
const input=new Float32Array(values);fs.writeFileSync(path.join(directory,'input.f32'),Buffer.from(input.buffer));
execFileSync(path.join(directory,'oracle.exe'),['input.f32','output.f32'],{cwd:directory});
const bytes=fs.readFileSync(path.join(directory,'output.f32')),output=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
for(let midi=0;midi<128;midi++)[core.clarityDrive(midi),core.surroundIntensity(midi),core.ambienceMidi(midi),core.dynamicMidi(midi)].forEach((value,k)=>assert.equal(value,output[midi*4+k],`MIDI ${midi}, parameter ${k}`));
input.forEach((value,i)=>assert.equal(core.normalizedToMidi(value),output[512+i],`Normalized input ${value}`));
console.log(`FxSound controls: all 128 mappings and ${input.length} input/boundary cases match native exactly`);
