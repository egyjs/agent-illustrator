# Color

Ops: `palette`, `tokens`, `gradient`, `filter`, `mask`, and the `style` op. A style has `fill`, `stroke`, `opacity`, `fillOpacity`, `strokeOpacity`, `filter` and `blend`.

## Colors and tokens
- A paint is hex (`#2a9d8f`, `#2a9d8f80`), `rgb()`, `hsl()`, `oklch()`, a CSS name, `none`, or the name of a token or gradient.
- `tokens` sets named colors (`brand.ink`). Use the name as any fill or stroke; change the token later and every user recolors. Prefer tokens over repeating hex codes. Token, gradient and filter names share one namespace.

## Palette from one color
- `palette` takes a `base` and a `harmony` (`monochrome`, `complementary`, `analogous` (default), `triadic`), `steps` (3-9, default 5) and a `prefix` (default `palette`; use another to keep two palettes). `base` may be a token.
- It makes `palette.primary` (the base) and `palette.primary.1` ... `.5`, light to dark; also `secondary`, `tertiary` or `accent` depending on the harmony, and `palette.neutral.1` ... `.5`, tinted grays.
- Pattern: `.1` for backgrounds and light areas, `.2`-`.3` mid tones, `.4`-`.5` shadows and text on light grounds, `accent` for the focal point only.

```json
[
  {"op": "palette", "base": "#2a9d8f", "harmony": "complementary", "steps": 4},
  {"op": "rect", "id": "bg", "x": 0, "y": 0, "width": "100%", "height": "100%", "style": {"fill": "palette.neutral.1"}},
  {"op": "ellipse", "id": "dot", "cx": "50%", "cy": "50%", "rx": 80, "style": {"fill": "palette.accent"}}
]
```

## Gradients
- `gradient` defines a gradient and, with `ids`, paints it as their fill (`target: "stroke"` for the outline). The gradient `id` must not be a color name: use `sky_fade`, not `fade`.
- `stops` are colors or tokens, evenly spaced, or `{color, offset}` with offsets 0..1. Linear `angle`: 0 runs left to right, 90 top to bottom. Radial: `center`, `radius`, `focal` are fractions of the shape's box.
- Keep stops close in hue and lightness for a calm look; use two stops unless the brief needs more.

```json
[
  {"op": "palette", "base": "#e76f51", "steps": 4},
  {"op": "rect", "id": "sky", "x": 0, "y": 0, "width": "100%", "height": "100%"},
  {"op": "gradient", "id": "sky_fade", "stops": ["palette.primary.1", "palette.secondary.2"], "angle": 90, "ids": ["sky"]},
  {"op": "ellipse", "id": "sun", "cx": "50%", "cy": "55%", "rx": 90},
  {"op": "gradient", "id": "sun_glow", "type": "radial", "stops": ["#ffe8a3", "#ffb703"], "ids": ["sun"]}
]
```

## Shadows, blur, fade, blend
- `filter` with `blur` and/or `shadow {dx, dy, blur, color}` and `ids`. Define it once with an `id`, then reuse it with `"style": {"filter": "lift"}`. Bounds ignore the effect.
- `mask` fades a node out over its box: `fade {type, angle, from, to}` (`from` 1 to `to` 0 fades to transparent). `fade: null` removes it.
- `blend` modes (`multiply`, `screen`, `overlay`, `soft-light`, ...) combine a shape with what is below: `multiply` for shadows, `screen` for glows. Pair with `opacity`.

```json
[
  {"op": "rect", "id": "card", "x": 250, "y": 200, "width": 300, "height": 200, "radius": 16, "style": {"fill": "#ffffff"}},
  {"op": "filter", "id": "lift", "shadow": {"dy": 8, "blur": 12, "color": "rgba(0,0,0,0.3)"}, "ids": ["card"]},
  {"op": "ellipse", "id": "glow", "cx": 400, "cy": 300, "rx": 90, "style": {"fill": "#ffb703", "blend": "screen", "opacity": 0.7}},
  {"op": "mask", "id": "glow", "fade": {"type": "radial", "from": 1, "to": 0}}
]
```

## Contrast
- Text must stand out from what is behind it: ratio 4.5, or 3 for large text (24+ units, or 18.7+ bold). `lint` checks this and offers a `fix` that recolors the text.
- Choose text from the extreme ends of the palette: `palette.neutral.5` on light grounds, `palette.neutral.1` on dark ones. Avoid mid-tone text on mid-tone shapes.
- Do not use color alone for meaning; vary lightness too.
