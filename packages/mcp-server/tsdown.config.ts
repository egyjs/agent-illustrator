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
