/*
 * FxSound algorithm port, based on FxSound LLC sources (C) 2025.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Source revision: d8e7a23d37ed5939c2a3090a1c1756c7f2500b17
 * See tests/reference/fxsound/README.md and LICENSE for provenance.
 * This module is not yet the complete FxSound processing chain.
 */
(function installFxSound(root) {
  const f = Math.fround;
  function internalRateRatio(rate) { return rate>48000?(rate<192000?2:4):1; }
  function normalizedToMidi(value) {
    return Math.trunc(f(f(f(Math.max(0,Math.min(1,value))) * 127) + f(.5)));
  }
  function linearMidi(maximum,midi) {
    maximum=f(maximum);
    return midi===127?maximum:f(f(maximum/127)*midi);
  }
  function clarityDrive(midi) {
    return linearMidi(f(f(2*Math.PI/4*1.8*2*.75)*f(.8)),midi);
  }
  function surroundIntensity(midi) { return linearMidi(f(.7),midi); }
  // DFX 13+ only exposes Music2. Keep the communication-layer warp separate
  // from the stage's own MIDI quantizer so both are independently testable.
  function ambienceMidi(midi) { return Math.trunc(f(midi)*.34); }
  function dynamicMidi(midi) { return Math.min(127,Math.trunc(f(midi*f(1.8)))); }
  function clarityCoefficients(sampleRate) {
    // Qnt2But.cpp ignores its response-type argument: tuning is exponential.
    const period = f(1 / sampleRate);
    const minimum = f(f(f(2 * Math.PI) * 500) * period);
    const maximum = f(f(f(2 * Math.PI) * 10000) * period);
    const factor = f(Math.pow(f(maximum / minimum), 1 / 127));
    let omega = minimum;
    for (let i = 0; i < 53; i++) omega = f(omega * factor);
    const square = f(omega * omega);
    const damping = f(f(2 * Math.sqrt(2)) * omega);
    const scale = f(1 / f(f(4 + square) + damping));
    return {
      gain: f(4 * scale),
      a1: f(f(8 - f(2 * square)) * scale),
      a0: f(f(f(damping - 4) - square) * scale)
    };
  }
  class Clarity {
    constructor(sampleRate) {
      this.coefficients = clarityCoefficients(sampleRate);
      this.history = [new Float32Array(4), new Float32Array(4)];
    }
    reset() { for (const state of this.history) state.fill(0); }
    processSample(input, channel, drive) {
      const x = f(input), h = this.history[channel], c = this.coefficients;
      const feedback = f(f(h[2] * c.a1) + f(h[3] * c.a0));
      const feedforward = f(f(f(f(x + f(1e-30)) - f(2 * h[0])) + h[1]) * c.gain);
      const high = f(feedback + feedforward);
      h[3] = h[2]; h[2] = high; h[1] = h[0]; h[0] = x;
      const harmonic = f(Math.sin(f(high * f(drive))));
      const enhanced = f(x + f(f(1.5) * harmonic));
      return f(f(enhanced * f(.377953)) + f(f(.622047) * x));
    }
  }
  // Stereo case of Wide32.c; native mono routing is handled separately upstream.
  function widenStereo(left, right, intensity, output) {
    left = f(left); right = f(right); intensity = f(intensity);
    const mid = f(f(left + right) * .5);
    const sideGain = f(1 + 3 * intensity);
    const midGain = f(1 - .3 * intensity);
    const center = f(mid * midGain);
    output[0] = f(center + f(sideGain * f(left - mid)));
    output[1] = f(center + f(sideGain * f(right - mid)));
    return output;
  }
  function maximizerRelease(sampleRate) {
    const factor = f(Math.pow(f(100 / f(.1)), 1 / 127));
    let milliseconds = f(.1);
    for (let i = 0; i < 85; i++) milliseconds = f(milliseconds * factor);
    const exponent = f(1 / f(f(milliseconds * f(.001)) * f(sampleRate)));
    return f(Math.exp(-exponent));
  }
  function dynamicsGain(midi) {
    const index = Math.trunc(f(midi * f(.7)));
    const decibels = index < 60 ? f(index * f(.1))
      : index < 90 ? f(f((index - 60) * f(.2)) + 6)
      : index < 126 ? f(f((index - 90) * f(.5)) + 12) : 30;
    return f(Math.pow(10, decibels / 20));
  }
  class Maximizer {
    constructor(sampleRate, releaseBeta = maximizerRelease(sampleRate)) {
      this.delay = Math.trunc(f(f(sampleRate) * f(.00075)));
      this.releaseBeta = f(releaseBeta);
      this.maximum = f(.966051);
      this.target = f(.32);
      const cosine = Math.cos(6.283185 * .1 / sampleRate);
      const pole = 2 - cosine - Math.sqrt(cosine * cosine - 4 * cosine + 3);
      this.pole = f(pole); this.feed = f(1 - pole); this.level = 0;
      this.channels = [0, 1].map(() => ({
        buffer: new Float32Array(this.delay), index: 0,
        envelope: 0, ramp: 0, maximum: 0, delta: 0
      }));
    }
    reset() {
      this.level=0;
      for(const state of this.channels){state.buffer.fill(0);state.index=0;state.envelope=0;state.ramp=0;state.maximum=0;state.delta=0;}
    }
    processStereo(left, right, gain, output, mono = false) {
      left = f(left); right = f(right); gain = f(gain);
      this.level = f(f(this.level * this.pole) + f(f(left * left) * this.feed));
      const level = f(Math.sqrt(this.level));
      if (f(gain * level) > this.target) gain = Math.max(f(1.06), f(this.target / level));
      for (let channel = 0; channel < (mono ? 1 : 2); channel++) {
        const state = this.channels[channel], delayed = state.buffer[state.index];
        const sample = f(f(gain * this.maximum) * (channel ? right : left));
        state.buffer[state.index] = sample;
        state.index = (state.index + 1) % this.delay;
        const magnitude = Math.abs(sample);
        if (state.ramp) {
          state.envelope = Math.max(state.envelope, Math.abs(delayed));
          if (magnitude > state.maximum) {
            state.maximum = magnitude; state.ramp = this.delay;
            state.delta = Math.max(state.delta, f(f(magnitude - state.envelope) / (this.delay + 1)));
          } else state.ramp--;
          state.envelope = f(state.envelope + state.delta);
        } else {
          state.envelope = f(f(state.envelope * this.releaseBeta) + f(1e-24));
          state.envelope = Math.max(state.envelope, Math.abs(delayed));
          if (magnitude > state.envelope) {
            state.maximum = magnitude;
            state.delta = f(f(magnitude - state.envelope) / (this.delay + 1));
            state.envelope = f(state.envelope + state.delta);
            state.ramp = this.delay;
          }
        }
        output[channel] = state.envelope > this.maximum
          ? f(f(delayed * this.maximum) / state.envelope) : delayed;
      }
      return output;
    }
  }
  function parametricCoefficients(sampleRate, frequency, gain, quality) {
    const pi=f(Math.PI), twoPi=f(2*Math.PI);
    gain=f(gain); frequency=f(frequency); sampleRate=f(sampleRate); quality=f(quality);
    if (!gain) return {b0:1,b1:0,b2:0,a2:0};
    // Native scale macros expand as multiply then divide (no outer grouping).
    // Precomputing the ratio changes float32 rounding at low boost values.
    if(frequency<60) quality=Math.min(quality,f(f(f(f(frequency-20)*19)/40)+1));
    if(Math.abs(gain)<6) quality=Math.min(quality,f(f(f(Math.abs(gain)*f(20-f(.2)))/6)+f(.2)));
    const center=f(frequency/sampleRate), bandwidth=f(center/quality);
    const a=f(Math.tan(f(pi*f(center-f(.25))))), asq=f(a*a);
    const A=f(Math.pow(10,f(gain/20)));
    const F=Math.abs(gain)<6?f(Math.sqrt(A)):A>1?f(A/f(Math.sqrt(2))):f(A*f(Math.sqrt(2)));
    const T=f(Math.tan(f(twoPi*bandwidth))), a4=f(asq*asq);
    let d=f(f(2*asq)*T);
    const sn=f(f(1+a4)*T), cs=f(1-a4), magnitude=f(Math.sqrt(f(f(sn*sn)+f(cs*cs))));
    d=f(d/magnitude);
    const delta=f(Math.atan2(sn,cs)), asnd=f(Math.asin(d));
    let theta=f(f(.5)*f(f(pi-asnd)-delta));
    const principal=f(f(.5)*f(asnd-delta));
    if(principal>0 && principal<theta) theta=principal;
    if(bandwidth>=.5) theta=f(.005);
    const angle=f(theta/twoPi), C=f(1/f(Math.tan(f(twoPi*angle))));
    const F2=f(F*F), difference=f(f(A*A)-F2);
    const alphad=Math.abs(difference)<=1.65436e-24?C:f(Math.sqrt(f(f(f(C*C)*f(F2-1))/difference)));
    const alphan=f(A*alphad), plus=f(1+asq), minus=f(1-asq);
    const a0=f(plus+f(alphad*minus)), reciprocal=f(1/a0);
    return {b0:f(f(plus+f(alphan*minus))*reciprocal), b1:f(f(4*a)*reciprocal),
      b2:f(f(plus-f(alphan*minus))*reciprocal), a2:f(f(plus-f(alphad*minus))*reciprocal)};
  }
  class Equalizer {
    constructor(sampleRate) {
      this.sampleRate=sampleRate;
      // GraphicEqReSetAllBandFreqs sets this range for its ten-band mode;
      // editing individual center frequencies does not recalculate Q.
      const ratio=Math.pow(16000/62.5,1/9);
      this.quality=Math.max(1,f(Math.sqrt(ratio)/(ratio-1)));
      this.coefficients=Array(10).fill(null);
      this.centers=new Float32Array(10);this.gains=new Float32Array(10);
      // Stereo and surround use separate histories in the original SOS structure.
      this.state=new Float32Array(200);
    }
    setBand(index,frequency,gain) {
      frequency=f(frequency);gain=f(gain);
      if(this.centers[index]===frequency && this.gains[index]===gain) return;
      this.centers[index]=frequency;this.gains[index]=gain;
      this.coefficients[index]=!gain || f(frequency*2)>=this.sampleRate ? null
        :parametricCoefficients(this.sampleRate,frequency,gain,this.quality);
    }
    processSample(input,channel,channelCount=2) {
      // Native surround SOS reserves the lowest two sections for LFE.
      const surround=channelCount===6 || channelCount===8;
      const start=surround && channel!==3 ? 2 : 0;
      const end=surround && channel===3 ? 2 : 10;
      for(let band=start;band<end;band++) {
        const c=this.coefficients[band];if(!c)continue;
        const i=(surround ? 40+band*16 : band*4)+channel*2, s=this.state;
        const output=f(f(s[i]+f(c.b0*input))+f(1e-30));
        s[i]=f(f(f(input-output)*c.b1)+s[i+1]);
        s[i+1]=f(f(c.b2*input)-f(c.a2*output));input=output;
      }
      return input;
    }
  }
  class Bass {
    constructor(sampleRate) {
      this.table=Array.from({length:128},(_,midi)=>parametricCoefficients(sampleRate,90,f(midi*f(15/127)),2.5));
      this.state=new Float32Array(4);
    }
    reset() { this.state.fill(0); }
    processSample(input, channel, midi, enabled = midi !== 0) {
      if(!enabled) return input;
      const c=this.table[midi], index=channel*2, state=this.state;
      const output=f(state[index]+f(c.b0*f(input+f(1e-30))));
      state[index]=f(f(f(input-output)*c.b1)+state[index+1]);
      state[index+1]=f(f(c.b2*input)-f(c.a2*output));
      return output;
    }
  }
  function exponentialMidi(minimum, maximum, midi) {
    let value = f(minimum);
    if (midi === 127) return f(maximum);
    const factor = f(Math.pow(f(f(maximum) / value), 1 / 127));
    for (let index=0;index<midi;index++) value = f(value * factor);
    return value;
  }
  function reverbParameters(sampleRate, midi) {
    const roomsize = f(f(.5) + f(f(1 / 127) * 64));
    function lowpass(index) {
      const frequency = f(exponentialMidi(1,20,index) * 1000);
      const omega = f(f(f(2 * Math.PI) * frequency) * f(1 / sampleRate));
      const cosine = f(Math.cos(omega));
      const root = f(Math.sqrt(f(f(f(cosine * cosine) - f(4 * cosine)) + 3)));
      return f(f(2 - cosine) - root);
    }
    const bandwidth=lowpass(89), damping=lowpass(81);
    const decay=f(Math.pow(exponentialMidi(.095,.95,midi),roomsize));
    return {roomsize, bandwidth, oneMinusBandwidth:f(1-bandwidth), damping,
      oneMinusDamping:f(1-damping), decay, lat6:Math.min(.5,Math.max(.25,f(decay+f(.15)))),
      wet:midi>40?f(.273):f((midi-12)*(1/28)*(.21*1.3)),
      dry:midi>40?f(.897):f(f(.897)+f(f((40-midi)*(1/28))*f(1-.897)))};
  }
  class Reverb {
    constructor(sampleRate, parameters) {
      this.parameters = Object.fromEntries(Object.entries(parameters).map(([key,value])=>[key,f(value)]));
      const size = f(f(parameters.roomsize) * f(sampleRate));
      const fixed = ms => Math.trunc(f(f(sampleRate) * f(ms / 1000)));
      const scaled = ms => Math.trunc((ms / 1000) * size);
      this.pre = fixed(100);
      this.diffusers = [4.77,3.595,12.73,9.31].map(fixed);
      this.lat5 = scaled(22.6); this.lat7 = scaled(30.5);
      this.lat5Max = this.lat5 + fixed(2) + 1;
      this.lat7Max = this.lat7 + fixed(2) + 1;
      this.d1 = [10.1,66.9,121.9,149.6].map(scaled);
      this.d2 = [35.8,89.8,125].map(scaled);
      this.d3 = [10.1,70.9,99.9,141.7].map(scaled);
      this.d4 = [4.065,67.1,106.3].map(scaled);
      this.lat6 = [6.28,41.26,60.5].map(scaled);
      this.lat8 = [11.25,64.3,89.2].map(scaled);
      const length = this.pre + this.diffusers.reduce((sum,x)=>sum+x,0)
        + this.lat5Max + this.d1[3] + this.lat6[2] + this.d2[2]
        + this.lat7Max + this.d3[3] + this.lat8[2] + this.d4[2];
      this.memory = new Float32Array(length);
      this.pointer = 0; this.next = 0; this.band = 0;
      this.damp1 = 0; this.damp2 = 0; this.feedback = 0;
      this.taps = new Float32Array(4);
    }
    reset() {
      this.memory.fill(0);this.taps.fill(0);
      this.pointer=0;this.next=0;this.band=0;this.damp1=0;this.damp2=0;this.feedback=0;
    }
    advance(length) {
      this.pointer += length;
      if (this.pointer >= this.memory.length) this.pointer -= this.memory.length;
    }
    read(delay) {
      let index = this.pointer - delay;
      if (index < 0) index += this.memory.length;
      return this.memory[index];
    }
    write(value) {
      this.next = this.memory[this.pointer];
      this.memory[this.pointer] = value;
    }
    allpass(input, length, coefficient) {
      this.advance(length);
      const delayed = this.next;
      const value = f(input - f(coefficient * delayed));
      this.write(value);
      return f(delayed + f(coefficient * value));
    }
    decayDiffuser(input, maximum, delay) {
      this.advance(maximum);
      const delayed = this.read(delay), value = f(input + f(f(.7) * delayed));
      this.write(value);
      return f(delayed - f(f(.7) * value));
    }
    delayTaps(input, delays) {
      this.advance(delays[delays.length-1]);
      this.taps[delays.length-1] = this.next;
      this.write(input);
      for (let i=0;i<delays.length-1;i++) this.taps[i] = this.read(delays[i]);
    }
    processStereo(left, right, output, mono = false) {
      const p = this.parameters;
      left = f(f(left) + f(1e-36)); right = f(f(right) + f(1e-36));
      this.advance(this.pre + 1);
      let b = this.read(1); this.write(f(left + right));
      let a = f(f(b * p.oneMinusBandwidth) + f(p.bandwidth * this.band));
      this.band = a;
      b = this.allpass(a,this.diffusers[0],f(.75));
      a = this.allpass(b,this.diffusers[1],f(.75));
      b = this.allpass(a,this.diffusers[2],f(.625));
      const diffuse = this.allpass(b,this.diffusers[3],f(.625));
      b = f(diffuse + f(p.decay * this.feedback));
      a = this.decayDiffuser(b,this.lat5Max,this.lat5);
      this.delayTaps(a,this.d1);
      let out1 = -this.taps[1], out2 = f(this.taps[0] + this.taps[2]);
      a = f(f(this.taps[3] * p.oneMinusDamping) + f(p.damping * this.damp1));
      this.damp1 = a;
      b = this.allpass(f(a * p.decay),this.lat6[2],p.lat6);
      out1 = f(out1 - this.read(this.lat6[0]));
      out2 = f(out2 - this.read(this.lat6[1]));
      this.delayTaps(b,this.d2);
      out1 = f(out1 - this.taps[0]); out2 = f(out2 + this.taps[1]);
      b = f(diffuse + f(p.decay * this.taps[2]));
      a = this.decayDiffuser(b,this.lat7Max,this.lat7);
      this.delayTaps(a,this.d3);
      out1 = f(out1 + f(this.taps[0] + this.taps[2])); out2 = f(out2 - this.taps[1]);
      a = f(f(this.taps[3] * p.oneMinusDamping) + f(p.damping * this.damp2));
      this.damp2 = a;
      b = this.allpass(f(a * p.decay),this.lat8[2],p.lat6);
      out1 = f(out1 - this.read(this.lat8[1])); out2 = f(out2 - this.read(this.lat8[0]));
      this.delayTaps(b,this.d4);
      out1 = f(out1 + this.taps[1]); out2 = f(out2 - this.taps[0]); this.feedback = this.taps[2];
      out1=f(out1*f(.3));out2=f(out2*f(.3));
      if(mono){out1=f(out1*f(.5));out2=f(out2*f(.5));right=0;}
      output[0] = f(f(out1 * p.wet) + f(p.dry * left));
      output[1] = f(f(out2 * p.wet) + f(p.dry * right));
      if(mono)output[0]=f(output[0]+output[1]);
      return output;
    }
  }
  // One buffer-level chain keeps the native silence gate shared by all stages.
  class Chain {
    constructor(sampleRate) {
      this.ratio=internalRateRatio(sampleRate);this.rate=sampleRate/this.ratio;
      this.eq=new Equalizer(sampleRate);this.channels=0;this.groups=[];
      this.reverbTable=Array.from({length:128},(_,midi)=>reverbParameters(this.rate,ambienceMidi(midi)));
      // Prepare every native handle before playback. A format switch only clears
      // histories; it must not rebuild coefficient tables on the audio thread.
      this.pool=['front','center','sub','rear','side'].map(role=>({role,offset:0,count:2,
        clarity:new Clarity(this.rate),bass:new Bass(this.rate),
        reverb:new Reverb(this.rate,this.reverbTable[0]),maximizer:new Maximizer(this.rate),pair:new Float32Array(2)}));
      const [front,center,sub,rear,side]=this.pool;
      center.offset=2;center.count=1;sub.offset=3;sub.count=1;side.offset=6;
      this.layouts={1:[front],2:[front],4:[front,rear],6:[front,center,sub,rear],8:[front,center,sub,rear,side]};
      this.unsupported=[];
    }
    configureChannels(channels) {
      this.channels=channels;
      for(const group of this.pool){group.clarity.reset();group.bass.reset();group.reverb.reset();group.maximizer.reset();group.pair.fill(0);}
      this.pool[0].count=channels===1?1:2;this.pool[3].offset=channels===4?2:4;
      this.groups=this.layouts[channels]||this.unsupported;
    }
    process(input,output,settings) {
      const channels=output.length,frames=output[0].length;
      const equalize=channels===1 || channels===2 || channels===6 || channels===8;
      if(input.length && this.channels!==channels)this.configureChannels(channels);
      for(let channel=0;channel<channels;channel++)for(let i=0;i<frames;i++){
        const value=input[channel]?.[i]||0;
        // dfxpModifyRealtypeSamples skips GraphicEq for quad input.
        output[channel][i]=settings.bypass || !equalize ? value : this.eq.processSample(value,channel,channels);
      }
      if(settings.bypass)return;
      for(const group of this.groups){
        const {offset,count,role,pair}=group,mono=count===1;
        let active=role==='front';
        for(let channel=offset;!active && channel<offset+count;channel++)
          for(let i=0;i<frames;i++)if(output[channel][i]!==0){active=true;break;}
        if(!active)continue;
        group.reverb.parameters=this.reverbTable[settings.ambience];
        const processedFrames=frames-frames%this.ratio;
        for(let i=0;i<frames;i++){
          // Comwave repeats the last complete sample set for a partial group.
          if(i%this.ratio || i>=processedFrames){for(let c=offset;c<offset+count;c++)output[c][i]=output[c][i-1];continue;}
          let left=output[offset][i],right=mono?left:output[offset+1][i];
          if(role!=='sub' && settings.clarityOn){
            left=group.clarity.processSample(left,0,settings.clarity);
            if(!mono)right=group.clarity.processSample(right,1,settings.clarity);
          }
          if(role!=='sub' && settings.ambience>12){
            group.reverb.processStereo(left,mono?left:right,pair,mono);left=pair[0];if(!mono)right=pair[1];
          }
          if(role!=='sub' && role!=='center' && settings.surroundOn){
            widenStereo(left,mono?left:right,settings.surround,pair);
            left=mono?f(f(pair[0]*f(.5))+f(pair[1]*f(.5))):pair[0];if(!mono)right=pair[1];
          }
          // The live front write enables bass in surround too (the older
          // front-only-in-stereo expression in dfxpComm is commented out).
          if((role==='front' || role==='sub') && settings.bassOn){
            left=group.bass.processSample(left,0,settings.bass,true);
            if(!mono)right=group.bass.processSample(right,1,settings.bass,true);
          }
          group.maximizer.processStereo(left,right,settings.dynamics,pair,mono);
          output[offset][i]=pair[0];if(!mono)output[offset+1][i]=pair[1];
        }
      }
    }
  }
  const api = { Chain, clarityCoefficients, Clarity, widenStereo, Maximizer, maximizerRelease, dynamicsGain, Reverb, reverbParameters, parametricCoefficients, Bass, Equalizer, normalizedToMidi, clarityDrive, surroundIntensity, ambienceMidi, dynamicMidi, internalRateRatio };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FxSoundCore = api;
  root.FxSoundCoreModule = installFxSound;
  if (typeof AudioWorkletProcessor !== 'undefined') {
class FxSoundStage extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'amount', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'a-rate' },
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'effectOn', defaultValue: -1, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'ambience', defaultValue: 0, minValue: 0, maxValue: 127, automationRate: 'k-rate' },
      { name: 'bass', defaultValue: 0, minValue: 0, maxValue: 127, automationRate: 'k-rate' }];
  }
  constructor(options) {
    super();
    this.kind = options.processorOptions.kind;
    this.ratio=FxSoundCore.internalRateRatio(sampleRate);
    const rate=sampleRate/this.ratio;
    this.rate=rate;this.channelCount=0;
    this.clarity = new FxSoundCore.Clarity(rate);
    this.maximizer = this.kind === 'maximizer' ? new FxSoundCore.Maximizer(rate) : null;
    this.bass = this.kind === 'bass' ? new FxSoundCore.Bass(rate) : null;
    if (this.kind === 'reverb') {
      this.reverbTable = Array.from({length:128},(_,midi)=>FxSoundCore.reverbParameters(rate,FxSoundCore.ambienceMidi(midi)));
      this.reverb = new FxSoundCore.Reverb(rate,this.reverbTable[0]);
    }
    this.stereo = new Float32Array(2);
  }
  process(inputs, outputs, parameters) {
    const input=inputs[0],output=outputs[0],mono=output.length===1;
    if(input.length){
      if(this.channelCount && this.channelCount!==output.length){
        // dfxpBeginProcess reloads effect parameters/memory on format changes;
        // the external GraphicEq handle retains its own section histories.
        this.clarity=new FxSoundCore.Clarity(this.rate);
        if(this.bass)this.bass=new FxSoundCore.Bass(this.rate);
        if(this.maximizer)this.maximizer=new FxSoundCore.Maximizer(this.rate);
        if(this.reverb)this.reverb=new FxSoundCore.Reverb(this.rate,this.reverbTable[0]);
      }
      this.channelCount=output.length;
    }
    if(parameters.bypass[0]>=.5){
      for(let channel=0;channel<output.length;channel++)for(let i=0;i<output[channel].length;i++)output[channel][i]=(input[channel]||input[0])?.[i]||0;
      return true;
    }
    const ambience=Math.round(parameters.ambience[0]),bassMidi=Math.round(parameters.bass[0]),effectOn=parameters.effectOn[0],amount=parameters.amount;
    if(this.reverb)this.reverb.parameters=this.reverbTable[ambience];
    for(let i=0;i<output[0].length;i++){
      if(i%this.ratio){
        for(let channel=0;channel<output.length;channel++)output[channel][i]=output[channel][i-1];
        continue;
      }
      const left=input[0]?.[i]||0,right=(input[1]||input[0])?.[i]||0,value=amount.length===1?amount[0]:amount[i];
      const pair=this.stereo;pair[0]=left;pair[1]=right;
      if(this.bass){
        const enabled=effectOn<0?bassMidi!==0:effectOn>=.5;
        pair[0]=this.bass.processSample(left,0,bassMidi,enabled);
        if(!mono)pair[1]=this.bass.processSample(right,1,bassMidi,enabled);
      }else if(this.reverb){
        if(ambience>12)this.reverb.processStereo(left,mono?left:right,pair,mono);
      }else if(this.maximizer){
        this.maximizer.processStereo(left,right,value,pair,mono);
      }else if(effectOn<0?!!value:effectOn>=.5){
        if(this.kind==='clarity'){
          pair[0]=this.clarity.processSample(left,0,value);
          if(!mono)pair[1]=this.clarity.processSample(right,1,value);
        }else{
          FxSoundCore.widenStereo(left,mono?left:right,value,pair);
          if(mono)pair[0]=f(f(pair[0]*f(.5))+f(pair[1]*f(.5)));
        }
      }
      output[0][i]=pair[0];if(!mono)output[1][i]=pair[1];
    }
    return true;
  }
}
registerProcessor('fxsound-stage', FxSoundStage);
class FxSoundEqualizer extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{name:'bypass',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'},...Array.from({length:10},(_,i)=>[
      {name:`gain${i}`,defaultValue:0,minValue:-12,maxValue:12,automationRate:'k-rate'},
      {name:`frequency${i}`,defaultValue:1000,minValue:20,maxValue:20000,automationRate:'k-rate'}
    ]).flat()];
  }
  constructor(){super();this.equalizer=new FxSoundCore.Equalizer(sampleRate);}
  process(inputs,outputs,parameters){
    const input=inputs[0],output=outputs[0];
    for(let band=0;band<10;band++)this.equalizer.setBand(band,parameters[`frequency${band}`][0],parameters[`gain${band}`][0]);
    for(let channel=0;channel<output.length;channel++)for(let i=0;i<output[channel].length;i++){
      const value=(input[channel]||input[0])?.[i]||0;
      output[channel][i]=parameters.bypass[0]>=.5?value:this.equalizer.processSample(value,channel,output.length);
    }
    return true;
  }
}
registerProcessor('fxsound-equalizer',FxSoundEqualizer);
class FxSoundChain extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [...FxSoundEqualizer.parameterDescriptors,
    ...['clarity','surround','dynamics','ambience','bass','clarityOn','surroundOn','bassOn'].map(name=>({
      name,defaultValue:name==='dynamics'?1:0,minValue:0,maxValue:127,automationRate:'k-rate'}))];}
  constructor(){super();this.chain=new FxSoundCore.Chain(sampleRate);this.settings={};}
  process(inputs,outputs,parameters){
    for(let i=0;i<10;i++)this.chain.eq.setBand(i,parameters[`frequency${i}`][0],parameters[`gain${i}`][0]);
    for(const name of ['bypass','clarity','surround','dynamics','ambience','bass','clarityOn','surroundOn','bassOn'])
      this.settings[name]=parameters[name][0];
    this.chain.process(inputs[0],outputs[0],this.settings);return true;
  }
}
registerProcessor('fxsound-chain',FxSoundChain);

  }

})(globalThis);
