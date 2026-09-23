// Builds a test-only executable from pinned upstream statements. No native
// executable is bundled in MedoMusic or loaded by its audio engine.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { Clarity, clarityCoefficients, widenStereo } = require('../src/fxsound-core.js');
const root = path.resolve(__dirname, '..');
const reference = path.join(__dirname, 'reference/fxsound');
const artifacts = path.join(__dirname, 'artifacts/fxsound-reference');
fs.mkdirSync(artifacts, { recursive: true });
const read = name => fs.readFileSync(path.join(reference, name), 'utf8');
function between(text, start, end) {
  const from = text.indexOf(start), to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Upstream markers: ${start}`);
  return text.slice(from, to);
}
function functionText(text, signature) {
  const start = text.indexOf(signature);
  assert.ok(start >= 0);
  let end = text.indexOf('{', start), depth = 0;
  do { if (text[end] === '{') depth++; if (text[end] === '}') depth--; end++; }
  while (depth && end < text.length);
  assert.equal(depth, 0);
  return text.slice(start, end);
}
const coefficientFunction = functionText(read('Fil12But.cpp'), 'void PT_DECLSPEC filtDesign2ndButHighPass');
// Auralp32.c compiles as C: sin takes double. C++ harness overloads would
// otherwise select sinf(float), changing the original numerical semantics.
const clarityBody = between(read('Auralp32.c'), 'filtH1 = s->out1_minus1', 'kerWetDry(in1').replace(/sin\(filtH([12])\)/g,'sin((double)filtH$1)');
const wetDryMacro = between(read('kerdelay.h'), '#define kerWetDry(', '/*\n * MACRO: kerFilteredFdbkDelay').trim();
const wideBody = between(read('Wide32.c'), 'mono_signal = (in1 + in2)', 'if (!(s->stereo_in_flag))');
const wideGains = between(read('Wide32.c'), 'gainFactorSide = 1 +', 'for (int i = 0;');
const nativeSource = `// Test harness using AGPL-3.0-or-later FxSound source excerpts.
#include <cmath>
#include <cstdio>
#include <cstdlib>
using realtype = float;
#define PT_DECLSPEC
${coefficientFunction}
${wetDryMacro}
struct State {
 float gain, a1, a0, wet_gain=.377953f, dry_gain=.622047f, intensity;
 float out1_minus1=0, out1_minus2=0, in1_minus1=0, in1_minus2=0;
 float out2_minus1=0, out2_minus2=0, in2_minus1=0, in2_minus2=0;
 int stereo_in_flag=1;
};
int main(int argc, char** argv) {
 if (argc != 7) return 2;
 FILE* input=fopen(argv[1],"rb"); FILE* output=fopen(argv[2],"wb");
 if (!input || !output) return 3;
 float rate=(float)atof(argv[3]), period=1.0f/rate;
 float minimum=(float)(2*3.14159265358979323846)*500.0f*period;
 float maximum=(float)(2*3.14159265358979323846)*10000.0f*period;
 float factor=(float)pow((double)(maximum/minimum),1.0/127);
 float omega=minimum;
 for (int i=0;i<53;i++) omega*=factor;
 State state; State* s=&state;s->stereo_in_flag=atoi(argv[6])?0:1;
 filtDesign2ndButHighPass(omega,&s->gain,&s->a1,&s->a0);
 float coefficients[]={s->gain,s->a1,s->a0}; fwrite(coefficients,4,3,output);
 float drive=(float)atof(argv[4]), even=0.0f, odd=1.5f;
 s->intensity=(float)atof(argv[5]);
 float gainFactorSide,gainFactorCompensation;
 ${wideGains}
 float pair[2];
 while (fread(pair,4,2,input)==2) {
  float in1=pair[0],in2=pair[1],out1=0,out2=0;
  float odd1,odd2,even1,even2,filtH1,filtH2;
  ${clarityBody}
  kerWetDry(in1,in2,&s->wet_gain,&s->dry_gain,out1,out2);
  in1=s->stereo_in_flag?out1:out1+out2; in2=s->stereo_in_flag?out2:in1;
  float mono_signal,l_minus_mono,r_minus_mono;
  ${wideBody}
  if(!s->stereo_in_flag){out1*=.5f;out2*=.5f;out1+=out2;}
  pair[0]=out1; pair[1]=out2; fwrite(pair,4,2,output);
 }
 fclose(input); fclose(output); return 0;
}
`;
fs.writeFileSync(path.join(artifacts, 'oracle.cpp'), nativeSource);
const vswhere = 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe';
const installation = execFileSync(vswhere, ['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'], {encoding:'utf8'}).trim();
assert.ok(installation, 'MSVC installation required for the upstream reference test');
const build = `@echo off\r\ncall "${installation}\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul\r\nif errorlevel 1 exit /b 1\r\ncl /nologo /EHsc /fp:strict /Od oracle.cpp /Fe:oracle.exe\r\n`;
fs.writeFileSync(path.join(artifacts, 'build.cmd'), build);
execFileSync('cmd.exe', ['/d','/c','build.cmd'], {cwd:artifacts, stdio:'pipe'});
let random = 9183;
const input = new Float32Array(16384);
for (let frame=0;frame<input.length/2;frame++) {
  random=(Math.imul(random,1664525)+1013904223)>>>0;
  input[2*frame] = frame < 16 ? (frame===0 ? 1:0) : (random/4294967296*2-1)*.8;
  input[2*frame+1] = frame < 16 ? 0 : Math.sin(frame*.37)*.65;
}
fs.writeFileSync(path.join(artifacts,'input.f32'),Buffer.from(input.buffer));
let worst = 0;
for (const rate of [32000,44100,48000,96000]) for (const [drive,intensity] of [[0,0],[3.39292,0],[.339292,.07],[3.39292,.7]]) for(const mono of [false,true]) {
  execFileSync(path.join(artifacts,'oracle.exe'),['input.f32','output.f32',String(rate),String(drive),String(intensity),mono?'1':'0'],{cwd:artifacts});
  const bytes=fs.readFileSync(path.join(artifacts,'output.f32'));
  const actual=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const coefficients=Object.values(clarityCoefficients(rate));
  coefficients.forEach((value,index)=>assert.equal(value,actual[index],`Native coefficient ${index} at ${rate}`));
  const clarity=new Clarity(rate), pair=new Float32Array(2);
  for(let i=0;i<input.length;i+=2) {
    const left=clarity.processSample(input[i],0,drive);
    widenStereo(left,mono?left:clarity.processSample(input[i+1],1,drive),intensity,pair);
    if(mono)pair[0]=Math.fround(Math.fround(pair[0]*.5)+Math.fround(pair[1]*.5));
    for(let channel=0;channel<(mono?1:2);channel++) {
      const difference=Math.abs(pair[channel]-actual[3+i+channel]);
      worst=Math.max(worst,difference);
      assert.ok(difference<2e-6,`Native sample mismatch: rate=${rate}, frame=${i/2}, channel=${channel}, difference=${difference}`);
    }
  }
}
console.log(`FxSound native clarity + stereo reference: 32 mono/stereo cases passed, maximum sample error ${worst}`);
