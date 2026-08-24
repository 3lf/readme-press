import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import puppeteer from 'puppeteer';
import { ReadmePressError } from './errors.mjs';

function requireCommand(command, installHint, versionArgs = ['--version']) {
  const result = spawnSync(command, versionArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error) {
    const cause = result.error.code ?? result.error.message;
    throw new ReadmePressError(`Required tool "${command}" could not be executed: ${cause}. ${installHint}`, {
      code: 'ERR_PREFLIGHT_TOOL',
      details: { tool: command, cause },
      cause: result.error,
    });
  }
  if (result.status !== 0 || result.signal) {
    throw new ReadmePressError(
      `Required tool "${command}" is present but unhealthy (exit=${result.status}, signal=${result.signal}). ${installHint}`,
      {
        code: 'ERR_PREFLIGHT_TOOL',
        details: { tool: command, status: result.status, signal: result.signal },
      },
    );
  }
}

export async function requireChrome({
  executablePath = () => puppeteer.executablePath(),
  assertExecutable = (path) => accessSync(path, constants.X_OK),
} = {}) {
  let executable = '(unknown)';
  try {
    executable = await executablePath();
    assertExecutable(executable);
  } catch (error) {
    const cause = String(error?.message ?? error ?? '(unknown error)').slice(0, 200);
    throw new ReadmePressError(
      `Chromium for Puppeteer was not found at ${executable}: ${cause}. Run "npx puppeteer browsers install chrome".`,
      {
        code: 'ERR_PREFLIGHT_CHROME',
        details: { executable, cause },
        cause: error,
      },
    );
  }
}

export async function preflightBuild(config) {
  requireCommand('qpdf', 'Install qpdf and make it available on PATH.');
  await requireChrome();
  try {
    accessSync(config.mermaid.mmdcPath, constants.X_OK);
  } catch {
    throw new ReadmePressError(
      `Mermaid CLI was not found at ${config.mermaid.mmdcPath}. Run "npm install" in the README Press package.`,
      { code: 'ERR_PREFLIGHT_MERMAID', details: { path: config.mermaid.mmdcPath } },
    );
  }
}

export function preflightQa() {
  requireCommand('qpdf', 'Install qpdf and make it available on PATH.');
  for (const command of ['pdfimages', 'pdfinfo', 'pdffonts', 'pdftoppm', 'pdftotext']) {
    requireCommand(
      command,
      'Install Poppler and make its command-line tools available on PATH.',
      ['-v'],
    );
  }
  requireCommand('python3', 'Install Python 3 and make python3 available on PATH.');
}
