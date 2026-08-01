# 001 - Improve lyric exploration and detail feedback

- **Status**: DONE
- **Commit**: N/A (workspace is not a Git repository)
- **Severity**: HIGH
- **Category**: Interaction feedback, interruptibility, performance
- **Estimated scope**: 4 files, medium

## Problem

The library pivots in `src/styles.css` only expose the active underline and provide no hover feedback, while the synchronized lyric transform in `src/renderer.js` always follows playback and offers no user-controlled inspection state. The desktop lyric lock reveal is tied to repeated mouse movement instead of actual pointer stillness.

## Target

- Pivots receive immediate color/surface feedback and `scale(.97)` press feedback within 160ms.
- Lyrics support pointer drag with pointer capture, direct GPU `transform` updates, hover feedback, and automatic playback-follow restoration after 5000ms idle.
- Desktop lyric controls appear after the pointer remains within the window for 3000ms and include explicit font size controls.
- Motion uses `cubic-bezier(0.23, 1, 0.32, 1)`, remains under 300ms for feedback, and honors reduced motion.

## Repo conventions to follow

- Reuse `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` from `src/styles.css`.
- Use pointer capture as already used by track reordering in `src/renderer.js`.
- Animate only transform, opacity, color, and background-color.

## Steps

1. Add hover, focus-visible, and active feedback for `.pivot`.
2. Add lyric inspection state and pointer handlers to `.lyrics-stage`.
3. Suspend automatic lyric centering while inspecting and restore it after 5000ms.
4. Fix desktop lyric stillness detection and add font size controls.
5. Redesign the detail background with layered artwork, tint, and vignette.

## Boundaries

- Do not add dependencies.
- Do not change audio timing while dragging lyrics.
- Do not animate layout properties during pointer movement.

## Verification

- Run `npm run test`.
- Hover and press every library pivot and confirm feedback is immediate.
- Drag synchronized lyrics, release, wait five seconds, and confirm the active line returns smoothly.
- Leave the pointer stationary over desktop lyrics for three seconds and confirm controls appear.
- Enable reduced motion and confirm positional entrance motion is reduced.
