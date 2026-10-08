import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  platform: 'node',
  fixedExtension: true,
  dts: false,
  clean: true,
  // Directory copies are recursive: dist/agent-kit/content/** and dist/fonts/**.
  copy: [
    { from: '../agent-kit/content', to: 'dist/agent-kit' },
    { from: '../engine/assets/fonts', to: 'dist' },
    { from: '../../LICENSE', to: 'dist' },
  ],
});
