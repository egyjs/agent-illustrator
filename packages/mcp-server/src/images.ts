import { readFileSync, statSync, type Stats } from 'node:fs';
import { basename, resolve } from 'node:path';
import { decodeImage, EngineError, type ImageSource, type RasterImage } from '@agent-illustrator/engine';
import { DEVICE } from './history-tools.ts';

/** Largest image file read; the decoder separately caps the pixel count. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Decoded pixels kept between calls, so a preview and the commit that follows decode the file once. */
const CACHE_PIXELS = 64_000_000;

export type ImageSourceOptions = {
  /** What relative paths resolve against; default the server's working directory. */
  readonly cwd?: string;
  readonly maxBytes?: number;
  /** Cache budget in decoded pixels; the least recently used images go first. */
  readonly cachePixels?: number;
};

type Cached = { readonly mtimeMs: number; readonly size: number; readonly image: RasterImage };

const sizeText = (bytes: number): string => (bytes >= 2 ** 20 ? `${(bytes / 2 ** 20).toFixed(1)} MB` : `${bytes} bytes`);

/** Stats the file; undefined when there is none. Anything else the system refuses (permissions, say) is an input error too. */
function statFile(file: string): Stats | undefined {
  try {
    return statSync(file, { throwIfNoEntry: false });
  } catch (e) {
    throw unreadable(file, e);
  }
}

function unreadable(file: string, e: unknown): EngineError {
  const code = (e as NodeJS.ErrnoException).code;
  return new EngineError('invalid_input', `cannot read "${file}"${code ? ` (${code})` : ''}`, 'Check that the server may read the file, or pass another path.');
}

/**
 * Reference images from file paths (PNG or JPEG), decoded at full size. The path may point anywhere the
 * server can read, but only vectors leave the engine, and a file that is not an image is refused by its header.
 */
export function imageSource(options: ImageSourceOptions = {}): ImageSource {
  const { maxBytes = MAX_IMAGE_BYTES, cachePixels = CACHE_PIXELS } = options;
  const cache = new Map<string, Cached>(); // oldest first: a hit moves its entry to the end
  let cached = 0;

  const drop = (file: string): void => {
    const entry = cache.get(file);
    if (entry === undefined) return;
    cache.delete(file);
    cached -= entry.image.width * entry.image.height;
  };

  return {
    get(ref: string): RasterImage {
      const cwd = options.cwd ?? process.cwd();
      const file = resolve(cwd, ref);
      if (DEVICE.test(basename(file))) {
        throw new EngineError('invalid_input', `"${basename(file)}" is a Windows device name, not a file`, 'Rename the file, then pass its path.');
      }
      const stats = statFile(file);
      if (stats === undefined) {
        throw new EngineError('invalid_input', `no file at "${file}"`, `Pass an absolute path to a PNG or JPEG file; relative paths resolve against ${cwd}.`);
      }
      if (!stats.isFile()) throw new EngineError('invalid_input', `"${file}" is not a file`, 'Pass the path of a PNG or JPEG file, not a folder.');
      if (stats.size > maxBytes) {
        throw new EngineError('limit_exceeded', `the image file is ${sizeText(stats.size)}; the limit is ${sizeText(maxBytes)}`, 'Scale the image down, or save it as a smaller PNG or JPEG.');
      }

      const hit = cache.get(file);
      if (hit !== undefined && hit.mtimeMs === stats.mtimeMs && hit.size === stats.size) {
        cache.delete(file);
        cache.set(file, hit);
        return hit.image;
      }
      drop(file);
      let bytes: Uint8Array;
      try {
        bytes = readFileSync(file);
      } catch (e) {
        throw unreadable(file, e);
      }
      const image = decodeImage(bytes);
      cache.set(file, { mtimeMs: stats.mtimeMs, size: stats.size, image });
      cached += image.width * image.height;
      for (const oldest of cache.keys()) {
        if (cached <= cachePixels) break;
        drop(oldest); // the new image goes too when it alone is over the budget; it is still returned
      }
      return image;
    },
  };
}
