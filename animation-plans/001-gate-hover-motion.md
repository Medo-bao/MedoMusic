# 001 — Gate hover motion and keep it compositor-only

- **Status**: TODO
- **Commit**: unversioned
- **Severity**: HIGH
- **Category**: Performance and accessibility
- **Estimated scope**: 1 file, small

## Problem

`src/styles.css:426-428` animates `box-shadow` and applies movement on every
pointer type:

```css
.collection-cover {
  transition: transform 180ms var(--ease-out), box-shadow 180ms ease;
}
.collection-card:hover .collection-cover {
  transform: translateY(-2px);
  box-shadow: 0 13px 30px rgba(0, 0, 0, .22);
}
```

`box-shadow` repaints during every frame, and touch devices can retain false
hover states.

## Target

Keep the resting shadow static and animate only `transform` for fine pointers:

```css
.collection-cover { transition: transform 160ms var(--ease-out); }
@media (hover: hover) and (pointer: fine) {
  .collection-card:hover .collection-cover { transform: translateY(-2px); }
}
```

Move `.playlist-art:hover .cover-edit` into the same media query.

## Repo conventions to follow

- Use `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` from `src/styles.css:19`.
- Follow the existing pointer media query at `src/styles.css:537`.

## Steps

1. Edit `src/styles.css` and remove `box-shadow` from `.collection-cover` transition.
2. Put collection-cover and playlist-cover hover movement in the existing fine-pointer media query.
3. Preserve all resting colors, dimensions, and shadows.

## Boundaries

- Do not change markup or card layout.
- Do not add dependencies.
- Do not alter click or keyboard behavior.

## Verification

- **Mechanical**: run `npm.cmd test`; expect all checks and ZPL tests to pass.
- **Feel check**: hover album cards and confirm immediate, subtle lift without shadow repaint shimmer.
- Emulate touch and confirm no retained translated state.
- Enable reduced motion and confirm hover movement is absent.
- **Done when**: hover movement is fine-pointer-only and only `transform` is animated.
