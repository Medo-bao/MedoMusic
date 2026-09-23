# FxSound fidelity goal — completed within confirmed scope

Release refresh (2026-09-23): author recommendation effects are now
10/18/13/15/10 percent. Only flat and recommended factory presets remain;
custom presets remain supported. Current native suite has 52 exact cases
(36 dynamic/format plus 16 preset/stimulus cases). npm test, UI smoke and
packaged worklet tests passed. New 1.6.0 installer: 94,323,509 bytes, SHA256
da1a7ed3a1287b4e46683e788781220f0f44af390535df19cecf840f2bce1013.

Current status (2026-09-23): the user explicitly confirmed only the current five
effects and ten-band EQ. Implementation, native comparison, packaged acceptance
and export are complete for that scope. Entries below are historical checkpoints;
earlier active status and numerical discrepancies are superseded by the final audit.

User objective: fully reproduce FxSound without loading its DSP DLL/driver.
On 2026-09-22 the user explicitly authorized an application-side AudioWorklet
rewrite and restoring all gain/peak processing required by the original algorithm.
This supersedes the earlier request to remove those stages. Version remains 1.6.0.

Reference revision: `d8e7a23d37ed5939c2a3090a1c1756c7f2500b17`.
Reference sources/provenance: `tests/reference/fxsound/README.md`.

## Implemented and checked

- `src/fxsound-core.js`: float32 clarity highpass/odd harmonic kernel and stereo
  widening port, AGPL-3.0-or-later. Clarity tuning is **exponential** in Qnt2But,
  despite the caller passing a linear-response enum. Previous approximation used
  an incorrect linear cutoff. Coefficients now match the original C calculation.
- `tests/fxsound-native-reference.cjs`: builds an oracle from original C excerpts
  with MSVC `/fp:strict /Od`. 16 noise/tone/impulse cases at 32/44.1/48/96 kHz;
  maximum sample error 4.76837158203125e-7. Covers kernels, not full FxSound chain.
- These two stages run in an AudioWorklet instantiated from a self-contained blob;
  Electron local-file loading verified. UI test browser requires local file origin
  access to match Electron. No native reference binary ships with the app.
- Worklet output equals the validated JS clarity kernel in real Electron at
  44.1/48/96 kHz (measured error zero). Global bypass now matches the native Maximizer lookahead (0.75 ms, float32
  multiplication then integer truncation). Switch test follows original .966051
  output scaling; maximum absolute error < 1.3e-6.
- UI smoke including existing preset/quick toggle requirements passed.

## Required work remaining

1. Maximizer sample kernel, MIDI-to-gain and release mapping are ported and
   integrated; see evidence below. Still verify quantization/dither enable flags
   and native upstream/downstream routing against the actual FxSound build.
2. Lex reverb feedback/diffusion/damping and MIDI parameter mapping are ported and
   integrated; see reverb evidence below. Full-chain routing remains to verify.
3. Bass and EQ coefficient generation/sample kernels are ported and integrated;
   see evidence below. Verify application Q multiplier selection, master gain,
   normalization/volume leveling and complete processing order against defaults.
4. UI MIDI quantization, Music2 warps and per-effect immediate updates match
   reference mapping. Global bypass now passes undelayed audio and freezes state;
   see bypass evidence below. Full native channel/routing verification remains.
5. Native stereo rate conversion now integrated/tested for 128-frame blocks;
   see rate evidence below. Still verify native mono/multichannel routing,
   irregular buffer boundaries, global bypass/history and final output handling.
6. Build a full-chain original-source oracle and compare identical inputs/settings:
   impulses, sweeps, stereo/mono, silence, low/high levels, presets, parameter
   transitions, and music at supported rates. Stage tests cannot prove this goal.
7. Verify performance/dropouts and packaged Electron behavior after full integration.
   Latest work is not built into a new installer.

## Next source locations

Maxi32.c contains level estimation at ~258, left/right envelope loops at ~296,
and final quantization/output after ~480. c_max.h defines target level .32,
level-filter cutoff .1 Hz, lookahead .00075 s. Play32.c and dfxpComm.cpp override
initial defaults. Qntitor.cpp ~459–530 maps dynamic boost from MIDI to DSP gain.
Do not adopt initialization defaults without checking those communication paths.

AGPL license and provenance are included in `src/licenses/FxSound-AGPL-3.0.txt`
and THIRD_PARTY_NOTICES.md. Preserve them when continuing the port.

## Maximizer continuation (2026-09-22)

- Added Maximizer to the same self-contained AudioWorklet module, replacing the
  browser DynamicsCompressor entirely. Original left-channel level estimator,
  gain adjustment, independent lookahead envelopes and peak ceiling are ported.
- Original Play32 always runs the Maximizer even at dynamic boost zero. Tests now
  expect .966051 output scaling and peak handling; older no-limiter/flat-unity
  assertions were superseded by the user's explicit restoration authorization.
- `tests/fxsound-maximizer-reference.cjs` builds the ORIGINAL C sample loop and
  quantizer mapping. All 16 four-second cases at 32/44.1/48/96 kHz match exactly
  (maximum error 0), including boosts, overload impulses, steady signal, silence
  and release. All 128 MIDI gain entries and release coefficient match exactly.
- This oracle deliberately excludes the optional quantize/dither branch; its
  actual enable flag in the native build still needs to be traced, not assumed.
- Worklet chain clarity + Maximizer matches validated kernels exactly in Electron
  at 44.1/48/96 kHz. Transition error <1.3e-6 after explicitly anchoring AudioParam
  ramps at currentTime (cancelAndHold alone could ramp from an older time-zero event).
- UI smoke passed with original peak handling expectations and low-level bass
  response measurement (to avoid mistaking limiting for EQ response differences).
- Next: reverb port and coefficient/mapping oracle, then bass/EQ chain and rate/
  routing verification. Full fidelity remains unproven; no new installer built.

## Reverb continuation (2026-09-23)

- Confirmed DfxDsp.vcxproj defines PT_DSP_BUILD=PT_DSP_DFX. The Lex oscillator
  branches guarded by PT_DSP_DSPFX are not active in the target product.
- Replaced all three approximate convolvers and their extra high/low-pass filters
  with the original Lex feedback/diffusion/damping ring in AudioWorklet.
- `tests/fxsound-reverb-reference.cjs` extracts original Lex initialization and
  sample statements; only pointer-comparison casts use intptr_t for the x64 test
  harness. Twelve 3-second cases at 32/44.1/48/96 kHz and room sizes .5/1/1.5
  have maximum sample error 0, including impulse, noise, unequal stereo, silence
  and long feedback tails. All 128 MIDI parameter mappings match native exactly
  at each rate: decay, room-size compensation, wet/dry, damping and bandwidth.
- Confirmed DfxDspPrivate sets normalized effect value through dfxpSetKnobValue;
  qntRToICalc rounds to MIDI. Ambience <=12 bypasses the stage; Play32 freezes
  its history when bypassed. The worklet preserves this behavior.
- Actual Electron reverb output, parameter switches, threshold bypass and frozen
  tail resume match the validated JS kernel exactly at 44.1/48/96 kHz. Test events
  are placed half a sample before k-rate block boundaries to avoid floating time
  rounding them into the following block. Existing clarity/Maximizer and global
  bypass checks also pass; npm test and full UI smoke pass.
- Version remains 1.6.0. No installer was built for this stage. Full fidelity is
  still unproven: native bass/EQ, sample-rate conversion, channel routing and
  complete-chain output/parameter transitions remain outstanding.

## Bass continuation (2026-09-23)

- Ported FiltCalcBiqd's float32 parametric design including its bandwidth
  transformation, low-frequency Q limit and low-boost Q warping. Bass uses
  90 Hz, Q 2.5, 0..15 dB in 128 MIDI steps, as selected by c_play.h/dfxpQnt.cpp.
- Replaced the browser bass peaking filter with Play32's original transformed
  direct-form sample kernel in AudioWorklet; zero MIDI bypass freezes its state.
- `tests/fxsound-bass-reference.cjs` compiles original filter design and bass
  sample statements. All 128 coefficient sets are bit-equal at 32/44.1/48/96 kHz;
  24 two-second stereo cases (impulse, 90 Hz, noise, silence; MIDI 0/1/5/12/51/127)
  produce maximum sample error 0.
- The actual Electron app chain with maximum bass + Maximizer matches the
  validated kernels exactly at 44.1/48/96 kHz. Complete `test:fxsound`, `npm test`
  and UI smoke pass after integration. Existing EQ and other UI remain intact.
- Next: native graphic EQ uses separate SOS processing; reference files
  GraphicEqInitBands/InitSections/Process, SosProcess, FiltCalcBiqd are available.
  Read GraphicEqSet, GraphicEqInit and native channel/rate processing to trace
  Q, section order, boosts, Nyquist handling and bypass state before porting.
- Quantization investigation remains open: Play32 sets 16-bit/shaped dither
  defaults but no inspected file writes quantize_on_flag. Trace allocation and
  communication rather than inferring activation from those defaults.
- Full goal remains active and incomplete. Version 1.6.0, no new installer.

## EQ continuation (2026-09-23)

- Previous goal turn was progress: reference-tested reverb and bass were added.
- Replaced all browser BiquadFilter EQ nodes with an AudioWorklet ten-section
  native parametric/SOS implementation. This uses float32 design and sample
  arithmetic, ascending section order, native denormal bias, Q limit/warping,
  disabled-section state preservation and Nyquist bypass. Parameters update at
  block boundaries instead of the prior browser coefficient ramps.
- Pinned GraphicEqSet.cpp explicitly sets 62.5..16000 Hz for ten-band mode before
  computing Q=sqrt(r)/(r-1), with multiplier 1 at initialization. Individual center
  edits do not recalculate Q. Existing user-requested centers and +/-12 dB UI are
  preserved; filter behavior matches native ten-band mode with those custom centers.
- `tests/fxsound-eq-reference.cjs` compiles original FiltCalcBiqd design and stereo
  SosProcess loop. All tested coefficients are bit-equal; twelve one-second cases
  at 32/44.1/48/96 kHz have sample error 0, including signed gains, small gains,
  custom centers, Nyquist bypass, and disabling/resuming with history retained.
- Electron app EQ+Maximizer output matches the validated kernels exactly at those
  four rates. Full test:fxsound, npm test and UI smoke pass after integration.
- The EQ oracle fixes master/balance at unity and excludes optional normalization
  and volume leveling. SosProcess.cpp contains both: trace actual application
  defaults before claiming equivalent complete EQ processing. Sos.cpp initializes
  master gain 1, volume_leveling_target_rms 0; GraphicEqInit initializes Q multiplier 1.
- Remaining control issue: clarity/surround still use continuous values and 60 ms
  smoothing. Native DfxDspPrivate -> dfxpSetKnobValue -> qntRToICalc quantizes input
  to MIDI; validate exact mapping and all bypass flags next. Native EQ runs before
  internal-rate processing (dfxpProcessReal.cpp), which is also still unported.
- Full goal remains active. No new installer; version 1.6.0 unchanged.

## Control mapping continuation (2026-09-23)

- Previous goal turn made progress: EQ native kernel integration and tests.
- Critical correction: dfxpGetButtonValue defaults to MUSIC2; DfxDspPreset.cpp
  states only Music2 is allowed since DFX 13. Prior stage tests did not cover this
  communication layer. Ambience MIDI becomes trunc(float(midi)*.34) using a double
  factor; dynamic MIDI becomes min(127,trunc(float(midi*float(1.8)))) before its
  existing .7 scale. The app now applies both. Low ambience can produce negative
  wet gain under this original mapping; retain the original behavior, not a clamp.
- Raw ambience MIDI <=12 remains the bypass condition, independent of its warped
  parameter index (confirmed in dfxp_CommAmbienceBypass).
- Added normalizedToMidi with native float32 multiplication/addition before
  truncation, and exact clarity/surround linear quantizers (hard maximum endpoint).
  All five effects now use MIDI values and immediate coefficient updates. Removed
  the extra 60 ms clarity/surround/dynamics ramps; global bypass crossfade remains.
- `tests/fxsound-controls-reference.cjs` extracts original qntRToICalc rounding,
  qntIToRInit linear table, and Music2 warp statements. All 128 mappings and 482
  percentage/boundary inputs match bit-for-bit.
- Electron compares five simultaneous-effect settings (1/10/20/50/100 percent)
  against independently C-validated kernels at 48 kHz: maximum sample error 0.
  Reverb transition reference updated for Music2; EQ/bass/clarity checks still pass.
- UI smoke passes. Its obsolete 'ambience loses <1 dB' assertion contradicted
  the original wet/dry mix; replaced with exact native-reference RMS comparison.
- FxController defaults confirmed: filter Q multiplier 1, master 0 dB, balance 0,
  volume leveling 0. Sos.cpp normalization target is 1 (disabled); volume leveling
  returns immediately for target <=0. No extra leveling is required for defaults.
  Non-default optional mastering modes have not been ported or tested.
- Next: native internal_rate_ratio in dfxpInit.cpp (2/4 for high rates), actual
  comProcessWaveBuffer conversion, quantize_on_flag allocation/write, final clamp,
  mono/multichannel and global bypass state. Current 96 kHz kernel comparisons
  intentionally do not prove native high-rate processing equivalence.
- Full goal active, version 1.6.0 unchanged, no new installer.

## Rate conversion continuation (2026-09-23)

- Previous goal turn made progress: native control mapping and Music2 integration.
- Confirmed live format setup in dfxpProcess.cpp uses the same ratios as init:
  1 through 48 kHz; 2 above 48 kHz and below 192 kHz; 4 at 192 kHz. In particular
  176.4 kHz maps to 88.2 kHz internally, not 44.1; preserve actual source behavior.
- Comwave.cpp performs unfiltered decimation and zero-order hold, not interpolated
  resampling. Worklet stages now select each ratio-th sample, process at the native
  internal rate and repeat output. Cascade is equivalent for synchronized 128-frame
  worklet blocks; EQ still processes every original-rate sample before decimation.
- Dry comparison delay now derives from internal-rate Maximizer delay times ratio.
  Global bypass crossfade remains an app difference awaiting a later correction.
- New `tests/fxsound-rate-reference.cjs` compiles original Comwave conversion loops
  around an identity stage and compares actual Electron output at 44.1/48/88.2/96/
  176.4/192 kHz (128-frame stereo buffers): every sample equal. No irregular-buffer
  or native mono/multichannel claim is made by this test.
- Electron EQ/effect integration comparisons expanded through 192 kHz, using
  native internal rates and sample hold; all measured kernel output errors zero.
  Bypass crossfade error remains <1.3e-6. npm test and UI smoke pass.
- Output investigation: DFX float dutilPutOutputsAndMeter writes stereo floats
  directly and sums outputs for mono; it adds no extra clipping. realSampleForce-
  LegalValues is a pre-effect legal-range pass, not output limiting; its activation
  (lean/processing_only) and constants still need tracing.
- ComsftwrCPP.cpp allocates the parameter struct with calloc and explicitly zeros
  dsp_params; u_comSftwr.h embeds it. Inspected Play/Max init assigns quantization
  depth/dither type but not quantize_on_flag; communication code has no enable
  write found. Default flag is therefore zero on this inspected initialization
  path; final full-chain oracle should confirm that optional branch remains off.
- Remaining: global bypass freezes/states, mono/multichannel routing, complete
  original-source chain verification, runtime performance and package acceptance.
  Goal still active; version 1.6.0, no new installer.

## Global bypass continuation (2026-09-23)

- Previous turn was progress: native rate conversion was integrated and tested.
- Confirmed dfxpProcessReal.cpp skips GraphicEqProcess and comProcessWaveBuffer
  while globally bypassed. Its bypass EQ path is master-gain-only (default unity).
  No internal-rate conversion or Maximizer delay is applied during bypass.
- Removed app-only parallel dry/wet paths, compensating DelayNode and 60 ms
  crossfade. All six worklets now accept one synchronized k-rate bypass parameter.
  Bypassed blocks copy input before processing and do not advance filter, reverb,
  bass or Maximizer histories. EQ coefficients can update without advancing state.
- Electron integration test now uses a full EQ + five-effect chain, starts off,
  enables at .25 s, compares original at .5 s, resumes at .75 s. Reference advances
  kernels only during active periods. At 44.1/48/96/192 kHz every output sample
  matches exactly, including immediate undelayed dry output and resumed tails.
  This supersedes all earlier aligned-bypass/crossfade claims in this log.
- Existing effect/EQ/rate worklet tests, npm test and full UI smoke pass.
- Traced pre-effect realSampleForceLegalValues: DfxDspPrivate passes processing_only
  false to dfxpInit; dfxpProcessReal sets lean_and_mean true in that case and skips
  this legal-range pass. It is not required for the inspected default app path.
- Remaining scope includes native mono/multichannel routing, full original C chain
  (current complete-chain Electron reference still composes independently validated
  JS kernels), output conversion, runtime performance and package acceptance.
  Fractional positive controls quantized to MIDI 0 also need explicit effect-on
  flag verification; current clarity skips zero drive, native button follows raw
  control >0, though integer-percent UI values do not hit that sub-MIDI case.
- Goal active, version 1.6.0 unchanged, no installer built.

## Fractional controls / mono investigation (2026-09-23)

- Previous turn was progress: global bypass state behavior corrected and tested.
- Added explicit effectOn parameter for clarity, surround and bass. App sets this
  from raw control >0, matching DfxDspPrivate::setEffectValue. MIDI quantization
  no longer accidentally disables tiny nonzero controls. Bass accepts an explicit
  enabled flag so MIDI 0 can process unity coefficients and advance/flush prior
  histories rather than freezing them.
- Native bass oracle now tests enabled MIDI 127 -> 0 ->127 as well as disabled 0.
  Twenty-eight cases at four rates have zero sample error. Existing clarity oracle
  already includes a running zero-drive case. Electron app test switches 100% ->
  0.1% -> 0% -> 100% with clarity/surround/bass together and matches reference
  exactly. Existing worklet tests, UI smoke and npm test pass.
- Mono source investigation found a real remaining difference: dutio.h duplicates
  mono input into in1/in2 but sums each stage's outputs back to one sample. Aural
  runs only the left filter, Bass/Max output right zero, Wide halves both outputs,
  Lex halves wet outputs and zeros the right dry input before summing. Current
  app forces two-channel output at EQ and all stages, so mono media is promoted
  to stereo and reverb can create a stereo tail. Native one-channel processing
  collapses reverb to mono before the next stage.
- Next implement channel-count-preserving worklet wiring (single input/output
  with outputChannelCount omitted) and explicit native mono kernels. Verify C
  mono branches and actual Electron dynamic mono/stereo transitions; do not assume
  averaging the final stereo output equals mono processing between stages.
- Full goal active; no new installer, version 1.6.0 unchanged.

## Mono processing continuation (2026-09-23)

- Previous turn made progress: raw effect enable flags and fractional control tests.
- App worklets now preserve mono inputs (omitted fixed outputChannelCount).
  channelCountMode=clamped-max, channelCount=2 retains the existing stereo ceiling;
  >2-channel media still downmixes before effects and native surround is outstanding.
- Added native mono Lex output half-scaling, right dry zeroing and sum at the stage
  boundary; mono Wide halves both outputs before summing. Clarity/Bass use only
  left histories, Maximizer skips right processing. EQ uses its left section state.
  Final mono output is expanded only by the stereo destination, not between effects.
- Extended C oracles to original mono branches: clarity/widening 32 cases (max
  error 4.768e-7), reverb 24 cases and Maximizer 32 cases (both max error 0).
  Reverb original mono arithmetic, rather than averaging final stereo output,
  is required to reproduce rounding and inter-stage behavior.
- Electron complete mono EQ/five-effect chain matches reference exactly at
  44.1/48/96/192 kHz, including tail after input stops.
- Traced format changes: dfxpBeginProcess -> dfxp_ComLoadAndRun ->
  comSoftDspLoadAndRunNonShared uses DSPS_INIT_MEMORY | DSPS_INIT_PARAMS.
  Effect worklets reinitialize on changes in nonempty input channel count;
  external EQ handle is preserved. Mono->stereo->mono Electron test matches
  reinitialized reference exactly. Sources in this test start at explicit buffer
  offsets: disconnected BufferSource nodes do not provide a reliable advancing
  playhead and initially caused a test-fixture mismatch, fixed without weakening
  the expected sample comparison.
- Existing stereo, controls, bypass and rate integration checks continue passing.
- Still required: native >2 channel routing, complete original-C chain oracle,
  final output/host format behavior, performance and packaged acceptance. Goal
  remains active; version 1.6.0 unchanged, no new installer.

## Surround EQ preparation (2026-09-23)

- Previous goal turn was progress (mono kernels and format transition validation).
- Inspected dfxpProcessReal.cpp: native 4/6/8-channel processing splits front,
  center, sub, rear and side handles. Non-front groups skip the entire effect
  chain for a buffer that is all zero after EQ. This gate must be shared across
  stages; independent per-stage zero checks would incorrectly consume tails.
- dfxpComm.cpp enables bass only on subwoofer in surround, clarity/reverb never
  on sub, widening never on center/sub. Quad has no sub and therefore no bass.
- Ported native surround EQ routing in Equalizer: LFE gets bands 0/1, other
  channels bands 2..9. Eight independent channel histories are allocated;
  stereo histories remain separate, matching native state1..4 vs state_1/2[].
  Worklet passes actual channel count. App still clamps to two channels until
  the full routing/gating chain is implemented; this is preparatory kernel work.
- Expanded original-C EQ oracle with the unmodified sosProcessSurroundBuffer
  numerical loop. 36 stereo/6/8-channel cases across 32/44.1/48/96 kHz,
  custom frequencies and bypass/resume all produce zero sample error.
- npm test passes. Full multi-channel app wiring and Electron surround tests
  remain outstanding, along with whole-original-C chain, performance and package
  acceptance. Version 1.6.0 unchanged; no installer built; goal remains active.

## Combined multichannel chain (2026-09-23)

- Previous turn was progress: surround EQ kernels and native oracle extension.
- Corrected the prior note's bass interpretation: dfxpComm.cpp's live front
  DSP_PLAY_BASS_BOOST_ON write always enables front bass. Only the older,
  commented-out expression restricts it to stereo. Front and sub receive bass;
  rear/center/side do not. Quad therefore still has front bass.
- Added a combined FxSoundCore.Chain and fxsound-chain worklet. EQ runs first at
  input rate; each front/center/sub/rear/side group then shares one nonzero-buffer
  gate across clarity -> reverb -> widening -> bass -> Maximizer. Front always
  processes; a completely silent other group preserves every effect history.
  Sample hold conversion happens once around the complete effects chain.
- App now uses this combined worklet, preserving up to eight input channels.
  Quad skips EQ as native dfxpProcessReal explicitly does. Sub excludes clarity,
  reverb and widening; center excludes widening. Format changes reset effects
  and retain EQ history. Unsupported 3/5/7-channel formats bypass the unsupported
  DSP routing, consistent with native switch cases; no fabricated channel map.
- Actual Electron offline app wiring: 12 quad/5.1/7.1 cases, 48/96 kHz, EQ flat
  and enabled, silent gap and resumed audio have zero error against independent
  composition of kernel instances. All existing mono/stereo/rate/control/global
  bypass/format-switch worklet cases remain zero error. This is integration
  evidence, not a full original-C chain oracle (still required).
- npm test passes. Remaining: multichannel format transitions, native complete
  chain oracle/host-buffer boundary/output handling, performance and packaged
  acceptance. Default AudioContext destination remains its device configuration;
  physical surround-device acceptance is not established by offline tests.
- Version 1.6.0 unchanged; goal active; no new installer.

## Multichannel transitions and throughput (2026-09-23)

- Previous goal turn made progress: combined chain and native routing enabled.
- Added actual Electron source format transitions 2 -> 6 -> 8 -> 4 -> 1 -> 8
  through MedoSound.create, with EQ and all five effects enabled. Destination
  uses discrete channel interpretation to observe each channel independently.
  Every rendered sample matches the core reference (max error 0). This proves
  browser channel negotiation/format reset integration; it does not independently
  prove kernel arithmetic. Existing independently composed surround tests and
  mono/stereo/rate/control/bypass checks also pass.
- Added tests/fxsound-throughput.cjs, a diagnostic of the production Chain at
  two/eight channels and 48/96/192 kHz, all controls maximum and all ten EQ bands
  nonzero. Each scenario warms up then processes ten seconds using 128-frame
  blocks; outputs remain finite. Node v22.19.0 on this machine: compute fraction
  of real time 1.98/2.81/5.10% stereo and 6.35/9.85/14.84% eight channels.
  Eight-channel 192 kHz p99 block cost .214 ms, max .625 ms versus .667 ms
  block budget. Report: tests/artifacts/fxsound-throughput.json.
- This is CPU-kernel throughput only, not real-time device dropout acceptance;
  scheduler/GC/AudioWorklet construction on format changes remain to evaluate.
- Next priority remains complete original-C chain oracle (current whole-chain
  references compose validated JS kernels), native host buffer and output
  format behavior, then real-time/package acceptance. Goal active, version
  1.6.0 unchanged, no installer built.

## Serial native-C chain oracle (2026-09-23)

- Previous goal turn was progress: actual multichannel transitions and throughput.
- Added tests/fxsound-chain-reference.cjs. Rebuilds/runs all five original-source
  kernel oracles, then executes native EQ -> native Aural -> native Lex -> native
  Wide -> native Bass -> native Maximizer on the same samples. Aural and Wide
  are separated at their buffer boundary from the existing combined oracle;
  original numerical statements remain unchanged. EQ's previous test-specific
  timed bypass is removed for this continuous chain scenario.
- Tests stereo and mono at 44.1/48/96/192 kHz, MIDI 13/64/127, mixed EQ boosts/
  cuts, impulse/noise/tone input followed by silence. Production Chain is compared
  to the serial C output after sample hold conversion. All 24 cases pass, maximum
  accumulated sample error 4.470348358154297e-8. Original individual tests also
  pass during regeneration. Added this oracle to npm run test:fxsound, replacing
  redundant individual invocations (they run within the chain oracle).
- Evidence boundary: this is serial native numerical kernels; parameters still
  come from separately C-validated JS mapping, and driver routing/rate conversion
  are orchestrated by JS. It does not yet compile Play32/dfxpProcessReal as one
  original dispatcher or prove multichannel/control-change C parity. Those
  remain outstanding, along with real-time device and package acceptance.
- Verified dfxpGet.cpp headphone default_bypass_value IS_TRUE with inverted
  registry value: binaural headphone processing is default-off. Older Play
  headphone branch is explicitly disabled in dfxpComm; not part of tested default
  five-effect path. Nondefault binaural mode is not implemented here.
- Goal remains active, version 1.6.0 unchanged, no installer built.

## Native dispatch and partial rate groups (2026-09-23)

- Previous goal turn was progress: serial original-C numerical chain oracle.
- Added tests/fxsound-routing-reference.cjs. Compiles unchanged channel reorder,
  zero-buffer detection, switch/dispatch and inverse reorder statements from
  dfxpProcessReal.cpp. Only the called DSP is replaced by a stateful probe whose
  output identifies the handle and processed frame count. Compared against the
  production Chain with equivalent probe: layouts 1..8, 32 buffers per layout,
  all-zero groups, one-sided pair activity, final-frame impulses, resumed groups
  and global bypass all match exactly. This proves dispatcher routing/gating;
  actual numerical kernels remain covered separately/serially.
- Found and fixed a Chain host-buffer boundary mismatch: at high rates a trailing
  incomplete downsample group must repeat the last complete processed frame,
  not consume the next input sample and advance the effects. Normal Chromium
  128-frame blocks were unaffected because they divide by both native ratios.
- Expanded original Comwave C oracle to variable buffer lengths and mono.
  42 cases (ratios 1/2/4, mono/stereo, lengths 4/5/7/127/128/129/255) match exactly,
  including an assertion that incomplete groups do not advance effect state.
  Minimum supported fixture has at least one complete group, as native Comwave
  reads before the buffer when no complete group exists; not a legal app quantum.
- Six-rate actual Electron conversion continues exact; full worklet suite also
  passes. Added native routing oracle to test:fxsound.
- Still pending: native dispatcher+actual kernels in one integrated multi-channel
  oracle with control changes, real-time audio-device execution/GC timing and
  packaging acceptance. Goal active, version 1.6.0 unchanged, no installer built.

## Integrated native C oracle (2026-09-23)

- Previous goal turn made progress: original dispatcher probe and partial-group
  Comwave correction with native reference coverage.
- Added tests/helpers/fxsound-native-kernels.cjs, which converts generated native
  oracle harnesses into persistent C++ kernels. Numerical statements are retained;
  harness file I/O and state lifetime become constructors/sample methods. Reverb
  memory belongs to each kernel, and effect state persists across input buffers.
- Added tests/fxsound-integrated-reference.cjs: one C executable now combines
  original dfxpProcessReal reorder/dispatch/restore, original Comwave down/up
  conversion, native EQ loops and all five native numerical kernels. Calls use
  native role-specific effect flags. EQ runs at host rate before zero-group
  detection. Parameter tables are still supplied by separately C-validated JS
  mappings; this is not a link of the entire FxSound application/DLL.
- Thirty cases pass: mono/stereo/quad/5.1/7.1, 48/96/192 kHz, EQ flat and mixed
  boosts/cuts. Each has 384 blocks with controls 0 ->13 ->64 ->127 repeated,
  per-channel silent gaps/resumption and global bypass every 19 blocks. Maximum
  sample error 1.7881393432617188e-7, consistent with native/V8 sin differences.
  Initial five-effect-only fifteen-case run also passed at the same maximum.
- test:fxsound now starts with the integrated oracle; it regenerates/runs the
  individual, serial-chain and routing oracles, avoiding duplicate top-level
  invocations. Controls/rate/Electron integration remain separate suite members.
- Next acceptance work: longer real-time AudioWorklet/device execution, format
  change allocation/GC, output-device behavior and package verification. Native
  dynamic-EQ/frequency changes and format changes need integrated-C extension
  (covered by narrower C kernels and Electron tests so far). Nondefault optional
  binaural/mastering scope still requires final audit; no complete claim yet.
- Version 1.6.0 unchanged, no installer built, goal active.

## Dynamic EQ and numerical-semantic corrections (2026-09-23)

- Previous turn made progress: integrated original-C dispatcher and kernels.
- Expanded integrated reference to change gains/frequencies every 17 blocks,
  including mixed +/-12 dB, small +/-0.1 dB, flat sections and restored/reversed
  gains; effect controls still change every 32 blocks and bypass every 19.
  Native coefficient updates retain section histories, as verified in SosSet.cpp.
- This exposed a real production bug at 192 kHz: low-boost Q limiting multiplied
  by a precomputed ratio in JS, but native FILT_BOOST_SCALE/FILT_Q_LIMIT_SCALE
  macros lack outer parentheses and expand as multiply then divide. Corrected
  JS float32 evaluation order for both scales. Extended individual EQ reference
  to 192 kHz: 45 cases now have exactly matching coefficients and samples.
- A remaining integrated discrepancy (6 channels/96 kHz, peak .000127) came from
  the oracle, not production: Auralp32.c is a C compilation unit in DfxDsp.vcxproj
  with no CompileAs override, and sin therefore receives double. Our C++ harness
  had selected the float overload. Explicit double promotion now preserves C
  semantics in the numerical excerpt. No test tolerance was loosened.
- Corrected native clarity oracle: 32 cases error 0 (supersedes earlier sin
  discrepancy claims). Serial native chain: 24 cases error 0. Integrated native
  chain with dynamic EQ/effects, mono through 7.1 and 48/96/192 kHz: all 30 cases
  error 0. Native reverb/bass/Maximizer, routing and expanded EQ also pass.
- npm test passed after the production Q correction. Optional --reuse-oracles
  supports focused harness iteration; default integrated test always regenerates
  prerequisites. Final successful run used default complete regeneration.
- Remaining acceptance: integrated native format changes, realtime device/GC
  behavior, optional-mode scope audit, final package/export. Goal active, version
  1.6.0 unchanged, no installer built.

## Real AudioContext scheduling and allocation (2026-09-23)

- Previous goal turn made progress: Q macro rounding and C-vs-C++ sin correction;
  dynamic integrated C parity reached zero error.
- Added tests/fxsound-realtime.cjs and test:fxsound:realtime. Uses real AudioContext
  at 48/192 kHz, maximum effects/nonzero EQ, changing sources 2 ->8 ->1 ->6 and
  updating controls during an eight-second render. A downstream worklet observes
  finite/peak output, currentFrame continuity and actual channel negotiation,
  then zeroes output so no test noise is played. Device output timestamp advances.
- Before optimization, two 48 kHz runs failed with repeated/skipped frame
  timestamps near a format change; outputs stayed finite. The same test's
  --control direct graph passed both rates. Do not count the initial runs as pass.
- Chain previously constructed new Bass coefficient tables, Reverb buffers and
  all effect objects on format change. It now preallocates the five native
  handles/layouts and only resets their histories on a format change. Clarity,
  Bass, Reverb and Maximizer reset in place; no coefficient recalculation or
  buffer allocation occurs in configureChannels. EQ histories remain intact.
- Full Electron offline numeric/format-switch suite remains exact. Real-context
  48/192 kHz tests passed after optimization, peak .966051042, zero nonfinite
  samples and zero observed currentFrame gaps. A repeated run also passed (see
  current fxsound-realtime.json). npm test passes.
- playbackStats is unavailable in this Electron runtime (null). These observations
  establish audio-graph scheduling and advancing device timestamps, not physical
  loopback/audio hardware error counters or perceptual listening equivalence.
- Next: integrated original-C format transition/reset validation, longer run and
  final optional-mode/scope audit, package/export acceptance. Goal remains active,
  version 1.6.0 unchanged, no installer built.

## Native format transitions and longer realtime control (2026-09-23)

- Previous turn made progress: in-place effect reset/preallocation and short
  actual-context tests. The short-run success is not final realtime acceptance.
- Integrated C oracle now adds dynamic layouts 2 ->6 ->8 ->4 ->1 ->8 at each of
  48/96/192 kHz, EQ flat/nonflat initially with subsequent coefficient changes.
  Native effect handles are reconstructed on format changes while the native EQ
  instance/history is retained, following inspected dfxpBeginProcess semantics.
  Padded interleaved fixture I/O allows comparison of changing channel counts.
  All 36 integrated cases pass with error 0 after production preallocation.
  Ran --reuse-oracles against current generated prerequisites; integrated C
  executable itself was rebuilt with the new transition driver.
- Realtime test accepts --seconds=30 (default 8). Longer effects run failed at
  48 kHz: one repeated currentFrame and following +128 correction near 14 seconds;
  finite values and .966051 peak remained normal. Do not report it as passed.
- Matched 30-second --control without any FxSound node passed 48 kHz but also
  failed 192 kHz with the same repeated/currentFrame correction pair at a source
  format change. Thus the timestamp anomaly is not specific to our effect code;
  it remains unresolved whether this is observer clock behavior, graph update
  behavior or actual data discontinuity. No thresholds/assertions were relaxed.
- Observer now snapshots currentFrame once at entry, counts changes to the clock
  within one process call, and saves per-run diagnostics (in addition to latest)
  even before assertions, preventing failed evidence from being silently replaced.
  This instrumentation update has not yet had a fresh long run.
- Next: run the updated observer and add input-sample continuity evidence if
  needed; retain realtime acceptance as unproven. Then package/export and final
  optional-mode/scope audit. Goal active, version 1.6.0 unchanged, no installer.

## Realtime sample-continuity evidence (2026-09-23)

- Previous turn made progress: C format transitions and diagnosis of the longer
  realtime timestamp anomaly. No blocking condition; work continued with stronger
  observations instead of accepting or ignoring an ambiguous timestamp test.
- Entry-only currentFrame snapshot did not eliminate the anomaly: 192 kHz direct
  control still repeated one frame label then corrected it, while the clock never
  changed within a process call. This rejects the intra-callback-clock hypothesis.
- Added independent monotonic sample marker on a separate observer input. A
  48 kHz effects run reproduced the timestamp anomaly, but all 1,441,792 marker
  samples remained consecutive with zero repeats/loss. Timestamp-only acceptance
  was therefore insufficient to classify audio data continuity.
- Added --sample-reference mode: observer receives the same raw source on another
  input and processes it through an independent core instance. Actual effect-node
  output is compared sample-for-sample in realtime. All controls remain maximum
  in this mode; fourteen source-format transitions exercise resets. Dynamic
  controls retain separate native-C/Electron coverage; this is not falsely
  presented as realtime dynamic-control sample comparison.
- Thirty-second tests pass at both 48/192 kHz: 5,942,784 and 23,761,792 actual
  channel samples compared respectively, error 0; marker gaps 0; nonfinite 0;
  peak .966051042. At 192 kHz the observer simultaneously recorded four anomalous
  frame labels (two duplicate/correction pairs), with zero marker or effect-data
  error. This establishes that these labels did not imply sample loss/replay or
  effect-history desynchronization in this graph. Clock diagnostics are retained.
- test:fxsound:realtime now runs the 30-second sample-reference mode. It asserts
  actual marker continuity, exact-within-2e-6 effect samples, finite values,
  source formats and advancing device output timestamp; clock label counts remain
  reported instead of substituting for direct data evidence. Hardware loopback
  and playbackStats counters remain unavailable; physical endpoint behavior is
  not proved beyond the advancing output timestamp.
- Next: final source/scope audit and build/export with packaged runtime checks.
  Goal active, version 1.6.0 unchanged, no new installer yet.

## Packaged checkpoint (2026-09-23)

- Previous goal turn made progress: direct realtime sample/marker comparisons
  resolved the clock-label ambiguity without classifying it as audio loss.
- Full npm run test:fxsound passed with default regeneration: integrated native
  36 cases error 0; serial 24 error 0; native kernels/mappings/rate boundaries,
  actual Electron sample/format/bypass tests passed. UI smoke and npm test passed.
- Verified E:\Medo_music\release is an ordinary directory (no link/reparse target),
  then scripts/clean-release.js removed its recognized prior builder outputs.
  Rebuilt icons and NSIS x64 using electron-builder and existing Electron 39.8.10
  distribution. Version stays 1.6.0. Did not install/publish to any external host.
- Export: E:\Medo_music\release\MedoMusic-Setup-1.6.0-x64.exe
  Bytes: 94323715
  SHA256: 2040386872687d43e95b77fac2336d506fa48f3757137c731a53613ea41375aa
- app.asar version and exact bytes of fxsound-core.js, sound-enhancement.js,
  FxSound-AGPL-3.0.txt and THIRD_PARTY_NOTICES.md match current workspace. Initial
  nested license lookup used forward separators and failed in Windows asar API;
  archive listing plus path.normalize resolved the lookup and exact byte check.
  The license was present; no package change or missing-license claim warranted.
- Added --packaged to worklet/realtime acceptance scripts. Launched the actual
  release/win-unpacked/MedoMusic.exe against isolated test profile: complete
  worklet suite passed. Packaged 30-second realtime tests at 48/192 kHz passed,
  all reference samples error 0, marker data continuous, all samples finite.
  One 192k clock-label duplicate/correction pair again had no data mismatch.
- Remaining final audit: explicit sweep/music/preset stimulus coverage named in
  original plan, and scope accounting for optional/nondefault upstream modes.
  Do not infer full-goal completion merely from the successful package checkpoint.
  Goal remains active; this installer is a verified checkpoint artifact.

## Preset/stimulus acceptance and scope clarification (2026-09-23)

- Previous turn made progress: clean build/export and actual packaged audio tests.
- Native integrated oracle now supports independent five-control fixture settings.
  Added tests/helpers/fxsound-stimuli.cjs, reading the production preset registry.
  All five presets run against original C on a 20 Hz ->20 kHz log sweep and a
  deterministic generated musical phrase (drums/bass/chords/melody), with level
  variation and trailing silence, at 44.1/48/96/192 kHz. 40 cases pass, error 0.
  Existing 36 dynamic/format cases remain error 0; combined report has 76 cases.
  Test report label maximum remains zero; fixture helper separately checks its
  own error. No runtime code changed; exported installer remains current.
- Added plans/fxsound-acceptance.md to distinguish current verified processing
  from unported optional upstream modes and physical endpoint limits.
- Source audit confirms DfxDspPrivate::setEffectValue exposes exactly five effects;
  additional normalization/volume leveling/master/balance setters exist upstream.
  Preset stores headphone_on_, although default headphone mode is off and older
  Play headphone branch is forced off in communication. Do not silently equate
  the verified default chain with every optional upstream processing mode.
- Sent optional async scope question asking whether full reproduction includes
  optional headphone/binaural, loudness leveling, balance and master gain, or only
  the user's existing five-effect/ten-EQ panel. No answer received yet. Keep goal
  active and do not treat elapsed time as approval or claim complete scope.

## Final scope confirmation and acceptance (2026-09-23)

- User answered: “仅当前五项音效与十段均衡器”. Optional headphone/binaural,
  loudness leveling, balance and extra master gain are outside the confirmed scope.
- Final audit verified all 76 integrated original-C comparison cases have error 0.
- Both packaged 30-second realtime runs have zero sample error, zero marker
  discontinuities and zero nonfinite samples (5,923,328 and 23,764,992 samples).
- Packaged core, audio wiring, renderer, HTML, CSS, license and third-party notices
  match workspace bytes. Package version remains 1.6.0.
- Export: release/MedoMusic-Setup-1.6.0-x64.exe, 94,323,715 bytes, SHA256
  2040386872687d43e95b77fac2336d506fa48f3757137c731a53613ea41375aa.
- Confirmed scope is complete. Physical endpoint loopback is not part of these
  numerical/software tests; no claim is made about optional upstream modes.
