import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LIMITS, MAX_RENDER_PIXELS, type Limits } from '@agent-illustrator/engine';

export type ServerConfig = {
  readonly limits: Limits;
  readonly maxDocuments: number;
  readonly maxRenderPixels: number;
  /** Where render PNGs are also written, for clients that drop image blocks (FR-11.2). */
  readonly renderDir: string;
  /** The only directory `document_io` reads and writes; files are named by the model, never pathed (FR-12.2). Per user by default. */
  readonly docsDir: string;
  readonly logLevel: string;
};

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** A folder for the user alone: %LOCALAPPDATA% on Windows, else $XDG_STATE_HOME or ~/.local/state. The shared temp folder would let other users plant files. */
function defaultDocsDir(env: Record<string, string | undefined>, platform: NodeJS.Platform): string {
  const base = platform === 'win32' ? env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local') : env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(base, 'agent-illustrator', 'docs');
}

/** Limits and paths from AGENT_ILLUSTRATOR_* variables; malformed values stop the server at startup (NFR-1). */
export function loadConfig(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): ServerConfig {
  const int = (name: string, fallback: number): number => {
    const raw = env[`AGENT_ILLUSTRATOR_${name}`];
    if (raw === undefined || raw === '') return fallback;
    const v = Number(raw);
    if (!Number.isSafeInteger(v) || v <= 0) throw new Error(`AGENT_ILLUSTRATOR_${name} must be a positive integer, got "${raw}"`);
    return v;
  };
  const logLevel = env.AGENT_ILLUSTRATOR_LOG_LEVEL ?? 'info';
  if (!LEVELS.includes(logLevel)) throw new Error(`AGENT_ILLUSTRATOR_LOG_LEVEL must be one of ${LEVELS.join(', ')}, got "${logLevel}"`);
  return {
    limits: {
      maxOpsPerBatch: int('MAX_OPS', DEFAULT_LIMITS.maxOpsPerBatch),
      maxNodes: int('MAX_NODES', DEFAULT_LIMITS.maxNodes),
      maxSegmentsPerPath: int('MAX_SEGMENTS', DEFAULT_LIMITS.maxSegmentsPerPath),
      maxGenerated: int('MAX_GENERATED', DEFAULT_LIMITS.maxGenerated),
    },
    maxDocuments: int('MAX_DOCUMENTS', 50),
    maxRenderPixels: int('MAX_RENDER_PIXELS', MAX_RENDER_PIXELS),
    renderDir: env.AGENT_ILLUSTRATOR_RENDER_DIR || join(tmpdir(), 'agent-illustrator'),
    docsDir: env.AGENT_ILLUSTRATOR_DOCS_DIR || defaultDocsDir(env, platform),
    logLevel,
  };
}
