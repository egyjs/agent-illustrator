# Layout

Ops: `place`, `align`, `distribute`, `snap`, `transform`. Let the engine compute positions: create shapes roughly where they go, then place and align them by id. All of them work on the nodes' bounds, in canvas space, groups included.

## Anchors
- The nine anchors are `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`.
- Percent coordinates are shortcuts for the canvas: `"50%"` on x is the middle, `"100%"` on y is the bottom edge.

## place
- `place` moves `ids` as one unit so their `anchor` lands on the `target_anchor` of `relative_to` (a node id or `"canvas"`), plus `offset [dx, dy]`. `target_anchor` defaults to `anchor`.
- Use it to center a label on a shape, pin something to a corner with a margin, or stack one shape on top of another (`anchor: "bottom"`, `target_anchor: "top"`).

```json
[
  {"op": "rect", "id": "card", "x": 200, "y": 180, "width": 400, "height": 240, "radius": 20, "style": {"fill": "#e9c46a"}},
  {"op": "text", "id": "title", "content": "Sale", "x": 0, "y": 0, "size": 64, "weight": "bold", "style": {"fill": "#264653"}},
  {"op": "place", "ids": ["title"], "relative_to": "card", "anchor": "center"},
  {"op": "ellipse", "id": "badge", "cx": 0, "cy": 0, "rx": 30, "style": {"fill": "#e76f51"}},
  {"op": "place", "ids": ["badge"], "relative_to": "card", "anchor": "top-right", "offset": [-16, 16]}
]
```

## align and distribute
- `align` lines `ids` up on an `edge` (`left`, `right`, `top`, `bottom`, `center-x`, `center-y`) of `to`: the selection itself (default), `"canvas"` or a node id.
- `distribute` spreads `ids` along an `axis` (`x` or `y`) between the first and the last, which stay put. `mode` `gap` (default) makes equal gaps, `center` equal center spacing. Needs 3 or more nodes.
- A row: `align` on `center-y`, then `distribute` on `x`. A column: `align` on `center-x`, then `distribute` on `y`.

```json
[
  {"op": "rect", "id": "b1", "x": 100, "y": 300, "width": 60, "height": 120, "style": {"fill": "#2a9d8f"}},
  {"op": "rect", "id": "b2", "x": 220, "y": 340, "width": 60, "height": 80, "style": {"fill": "#2a9d8f"}},
  {"op": "rect", "id": "b3", "x": 640, "y": 320, "width": 60, "height": 100, "style": {"fill": "#2a9d8f"}},
  {"op": "align", "ids": ["b1", "b2", "b3"], "edge": "bottom"},
  {"op": "distribute", "ids": ["b1", "b2", "b3"], "axis": "x"}
]
```

## snap
- `snap` nudges `ids` as one unit so a near edge or center lines up with other nodes, the canvas or a grid, within `tolerance` (default 8). `to` is a list of `nodes`, `canvas`, `grid`; `grid` sets the spacing; `targets` limits which nodes count.
- Use it to finish a nearly-aligned layout without naming edges. `lint` reports near-misses with an `align` fix.

## transform
- `transform` takes `translate [dx, dy]`, `rotate` (degrees, clockwise), `scale` (number or `[sx, sy]`), `skew [ax, ay]` (degrees) or a `matrix [a, b, c, d, e, f]`. They apply in this order: matrix, scale, skew, rotate, translate.
- `pivot` is the fixed point: an anchor name or a point `[x, y]`. `around: "each"` (default) uses every node's own bounds; `"selection"` the combined bounds, so several nodes turn together.
- Rotate a group, not its parts, to keep a drawing together. To mirror, scale by `[-1, 1]` with a `pivot`.
- Coordinates stay in canvas units after a transform; read `bounds` in the result to see where things landed.

```json
[
  {"op": "rect", "id": "blade", "x": 390, "y": 200, "width": 20, "height": 100, "style": {"fill": "#264653"}},
  {"op": "transform", "ids": ["blade"], "rotate": 35, "pivot": [400, 300]},
  {"op": "duplicate", "ids": ["blade"], "id": "blade2"},
  {"op": "transform", "ids": ["blade2"], "scale": [-1, 1], "pivot": [400, 300]}
]
```
