import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  platform: 'node',
  fixedExtension: true,
  dts: false,
  clean: true,
  // Directory (not glob) copy is recursive: dist/agent-kit/content/** mirrors packages/agent-kit/content/**.
  copy: [{ from: '../agent-kit/content', to: 'dist/agent-kit' }],
});
