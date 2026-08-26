import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
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
  if (isAbsolute(decoded) || win32.isAbsolute(decoded)) {
    throw new Error(`${label} must be relative: ${value}`);
  }
  if (decoded.includes('\\')) throw new Error(`${label} must use forward slashes: ${value}`);
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

  assertContainedOutputSink(root, target, { label, reference: relativePath });
  return target;
}

export function assertContainedOutputSink(outputDirectory, targetPath, {
  label = 'Output path',
  reference = targetPath,
} = {}) {
  const root = resolve(outputDirectory);
  const target = resolve(targetPath);
  if (!isContained(root, target)) throw new Error(`${label} escapes the output directory: ${reference}`);

  if (existsSync(root)) {
    const canonicalRoot = realpathSync(root);
    const pathFromRoot = relative(root, target);
    let current = root;
    const components = pathFromRoot ? pathFromRoot.split(sep) : [];
    for (let index = 0; index < components.length; index += 1) {
      current = resolve(current, components[index]);
      let info;
      try {
        info = lstatSync(current);
      } catch (error) {
        if (error?.code === 'ENOENT') break;
        throw error;
      }
      if (info.isSymbolicLink()) {
        let canonical;
        try {
          canonical = realpathSync(current);
        } catch (error) {
          if (error?.code === 'ENOENT') {
            throw new Error(`${label} contains a dangling symbolic link: ${reference}`, { cause: error });
          }
          throw error;
        }
        if (!isContained(canonicalRoot, canonical)) {
          throw new Error(`${label} escapes the output directory through a symbolic link: ${reference}`);
        }
        if (index < components.length - 1 && !statSync(current).isDirectory()) {
          throw new Error(`${label} has a non-directory ancestor: ${reference}`);
        }
      } else if (index < components.length - 1 && !info.isDirectory()) {
        throw new Error(`${label} has a non-directory ancestor: ${reference}`);
      }
    }

    if (existsSync(target)) {
      const canonicalTarget = realpathSync(target);
      if (!isContained(canonicalRoot, canonicalTarget)) {
        throw new Error(`${label} escapes the output directory through a symbolic link: ${reference}`);
      }
    } else {
      const existingParent = nearestExistingDirectory(dirname(target));
      const canonicalParent = realpathSync(existingParent);
      if (!isContained(canonicalRoot, canonicalParent)) {
        throw new Error(`${label} escapes the output directory through a symbolic link: ${reference}`);
      }
    }
  }
  return target;
}
