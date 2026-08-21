import { existsSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';

function isContained(root, target) {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function decodeLocalReference(reference, label) {
  const value = String(reference ?? '');
  if (!value || value.includes('\0')) throw new Error(`${label} must be a non-empty local path.`);
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error(`${label} contains invalid percent encoding: ${value}`);
  }
  if (decoded.includes('\\')) throw new Error(`${label} must use forward slashes: ${value}`);
  if (isAbsolute(decoded) || win32.isAbsolute(decoded)) {
    throw new Error(`${label} must be relative: ${value}`);
  }
  return decoded;
}

function nearestExistingDirectory(path) {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

export function resolveContainedSource({ baseDirectory, projectRoot, reference, label = 'Source path' }) {
  const decoded = decodeLocalReference(reference, label);
  const root = realpathSync(projectRoot);
  const base = realpathSync(baseDirectory);
  if (!isContained(root, base)) {
    throw new Error(`${label} base directory escapes the project root: ${baseDirectory}`);
  }
  const candidate = resolve(base, decoded);
  if (!isContained(root, candidate)) {
    throw new Error(`${label} escapes the project root: ${reference}`);
  }
  if (!existsSync(candidate)) return { path: candidate, exists: false, reference: decoded };
  const canonical = realpathSync(candidate);
  if (!isContained(root, canonical)) {
    throw new Error(`${label} escapes the project root: ${reference}`);
  }
  return { path: canonical, exists: true, reference: decoded };
}

export function resolveContainedOutput(outputDirectory, relativePath, {
  extension,
  label = 'Output path',
} = {}) {
  const decoded = decodeLocalReference(relativePath, label);
  if (extension && extname(decoded).toLowerCase() !== extension.toLowerCase()) {
    throw new Error(`${label} must end in ${extension}: ${relativePath}`);
  }
  const root = resolve(outputDirectory);
  const target = resolve(root, decoded);
  if (!isContained(root, target)) throw new Error(`${label} escapes the output directory: ${relativePath}`);

  if (existsSync(root)) {
    const canonicalRoot = realpathSync(root);
    if (existsSync(target)) {
      const canonicalTarget = realpathSync(target);
      if (!isContained(canonicalRoot, canonicalTarget)) {
        throw new Error(`${label} escapes the output directory through a symbolic link: ${relativePath}`);
      }
    }
    const existingParent = nearestExistingDirectory(dirname(target));
    const canonicalParent = realpathSync(existingParent);
    if (!isContained(canonicalRoot, canonicalParent)) {
      throw new Error(`${label} escapes the output directory through a symbolic link: ${relativePath}`);
    }
  }
  return target;
}

export function assertCanonicalContainment(root, candidate, label = 'Path') {
  const canonicalRoot = realpathSync(root);
  const canonicalCandidate = realpathSync(candidate);
  if (!isContained(canonicalRoot, canonicalCandidate)) {
    throw new Error(`${label} escapes its allowed root: ${candidate}`);
  }
  return canonicalCandidate;
}
