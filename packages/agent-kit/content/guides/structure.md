# Structure

Ops: `group`, `ungroup`, `reorder`, `duplicate`, `clip`, `rename`, `delete`; the `parent` field of the drawing ops; `$last`. The document is a tree: groups hold shapes, and a node paints over the siblings before it.

## Ids
- An id starts with a letter or `_` and uses letters, digits, `_`, `.`, `-`. Pick meaning, not numbers: `trunk`, `window_left`. Do not name a node `canvas`.
- A taken id gets a suffix (`tree-2`) and a warning. Leave `id` out and the engine names the node `rect-1`, `ellipse-2`...
- `$last` is the most recently created node: handy in `style`, `transform` and `place` right after drawing. Use real ids for anything you need again.
- `rename` gives a node a new id; every reference follows.

## Groups
- `group` wraps sibling nodes (same parent) in a new group placed where the topmost member was. Members keep their order and look. Group what moves together: a tree, a house, a face.
- Fill and stroke set on a group (with `style`) are inherited by members that do not set their own. Opacity, filter and blend on a group apply to the group as a whole: group opacity fades the picture once, with no overlaps showing through.
- `parent` on a drawing op puts the new node inside that group. `ungroup` dissolves groups and moves their children up; remove the group's clip, mask, filter or blend first.
- `transform`, `place` and `align` treat a group as one object.

## Order
- Paint order is sibling order: later is on top. `reorder` moves `ids` to `front`, `back`, `forward` or `backward` (one step), or `above` / `below` a `relative` node.
- Draw back to front and you rarely need it. Use `reorder` for a late shadow or an overlay that has to sit below something.

## Copies
- `duplicate` copies nodes with everything inside, just above the originals, moved by `offset [dx, dy]`. Copies get fresh ids (`tree` becomes `tree-2`); `id` names a single copy. Restyle copies afterwards with `style` for variety.
- For many regular copies, use `array`, `scatter` or `repeat_along_path` (see `generators`).

## Clip and delete
- `clip` cuts a node to the filled area of another shape (the shape is removed unless `keep: true`). The clip moves with the node. `shape: null` removes it. Use it for rounded photos, windows, and shapes that must stay inside a frame.
- `delete` removes nodes; deleting a group deletes everything inside. If a batch built something wrong, prefer `history` `restore` over deleting piece by piece.

```json
[
  {"op": "rect", "id": "trunk", "x": 390, "y": 360, "width": 20, "height": 80, "style": {"fill": "#6c584c"}},
  {"op": "polygon", "id": "crown", "cx": 400, "cy": 330, "radius": 70, "sides": 3, "style": {"fill": "#2d6a4f"}},
  {"op": "group", "id": "tree", "ids": ["trunk", "crown"]},
  {"op": "duplicate", "ids": ["tree"], "id": "tree_right", "offset": [160, 20]},
  {"op": "style", "ids": ["tree_right"], "style": {"opacity": 0.85}},
  {"op": "rect", "id": "photo", "x": 100, "y": 80, "width": 200, "height": 140, "style": {"fill": "#8ecae6"}},
  {"op": "ellipse", "id": "frame", "cx": 200, "cy": 150, "rx": 70},
  {"op": "clip", "id": "photo", "shape": "frame"},
  {"op": "reorder", "ids": ["tree"], "to": "front"}
]
```
