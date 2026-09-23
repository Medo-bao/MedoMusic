// Adapt existing original-source oracle statements to persistent C++ kernels.
// Only harness I/O/lifetime changes; the numerical loops remain upstream code.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=function nativeKernels(artifacts){
 const read=name=>fs.readFileSync(path.join(artifacts,name,'oracle.cpp'),'utf8');
 const cut=(s,a,b)=>{const x=s.indexOf(a),y=s.indexOf(b,x);assert.ok(x>=0&&y>x,`${a} / ${b}`);return s.slice(x,y);};
 const prefix=s=>s.slice(0,s.indexOf('int main(')).replace(/^#include[^\n]*\n/gm,'');
 const wrap=(name,header,fields,init,body)=>`namespace ${name}{\n${header}\nstruct Kernel{${fields}\n${init}\nvoid process(float* pair,bool mono,float amount,int midi){${body}}\n};\n}\n`;
 const c=read('fxsound-reference');
 const ci=cut(c,'float rate=(float)atof','float coefficients[]').replace('float rate=(float)atof(argv[3]), period=1.0f/rate;','float period=1.0f/rate;').replace('State state; State* s=&state;s->stereo_in_flag=atoi(argv[6])?0:1;','State* s=&state;');
 const cb=cut(c,'float in1=pair[0]','float mono_signal,l_minus_mono');
 let code=wrap('aural',prefix(c),'State state;',`Kernel(float rate){${ci}}`, `auto* s=&state;s->stereo_in_flag=!mono;float drive=amount,even=0,odd=1.5f;${cb}pair[0]=in1;pair[1]=in2;`);
 const wg=cut(c,'gainFactorSide =','float pair[2];');
 const wb=cut(c,'float mono_signal,l_minus_mono','pair[0]=out1; pair[1]=out2;');
 code+=`namespace wide{void process(float* pair,bool mono,float amount){struct {float intensity;int stereo_in_flag;}state{amount,!mono};auto* s=&state;float gainFactorSide,gainFactorCompensation;${wg}float in1=pair[0],in2=mono?pair[0]:pair[1],out1=0,out2=0;${wb}pair[0]=out1;pair[1]=out2;}}\n`;
 const r=read('fxsound-reverb');
 const ri=cut(r,'float r_samp_freq=(float)atof','float length=(float)s->MasterLen;')
  .replace('float r_samp_freq=(float)atof(argv[3]),r_roomsize;','float r_roomsize;')
  .replace('dspLexStructType state={}; auto* s=&state;','auto* s=&state;')
  .replace('atoi(argv[5])?0:1','1')
  .replace('std::vector<float> memory((int)(r_samp_freq*3)+LEX_NUM_OSC_PTS);','memory.resize((int)(r_samp_freq*3)+LEX_NUM_OSC_PTS);');
 const rb=cut(r,'float in1=pair[0]','fwrite(pair,4,2,output);');
 code+=wrap('room',prefix(r),'dspLexStructType state={};std::vector<float> memory;',`Kernel(float r_samp_freq,const float* values){${ri}}
 void parameters(const float* values){state.decay=values[5];state.lat6_coeff=values[6];state.wet_gain=values[7];state.dry_gain=values[8];}`,`auto* s=&state;s->stereo_in_flag=!mono;${rb}`);
 const b=read('fxsound-bass');
 const bi=cut(b,'for(int index=0;index<128;index++)','float pair[2];').replace('fwrite(coefficients,4,4,output);','');
 const bb=cut(b,'out1 = s->in1_w1','\n}\n  frame++;');
 code+=wrap('bass',prefix(b),'State state;float table[128][4];',`Kernel(float rate){auto* s=&state;int midi=0;${bi}}`, `auto* s=&state;s->stereo_in_flag=!mono;s->b0=table[midi][0];s->b1=table[midi][1];s->b2=table[midi][2];s->a2=table[midi][3];float in1=pair[0],in2=pair[1],out1=0,out2=0;${bb}pair[0]=out1;pair[1]=out2;`);
 const m=read('fxsound-maximizer');
 const mi=cut(m,'float r_samp_freq=(float)atof','float coefficients[]=')
  .replace('float r_samp_freq=(float)atof(argv[3]); State state; State* s=&state;s->stereo_in_flag=atoi(argv[6])?0:1;','State* s=&state;')
  .replace('(float)atof(argv[4])','1').replace('(float)atof(argv[5])','nativeRelease(r_samp_freq)');
 const mb=cut(m,'float in1=pair[0]','fwrite(pair,4,2,output);');
 code+=wrap('maxi',prefix(m),'State state;',`Kernel(float r_samp_freq){${mi}}`,`auto* s=&state;s->stereo_in_flag=!mono;s->gain_boost=amount;float peak_in1=0,peak_in2=0,peak_out1=0,peak_out2=0;${mb}`);
 const e=read('fxsound-eq');
 const ei=cut(e,'double ratio=pow','float pair[8];').replace('fwrite(coefficients,4,4,output);','');
 const stereo=cut(e.slice(e.indexOf('// Freeze every section')),'for (i = 0; i < cast_handle->num_active_sections; i++)','}\n  frame++;pair[0]');
 const right=cut(stereo,'out2 = s->state3','\n                }');
 const stereoBody=stereo.replace(right,`if(channels==2){${right}}`);
 const originalSos=fs.readFileSync(path.join(artifacts,'../reference/fxsound/SosProcess.cpp'),'utf8');
 const surround=cut(originalSos,'//Ordering for 5.1 is:','\n    applyVolumeLeveling(cast_handle, rp_out_buf, i_num_sample_sets, i_num_channels, r_samp_freq, 3);');
 code+=`namespace equalizer{${prefix(e)}
 struct Kernel{State state;Kernel(float rate,const float* values){update(rate,values);}
 void update(float rate,const float* values){${ei}}
 void process(float* buffer,int frames,int channels){
 auto* cast_handle=&state;int i,j,k,active_flag;Section* s;
 if(channels==6 || channels==8){auto* rp_in_buf=buffer;auto* rp_out_buf=buffer;int i_num_sample_sets=frames,i_num_channels=channels;${surround}}
 else if(channels<=2){for(int frame=0;frame<frames;frame++){
 float in1=buffer[frame*channels],in2=channels==2?buffer[frame*channels+1]:0,out1=in1,out2=in2;
 ${stereoBody}
 buffer[frame*channels]=out1;if(channels==2)buffer[frame*channels+1]=out2;
 }}
 }};}
 `;
 return code;
};
