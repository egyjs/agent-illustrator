# Shapes and paths

Ops: `rect`, `ellipse`, `polygon`, `star`, `line`, `path_from_points`, `path_commands`, `round_corners`, `boolean`. Every shape is a path in the document; set its look in `style` when you create it.

## Primitives
- `rect`: top-left `x, y`, `width, height`, optional `radius` for rounded corners.
- `ellipse`: center `cx, cy`, radius `rx`; `ry` defaults to `rx` (a circle).
- `polygon`: `sides` corners on a circle of `radius` around `cx, cy`, first corner pointing up; `rotation` in degrees, clockwise. Three sides make a triangle, six a hexagon.
- `star`: `points` tips between `outer` and `inner` radius; `roundness` 0..1 softens the corners.
- `line`: `x1, y1` to `x2, y2`. It has no fill, so give it a `stroke` and `strokeWidth`.
- Always set `fill` (or `stroke`) yourself. Use `"fill": "none"` for outlines.

```json
[
  {"op": "rect", "id": "wall", "x": 300, "y": 300, "width": 200, "height": 150, "style": {"fill": "#e9c46a"}},
  {"op": "polygon", "id": "roof", "cx": 400, "cy": 290, "radius": 150, "sides": 3, "style": {"fill": "#e76f51"}},
  {"op": "rect", "id": "door", "x": 380, "y": 370, "width": 40, "height": 80, "radius": 6, "style": {"fill": "#264653"}},
  {"op": "star", "id": "star", "cx": 620, "cy": 140, "outer": 40, "inner": 18, "points": 5, "roundness": 0.2, "style": {"fill": "#ffb703"}}
]
```

## Free-form paths
- `path_from_points` goes through `points [[x, y], ...]`. `mode` `polyline` joins them with straight lines, `smooth` draws a curve through every point (hills, waves, organic outlines), `fit` approximates many points with a few curves within `tolerance` px. `closed: true` joins the last point to the first.
- `path_commands` takes SVG path data in `d` (`M L H V C S Q T A Z`, absolute or relative). Use it for exact curves such as leaves, drops and arrows. `fillRule: "evenodd"` turns inner loops into holes.
- A closed path with a `fill` is a shape; an open path with `"fill": "none"` and a `stroke` is a line. Add `strokeCap: "round"` and `strokeJoin: "round"` for friendly strokes.

```json
[
  {"op": "path_from_points", "id": "ridge", "points": [[0, 400], [150, 280], [300, 380], [480, 240], [650, 360], [800, 300]], "mode": "smooth", "style": {"fill": "none", "stroke": "#264653", "strokeWidth": 4, "strokeCap": "round"}},
  {"op": "path_commands", "id": "leaf", "d": "M400 420 Q480 480 400 580 Q320 480 400 420 Z", "style": {"fill": "#52b788"}}
]
```

## Combine and soften
- `boolean` merges filled shapes: `union`, `subtract` (the first minus the rest), `intersect`, `exclude`. The result is one new path, placed where the first shape was and styled like it; the inputs go away unless `keep: true`. Give it an `id`. Groups count as the union of their parts. Text cannot take part.
- `round_corners` rounds the sharp corners of paths with a `radius` (clamped to half of each edge). Use it on polygons and `path_from_points` shapes; `rect` has its own `radius`.
- Build complex silhouettes from simple pieces: a crescent is a circle minus a circle, a ring a circle minus a smaller one, a cloud the union of circles.

```json
[
  {"op": "ellipse", "id": "moon", "cx": 400, "cy": 300, "rx": 100, "style": {"fill": "#f4f1de"}},
  {"op": "ellipse", "id": "bite", "cx": 440, "cy": 280, "rx": 85},
  {"op": "boolean", "mode": "subtract", "ids": ["moon", "bite"], "id": "crescent"},
  {"op": "polygon", "id": "tri", "cx": 150, "cy": 450, "radius": 70, "sides": 3, "style": {"fill": "#e76f51"}},
  {"op": "round_corners", "ids": ["tri"], "radius": 14}
]
```
