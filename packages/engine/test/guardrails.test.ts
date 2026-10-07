import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIds(relPath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, relPath) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
}

describe('PROJECT_INIT §4.2 guardrails', () => {
  // First lint loads the config and typescript-eslint parser; on a cold machine that exceeds the 5 s test timeout.
  beforeAll(async () => {
    await ruleIds('packages/engine/src/index.ts', 'export {};');
  }, 60_000);

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
