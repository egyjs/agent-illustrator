import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Tool } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { PATHS } from './paths.ts';

export type Connection = {
  client: Client;
  /** The server's core contract, which a real client hands the model as its system prompt. */
  instructions: string;
  tools: Tool[];
  close: () => Promise<void>;
};

export function assertServerBuilt(): void {
  if (!existsSync(PATHS.serverCli)) throw new Error(`the MCP server is not built (${PATHS.serverCli} is missing): run \`pnpm build\` first`);
}

/** The environment of the server process: the SDK's safe defaults, quiet logs, and the folders for render files (default a fresh temp dir) and saved documents (default the server's own). */
export function serverEnv(options: { renderDir?: string; docsDir?: string } = {}): Record<string, string> {
  return {
    ...getDefaultEnvironment(),
    AGENT_ILLUSTRATOR_LOG_LEVEL: 'warn',
    AGENT_ILLUSTRATOR_RENDER_DIR: options.renderDir ?? mkdtempSync(join(tmpdir(), 'ai-eval-')),
    ...(options.docsDir === undefined ? {} : { AGENT_ILLUSTRATOR_DOCS_DIR: options.docsDir }),
  };
}

/** Starts the built server over stdio, as an MCP client would. `renderDir` receives the render fallback PNGs; default a fresh temp dir. */
export async function connectServer(options: { renderDir?: string } = {}): Promise<Connection> {
  assertServerBuilt();
  const client = new Client({ name: 'agent-illustrator-eval', version: '0.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [PATHS.serverCli], env: serverEnv(options) });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return { client, instructions: client.getInstructions() ?? '', tools, close: () => client.close() };
  } catch (e) {
    await client.close().catch(() => undefined);
    throw e;
  }
}
