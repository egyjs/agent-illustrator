import { boolean } from './boolean.ts';
import { palette, tokens } from './color.ts';
import { blob, roughen, wave } from './generators.ts';
import { align, distribute, place, snap } from './layout.ts';
import { filter, gradient, mask } from './paint.ts';
import { pathCommands, pathFromPoints, roundCornersOp } from './paths.ts';
import { Registry } from './registry.ts';
import { array, repeatAlongPath, scatter } from './repeat.ts';
import { ellipse, line, polygon, rect, star } from './shapes.ts';
import { clip, duplicate, group, remove, rename, reorder, ungroup } from './structure.ts';
import { style } from './style.ts';
import { setText, text, textOnPath } from './text.ts';
import { transform } from './transform.ts';

/** A registry holding every built-in op. */
export function createRegistry(): Registry {
  return new Registry().register(
    rect, ellipse, polygon, star, line,
    pathFromPoints, pathCommands, roundCornersOp,
    boolean, transform,
    place, align, distribute, snap,
    style, tokens, palette, gradient, filter, mask,
    blob, wave, roughen, scatter, repeatAlongPath, array,
    text, textOnPath, setText,
    group, ungroup, reorder, duplicate, rename, clip, remove,
  );
}
