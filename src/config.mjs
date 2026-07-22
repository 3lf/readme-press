import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

function resolveProjectFile(projectRoot, value, fallback) {
  return resolve(projectRoot, value ?? fallback);
}

export async function loadConfig(configFile = 'readme-press.config.mjs', cwd = process.cwd()) {
  const absoluteConfig = resolve(cwd, configFile);
  if (!existsSync(absoluteConfig)) throw new Error(`README Press config not found: ${absoluteConfig}`);
  const loaded = await import(`${pathToFileURL(absoluteConfig).href}?t=${Date.now()}`);
  const raw = loaded.default ?? loaded.config;
  if (!raw || typeof raw !== 'object') throw new Error('README Press config must export a default object.');

  const projectRoot = dirname(absoluteConfig);
  const themeName = typeof raw.theme === 'string' ? raw.theme : raw.theme?.name;
  const themeDirectory = typeof raw.theme === 'object' ? raw.theme.directory : null;
  const themeRoot = themeDirectory
    ? resolveProjectFile(projectRoot, themeDirectory)
    : resolve(PACKAGE_ROOT, 'themes', themeName ?? 'lapis-rtl');
  const repositoryUrl = required(raw.repository?.url, 'repository.url').replace(/\/$/, '');
  const repositoryDisplay = raw.repository?.display ?? repositoryUrl.replace(/^https?:\/\//, '');
  const outputs = {
    normal: raw.outputs?.normal ?? 'book.pdf',
    high: raw.outputs?.high ?? 'book-high-quality.pdf',
  };
  if (outputs.normal === outputs.high) throw new Error('Normal and high-quality output filenames must differ.');

  const config = {
    ...raw,
    configFile: absoluteConfig,
    projectRoot,
    packageRoot: PACKAGE_ROOT,
    sourcePath: resolveProjectFile(projectRoot, raw.source, 'README.md'),
    outputDir: resolveProjectFile(projectRoot, raw.outputDir, 'dist'),
    themeRoot,
    theme: {
      name: themeName ?? null,
      directory: themeRoot,
      stylesheet: resolve(themeRoot, raw.theme?.stylesheet ?? 'book.css'),
      cover: resolveProjectFile(
        projectRoot,
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
        ? resolveProjectFile(projectRoot, raw.cover.file)
        : resolve(themeRoot, 'cover.html'),
      series: raw.cover?.series ?? raw.labels?.coverSeries ?? DEFAULT_LABELS.coverSeries,
      titlePrefix: raw.cover?.titlePrefix ?? raw.metadata?.titlePrefix ?? '',
      title: raw.cover?.title ?? raw.metadata?.title,
      tagline: raw.cover?.tagline ?? raw.metadata?.tagline ?? '',
      repositoryNote: raw.cover?.repositoryNote
        ?? raw.labels?.coverRepositoryNote
        ?? DEFAULT_LABELS.coverRepositoryNote,
    },
    images: {
      normalJpegQuality: raw.images?.normalJpegQuality ?? 94,
      tallRatio: raw.images?.tallRatio ?? 1.4,
      classRules: raw.images?.classRules ?? [],
    },
    mermaid: {
      cacheDir: resolveProjectFile(projectRoot, raw.mermaid?.cacheDir, '.readme-press-cache/mermaid'),
      configPath: raw.mermaid?.config
        ? resolveProjectFile(projectRoot, raw.mermaid.config)
        : resolve(themeRoot, 'mermaid.config.json'),
      fontPath: raw.mermaid?.font
        ? resolveProjectFile(projectRoot, raw.mermaid.font)
        : resolve(themeRoot, 'fonts/Vazirmatn-Variable.woff2'),
      fontFamily: raw.mermaid?.fontFamily ?? 'Vazirmatn',
      mmdcPath: resolve(PACKAGE_ROOT, 'node_modules/.bin/mmdc'),
      puppeteerConfig: raw.mermaid?.puppeteerConfig
        ? resolveProjectFile(projectRoot, raw.mermaid.puppeteerConfig)
        : resolve(themeRoot, 'puppeteer-ci.json'),
    },
    contentRules: {
      calloutClassRules: raw.contentRules?.calloutClassRules ?? [],
      paragraphClassRules: raw.contentRules?.paragraphClassRules ?? [],
      chapterClassRules: raw.contentRules?.chapterClassRules ?? [],
      treeAriaLabel: raw.contentRules?.treeAriaLabel ?? 'Document hierarchy',
    },
    qa: {
      ...(raw.qa ?? {}),
      script: raw.qa?.script ? resolveProjectFile(projectRoot, raw.qa.script) : null,
    },
    release: raw.release ?? {},
  };

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
