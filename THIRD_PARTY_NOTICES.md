# Third-party notices

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
