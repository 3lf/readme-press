import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import puppeteer from 'puppeteer';

function requireCommand(command, installHint) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', stdio: 'ignore' });
  if (result.error?.code === 'ENOENT') {
    throw new Error(`Required tool "${command}" was not found. ${installHint}`);
  }
}

async function requireChrome() {
  let executable;
  try {
    executable = await puppeteer.executablePath();
    accessSync(executable, constants.X_OK);
  } catch {
    throw new Error(
      `Chromium for Puppeteer was not found at ${executable}. Run "npx puppeteer browsers install chrome".`,
    );
  }
}

export async function preflightBuild(config) {
  requireCommand('qpdf', 'Install qpdf and make it available on PATH.');
  await requireChrome();
  try {
    accessSync(config.mermaid.mmdcPath, constants.X_OK);
  } catch {
    throw new Error(
      `Mermaid CLI was not found at ${config.mermaid.mmdcPath}. Run "npm install" in the README Press package.`,
    );
  }
}

export function preflightQa() {
  requireCommand('qpdf', 'Install qpdf and make it available on PATH.');
  for (const command of ['pdfimages', 'pdfinfo', 'pdffonts', 'pdftoppm', 'pdftotext']) {
    requireCommand(command, 'Install Poppler and make its command-line tools available on PATH.');
  }
  requireCommand('python3', 'Install Python 3 and make python3 available on PATH.');
}
