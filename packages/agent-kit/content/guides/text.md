# Text

Ops: `text` (point text), `text_on_path` (one line along a path), `set_text` (edit either). Text is real SVG text, drawn with the bundled Tajawal font (Latin and Arabic).

## Placing text
- `x, y` is the first baseline, not the top-left corner: letters sit above `y`, descenders below it.
- `anchor` chooses the side of `x` the text hangs from: `start` (default) grows to the right, `middle` centers on `x`, `end` stops at `x`.
- `size` is canvas units or a percent of the shorter canvas side (default 24). Color it with `style.fill`; without a fill it is black.
- The result's `bounds` is the measured ink box. Use it to align, center or avoid overlaps, and check the render.

## Sizes and weights
- Only Tajawal Regular and Bold are bundled. `weight` takes `normal` (400), `bold` (700) or 100..900; the renderer snaps any number to the nearer of 400 and 700.
- Another `font` name falls back to Tajawal. `letter_spacing` adds space between letters, in canvas units.

## Several lines
- Put `\n` in `content`. There is no automatic wrapping, so break long text yourself. `line_height` (default 1.2) multiplies `size` to space the baselines.

## Text on a path
- Draw the guide first (`path_commands`, `path_from_points`, `line`, a shape), then `text_on_path` with `path` set to its id. It follows the first subpath.
- `offset` is where the text starts: a percent of the path length (`"10%"`) or canvas units. The guide is removed unless `keep: true`.
- The text is one line, and it copies the guide as it is now: moving or editing the guide later does not move the text.

## Arabic and right-to-left text
- Shaping and measuring work: letters join and the bounds are correct.
- `direction` defaults to `auto`: right-to-left when the first letter is Arabic or Hebrew, else left-to-right. Set `ltr` or `rtl` to force it.
- The renderer ignores `direction` for layout, so the engine wraps right-to-left lines in an isolate and writes no `direction` attribute to the SVG. Anchoring is physical in every viewer: for Arabic use `anchor: "end"` to align the right edge at `x`.
- Avoid `letter_spacing` on Arabic, since it breaks the joins. Lines that mix scripts are best effort; check the render.

## Limits
- No text-to-outlines yet, so text cannot join a `boolean` or be a `clip` shape.
- To change wording, size or weight later use `set_text`; omitted fields keep their value.
