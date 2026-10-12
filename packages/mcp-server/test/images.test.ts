import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EngineError } from '@agent-illustrator/engine';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { imageSource } from '../src/images.ts';

const png = (w: number, h: number, fill = '#ff0000'): Uint8Array =>
  new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`).render().asPng();
const folder = (): string => mkdtempSync(join(tmpdir(), 'ai-images-'));
const failure = (run: () => unknown): EngineError => {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    return e as EngineError;
  }
  throw new Error('expected an EngineError');
};

describe('imageSource', () => {
  it('decodes a PNG at its full size', () => {
    const dir = folder();
    writeFileSync(join(dir, 'red.png'), png(6, 4));
    const image = imageSource({ cwd: dir }).get(join(dir, 'red.png'));
    expect([image.width, image.height, image.pixels.length]).toEqual([6, 4, 6 * 4 * 4]);
    expect([...image.pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it('resolves a relative path against the cwd option', () => {
    const dir = folder();
    mkdirSync(join(dir, 'art'));
    writeFileSync(join(dir, 'art', 'a.png'), png(3, 2));
    expect(imageSource({ cwd: dir }).get('art/a.png').width).toBe(3);
  });

  it('a missing file is invalid_input naming the resolved path and the cwd, never the contents', () => {
    const dir = folder();
    const e = failure(() => imageSource({ cwd: dir }).get('nope.png'));
    expect(e.info.code).toBe('invalid_input');
    expect(e.info.message).toBe(`no file at "${resolve(dir, 'nope.png')}"`);
    expect(e.info.hint).toBe(`Pass an absolute path to a PNG or JPEG file; relative paths resolve against ${dir}.`);
  });

  it('a folder is invalid_input', () => {
    const dir = folder();
    mkdirSync(join(dir, 'pics.png'));
    const e = failure(() => imageSource({ cwd: dir }).get('pics.png'));
    expect(e.info.code).toBe('invalid_input');
    expect(e.info.message).toContain('not a file');
  });

  it('refuses Windows device names whatever the extension, without touching the disk', () => {
    const dir = folder();
    for (const name of ['CON.png', 'nul', 'aux.jpg', 'COM1.png', 'lpt3.PNG']) {
      const e = failure(() => imageSource({ cwd: dir }).get(join(dir, name)));
      expect(e.info.code, name).toBe('invalid_input');
      expect(e.info.message, name).toContain('device');
    }
  });

  it('a file over maxBytes is limit_exceeded and names both sizes', () => {
    const dir = folder();
    const bytes = png(40, 40);
    writeFileSync(join(dir, 'big.png'), bytes);
    const e = failure(() => imageSource({ cwd: dir, maxBytes: 100 }).get('big.png'));
    expect(e.info.code).toBe('limit_exceeded');
    expect(e.info.message).toContain(`${bytes.length} bytes`);
    expect(e.info.message).toContain('100 bytes');
  });

  it('a text file is the engine invalid_input, unchanged and without the text', () => {
    const dir = folder();
    writeFileSync(join(dir, 'notes.png'), 'secret words, not an image');
    const e = failure(() => imageSource({ cwd: dir }).get('notes.png'));
    expect(e.info.code).toBe('invalid_input');
    expect(e.info.message).toBe('the file is not a PNG or JPEG image');
    expect(JSON.stringify(e.info)).not.toContain('secret');
  });

  it('rewriting a file with a different size is picked up', () => {
    const dir = folder();
    const file = join(dir, 'pic.png');
    const source = imageSource({ cwd: dir });
    writeFileSync(file, png(4, 4));
    expect(source.get(file).width).toBe(4);
    writeFileSync(file, png(9, 5, '#0000ff'));
    const again = source.get(file);
    expect([again.width, again.height]).toEqual([9, 5]);
  });

  it('serves a repeat read from the cache, and an image over the pixel budget is still returned', () => {
    const dir = folder();
    writeFileSync(join(dir, 'a.png'), png(8, 8));
    const source = imageSource({ cwd: dir });
    expect(source.get('a.png')).toBe(source.get('a.png'));
    const tiny = imageSource({ cwd: dir, cachePixels: 10 });
    expect(tiny.get('a.png').width).toBe(8);
  });

  it('evicts the least recently used image once the cached pixels pass the budget', () => {
    const dir = folder();
    for (const name of ['a', 'b', 'c']) writeFileSync(join(dir, `${name}.png`), png(10, 10));
    const source = imageSource({ cwd: dir, cachePixels: 200 }); // room for two 100-pixel images
    const a = source.get('a.png');
    const b = source.get('b.png');
    expect(source.get('a.png')).toBe(a); // a is now the most recent
    const c = source.get('c.png'); // pushes out b, the least recent
    expect(source.get('a.png')).toBe(a);
    expect(source.get('c.png')).toBe(c);
    expect(source.get('b.png')).not.toBe(b);
  });
});
