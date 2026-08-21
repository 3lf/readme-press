export type OutputQuality = 'normal' | 'print' | 'high' | 'all';
export type RawHtmlMode = 'trusted' | 'safe' | 'deny';
export type DiagnosticsMode = 'warn' | 'strict';

export interface NetworkPolicy {
  mode: 'trusted' | 'allowlist' | 'deny';
  allowHosts?: string[];
}

export interface Diagnostic {
  code: string;
  detail: string;
  severity?: 'warning' | 'error';
  /** Set to false for compatibility notices that must not break strict builds. */
  promoteInStrict?: boolean;
}

export interface ReadmePressConfig {
  $schema?: string;
  source?: string;
  outputDir?: string;
  projectRoot?: string;
  theme?: string | {
    name?: string;
    directory?: string;
    stylesheet?: string;
    cover?: string;
    mermaidConfig?: string;
    puppeteerConfig?: string;
  };
  metadata: {
    title: string;
    subtitle?: string;
    titlePrefix?: string;
    tagline?: string;
    author: string;
    edition: string;
    localDate?: string;
    latinDate?: string;
    language?: string;
    direction?: string;
    license?: string;
    subject?: string;
    creator?: string;
    numerals?: 'persian' | 'latin';
  };
  repository: {
    url: string;
    display?: string;
    branch?: string;
  };
  labels?: Record<string, string>;
  page?: { widthCm?: number; heightCm?: number; coverDpi?: number };
  structure: {
    introHeading: string;
    githubTocHeading: string;
    parts: Array<{ title: string; startHeading: string }>;
  };
  toc?: { maxDepth?: number; chapterOnly?: string[] };
  outputs?: { normal?: string; print?: string; high?: string };
  footer?: false | {
    text?: string;
    size?: number;
    y?: number;
    opacity?: number;
    color?: [number, number, number];
  };
  cover?: {
    enabled?: boolean;
    file?: string;
    series?: string;
    titlePrefix?: string;
    title?: string;
    tagline?: string;
    repositoryNote?: string;
  };
  images?: {
    normalJpegQuality?: number;
    tallRatio?: number;
    classRules?: Array<{ endsWith: string; className: string }>;
  };
  mermaid?: {
    cacheDir?: string;
    config?: string;
    font?: string;
    fontFamily?: string;
    puppeteerConfig?: string;
  };
  contentRules?: {
    calloutClassRules?: Array<{ contains?: string; startsWith?: string; className: string }>;
    paragraphClassRules?: Array<{ contains?: string; startsWith?: string; className: string }>;
    chapterClassRules?: Array<{ titleStartsWith: string; className: string }>;
    treeAriaLabel?: string;
  };
  security?: {
    rawHtml?: RawHtmlMode;
    network?: 'trusted' | 'allowlist' | 'deny' | NetworkPolicy;
    allowHosts?: string[];
    diagnostics?: DiagnosticsMode;
    strictConfig?: boolean;
  };
  qa?: Record<string, unknown>;
  release?: Record<string, unknown>;
}

export interface LoadedConfig extends Omit<ReadmePressConfig, 'theme' | 'page' | 'footer' | 'cover' | 'mermaid'> {
  configFile: string;
  configRoot: string;
  projectRoot: string;
  contentRoot: string;
  packageRoot: string;
  sourcePath: string;
  outputDir: string;
  themeRoot: string;
  theme: {
    name: string | null;
    directory: string;
    stylesheet: string;
    cover: string;
    mermaidConfig: string;
    puppeteerConfig: string;
  };
  page: { widthCm: number; heightCm: number; coverDpi: number };
  footer: null | {
    text: string;
    size: number;
    y: number;
    opacity: number;
    color: [number, number, number];
  };
  cover: {
    enabled: boolean;
    file: string;
    series: string;
    titlePrefix: string;
    title: string;
    tagline: string;
    repositoryNote: string;
  };
  mermaid: {
    cacheDir: string;
    configPath: string;
    fontPath: string;
    fontFamily: string;
    mmdcPath: string | null;
    puppeteerConfig: string;
  };
  validationDiagnostics: Diagnostic[];
  outputs: { normal: string; print?: string; high: string };
  security: {
    rawHtml: RawHtmlMode;
    network: NetworkPolicy;
    diagnostics: DiagnosticsMode;
    strictConfig: boolean;
  };
  qa: Record<string, unknown> & { script?: string | null };
  release: Record<string, unknown>;
}

export interface BuildOutput {
  quality: Exclude<OutputQuality, 'all'>;
  imageMode: string;
  pdf: string;
  html: string;
  pageCount: number;
  bytes: number;
  sha256: string;
  linearized: boolean;
  externalRequests: string[];
  [key: string]: unknown;
}

export interface BuildManifest {
  engine: { name: string; version: string };
  source: string;
  sourceSha256: string;
  sourceCommit: string | null;
  releaseVersion: string | null;
  requestedQuality: OutputQuality;
  primaryQuality: Exclude<OutputQuality, 'all'>;
  outputs: Partial<Record<Exclude<OutputQuality, 'all'>, BuildOutput>>;
  pageCount: number;
  diagnostics: Diagnostic[];
  generatedFiles: string[];
  publication?: {
    cleanup?: {
      reaped?: number;
      reapedPaths?: string[];
      reapedPathsTruncated?: boolean;
      removed?: number;
      removedPaths?: string[];
      removedPathsTruncated?: boolean;
    };
  };
  [key: string]: unknown;
}

export interface BuildOptions {
  configFile?: string;
  quality?: OutputQuality;
  releaseVersion?: string;
}

export interface QaOptions extends BuildOptions {
  renderAll?: boolean;
}

export interface TransformResult {
  parts: Array<Record<string, unknown>>;
  chapters: Array<Record<string, unknown>>;
  headings: Array<Record<string, unknown>>;
  usedEmoji: Set<string>;
  diagrams: Map<string, string>;
  images: Map<string, Record<string, unknown>>;
  diagnostics: Diagnostic[];
}

export interface ReleaseResult {
  version: string;
  outputs: Record<string, BuildOutput & { path: string }>;
  normal: BuildOutput & { path: string };
  print?: BuildOutput & { path: string };
  high: BuildOutput & { path: string };
  sourceCommit: string;
}
