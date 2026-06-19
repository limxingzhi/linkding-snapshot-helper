---
name: html-to-txt
description: Convert an HTML file (SingleFile snapshot or any saved page) to a clean .txt file for e-readers, removing all images. Use when user wants to read a snapshot on an e-reader, needs a plain text version of an article, or says "convert to txt", "make a text version", "e-reader ready".
user-invocable: true
---

# HTML → TXT Converter

Converts SingleFile HTML snapshots into clean `.txt` files suitable for e-readers.

**Uses Mozilla Readability** (Firefox Reader Mode algorithm) to identify the main article content, stripping navigation, sidebars, ads, cookie banners, and other boilerplate before rendering as plain text.

**What it does:**
- Extracts the main article body via Mozilla Readability (same engine as Firefox Reader Mode)
- Renders paragraphs, headings, lists, and blockquotes as readable text
- Strips all images, figures, SVGs, videos, audio, and embeds
- Removes navigation, sidebars, footers, cookie banners, and related-content widgets
- Filters common boilerplate lines (copyright, privacy, sign-up prompts)
- Word-wraps at a configurable column width (default 80)
- Saves as `.txt` alongside the original HTML file

**Dependencies:** `@mozilla/readability`, `jsdom` (already in project devDependencies).

## Usage

```bash
npx tsx /root/linkding-snapshot-helper/.agents/skills/html-to-txt/convert.ts /path/to/file.html
```

Output: `/path/to/file.txt` (same name, `.txt` extension)

## Options

| Flag | Description |
|------|-------------|
| `--out FILE` | Write to a specific path instead of auto-naming |
| `--width N` | Wrap text at N columns (default: 80; set to 0 to disable) |

## Examples

```bash
# Basic — converts file.html → file.txt
npx tsx convert.ts ~/snapshots/economist-article.html

# Custom output path
npx tsx convert.ts article.html --out ~/kindle/notes.txt

# Wider lines
npx tsx convert.ts article.html --width 120

# No wrapping
npx tsx convert.ts article.html --width 0
```

## Notes

- Works best on SingleFile snapshots, but handles any HTML page
- Images (including alt text, captions, surrounding figures) are completely removed
- Inline formatting (`<strong>`, `<em>`, `<a>`, `<code>`) is preserved as plain text content
- Readability's `charThreshold` is set to 150 to minimise boilerplate leakage
- Run `html-highlight` first to mark passages, then convert — `<mark>` tags render as plain text in the output
