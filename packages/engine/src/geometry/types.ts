/**
 * Plain geometry data shared by the engine (spec A3). SVG user space: x right, y down.
 * Positive signed area means clockwise on screen.
 */
export type Vec2 = readonly [x: number, y: number];

/** One cubic segment from the previous end point: [c1x, c1y, c2x, c2y, x, y]. */
export type Seg = readonly [c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number];

/**
 * A run of cubic segments. Closed subpaths built by geometry end their last segment exactly at
 * `start`; consumers also accept a closed subpath without that segment (implicit straight close).
 */
export type Subpath = { readonly start: Vec2; readonly segs: readonly Seg[]; readonly closed: boolean };

/** One cubic as its four points P0..P3. */
export type Cubic = readonly [x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number];

/** Affine matrix in SVG order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Mat6 = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export type FillRule = 'nonzero' | 'evenodd';
