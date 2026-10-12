# Trace a reference image

Op: `trace`. It reduces a PNG or JPEG to a few colors and traces each color into one editable path, like Illustrator's Image Trace. Use it to block in a subject from a reference, then refine by hand. Trace only images you have the rights to.

## Call it
- `image` is the file's path (absolute, or relative to the server's working directory). Pass the path you were given; the server reads the file, you never paste pixels.
- The result is one group `id` holding a path per color: `<id>-1` is the largest color, drawn at the back, then smaller colors on top. By default each layer is exactly its own color's area, and neighbors share their edges (`abutting`), so there are no seams.
- The whole image is fitted to the canvas and centered. `x`, `y`, `width`, `height` place it otherwise; give one of `width` and `height` and the other follows the aspect ratio.
- The reply lists each layer's `id`, `color` and `share` of the image, so you can see which layer is the background.

## Preview, then commit
Run the batch with `preview: true` first. It changes nothing and returns a PNG of the result: compare it with the reference, adjust `colors`, then run the same call without `preview`.

```js
apply_ops({ doc_id, preview: true, ops: [
  {"op": "trace", "id": "logo", "image": "C:/refs/logo.png", "colors": 4}
] })
```

## Choose the colors
- Logo, icon, flat badge: 2-6. Flat art or a diagram: 6-12. Poster or photo: 12-24.
- More colors is more detail and more segments. If a trace fails with `limit_exceeded`, lower `colors` or `max_size`, raise `speckle` (drops patches smaller than about speckle x speckle pixels), or trace a smaller `region`.
- `max_size` (default 1024) is the longest side the traced region is reduced to; lower it for faster, smoother, simpler shapes.

## One object at a time
`region` traces a box of the image, in image pixels, with its own `colors`. Regions of one image line up with each other and with a full trace when you leave `x`, `y`, `width` and `height` the same in every call. Trace the canopy and the bark of a tree separately so each gets its own palette.

```js
apply_ops({ doc_id, preview: true, ops: [
  {"op": "trace", "id": "canopy", "image": "C:/refs/tree.jpg", "region": {"x": 120, "y": 0, "width": 600, "height": 380}, "colors": 8},
  {"op": "trace", "id": "bark", "image": "C:/refs/tree.jpg", "region": {"x": 300, "y": 360, "width": 160, "height": 340}, "colors": 5}
] })
```

## Stacked or abutting
- `abutting` (default): each layer is only its own color's area, with exact shared edges and no overlap. Best for logos and flat art, and for editing regions one at a time (move, `boolean`, `roughen`).
- `stacked`: each layer is a full silhouette under the next, so recoloring or deleting a top layer shows the layer below. Lower layers can show as a thin dark ring at the antialiased edges of the shapes above them.

## Clean up
- The background is usually layer 1: `{"op": "delete", "ids": ["logo-1"]}`. Check the `share` figures first.
- Recolor layers with `style` (a hex color or a token name), for example after `palette`, so the trace matches the rest of the drawing.
- `lint` skips the layers of a trace; they are reference geometry, not hand-placed shapes. Draw detail (highlights, outlines, text) with the normal ops on top.

## Photos
- Phone photos can carry an EXIF rotation that the tracer ignores. Rotate such a photo upright and save it again before tracing, or the result is sideways.
- Large images are read at full size, then reduced; files over 25 MB or 36 megapixels are refused. Scale them down first.
- Transparent pixels are left out. A fully transparent image is an error.
