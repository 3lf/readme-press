import { z } from 'zod';
import { PROSE_RULE_MATCHERS } from './content-rules.mjs';
import { ReadmePressError } from './errors.mjs';

const stringRecordSchema = z.record(z.string(), z.string());
const themeSchema = z.object({
  name: z.string().optional(),
  directory: z.string().optional(),
  stylesheet: z.string().optional(),
  cover: z.string().optional(),
  mermaidConfig: z.string().optional(),
  puppeteerConfig: z.string().optional(),
}).passthrough();
const metadataSchema = z.object({
  title: z.string().min(1), subtitle: z.string().optional(), titlePrefix: z.string().optional(),
  tagline: z.string().optional(), author: z.string().min(1), edition: z.string().min(1),
  localDate: z.string().optional(), latinDate: z.string().optional(), language: z.string().optional(),
  direction: z.string().optional(), license: z.string().optional(), subject: z.string().optional(),
  creator: z.string().optional(), numerals: z.enum(['persian', 'latin']).optional(),
}).passthrough();
const repositorySchema = z.object({
  url: z.string().min(1), display: z.string().optional(), branch: z.string().optional(),
}).passthrough();
const pageSchema = z.object({
  widthCm: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  coverDpi: z.number().positive().optional(),
}).passthrough();
const partSchema = z.object({ title: z.string().min(1), startHeading: z.string().min(1) }).passthrough();
const structureSchema = z.object({
  introHeading: z.string().min(1),
  githubTocHeading: z.string().min(1),
  parts: z.array(partSchema).min(1),
}).passthrough();
const tocSchema = z.object({
  maxDepth: z.number().int().min(1).max(6).optional(),
  chapterOnly: z.array(z.string()).optional(),
}).passthrough();
const outputsSchema = z.object({
  normal: z.string().optional(), print: z.string().optional(), high: z.string().optional(),
}).passthrough();
const footerSchema = z.object({
  text: z.string().optional(), size: z.number().positive().optional(), y: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  color: z.tuple([z.number(), z.number(), z.number()]).optional(),
}).passthrough();
const coverSchema = z.object({
  enabled: z.boolean().optional(), file: z.string().optional(), series: z.string().optional(),
  titlePrefix: z.string().optional(), title: z.string().optional(), tagline: z.string().optional(),
  repositoryNote: z.string().optional(),
}).passthrough();
const imageClassRuleSchema = z.object({
  endsWith: z.string(), className: z.string(), label: z.string().min(1).optional(),
}).passthrough();
const imagesSchema = z.object({
  normalJpegQuality: z.number().int().min(1).max(100).optional(),
  tallRatio: z.number().positive().optional(),
  classRules: z.array(imageClassRuleSchema).optional(),
}).passthrough();
const mermaidSchema = z.object({
  cacheDir: z.string().optional(), config: z.string().optional(), font: z.string().optional(),
  fontFamily: z.string().optional(), puppeteerConfig: z.string().optional(),
}).passthrough();
const proseMatcherShape = Object.fromEntries(
  PROSE_RULE_MATCHERS.map((matcher) => [matcher, z.string().min(1).optional()]),
);
const proseRuleSchema = z.object({
  ...proseMatcherShape, className: z.string(), label: z.string().min(1).optional(),
}).passthrough().refine((rule) => PROSE_RULE_MATCHERS.some((matcher) => Boolean(rule[matcher])), {
  message: 'at least one of contains or startsWith is required',
});
const chapterRuleSchema = z.object({
  titleStartsWith: z.string().min(1), className: z.string(), label: z.string().min(1).optional(),
}).passthrough();
const contentRulesSchema = z.object({
  calloutClassRules: z.array(proseRuleSchema).optional(),
  paragraphClassRules: z.array(proseRuleSchema).optional(),
  chapterClassRules: z.array(chapterRuleSchema).optional(),
  treeAriaLabel: z.string().optional(),
}).passthrough();
const networkObjectSchema = z.object({
  mode: z.enum(['trusted', 'allowlist', 'deny']), allowHosts: z.array(z.string()).optional(),
}).passthrough();
const securitySchema = z.object({
  rawHtml: z.enum(['trusted', 'safe', 'deny']).optional(),
  network: z.union([z.enum(['trusted', 'allowlist', 'deny']), networkObjectSchema]).optional(),
  allowHosts: z.array(z.string()).optional(),
  diagnostics: z.enum(['warn', 'strict']).optional(),
  strictConfig: z.boolean().optional(),
}).passthrough();
const extensionSchema = z.object({}).passthrough();

const rawConfigSchema = z.object({
  $schema: z.string().optional(), source: z.string().optional(), outputDir: z.string().optional(),
  projectRoot: z.string().optional(), theme: z.union([z.string(), themeSchema]).optional(),
  metadata: metadataSchema, repository: repositorySchema, labels: stringRecordSchema.optional(),
  page: pageSchema.optional(), structure: structureSchema, toc: tocSchema.optional(),
  outputs: outputsSchema.optional(), footer: z.union([z.literal(false), footerSchema]).optional(),
  cover: coverSchema.optional(), images: imagesSchema.optional(), mermaid: mermaidSchema.optional(),
  contentRules: contentRulesSchema.optional(), security: securitySchema.optional(),
  qa: extensionSchema.optional(), release: extensionSchema.optional(),
}).passthrough();

const CORE_SCHEMAS = new Map([
  ['', rawConfigSchema], ['theme', themeSchema], ['metadata', metadataSchema],
  ['repository', repositorySchema], ['page', pageSchema], ['structure', structureSchema],
  ['structure.parts[]', partSchema], ['toc', tocSchema], ['outputs', outputsSchema],
  ['footer', footerSchema], ['cover', coverSchema], ['images', imagesSchema],
  ['images.classRules[]', imageClassRuleSchema], ['mermaid', mermaidSchema],
  ['contentRules', contentRulesSchema], ['contentRules.calloutClassRules[]', proseRuleSchema],
  ['contentRules.paragraphClassRules[]', proseRuleSchema],
  ['contentRules.chapterClassRules[]', chapterRuleSchema], ['security', securitySchema],
  ['security.network', networkObjectSchema],
]);
const CORE_KEYS = new Map(
  [...CORE_SCHEMAS].map(([path, schema]) => [path, new Set(Object.keys(schema.shape))]),
);

function collectUnknownKeys(value, path = '', diagnostics = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return diagnostics;
  if (path === 'qa' || path === 'release' || path === 'labels') return diagnostics;
  const allowed = CORE_KEYS.get(path);
  if (allowed) {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        diagnostics.push({
          code: 'UNKNOWN_CONFIG_KEY', severity: 'warning', detail: path ? `${path}.${key}` : key,
        });
      }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (Array.isArray(child)) {
      for (const item of child) collectUnknownKeys(item, `${childPath}[]`, diagnostics);
    } else collectUnknownKeys(child, childPath, diagnostics);
  }
  return diagnostics;
}

function issueSummary(issues) {
  const shown = issues.slice(0, 5).map((issue) => {
    const path = issue.path?.length ? issue.path.join('.') : '(root)';
    const message = String(issue.message ?? 'invalid value').replace(/\s+/gu, ' ').slice(0, 160);
    return `${path}: ${message}`;
  });
  if (issues.length > shown.length) shown.push(`and ${issues.length - shown.length} more issue(s)`);
  return shown.join('; ');
}

/** Validate the object exported by a trusted executable configuration file. */
export function validateConfig(value, { strict = true } = {}) {
  let config;
  try {
    config = rawConfigSchema.parse(value);
  } catch (cause) {
    const issues = cause?.issues ?? [];
    throw new ReadmePressError(`README Press configuration is invalid: ${issueSummary(issues)}`, {
      code: 'ERR_CONFIG_VALIDATION', details: { issues }, cause,
    });
  }
  const diagnostics = collectUnknownKeys(config);
  const securityKeys = diagnostics.filter((diagnostic) => diagnostic.detail === 'security'
    || diagnostic.detail.startsWith('security.'));
  if (securityKeys.length) {
    throw new ReadmePressError('README Press configuration contains unknown security keys.', {
      code: 'ERR_CONFIG_UNKNOWN_SECURITY_KEYS',
      details: { keys: securityKeys.map((diagnostic) => diagnostic.detail) },
    });
  }
  if (strict && diagnostics.length) {
    throw new ReadmePressError('README Press configuration contains unknown core keys.', {
      code: 'ERR_CONFIG_UNKNOWN_KEYS',
      details: { keys: diagnostics.map((diagnostic) => diagnostic.detail) },
    });
  }
  return { config, diagnostics };
}
