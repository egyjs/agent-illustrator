#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION } from '@agent-illustrator/engine';
import pkg from '../package.json' with { type: 'json' };
import { agentKitDir, REQUIRED_AGENT_KIT_FILES } from './assets.ts';

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
  process.stderr.write(`agent-illustrator ${pkg.version} (engine ${ENGINE_VERSION})\n`);
  for (const file of files) process.stderr.write(`agent-kit: ${file}\n`);
} else {
  process.stderr.write('Usage: agent-illustrator [--version | --doctor]\n');
  process.exit(2);
}
