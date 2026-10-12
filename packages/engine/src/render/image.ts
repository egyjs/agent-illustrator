import { Resvg } from '@resvg/resvg-js';
import { EngineError } from '../errors.ts';

/** Decoded pixels: straight (not premultiplied) RGBA, 4 bytes per pixel, rows top to bottom. */
export type RasterImage = { readonly width: number; readonly height: number; readonly pixels: Uint8Array };
export type ImageFormat = 'png' | 'jpeg';

/** Largest image (width × height) that is decoded at all; a few bytes of PNG can claim gigapixels. */
export const MAX_IMAGE_PIXELS = 36_000_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const notImage = () => new EngineError('invalid_input', 'the file is not a PNG or JPEG image', 'Give a .png or .jpg file; convert other formats first.');

/** Width, height and format from the PNG IHDR or the JPEG frame header, without decoding; refuses images past MAX_IMAGE_PIXELS. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; format: ImageFormat } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size: { width: number; height: number; format: ImageFormat } | undefined;
  if (bytes.length >= 24 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    size = { width: view.getUint32(16), height: view.getUint32(20), format: 'png' };
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    size = jpegSize(bytes, view);
  }
  if (size === undefined || size.width === 0 || size.height === 0) throw notImage();
  if (size.width * size.height > MAX_IMAGE_PIXELS) {
    throw new EngineError(
      'limit_exceeded',
      `a ${size.width}×${size.height} image exceeds the ${MAX_IMAGE_PIXELS}-pixel limit`,
      'Scale the image down (about 6000×6000 at most) before using it.',
    );
  }
  return size;
}

/** Walks JPEG markers to the first start-of-frame (SOF0–SOF15 except DHT, JPG and DAC). */
function jpegSize(bytes: Uint8Array, view: DataView): { width: number; height: number; format: 'jpeg' } | undefined {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return undefined;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: view.getUint16(i + 7), height: view.getUint16(i + 5), format: 'jpeg' };
    }
    i += 2 + view.getUint16(i + 2);
  }
  return undefined;
}

/**
 * Decodes a PNG or JPEG through resvg, scaled down so its longer side is at most `maxSide` (never
 * up). An image resvg cannot decode past a valid header comes back fully transparent.
 */
export function decodeImage(bytes: Uint8Array, maxSide?: number): RasterImage {
  const { width, height, format } = imageSize(bytes);
  const k = maxSide !== undefined && Math.max(width, height) > maxSide ? maxSide / Math.max(width, height) : 1;
  const [w, h] = [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
  const href = `data:image/${format};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="${href}"/></svg>`;
  const image = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
  return { width: image.width, height: image.height, pixels: unpremultiply(new Uint8Array(image.pixels)) };
}

/** resvg returns premultiplied RGBA; divide the color back out of partly transparent pixels, in place. */
function unpremultiply(px: Uint8Array): Uint8Array {
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]!;
    if (a === 0 || a === 255) continue;
    for (let c = i; c < i + 3; c++) px[c] = Math.min(255, Math.round((px[c]! * 255) / a));
  }
  return px;
}
