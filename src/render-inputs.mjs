import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import puppeteer from 'puppeteer';
import { resolveMermaidCli } from './preflight.mjs';

export const RENDER_INPUT_VERSION = 1;
const require = createRequire(import.meta.url);
const PACKAGES = [
  '@mermaid-js/mermaid-cli', '@twemoji/svg', '@vivliostyle/viewer',
  'pdf-lib', 'puppeteer', 'qrcode', 'sharp', 'shiki', 'unified',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function installedPackageVersion(name) {
  try {
    const data = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'));
    if (data.name === name) return data.version;
  } catch { /* Package exports may hide package.json. */ }
  let directory = dirname(require.resolve(name));
  while (true) {
    const file = resolve(directory, 'package.json');
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data.name === name) return data.version;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot find installed ${name} version.`);
    directory = parent;
  }
}

function commandVersion(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function treeFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function renderConfig(config, releaseVersion) {
  return {
    metadata: config.metadata,
    repository: config.repository,
    labels: config.labels,
    page: config.page,
    structure: config.structure,
    toc: config.toc,
    outputs: config.outputs,
    footer: config.footer,
    cover: config.cover,
    images: config.images,
    mermaid: {
      configPath: config.mermaid.configPath,
      fontPath: config.mermaid.fontPath,
      fontFamily: config.mermaid.fontFamily,
      puppeteerConfig: config.mermaid.puppeteerConfig,
    },
    contentRules: config.contentRules,
    security: config.security,
    theme: config.theme,
    releaseVersion,
  };
}

function assertContentFile(path, root) {
  const rel = relative(realpathSync(root), realpathSync(path));
  if (!isAbsolute(path) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Render input is outside the configured content root: ${path}`);
  }
}

export function fingerprintDigest(inputs) {
  return sha256(JSON.stringify(stable({
    version: inputs.version,
    configSha256: inputs.configSha256,
    renderer: inputs.renderer,
    files: inputs.files,
  })));
}

export function assertStoredRenderInputsCurrent(inputs) {
  if (inputs?.version !== RENDER_INPUT_VERSION || !Array.isArray(inputs.files)
    || !inputs.configSha256 || !inputs.renderer || !inputs.sha256) {
    throw new Error('Missing or unsupported render-input fingerprint. Rebuild the PDFs.');
  }
  const files = inputs.files.map(({ path, sha256: expected }) => {
    if (typeof path !== 'string' || typeof expected !== 'string') {
      throw new Error('Invalid render-input file inventory. Rebuild the PDFs.');
    }
    try {
      return { path, sha256: sha256(readFileSync(path)) };
    } catch {
      throw new Error(`stale build: render input disappeared: ${path}. Rebuild the PDFs.`);
    }
  });
  if (fingerprintDigest({ ...inputs, files }) !== inputs.sha256) {
    throw new Error('stale build: render inputs changed. Rebuild the PDFs before QA or release preparation.');
  }
}

function gitStatusExcludingGenerated(repositoryRoot, generatedDirectories) {
  const exclusions = generatedDirectories.flatMap((directory) => {
    if (!directory) return [];
    const rel = relative(repositoryRoot, existsSync(directory) ? realpathSync(directory) : resolve(directory));
    return rel && rel !== '..' && !rel.startsWith(`..${sep}`)
      ? [`:(exclude)${rel}`]
      : [];
  });
  const status = (args) => {
    try {
      return execFileSync('git', ['-C', repositoryRoot, 'status', '--porcelain', ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
      }).trim();
    } catch (error) {
      const detail = error.code === 'ENOBUFS' ? 'too many changed paths' : error.message;
      throw new Error(`Could not verify release Git status: ${detail}.`, { cause: error });
    }
  };
  const tracked = status(['--untracked-files=no', '--', '.', ...exclusions]);
  if (tracked) return tracked;
  return status([
    '--untracked-files=normal', '--', '.', ...exclusions,
    ':(exclude,glob)**/node_modules/**',
  ]);
}

export function assertReleaseInputProvenance(manifest, packageRoot, outputDir) {
  const inputs = manifest.renderInputs;
  assertStoredRenderInputsCurrent(inputs);
  if (!inputs.files.some(({ path }) => path === manifest.source)) {
    throw new Error('Release render-input fingerprint does not include the source file. Rebuild.');
  }
  const sourceDirectory = dirname(realpathSync(manifest.source));
  let repositoryRoot;
  let head;
  try {
    repositoryRoot = realpathSync(commandVersion('git', ['-C', sourceDirectory, 'rev-parse', '--show-toplevel']));
    head = commandVersion('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD']);
  } catch {
    throw new Error('Release preparation requires the source in a clean Git checkout.');
  }
  if (head.toLowerCase() !== manifest.sourceCommit?.toLowerCase()) {
    throw new Error('Release source commit does not match the current Git HEAD. Rebuild from this commit.');
  }
  const status = gitStatusExcludingGenerated(repositoryRoot, [outputDir, inputs.cacheDir]);
  if (status) throw new Error('Release preparation requires a clean source Git checkout. Commit relevant inputs and rebuild.');

  const packageInputs = inputs.files.some(({ path }) => {
    const rel = relative(packageRoot, path);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !path.includes(`${sep}node_modules${sep}`);
  });
  if (packageInputs && !packageRoot.includes(`${sep}node_modules${sep}`)) {
    let packageRepository = null;
    try {
      packageRepository = realpathSync(commandVersion('git', [
        '-C', packageRoot, 'rev-parse', '--show-toplevel',
      ]));
    } catch {
      // Published npm packages have no Git checkout of their own.
    }
    if (packageRepository && packageRepository !== repositoryRoot
      && gitStatusExcludingGenerated(packageRepository, [outputDir, inputs.cacheDir])) {
      throw new Error('Release preparation requires a clean README Press package checkout.');
    }
  }

  for (const { path } of inputs.files) {
    if (path.includes(`${sep}node_modules${sep}`)) continue;
    const canonicalPath = realpathSync(path);
    const insideSource = relative(repositoryRoot, canonicalPath);
    if (insideSource !== '..' && !insideSource.startsWith(`..${sep}`)) continue;
    const insidePackage = relative(realpathSync(packageRoot), canonicalPath);
    if (insidePackage !== '..' && !insidePackage.startsWith(`..${sep}`)) continue;
    throw new Error(`Release input is outside the source checkout and installed package: ${path}`);
  }
}

export function addCoverRenderInputs(inputs, dependencies) {
  const files = new Map(inputs.files.map((file) => [file.path, file.sha256]));
  for (const { path, sha256: hash } of dependencies) {
    if (files.has(path) && files.get(path) !== hash) {
      throw new Error(`Render inputs changed during build: ${path}. Retry from a stable source tree.`);
    }
    files.set(path, hash);
  }
  const extended = {
    ...inputs,
    files: [...files.keys()].sort().map((path) => ({ path, sha256: files.get(path) })),
    assets: {
      ...inputs.assets,
      cover: [...new Set([...(inputs.assets.cover ?? []), ...dependencies.map(({ path }) => path)])].sort(),
    },
  };
  return { ...extended, sha256: fingerprintDigest(extended) };
}

export async function createRenderInputs(config, { images = [], emoji = [], cover = [], mermaid = false, releaseVersion = null } = {}) {
  const imagePaths = [...new Set(images.map((path) => resolve(path)))].sort();
  for (const path of imagePaths) assertContentFile(path, config.contentRoot);
  const twemojiRoot = dirname(require.resolve('@twemoji/svg/package.json'));
  const emojiPaths = emoji.map((file) => {
    const path = resolve(twemojiRoot, file);
    assertContentFile(path, twemojiRoot);
    return path;
  });
  const mmdcPath = config.mermaid.mmdcPath ?? resolveMermaidCli();
  const files = [
    config.sourcePath,
    config.theme.stylesheet,
    ...(config.cover.enabled ? [config.cover.file] : []),
    ...(mermaid ? [config.mermaid.configPath, config.mermaid.fontPath] : []),
    ...(mermaid && process.env.CI && config.mermaid.puppeteerConfig ? [config.mermaid.puppeteerConfig] : []),
    mmdcPath,
    ...treeFiles(config.themeRoot).filter((path) => /\.(?:css|html|json|woff2?|ttf|otf|svg|png|jpe?g|webp)$/iu.test(path)),
    ...treeFiles(resolve(config.packageRoot, 'src')).filter((path) => path.endsWith('.mjs')),
    ...emojiPaths,
    ...imagePaths,
    ...cover,
  ];
  const unique = [...new Set(files.map((path) => resolve(path)))].sort();
  const renderer = {
    readmePress: JSON.parse(readFileSync(resolve(config.packageRoot, 'package.json'), 'utf8')).version,
    node: process.versions.node,
    chrome: commandVersion(await puppeteer.executablePath(), ['--version']),
    qpdf: commandVersion('qpdf', ['--version']),
    packages: Object.fromEntries(PACKAGES.map((name) => [name, installedPackageVersion(name)])),
    ciMermaidConfig: Boolean(mermaid && process.env.CI && config.mermaid.puppeteerConfig),
  };
  const inputs = {
    version: RENDER_INPUT_VERSION,
    configSha256: sha256(JSON.stringify(stable(renderConfig(config, releaseVersion)))),
    renderer,
    files: unique.map((path) => ({ path, sha256: sha256(readFileSync(path)) })),
    assets: { images: imagePaths, emoji: [...new Set(emoji)].sort(), cover: [...new Set(cover)].sort() },
    cacheDir: config.mermaid.cacheDir,
  };
  return { ...inputs, sha256: fingerprintDigest(inputs) };
}
