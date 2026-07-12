// One-shot: writes 192px + 512px maskable PNG icons for the PWA manifest.
// Solid clinical-teal fill with a white "S" glyph. Regenerate anytime with:
//   node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const OUT_DIR = resolve(process.cwd(), "frontend/public/icons");
mkdirSync(OUT_DIR, { recursive: true });

const BG = "#0f766e";
const FG = "#ffffff";

async function makeIcon(size) {
  const glyphSize = Math.round(size * 0.6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${BG}"/>
    <text x="50%" y="50%"
          dominant-baseline="central" text-anchor="middle"
          font-family="-apple-system, Helvetica, Arial, sans-serif"
          font-weight="700" font-size="${glyphSize}" fill="${FG}">S</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const path = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}

await makeIcon(192);
await makeIcon(512);
