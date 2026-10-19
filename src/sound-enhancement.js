(function (root) {
  const frequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const frequencyRanges = frequencies.map((frequency, i) => [
    i ? Math.ceil(Math.sqrt(frequencies[i - 1] * frequency)) : 20,
    i < frequencies.length - 1 ? Math.floor(Math.sqrt(frequency * frequencies[i + 1])) : 20000
  ]);
  const presets = {
    flat: { name: '默认', eq: [0,0,0,0,0,0,0,0,0,0], bass: 0, clarity: 0, dynamics: 0 },
    recommended: { name: '作者推荐', eq: [2,2,1.5,1,0,0,0,0,.5,1],
      centers: [31,63,109,267,354,1000,2000,4000,8600,16000],
      clarity: .4, ambience: 18, surround: 13, dynamics: 15, bass: .6 }
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  function normalize(value = {}) {
    value ||= {};
    return { enabled: value.enabled === true, preset: presets[value.preset] || /^user-[a-z0-9-]+$/.test(value.preset) ? value.preset : 'custom',
      centers: frequencies.map((frequency, i) => {
        const valueHz = Number(value.centers?.[i]);
        return Number.isFinite(valueHz) && valueHz > 0 ? clamp(Math.round(valueHz), ...frequencyRanges[i]) : frequency;
      }),
      eq: frequencies.map((_, i) => clamp(value.eq?.[i], -12, 12)),
      bass: clamp(value.bass, 0, 6), clarity: clamp(value.clarity, 0, 4),
      ambience: clamp(value.ambience, 0, 100), surround: clamp(value.surround, 0, 100),
      dynamics: clamp(value.dynamics, 0, 100) };
  }
  function create(context, source, destination) {
    const chain = new AudioWorkletNode(context,'fxsound-chain', {
      numberOfInputs:1,numberOfOutputs:1,channelCount:8,channelCountMode:'clamped-max'
    });
    source.connect(chain).connect(destination);
    function set(parameter,value) {
      parameter.cancelScheduledValues(context.currentTime);
      parameter.setValueAtTime(value,context.currentTime);
    }
    return {
      update(settings, compare = false, immediate = false) {
        const state = normalize(settings);
        frequencies.forEach((_, i) => {
          set(chain.parameters.get(`gain${i}`), state.eq[i]);
          set(chain.parameters.get(`frequency${i}`), state.centers[i]);
        });
        const core=root.FxSoundCore;
        set(chain.parameters.get('bass'), core.normalizedToMidi(state.bass / 6));
        set(chain.parameters.get('clarity'), core.clarityDrive(core.normalizedToMidi(state.clarity / 4)));
        set(chain.parameters.get('surround'), core.surroundIntensity(core.normalizedToMidi(state.surround / 100)));
        // The native button is driven by the raw control, independently of MIDI
        // rounding. Tiny positive values can enable a stage with MIDI zero.
        set(chain.parameters.get('clarityOn'),state.clarity>0?1:0);
        set(chain.parameters.get('surroundOn'),state.surround>0?1:0);
        set(chain.parameters.get('bassOn'),state.bass>0?1:0);
        // Native control uses MIDI steps and bypasses ambience at 12 or below.
        set(chain.parameters.get('ambience'), core.normalizedToMidi(state.ambience / 100));
        set(chain.parameters.get('dynamics'), core.dynamicsGain(core.dynamicMidi(core.normalizedToMidi(state.dynamics / 100))));
        const active = state.enabled && !compare;
        // Native global bypass skips EQ/effects entirely: undelayed signal and
        // frozen histories, resumed only when processing is enabled again.
        set(chain.parameters.get('bypass'),active?0:1);
        return { active };
      }
    };
  }
  const modules = new WeakMap();
  function prepare(context) {
    if (!modules.has(context)) {
      const url = URL.createObjectURL(new Blob([`(${root.FxSoundCoreModule.toString()})(globalThis);`], {type: 'text/javascript'}));
      modules.set(context, context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)));
    }
    return modules.get(context);
  }
  root.MedoSound = { frequencies, frequencyRanges, presets, normalize, prepare, create };
})(typeof window === 'undefined' ? globalThis : window);
