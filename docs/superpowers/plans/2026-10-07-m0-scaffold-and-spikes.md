# M0: Scaffold & Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up a working, guarded pnpm monorepo (engine, agent-kit, the published `agent-illustrator` server, spikes) with CI. Then prove, inside the repo, that the risky libraries behave as the plan assumes (R1–R4).

**Architecture:**
- **Three product packages and one spike package:**
  - `@agent-illustrator/engine`: pure core; empty in M0 except its version.
  - `@agent-illustrator/agent-kit`: content only.
  - `agent-illustrator`: the published package; it bundles the other two with tsdown.
  - `@agent-illustrator/spikes`: private; learning tests only.
- **Sources run directly** on Node ≥ 22.18 through type stripping: `.ts` import extensions, `import type`, erasable syntax only. TypeScript is used only to type-check; tsdown builds the published package.
- **ESLint** enforces the PROJECT_INIT §4.2 constraints.
- **The spike tests** re-confirm the pre-M0 library check (spec "Outcomes recorded") on Linux and Windows in CI.

**Tech Stack:**
- Node 24 for development; the floor is 22.18.
- pnpm 12.10.1 with a catalog.
- TypeScript ~6.0.3, vitest ^5.0.3, ESLint ^10.12.0, typescript-eslint ^8.71.1, tsdown 0.23.0.
- paper 0.12.18 (core build only), @resvg/resvg-js 2.6.2.
- @modelcontextprotocol/server and @modelcontextprotocol/client ^2.3.1, zod ^4.6.5.

**Spec:** [`PROJECT_INIT.md`](../../../PROJECT_INIT.md) (§2.3, §4, §5 M0) + [`specs/2026-10-07-agent-illustrator-v1-design.md`](../specs/2026-10-07-agent-illustrator-v1-design.md) (A1–A4, S1–S7, outcomes). Roadmap: [`2026-10-07-v1-roadmap.md`](2026-10-07-v1-roadmap.md).

## Global Constraints

- `engines.node` is `">=22.18"` everywhere. CI runs Node 22 and 24 on ubuntu-latest, and Node 24 on windows-latest.
- `typescript` is `~6.0.3`, never 7.x: `typescript-eslint` peers `typescript >=4.8.4 <6.1.0`.
- `packageManager` is `"pnpm@12.10.1"`. Every third-party version lives in the `catalog:` in `pnpm-workspace.yaml`. `tsdown` is pinned exact at `0.23.0`.
- All packages are ESM (`"type": "module"`). Relative imports carry the `.ts` extension. Type-only imports use `import type` (`verbatimModuleSyntax`, `erasableSyntaxOnly`).
- `engine` must never import from `mcp-server` or `agent-kit`, and must never mention MCP or LLMs (PROJECT_INIT §4.2).
- Only `packages/engine/src/geometry/**` may import `paper`. The import path is `paper/dist/paper-core.js`. Never `paper-jsdom` (spec S6).
- `Math.random` is banned in `packages/engine/**` (§4.2, D13).
- No `node-gyp` or other native build steps; resvg-js prebuilt binaries only (§4.2, NFR-6).
- In stdio server mode, stdout carries only MCP JSON-RPC. Everything else goes to stderr.
- MCP tool input schemas: no top-level `oneOf`/`anyOf`, no `$ref`/`$defs` (spec S1).
- Out of scope (§4.3): HTTP API, agent runner, hosting, constraint solver, HarfBuzz. Do not add them.
- Shell commands below assume Git Bash on Windows (or any POSIX shell). `curl` means real curl, not the PowerShell alias.

## Review Focus

1. **A stray byte on stdout in stdio mode corrupts the MCP stream.** Startup output must be pure JSON-RPC. The test is in Task 5 (`writes nothing but JSON-RPC lines to stdout`).
2. **The bundled `dist/cli.mjs` may not find agent-kit content**, because asset paths move after bundling. `--doctor` from `dist/` must succeed. Covered by Task 1 Step 13 (`pnpm smoke`) and the CI smoke step in Task 2.
3. **A model asks for a font family that isn't bundled (e.g. "Arial").** The text must still render through the default family, not vanish. Test in Task 4 (`falls back to the default family…`).
4. **Mixed Arabic + digits/Latin text renders in the wrong order** (finding F1). Test in Task 4 (`F1: base direction is ignored…`), plus a human check of the saved PNGs.
5. **paper.js operations may leak items into the scope's project state** (§4.2: no global paper state). Test in Task 3 (`insert:false operations leave the project empty`).

---

## File Structure

```
.gitignore                         # node_modules, dist, coverage, spikes/out, logs
.gitattributes                     # LF everywhere; png/ttf binary
package.json                       # private root: scripts, dev tooling, engines, packageManager
pnpm-workspace.yaml                # workspace globs + version catalog
tsconfig.base.json                 # shared strict compiler options (typecheck only, noEmit)
vitest.config.ts                   # test.projects list
eslint.config.js                   # §4.2 guardrails (Task 2)
.github/workflows/ci.yml           # lint, typecheck, test, build, smoke (Task 2)
docs/spikes.md                     # spike findings (Tasks 3–6)
eval/README.md                     # dev-only eval area (spec A2); harness arrives in M10
eval/clients.md                    # manual MCP client compatibility matrix (Task 6)
packages/engine/
  package.json                     # private; exports ./src/index.ts
  tsconfig.json
  src/index.ts                     # ENGINE_VERSION (only code in M0)
  test/index.test.ts
  test/guardrails.test.ts          # proves ESLint rules fire (Task 2)
  assets/fonts/                    # Tajawal-Regular.ttf, Tajawal-Bold.ttf, OFL.txt (Task 4)
packages/agent-kit/
  package.json                     # private; content only
  README.md
  content/core-contract.md         # first draft; finalized in M9
packages/mcp-server/               # published as "agent-illustrator"
  package.json
  tsconfig.json
  tsdown.config.ts
  src/assets.ts                    # agentKitDir(): bundle-relative with dev fallback
  src/cli.ts                       # --version, --doctor (server arrives in M3)
  test/assets.test.ts
  test/cli.test.ts
spikes/                            # private learning tests; deleted per spec A4
  package.json
  tsconfig.json
  src/paper-shim.d.ts              # types for paper/dist/paper-core.js (Task 3)
  src/paper.ts                     # headless scope + plain-cubic ⇄ paper (Task 3)
  src/resvg.ts                     # font config + render helpers (Task 4)
  src/schema-probe.ts              # 50-variant union vs loose op schema (Task 5)
  src/mcp-probe-server.ts          # stdio MCP server (Task 5)
  test/r1-paper.test.ts
  test/r2-resvg-text.test.ts
  test/r4-mcp.test.ts
```

---

### Task 1: Workspace scaffold and toolchain

**Files:**
- Create: `.gitignore`, `.gitattributes`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `eval/README.md`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/src/index.ts`, `packages/engine/test/index.test.ts`
- Create: `packages/agent-kit/package.json`, `packages/agent-kit/README.md`, `packages/agent-kit/content/core-contract.md`
- Create: `packages/mcp-server/package.json`, `packages/mcp-server/tsconfig.json`, `packages/mcp-server/tsdown.config.ts`, `packages/mcp-server/src/assets.ts`, `packages/mcp-server/src/cli.ts`, `packages/mcp-server/test/assets.test.ts`, `packages/mcp-server/test/cli.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ENGINE_VERSION: string` from `@agent-illustrator/engine`.
  - `agentKitDir(): string` in `packages/mcp-server/src/assets.ts`. It returns an absolute directory containing `core-contract.md`, and throws an `Error` listing the paths it tried if none exists.
  - CLI `agent-illustrator --version`: prints the version to stdout, exit 0.
  - CLI `agent-illustrator --doctor`: prints a report to stderr, exit 0, or exit 1 if content is missing.
  - Any other argument: usage text to stderr, exit 2.
  - Root scripts `test`, `typecheck`, `build`, `smoke`.

- [ ] **Step 1: Initialise git and the package manager**

```bash
git init -b main
npm install -g pnpm@12.10.1
pnpm -v
```
Expected: `pnpm -v` prints `12.10.1`.

- [ ] **Step 2: Write the repository files**

`.gitignore`:
```gitignore
node_modules/
dist/
coverage/
spikes/out/
*.log
```

`.gitattributes`:
```gitattributes
* text=auto eol=lf
*.png binary
*.ttf binary
```

`package.json`:
```json
{
  "name": "agent-illustrator-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.10.1",
  "engines": { "node": ">=22.18" },
  "scripts": {
    "build": "pnpm --filter agent-illustrator build",
    "typecheck": "tsc -p packages/engine && tsc -p packages/mcp-server",
    "test": "vitest run",
    "smoke": "node packages/mcp-server/dist/cli.mjs --version && node packages/mcp-server/dist/cli.mjs --doctor"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*

catalog:
  '@types/node': ^22.20.5
  tsdown: 0.23.0
  typescript: ~6.0.3
  vitest: ^5.0.3
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/engine'],
  },
});
```

- [ ] **Step 3: Write the engine, agent-kit and eval skeletons**

`eval/README.md`:
```markdown
# eval (dev-only, never published)

Evaluation for agent-illustrator, per spec A2:
- `clients.md`: manual MCP client compatibility checklist (started in M0, Task 6).
- M10 adds the agent-quality harness (MCP SDK client plus an OpenAI-compatible tool loop), about 20 briefs,
  the raw-SVG baseline and the side-by-side report. Deterministic render-regression fixtures run in CI.
```

`packages/engine/package.json`:
```json
{
  "name": "@agent-illustrator/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/engine/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/agent-kit/package.json`:
```json
{
  "name": "@agent-illustrator/agent-kit",
  "version": "0.0.0",
  "private": true,
  "files": ["content"]
}
```

`packages/agent-kit/README.md`:
```markdown
# @agent-illustrator/agent-kit

Content only, no code. The Markdown and YAML in `content/` are served by the `agent-illustrator`
MCP server: the core contract feeds the server instructions, and the guides, presets and prompts
feed the `guide(topic)` tool and MCP prompts. The build copies `content/` into the published package.
```

`packages/agent-kit/content/core-contract.md`:
```markdown
# Core contract (draft; finalized in M9)

1. Never write raw SVG. Build the picture with tool calls; the engine owns geometry, layout and rendering.
2. Give every object a short semantic id (`sun`, `hill_back`). Refer to objects by id, or `$last` for the most recent one.
3. Batch related changes into one `apply_ops` call. A batch applies fully or not at all.
4. Numbers are canvas units. Strings like `"50%"` are relative to the canvas or to the op's reference node.
5. After each stage, call `render` (or `describe_scene`, `measure` and `lint` if you cannot see images), fix what you find, then `export_svg`.
```

- [ ] **Step 4: Write the failing engine test**

`packages/engine/test/index.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/index.ts';

describe('engine package', () => {
  it('exposes its version from package.json', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
```

- [ ] **Step 5: Install and run the test to verify it fails**

Run: `pnpm install && pnpm vitest run packages/engine`
Expected: FAIL. Vite reports it cannot resolve `../src/index.ts`.
If pnpm prints "Ignored build scripts" for any package, add that package under `allowBuilds:` in `pnpm-workspace.yaml` (pnpm ≥ 11 setting), re-run `pnpm install`, and note it in the commit message.

- [ ] **Step 6: Implement the engine entry**

`packages/engine/src/index.ts`:
```ts
import pkg from '../package.json' with { type: 'json' };

export const ENGINE_VERSION: string = pkg.version;
```

- [ ] **Step 7: Run the engine test to verify it passes**

Run: `pnpm vitest run packages/engine`
Expected: PASS (1 test).

- [ ] **Step 8: Write the mcp-server package files and failing tests**

`packages/mcp-server/package.json`:
```json
{
  "name": "agent-illustrator",
  "version": "0.0.0",
  "description": "Vector illustration engine for LLM agents, served over MCP.",
  "type": "module",
  "bin": { "agent-illustrator": "./dist/cli.mjs" },
  "files": ["dist"],
  "engines": { "node": ">=22.18" },
  "scripts": { "build": "tsdown" },
  "devDependencies": {
    "@agent-illustrator/agent-kit": "workspace:*",
    "@agent-illustrator/engine": "workspace:*",
    "tsdown": "catalog:"
  }
}
```

`packages/mcp-server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/mcp-server/test/assets.test.ts`:
```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentKitDir } from '../src/assets.ts';

describe('agentKitDir', () => {
  it('finds the workspace agent-kit content when running from source', () => {
    expect(existsSync(join(agentKitDir(), 'core-contract.md'))).toBe(true);
  });
});
```

`packages/mcp-server/test/cli.test.ts`:
```ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

describe('agent-illustrator cli', () => {
  it('--version prints the package version on stdout', () => {
    const r = run('--version');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  it('--doctor finds agent-kit content and reports on stderr only', () => {
    const r = run('--doctor');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('core-contract.md');
  });

  it('unknown arguments print usage to stderr and exit 2', () => {
    const r = run('--nope');
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Usage');
  });
});
```

In `vitest.config.ts`, set `projects: ['packages/engine', 'packages/mcp-server']`.

- [ ] **Step 9: Run the tests to verify they fail**

Run: `pnpm install && pnpm vitest run packages/mcp-server`
Expected: FAIL. `../src/assets.ts` cannot be resolved, and the cli tests exit non-zero because `src/cli.ts` does not exist.

- [ ] **Step 10: Implement assets.ts and cli.ts**

`packages/mcp-server/src/assets.ts`:
```ts
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Directory holding agent-kit content.
 * Published: dist/cli.mjs → dist/agent-kit/ (copied by tsdown).
 * Source:    src/assets.ts → ../../agent-kit/content/ (workspace package).
 */
export function agentKitDir(): string {
  const candidates = [
    new URL('./agent-kit/', import.meta.url),
    new URL('../../agent-kit/content/', import.meta.url),
  ].map((url) => fileURLToPath(url));
  const found = candidates.find((dir) => existsSync(dir));
  if (found === undefined) {
    throw new Error(`agent-kit content not found; looked in: ${candidates.join(', ')}`);
  }
  return found;
}
```

`packages/mcp-server/src/cli.ts`:
```ts
#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION } from '@agent-illustrator/engine';
import pkg from '../package.json' with { type: 'json' };
import { agentKitDir } from './assets.ts';

const arg = process.argv[2];

if (arg === '--version') {
  process.stdout.write(`${pkg.version}\n`);
} else if (arg === '--doctor') {
  const contract = join(agentKitDir(), 'core-contract.md');
  if (!existsSync(contract)) {
    process.stderr.write(`agent-kit content missing: ${contract}\n`);
    process.exit(1);
  }
  process.stderr.write(`agent-illustrator ${pkg.version} (engine ${ENGINE_VERSION})\nagent-kit: ${contract}\n`);
} else {
  process.stderr.write('Usage: agent-illustrator [--version | --doctor]\n');
  process.exit(2);
}
```

- [ ] **Step 11: Run all tests and the type-check**

Run: `pnpm test && pnpm typecheck`
Expected: PASS: engine 1 test, mcp-server 4 tests. `tsc` prints nothing and exits 0.

- [ ] **Step 12: Configure the build**

`packages/mcp-server/tsdown.config.ts`:
```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  platform: 'node',
  fixedExtension: true,
  dts: false,
  clean: true,
  copy: [{ from: '../agent-kit/content/*', to: 'dist/agent-kit' }],
});
```

- [ ] **Step 13: Build and smoke-test the bundle**

Run: `pnpm build && pnpm smoke`
Expected:
- `packages/mcp-server/dist/cli.mjs` and `packages/mcp-server/dist/agent-kit/core-contract.md` exist.
- `pnpm smoke` prints `0.0.0` on stdout, then on stderr `agent-illustrator 0.0.0 (engine 0.0.0)` and `agent-kit: …dist…agent-kit…core-contract.md`.

The path MUST point inside `dist/`. If it points at `packages/agent-kit/content`, the bundle-relative URL broke. Inspect `dist/cli.mjs` for how `new URL('./agent-kit/', import.meta.url)` was emitted and fix it before continuing.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm workspace with engine, agent-kit and agent-illustrator packages"
```

---

### Task 2: Guardrails (ESLint §4.2 rules) and CI

**Files:**
- Create: `eslint.config.js`, `packages/engine/test/guardrails.test.ts`, `.github/workflows/ci.yml`
- Modify: `package.json` (add `lint` and `check` scripts and ESLint devDependencies), `pnpm-workspace.yaml` (catalog)

**Interfaces:**
- Consumes: the Task 1 workspace layout.
- Produces:
  - Root scripts `pnpm lint` and `pnpm check` (lint + typecheck + test).
  - Engine folder layering enforced as: `geometry` and `random` are leaves; `scene` must not import ops/analysis/render/random; `render` must not import ops/analysis; `analysis` must not import ops; `ops` may import all.
  - CI workflow `ci`.

- [ ] **Step 1: Add ESLint dependencies**

Append to the `catalog:` in `pnpm-workspace.yaml`:
```yaml
  '@eslint/js': ^10.0.1
  eslint: ^10.12.0
  typescript-eslint: ^8.71.1
```
Add to root `package.json` `devDependencies`:
```json
    "@eslint/js": "catalog:",
    "eslint": "catalog:",
    "typescript-eslint": "catalog:"
```
Add to root `package.json` `scripts`:
```json
    "lint": "eslint .",
    "check": "pnpm lint && pnpm typecheck && pnpm test"
```
Run: `pnpm install`
Expected: completes; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Write the failing guardrail test**

`packages/engine/test/guardrails.test.ts`:
```ts
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIds(relPath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, relPath) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
}

describe('PROJECT_INIT §4.2 guardrails', () => {
  it.each([
    ['packages/engine/src/ops/x.ts', 'export const r = Math.random();', 'no-restricted-properties'],
    ['packages/engine/src/scene/x.ts', "import paper from 'paper/dist/paper-core.js';\nexport default paper;", 'no-restricted-imports'],
    ['packages/engine/src/ops/x.ts', "import { McpServer } from '@modelcontextprotocol/server';\nexport default McpServer;", 'no-restricted-imports'],
    ['packages/engine/src/ops/x.ts', "import kit from '@agent-illustrator/agent-kit';\nexport default kit;", 'no-restricted-imports'],
    ['packages/engine/src/geometry/x.ts', "import { doc } from '../scene/model.ts';\nexport default doc;", 'no-restricted-imports'],
    ['packages/engine/src/scene/x.ts', "import { op } from '../ops/registry.ts';\nexport default op;", 'no-restricted-imports'],
    ['packages/engine/src/render/x.ts', "import { lint } from '../analysis/lint.ts';\nexport default lint;", 'no-restricted-imports'],
    ['packages/engine/src/random/x.ts', "import { b } from '../geometry/bezier.ts';\nexport default b;", 'no-restricted-imports'],
  ])('rejects %s: %s', async (file, code, rule) => {
    expect(await ruleIds(file, code)).toContain(rule);
  });

  it.each([
    ['packages/engine/src/geometry/x.ts', "import paper from 'paper/dist/paper-core.js';\nexport default paper;"],
    ['packages/engine/src/ops/x.ts', "import { doc } from '../scene/model.ts';\nimport { b } from '../geometry/bezier.ts';\nexport default [doc, b];"],
    ['packages/engine/src/analysis/x.ts', "import { svg } from '../render/svg.ts';\nexport default svg;"],
    ['packages/mcp-server/src/x.ts', 'export const r = Math.random();'],
  ])('allows %s: %s', async (file, code) => {
    expect(await ruleIds(file, code)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run packages/engine/test/guardrails.test.ts`
Expected: FAIL. ESLint throws because no config file is found.

- [ ] **Step 4: Write the ESLint config**

`eslint.config.js`:
```js
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// PROJECT_INIT §2.3 / §4.2: engine folders and the sibling folders each one must not import.
const LAYER_BANS = {
  geometry: ['scene', 'ops', 'analysis', 'render', 'random'],
  random: ['geometry', 'scene', 'ops', 'analysis', 'render'],
  scene: ['ops', 'analysis', 'render', 'random'],
  analysis: ['ops'],
  render: ['ops', 'analysis'],
  ops: [],
};

const ENGINE_PURITY = {
  group: [
    '@modelcontextprotocol/*',
    'agent-illustrator',
    'agent-illustrator/*',
    '@agent-illustrator/agent-kit',
    '@agent-illustrator/agent-kit/*',
  ],
  message: 'engine must not depend on MCP, the server or agent-kit (PROJECT_INIT §4.2).',
};

const PAPER_ONLY_IN_GEOMETRY = {
  group: ['paper', 'paper/*', 'paper-jsdom'],
  message: 'Only engine/src/geometry may import paper.js (PROJECT_INIT §4.2).',
};

function layerConfig(folder) {
  const bans = LAYER_BANS[folder];
  const patterns = [ENGINE_PURITY];
  if (folder !== 'geometry') patterns.push(PAPER_ONLY_IN_GEOMETRY);
  if (bans.length > 0) {
    patterns.push({
      regex: `(^|/)(${bans.join('|')})(/|$)`,
      message: `engine/src/${folder} must not import ${bans.join(', ')}: dependencies point downward (PROJECT_INIT §2.3).`,
    });
  }
  return {
    files: [`packages/engine/src/${folder}/**/*.ts`],
    rules: { 'no-restricted-imports': ['error', { patterns }] },
  };
}

export default defineConfig([
  globalIgnores(['**/dist/', '**/node_modules/', 'coverage/', 'spikes/out/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['packages/engine/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in engine/src/random (PROJECT_INIT D13, §4.2).' },
      ],
      'no-restricted-imports': ['error', { patterns: [ENGINE_PURITY, PAPER_ONLY_IN_GEOMETRY] }],
    },
  },
  ...Object.keys(LAYER_BANS).map(layerConfig),
]);
```

- [ ] **Step 5: Run the guardrail test and lint the repo**

Run: `pnpm vitest run packages/engine/test/guardrails.test.ts && pnpm lint`
Expected: 12 tests PASS; `eslint .` exits 0 with no output.

- [ ] **Step 6: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    name: ${{ matrix.os }} / node ${{ matrix.node }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: ubuntu-latest, node: 22 }
          - { os: ubuntu-latest, node: 24 }
          - { os: windows-latest, node: 24 }
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - run: pnpm smoke
```

- [ ] **Step 7: Run the full local check**

Run: `pnpm check && pnpm build && pnpm smoke`
Expected: all green, same output as Task 1 Step 13.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: enforce engine layering and seeded-random rules with eslint; add CI"
```

- [ ] **Step 9: Push and confirm CI (needs the project owner)**

The owner creates the GitHub repository and approves the push. Then:
```bash
git remote add origin <repo-url>
git push -u origin main
```
Expected: all three `ci` matrix jobs are green. If the Windows job fails, fix it before Task 3, because the spikes depend on Windows prebuilds.

---

### Task 3: Spike R1, paper.js headless (S6 evidence)

**Files:**
- Create: `spikes/package.json`, `spikes/tsconfig.json`, `spikes/src/paper-shim.d.ts`, `spikes/src/paper.ts`, `spikes/test/r1-paper.test.ts`, `docs/spikes.md`
- Modify: `pnpm-workspace.yaml` (add `spikes` and the `paper` catalog entry), `vitest.config.ts` (add the `spikes` project), `package.json` (`typecheck` also checks spikes)

**Interfaces:**
- Consumes: nothing from earlier tasks besides the workspace.
- Produces (spike-only; M1 re-implements them in `engine/src/geometry/paper-adapter.ts` with the same data shapes):
  - `type Vec2 = [number, number]`
  - `type Seg = [number, number, number, number, number, number]`, as `[c1x, c1y, c2x, c2y, x, y]`
  - `type Subpath = { start: Vec2; segs: Seg[]; closed: boolean }`
  - `createScope(): paper.PaperScope`
  - `toPaper(scope, subpaths: Subpath[]): paper.PathItem`
  - `fromPaper(item: paper.PathItem): Subpath[]`
  - `area(item: paper.PathItem): number` (absolute value)

- [ ] **Step 1: Create the spikes package**

Edit `pnpm-workspace.yaml`. `packages:` becomes:
```yaml
packages:
  - packages/*
  - spikes
```
Append to `catalog:`:
```yaml
  paper: 0.12.18
```

`spikes/package.json`:
```json
{
  "name": "@agent-illustrator/spikes",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "paper": "catalog:"
  }
}
```

`spikes/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src", "test"]
}
```

In `vitest.config.ts`, set `projects: ['packages/engine', 'packages/mcp-server', 'spikes']`.
In root `package.json`, set `"typecheck": "tsc -p packages/engine && tsc -p packages/mcp-server && tsc -p spikes"`.

`spikes/src/paper-shim.d.ts`:
```ts
/// <reference types="paper" />
// paper's own d.ts declares the global `paper` namespace, but the ESM-safe import path
// `paper/dist/paper-core.js` resolves to a declaration file with no exports.
declare module 'paper/dist/paper-core.js' {
  export default paper;
}
```

Run: `pnpm install`
Expected: `paper@0.12.18` installed for `@agent-illustrator/spikes`, with no jsdom in `spikes/node_modules`.

- [ ] **Step 2: Write the failing R1 tests**

`spikes/test/r1-paper.test.ts`:
```ts
import type paper from 'paper/dist/paper-core.js';
import { describe, expect, it } from 'vitest';
import { area, createScope, fromPaper, toPaper, type Subpath } from '../src/paper.ts';

/** Axis-aligned square as straight cubic segments (control points on the endpoints). */
function square(x: number, y: number, s: number): Subpath {
  return {
    start: [x, y],
    closed: true,
    segs: [
      [x, y, x + s, y, x + s, y],
      [x + s, y, x + s, y + s, x + s, y + s],
      [x + s, y + s, x, y + s, x, y + s],
      [x, y + s, x, y, x, y],
    ],
  };
}

describe('R1: paper.js core runs headless (spec S6)', () => {
  it('sets up a scope with no DOM and no jsdom', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
    expect(createScope().project).toBeTruthy();
  });

  it('round-trips plain cubic subpaths, closed and open', () => {
    const scope = createScope();
    const open: Subpath = { start: [0, 0], closed: false, segs: [[10, 20, 30, 20, 40, 0]] };
    expect(fromPaper(toPaper(scope, [square(0, 0, 10)]))).toEqual([square(0, 0, 10)]);
    expect(fromPaper(toPaper(scope, [open]))).toEqual([open]);
  });

  it('computes the four booleans with the expected areas', () => {
    const scope = createScope();
    const a = toPaper(scope, [square(0, 0, 10)]);
    const b = toPaper(scope, [square(5, 5, 10)]);
    expect(area(a.unite(b, { insert: false }))).toBeCloseTo(175, 6);
    expect(area(a.intersect(b, { insert: false }))).toBeCloseTo(25, 6);
    expect(area(a.subtract(b, { insert: false }))).toBeCloseTo(75, 6);
    expect(area(a.exclude(b, { insert: false }))).toBeCloseTo(150, 6);
  });

  it('unites squares sharing an edge into one closed subpath', () => {
    const scope = createScope();
    const merged = toPaper(scope, [square(0, 0, 10)]).unite(toPaper(scope, [square(10, 0, 10)]), { insert: false });
    expect(fromPaper(merged)).toHaveLength(1);
    expect(area(merged)).toBeCloseTo(200, 6);
  });

  it('simplify (Schneider fit) reduces 200 noisy points to far fewer segments within tolerance', () => {
    const scope = createScope();
    const pts = Array.from({ length: 200 }, (_, i): [number, number] => {
      const a = (i / 200) * Math.PI * 2;
      const r = 100 + Math.sin(i * 12.9898);
      return [Math.cos(a) * r, Math.sin(a) * r];
    });
    const path = new scope.Path({ segments: pts, closed: true, insert: false });
    path.simplify(2.5);
    console.info(`[R1] simplify: 200 points -> ${path.segments.length} segments`);
    expect(path.segments.length).toBeLessThan(60);
    for (const [x, y] of pts) {
      const p = new scope.Point(x, y);
      expect(path.getNearestPoint(p).getDistance(p)).toBeLessThan(4);
    }
  });

  it("smooth({ type: 'catmull-rom', factor: 0.5 }) keeps anchors and adds handles", () => {
    const scope = createScope();
    const pts: [number, number][] = [[0, 0], [50, 40], [100, 0], [150, 40], [200, 0]];
    const path = new scope.Path({ segments: pts, insert: false });
    path.smooth({ type: 'catmull-rom', factor: 0.5 });
    path.segments.forEach((s, i) => expect([s.point.x, s.point.y]).toEqual(pts[i]));
    expect(path.segments[1]!.handleIn.length).toBeGreaterThan(0);
  });

  it('insert:false operations leave the project empty (no shared paper state)', () => {
    const scope = createScope();
    const a = toPaper(scope, [square(0, 0, 10)]);
    a.unite(toPaper(scope, [square(5, 5, 10)]), { insert: false });
    expect(scope.project.isEmpty()).toBe(true);
  });

  it('200 successive unites finish in a bounded time', () => {
    const scope = createScope();
    let acc: paper.PathItem = new scope.Path.Circle({ center: [0, 0], radius: 20, insert: false });
    const t0 = performance.now();
    for (let i = 1; i <= 200; i++) {
      const next = new scope.Path.Circle({ center: [i * 7, Math.sin(i) * 15], radius: 20, insert: false });
      acc = acc.unite(next, { insert: false });
    }
    const ms = performance.now() - t0;
    console.info(`[R1] 200 unites: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run spikes/test/r1-paper.test.ts`
Expected: FAIL. `../src/paper.ts` cannot be resolved.

- [ ] **Step 4: Implement the headless adapter**

`spikes/src/paper.ts`:
```ts
import paper from 'paper/dist/paper-core.js';

export type Vec2 = [number, number];
/** One cubic segment, spec A3 tuple: [c1x, c1y, c2x, c2y, x, y]. */
export type Seg = [number, number, number, number, number, number];
export type Subpath = { start: Vec2; segs: Seg[]; closed: boolean };

/** Fresh headless paper.js scope: no DOM, no jsdom (spec S6). */
export function createScope(): paper.PaperScope {
  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(1, 1));
  return scope;
}

/** Plain cubic subpaths → paper item. Nothing is inserted into the project. */
export function toPaper(scope: paper.PaperScope, subpaths: Subpath[]): paper.PathItem {
  const paths = subpaths.map((sp) => {
    const path = new scope.Path({ insert: false });
    let last = path.add(new scope.Point(sp.start[0], sp.start[1]));
    sp.segs.forEach(([c1x, c1y, c2x, c2y, x, y], i) => {
      last.handleOut = new scope.Point(c1x - last.point.x, c1y - last.point.y);
      const closesLoop = sp.closed && i === sp.segs.length - 1 && x === sp.start[0] && y === sp.start[1];
      const next = closesLoop ? path.firstSegment : path.add(new scope.Point(x, y));
      next.handleIn = new scope.Point(c2x - x, c2y - y);
      last = next;
    });
    path.closed = sp.closed;
    return path;
  });
  return paths.length === 1 ? paths[0]! : new scope.CompoundPath({ children: paths, insert: false });
}

/** paper item → plain cubic subpaths, one per child path. */
export function fromPaper(item: paper.PathItem): Subpath[] {
  const paths = item.className === 'CompoundPath' ? (item.children as paper.Path[]) : [item as paper.Path];
  return paths
    .filter((p) => p.curves.length > 0)
    .map((p) => ({
      start: [p.firstSegment.point.x, p.firstSegment.point.y],
      closed: p.closed,
      segs: p.curves.map((c): Seg => [
        c.point1.x + c.handle1.x, c.point1.y + c.handle1.y,
        c.point2.x + c.handle2.x, c.point2.y + c.handle2.y,
        c.point2.x, c.point2.y,
      ]),
    }));
}

export function area(item: paper.PathItem): number {
  return Math.abs((item as paper.Path | paper.CompoundPath).area);
}
```

- [ ] **Step 5: Run the tests and the type-check**

Run: `pnpm vitest run spikes/test/r1-paper.test.ts && pnpm typecheck && pnpm lint`
Expected:
- 8 tests PASS, and the console shows the `[R1]` lines with the segment count and unite timing.
- typecheck and lint exit 0.
- If `tsc` rejects the shim, try `export = paper;` instead of `export default paper;` in `paper-shim.d.ts`, and record whichever works in `docs/spikes.md`.

- [ ] **Step 6: Start docs/spikes.md with the R1 record**

`docs/spikes.md`:
```markdown
# M0 spike findings

Each section records what the in-repo spike tests proved, with the date, OS and Node version, and
links the spec decision it settles. The pre-M0 library check (spec "Outcomes recorded") is the baseline.

## R1: paper.js headless (settles spec S6)
- Tests: `spikes/test/r1-paper.test.ts`
- Import: `import paper from 'paper/dist/paper-core.js'` plus `spikes/src/paper-shim.d.ts`. No jsdom.
- Data shape: spec A3 subpaths (`start`, `segs` as `[c1x,c1y,c2x,c2y,x,y]`, `closed`). They round-trip exactly.
- Booleans: unite/intersect/subtract/exclude areas exact (175/25/75/150). An edge-sharing unite gives one subpath.
- `simplify(2.5)`: 200 points → (copy the `[R1]` segment count from the test output) segments.
- `smooth({ type: 'catmull-rom', factor: 0.5 })` keeps anchors.
- 200 successive unites: (copy the `[R1]` timing) ms on (OS / Node).
- Result: (Confirmed | Differs: describe).
```
Replace each parenthesised instruction with the observed value from Step 5.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test(spikes): R1 paper.js core runs headless with plain-cubic round trip"
```

---

### Task 4: Spike R2, resvg-js text (S2 evidence, finding F1)

**Files:**
- Create: `packages/engine/assets/fonts/Tajawal-Regular.ttf`, `packages/engine/assets/fonts/Tajawal-Bold.ttf`, `packages/engine/assets/fonts/OFL.txt`
- Create: `spikes/src/resvg.ts`, `spikes/test/r2-resvg-text.test.ts`
- Modify: `pnpm-workspace.yaml` (catalog), `spikes/package.json` (dependency), `docs/spikes.md` (R2 section)

**Interfaces:**
- Consumes: workspace and the spikes package from Task 3.
- Produces (spike-only):
  - `FONT`: resvg `font` options with the bundled Tajawal fonts, `loadSystemFonts: false`, `defaultFontFamily: 'Tajawal'`
  - `svgDoc(body, width?, height?): string`
  - `textSvg(content, attrs?): string`
  - `bbox(svg)`: resvg `BBox | undefined`
  - `inkPixels(svg): number`
  - `renderPng(svg): Buffer`
  - `savePng(name, svg): void`, which writes `spikes/out/<name>.png`
- Font files stay in `packages/engine/assets/fonts/` for M8.

- [ ] **Step 1: Add the bundled fonts (OFL)**

```bash
mkdir -p packages/engine/assets/fonts
curl -fL -o packages/engine/assets/fonts/Tajawal-Regular.ttf https://github.com/google/fonts/raw/main/ofl/tajawal/Tajawal-Regular.ttf
curl -fL -o packages/engine/assets/fonts/Tajawal-Bold.ttf https://github.com/google/fonts/raw/main/ofl/tajawal/Tajawal-Bold.ttf
curl -fL -o packages/engine/assets/fonts/OFL.txt https://github.com/google/fonts/raw/main/ofl/tajawal/OFL.txt
ls -l packages/engine/assets/fonts
```
Expected: both TTFs are about 60 KB, and `OFL.txt` starts with the copyright line and contains "SIL OPEN FONT LICENSE".

- [ ] **Step 2: Add resvg-js to the spikes package**

Append to the `catalog:` in `pnpm-workspace.yaml`:
```yaml
  '@resvg/resvg-js': 2.6.2
```
In `spikes/package.json` `dependencies`, add `"@resvg/resvg-js": "catalog:"`.
Run: `pnpm install`
Expected: installs the prebuilt platform package (`@resvg/resvg-js-win32-x64-msvc` on Windows) with no compile step.

- [ ] **Step 3: Write the failing R2 tests**

`spikes/test/r2-resvg-text.test.ts`:
```ts
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { bbox, FONT, inkPixels, renderPng, savePng, svgDoc, textSvg } from '../src/resvg.ts';

const AR_HOUSE = '\u0628\u064A\u062A'; // "بيت": letters that join
const AR_HOUSE_ISOLATED = '\u0628\u200C\u064A\u200C\u062A'; // same letters, ZWNJ blocks joining
const AR_MIXED = '\u0639\u062F\u062F 123'; // "عدد 123": Arabic run plus digits

describe('R2: resvg-js text with bundled fonts only', () => {
  it('renders Latin text using only the bundled fonts', () => {
    const svg = textSvg('Hello');
    savePng('r2-latin', svg);
    expect(inkPixels(svg)).toBeGreaterThan(200);
  });

  it('falls back to the default family when the requested font is not bundled', () => {
    const svg = svgDoc('<text x="10" y="70" font-family="Arial" font-size="40">Hello</text>');
    expect(inkPixels(svg)).toBeGreaterThan(200);
  });

  it('getBBox returns the ink box of a single text element (spec S2)', () => {
    const b = bbox(textSvg('Hello'));
    console.info(`[R2] "Hello" 40px Tajawal bbox: ${JSON.stringify(b)}`);
    expect(b).toBeDefined();
    expect(b!.width).toBeGreaterThan(60);
    expect(b!.width).toBeLessThan(160);
    expect(b!.height).toBeGreaterThan(20);
    expect(b!.height).toBeLessThan(45);
    expect(b!.x).toBeGreaterThan(5);
  });

  it('shapes Arabic: joined letters are narrower than the same letters kept isolated', () => {
    savePng('r2-arabic-joined', textSvg(AR_HOUSE));
    savePng('r2-arabic-isolated', textSvg(AR_HOUSE_ISOLATED));
    expect(bbox(textSvg(AR_HOUSE))!.width).toBeLessThan(bbox(textSvg(AR_HOUSE_ISOLATED))!.width);
  });

  it('F1: base direction is ignored, so mixed RTL text needs RLI…PDI wrapping', () => {
    const plain = textSvg(AR_MIXED, 'direction="rtl"');
    const wrapped = textSvg(`\u2067${AR_MIXED}\u2069`, 'direction="rtl"');
    savePng('r2-mixed-plain', plain);
    savePng('r2-mixed-wrapped', wrapped);
    expect(renderPng(plain).equals(renderPng(wrapped))).toBe(false);
  });

  it('renders text along a path (textPath)', () => {
    const svg = svgDoc(
      '<defs><path id="curve" d="M10 100 C 100 0, 300 0, 390 100"/></defs>' +
        '<text font-family="Tajawal" font-size="24"><textPath xlink:href="#curve">Along the curve</textPath></text>',
    );
    savePng('r2-textpath', svg);
    expect(inkPixels(svg)).toBeGreaterThan(100);
  });

  it('toString() returns usvg SVG with text converted to paths', () => {
    const out = new Resvg(textSvg('Hello'), { font: FONT }).toString();
    expect(out).not.toContain('<text');
    expect(out).toContain('<path');
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm vitest run spikes/test/r2-resvg-text.test.ts`
Expected: FAIL. `../src/resvg.ts` cannot be resolved.

- [ ] **Step 5: Implement the resvg helpers**

`spikes/src/resvg.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const fontPath = (file: string): string =>
  fileURLToPath(new URL(`../../packages/engine/assets/fonts/${file}`, import.meta.url));

/** Bundled fonts only: rendering never depends on what the host machine has installed. */
export const FONT = {
  fontFiles: [fontPath('Tajawal-Regular.ttf'), fontPath('Tajawal-Bold.ttf')],
  loadSystemFonts: false,
  defaultFontFamily: 'Tajawal',
};

export function svgDoc(body: string, width = 400, height = 120): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  );
}

export function textSvg(content: string, attrs = ''): string {
  return svgDoc(`<text x="10" y="70" font-family="Tajawal" font-size="40" ${attrs}>${content}</text>`);
}

export function bbox(svg: string) {
  return new Resvg(svg, { font: FONT }).getBBox();
}

export function renderPng(svg: string): Buffer {
  return new Resvg(svg, { font: FONT }).render().asPng();
}

export function inkPixels(svg: string): number {
  const { pixels } = new Resvg(svg, { font: FONT }).render();
  let count = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) count++;
  return count;
}

const OUT_DIR = fileURLToPath(new URL('../out/', import.meta.url));

/** Writes spikes/out/<name>.png for human review (gitignored). */
export function savePng(name: string, svg: string): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${name}.png`), renderPng(svg));
}
```

- [ ] **Step 6: Run the tests, the type-check and lint**

Run: `pnpm vitest run spikes/test/r2-resvg-text.test.ts && pnpm typecheck && pnpm lint`
Expected: 7 tests PASS, `[R2]` bbox logged, and `spikes/out/` holds 6 PNGs.

- [ ] **Step 7: Human check of the saved PNGs**

Open `spikes/out/` and confirm:
- `r2-arabic-joined.png` shows connected letters, and `r2-arabic-isolated.png` shows them separated.
- `r2-mixed-wrapped.png` reads right-to-left: "123" sits to the LEFT of the Arabic word.
- `r2-mixed-plain.png` shows the wrong (LTR) order.
- `r2-textpath.png` shows text following the arc.

- [ ] **Step 8: Record R2 in docs/spikes.md**

Append:
```markdown
## R2: resvg-js text (settles spec S2; confirms finding F1)
- Tests: `spikes/test/r2-resvg-text.test.ts`. PNGs in `spikes/out/` (not committed).
- Fonts: Tajawal Regular/Bold (OFL) in `packages/engine/assets/fonts/`, `loadSystemFonts: false`.
  An unknown family ("Arial") falls back to the default family.
- `getBBox()` of a single `<text>`: (copy the `[R2]` line). Used for text bounds instead of opentype.js.
- Arabic shaping: joined narrower than isolated, and the visual check passed (yes/no).
- F1: `direction="rtl"` is ignored. Wrapping in U+2067…U+2069 gives correct order; visual check (yes/no).
  Engine rule for M8: wrap RTL text content in RLI…PDI when serializing.
- `textPath` renders; `toString()` outputs text as paths.
- Result: (Confirmed | Differs: describe).
```
Replace each parenthesised instruction with what you observed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "test(spikes): R2 resvg text with bundled Tajawal, Arabic shaping and RTL isolate finding"
```

---

### Task 5: Spike R3/R4, MCP SDK v2 stdio server (S1 evidence)

**Files:**
- Create: `spikes/src/schema-probe.ts`, `spikes/src/mcp-probe-server.ts`, `spikes/test/r4-mcp.test.ts`
- Modify: `pnpm-workspace.yaml` (catalog), `spikes/package.json` (dependencies), `docs/spikes.md` (R3/R4 section)

**Interfaces:**
- Consumes: the `FONT` setting is not needed here. The server renders its own PNG with `@resvg/resvg-js` (Task 4 dependency).
- Produces (spike-only; M3 builds the real server):
  - `UNION_OPS`, `LOOSE_OPS`, `OP_NAMES` from `schema-probe.ts`
  - A stdio server run with `node spikes/src/mcp-probe-server.ts`, exposing:
    - tool `render_probe({ color? })` → text block + `image/png` block
    - tool `ops_union_probe({ ops })`, whose input schema embeds the 50-variant union
    - tool `ops_loose_probe({ ops })`, with a loose input schema and server-side union validation; returns `isError` with a prettified zod message
    - prompt `illustrate_probe({ brief })`
    - server instructions mentioning `render_probe`

- [ ] **Step 1: Add the MCP SDK and zod**

Append to the `catalog:` in `pnpm-workspace.yaml`:
```yaml
  '@modelcontextprotocol/client': ^2.3.1
  '@modelcontextprotocol/server': ^2.3.1
  zod: ^4.6.5
```
Add to `spikes/package.json` `dependencies`:
```json
    "@modelcontextprotocol/client": "catalog:",
    "@modelcontextprotocol/server": "catalog:",
    "zod": "catalog:"
```
Run: `pnpm install`
Expected: completes.

- [ ] **Step 2: Write the failing R3/R4 tests**

`spikes/test/r4-mcp.test.ts`:
```ts
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverPath = fileURLToPath(new URL('../src/mcp-probe-server.ts', import.meta.url));

type Block = { type: string; text?: string; data?: string; mimeType?: string };

/** Sends a raw initialize request and resolves with every complete stdout line up to the response. */
function rawInitialize(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no initialize response; stdout so far: ${buf}`));
    }, 15_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buf += chunk;
      const complete = buf.split('\n').slice(0, -1).filter((l) => l.trim() !== '');
      if (complete.some((l) => l.includes('"id":1'))) {
        clearTimeout(timer);
        child.kill();
        resolve(complete);
      }
    });
    const init = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw-probe', version: '0.0.0' } },
    };
    child.stdin.write(`${JSON.stringify(init)}\n`);
  });
}

describe('R3/R4: MCP SDK v2 stdio server', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: 'spike-test', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }));
  }, 20_000);

  afterAll(async () => {
    await client.close();
  });

  it('writes nothing but JSON-RPC lines to stdout', async () => {
    const lines = await rawInitialize();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  }, 20_000);

  it('exposes server instructions', () => {
    expect(client.getInstructions()).toContain('render_probe');
  });

  it('returns a PNG image content block next to a text block', async () => {
    const res = await client.callTool({ name: 'render_probe', arguments: { color: '#3366ff' } });
    const blocks = res.content as unknown as Block[];
    const image = blocks.find((b) => b.type === 'image');
    expect(blocks.some((b) => b.type === 'text')).toBe(true);
    expect(image?.mimeType).toBe('image/png');
    expect(Buffer.from(image!.data!, 'base64').subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('serves a prompt with arguments', async () => {
    const prompt = await client.getPrompt({ name: 'illustrate_probe', arguments: { brief: 'desert sunset' } });
    expect(JSON.stringify(prompt.messages)).toContain('desert sunset');
  });

  it('S1: the loose ops schema is far smaller than the union and no tool schema uses $ref', async () => {
    const { tools } = await client.listTools();
    const bytes = (name: string) => JSON.stringify(tools.find((t) => t.name === name)?.inputSchema).length;
    const union = bytes('ops_union_probe');
    const loose = bytes('ops_loose_probe');
    console.info(`[R4] inputSchema bytes: union=${union} loose=${loose}`);
    expect(loose).toBeLessThan(1000);
    expect(union).toBeGreaterThan(loose * 10);
    for (const tool of tools) expect(JSON.stringify(tool.inputSchema)).not.toMatch(/\$ref|\$defs/);
  });

  it('S1: the loose schema still rejects a malformed op on the server with a readable error', async () => {
    const res = await client.callTool({ name: 'ops_loose_probe', arguments: { ops: [{ op: 'op_1', id: 'a' }] } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('.at'); // zod path of the missing field, e.g. [0].at
  });

  it('S1: an unknown op name is rejected by the advertised enum', async () => {
    const res = await client.callTool({ name: 'ops_loose_probe', arguments: { ops: [{ op: 'nope' }] } });
    expect(res.isError).toBe(true);
  });

  it('S1: valid ops pass the loose schema and server-side validation', async () => {
    const res = await client.callTool({
      name: 'ops_loose_probe',
      arguments: { ops: [{ op: 'op_7', id: 'sun', at: { x: 10, y: 20 } }] },
    });
    expect(res.isError ?? false).toBe(false);
    expect(JSON.stringify(res.content)).toContain('ok: 1 ops');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run spikes/test/r4-mcp.test.ts`
Expected: FAIL. `beforeAll` errors because the spawned `mcp-probe-server.ts` does not exist (the client connection closes).

- [ ] **Step 4: Implement the schema probe**

`spikes/src/schema-probe.ts`:
```ts
import * as z from 'zod';

export const OP_NAMES = Array.from({ length: 50 }, (_, i) => `op_${i}`) as [string, ...string[]];

// One shared instance on purpose: proves the SDK inlines reused sub-schemas instead of emitting $ref.
const point = z.object({ x: z.number(), y: z.number() });

const variants = OP_NAMES.map((name) =>
  z.object({
    op: z.literal(name),
    id: z.string(),
    at: point,
    size: z.number().positive().optional(),
    fill: z.string().optional(),
  }),
);
type Variant = (typeof variants)[number];

/** Strict per-op validation: what the registry will run on the server (M2). */
export const UNION_OPS = z.discriminatedUnion('op', variants as [Variant, ...Variant[]]);

/** What the tool advertises (spec S1): op name enum plus passthrough fields. */
export const LOOSE_OPS = z.looseObject({ op: z.enum(OP_NAMES) });
```

- [ ] **Step 5: Implement the probe server**

`spikes/src/mcp-probe-server.ts`:
```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Resvg } from '@resvg/resvg-js';
import * as z from 'zod';
import { LOOSE_OPS, UNION_OPS } from './schema-probe.ts';

const INSTRUCTIONS =
  'Spike server for agent-illustrator M0. Call render_probe to receive a PNG; ' +
  'ops_union_probe and ops_loose_probe compare tool-schema styles.';

function circlePng(color: string): Buffer {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">' +
    `<rect width="128" height="128" fill="#ffffff"/><circle cx="64" cy="64" r="48" fill="${color}"/></svg>`;
  return new Resvg(svg).render().asPng();
}

function createServer(): McpServer {
  const server = new McpServer({ name: 'agent-illustrator-spike', version: '0.0.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'render_probe',
    {
      title: 'Render probe',
      description: 'Returns a PNG of a filled circle plus a short text note.',
      inputSchema: z.object({ color: z.string().default('#e4572e').describe('CSS color of the circle') }),
    },
    async ({ color }) => ({
      content: [
        { type: 'text', text: `Rendered a ${color} circle (128x128 PNG).` },
        { type: 'image', data: circlePng(color).toString('base64'), mimeType: 'image/png' },
      ],
    }),
  );

  server.registerTool(
    'ops_union_probe',
    {
      description: 'Schema probe: the ops array advertises a 50-variant discriminated union.',
      inputSchema: z.object({ ops: z.array(UNION_OPS) }),
    },
    async ({ ops }) => ({ content: [{ type: 'text', text: `ok: ${ops.length} ops` }] }),
  );

  server.registerTool(
    'ops_loose_probe',
    {
      description: 'Schema probe: the ops array advertises only { op: enum }; each op is validated on the server.',
      inputSchema: z.object({ ops: z.array(LOOSE_OPS) }),
    },
    async ({ ops }) => {
      const parsed = z.array(UNION_OPS).safeParse(ops);
      if (!parsed.success) {
        return { isError: true, content: [{ type: 'text', text: z.prettifyError(parsed.error) }] };
      }
      return { content: [{ type: 'text', text: `ok: ${parsed.data.length} ops` }] };
    },
  );

  server.registerPrompt(
    'illustrate_probe',
    { description: 'Draft shape of the /illustrate prompt.', argsSchema: z.object({ brief: z.string() }) },
    ({ brief }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: `Illustrate this brief with the agent-illustrator tools: ${brief}` } }],
    }),
  );

  return server;
}

await serveStdio(createServer);
```

- [ ] **Step 6: Run the tests, the type-check and lint**

Run: `pnpm vitest run spikes/test/r4-mcp.test.ts && pnpm typecheck && pnpm lint`
Expected: 8 tests PASS, and the `[R4]` line shows both schema sizes.

If the build or tests fail on an SDK name:
- The v2 API was checked against docs and local probes on 2026-10-07 (spec "MCP SDK v2 API"). For anything that differs, read `node_modules/@modelcontextprotocol/server/dist/index.d.mts` (and the client's), use the v2 name, and record the difference in `docs/spikes.md`.
- If the `$ref` assertion fails, keep the test, set `point` to a fresh `z.object` per variant, and record "SDK emits $ref for reused schemas; M3 must not reuse schema instances in tool inputs".

- [ ] **Step 7: Check the server with MCP Inspector (headless)**

Run: `npx @modelcontextprotocol/inspector@2.9.0 --cli node spikes/src/mcp-probe-server.ts --method tools/list`
Expected: JSON listing `render_probe`, `ops_union_probe` and `ops_loose_probe`, and nothing else on stdout. Exit code 0.

- [ ] **Step 8: Record R3/R4 in docs/spikes.md**

Append:
```markdown
## R3/R4: MCP SDK v2 stdio server (settles spec S1; R3 client matrix in Task 6)
- Tests: `spikes/test/r4-mcp.test.ts`. Server: `node spikes/src/mcp-probe-server.ts`.
- API used: `new McpServer(info, { instructions })`, `registerTool(name, { inputSchema: z.object(...) }, handler)`,
  `registerPrompt(name, { argsSchema }, cb)`, `serveStdio(factory)`. Client: `StdioClientTransport`.
  Differences from the spec: (none | list).
- stdout purity: only JSON-RPC lines at startup and initialize.
- Schema sizes: (copy the `[R4]` line). `$ref` in tool schemas: (none | emitted, with mitigation).
- Loose schema: malformed or unknown ops come back as `isError` with a readable zod message.
- Inspector CLI `tools/list`: OK (yes/no).
- Result: (Confirmed | Differs: describe).
```
Replace each parenthesised instruction with what you observed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "test(spikes): R3/R4 MCP SDK v2 stdio probe with image block, prompt and schema-size probe"
```

---

### Task 6: Client verification, spike report and M0 acceptance

Manual. It needs the project owner's MCP clients.

**Files:**
- Create: `eval/clients.md` (client matrix, reused by M3 and M10 per spec A2)
- Modify: `docs/spikes.md` (summary), `docs/superpowers/specs/2026-10-07-agent-illustrator-v1-design.md` (mark outcomes confirmed in repo), `docs/superpowers/plans/2026-10-07-v1-roadmap.md` (M0 status)

**Interfaces:**
- Consumes: the probe server from Task 5.
- Produces: the client compatibility record that the M3 plan relies on for image delivery (FR-11.2 fallback) and for `apply_ops` schema style.

- [ ] **Step 1: Register the probe server in Claude Desktop**

Edit `%APPDATA%\Claude\claude_desktop_config.json` (create it if missing) and add the `mcpServers` entry. Use the absolute path of this repo:
```json
{
  "mcpServers": {
    "agent-illustrator-spike": {
      "command": "node",
      "args": ["C:\\Users\\el3za\\Desktop\\work\\agent-illustrator\\spikes\\src\\mcp-probe-server.ts"]
    }
  }
}
```
Restart Claude Desktop. In a new chat, send:
`Call render_probe with color #2a9d8f, then tell me what shape and color you see in the image.`
Record:
- whether the tool appears
- whether the image shows in the UI (expanded or collapsed)
- whether the model describes a teal circle, which proves the model received the image

Then send:
`Call ops_loose_probe with ops [{"op":"op_3","id":"x","at":{"x":1,"y":2}}], then call ops_union_probe with the same ops.`
Record whether both tools are accepted or one errors. An HTTP 400 or a schema complaint means the union style breaks in this client.

- [ ] **Step 2: Register it in a second client (Claude Code)**

```bash
claude mcp add agent-illustrator-spike -- node C:/Users/el3za/Desktop/work/agent-illustrator/spikes/src/mcp-probe-server.ts
```
Run the same two prompts in a Claude Code session and record the same observations. If Cursor or VS Code Copilot is available, repeat there as a third data point.

- [ ] **Step 3: Write the client matrix (eval/clients.md) and the summary (docs/spikes.md)**

`eval/clients.md`:
```markdown
# MCP client compatibility (manual smoke checklist, spec A2)

Re-run on every milestone that changes the tool surface (M3, M9, M10). Probe prompts:
1. "Call render_probe with color #2a9d8f, then tell me what shape and color you see in the image."
2. "Call ops_loose_probe with ops [{"op":"op_3","id":"x","at":{"x":1,"y":2}}], then call ops_union_probe with the same ops."

## M0 probe server (date)
| Client (version) | Tools listed | Image visible in UI | Model saw image | ops_loose_probe | ops_union_probe | Notes |
|---|---|---|---|---|---|---|
| Claude Desktop | | | | | | |
| Claude Code | | | | | | |
```
Fill every cell from Steps 1–2. From M3 on, the real tools replace the probe prompts.

Append to `docs/spikes.md`:
```markdown
## R3: clients
See `eval/clients.md` (M0 probe server table).

## Summary
- S1 (loose `apply_ops` schema): (Confirmed | Differs)
- S2 (text bounds via resvg getBBox): (Confirmed | Differs)
- S6 (paper core without jsdom): (Confirmed | Differs)
- F1 (RTL isolate wrapping needed): (Confirmed | Fixed upstream)
- Image delivery: (works in … / needs the FR-11.2 disk fallback in …)
- Changes the M1–M3 plans must absorb: (list, or "none")
```
Fill every cell from Steps 1–2 and from the R1–R4 sections.

- [ ] **Step 4: Update the spec and roadmap**

- In the spec's "Outcomes recorded" section, add one line under S1, S2 and S6: `Confirmed in repo <date> on <OS list> (see docs/spikes.md)`, or describe the difference.
- In the roadmap, set M0 status to `Done` and M1 status to `Next`.

- [ ] **Step 5: Run the M0 acceptance check**

Run: `pnpm check && pnpm build && pnpm smoke`
Expected: all green locally. Push, then confirm all three CI matrix jobs are green.

M0 acceptance (PROJECT_INIT §5) is met when:
- the spikes are documented in `docs/spikes.md`
- CI is green
- the import-boundary lint is enforced (the guardrail test passes)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: record M0 spike results and client matrix; mark M0 done"
git push
```
