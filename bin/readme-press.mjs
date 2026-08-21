#!/usr/bin/env node

import { reportCliError, runCli } from '../src/cli.mjs';

runCli().catch((error) => {
  process.exitCode = reportCliError(error);
});
