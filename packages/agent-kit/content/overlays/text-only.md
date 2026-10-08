# Text-only mode (you cannot see images)

Skip `render`: its image is of no use to you. Check the picture with numbers instead. The tools return exact geometry, so a picture you cannot see can still be correct.

## Before drawing
- Write down a layout in canvas units: zones as `x, y, width, height` boxes (sky, ground, subject, text area) and where the focal point sits. Draw into those boxes.
- Prefer ops that position by relationship: `place`, `align`, `distribute`, `snap`, percent coordinates. They need no visual feedback.

## After every `apply_ops`
1. Read the `bounds` in the result: each new node reports its exact box. Compare with your layout: inside the zone, right size, right side of its neighbors.
2. `lint`: fix every warning, usually by applying its `fix` op. Add `checks` with `overlap` when pieces must not touch.
3. `describe_scene` with `detail` `outline` for the structure and paint order (back to front); `normal` when you need colors and fonts.
4. `measure` the ids you placed relative to each other: it returns gaps and overlaps for pairs, so you can confirm that a roof sits on its wall (overlap, no gap), that a row of items is evenly spaced, that a label is inside its box.

## Specific checks
- Containment: the inner node's box lies within the outer node's box, with a margin.
- Text: its `bounds` width must be smaller than the space you have; if not, lower `size` or break lines with `\n`. `lint` reports overlapping text and low contrast.
- Color: use palette tokens and the lightness steps (`.1` light to `.5` dark) so contrast is predictable; text on light grounds uses `palette.neutral.5`, on dark grounds `palette.neutral.1`.
- Balance: compare areas from `measure` for the large masses; the focal point should have the strongest contrast, not the largest area.

## Finish
- A clean `lint`, a `describe_scene` that matches your layout, then `export_svg`.
