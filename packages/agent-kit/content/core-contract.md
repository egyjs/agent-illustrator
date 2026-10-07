# Core contract (draft; finalized in M9)

1. Never write raw SVG. Build the picture with tool calls; the engine owns geometry, layout and rendering.
2. Give every object a short semantic id (`sun`, `hill_back`). Refer to objects by id, or `$last` for the most recent one.
3. Batch related changes into one `apply_ops` call. A batch applies fully or not at all.
4. Numbers are canvas units. Strings like `"50%"` are relative to the canvas or to the op's reference node.
5. After each stage, call `render` (or `describe_scene`, `measure` and `lint` if you cannot see images), fix what you find, then `export_svg`.
