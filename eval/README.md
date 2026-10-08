# eval (dev-only, never published)

Evaluation for agent-illustrator, spec A2. Two halves: a deterministic render-regression check that runs in CI, and an
agent-quality harness that needs a model and an API key, so the owner runs it by hand.

## Render regression (CI)

- `fixtures/*.json`: op scripts, one per feature area. `fixtures/baselines/*.png`: the committed renders.
- `test/regression.test.ts` (part of `pnpm test`) renders each fixture through the engine and compares it to its baseline with pixelmatch.
- After an intended rendering change, regenerate and review the PNGs before committing them:
  `pnpm --filter @agent-illustrator/eval baselines [fixture…]`.

## Agent quality (dev-only)

The harness gives a model the built MCP server, the way a client does, and the same brief with no tools as a baseline:

| File | What it does |
|---|---|
| `briefs/briefs.json` | 20 briefs: landscape, icon set, character, poster with text, pattern, isometric, Arabic text. |
| `src/mcp.ts` | Starts `packages/mcp-server/dist/cli.mjs` over stdio with the MCP SDK client; returns the tools and the server instructions. |
| `src/model.ts` | `OpenAICompatibleModel` (one `/chat/completions` endpoint, retries, token usage), `ScriptedModel` (canned replies, for tests). |
| `src/run.ts` | The tool loop. Tools mode: system prompt = server instructions, user turn = brief, tool calls until the model stops. Then it exports and renders the last document even if the model did not. Raw mode: same model, no tools. |
| `src/raw-svg.ts` | The raw-SVG baseline: "reply with one SVG", rendered with resvg and the bundled fonts. |
| `src/report.ts` | `index.html`: per brief the two drawings side by side, metrics, links, and a score table. Also `scores.template.json`. |
| `rubric.md` | The five 1-5 scales and how to score. |

### Run it

From the repo root:

```sh
pnpm build                                   # the harness runs dist/cli.mjs
export EVAL_API_KEY=...                      # PowerShell: $env:EVAL_API_KEY = '...'
node eval/src/run.ts --model <model-id> --briefs landscape-sunset-lake,poster-jazz-night
node eval/src/report.ts eval/runs/<run-id>   # run.ts prints the run directory
```

`run.ts` options: `--model <id>` (required), `--briefs a,b` (default all 20), `--mode tools|raw|both` (default both),
`--max-turns 40`, `--no-vision` (do not send render PNGs back; for models without image input),
`--run-id <id>` (default a timestamp; reuse it to put several models in one report).

A full run is 20 briefs in both modes, so start with two or three briefs. A local server that needs no key still needs
`EVAL_API_KEY` set to any value.

| Variable | Meaning |
|---|---|
| `EVAL_API_KEY` | Bearer token for the endpoint. Required; never put it in a file. |
| `EVAL_BASE_URL` | An OpenAI-compatible base URL; default `https://openrouter.ai/api/v1`. |

### Output

`eval/runs/<run-id>/<model>/<brief-id>/` (git-ignored) holds `transcript.json` (image data omitted), `tools.svg`, `tools.png`,
`raw.svg`, `raw.png`, `metrics.json` and `renders/` (the server's render files).
`metrics.json` has, per mode: turns, tool calls, tool errors, ops applied, tokens, milliseconds, `finished`, and an error if one stopped the run.
`report.ts` writes `index.html` and `scores.template.json` into the run directory. Score both drawings per `rubric.md`
and save the result as `scores.json` there.

Tests (`test/harness.test.ts`) drive the real server with a `ScriptedModel` and need no network; they skip when `dist/cli.mjs` is missing.

## Client compatibility

`clients.md`: the manual MCP client smoke checklist; re-run it on every milestone that changes the tool surface.
