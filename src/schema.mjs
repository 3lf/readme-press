import { z } from 'zod';
import { ReadmePressError } from './errors.mjs';

const stringRecord = z.record(z.string(), z.string());
const classRule = z.object({
  endsWith: z.string(),
  className: z.string(),
}).passthrough();
const contentRule = z.object({
  contains: z.string().optional(),
  startsWith: z.string().optional(),
  titleStartsWith: z.string().optional(),
  className: z.string(),
}).passthrough();

const rawConfigSchema = z.object({
  $schema: z.string().optional(),
  source: z.string().optional(),
  outputDir: z.string().optional(),
  projectRoot: z.string().optional(),
  theme: z.union([
    z.string(),
    z.object({
      name: z.string().optional(),
      directory: z.string().optional(),
      stylesheet: z.string().optional(),
      cover: z.string().optional(),
      mermaidConfig: z.string().optional(),
      puppeteerConfig: z.string().optional(),
    }).passthrough(),
  ]).optional(),
  metadata: z.object({
    title: z.string().min(1),
    subtitle: z.string().optional(),
    titlePrefix: z.string().optional(),
    tagline: z.string().optional(),
    author: z.string().min(1),
    edition: z.string().min(1),
    localDate: z.string().optional(),
    latinDate: z.string().optional(),
    language: z.string().optional(),
    direction: z.string().optional(),
    license: z.string().optional(),
    subject: z.string().optional(),
    creator: z.string().optional(),
    numerals: z.enum(['persian', 'latin']).optional(),
  }).passthrough(),
  repository: z.object({
    url: z.string().min(1),
    display: z.string().optional(),
    branch: z.string().optional(),
  }).passthrough(),
  labels: stringRecord.optional(),
  page: z.object({
    widthCm: z.number().positive().optional(),
    heightCm: z.number().positive().optional(),
    coverDpi: z.number().positive().optional(),
  }).passthrough().optional(),
  structure: z.object({
    introHeading: z.string().min(1),
    githubTocHeading: z.string().min(1),
    parts: z.array(z.object({
      title: z.string().min(1),
      startHeading: z.string().min(1),
    }).passthrough()).min(1),
  }).passthrough(),
  toc: z.object({
    maxDepth: z.number().int().min(1).max(6).optional(),
    chapterOnly: z.array(z.string()).optional(),
  }).passthrough().optional(),
  outputs: z.object({
    normal: z.string().optional(),
    print: z.string().optional(),
    high: z.string().optional(),
  }).passthrough().optional(),
  footer: z.union([
    z.literal(false),
    z.object({
      text: z.string().optional(),
      size: z.number().positive().optional(),
      y: z.number().optional(),
      opacity: z.number().min(0).max(1).optional(),
      color: z.tuple([z.number(), z.number(), z.number()]).optional(),
    }).passthrough(),
  ]).optional(),
  cover: z.object({
    enabled: z.boolean().optional(),
    file: z.string().optional(),
    series: z.string().optional(),
    titlePrefix: z.string().optional(),
    title: z.string().optional(),
    tagline: z.string().optional(),
    repositoryNote: z.string().optional(),
  }).passthrough().optional(),
  images: z.object({
    normalJpegQuality: z.number().int().min(1).max(100).optional(),
    tallRatio: z.number().positive().optional(),
    classRules: z.array(classRule).optional(),
  }).passthrough().optional(),
  mermaid: z.object({
    cacheDir: z.string().optional(),
    config: z.string().optional(),
    font: z.string().optional(),
    fontFamily: z.string().optional(),
    puppeteerConfig: z.string().optional(),
  }).passthrough().optional(),
  contentRules: z.object({
    calloutClassRules: z.array(contentRule).optional(),
    paragraphClassRules: z.array(contentRule).optional(),
    chapterClassRules: z.array(contentRule).optional(),
    treeAriaLabel: z.string().optional(),
  }).passthrough().optional(),
  security: z.object({
    rawHtml: z.enum(['trusted', 'safe', 'deny']).optional(),
    network: z.union([
      z.enum(['trusted', 'allowlist', 'deny']),
      z.object({
        mode: z.enum(['trusted', 'allowlist', 'deny']),
        allowHosts: z.array(z.string()).optional(),
      }).passthrough(),
    ]).optional(),
    allowHosts: z.array(z.string()).optional(),
    diagnostics: z.enum(['warn', 'strict']).optional(),
    strictConfig: z.boolean().optional(),
  }).passthrough().optional(),
  qa: z.object({}).passthrough().optional(),
  release: z.object({}).passthrough().optional(),
}).passthrough();

const CORE_KEYS = {
  '': ['$schema', 'source', 'outputDir', 'projectRoot', 'theme', 'metadata', 'repository', 'labels', 'page', 'structure', 'toc', 'outputs', 'footer', 'cover', 'images', 'mermaid', 'contentRules', 'security', 'qa', 'release'],
  theme: ['name', 'directory', 'stylesheet', 'cover', 'mermaidConfig', 'puppeteerConfig'],
  metadata: ['title', 'subtitle', 'titlePrefix', 'tagline', 'author', 'edition', 'localDate', 'latinDate', 'language', 'direction', 'license', 'subject', 'creator', 'numerals'],
  repository: ['url', 'display', 'branch'],
  page: ['widthCm', 'heightCm', 'coverDpi'],
  structure: ['introHeading', 'githubTocHeading', 'parts'],
  'structure.parts[]': ['title', 'startHeading'],
  toc: ['maxDepth', 'chapterOnly'],
  outputs: ['normal', 'print', 'high'],
  footer: ['text', 'size', 'y', 'opacity', 'color'],
  cover: ['enabled', 'file', 'series', 'titlePrefix', 'title', 'tagline', 'repositoryNote'],
  images: ['normalJpegQuality', 'tallRatio', 'classRules'],
  'images.classRules[]': ['endsWith', 'className'],
  mermaid: ['cacheDir', 'config', 'font', 'fontFamily', 'puppeteerConfig'],
  contentRules: ['calloutClassRules', 'paragraphClassRules', 'chapterClassRules', 'treeAriaLabel'],
  'contentRules.calloutClassRules[]': ['contains', 'startsWith', 'className'],
  'contentRules.paragraphClassRules[]': ['contains', 'startsWith', 'className'],
  'contentRules.chapterClassRules[]': ['titleStartsWith', 'className'],
  security: ['rawHtml', 'network', 'allowHosts', 'diagnostics', 'strictConfig'],
  'security.network': ['mode', 'allowHosts'],
};

function collectUnknownKeys(value, path = '', diagnostics = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return diagnostics;
  if (path === 'qa' || path === 'release' || path === 'labels') return diagnostics;
  const allowed = CORE_KEYS[path];
  if (allowed) {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        diagnostics.push({
          code: 'UNKNOWN_CONFIG_KEY',
          severity: 'warning',
          detail: path ? `${path}.${key}` : key,
        });
      }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (Array.isArray(child)) {
      for (const item of child) collectUnknownKeys(item, `${childPath}[]`, diagnostics);
    } else {
      collectUnknownKeys(child, childPath, diagnostics);
    }
  }
  return diagnostics;
}

/** Validate the object exported by a trusted executable configuration file. */
export function validateConfig(value, { strict = false } = {}) {
  let config;
  try {
    config = rawConfigSchema.parse(value);
  } catch (cause) {
    throw new ReadmePressError('README Press configuration is invalid.', {
      code: 'ERR_CONFIG_VALIDATION',
      details: { issues: cause?.issues ?? [] },
      cause,
    });
  }
  const diagnostics = collectUnknownKeys(config);
  if (strict && diagnostics.length) {
    throw new ReadmePressError('README Press configuration contains unknown core keys.', {
      code: 'ERR_CONFIG_UNKNOWN_KEYS',
      details: { keys: diagnostics.map((diagnostic) => diagnostic.detail) },
    });
  }
  return { config, diagnostics };
}
