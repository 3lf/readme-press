import type {
  BuildManifest,
  BuildOptions,
  Diagnostic,
  LoadedConfig,
  QaOptions,
  ReadmePressConfig,
  ReleaseResult,
  TransformResult,
} from './types.d.ts';

export type * from './types.d.ts';

export declare class ReadmePressError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly exitCode: number;
  constructor(message: string, options?: {
    code?: string;
    details?: unknown;
    cause?: unknown;
    exitCode?: number;
  });
}

/** Preserve config inference while authoring a trusted JavaScript or TypeScript config. */
export declare function defineConfig<T extends ReadmePressConfig>(config: T): T;
/** Validate config types and report or reject unknown core keys. */
export declare function validateConfig(
  value: unknown,
  options?: { strict?: boolean },
): { config: ReadmePressConfig; diagnostics: Diagnostic[] };
/** Execute, validate, normalize, and resolve a README Press config file. */
export declare function loadConfig(configFile?: string, cwd?: string): Promise<LoadedConfig>;
/** Build and publish one or all PDF editions through manifest-last, per-file replacement. */
export declare function runBuild(options?: BuildOptions): Promise<BuildManifest>;
/** Verify the manifest, PDF containers, content, rendering, and project-specific gates. */
export declare function runQa(options?: QaOptions): Promise<{ failures: 0; manifest: BuildManifest }>;
/** Validate and normalize a v-prefixed semantic release version. */
export declare function normalizeReleaseVersion(value: string): string;
/** Verify release artifacts and atomically write checksums and Markdown-safe notes. */
export declare function prepareRelease(options: {
  version: string;
  manifestPath: string;
  outputDir: string;
  commit?: string;
  release?: Record<string, unknown>;
}): ReleaseResult;
/** Confirm rendered page inventories against a build manifest. */
export declare function verifyRenderedPages(options: {
  manifestPath: string;
  directories: string[];
}): number;
export declare class GithubSlugger {
  /** Return a GitHub-compatible, document-unique heading slug. */
  slug(text: string): string;
}
/** Normalize a legacy anchor for loose matching. */
export declare function looseAnchor(value: string): string;
/** Select configured book chapters and parts from a Markdown syntax tree. */
export declare function selectBook(tree: unknown, structure: ReadmePressConfig['structure']): {
  parts: Array<Record<string, unknown>>;
  chapters: Array<Record<string, unknown>>;
};
/** Transform Markdown into README Press's structured multi-edition document model. */
export declare function transformReadme(
  markdown: string,
  config: LoadedConfig,
  context?: Record<string, unknown>,
): Promise<TransformResult>;
/** Escape text and isolate Latin runs for safe RTL HTML rendering. */
export declare function wrapLatinHtml(text: string): string;
