---
name: html-to-txt
description: Convert an HTML file (SingleFile snapshot or any saved page) to a clean .txt file for e-readers, removing all images. Use when user wants to read a snapshot on an e-reader, needs a plain text version of an article, or says "convert to txt", "make a text version", "e-reader ready".
user-invocable: true
---

# HTML → TXT Converter

Converts SingleFile HTML snapshots into clean `.txt` files suitable for e-readers.

**Uses Mozilla Readability** (Firefox Reader Mode algorithm) to extract the main article content, stripping navigation, sidebars, ads, cookie banners, and other boilerplate.

**What it does:**
- Extracts article body via Mozilla Readability
- Renders headings with `#` / `##` / `###` markers
- Shows links as `text [url]`
- Preserves blockquotes with `> ` prefix, lists with `•` / `1.`
- Indents code blocks with 2 spaces
- Strips all images, figures, SVGs, videos, audio
- Frontmatter: `Title:`, `URL:`, `Tags:` from linkding metadata
- Word-wraps at configurable column width (default 80)

**Dependencies:** `@mozilla/readability`, `jsdom` (already in project devDependencies).

## Usage

```bash
npx tsx convert.ts /path/to/file.html [options]
```

Output: `/path/to/file.txt` (same name, `.txt` extension)

## Options

| Flag | Description |
|------|-------------|
| `--out FILE` | Write to a specific path instead of auto-naming |
| `--width N` | Wrap text at N columns (default: 80; set to 0 to disable) |
| `--title TEXT` | Bookmark title (shown in frontmatter and as `# heading`) |
| `--url URL` | Bookmark URL (shown in frontmatter) |
| `--tags TAG1,TAG2` | Comma-separated tags (shown in frontmatter) |

## Cleaning up

- check that the output .txt file is readable
- check that the .txt file doesnt contain garbage unreadable or encoded text
- check that the front matter is valid

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
- During `sync`, the converter runs automatically with bookmark metadata (title, URL, tags)
- Images (including alt text, captions, figures) are completely removed
- Inline formatting (`<strong>`, `<em>`, `<code>`) is preserved as plain text content
- Readability's `charThreshold` is set to 150 to minimise boilerplate leakage
