import { boolean } from './boolean.ts';
import { align, distribute, place, snap } from './layout.ts';
import { pathCommands, pathFromPoints, roundCornersOp } from './paths.ts';
import { Registry } from './registry.ts';
import { ellipse, line, polygon, rect, star } from './shapes.ts';
import { clip, duplicate, group, remove, rename, reorder, ungroup } from './structure.ts';
import { style } from './style.ts';
import { transform } from './transform.ts';

/** A registry holding every built-in op. */
export function createRegistry(): Registry {
  return new Registry().register(
    rect, ellipse, polygon, star, line,
    pathFromPoints, pathCommands, roundCornersOp,
    boolean, transform,
    place, align, distribute, snap,
    style,
    group, ungroup, reorder, duplicate, rename, clip, remove,
  );
}
