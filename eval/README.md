# eval (dev-only, never published)

Evaluation for agent-illustrator, spec A2. Two halves: a deterministic render-regression check that runs in CI, and an
agent-quality harness that needs a model, so the owner runs it by hand. It drives the Claude Code CLI on its subscription, so no API key is needed; an OpenAI-compatible API is optional.

## Render regression (CI)

- `fixtures/*.json`: op scripts, one per feature area. `fixtures/baselines/*.png`: the committed renders.
- `test/regression.test.ts` (part of `pnpm test`) renders each fixture through the engine and compares it to its baseline with pixelmatch.
- After an intended rendering change, regenerate and review the PNGs before committing them:
  `pnpm --filter @agent-illustrator/eval baselines [fixture…]`.

## Agent quality (dev-only)

The harness gives a model the built MCP server, the way a client does, and the same brief with no tools as a baseline. The default client is the Claude Code CLI:

| File | What it does |
|---|---|
| `briefs/briefs.json` | 20 briefs: landscape, icon set, character, poster with text, pattern, isometric, Arabic text. |
| `src/mcp.ts` | Starts `packages/mcp-server/dist/cli.mjs` over stdio with the MCP SDK client; returns the tools and the server instructions. |
| `src/model.ts` | `OpenAICompatibleModel` (one `/chat/completions` endpoint, retries, token usage), `ScriptedModel` (canned replies, for tests). |
| `src/clients.ts` | The `ClientRunner` interface and the Claude Code runner (`claude -p`): spawns the CLI on your subscription, hands it the server, and parses its event stream into tool calls, final text and usage. |
| `src/run.ts` | Per brief, in a fresh empty folder. Through a CLI: tools mode = the brief, "save as final", then the saved document is rendered by the engine; raw mode = no tools, one SVG in the reply. Through `--client api`: the tool loop (system prompt = server instructions, tool calls until the model stops, then export and render the last document). |
| `src/raw-svg.ts` | The raw-SVG baseline: "reply with one SVG", rendered with resvg and the bundled fonts. |
| `src/report.ts` | `index.html`: per brief the two drawings side by side, metrics, links, and a score table. Also `scores.template.json`. |
| `rubric.md` | The five 1-5 scales and how to score. |

### Run it

The default client runs through your Claude Code subscription, so no API key is needed. Before the first run:

- `pnpm build` (the harness runs `packages/mcp-server/dist/cli.mjs`).
- `claude` on PATH and signed in (start `claude` once and log in).

From the repo root:

```sh
pnpm build
# the tools run and the raw-SVG baseline, on the cheapest model; aliases like haiku, sonnet and opus work
node eval/src/run.ts --client claude-code --model haiku --briefs landscape-sunset-lake,poster-jazz-night
# only the tools run, on a bigger model; --run-id puts several models into one report
node eval/src/run.ts --client claude-code --model sonnet --mode tools --briefs landscape-sunset-lake --run-id compare
node eval/src/report.ts eval/runs/<run-id>   # run.ts prints the run directory
```

`run.ts` options: `--client claude-code|api` (default `claude-code`), `--model <id>` (Claude Code's own name or alias, optional; required for `api`),
`--briefs a,b` (default all 20), `--mode tools|raw|both` (default both), `--timeout <seconds>` (Claude Code, default 600 per mode and brief),
`--run-id <id>` (default a timestamp). `--max-turns 40` and `--no-vision` only apply to `api`.

What a Claude Code run does for each brief, in a fresh empty temp folder:

- Tools mode: the model gets only the agent-illustrator server and the brief, plus "save the document as `final`".
  The command is `claude -p … --output-format stream-json --verbose --strict-mcp-config --mcp-config <temp json>`, with its built-in file, shell and web tools off.
  The server saves into `docs/` of the brief's output folder; the harness loads `docs/final.json` and exports and renders it with the engine.
  A model that never saves ends with the error `no document saved` and `finished: false`.
- Raw mode: no server and no tools; the reply must hold one SVG, which is rendered as in the `api` baseline.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `OPENAI_API_KEY` are removed from the CLI's environment, so a run never switches to API billing.
- It runs with `--setting-sources project --disable-slash-commands`, so your user settings, hooks, `CLAUDE.md`, plugins and skills stay out of the model's context;
  the init event in `transcript.json` shows only the server's ten tools. (`--safe-mode` would also drop the `--mcp-config` server, so it is not used.)
- On Windows, a `claude.cmd` npm shim is run as `node <script>` (a shell would parse the prompt); `claude.exe` runs directly.
- Another CLI is a new `ClientRunner` in `src/clients.ts` (spawn it, hand it the server, parse its output into `ClientResult`); `run.ts` needs no change beyond the `--client` choice.

### The API client (optional)

`--client api` keeps the original path: your own loop against an OpenAI-compatible endpoint, with the server's tools as function calls. A full run is 20 briefs in both modes, so start with two or three.
A local server that needs no key still needs `EVAL_API_KEY` set to any value.

```sh
export EVAL_API_KEY=...                      # PowerShell: $env:EVAL_API_KEY = '...'
node eval/src/run.ts --client api --model <model-id> --briefs landscape-sunset-lake,poster-jazz-night
```

| Variable | Meaning |
|---|---|
| `EVAL_API_KEY` | Bearer token for the endpoint. Required for `api`; never put it in a file. |
| `EVAL_BASE_URL` | An OpenAI-compatible base URL; default `https://openrouter.ai/api/v1`. |

### Output

`eval/runs/<run-id>/<group>/<brief-id>/` (git-ignored; `<group>` is `<client>-<model>`, e.g. `claude-code-haiku`, or just the model for `--client api`) holds
`transcript.json` (the CLI's event stream, or the chat for `api`; image data omitted), `tools.svg`, `tools.png`, `raw.svg`, `raw.png`, `metrics.json`,
`renders/` (the server's render files) and, for CLI runs, `docs/` (the documents the model saved; `final.json` is the one that is rendered).
`metrics.json` has (for Claude Code runs) the client and model, and per mode: turns, tool calls, tool errors, ops applied, tokens, cost (an estimate: a subscription is not billed per token),
milliseconds, `finished`, and an error if one stopped the run. For Claude Code, tokens in include cached input, and "ops applied" counts the ops in `apply_ops` calls that did not error.
`report.ts` writes `index.html` and `scores.template.json` into the run directory. Score both drawings per `rubric.md`
and save the result as `scores.json` there.

Tests need no network and no Claude login. `test/harness.test.ts` drives the real server with a `ScriptedModel` (skipped when `dist/cli.mjs` is missing);
`test/clients.test.ts` runs the client code against a fake `claude` (`test/fixtures/fake-claude.ts`) that prints a canned event stream.

## Client compatibility

`clients.md`: the manual MCP client smoke checklist; re-run it on every milestone that changes the tool surface.
