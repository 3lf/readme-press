import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { resolveContainedOutput } from './paths.mjs';

function portableRelative(root, path) {
  return relative(root, path).split(sep).join('/');
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

export function createStagingDirectory(outputDirectory) {
  const output = resolve(outputDirectory);
  mkdirSync(dirname(output), { recursive: true });
  return mkdtempSync(join(dirname(output), '.readme-press-stage-'));
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
    if (typeof file !== 'string') {
      diagnostics.push({
        code: 'INVALID_GENERATED_FILE_OWNERSHIP',
        severity: 'warning',
        detail: JSON.stringify(file),
      });
      continue;
    }
    try {
      resolveContainedOutput(outputDirectory, file, { label: 'Previous generated file' });
      files.push(file);
    } catch {
      diagnostics.push({
        code: 'INVALID_GENERATED_FILE_OWNERSHIP',
        severity: 'warning',
        detail: String(file),
      });
    }
  }
  return { files: [...new Set(files)], diagnostics };
}

function atomicCopy(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.readme-press-${process.pid}-${randomUUID()}`;
  copyFileSync(source, temporary);
  renameSync(temporary, target);
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

/**
 * Publishes artifacts through per-file atomic replacement, then publishes the
 * manifest last. Until the manifest swap completes, readers can observe new
 * artifacts alongside the previous manifest. Files not owned by the previous
 * manifest are never removed.
 */
export function publishStagedBuild({ stagingDirectory, outputDirectory, previousFiles }) {
  const output = resolve(outputDirectory);
  const files = listArtifactFiles(stagingDirectory);
  if (!files.includes('manifest.json')) throw new Error('Staged build has no manifest.json.');
  const nonManifest = files.filter((file) => file !== 'manifest.json');
  mkdirSync(output, { recursive: true });
  for (const file of nonManifest) {
    atomicCopy(resolve(stagingDirectory, file), resolveContainedOutput(output, file));
  }
  atomicCopy(resolve(stagingDirectory, 'manifest.json'), resolve(output, 'manifest.json'));

  const current = new Set(files);
  for (const file of previousFiles) {
    if (current.has(file) || file === 'manifest.json') continue;
    const target = resolveContainedOutput(output, file, { label: 'Stale generated file' });
    if (!existsSync(target)) continue;
    const info = lstatSync(target);
    if (!info.isFile() && !info.isSymbolicLink()) continue;
    rmSync(target, { force: true });
    pruneEmptyParents(target, output);
  }
  return files;
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
