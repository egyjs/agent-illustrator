import { fileURLToPath } from 'node:url';

const at = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

/** Directories and files the eval scripts share. All are absolute paths. */
export const PATHS = {
  root: at('../../'),
  /** Render-regression op scripts (`*.json`) and their committed baseline PNGs (`baselines/*.png`). */
  fixtures: at('../fixtures/'),
  baselines: at('../fixtures/baselines/'),
  /** Agent-quality briefs. */
  briefs: at('../briefs/'),
  /** Run output: transcripts, renders and exported SVGs (git-ignored). */
  runs: at('../runs/'),
  /** The built MCP server; `pnpm build` makes it. */
  serverCli: at('../../packages/mcp-server/dist/cli.mjs'),
  fonts: [at('../../packages/engine/assets/fonts/Tajawal-Regular.ttf'), at('../../packages/engine/assets/fonts/Tajawal-Bold.ttf')],
} as const;

/** The bundled fonts in the shape the engine's `rasterize` and `executeBatch` take. */
export const FONTS = { files: [...PATHS.fonts], defaultFamily: 'Tajawal' } as const;
