# Third-party notices

## FxSound algorithm port

`src/fxsound-core.js` is derived from FxSound LLC's 2025 sources, pinned to
revision `d8e7a23d37ed5939c2a3090a1c1756c7f2500b17` of
[fxsound2/fxsound-app](https://github.com/fxsound2/fxsound-app).
The port is licensed under GNU AGPL version 3 or later. The license is included
in `src/licenses/FxSound-AGPL-3.0.txt`. Source provenance and unmodified reference
files are in `tests/reference/fxsound/`. No FxSound native DLL or driver is bundled.

## Lyricify Lyrics Helper

MedoMusic's lyric timeline and compatibility design was informed by
[WXRIW/Lyricify-Lyrics-Helper](https://github.com/WXRIW/Lyricify-Lyrics-Helper),
licensed under the Apache License 2.0.

MedoMusic currently uses its own JavaScript implementation for embedded lyrics
and same-basename LRC sidecar files. No Lyricify binary is bundled.

The desktop lyrics island is inspired by Lyricify's Dynamic Lyrics Island
concept. That attributed interface concept is used under CC BY-SA 4.0 and this
adapted component is offered under the same terms.

## LRCLIB

When the user enables online lyric completion, MedoMusic queries the public
[LRCLIB](https://lrclib.net/) API using the track title, artist, album and
duration. Results are cached locally and local lyrics always take priority.
