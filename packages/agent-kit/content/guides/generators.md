# Generators

Ops: `blob`, `wave`, `roughen`, `scatter`, `repeat_along_path`, `array`. They make many shapes or organic outlines from a few numbers. Use them for hills, clouds, foliage, stars, patterns and fences instead of placing every piece by hand.

## Seeds
- Randomness is seeded. The same `seed` (default: the document seed from `create_document`) and the same `id` always give the same result, so a re-run never changes the picture.
- Pass your own `seed` to get a different version of one generator without touching the others. Give every generated node an `id`.

## Organic shapes
- `blob`: a closed soft shape with `points` anchors around `radius`. `randomness` (0..1) is the share of the radius the outline may wobble, `frequency` how fast it wobbles. Good for clouds, bushes, puddles, stones.
- `wave`: a sine line from `x, y` across `width`, `amplitude` high, one cycle per `wavelength`; `phase` shifts it in degrees. Add `bottom` (a y) and it becomes a closed band down to that y that you can fill: sea, dunes, layered hills.
- `roughen` pushes the outline of the paths in `ids` sideways by up to `amount`, sampled every `detail`, for a hand-drawn look. It edits paths in place and skips text. Try `amount` 1-3 and `detail` 8-16; checkpoint first.

```json
[
  {"op": "wave", "id": "hill_far", "x": 0, "y": 380, "width": "100%", "amplitude": 40, "wavelength": 500, "bottom": "100%", "style": {"fill": "#8ecae6"}},
  {"op": "wave", "id": "hill_near", "x": 0, "y": 450, "width": "100%", "amplitude": 30, "wavelength": 320, "phase": 90, "bottom": "100%", "style": {"fill": "#2a9d8f"}},
  {"op": "blob", "id": "cloud", "cx": 200, "cy": 120, "radius": 60, "points": 9, "randomness": 0.3, "seed": 4, "style": {"fill": "#ffffff"}},
  {"op": "roughen", "ids": ["cloud"], "amount": 2, "detail": 12}
]
```

## Many copies
- `scatter` fills an area with copies of `source` at evenly spread random spots, no closer than `min_distance`. The area is the fill of the node `within` (it stays), or a `region {x, y, width, height}`. Each copy gets a random `scale` and `rotate` from `[min, max]`. `density {angle, from, to}` thins copies along a direction; `max_count` caps the number.
- `repeat_along_path` places `source` along the path `path` (it stays): `count` copies over the whole length, or one every `spacing`. `align` (default true) turns each copy along the path; `offset` shifts the start.
- `array` repeats `source`: `kind: "grid"` with `rows`, `cols` and a `gap [x, y]` (or `spacing` from copy to copy); `kind: "radial"` with `count` copies around `center` (default: canvas center) over `sweep` degrees (default 360).
- The source is removed unless `keep: true`, so make it a plain shape first. Copies land in a new group named by `id`; restyle them all by styling that group.
- `scatter` and `repeat_along_path` center each copy on its point, wherever the source was drawn. `array` keeps the source where it is: it is the first grid cell, or it sets the radius of the ring.
- Default limits: 2000 copies per op, 5000 nodes per document.

```json
[
  {"op": "rect", "id": "sky", "x": 0, "y": 0, "width": "100%", "height": "100%", "style": {"fill": "#14213d"}},
  {"op": "star", "id": "spark", "cx": 0, "cy": 0, "outer": 6, "inner": 2.5, "points": 4, "style": {"fill": "#ffffff"}},
  {"op": "scatter", "id": "stars", "source": "spark", "within": "sky", "min_distance": 50, "scale": [0.5, 1.5], "rotate": [0, 45], "density": {"angle": 90, "from": 1, "to": 0.1}, "max_count": 120, "seed": 5},
  {"op": "path_commands", "id": "road", "d": "M40 520 C 250 400, 550 640, 760 500", "style": {"fill": "none", "stroke": "#adb5bd", "strokeWidth": 2}},
  {"op": "ellipse", "id": "lamp", "cx": 0, "cy": 0, "rx": 6, "style": {"fill": "#ffb703"}},
  {"op": "repeat_along_path", "id": "lamps", "source": "lamp", "path": "road", "count": 9},
  {"op": "rect", "id": "ray", "x": 397, "y": 110, "width": 6, "height": 40, "style": {"fill": "#ffb703"}},
  {"op": "array", "id": "burst", "source": "ray", "kind": "radial", "count": 12, "center": [400, 200]}
]
```
