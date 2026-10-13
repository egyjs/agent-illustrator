import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Rendering, tracing and spawning the CLI take seconds when every project runs in parallel.
    testTimeout: 15_000,
    // Inline projects inherit the options above; each keeps its package name for --project.
    projects: [
      { root: 'packages/engine', test: { name: '@agent-illustrator/engine' } },
      { root: 'packages/mcp-server', test: { name: 'agent-illustrator' } },
      { root: 'spikes', test: { name: '@agent-illustrator/spikes' } },
      { root: 'eval', test: { name: '@agent-illustrator/eval' } },
    ],
  },
});
