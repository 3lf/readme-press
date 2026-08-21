import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sanitizeInlineMarkup } from './html.mjs';
import { normalizeNetworkPolicy } from './network.mjs';
import { outputComparisonIdentity, resolveContainedOutput } from './paths.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PIPELINE_PDF_NAMES = [
  'body.pdf',
  'body-high-quality.pdf',
  'body-print.pdf',
  'cover.pdf',
  'cover-print.pdf',
];

const DEFAULT_LABELS = {
  colophon: 'شناسنامه',
  title: 'عنوان',
  subtitle: 'زیرعنوان',
  author: 'نویسنده',
  edition: 'نسخه',
  releaseVersion: 'نسخه انتشار',
  source: 'منبع',
  license: 'مجوز',
  latestTitle: 'آخرین نسخه کتاب رو از GitHub بگیر',
  latestBody: 'این فایل ممکنه بعد از انتشار به‌روزرسانی شده باشه. نسخه جدید همیشه از این لینک در دسترسه:',
  latestLink: 'نسخه جدید و صفحه پروژه',
  issueNote: 'اگه جایی ایرادی دیدی، با یه Issue خبر بده تا درستش کنیم.',
  tocEyebrow: 'از کجا شروع کنم؟',
  tocTitle: 'فهرست مطالب',
  tocDescription: 'اگه دنبال یه موضوع مشخصی می‌گردی، از همین فهرست بپر همون‌جا. اگه هم تازه شروع کردی، از اول بیا جلو؛ ترتیب فصل‌ها طوری چیده شده که قدم‌به‌قدم پیش بری.',
  part: 'بخش',
  chapter: 'فصل',
  introduction: 'پیش از شروع',
  coverSeries: 'کتاب‌های ساخته‌شده با README Press',
  coverRepositoryNote: 'آخرین نسخه را از <strong>GitHub</strong> بگیر.',
};

export function defineConfig(config) {
  return config;
}

function required(value, label) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required configuration: ${label}`);
  }
  return value;
}

function requiredHttpUrl(value, label) {
  const string = String(required(value, label));
  let url;
  try {
    url = new URL(string);
  } catch {
    throw new Error(`${label} must be a valid HTTP or HTTPS URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  return string;
}

function resolveConfigFile(configRoot, value, fallback) {
  return resolve(configRoot, value ?? fallback);
}

export async function loadConfig(configFile = 'readme-press.config.mjs', cwd = process.cwd()) {
  const absoluteConfig = resolve(cwd, configFile);
  if (!existsSync(absoluteConfig)) throw new Error(`README Press config not found: ${absoluteConfig}`);
  const loaded = await import(`${pathToFileURL(absoluteConfig).href}?t=${Date.now()}`);
  const raw = loaded.default ?? loaded.config;
  if (!raw || typeof raw !== 'object') throw new Error('README Press config must export a default object.');

  const configRoot = dirname(absoluteConfig);
  const sourcePath = resolveConfigFile(configRoot, raw.source, 'README.md');
  const contentRoot = raw.projectRoot
    ? resolveConfigFile(configRoot, raw.projectRoot)
    : dirname(sourcePath);
  if (!existsSync(contentRoot) || !statSync(contentRoot).isDirectory()) {
    throw new Error(`Configured projectRoot must be an existing directory: ${contentRoot}`);
  }
  const canonicalContentRoot = realpathSync(contentRoot);
  const themeName = typeof raw.theme === 'string' ? raw.theme : raw.theme?.name;
  const themeDirectory = typeof raw.theme === 'object' ? raw.theme.directory : null;
  const themeRoot = themeDirectory
    ? resolveConfigFile(configRoot, themeDirectory)
    : resolve(PACKAGE_ROOT, 'themes', themeName ?? 'lapis-rtl');
  const repositoryUrl = requiredHttpUrl(raw.repository?.url, 'repository.url').replace(/\/$/, '');
  const repositoryDisplay = raw.repository?.display ?? repositoryUrl.replace(/^https?:\/\//, '');
  const rawHtmlMode = raw.security?.rawHtml ?? 'trusted';
  if (!['trusted', 'safe', 'deny'].includes(rawHtmlMode)) {
    throw new Error(`security.rawHtml must be trusted, safe, or deny; received ${rawHtmlMode}.`);
  }
  const networkPolicy = normalizeNetworkPolicy(
    raw.security?.network,
    raw.security?.allowHosts ?? [],
  );
  const diagnosticsMode = raw.security?.diagnostics ?? 'warn';
  if (!['warn', 'strict'].includes(diagnosticsMode)) {
    throw new Error(`security.diagnostics must be warn or strict; received ${diagnosticsMode}.`);
  }
  const outputs = {
    normal: raw.outputs?.normal ?? 'book.pdf',
    high: raw.outputs?.high ?? 'book-high-quality.pdf',
  };
  if (raw.outputs?.print !== undefined) {
    outputs.print = required(raw.outputs.print, 'outputs.print');
  }

  const config = {
    ...raw,
    configFile: absoluteConfig,
    configRoot,
    projectRoot: configRoot,
    contentRoot: canonicalContentRoot,
    packageRoot: PACKAGE_ROOT,
    sourcePath,
    outputDir: resolveConfigFile(configRoot, raw.outputDir, 'dist'),
    themeRoot,
    theme: {
      name: themeName ?? null,
      directory: themeRoot,
      stylesheet: resolve(themeRoot, raw.theme?.stylesheet ?? 'book.css'),
      cover: resolveConfigFile(
        configRoot,
        raw.cover?.file,
        themeDirectory ? `${themeDirectory}/cover.html` : `${themeRoot}/cover.html`,
      ),
      mermaidConfig: resolve(themeRoot, raw.theme?.mermaidConfig ?? 'mermaid.config.json'),
      puppeteerConfig: resolve(themeRoot, raw.theme?.puppeteerConfig ?? 'puppeteer-ci.json'),
    },
    metadata: {
      title: required(raw.metadata?.title, 'metadata.title'),
      subtitle: raw.metadata?.subtitle ?? '',
      titlePrefix: raw.metadata?.titlePrefix ?? '',
      tagline: raw.metadata?.tagline ?? '',
      author: required(raw.metadata?.author, 'metadata.author'),
      edition: required(raw.metadata?.edition, 'metadata.edition'),
      localDate: raw.metadata?.localDate ?? raw.metadata?.edition,
      latinDate: raw.metadata?.latinDate ?? '',
      language: raw.metadata?.language ?? 'fa',
      direction: raw.metadata?.direction ?? 'rtl',
      license: raw.metadata?.license ?? '',
      subject: raw.metadata?.subject ?? raw.metadata?.subtitle ?? raw.metadata?.title,
      creator: raw.metadata?.creator ?? 'README Press',
      numerals: raw.metadata?.numerals ?? (raw.metadata?.language === 'fa' ? 'persian' : 'latin'),
    },
    repository: {
      ...raw.repository,
      url: repositoryUrl,
      display: repositoryDisplay,
      branch: raw.repository?.branch ?? 'main',
    },
    labels: { ...DEFAULT_LABELS, ...(raw.labels ?? {}) },
    page: {
      widthCm: raw.page?.widthCm ?? 17,
      heightCm: raw.page?.heightCm ?? 24,
      coverDpi: raw.page?.coverDpi ?? 300,
    },
    structure: required(raw.structure, 'structure'),
    toc: raw.toc ?? {},
    outputs,
    footer: raw.footer === false ? null : {
      text: raw.footer?.text ?? repositoryDisplay,
      size: raw.footer?.size ?? 5.4,
      y: raw.footer?.y ?? 17.5,
      opacity: raw.footer?.opacity ?? 0.54,
      color: raw.footer?.color ?? [28, 63, 115],
    },
    cover: {
      enabled: raw.cover?.enabled !== false,
      file: raw.cover?.file
        ? resolveConfigFile(configRoot, raw.cover.file)
        : resolve(themeRoot, 'cover.html'),
      series: raw.cover?.series ?? raw.labels?.coverSeries ?? DEFAULT_LABELS.coverSeries,
      titlePrefix: raw.cover?.titlePrefix ?? raw.metadata?.titlePrefix ?? '',
      title: raw.cover?.title ?? raw.metadata?.title,
      tagline: raw.cover?.tagline ?? raw.metadata?.tagline ?? '',
      repositoryNote: sanitizeInlineMarkup(
        raw.cover?.repositoryNote
          ?? raw.labels?.coverRepositoryNote
          ?? DEFAULT_LABELS.coverRepositoryNote,
      ),
    },
    images: {
      normalJpegQuality: raw.images?.normalJpegQuality ?? 94,
      tallRatio: raw.images?.tallRatio ?? 1.4,
      classRules: raw.images?.classRules ?? [],
    },
    mermaid: {
      cacheDir: resolveConfigFile(configRoot, raw.mermaid?.cacheDir, '.readme-press-cache/mermaid'),
      configPath: raw.mermaid?.config
        ? resolveConfigFile(configRoot, raw.mermaid.config)
        : resolve(themeRoot, 'mermaid.config.json'),
      fontPath: raw.mermaid?.font
        ? resolveConfigFile(configRoot, raw.mermaid.font)
        : resolve(themeRoot, 'fonts/Vazirmatn-Variable.woff2'),
      fontFamily: raw.mermaid?.fontFamily ?? 'Vazirmatn',
      mmdcPath: resolve(PACKAGE_ROOT, 'node_modules/.bin/mmdc'),
      puppeteerConfig: raw.mermaid?.puppeteerConfig
        ? resolveConfigFile(configRoot, raw.mermaid.puppeteerConfig)
        : resolve(themeRoot, 'puppeteer-ci.json'),
    },
    contentRules: {
      calloutClassRules: raw.contentRules?.calloutClassRules ?? [],
      paragraphClassRules: raw.contentRules?.paragraphClassRules ?? [],
      chapterClassRules: raw.contentRules?.chapterClassRules ?? [],
      treeAriaLabel: raw.contentRules?.treeAriaLabel ?? 'Document hierarchy',
    },
    security: {
      ...(raw.security ?? {}),
      rawHtml: rawHtmlMode,
      network: networkPolicy,
      diagnostics: diagnosticsMode,
    },
    qa: {
      ...(raw.qa ?? {}),
      script: raw.qa?.script ? resolveConfigFile(configRoot, raw.qa.script) : null,
    },
    release: raw.release ?? {},
  };

  const outputEntries = Object.entries(config.outputs).map(([quality, output]) => {
    resolveContainedOutput(config.outputDir, output, {
      extension: '.pdf',
      label: `outputs.${quality}`,
    });
    return {
      quality,
      output,
      identity: outputComparisonIdentity(config.outputDir, output, {
        extension: '.pdf',
        label: `outputs.${quality}`,
      }),
    };
  });
  const pipelineIdentities = new Set(PIPELINE_PDF_NAMES.map((name) => (
    outputComparisonIdentity(config.outputDir, name, {
      extension: '.pdf',
      label: `Pipeline-owned output ${name}`,
    })
  )));
  const configuredIdentities = new Map();
  for (const { quality, output, identity } of outputEntries) {
    if (pipelineIdentities.has(identity)) {
      throw new Error(`outputs.${quality} uses a pipeline-owned PDF name: ${output}`);
    }
    const previous = configuredIdentities.get(identity);
    if (previous) {
      throw new Error(`Output filenames must be unique after path normalization: outputs.${previous} and outputs.${quality}.`);
    }
    configuredIdentities.set(identity, quality);
  }
  for (const { quality, output } of outputEntries) {
    const linearized = String(output).replace(/\.pdf$/iu, '.linearized.pdf');
    const identity = outputComparisonIdentity(config.outputDir, linearized, {
      extension: '.pdf',
      label: `outputs.${quality} linearization file`,
    });
    const collision = configuredIdentities.get(identity);
    if (collision) {
      throw new Error(`outputs.${quality} linearization file collides with outputs.${collision}.`);
    }
  }

  for (const [label, path] of [
    ['source', config.sourcePath],
    ['theme stylesheet', config.theme.stylesheet],
    ['cover', config.cover.file],
  ]) {
    if ((label !== 'cover' || config.cover.enabled) && !existsSync(path)) {
      throw new Error(`Configured ${label} does not exist: ${path}`);
    }
  }
  return config;
}

export function packageRoot() {
  return PACKAGE_ROOT;
}
