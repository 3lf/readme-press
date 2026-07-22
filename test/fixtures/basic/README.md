<div dir="ltr">

# Introduction 📚

README Press turns a long Markdown guide into a print-ready book. It preserves searchable text, internal links, syntax highlighting, figures, and document navigation.

# Contents ✨

- [Introduction](#introduction-)
- [Building a reliable book](#building-a-reliable-book-)
- [Validating the result](#validating-the-result-)

# Building a reliable book 🏗️

## Start with one source

Keep the source readable on GitHub and move print presentation into configuration and themes.

![A generated test figure](figure.png)

> A normal build optimizes PNG figures, while the high-quality build keeps their original pixels. 💡

```javascript
export default {
  source: "README.md",
  outputDir: "dist"
};
```

# Validating the result ✅

## Test the artifact, not only the source

Verify PDF structure, fonts, links, page geometry, full-page rendering, checksums, and quality parity before publication.

</div>
