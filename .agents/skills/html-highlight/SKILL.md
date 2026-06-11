---
name: html-highlight
description: Highlight specific phrases or passages in an HTML file using `<mark>` tags. Use when user wants to mark up important bits, key quotes, or notable passages in a saved HTML page.
user-invocable: true
---

# HTML Highlight

## What to Highlight

**A highlight should be a self-contained claim or concept** — if someone reads all the `<mark>` tags end-to-end they should grasp the article's argument without surrounding context.

**Good targets:**
- Startling statistics or data points: *"96 of the top 100 artists on YouTube Music in Brazil were Brazilian"*
- Direct quotes that crystallise the thesis: *"What you realise is, maybe there isn't a global show"*
- Core tension or stakes: *"At no time in modern history has a large country gone all in on high-end technology while navigating a slowing economy"*
- Causation or mechanism: *"people's listening is increasingly guided by algorithms rather than tastemakers on TV or the radio"*
- Summary judgment: *"The infatuation with winning the tech race is like a spell America has unwittingly cast on Chinese leaders"*

**Bad targets:**
- Isolated keywords or proper nouns: `recursive self-improvement`, `RSI`, `Claude`
- Scene-setting or narrative colour: *"Tents are being packed and wellies wiped down"*
- Transitional phrases: *"At the same time"*, *"For those who thought"*, *"What is going on?"*
- Newsletter plugs: *"For more analysis, sign up to..."*

**Frequency:** ~1 highlight per 2–3 paragraphs. Don't force highlights on weak or transitional paragraphs — better to have gaps than diluted quality. A good highlight density is one that leaves the reader with the article's skeleton when skimmed, not every sentence marked.

## Workflow

### 0. Prettify HTML first

SingleFile saves minified HTML (one massive line). Prettify to get predictable line breaks:

```bash
python3 << 'PYEOF'
from html.parser import HTMLParser
class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.lines, self.ind, self._pre, self._textbuf = [], 0, False, ''
    def _flush(self):
        t = self._textbuf.strip()
        if t: self.lines.append('  '*self.ind + t)
        self._textbuf = ''
    def handle_starttag(self, tag, attrs):
        self._flush()
        if tag in ('pre','code','script','style'): self._pre = True; self.lines.append('  '*self.ind + self.get_starttag_text()); return
        void = tag in ('br','hr','img','input','meta','link','area','base','col','embed','source','track','wbr')
        self.lines.append('  '*self.ind + self.get_starttag_text())
        if not void: self.ind += 1
    def handle_endtag(self, tag):
        self._flush()
        if tag in ('pre','code','script','style'): self._pre = False; self.lines.append(f'</{tag}>'); return
        self.ind = max(0,self.ind-1); self.lines.append('  '*self.ind + f'</{tag}>')
    def handle_data(self, d):
        if self._pre: self.lines.append(d)
        else: self._textbuf += d
    def handle_entityref(self, n): self._textbuf += f'&{n};'
    def handle_charref(self, n): self._textbuf += f'&#{n};'
with open('FILE.html','rb') as f: raw = f.read()
p = P(); p.feed(raw.decode('utf-8',errors='replace')); p._flush()
with open('FILE.html','w',encoding='utf-8') as f: f.write('\n'.join(p.lines))
print('Prettified ✓')
PYEOF
```

**Note:** The prettifier preserves nested `<p>` tags (common in The Economist). Highlighting an outer `<p>` propagates visually to children.

### 1. Discover paragraph structure

```bash
python3 << 'PYEOF'
import re
c = open('/path/to/file.html',encoding='utf-8').read()
for i,m in enumerate(re.finditer(r'<p[^>]*>',c)):
    end = c.find('</p>',m.end())
    text = re.sub(r'<[^>]+>','',c[m.end():end]); text = re.sub(r'\s+',' ',text).strip()[:150]
    print(f"P{i}: {m.group()[:100]}\n   {text}\n")
    if i>25: break
PYEOF
```

### 2. Find exact text (debug embedded tags)

Acronyms (`AI`, `GDP`, `TV`, `IMF`, `CSET`, `R&D`) are often wrapped in `<small>` tags, breaking naive text search. Always check the real HTML first:

```bash
python3 << 'PYEOF'
c = open('/path/to/file.html',encoding='utf-8').read()
idx = c.find('your short search fragment')
if idx >= 0: print(repr(c[idx:idx+300]))
else: print("NOT FOUND")
PYEOF
```

Use `repr()` to see exact whitespace, embedded `<small>`/`<a>`/`<b>` tags (including empty `<b>\n</b>`), curly quotes (`\u201c`/`\u201d`/`\u2018`/`\u2019`), em dashes (`\u2014`), and `&nbsp;`.

### 3. Apply highlights

Copy the exact HTML (including all tags, whitespace, newlines) from step 2 into match strings:

```bash
python3 << 'PYEOF'
c = open('/path/to/file.html',encoding='utf-8').read()
highlights = [
    'plain text phrase',
    '<b><span>Text with embedded tags</span></b>',
    'Goldman Sachs, a bank, forecasts that high-end manufacturing will reliably contribute about one percentage point of annual real\n                                                              <small>\n                                                                GDP\n                                                              </small>\n                                                              growth until 2029.',
]
for t in highlights:
    if t in c: c = c.replace(t, '<mark>'+t+'</mark>', 1)
    else: # debug: find partial match & print real HTML
        idx = c.find(t[:20])
        if idx>=0: print(f"MISS near: {repr(c[idx:idx+len(t)+50])}")
open('/path/to/file.html','w',encoding='utf-8').write(c)
PYEOF
```

To redo highlights from scratch: `c = c.replace('<mark>','').replace('</mark>','')`

### 4. Verify

```bash
python3 -c "
c = open('/path/to/file.html',encoding='utf-8').read()
m,e = c.count('<mark>'),c.count('</mark>')
print(f'{m} highlights, balanced: {m==e}')
"
```
