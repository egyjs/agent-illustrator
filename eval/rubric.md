# Agent-quality rubric

How to judge a run from `eval/src/report.ts`: each brief shows the tools drawing (MCP server) next to the raw-SVG baseline
(same model, same brief, no tools). Score both on the five criteria below, 1 to 5 each, in `scores.template.json`.
Judge the image first, then the numbers. Score the two columns in separate passes, so one drawing does not set the bar for the other.
Use the same reviewer for every brief of a run.

## Scales

Every scale: 5 excellent, 4 good with small flaws, 3 acceptable, 2 weak, 1 failed or missing. No image scores 1 on all criteria.

### Brief fidelity (`fidelity`)
Does the drawing contain what the brief asks for, in the number, arrangement and style it names?
- 5: every element is there and recognizable; counts, positions, sizes and the named style match.
- 4: one minor element is missing or off (for example two pine trees but one is tiny or hidden).
- 3: the main subject is right, but several named elements are missing, wrong in number or hard to recognize.
- 2: the subject is only loosely related to the brief.
- 1: unrelated, empty, or the canvas is mostly blank.

### Composition (`composition`)
Layout, balance, scale relationships, alignment and use of the canvas.
- 5: a clear focal point, balanced use of space, consistent scale, tidy alignment where the brief implies a grid.
- 4: good layout with one weak spot (crowded corner, slightly off-center subject).
- 3: readable but plain or unbalanced; empty regions or cramped regions.
- 2: elements float without relation to each other; misaligned grid items; wrong scale between parts.
- 1: elements overlap into a mess, or sit outside the visible canvas.

### Color (`color`)
Palette harmony, contrast, and fit to the mood and colors the brief names.
- 5: a deliberate, harmonious palette that matches the brief; shading or gradients, where asked for, look right.
- 4: good palette with one clashing or flat area.
- 3: acceptable but dull, or colors only loosely follow the brief.
- 2: clashing or low-contrast colors; named colors missing.
- 1: unreadable colors, or everything one color.

### Technical cleanliness (`technical`)
Craft of the drawing itself, visible in the image and in the SVG.
- 5: clean edges, shapes meet where they should, nothing stray or clipped; the SVG is valid, compact and (tools) has meaningful node ids.
- 4: one visible seam, overlap or stray shape.
- 3: several visible defects (gaps, jagged curves, clipped shapes), but the picture holds together.
- 2: many defects, or the SVG needs repair to open elsewhere.
- 1: invalid SVG, nothing renders, or the final export is empty.

### Text correctness (`text`)
Only for briefs with quoted text (poster-text and arabic-text categories). Score `n/a` (leave `null`) for the rest.
- 5: every string exactly as quoted, correct spelling, right reading direction, joined Arabic letters, readable size and contrast.
- 4: all text right, with one small flaw (tight spacing, slightly low contrast).
- 3: text is right but hard to read (small, overlapping a busy area), or one character is wrong.
- 2: words are misspelled, truncated or clipped; Arabic letters are disconnected or reversed.
- 1: text is missing, garbled or illegible.

## Objective metrics

The report lists these next to the images; they do not replace the scores, they explain them.
- `finished`: tools mode, the model ended on a reply (not the turn limit or an endpoint error); raw mode, the reply held an SVG that rendered.
- `turns`, `toolCalls`, `toolErrors`: how many model replies and tool calls it took, and how many calls came back as errors.
  Many errors with hints followed suggest the hints work; the same error repeated suggests they do not.
- `opsApplied`: ops committed by `apply_ops`.
- `promptTokens`, `completionTokens`, `ms`: cost and time of the run.

## How to score

1. Open `index.html` from the run directory. Read the brief, then look at the tools image and the raw image at full size.
2. Fill the five criteria for the tools column, then, in a separate pass, for the raw column. Enter a whole number 1 to 5, or `null` for not applicable.
3. Open the SVGs or the transcript only to explain a low score or to check technical cleanliness.
4. Save the file as `scores.json` next to `index.html`. Compare models by the mean per criterion, and tools against raw by the mean difference per brief.
5. Two reviewers should agree within one point on at least 80% of scores; discuss the rest and note the outcome in the run's notes.
