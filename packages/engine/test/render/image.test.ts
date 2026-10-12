import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { decodeImage, imageSize, MAX_IMAGE_PIXELS, type RasterImage } from '../../src/render/image.ts';
import { expectCode } from '../fixtures.ts';

/** A PNG drawn by resvg with pixel-aligned rects, so every pixel has an exact color. */
const png = (width: number, height: number, body: string): Uint8Array =>
  new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges">${body}</svg>`).render().asPng();
const at = (img: RasterImage, x: number, y: number) => Array.from(img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
const jpeg = new Uint8Array(readFileSync(new URL('./red-blue.jpg', import.meta.url)));

/** A PNG signature and IHDR chunk claiming this size; nothing after it. */
function pngHeader(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return new Uint8Array(b);
}

describe('render/image', () => {
  it('reads PNG and JPEG sizes from their headers', () => {
    expect(imageSize(png(30, 20, ''))).toEqual({ width: 30, height: 20, format: 'png' });
    expect(imageSize(jpeg)).toEqual({ width: 16, height: 8, format: 'jpeg' });
  });

  it('reads a JPEG whose frame header ends exactly at the end of the bytes', () => {
    const sof0 = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x10]);
    expect(imageSize(sof0)).toEqual({ width: 16, height: 8, format: 'jpeg' });
  });

  it('refuses bytes that are not a PNG or JPEG', () => {
    expectCode(() => imageSize(new TextEncoder().encode('<svg></svg>')), 'invalid_input');
    expectCode(() => imageSize(new Uint8Array(0)), 'invalid_input');
    expectCode(() => decodeImage(new TextEncoder().encode('GIF89a')), 'invalid_input');
  });

  it('refuses images past the pixel cap before decoding them', () => {
    const side = Math.ceil(Math.sqrt(MAX_IMAGE_PIXELS)) + 1;
    expectCode(() => imageSize(pngHeader(side, side)), 'limit_exceeded');
    expectCode(() => decodeImage(pngHeader(side, side)), 'limit_exceeded');
  });

  it('decodes a PNG to its exact pixels with straight alpha', () => {
    const img = decodeImage(png(4, 2, '<rect width="2" height="2" fill="#ff0000"/><rect x="2" width="2" height="1" fill="#0000ff"/><rect x="2" y="1" width="1" height="1" fill="#00ff00" fill-opacity="0.5"/>'));
    expect([img.width, img.height]).toEqual([4, 2]);
    expect(at(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(img, 3, 0)).toEqual([0, 0, 255, 255]);
    const half = at(img, 2, 1);
    expect(half.slice(0, 3)).toEqual([0, 255, 0]);
    expect(Math.abs(half[3]! - 128)).toBeLessThanOrEqual(1);
    expect(at(img, 3, 1)[3]).toBe(0);
  });

  it('decodes a JPEG', () => {
    const img = decodeImage(jpeg);
    expect([img.width, img.height]).toEqual([16, 8]);
    const [r, g, b, a] = at(img, 2, 4);
    expect(r).toBeGreaterThan(230);
    expect(Math.max(g!, b!)).toBeLessThan(30);
    expect(a).toBe(255);
    const [r2, , b2] = at(img, 13, 4);
    expect(b2).toBeGreaterThan(230);
    expect(r2).toBeLessThan(30);
  });

  it('downscales so the longest side fits maxSide, keeping the aspect', () => {
    const img = decodeImage(png(400, 200, '<rect width="200" height="200" fill="#ff0000"/><rect x="200" width="200" height="200" fill="#0000ff"/>'), 100);
    expect([img.width, img.height]).toEqual([100, 50]);
    expect(at(img, 10, 25)).toEqual([255, 0, 0, 255]);
    expect(at(img, 90, 25)).toEqual([0, 0, 255, 255]);
    expect([decodeImage(png(40, 20, ''), 100).width]).toEqual([40]);
  });
});
