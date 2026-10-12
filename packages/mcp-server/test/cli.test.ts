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
    expect(r.stderr).toMatch(/guides[\\/]README\.md/); // nested content must survive the copy into dist
  });

  it('unknown arguments print usage to stderr and exit 2', () => {
    const r = run('--nope');
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Usage');
  });

  it('--doctor also finds the bundled fonts', () => {
    expect(run('--doctor').stderr).toContain('Tajawal-Regular.ttf');
  });

  it('--doctor reports that the tracer loads', () => {
    const r = run('--doctor');
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/^tracer: ok$/m);
  });
});
