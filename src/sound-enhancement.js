(function (root) {
  const frequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const frequencyRanges = frequencies.map((frequency, i) => [
    i ? Math.ceil(Math.sqrt(frequencies[i - 1] * frequency)) : 20,
    i < frequencies.length - 1 ? Math.floor(Math.sqrt(frequency * frequencies[i + 1])) : 20000
  ]);
  // Upstream keeps every effect knob on one 0-10 scale
  // (DfxDspPrivate::setEffectValue divides by 10 before the MIDI quantizer).
  // MedoMusic stores that same scale as one shared percent metric so "100%"
  // reaches the full native MIDI range for all five effects.
  const EFFECT_KEYS = ["clarity", "ambience", "surround", "dynamics", "bass"];
  const EFFECT_RANGE = { min: 0, max: 100 };
  // GraphicEqSetMasterGain and GraphicEqSetBalance document +-20 dB.
  const MASTER_GAIN_RANGE = { min: -20, max: 20 };
  const BALANCE_RANGE = { min: -20, max: 20 };
  // Application target-RMS control: 0 dBFS is the native disabled sentinel.
  const NORMALIZATION_RANGE = { min: -40, max: 0 };
  const VOLUME_LEVELING_RANGE = { min: 0, max: 4, step: .5 };
  const FORMAT_VERSION = 2;
  const presets = {
    flat: { name: '默认', eq: [0,0,0,0,0,0,0,0,0,0], clarity: 0, ambience: 0, surround: 0, dynamics: 0, bass: 0, masterGain: 0, balance: 0, normalization: 0, volumeLeveling: 0 },
    recommended: { name: '作者推荐', eq: [2,2,1.5,1,0,0,0,0,.5,1],
      centers: [31,63,109,267,354,1000,2000,4000,8600,16000],
      clarity: 10, ambience: 18, surround: 13, dynamics: 15, bass: 10, masterGain: 0, balance: 0, normalization: 0, volumeLeveling: 0 }
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  function normalize(value = {}) {
    value ||= {};
    const state = {
      formatVersion: FORMAT_VERSION,
      enabled: value.enabled === true,
      preset: presets[value.preset] || /^user-[a-z0-9-]+$/.test(value.preset) ? value.preset : 'custom',
      centers: frequencies.map((frequency, i) => {
        const valueHz = Number(value.centers?.[i]);
        return Number.isFinite(valueHz) && valueHz > 0 ? clamp(Math.round(valueHz), ...frequencyRanges[i]) : frequency;
      }),
      eq: frequencies.map((_, i) => clamp(value.eq?.[i], -12, 12))
    };
    for (const key of EFFECT_KEYS) state[key] = clamp(value[key], EFFECT_RANGE.min, EFFECT_RANGE.max);
    state.masterGain = clamp(value.masterGain, MASTER_GAIN_RANGE.min, MASTER_GAIN_RANGE.max);
    state.balance = clamp(value.balance, BALANCE_RANGE.min, BALANCE_RANGE.max);
    state.normalization = clamp(value.normalization, NORMALIZATION_RANGE.min, NORMALIZATION_RANGE.max);
    state.volumeLeveling = Math.round(clamp(value.volumeLeveling, VOLUME_LEVELING_RANGE.min, VOLUME_LEVELING_RANGE.max) / VOLUME_LEVELING_RANGE.step) * VOLUME_LEVELING_RANGE.step;
    return state;
  }
  function fromStorage(value = {}) {
    value ||= {};
    // Released 1.6.3 stored clarity in 0..4 and bass in 0..6. The unversioned
    // development build already wrote the new trim fields and percent units.
    // Only storage readers migrate; normalize always accepts current units.
    const legacy = !value.formatVersion && !Object.hasOwn(value, 'masterGain') && !Object.hasOwn(value, 'balance');
    return normalize(legacy ? { ...value,
      clarity: clamp(value.clarity, 0, 4) * 25,
      bass: clamp(value.bass, 0, 6) * (100 / 6)
    } : value);
  }
  function create(context, source, destination, onError = null) {
    const chain = new AudioWorkletNode(context,'fxsound-chain', {
      numberOfInputs:1,numberOfOutputs:1,channelCount:8,channelCountMode:'clamped-max'
    });
    // Leave the caller's dry connection intact until construction and the
    // initial parameter update have succeeded.
    try {
      chain.connect(destination);
      source.connect(chain);
    } catch (error) {
      chain.disconnect();
      throw error;
    }
    let connected = true;
    chain.onprocessorerror = () => onError?.(new Error('Sound processor stopped'));
    function set(parameter,value) {
      parameter.cancelScheduledValues(context.currentTime);
      parameter.setValueAtTime(value,context.currentTime);
    }
    return {
      dispose() {
        if (!connected) return;
        connected = false;
        chain.onprocessorerror = null;
        source.disconnect(chain);
        chain.disconnect();
      },
      update(settings, compare = false, immediate = false) {
        const state = normalize(settings);
        frequencies.forEach((_, i) => {
          set(chain.parameters.get(`gain${i}`), state.eq[i]);
          set(chain.parameters.get(`frequency${i}`), state.centers[i]);
        });
        const core=root.FxSoundCore;
        // Every effect knob now spans the full native 0-127 control range.
        const control = key => core.normalizedToMidi(state[key] / EFFECT_RANGE.max);
        set(chain.parameters.get('bass'), control('bass'));
        set(chain.parameters.get('clarity'), core.clarityDrive(control('clarity')));
        set(chain.parameters.get('surround'), core.surroundIntensity(control('surround')));
        // The native button is driven by the raw control, independently of MIDI
        // rounding. Tiny positive values can enable a stage with MIDI zero.
        set(chain.parameters.get('clarityOn'),state.clarity>0?1:0);
        set(chain.parameters.get('surroundOn'),state.surround>0?1:0);
        set(chain.parameters.get('bassOn'),state.bass>0?1:0);
        // Native control uses MIDI steps and bypasses ambience at 12 or below.
        set(chain.parameters.get('ambience'), core.normalizedToMidi(state.ambience / EFFECT_RANGE.max));
        set(chain.parameters.get('dynamics'), core.dynamicsGain(core.dynamicMidi(control('dynamics'))));
        // GraphicEq owns master gain and balance upstream; both stay k-rate.
        set(chain.parameters.get('masterGain'), state.masterGain);
        set(chain.parameters.get('balance'), state.balance);
        set(chain.parameters.get('normalization'), state.normalization);
        set(chain.parameters.get('volumeLeveling'), state.volumeLeveling);
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
      modules.set(context, context.audioWorklet.addModule(url).catch(error => {
        modules.delete(context);
        throw error;
      }).finally(() => URL.revokeObjectURL(url)));
    }
    return modules.get(context);
  }
  root.MedoSound = {
    frequencies, frequencyRanges, presets, normalize, fromStorage, FORMAT_VERSION, prepare, create,
    EFFECT_KEYS, EFFECT_RANGE, MASTER_GAIN_RANGE, BALANCE_RANGE, NORMALIZATION_RANGE, VOLUME_LEVELING_RANGE
  };
})(typeof window === 'undefined' ? globalThis : window);
