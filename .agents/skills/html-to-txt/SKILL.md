---
name: html-to-txt
description: Convert an HTML file (SingleFile snapshot or any saved page) to a clean .txt file for e-readers, removing all images. Use when user wants to read a snapshot on an e-reader, needs a plain text version of an article, or says "convert to txt", "make a text version", "e-reader ready".
user-invocable: true
---

# HTML → TXT Converter

Converts HTML snapshots into clean `.txt` files suitable for e-readers.

**What it does:**
- Extracts readable text (paragraphs, headings, lists, blockquotes)
- Strips navigation, scripts, styles, forms, and other boilerplate
- Removes all images, figures, SVGs, and canvases
- Word-wraps at a configurable column width (default 80)
- Saves as `.txt` alongside the original HTML file

**No external dependencies** — uses Python's standard library HTML parser.

## Usage

```bash
python3 /root/linkding-snapshot-helper/.agents/skills/html-to-txt/convert.py /path/to/file.html
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
python3 convert.py ~/snapshots/economist-article.html

# Custom output path
python3 convert.py article.html --out ~/kindle/notes.txt

# Wider lines for desktop reading
python3 convert.py article.html --width 120

# No line wrapping
python3 convert.py article.html --width 0
```

## Tips

- Works on any HTML file, not just SingleFile snapshots
- Images are silently removed (alt text, captions, surrounding figures all stripped)
- Inline formatting (`<strong>`, `<em>`, `<a>`, `<code>`, etc.) is preserved as plain text
- Run `html-highlight` first to mark passages, then convert to get a marked-up text version — `<mark>` tags render as plain text in the output
