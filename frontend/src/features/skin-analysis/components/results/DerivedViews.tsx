import { useEffect, useRef } from "react";
import { pigmentationMap, rednessMap, textureMap } from "../../ml/derived-views";

export const DERIVED_LABELS = {
  original: "Original",
  pigmentation: "Pigmentation",
  redness: "Redness",
  texture: "Texture",
} as const;

type MapFn = (rgba: Uint8ClampedArray, w: number, h: number) => Uint8ClampedArray;

// Colorize an intensity buffer onto a canvas: intensity → alpha over one hue.
function paintIntensity(canvas: HTMLCanvasElement, intensity: Uint8ClampedArray, w: number, h: number, hue: [number, number, number]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  for (let p = 0; p < intensity.length; p++) {
    img.data[p * 4] = hue[0];
    img.data[p * 4 + 1] = hue[1];
    img.data[p * 4 + 2] = hue[2];
    img.data[p * 4 + 3] = intensity[p];
  }
  ctx.putImageData(img, 0, 0);
}

export function DerivedViews({ blob }: { blob: Blob }) {
  const refs = {
    original: useRef<HTMLCanvasElement | null>(null),
    pigmentation: useRef<HTMLCanvasElement | null>(null),
    redness: useRef<HTMLCanvasElement | null>(null),
    texture: useRef<HTMLCanvasElement | null>(null),
  };

  useEffect(() => {
    let revoked = false;
    void (async () => {
      const bitmap = await createImageBitmap(blob);
      if (revoked) return;
      const w = bitmap.width;
      const h = bitmap.height;
      const base = refs.original.current;
      if (base) {
        base.width = w;
        base.height = h;
        base.getContext("2d")?.drawImage(bitmap, 0, 0);
      }
      const src = document.createElement("canvas");
      src.width = w;
      src.height = h;
      const sctx = src.getContext("2d");
      if (!sctx) return;
      sctx.drawImage(bitmap, 0, 0);
      const rgba = sctx.getImageData(0, 0, w, h).data;

      const views: [keyof typeof refs, MapFn, [number, number, number]][] = [
        ["pigmentation", (d) => pigmentationMap(d), [146, 64, 14]],
        ["redness", (d) => rednessMap(d), [220, 38, 38]],
        ["texture", (d, ww, hh) => textureMap(d, ww, hh), [15, 118, 110]],
      ];
      for (const [key, fn, hue] of views) {
        const c = refs[key].current;
        if (!c) continue;
        c.width = w;
        c.height = h;
        paintIntensity(c, fn(rgba, w, h), w, h, hue);
      }
    })();
    return () => {
      revoked = true;
    };
  }, [blob]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(DERIVED_LABELS) as (keyof typeof DERIVED_LABELS)[]).map((key) => (
          <figure key={key}>
            <canvas
              ref={refs[key]}
              className="w-full rounded-lg border border-stone-200 bg-stone-900"
              aria-label={DERIVED_LABELS[key]}
            />
            <figcaption className="mt-1 text-center text-xs text-stone-600">
              {DERIVED_LABELS[key]}
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="mt-2 text-xs text-stone-500">
        Pigmentation, redness, and texture are <strong>derived from the visible-light photo</strong> —
        not spectral, UV, or infrared imaging.
      </p>
    </div>
  );
}
