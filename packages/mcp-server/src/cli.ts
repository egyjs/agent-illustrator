#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRegistry, ENGINE_VERSION } from '@agent-illustrator/engine';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import pkg from '../package.json' with { type: 'json' };
import { agentKitDir, fontFiles, REQUIRED_AGENT_KIT_FILES } from './assets.ts';
import { loadConfig } from './config.ts';
import { createLogger } from './logging.ts';
import { createServer } from './server.ts';
import { MemorySessionStore } from './sessions.ts';

const arg = process.argv[2];

if (arg === '--version') {
  process.stdout.write(`${pkg.version}\n`);
} else if (arg === '--doctor') {
  const dir = agentKitDir();
  const files = REQUIRED_AGENT_KIT_FILES.map((rel) => join(dir, rel));
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    process.stderr.write(`agent-kit content missing: ${missing.join(', ')}\n`);
    process.exit(1);
  }
  const fonts = fontFiles();
  process.stderr.write(`agent-illustrator ${pkg.version} (engine ${ENGINE_VERSION})\n`);
  for (const file of files) process.stderr.write(`agent-kit: ${file}\n`);
  for (const file of fonts.files) process.stderr.write(`font: ${file}\n`);
} else if (arg === undefined || arg === '--stdio') {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const instructions = readFileSync(join(agentKitDir(), 'core-contract.md'), 'utf8');
  const deps = { sessions: new MemorySessionStore(config.maxDocuments), registry: createRegistry(), config, fonts: fontFiles(), log };
  log.info({ version: pkg.version, limits: config.limits }, 'serving MCP over stdio');
  await serveStdio(() => createServer(deps, instructions));
} else {
  process.stderr.write('Usage: agent-illustrator [--stdio | --version | --doctor]\n');
  process.exit(2);
}
