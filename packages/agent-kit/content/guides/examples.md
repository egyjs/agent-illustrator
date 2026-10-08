# Examples

Three small scenes, each one `apply_ops` batch on an empty 800x600 canvas. Copy the structure, not the numbers: plan zones, palette first, back to front, semantic ids.

## 1. Sunset hills (flat landscape)
Techniques: `palette`, a gradient sky, `wave` bands for hills, a `blob` cloud. Far hills are lighter and cooler than near ones.

```json
[
  {"op": "palette", "base": "#3d5a80", "harmony": "monochrome", "steps": 5},
  {"op": "rect", "id": "sky", "x": 0, "y": 0, "width": "100%", "height": "100%"},
  {"op": "gradient", "id": "sky_fade", "stops": ["#ffe8d6", "#f4a261"], "angle": 90, "ids": ["sky"]},
  {"op": "ellipse", "id": "sun", "cx": "70%", "cy": "55%", "rx": 70, "style": {"fill": "#fff3b0"}},
  {"op": "blob", "id": "cloud", "cx": 190, "cy": 130, "radius": 55, "points": 10, "randomness": 0.25, "seed": 4, "style": {"fill": "#ffffff", "opacity": 0.8}},
  {"op": "transform", "ids": ["cloud"], "scale": [1.8, 0.6]},
  {"op": "wave", "id": "hill_far", "x": 0, "y": 380, "width": "100%", "amplitude": 30, "wavelength": 520, "bottom": "100%", "style": {"fill": "palette.primary.2"}},
  {"op": "wave", "id": "hill_near", "x": 0, "y": 470, "width": "100%", "amplitude": 24, "wavelength": 360, "phase": 120, "bottom": "100%", "style": {"fill": "palette.primary.4"}}
]
```

## 2. Badge with text (centered, shadow, contrast)
Techniques: star burst behind a disc, `place` to center text on the disc, light text on a dark fill, a shadow `filter`.

```json
[
  {"op": "palette", "base": "#264653", "harmony": "complementary", "steps": 5},
  {"op": "rect", "id": "bg", "x": 0, "y": 0, "width": "100%", "height": "100%", "style": {"fill": "palette.neutral.1"}},
  {"op": "star", "id": "burst", "cx": "50%", "cy": "50%", "outer": 250, "inner": 215, "points": 24, "style": {"fill": "palette.accent"}},
  {"op": "ellipse", "id": "disc", "cx": "50%", "cy": "50%", "rx": 190, "style": {"fill": "palette.primary"}},
  {"op": "ellipse", "id": "ring", "cx": "50%", "cy": "50%", "rx": 165, "style": {"fill": "none", "stroke": "palette.neutral.1", "strokeWidth": 4, "strokeDash": [2, 10], "strokeCap": "round"}},
  {"op": "text", "id": "headline", "content": "BEST\nCOFFEE", "x": 0, "y": 0, "size": 72, "weight": "bold", "anchor": "middle", "line_height": 1.1, "style": {"fill": "palette.neutral.1"}},
  {"op": "place", "ids": ["headline"], "relative_to": "disc", "anchor": "center"},
  {"op": "filter", "id": "lift", "shadow": {"dy": 8, "blur": 10, "color": "rgba(0,0,0,0.3)"}, "ids": ["burst"]}
]
```

## 3. Isometric cube (three face shades)
Techniques: a diamond (`polygon` with 4 sides) squashed to a 30-degree rhombus, side faces from rects with `skew [0, 30]` and `[0, -30]` (pivot `top-left` keeps their top edge in place), light, mid and dark shades of one color, a soft ground shadow.

```json
[
  {"op": "palette", "base": "#e76f51", "harmony": "monochrome"},
  {"op": "rect", "id": "bg", "x": 0, "y": 0, "width": "100%", "height": "100%", "style": {"fill": "#f1faee"}},
  {"op": "ellipse", "id": "ground", "cx": 400, "cy": 395, "rx": 175, "ry": 55, "style": {"fill": "#264653", "opacity": 0.25}},
  {"op": "filter", "id": "soft", "blur": 14, "ids": ["ground"]},
  {"op": "rect", "id": "face_left", "x": 280, "y": 229.3, "width": 120, "height": 130, "style": {"fill": "palette.primary.4"}},
  {"op": "transform", "ids": ["face_left"], "skew": [0, 30], "pivot": "top-left"},
  {"op": "rect", "id": "face_right", "x": 400, "y": 298.6, "width": 120, "height": 130, "style": {"fill": "palette.primary.3"}},
  {"op": "transform", "ids": ["face_right"], "skew": [0, -30], "pivot": "top-left"},
  {"op": "polygon", "id": "face_top", "cx": 400, "cy": 229.3, "radius": 120, "sides": 4, "style": {"fill": "palette.primary.2"}},
  {"op": "transform", "ids": ["face_top"], "scale": [1, 0.577], "pivot": "center"}
]
```
