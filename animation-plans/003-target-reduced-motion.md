# 003 — Replace global reduced-motion overrides with targeted feedback

- **Status**: TODO
- **Commit**: unversioned
- **Severity**: MEDIUM
- **Category**: Accessibility and cohesion
- **Estimated scope**: 1 file, medium

## Problem

`src/styles.css:542-550` globally forces every animation to 1ms and every
transition to 80ms:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 80ms !important;
  }
}
```

This removes useful opacity feedback while still allowing some transform end
states. Reduced motion should remove movement but retain short state feedback.

## Target

Use component-targeted rules. Movement must become `transform: none !important`;
opacity and color feedback may remain at `80ms cubic-bezier(0.23, 1, 0.32, 1)`.
Do not globally overwrite unrelated transitions.

## Repo conventions to follow

- Renderer WAAPI already branches on `prefers-reduced-motion` in
  `src/renderer.js:692`.
- Use the existing `--ease-out` token.

## Steps

1. Remove the universal animation and transition duration overrides.
2. Target `.empty-state`, `.collection-cover`, `.cover-edit`, buttons, and other moving elements.
3. Disable transforms for reduced motion while preserving opacity/color feedback at 80ms.
4. Confirm the prototype picker follows the same principle if it is retained.

## Boundaries

- Do not remove focus, active, or selected-state feedback.
- Do not change normal-motion timings.
- Do not introduce keyframes.

## Verification

- **Mechanical**: run `npm.cmd test`; expect success.
- **Feel check**: toggle reduced motion in DevTools and navigate every main view.
- Confirm no element changes position or scale, while selections still visibly update.
- **Done when**: reduced motion is non-vestibular and remains informative.
