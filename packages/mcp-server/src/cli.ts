#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_VERSION } from '@agent-illustrator/engine';
import pkg from '../package.json' with { type: 'json' };
import { agentKitDir } from './assets.ts';

const arg = process.argv[2];

if (arg === '--version') {
  process.stdout.write(`${pkg.version}\n`);
} else if (arg === '--doctor') {
  const contract = join(agentKitDir(), 'core-contract.md');
  if (!existsSync(contract)) {
    process.stderr.write(`agent-kit content missing: ${contract}\n`);
    process.exit(1);
  }
  process.stderr.write(`agent-illustrator ${pkg.version} (engine ${ENGINE_VERSION})\nagent-kit: ${contract}\n`);
} else {
  process.stderr.write('Usage: agent-illustrator [--version | --doctor]\n');
  process.exit(2);
}
