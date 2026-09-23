# FxSound reference source

Upstream: https://github.com/fxsound2/fxsound-app

Pinned revision: `d8e7a23d37ed5939c2a3090a1c1756c7f2500b17`.

These unmodified files are test references, not runtime DLLs. They are licensed
under AGPL-3.0-or-later; the upstream license is included as `LICENSE`.

| Local filename | Upstream path |
| --- | --- |
| Auralp32.c | dsp/ptechDsp/Aural/Aural032/Auralp32.c |
| Wide32.c | dsp/ptechDsp/wide/Wide32/Wide32.c |
| Play32.c | dsp/ptechDsp/Play/Play32/Play32.c |
| dfxpQnt.cpp | dsp/ptutil/dfxp/dfxpQnt.cpp |
| dfxpComm.cpp | dsp/ptutil/dfxp/dfxpComm.cpp |
| u_dfxp.h | dsp/ptutil/dfxp/u_dfxp.h |
| c_play.h | dsp/ptutil/include/c_play.h |
| c_aural.h | dsp/ptutil/include/c_aural.h |
| kerdelay.h | dsp/ptutil/include/kerdelay.h |
| Qnt2But.cpp | dsp/ptutil/Qnt/Qnt2But.cpp |
| Fil12But.cpp | dsp/ptutil/Filt/Fil12But.cpp |
| Maxi32.c | dsp/ptechDsp/Maximizer/Maxi32/Maxi32.c |
| Lex32.c | dsp/ptechDsp/Lex/Lex32/Lex32.c |
| dfxpProcessReal.cpp | dsp/ptutil/dfxp/dfxpProcessReal.cpp |
| c_max.h | dsp/ptutil/include/c_max.h |
| c_lex.h | dsp/ptutil/include/c_lex.h |
| Qntitor.cpp | dsp/ptutil/Qnt/Qntitor.cpp |
| Qntitor2.cpp | dsp/ptutil/Qnt/Qntitor2.cpp |
| Qntrtoi.cpp | dsp/ptutil/Qnt/Qntrtoi.cpp |
| dfxpGet.cpp | dsp/ptutil/dfxp/dfxpGet.cpp |
| dfxpSet.cpp | dsp/ptutil/dfxp/dfxpSet.cpp |
| DfxDsp.cpp | dsp/DfxDsp.cpp |
| DfxDspPrivate.cpp | dsp/DfxDspPrivate.cpp |
| DfxDsp.vcxproj | dsp/DfxDsp.vcxproj |
| Comwave.cpp | dsp/ptutil/COM/Comwave.cpp |
| Com.cpp | dsp/ptutil/COM/Com.cpp |
| ComMem.cpp | dsp/ptutil/COM/ComMem.cpp |
| realSampleForceLegalValues.cpp | dsp/ptutil/realSample/realSampleForceLegalValues.cpp |
| dfxpProcess.cpp | dsp/ptutil/dfxp/dfxpProcess.cpp |
| Comsftwr.c | dsp/ptComSftDfx/Comsftwr.c |
| ComsftwrCPP.cpp | dsp/ptComSftDfx/ComsftwrCPP.cpp |
| u_comSftwr.h | dsp/ptComSftDfx/u_comSftwr.h |
| dfxpSession.cpp | dsp/ptutil/dfxp/dfxpSession.cpp |
| dfxpInit.cpp | dsp/ptutil/dfxp/dfxpInit.cpp |
| c_wid.h | dsp/ptutil/include/c_wid.h |
| dfxp.h | dsp/ptutil/include/dfxp.h |
| dfxpDefs.h | dsp/ptutil/include/dfxpDefs.h |
| DfxSdk.h | dsp/ptutil/include/DfxSdk.h |
| DfxDspPreset.cpp | dsp/DfxDspPreset.cpp |
| DfxDspRegistry.cpp | dsp/DfxDspRegistry.cpp |
| DfxDspEq.cpp | dsp/DfxDspEq.cpp |
| FxController.cpp | fxsound/Source/GUI/FxController.cpp |
| FxController.h | fxsound/Source/GUI/FxController.h |
| GraphicEqSet.cpp | dsp/ptutil/DspUtil/GraphicEq/GraphicEqSet.cpp |
| GraphicEqInit.cpp | dsp/ptutil/DspUtil/GraphicEq/GraphicEqInit.cpp |
| u_GraphicEq.h | dsp/ptutil/DspUtil/GraphicEq/u_GraphicEq.h |
| GraphicEq.h | dsp/ptutil/include/GraphicEq.h |
| Sos.cpp | dsp/ptutil/SOS/Sos.cpp |
| SosSet.cpp | dsp/ptutil/SOS/SosSet.cpp |
| u_sos.h | dsp/ptutil/SOS/u_sos.h |
| FiltbiqdSos.cpp | dsp/ptutil/Filt/FiltbiqdSos.cpp |
| QntitoBoostCut.cpp | dsp/ptutil/Qnt/QntitoBoostCut.cpp |
| FiltCalcBiqd.cpp | dsp/ptutil/Filt/FiltCalcBiqd.cpp |
| GraphicEqInitBands.cpp | dsp/ptutil/DspUtil/GraphicEq/GraphicEqInitBands.cpp |
| GraphicEqInitSections.cpp | dsp/ptutil/DspUtil/GraphicEq/GraphicEqInitSections.cpp |
| GraphicEqProcess.cpp | dsp/ptutil/DspUtil/GraphicEq/GraphicEqProcess.cpp |
| SosProcess.cpp | dsp/ptutil/SOS/SosProcess.cpp |
| product_type.h | dsp/ptutil/include/product_type.h |
| codedefs.h | dsp/ptutil/include/codedefs.h |
| dspfxp_studioverb.h | dsp/ptutil/include/dspfxp_studioverb.h |
| pt_defs.h | dsp/ptutil/include/pt_defs.h |
| c_dsps.h | dsp/ptutil/include/c_dsps.h |
| boardrv1.h | dsp/ptutil/include/boardrv1.h |
| dutio.h | dsp/ptutil/include/dutio.h |
| platform.h | dsp/ptutil/include/platform.h |
| dsp_mem1.h | dsp/ptutil/include/dsp_mem1.h |
| filt.h | dsp/ptutil/include/filt.h |

The native comparison harness extracts the original coefficient and per-sample
processing statements rather than using the JavaScript port as its own oracle.
It tests clarity, stereo widening, Maximizer, Lex reverb, bass and EQ kernels/mapping. It does **not** establish
equivalence of the complete app, UI parameter mapping, native mono/multichannel
routing, internal-rate conversion, EQ master/leveling processing or final output handling. Optional
Maximizer quantization/dither is not included in the current oracle.

Run `npm run test:fxsound` on Windows with MSVC C++ tools and the project's
`.electron-dist` runtime. Native reference binaries are generated exclusively in
ignored `tests/artifacts/fxsound-*` directories. The Electron test uses
an isolated user profile, checks worklet samples against the validated port and
checks bypass transitions at 44.1, 48 and 96 kHz.

The Lex harness runs the non-modulated PT_DSP_DFX branch selected by the actual
project. Ring pointer casts are widened to intptr_t for the x64 harness; numerical
statements are unchanged. It checks all 128 coefficient mappings at four rates
and three-second stereo tails at three room sizes. Electron also tests changing
decay, bypassing at MIDI 12, and resuming the frozen tail.

The EQ reference extracts original parametric design and stereo SOS sample loop,
with master/balance unity and optional normalization/volume leveling excluded.
Twelve cases cover signed gains, changed centers, Nyquist bypass and retained
state on disable/resume at four rates. This proves the filter kernel, not those
excluded optional stages or full native channel/rate routing.

Control mapping uses the Music2 mode fixed by DFX 13+ (DfxDspPreset.cpp), also
the default in dfxpGetButtonValue. The control oracle verifies all 128 linear
mappings and Music2 warps plus 482 normalized inputs/rounding boundaries. The
app integration tests five simultaneous-effect settings at 48 kHz. These do not
prove full native rate conversion, global bypass behavior or final output parity.

Rate conversion is tested against original Comwave down/up loops in 128-frame
stereo blocks at 44.1/48/88.2/96/176.4/192 kHz. Electron output matches exactly.
Effect integration now uses native internal rates; EQ remains at the input rate.
This does not establish parity for mono/multichannel buffers, native irregular
buffer boundaries, global bypass state, or the entire native output path.

Global bypass integration is separately tested with a complete EQ/five-effect
chain at 44.1/48/96/192 kHz: disabled, enabled, original comparison, resumed.
Expected state advances only while active, matching dfxpProcessReal's branch.
The app now bypasses with undelayed input instead of its prior crossfade/delay.
The complete-chain integration reference composes independently C-validated JS
kernels; it still does not replace a single full native-chain oracle.

Mono branches are now included in clarity/widening, Lex and Maximizer C oracles.
App integration preserves one-channel processing through the entire chain and
tests mono->stereo->mono changes with native effect reinitialization. Native
multichannel surround (>2 channels) remains unported; input currently downmixes
to the app's stereo ceiling before processing.
