import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LIMITS, MAX_RENDER_PIXELS } from '@agent-illustrator/engine';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('uses the engine defaults when no env vars are set', () => {
    expect(loadConfig({})).toEqual({
      limits: DEFAULT_LIMITS,
      maxDocuments: 50,
      maxRenderPixels: MAX_RENDER_PIXELS,
      renderDir: join(tmpdir(), 'agent-illustrator'),
      docsDir: join(homedir(), process.platform === 'win32' ? join('AppData', 'Local') : join('.local', 'state'), 'agent-illustrator', 'docs'),
      logLevel: 'info',
    });
  });

  it('keeps saved documents in a per-user folder, not the shared temp folder', () => {
    const win = 'C:/Users/me/AppData/Local';
    expect(loadConfig({ LOCALAPPDATA: win }, 'win32').docsDir).toBe(join(win, 'agent-illustrator', 'docs'));
    expect(loadConfig({}, 'win32').docsDir).toBe(join(homedir(), 'AppData', 'Local', 'agent-illustrator', 'docs'));
    expect(loadConfig({ XDG_STATE_HOME: '/var/state' }, 'linux').docsDir).toBe(join('/var/state', 'agent-illustrator', 'docs'));
    expect(loadConfig({}, 'darwin').docsDir).toBe(join(homedir(), '.local', 'state', 'agent-illustrator', 'docs'));
    expect(loadConfig({ AGENT_ILLUSTRATOR_DOCS_DIR: '/my/docs' }, 'linux').docsDir).toBe('/my/docs');
  });

  it('reads positive integer limits and paths from AGENT_ILLUSTRATOR_* variables', () => {
    const c = loadConfig({
      AGENT_ILLUSTRATOR_MAX_OPS: '50',
      AGENT_ILLUSTRATOR_MAX_NODES: '100',
      AGENT_ILLUSTRATOR_MAX_SEGMENTS: '500',
      AGENT_ILLUSTRATOR_MAX_GENERATED: '40',
      AGENT_ILLUSTRATOR_MAX_DOCUMENTS: '3',
      AGENT_ILLUSTRATOR_MAX_RENDER_PIXELS: '1000000',
      AGENT_ILLUSTRATOR_RENDER_DIR: '/tmp/x',
      AGENT_ILLUSTRATOR_LOG_LEVEL: 'warn',
    });
    expect(c.limits).toEqual({ maxOpsPerBatch: 50, maxNodes: 100, maxSegmentsPerPath: 500, maxGenerated: 40 });
    expect([c.maxDocuments, c.maxRenderPixels, c.renderDir, c.logLevel]).toEqual([3, 1_000_000, '/tmp/x', 'warn']);
  });

  it('fails loudly on a malformed value', () => {
    expect(() => loadConfig({ AGENT_ILLUSTRATOR_MAX_NODES: 'lots' })).toThrow('AGENT_ILLUSTRATOR_MAX_NODES');
    expect(() => loadConfig({ AGENT_ILLUSTRATOR_MAX_OPS: '0' })).toThrow('AGENT_ILLUSTRATOR_MAX_OPS');
    expect(() => loadConfig({ AGENT_ILLUSTRATOR_LOG_LEVEL: 'loud' })).toThrow('AGENT_ILLUSTRATOR_LOG_LEVEL');
  });
});
