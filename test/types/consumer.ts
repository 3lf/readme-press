import {
  ReadmePressError,
  normalizeReleaseVersion,
  runBuild,
  runQa,
  transformReadme,
  validateConfig,
  type BuildManifest,
} from 'readme-press';
import { defineConfig, type ReadmePressConfig } from 'readme-press/config';

const config = defineConfig({
  source: 'README.md',
  metadata: {
    title: 'Typed book',
    author: 'Author',
    edition: 'First edition',
  },
  repository: { url: 'https://github.com/example/typed-book' },
  structure: {
    introHeading: 'Introduction',
    githubTocHeading: 'Contents',
    parts: [{ title: 'Part one', startHeading: 'Chapter one' }],
  },
  security: {
    rawHtml: 'safe',
    network: { mode: 'allowlist', allowHosts: ['assets.example'] },
    diagnostics: 'warn',
  },
  qa: { projectSpecificGate: true },
  release: { providerSpecificCopy: 'value' },
}) satisfies ReadmePressConfig;

const checked = validateConfig(config);
const version: string = normalizeReleaseVersion('v1.0.0');
const error = new ReadmePressError('Example', { code: 'ERR_EXAMPLE', details: checked });

async function consume(): Promise<BuildManifest> {
  if (!error.code || !version) throw error;
  return runBuild({ configFile: 'readme-press.config.mjs', quality: 'all' });
}

async function consumeQa(): Promise<BuildManifest> {
  const result = await runQa({ configFile: 'readme-press.config.mjs', quality: 'normal' });
  const failures: 0 = result.failures;
  if (failures !== 0) throw new Error('unreachable');
  return result.manifest;
}

async function consumeTransform(): Promise<void> {
  await transformReadme('# Introduction\n\n# Contents\n\n# Chapter', {
    repository: { url: 'https://github.com/example/typed-book' },
    structure: config.structure,
    toc: {},
    images: { normalJpegQuality: 82, tallRatio: 1.4, classRules: [] },
    contentRules: {
      calloutClassRules: [],
      paragraphClassRules: [],
      chapterClassRules: [],
      treeAriaLabel: 'Document hierarchy',
    },
    mermaid: {},
    projectRoot: '.',
  });
}

// @ts-expect-error output quality names are closed
void runBuild({ quality: 'ultra' });

void consume;
void consumeQa;
void consumeTransform;
