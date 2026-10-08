import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LIMITS, MAX_RENDER_PIXELS, type Limits } from '@agent-illustrator/engine';

export type ServerConfig = {
  readonly limits: Limits;
  readonly maxDocuments: number;
  readonly maxRenderPixels: number;
  /** Where render PNGs are also written, for clients that drop image blocks (FR-11.2). */
  readonly renderDir: string;
  readonly logLevel: string;
};

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** Limits and paths from AGENT_ILLUSTRATOR_* variables; malformed values stop the server at startup (NFR-1). */
export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
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
    },
    maxDocuments: int('MAX_DOCUMENTS', 50),
    maxRenderPixels: int('MAX_RENDER_PIXELS', MAX_RENDER_PIXELS),
    renderDir: env.AGENT_ILLUSTRATOR_RENDER_DIR || join(tmpdir(), 'agent-illustrator'),
    logLevel,
  };
}
