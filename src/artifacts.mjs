import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname as systemHostname } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { assertContainedOutputSink, resolveContainedOutput } from './paths.mjs';

const STAGE_VERSION = 'v1';
const DEFAULT_FOREIGN_STAGE_AGE_MS = 24 * 60 * 60 * 1000;
const TELEMETRY_PATH_LIMIT = 20;

function portableRelative(root, path) {
  return relative(root, path).split(sep).join('/');
}

function identityHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function boundedCleanup(paths) {
  return {
    count: paths.length,
    paths: paths.slice(0, TELEMETRY_PATH_LIMIT),
    truncated: paths.length > TELEMETRY_PATH_LIMIT,
  };
}

function canonicalOwnershipPath(outputDirectory, file, label = 'Generated file') {
  if (typeof file !== 'string' || !file || file.includes('\0')) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const output = resolve(outputDirectory);
  const target = resolveContainedOutput(output, file, { label });
  if (existsSync(target) && lstatSync(target).isDirectory()) {
    throw new Error(`${label} must identify a file: ${file}`);
  }
  if (existsSync(output) && existsSync(target)) {
    return portableRelative(realpathSync(output), realpathSync(target));
  }
  return portableRelative(output, target);
}

export function listArtifactFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(portableRelative(root, path));
    }
  };
  walk(root);
  return files.sort();
}

export function reapAbandonedStagingDirectories(outputDirectory, {
  now = Date.now(),
  host = systemHostname(),
  isProcessAlive = processIsAlive,
  foreignMinAgeMs = DEFAULT_FOREIGN_STAGE_AGE_MS,
} = {}) {
  const output = resolve(outputDirectory);
  const parent = dirname(output);
  if (!existsSync(parent)) return { reaped: 0, paths: [], truncated: false };
  const outputHash = identityHash(output);
  const localHostHash = identityHash(host);
  const prefix = `.readme-press-stage-${STAGE_VERSION}-${outputHash}-`;
  const pattern = new RegExp(`^${prefix}([a-f0-9]{16})-(\\d+)-(\\d+)-[A-Za-z0-9_-]+$`, 'u');
  const removed = [];
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.name.startsWith(prefix)) continue;
    const match = entry.name.match(pattern);
    if (!match) continue;
    const path = join(parent, entry.name);
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isDirectory()) continue;
    const ownerHostHash = match[1];
    const ownerPid = Number(match[2]);
    const createdAt = Number(match[3]);
    const sameHost = ownerHostHash === localHostHash;
    if (sameHost && isProcessAlive(ownerPid)) continue;
    if (!sameHost && now - createdAt < foreignMinAgeMs) continue;
    rmSync(path, { recursive: true, force: true });
    removed.push(entry.name);
  }
  const cleanup = boundedCleanup(removed.sort());
  return { reaped: cleanup.count, paths: cleanup.paths, truncated: cleanup.truncated };
}

export function createStagingDirectory(outputDirectory, {
  reap = true,
  owner = {},
} = {}) {
  const output = resolve(outputDirectory);
  mkdirSync(dirname(output), { recursive: true });
  if (reap) reapAbandonedStagingDirectories(output);
  const host = owner.host ?? systemHostname();
  const pid = owner.pid ?? process.pid;
  const timestamp = owner.timestamp ?? Date.now();
  const prefix = `.readme-press-stage-${STAGE_VERSION}-${identityHash(output)}-${identityHash(host)}-${pid}-${timestamp}-`;
  return mkdtempSync(join(dirname(output), prefix));
}

export function removeStagingDirectory(directory) {
  rmSync(directory, { recursive: true, force: true });
}

export function readGeneratedOwnership(outputDirectory) {
  const manifestPath = resolve(outputDirectory, 'manifest.json');
  if (!existsSync(manifestPath)) return { files: [], diagnostics: [] };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return {
      files: [],
      diagnostics: [{
        code: 'INVALID_PREVIOUS_MANIFEST',
        severity: 'warning',
        detail: 'The previous manifest could not be parsed; no existing files will be cleaned.',
      }],
    };
  }
  if (!Array.isArray(manifest.generatedFiles)) {
    return {
      files: [],
      diagnostics: [{
        code: 'LEGACY_MANIFEST_OWNERSHIP',
        severity: 'warning',
        detail: 'The previous manifest has no generatedFiles inventory; existing files will be preserved.',
      }],
    };
  }

  const files = [];
  const diagnostics = [];
  for (const file of manifest.generatedFiles) {
    try {
      files.push(canonicalOwnershipPath(outputDirectory, file, 'Previous generated file'));
    } catch {
      diagnostics.push({
        code: 'INVALID_GENERATED_FILE_OWNERSHIP',
        severity: 'warning',
        detail: typeof file === 'string' ? file : JSON.stringify(file),
      });
    }
  }
  return { files: [...new Set(files)].sort(), diagnostics };
}

function atomicCopy(source, output, target, label) {
  assertContainedOutputSink(output, target, { label });
  mkdirSync(dirname(target), { recursive: true });
  assertContainedOutputSink(output, target, { label });
  const temporary = `${target}.readme-press-${process.pid}-${randomUUID()}`;
  try {
    assertContainedOutputSink(output, temporary, { label: `${label} temporary file` });
    copyFileSync(source, temporary);
    assertContainedOutputSink(output, temporary, { label: `${label} temporary file` });
    assertContainedOutputSink(output, target, { label });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function pruneEmptyParents(path, root) {
  let directory = dirname(path);
  while (directory !== root && directory.startsWith(`${root}${sep}`)) {
    try {
      rmdirSync(directory);
    } catch {
      break;
    }
    directory = dirname(directory);
  }
}

export function addGeneratedOwnership(manifest, outputDirectory, files) {
  const owned = [...(manifest.generatedFiles ?? []), ...files]
    .map((file) => canonicalOwnershipPath(outputDirectory, file))
    .filter((file) => file !== 'manifest.json');
  return { ...manifest, generatedFiles: [...new Set([...owned, 'manifest.json'])].sort() };
}

export function publishStagedBuild({ stagingDirectory, outputDirectory, previousFiles }) {
  const output = resolve(outputDirectory);
  const files = listArtifactFiles(stagingDirectory);
  if (!files.includes('manifest.json')) throw new Error('Staged build has no manifest.json.');
  const nonManifest = files.filter((file) => file !== 'manifest.json');
  mkdirSync(output, { recursive: true });
  for (const file of nonManifest) {
    const target = resolveContainedOutput(output, file, { label: 'Generated artifact' });
    atomicCopy(resolve(stagingDirectory, file), output, target, 'Generated artifact');
  }

  const current = new Set(files.map((file) => canonicalOwnershipPath(output, file)));
  const removed = [];
  for (const file of previousFiles) {
    const canonical = canonicalOwnershipPath(output, file, 'Stale generated file');
    if (current.has(canonical) || canonical === 'manifest.json') continue;
    const target = resolveContainedOutput(output, canonical, { label: 'Stale generated file' });
    assertContainedOutputSink(output, target, { label: 'Stale generated file' });
    if (!existsSync(target)) continue;
    const info = lstatSync(target);
    if (!info.isFile() && !info.isSymbolicLink()) continue;
    assertContainedOutputSink(output, target, { label: 'Stale generated file' });
    rmSync(target, { force: true });
    removed.push(canonical);
    pruneEmptyParents(target, output);
  }

  const stagedManifestPath = resolve(stagingDirectory, 'manifest.json');
  const manifest = JSON.parse(readFileSync(stagedManifestPath, 'utf8'));
  const removedCleanup = boundedCleanup(removed.sort());
  manifest.publication = {
    ...(manifest.publication ?? {}),
    cleanup: {
      ...(manifest.publication?.cleanup ?? {}),
      removed: removedCleanup.count,
      removedPaths: removedCleanup.paths,
      removedPathsTruncated: removedCleanup.truncated,
    },
  };
  writeFileSync(stagedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const manifestTarget = resolveContainedOutput(output, 'manifest.json', { label: 'Build manifest' });
  atomicCopy(stagedManifestPath, output, manifestTarget, 'Build manifest');
  return { files, cleanup: manifest.publication.cleanup, manifest };
}

export function writeStagedManifest(stagingDirectory, manifest) {
  const generatedFiles = [...listArtifactFiles(stagingDirectory), 'manifest.json'].sort();
  const complete = { ...manifest, generatedFiles };
  writeFileSync(
    resolve(stagingDirectory, 'manifest.json'),
    `${JSON.stringify(complete, null, 2)}\n`,
    'utf8',
  );
  return complete;
}
