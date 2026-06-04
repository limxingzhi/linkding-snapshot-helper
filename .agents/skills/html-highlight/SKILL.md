---
name: html-highlight
description: Highlight specific phrases or passages in an HTML file using `<mark>` tags. Use when user wants to mark up important bits, key quotes, or notable passages in a saved HTML page.
user-invocable: true
---

# HTML Highlight

Highlight text passages in an HTML file by wrapping them in `<mark>` tags.

## Calibrate First

**What NOT to highlight:**
- ❌ Isolated keywords: `million lines of code`, `Ralph Wiggum Loop`, `OpenTelemetry`
- ❌ Narrative setup: `Over the past five months`, `The first commit to an empty repository`
- ❌ Conjunctions or transitions: `However`, `But`, `At the same time`

**What TO highlight:** full phrases that carry a meaningful concept or claim, wrapped with enough context that a reader skimming the highlights gets the complete idea without reading the surrounding sentence.

**Examples** (from a Codex article):

| Do this ✅ | Not this ❌ |
|---|---|
| `"the repository contains on the order of a million lines of code"` | `million lines of code` |
| `"average throughput of 3.5 PRs per engineer per day"` | `3.5 PRs` |
| `"single Codex runs work on a single task for upwards of six hours (often while the humans are sleeping)"` | `six hours` |
| `"give Codex a map, not a 1,000-page instruction manual"` | `map, not a 1,000-page instruction manual` |
| `"It rots instantly. A monolithic manual turns into a graveyard of stale rules"` | `rots instantly` |
| `"wired the Chrome DevTools Protocol into the agent runtime and created skills for working with DOM snapshots, screenshots, and navigation"` | `Chrome DevTools Protocol` |
| `"anything it can't access in-context while running effectively doesn't exist"` | `in-context` |
| `"technical debt is like a high-interest loan: it's almost always better to pay it down continuously in small increments"` | `high-interest loan` |

**The test:** if someone skims only the highlighted passages, do they get the key concepts and claims? Or do they just see a list of terms they already recognize? If the latter, wrap more context.

## Workflow

### 0. Prettify HTML first

SingleFile saves minified HTML (one massive line). Prettify to make the structure grep-friendly with predictable line breaks:

```bash
python3 << 'PYEOF'
from html.parser import HTMLParser
import re

class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.lines = []
        self.ind = 0
        self._pre = False
        self._textbuf = ''
    def _flush_text(self):
        t = self._textbuf.strip()
        if t: self.lines.append('  ' * self.ind + t)
        self._textbuf = ''
    def handle_starttag(self, tag, attrs):
        self._flush_text()
        if tag in ('pre','code','script','style'):
            self._pre = True
            self.lines.append('  ' * self.ind + self.get_starttag_text())
            return
        void = tag in ('br','hr','img','input','meta','link','area','base','col','embed','source','track','wbr')
        self.lines.append('  ' * self.ind + self.get_starttag_text())
        if not void: self.ind += 1
    def handle_endtag(self, tag):
        self._flush_text()
        if tag in ('pre','code','script','style'):
            self._pre = False
            self.lines.append(f'</{tag}>')
            return
        self.ind = max(0, self.ind - 1)
        self.lines.append('  ' * self.ind + f'</{tag}>')
    def handle_data(self, data):
        if self._pre:
            self.lines.append(data)
        else:
            self._textbuf += data
    def handle_entityref(self, name): self._textbuf += f'&{name};'
    def handle_charref(self, name): self._textbuf += f'&#{name};'

with open('FILE.html', 'rb') as f:
    raw = f.read()
decoded = raw.decode('utf-8', errors='replace')
p = P()
p.feed(decoded)
p._flush_text()
with open('FILE.html', 'w', encoding='utf-8') as f:
    f.write('\n'.join(p.lines))
print('Prettified ✓')
PYEOF
```

Now highlight phrases are on predictable single lines, so you can grep with line context:

```bash
grep -n 'million lines of code' FILE.html
# → 3423:    <p class="mb-sm last:mb-0">repository contains on the order of a million lines of code</p>
```

### 1. Discover paragraph structure

Every site structures paragraphs differently. Probe first:

```bash
python3 << 'PYEOF'
import re
with open('/path/to/file.html', 'r', encoding='utf-8') as f:
    c = f.read()
for i, m in enumerate(re.finditer(r'<p[^>]*>', c)):
    tag = m.group()
    end = c.find('</p>', m.end())
    text = re.sub(r'<[^>]+>', '', c[m.end():end])
    text = re.sub(r'\s+', ' ', text).strip()[:150]
    print(f"P{i}: {tag[:100]}\n   {text}\n")
    if i > 25: break
PYEOF
```

### 2. Extract paragraphs

```bash
python3 << 'PYEOF'
import re
with open('/path/to/file.html', 'r', encoding='utf-8') as f:
    content = f.read()

PATTERN = '<p class="mb-sm last:mb-0">'  # adjust per step 1

positions, start = [], 0
while (pos := content.find(PATTERN, start)) != -1:
    positions.append(pos); start = pos + 1

for i, pos in enumerate(positions):
    end = positions[i+1] if i+1 < len(positions) else content.find('</p>', pos)
    text = re.sub(r'<[^>]+>', '', content[pos+len(PATTERN):end])
    text = re.sub(r'\s+', ' ', text.replace('&nbsp;', '')).strip()
    print(f"===== PARA {i} =====\n{text}\n")
PYEOF
```

### 3. Apply highlights

Include any embedded HTML tags in the match string.

```bash
python3 << 'PYEOF'
with open('/path/to/file.html', 'r', encoding='utf-8') as f:
    content = f.read()

highlights = [
    # Plain text — match the full concept-carrying phrase
    'repository contains on the order of a million lines of code',
    # Text with embedded tags — include them
    '<b><span>Context is a scarce resource.</span></b><span> A giant instruction file crowds out the task, the code, and the relevant docs',
    # Curly quotes: “ ... ”
    '“what capability is missing, and how do we make it both legible and enforceable for the agent?”',
]

for target in highlights:
    if target in content:
        content = content.replace(target, '<mark>' + target + '</mark>', 1)

with open('/path/to/file.html', 'w', encoding='utf-8') as f:
    f.write(content)
PYEOF
```

### 4. Verify

```bash
python3 -c "
c = open('/path/to/file.html', 'r', encoding='utf-8').read()
m, e = c.count('<mark>'), c.count('</mark>')
print(f'{m} highlights, matched: {m == e}')
"
```

## Common Gotchas

| Problem | Fix |
|---------|------|
| **Text not found** — HTML tags embedded inside | Search partial text with `content.find()` and print surrounding characters to see real structure |
| **Curly quotes** | Copy-paste the actual character into the string; Python handles them natively in text mode |
| **Em dashes** | `—` — same as above |
| **Links in text** | Include `<a>` / `<u>` tags in the highlight string |
| **Multiple occurrences** | `replace(..., 1)` replaces only first |
| **Re-doing highlights** | Strip first: `content.replace('<mark>','').replace('</mark>','')` |
| **Soft hyphens** | `\u00ad` — strip during extraction or search with character code |
