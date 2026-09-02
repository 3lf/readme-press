import { resolveContainedOutput } from './paths.mjs';

export function resolveManifestPdfPath(outputDirectory, output, { quality = 'output' } = {}) {
  if (!output || typeof output.pdf !== 'string') {
    throw new Error(`Manifest ${quality} PDF must be a relative .pdf path.`);
  }
  return resolveContainedOutput(outputDirectory, output.pdf, {
    extension: '.pdf',
    label: `Manifest ${quality} PDF`,
  });
}
