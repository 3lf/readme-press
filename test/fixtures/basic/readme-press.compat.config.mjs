import base from './readme-press.config.mjs';

export default {
  ...base,
  outputDir: 'dist-compat-0.2.1',
  cover: { enabled: false },
  outputs: {
    normal: 'compatibility.pdf',
    high: 'compatibility-high-quality.pdf',
  },
  security: {
    diagnostics: 'strict',
  },
  qa: {
    ...base.qa,
    minPages: 2,
  },
};
