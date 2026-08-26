import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer';
import { ReadmePressError } from './errors.mjs';

const require = createRequire(import.meta.url);

export function resolveMermaidCli() {
  let directory = dirname(require.resolve('@mermaid-js/mermaid-cli'));
  for (let depth = 0; depth < 5; depth += 1) {
    const packagePath = resolve(directory, 'package.json');
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (packageJson.name === '@mermaid-js/mermaid-cli') {
        const bin = typeof packageJson.bin === 'string'
          ? packageJson.bin
          : packageJson.bin?.mmdc ?? packageJson.bin?.['mermaid-cli'];
        if (!bin || typeof bin !== 'string') {
          throw new ReadmePressError('The installed Mermaid CLI package has no supported bin mapping.', {
            code: 'ERR_PREFLIGHT_MERMAID', details: { packagePath },
          });
        }
        return resolve(directory, bin);
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new ReadmePressError('Unable to locate the installed Mermaid CLI package metadata.', {
    code: 'ERR_PREFLIGHT_MERMAID',
  });
}

function requireCommand(command, installHint, versionArgs = ['--version'], errorCode = 'ERR_PREFLIGHT_TOOL') {
  const result = spawnSync(command, versionArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error) {
    const cause = result.error.code ?? result.error.message;
    throw new ReadmePressError(`Required tool "${command}" could not be executed: ${cause}. ${installHint}`, {
      code: errorCode,
      details: { tool: command, cause },
      cause: result.error,
    });
  }
  if (result.status !== 0 || result.signal) {
    throw new ReadmePressError(
      `Required tool "${command}" is present but unhealthy (exit=${result.status}, signal=${result.signal}). ${installHint}`,
      {
        code: errorCode,
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
    config.mermaid.mmdcPath ??= resolveMermaidCli();
    accessSync(config.mermaid.mmdcPath, constants.X_OK);
    requireCommand(
      config.mermaid.mmdcPath,
      'Reinstall @mermaid-js/mermaid-cli.',
      ['--version'],
      'ERR_PREFLIGHT_MERMAID',
    );
  } catch (cause) {
    if (cause instanceof ReadmePressError) throw cause;
    throw new ReadmePressError(
      `Mermaid CLI was not found at ${config.mermaid.mmdcPath}. Run "npm install" in the README Press package.`,
      { code: 'ERR_PREFLIGHT_MERMAID', details: { path: config.mermaid.mmdcPath }, cause },
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
