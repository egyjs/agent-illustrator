# Workflow: from brief to SVG

Work coarse to fine, and look at the result between stages. Each stage is one or two `apply_ops` batches.

## 1. Plan (no tool calls)
- Restate the brief in one line. Pick the canvas size and the focal point (where the eye lands first).
- Split the canvas into zones, for example sky 0-55%, hills 40-80%, foreground 70-100%.
- Choose 3-5 colors. Call `create_document` with a `background`, then `palette` from one base color and refer to its tokens (`palette.primary`, `palette.primary.2`, `palette.accent`) everywhere.
- If a style preset applies, `guide` topic `preset:<name>` gives its palette rules and defaults.

## 2. Block in large shapes
- Background, ground, sky, big masses: `rect`, `wave` with `bottom`, `path_from_points`, `blob`. Few ops, big areas, flat colors.
- Give each shape a semantic id. Paint back to front.
- Call `history` `checkpoint` (label `blocking`) when the composition reads right.

## 3. Mid detail
- Main subjects and secondary shapes: build with primitives and `boolean`, repeat with `array`, `scatter`, `repeat_along_path`.
- Position with `place`, `align`, `distribute` instead of computing coordinates by hand.
- Use gradients and shadows sparingly, on the focal point first.

## 4. Fine detail
- Highlights, outlines, small accents, texture (`roughen`), text labels.
- Stop when more detail would not change what the picture says.

## 5. Critique
- `render` with overlay `ids` to see which id is which; `render` again with `region` and `scale: 2` to inspect a corner.
- `lint` for off-canvas, tiny, misaligned, overlapping text and low-contrast text. `describe_scene` for the tree, `measure` for sizes and gaps. See `critique`.

## 6. Fix
- Apply a lint `fix` as it is, or adjust the node with `style`, `transform`, `place`, `set_text`.
- Re-render and re-lint the part you changed.

## 7. Export
- `export_svg` last. Save with `document_io` `save` if the document should survive the session.

## Safety nets
- `history` `checkpoint` before a risky step (boolean, roughen, a big rewrite). `restore` the label to undo it, or `undo` for the last batch.
- `apply_ops` with `dry_run: true` validates a batch without changing anything.
- Make small batches while learning an op, then batch freely.
