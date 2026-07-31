# Brand assets

## sev-monogram.png

The Sev Clinic monogram, shown beside the wordmark in the app header, the login
screen and the invite-denied screen.

**Requirements**

- **Transparent background.** The app canvas is `#0B0B0D`. A logo exported on a
  white artboard renders as a white rectangle around the mark.
- Portrait tile, roughly 1:1.9 (the gold bar with the monogram knocked out).
- PNG with alpha at 2x the largest on-screen size (the `lg` header is 56px tall,
  so ~112px tall is plenty), or an SVG renamed to `.png`'s place — if you use SVG,
  update `MONOGRAM_SRC` in `components/brand/Wordmark.tsx`.

Until this file exists the header falls back to the drawn "S" tile, so nothing
breaks — the logo simply will not be the real artwork.
