// Deterministic transforms of a captured RGB frame — the honest camera analog
// of multi-spectral device modes. NOT spectral/UV/IR imaging, NOT AI.
// Each returns one intensity byte (0..255) per pixel.

function intensityBuffer(rgba: Uint8ClampedArray): Uint8ClampedArray {
  return new Uint8ClampedArray(rgba.length / 4);
}

const clamp = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : n);

// Brown/melanin cue: warmth (R over B) where the pixel is skin-toned.
export function pigmentationMap(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = intensityBuffer(rgba);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    out[p] = clamp((rgba[i] - rgba[i + 2]) * 1.5);
  }
  return out;
}

// Erythema/vascular cue: red over the green/blue average.
export function rednessMap(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = intensityBuffer(rgba);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    out[p] = clamp((rgba[i] - (rgba[i + 1] + rgba[i + 2]) / 2) * 1.5);
  }
  return out;
}

// Surface relief: local luma contrast (|luma - 4-neighbour mean|).
export function textureMap(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    luma[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      let sum = 0;
      let n = 0;
      if (x > 0) (sum += luma[p - 1]), n++;
      if (x < width - 1) (sum += luma[p + 1]), n++;
      if (y > 0) (sum += luma[p - width]), n++;
      if (y < height - 1) (sum += luma[p + width]), n++;
      out[p] = n === 0 ? 0 : clamp(Math.abs(luma[p] - sum / n));
    }
  }
  return out;
}
