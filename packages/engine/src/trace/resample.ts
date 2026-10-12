/** Straight (not premultiplied) RGBA pixels, 4 bytes per pixel, rows top to bottom; a `RasterImage` fits. */
export type Bitmap = { readonly width: number; readonly height: number; readonly pixels: Uint8Array };

/** The part of `img` inside an integer pixel box that the caller has already checked lies within it. */
export function crop(img: Bitmap, box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): Bitmap {
  const pixels = new Uint8Array(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    const from = ((box.y + y) * img.width + box.x) * 4;
    pixels.set(img.pixels.subarray(from, from + box.width * 4), y * box.width * 4);
  }
  return { width: box.width, height: box.height, pixels };
}

/**
 * Shrinks `img` so its longer side is at most `maxSide`, keeping the aspect (never enlarges; an image
 * that fits comes back as is). Each new pixel is the area average of the source pixels it covers,
 * with colors weighted by alpha so transparent pixels do not tint their neighbors.
 */
export function downscale(img: Bitmap, maxSide: number): Bitmap {
  const side = Math.max(img.width, img.height);
  if (side <= maxSide) return img;
  const k = maxSide / side;
  const width = Math.max(1, Math.round(img.width * k));
  const height = Math.max(1, Math.round(img.height * k));
  const stepX = img.width / width;
  const stepY = img.height / height;
  const out = new Uint8Array(width * height * 4);
  for (let oy = 0; oy < height; oy++) {
    const y0 = oy * stepY, y1 = (oy + 1) * stepY;
    for (let ox = 0; ox < width; ox++) {
      const x0 = ox * stepX, x1 = (ox + 1) * stepX;
      let r = 0, g = 0, b = 0, alpha = 0, area = 0;
      for (let y = Math.floor(y0); y < Math.min(img.height, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(img.width, Math.ceil(x1)); x++) {
          const w = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
          const p = (y * img.width + x) * 4;
          const wa = w * img.pixels[p + 3]!;
          r += img.pixels[p]! * wa;
          g += img.pixels[p + 1]! * wa;
          b += img.pixels[p + 2]! * wa;
          alpha += wa;
          area += w;
        }
      }
      if (alpha === 0) continue;
      out.set([Math.round(r / alpha), Math.round(g / alpha), Math.round(b / alpha), Math.round(alpha / area)], (oy * width + ox) * 4);
    }
  }
  return { width, height, pixels: out };
}
