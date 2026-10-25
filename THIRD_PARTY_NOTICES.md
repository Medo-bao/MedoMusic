# Third-party notices

## Koffi

Windows 10 desktop glass uses [Koffi](https://koffi.dev/) 3.3.2 to call the
Windows composition API from the main process. Koffi is MIT licensed;
the license is included in `src/licenses/Koffi-MIT.txt`.

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

## OpenCC traditional-to-simplified table

`src/zh-convert.js` contains a single-character Traditional-to-Simplified
Chinese map derived from OpenCC's `data/dictionary/TSCharacters.txt`
(only one-to-one single-character entries are kept).

- Project: [BYVoid/OpenCC](https://github.com/BYVoid/OpenCC)
- Source data: `data/dictionary/TSCharacters.txt`
- License: Apache License 2.0
- Copyright: Copyright (c) 2010-2023 Carbo Kuo and contributors

## Offline TTML parser

`src/ttml.js` independently implements a TTML reader whose feature scope
(background vocals, translations, transliterations, agent alignment) was
informed by [WXRIW/Lyricify-Lyrics-Helper](https://github.com/WXRIW/Lyricify-Lyrics-Helper)
(Apache License 2.0). No Lyricify source code is copied, and no Lyricify binary
is bundled.

## xmldom

The Node-side TTML reader uses [@xmldom/xmldom](https://github.com/xmldom/xmldom)
0.8.13 under the MIT license. Its copyright and license are included in
`node_modules/@xmldom/xmldom/LICENSE`. Browser rendering uses the built-in
`DOMParser` with the same namespace-aware parser logic.

## Lyric test fixtures

`tests/fixtures/apple/syllable-demo.json` is public sample data from
Lyricify Lyrics Helper (Apache License 2.0) and is used only as a parser
regression fixture. `tests/fixtures/apple/synthetic-translations.ttml` was
written for this project.
