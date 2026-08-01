# 002 — Scope compositor promotion to active motion

- **Status**: TODO
- **Commit**: unversioned
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 2 files, small

## Problem

`src/styles.css:513` and `src/styles.css:523` permanently apply:

```css
will-change: transform, opacity;
```

The mini cover and play button remain promoted even while idle, retaining
unnecessary compositor memory throughout the application session.

## Target

Remove permanent `will-change` declarations. In `src/renderer.js`, set
`element.style.willChange = "transform, opacity"` immediately before the
existing 150–180ms WAAPI calls, then clear it in both `animation.onfinish` and
`animation.oncancel`.

## Repo conventions to follow

- Keep the existing WAAPI easing `cubic-bezier(0.23, 1, 0.32, 1)`.
- Keep current durations: cover 180ms and play feedback 150ms.

## Steps

1. Remove both permanent `will-change` declarations from `src/styles.css`.
2. Add a small renderer helper that promotes an element only for an active animation.
3. Use it for mini-cover and play/pause feedback animations.
4. Clear the property after finish or cancellation.

## Boundaries

- Do not change animation keyframes or durations.
- Do not add a motion library.
- Do not touch playback behavior.

## Verification

- **Mechanical**: run `npm.cmd test`; expect success.
- **Feel check**: rapidly switch songs and play/pause; confirm no visual regression.
- Inspect Layers while idle and confirm the two controls are not permanently promoted.
- **Done when**: `will-change` exists only during active animations.
