import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporary = mkdtempSync(join(tmpdir(), 'readme-press-package-'));
const packageDirectory = join(temporary, 'package');
const consumer = join(temporary, 'empty-project');
const puppeteerCache = join(temporary, 'puppeteer-cache');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function run(command, args, cwd = consumer, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      PUPPETEER_CACHE_DIR: puppeteerCache,
    },
  });
}

function requireFile(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  mkdirSync(packageDirectory);
  mkdirSync(consumer);
  const packOutput = run(
    npm,
    ['pack', '--json', '--dry-run=false', '--pack-destination', packageDirectory],
    root,
    { capture: true },
  );
  const [packed] = JSON.parse(packOutput);
  const paths = packed.files.map(({ path }) => path);
  for (const required of [
    'LICENSE',
    'README.md',
    'README.fa.md',
    'bin/readme-press.mjs',
    'src/render.mjs',
    'themes/lapis-rtl/book.css',
    'npm-shrinkwrap.json',
  ]) {
    requireFile(paths.includes(required), `Published package is missing ${required}.`);
  }
  for (const forbidden of ['test/', '.github/', 'NPM_PUBLISHING.md']) {
    requireFile(!paths.some((path) => path.startsWith(forbidden)),
      `Published package unexpectedly contains ${forbidden}.`);
  }
  requireFile(packed.size < 5 * 1024 * 1024,
    `Published package is unexpectedly large: ${packed.size} bytes.`);

  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({
    name: 'readme-press-empty-project',
    version: '1.0.0',
    private: true,
    type: 'module',
  }, null, 2)}\n`);
  const tarball = join(packageDirectory, packed.filename);
  run(npm, ['install', '--dry-run=false', '--package-lock=true', tarball]);
  run(npm, ['audit', '--dry-run=false', '--package-lock=true', '--audit-level=low']);

  const cli = join(consumer, 'node_modules/readme-press/bin/readme-press.mjs');
  const installedVersion = run(process.execPath, [cli, 'version'], consumer, { capture: true }).trim();
  requireFile(installedVersion === packageJson.version,
    `Installed CLI reports ${installedVersion}; expected ${packageJson.version}.`);

  writeFileSync(join(consumer, 'README.md'), `<div dir="ltr">

# Introduction 📚

This is a clean consumer project built from the packed README Press artifact.

# Contents

- [Introduction](#introduction-)
- [First chapter](#first-chapter-)

# First chapter 🧪

## Verify the installed package

The generated PDF must preserve searchable text, links, bookmarks, and exact page geometry.

</div>
`);
  writeFileSync(join(consumer, 'readme-press.config.mjs'), `import { defineConfig } from 'readme-press/config';

export default defineConfig({
  source: 'README.md',
  outputDir: 'dist',
  metadata: {
    title: 'Clean install',
    subtitle: 'Packed-package smoke test',
    author: 'README Press',
    edition: 'Test edition',
    language: 'en',
    direction: 'ltr',
    numerals: 'latin',
    license: 'MIT',
  },
  repository: {
    url: 'https://github.com/3lf/readme-press',
  },
  structure: {
    introHeading: 'Introduction',
    githubTocHeading: 'Contents',
    parts: [
      { title: 'Smoke test', startHeading: 'First chapter' },
    ],
  },
  outputs: {
    normal: 'clean-install.pdf',
    high: 'clean-install-high-quality.pdf',
  },
  qa: {
    minPages: 2,
    minimumDestinations: 2,
    minimumOutlines: 2,
    extractablePhrases: ['Clean install', 'Verify the installed package'],
    expectedLinks: ['https://github.com/3lf/readme-press'],
  },
});
`);

  const version = `v${packageJson.version}`;
  run(process.execPath, [
    cli,
    'build',
    '--config',
    'readme-press.config.mjs',
    '--quality',
    'all',
    '--release-version',
    version,
  ]);
  run(process.execPath, [
    cli,
    'qa',
    '--config',
    'readme-press.config.mjs',
    '--quality',
    'all',
    '--release-version',
    version,
    '--render-all',
  ]);
  requireFile(existsSync(join(consumer, 'dist/clean-install.pdf')),
    'Normal PDF was not created in the clean project.');
  requireFile(existsSync(join(consumer, 'dist/clean-install-high-quality.pdf')),
    'High-quality PDF was not created in the clean project.');

  console.log(`Package smoke test passed: ${packed.entryCount} files, ${packed.size} packed bytes.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
