# Critique and fix

Tools: `render`, `lint`, `describe_scene`, `measure`. Check after each stage, not only at the end: a mistake caught early costs one op, a late one costs a rebuild.

## Look at the picture
- `render` shows the canvas. Add overlay `ids` to read which id is which, `bounds` to see exact boxes, `grid` (with `grid: 100`) to read coordinates.
- Zoom with `region {x, y, width, height}` and `scale: 2` to inspect a detail without losing the full view.
- Ask: Does the eye land on the focal point first? Do the big masses balance? Is there a clear front, middle and back? Are values (light and dark) separated enough to read at thumbnail size? Is anything cut off, crowded, floating or touching by accident?

## Read the scene as text
- `describe_scene` returns the tree with each node's bounds and style. `detail` `outline` (ids and boxes only), `normal`, `full` (adds geometry); `root` limits it to one group. Use it to find out what exists before editing.
- `measure` with `ids` returns bounds, center, area and path length per node; with 2-12 ids also the center distance, `gap` on each axis and whether and how much shapes `overlap`. Use it to check spacing, sizes and that a lid sits on its jar.

## lint
- `lint` returns `issues`: `{code, severity, ids, message, hint, fix?}`, warnings first. `fix` is a ready op call. Optional `checks` picks checks (`off_canvas`, `degenerate`, `tiny`, `near_miss`, `text_overlap`, `contrast`, `overlap`; the last is off by default), `ids` limits it to those nodes and the pairs they form, `tolerance` sets the near-miss distance in px.
- `off_canvas`: a shape lies fully outside the canvas. Move it in (the fix places it at the center) or delete it. `partly_off_canvas` (info) is fine for a deliberate bleed.
- `degenerate`, `empty_group`, `no_ink`: nothing visible is there. Delete it or find the op that failed to draw it.
- `tiny` (info): a shape smaller than a couple of units. Enlarge it or delete it.
- `near_miss`: two siblings that almost line up on an edge or center. Apply the `align` fix, or move one deliberately if the offset is a design choice.
- `text_overlap`: two labels collide. Move one with `place`, shorten, or shrink it.
- `low_contrast`: text is hard to read on what is behind it. The `fix` restyles the text color; or change the background.
- `overlap` (info) is off by default, since shapes overlap on purpose in drawings. Ask for it with `checks` when pieces should not touch (a layout, a chart).
- Judge each issue: the fix repairs the number, not always the design.

## Apply fixes
- Pass the `fix` object to `apply_ops` unchanged, together with your own edits in one batch. Use `dry_run: true` first when unsure.
- After a fix, `lint` again with `ids` set to the nodes you changed, and `render` the area if it was a visual change.

```json
[
  {"op": "rect", "id": "panel", "x": 100, "y": 100, "width": 300, "height": 200, "style": {"fill": "#9a9a9a"}},
  {"op": "text", "id": "label", "content": "Hello", "x": 130, "y": 220, "size": 48, "style": {"fill": "#8a8a8a"}},
  {"op": "style", "ids": ["label"], "style": {"fill": "#111111"}},
  {"op": "rect", "id": "b1", "x": 500, "y": 100, "width": 80, "height": 80, "style": {"fill": "#2a9d8f"}},
  {"op": "rect", "id": "b2", "x": 503, "y": 220, "width": 80, "height": 80, "style": {"fill": "#2a9d8f"}},
  {"op": "align", "ids": ["b1", "b2"], "edge": "left"}
]
```
The `style` op is what a `low_contrast` fix looks like; the `align` op is a `near_miss` fix.

## When to stop
- No warnings left, the render reads clearly at small size, and one more round of detail would not change what the picture says.
