import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ReadmePressError, toReadmePressError } from './errors.mjs';

const COMMON_OPTIONS = {
  debug: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

export function usage() {
  return `README Press

Usage:
  readme-press build --config readme-press.config.mjs --quality normal|high|print|all [--release-version v1.0.0]
  readme-press qa --config readme-press.config.mjs --quality normal|high|print|all [--release-version v1.0.0] [--render-all]
  readme-press pipeline --config readme-press.config.mjs --release-version v1.0.0 [--commit SHA] [--render-all]
  readme-press release validate v1.0.0
  readme-press release prepare --config readme-press.config.mjs --version v1.0.0 [--commit SHA]
  readme-press release verify-render --manifest path --directory normal --directory high
  readme-press version | --version | -v`;
}

function usageError(message, cause) {
  return new ReadmePressError(message, {
    code: 'ERR_CLI_USAGE',
    cause,
    exitCode: 2,
  });
}

function parseOptions(args, options, { multiple = [], allowPositionals = false } = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { ...options, ...COMMON_OPTIONS },
      strict: true,
      allowPositionals,
      tokens: true,
    });
  } catch (cause) {
    throw usageError(cause.message, cause);
  }
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option' || multiple.includes(token.name)) continue;
    if (seen.has(token.name)) throw usageError(`Option --${token.name} cannot be repeated.`);
    seen.add(token.name);
  }
  return parsed;
}

function requiredOption(values, name) {
  const value = values[name];
  if (value === undefined || value === '') throw usageError(`Missing required option --${name}.`);
  return value;
}

/** Parse and validate README Press CLI arguments without performing work. */
export function parseCliArgs(args) {
  if (!args.length || (args.length === 1 && ['help', '--help', '-h'].includes(args[0]))) {
    return { command: 'help', debug: false };
  }
  if (args.length === 1 && ['version', '--version', '-v'].includes(args[0])) {
    return { command: 'version', debug: false };
  }

  const [command, ...rest] = args;
  if (command === 'build') {
    const { values } = parseOptions(rest, {
      config: { type: 'string' },
      quality: { type: 'string' },
      'release-version': { type: 'string' },
    });
    if (values.help) return { command: 'help', debug: Boolean(values.debug) };
    return {
      command,
      configFile: values.config,
      quality: values.quality ?? 'normal',
      releaseVersion: values['release-version'],
      debug: Boolean(values.debug),
    };
  }
  if (command === 'qa') {
    const { values } = parseOptions(rest, {
      config: { type: 'string' },
      quality: { type: 'string' },
      'release-version': { type: 'string' },
      'render-all': { type: 'boolean' },
    });
    if (values.help) return { command: 'help', debug: Boolean(values.debug) };
    return {
      command,
      configFile: values.config,
      quality: values.quality,
      releaseVersion: values['release-version'],
      renderAll: Boolean(values['render-all']),
      debug: Boolean(values.debug),
    };
  }
  if (command === 'pipeline') {
    const { values } = parseOptions(rest, {
      config: { type: 'string' },
      'release-version': { type: 'string' },
      commit: { type: 'string' },
      'render-all': { type: 'boolean' },
    });
    if (values.help) return { command: 'help', debug: Boolean(values.debug) };
    return {
      command,
      configFile: values.config,
      releaseVersion: requiredOption(values, 'release-version'),
      commit: values.commit,
      renderAll: Boolean(values['render-all']),
      debug: Boolean(values.debug),
    };
  }
  if (command === 'release') {
    const [subcommand, ...releaseArgs] = rest;
    if (subcommand === 'validate') {
      const { values, positionals } = parseOptions(releaseArgs, {}, { allowPositionals: true });
      if (values.help) return { command: 'help', debug: Boolean(values.debug) };
      if (positionals.length !== 1) throw usageError('release validate requires exactly one version.');
      return { command: 'release-validate', version: positionals[0], debug: Boolean(values.debug) };
    }
    if (subcommand === 'prepare') {
      const { values } = parseOptions(releaseArgs, {
        config: { type: 'string' },
        version: { type: 'string' },
        commit: { type: 'string' },
      });
      if (values.help) return { command: 'help', debug: Boolean(values.debug) };
      return {
        command: 'release-prepare',
        configFile: values.config,
        version: requiredOption(values, 'version'),
        commit: values.commit,
        debug: Boolean(values.debug),
      };
    }
    if (subcommand === 'verify-render') {
      const { values } = parseOptions(releaseArgs, {
        manifest: { type: 'string' },
        directory: { type: 'string', multiple: true },
      }, { multiple: ['directory'] });
      if (values.help) return { command: 'help', debug: Boolean(values.debug) };
      const directories = (values.directory ?? []).map((directory) => resolve(directory));
      if (!directories.length) throw usageError('At least one --directory is required.');
      return {
        command: 'release-verify-render',
        manifestPath: resolve(values.manifest ?? 'dist/manifest.json'),
        directories,
        debug: Boolean(values.debug),
      };
    }
    throw usageError(`Unknown release command: ${subcommand ?? '(missing)'}.`);
  }
  throw usageError(`Unknown command: ${command}.`);
}

/** Execute a parsed README Press CLI command. */
export async function runCli(args = process.argv.slice(2), output = console) {
  const parsed = parseCliArgs(args);
  if (parsed.command === 'help') {
    output.log(usage());
    return;
  }
  if (parsed.command === 'version') {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    output.log(packageJson.version);
    return;
  }
  if (parsed.command === 'build') {
    const { runBuild } = await import('./build.mjs');
    await runBuild(parsed);
    return;
  }
  if (parsed.command === 'qa') {
    const { runQa } = await import('./qa.mjs');
    await runQa(parsed);
    return;
  }
  if (parsed.command === 'pipeline') {
    const [{ runBuild }, { loadConfig }, { runQa }, release] = await Promise.all([
      import('./build.mjs'),
      import('./config.mjs'),
      import('./qa.mjs'),
      import('./release.mjs'),
    ]);
    const releaseVersion = release.normalizeReleaseVersion(parsed.releaseVersion);
    await runBuild({ configFile: parsed.configFile, quality: 'all', releaseVersion });
    await runQa({
      configFile: parsed.configFile,
      quality: 'all',
      releaseVersion,
      renderAll: parsed.renderAll,
    });
    const config = await loadConfig(parsed.configFile);
    const result = release.prepareRelease({
      version: releaseVersion,
      manifestPath: resolve(config.outputDir, 'manifest.json'),
      outputDir: config.outputDir,
      commit: parsed.commit,
      release: config.release,
    });
    output.log(`Prepared ${result.version} release candidate with ${result.normal.pageCount} pages per edition.`);
    return;
  }
  if (parsed.command === 'release-validate') {
    const { normalizeReleaseVersion } = await import('./release.mjs');
    output.log(normalizeReleaseVersion(parsed.version));
    return;
  }
  if (parsed.command === 'release-prepare') {
    const [{ loadConfig }, { prepareRelease }] = await Promise.all([
      import('./config.mjs'),
      import('./release.mjs'),
    ]);
    const config = await loadConfig(parsed.configFile);
    const result = prepareRelease({
      version: parsed.version,
      manifestPath: resolve(config.outputDir, 'manifest.json'),
      outputDir: config.outputDir,
      commit: parsed.commit,
      release: config.release,
    });
    output.log(`Prepared ${result.version} release metadata for ${result.normal.pageCount} pages per edition.`);
    return;
  }
  if (parsed.command === 'release-verify-render') {
    const { verifyRenderedPages } = await import('./release.mjs');
    const pages = verifyRenderedPages(parsed);
    output.log(`Verified ${pages} rendered pages in each directory.`);
  }
}

export function reportCliError(error, args = process.argv.slice(2), output = console) {
  const normalized = toReadmePressError(error);
  output.error(args.includes('--debug') ? (normalized.stack ?? normalized.message) : normalized.message);
  return normalized.exitCode;
}
