import { Registry } from './registry.ts';
import { ellipse, line, polygon, rect } from './shapes.ts';
import { group, remove } from './structure.ts';
import { style } from './style.ts';

/** A registry holding every built-in op. */
export function createRegistry(): Registry {
  return new Registry().register(rect, ellipse, polygon, line, style, group, remove);
}
