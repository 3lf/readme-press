import {
  ReadmePressError,
  normalizeReleaseVersion,
  runBuild,
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

void consume;
