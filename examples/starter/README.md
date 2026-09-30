# Introduction

This small guide is a book-shaped Markdown source. It remains readable on GitHub and becomes three checked PDF editions.

# Contents

- [Introduction](#introduction)
- [The first chapter](#the-first-chapter)
- [The second chapter](#the-second-chapter)

# The first chapter

## Start with one source

Keep the introduction, hand-written GitHub contents, and chapters in this file. README Press uses the headings named in `readme-press.config.mjs` to build the printed contents and bookmarks.

| In the source | In the PDF |
| --- | --- |
| Level-one chapter headings | Chapter openers and bookmarks |
| Level-two headings | Sections and contents entries |
| Local images | Optimized or lossless figures by edition |

# The second chapter

## Build and check the result

Run the build from the directory containing this README and its config. Then run QA against the fresh output before sharing it.

```bash
npx readme-press build --config readme-press.config.mjs --quality all
npx readme-press qa --config readme-press.config.mjs --quality all --render-all
```

Edit this guide into your own book. Keep its heading structure and update `structure.parts[0].startHeading` in the config if you rename the first chapter.
