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
  trace: ['scene', 'ops', 'analysis', 'render'],
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
