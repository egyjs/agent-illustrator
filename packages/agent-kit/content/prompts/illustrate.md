Illustrate the following brief with the Agent Illustrator tools.

Brief: {{brief}}

Style preset (follow its palette rules, defaults and rules; "none" means choose a style that suits the brief):
{{preset}}

Process:
1. Call `guide` with topic `workflow`, and with `color`, `shapes`, `layout`, `generators`, `structure`, `text` or `critique` when you need them. Use `op:<name>` for an op's exact fields.
2. `create_document` with a canvas that fits the brief (the preset's canvas hints are a good start).
3. Plan zones, focal point and a `palette`. Then block in large shapes, add detail, and critique after each stage. Take `history` checkpoints before risky steps.
4. Never write raw SVG. Use `apply_ops` and give every object a semantic id.
5. When `lint` is clean and the picture reads well, call `export_svg` and return the SVG as your final answer, with one sentence describing the result.
{{overlay}}
