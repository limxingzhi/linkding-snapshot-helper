#!/usr/bin/env python3
"""
Convert a SingleFile HTML snapshot to clean .txt for e-readers.
Removes images, navigation, scripts, styles — outputs readable plain text.

Usage:  python3 convert.py file.html [--out FILE] [--width N]
"""

import argparse, os, re, sys
from html.parser import HTMLParser

BLOCK_TAGS = {'p','h1','h2','h3','h4','h5','h6','li','blockquote','pre'}
INLINE_TAGS = {'strong','b','em','i','u','s','a','span','sub','sup',
               'small','code','q','cite','abbr','dfn','kbd','mark'}
SKIP_TAGS  = {'script','style','nav','img','figure','svg','canvas',
              'noscript','iframe','video','audio','form','select',
              'button','input','textarea','object','embed','title'}
VOID_TAGS = {'img','input','br','hr','area','base','col','embed',
             'link','meta','param','source','track','wbr'}


class HtmlToText(HTMLParser):
    def __init__(self, width=80):
        super().__init__(convert_charrefs=True)
        self.width = width
        self._out = []
        self._buf = []
        self._skip = 0
        self._in_pre = False
        self._pre_buf = ''
        self._list_depth = 0

    # -- helpers -----------------------------------------------------------

    def _flush(self):
        t = ''.join(self._buf).strip()
        if t:
            self._out.append(t)
        self._buf = []

    def _writeln(self, line=''):
        self._out.append(line)

    def _wrap(self, text, indent=0):
        if self.width <= 0 or len(text) <= self.width:
            self._writeln(' ' * indent + text)
            return
        line, col = [], 0
        prefix = ' ' * indent
        for w in text.split():
            if col + len(w) + (1 if line else 0) > self.width:
                self._writeln(prefix + ' '.join(line))
                line, col = [w], len(w)
            else:
                line.append(w)
                col += len(w) + (1 if line else 0)
        if line:
            self._writeln(prefix + ' '.join(line))

    # -- parser ------------------------------------------------------------

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self._skip:
            # Inside a skip region — only track non-void tags.
            if tag not in VOID_TAGS:
                self._skip += 1
            return
        if tag in SKIP_TAGS:
            self._skip = 0 if tag in VOID_TAGS else 1
            return

        # Inline tags should not trigger a block flush.
        if tag in INLINE_TAGS:
            return

        self._flush()

        if tag in ('h1','h2','h3','h4','h5','h6'):
            pass  # block tag, flush handled above
        elif tag == 'p':
            pass
        elif tag == 'blockquote':
            pass
        elif tag == 'li':
            pass
        elif tag in ('ul','ol'):
            self._list_depth += 1
        elif tag == 'br':
            self._writeln()
        elif tag == 'hr':
            self._writeln('─' * 40)
        elif tag == 'pre':
            self._in_pre = True
            self._pre_buf = ''

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self._skip:
            self._skip -= 1
            return

        if tag == 'li':
            text = ''.join(self._buf).strip()
            self._buf = []
            if text:
                self._wrap(f'• {text}', indent=2 * self._list_depth - 2)
            return

        # Inline end tags: don't flush.
        if tag in INLINE_TAGS:
            return

        self._flush()

        if tag in ('p','h1','h2','h3','h4','h5','h6'):
            self._writeln()
        elif tag == 'blockquote':
            self._writeln()
        elif tag in ('ul','ol'):
            self._list_depth = max(0, self._list_depth - 1)
        elif tag == 'pre':
            self._in_pre = False
            t = re.sub(r'\n\s*\n', '\n', self._pre_buf.strip())
            if t:
                for line in t.split('\n'):
                    self._writeln('  ' + line)
                self._writeln()
            self._pre_buf = ''

    def handle_data(self, data):
        if self._skip:
            return
        if self._in_pre:
            self._pre_buf += data
            return
        self._buf.append(data)

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if tag == 'br':
            self._writeln()
        elif tag == 'hr':
            self._writeln('─' * 40)
        elif tag == 'img':
            pass  # removed

    def get_text(self):
        self._flush()
        # Trim leading/trailing blank lines
        while self._out and self._out[-1] == '':
            self._out.pop()
        while self._out and self._out[0] == '':
            self._out.pop(0)
        return '\n'.join(self._out)


def convert(html_path, *, out_path=None, width=80):
    """Convert HTML file to .txt.  Returns the output path."""
    with open(html_path, 'r', encoding='utf-8', errors='replace') as f:
        raw = f.read()

    parser = HtmlToText(width=width)
    parser.feed(raw)
    text = parser.get_text()

    if out_path is None:
        out_path = os.path.splitext(html_path)[0] + '.txt'

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(text)
        f.write('\n')
    return out_path


def main():
    ap = argparse.ArgumentParser(
        description='Convert SingleFile HTML snapshot to clean .txt for e-readers.')
    ap.add_argument('html', help='Input HTML file')
    ap.add_argument('--out', help='Output path (default: same name, .txt)')
    ap.add_argument('--width', type=int, default=80,
                    help='Line wrap width (0 = disable, default: 80)')
    args = ap.parse_args()

    if not os.path.isfile(args.html):
        print(f'Error: file not found: {args.html}', file=sys.stderr)
        sys.exit(1)

    out = convert(args.html, out_path=args.out, width=args.width)
    print(f'Written: {out}')


if __name__ == '__main__':
    main()
