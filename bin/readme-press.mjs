#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBuild } from '../src/build.mjs';
import { loadConfig } from '../src/config.mjs';
import { runQa } from '../src/qa.mjs';
import { normalizeReleaseVersion, prepareRelease, verifyRenderedPages } from '../src/release.mjs';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function options(name) {
  return process.argv
    .filter((value, index) => process.argv[index - 1] === `--${name}`)
    .map((value) => resolve(value));
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function usage() {
  return `README Press

Usage:
  readme-press build --config readme-press.config.mjs --quality normal|high|all [--release-version v1.0.0]
  readme-press qa --config readme-press.config.mjs --quality normal|high|all [--release-version v1.0.0] [--render-all]
  readme-press pipeline --config readme-press.config.mjs --release-version v1.0.0 --commit SHA [--render-all]
  readme-press release validate v1.0.0
  readme-press release prepare --config readme-press.config.mjs --version v1.0.0 [--commit SHA]
  readme-press release verify-render --manifest path --directory normal --directory high
  readme-press version`;
}

async function main() {
  const command = process.argv[2];
  if (command === 'build') {
    await runBuild({
      configFile: option('config'),
      quality: option('quality', 'normal'),
      releaseVersion: option('release-version'),
    });
    return;
  }
  if (command === 'qa') {
    await runQa({
      configFile: option('config'),
      quality: option('quality'),
      releaseVersion: option('release-version'),
      renderAll: hasFlag('render-all'),
    });
    return;
  }
  if (command === 'pipeline') {
    const configFile = option('config');
    const releaseVersion = normalizeReleaseVersion(option('release-version'));
    const commit = option('commit');
    await runBuild({ configFile, quality: 'all', releaseVersion });
    await runQa({
      configFile,
      quality: 'all',
      releaseVersion,
      renderAll: hasFlag('render-all'),
    });
    const config = await loadConfig(configFile);
    const result = prepareRelease({
      version: releaseVersion,
      manifestPath: resolve(config.outputDir, 'manifest.json'),
      outputDir: config.outputDir,
      commit,
      release: config.release,
    });
    console.log(`Prepared ${result.version} release candidate with ${result.normal.pageCount} pages per quality.`);
    return;
  }
  if (command === 'release') {
    const subcommand = process.argv[3];
    if (subcommand === 'validate') {
      console.log(normalizeReleaseVersion(process.argv[4]));
      return;
    }
    if (subcommand === 'prepare') {
      const config = await loadConfig(option('config'));
      const result = prepareRelease({
        version: option('version'),
        manifestPath: resolve(config.outputDir, 'manifest.json'),
        outputDir: config.outputDir,
        commit: option('commit'),
        release: config.release,
      });
      console.log(`Prepared ${result.version} release metadata for ${result.normal.pageCount} pages.`);
      return;
    }
    if (subcommand === 'verify-render') {
      const directories = options('directory');
      if (!directories.length) throw new Error('At least one --directory is required.');
      const pages = verifyRenderedPages({
        manifestPath: resolve(option('manifest', 'dist/manifest.json')),
        directories,
      });
      console.log(`Verified ${pages} rendered pages in each directory.`);
      return;
    }
  }
  if (command === 'version') {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(packageJson.version);
    return;
  }
  console.log(usage());
  if (command && !['help', '--help', '-h'].includes(command)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
