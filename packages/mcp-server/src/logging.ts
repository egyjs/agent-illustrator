import { pino, type Logger } from 'pino';

export type { Logger };

/** JSON-line logs on stderr; stdout belongs to the MCP stream (NFR-5). */
export function createLogger(level: string): Logger {
  return pino({ level, base: { service: 'agent-illustrator' } }, pino.destination({ dest: 2, sync: true }));
}
