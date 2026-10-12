#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRegistry, ENGINE_VERSION, traceAvailable } from '@agent-illustrator/engine';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import pkg from '../package.json' with { type: 'json' };
import { loadAgentKit } from './agent-kit.ts';
import { agentKitDir, fontFiles, REQUIRED_AGENT_KIT_FILES } from './assets.ts';
import { loadConfig } from './config.ts';
import { imageSource } from './images.ts';
import { createLogger } from './logging.ts';
import { createServer } from './server.ts';
import { MemorySessionStore } from './sessions.ts';

const arg = process.argv[2];

if (arg === '--version') {
  process.stdout.write(`${pkg.version}\n`);
} else if (arg === '--doctor') {
  const dir = agentKitDir();
  const missing = REQUIRED_AGENT_KIT_FILES.map((rel) => join(dir, rel)).filter((file) => !existsSync(file));
  if (missing.length > 0) {
    process.stderr.write(`agent-kit content missing: ${missing.join(', ')}\n`);
    process.exit(1);
  }
  const kit = loadAgentKit(dir);
  const fonts = fontFiles();
  process.stderr.write(`agent-illustrator ${pkg.version} (engine ${ENGINE_VERSION})\n`);
  for (const file of kit.files) process.stderr.write(`agent-kit: ${join(dir, file)}\n`);
  for (const file of fonts.files) process.stderr.write(`font: ${file}\n`);
  const tracer = traceAvailable();
  process.stderr.write(`tracer: ${tracer === true ? 'ok' : tracer}\n`);
  if (tracer !== true) process.exitCode = 1; // not process.exit: the line above must reach a piped stderr
} else if (arg === undefined || arg === '--stdio') {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const kit = loadAgentKit();
  const sessions = new MemorySessionStore(config.maxDocuments, (id) => log.warn({ doc_id: id, limit: config.maxDocuments }, 'closed the least recently used document'));
  const deps = { sessions, registry: createRegistry(), config, fonts: fontFiles(), images: imageSource(), log };
  log.info({ version: pkg.version, limits: config.limits }, 'serving MCP over stdio');
  await serveStdio(() => createServer(deps, kit));
} else {
  process.stderr.write('Usage: agent-illustrator [--stdio | --version | --doctor]\n');
  process.exit(2);
}
