#!/usr/bin/env npx tsx
/**
 * Convert a SingleFile HTML snapshot to clean .txt for e-readers.
 *
 * Uses Mozilla's Readability (Firefox Reader Mode) to extract the main
 * article content, then renders it as plain text — stripping all images,
 * navigation, sidebars, ads, and other boilerplate.
 *
 * Usage:  npx tsx convert.ts file.html [--out FILE] [--width N] [--title TITLE] [--url URL]
 */

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
//  HTML → Plain text (headings marked, links shown with URLs)
// ---------------------------------------------------------------------------

function htmlToText(html: string, width: number): string {
  const lines: string[] = [];
  const stack: string[] = [];
  let buf = "";
  let linkHref = "";
  let headingLevel = 0;
  let inPre = false;
  let preBuf = "";
  let olCounters: number[] = [];
  let bqDepth = 0; // blockquote nesting depth

  function flush() {
    let t = buf.trim();
    t = t.replace(/\s+([.,;:!?])/g, "$1");
    if (!t) return;
    if (headingLevel > 0) {
      const prefix = "#".repeat(headingLevel) + " ";
      lines.push(prefix + t);
    } else if (bqDepth > 0) {
      const prefix = "> ".repeat(bqDepth);
      lines.push(prefix + t);
    } else {
      lines.push(t);
    }
    buf = "";
  }

  const re = /<(\/?)(\w+)[^>]*>|([^<]+)/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (m[3] !== undefined) {
      const text = m[3]
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_s: string, n: string) =>
          String.fromCodePoint(parseInt(n, 10))
        )
        .replace(/\s+/g, " ")
        .trim();
      if (inPre) {
        preBuf += m[3];
      } else if (text) {
        buf += (buf ? " " : "") + text;
      }
      continue;
    }

    const isEnd = m[1] === "/";
    const tag = m[2].toLowerCase();

    if (tag === "pre" && !isEnd) {
      inPre = true;
      preBuf = "";
      stack.push("pre");
      continue;
    }
    if (tag === "pre" && isEnd) {
      inPre = false;
      const t = preBuf.replace(/^\n+|\n+$/g, "");
      if (t) {
        for (const line of t.split("\n")) {
          lines.push("  " + line);
        }
        lines.push("");
      }
      preBuf = "";
      const idx = stack.lastIndexOf("pre");
      if (idx !== -1) stack.length = idx;
      continue;
    }

    if (inPre) {
      preBuf += m[0];
      continue;
    }

    if (isEnd) {
      if (tag === "a" && linkHref) {
        if (buf.trim()) {
          const cleanUrl = linkHref.replace(/ /g, "");
          if (cleanUrl) buf += ` [${cleanUrl}]`;
        }
        linkHref = "";
      }

      if (tag === "ol") {
        olCounters.pop();
      }

      if (tag === "li") {
        const text = buf.trim();
        buf = "";
        if (text) {
          const isOrdered =
            olCounters.length > 0 && olCounters[olCounters.length - 1] > 0;
          if (isOrdered) {
            const n = olCounters[olCounters.length - 1];
            olCounters[olCounters.length - 1]++;
            const prefix = "> ".repeat(bqDepth);
            const line = `${prefix}${n}. ${text}`;
            if (width > 0 && line.length > width) {
              wrapText(line, width, 3, lines);
            } else {
              lines.push(line);
            }
          } else {
            const prefix = "> ".repeat(bqDepth);
            const line = `${prefix}• ${text}`;
            if (width > 0 && line.length > width) {
              wrapText(line, width, 2, lines);
            } else {
              lines.push(line);
            }
          }
        }
        const idx = stack.lastIndexOf("li");
        if (idx !== -1) stack.length = idx;
        continue;
      }

      if (tag === "blockquote") {
        bqDepth = Math.max(0, bqDepth - 1);
        headingLevel = 0; // prevent stale heading level from leaking in
        const idx = stack.lastIndexOf("blockquote");
        if (idx !== -1) stack.length = idx;
        flush();
        continue;
      }

      const idx = stack.lastIndexOf(tag);
      if (idx !== -1) {
        for (let i = stack.length - 1; i >= idx; i--) {
          const t = stack[i];
          if (t.startsWith("h") || t === "p") {
            headingLevel = t.startsWith("h") ? parseInt(t[1]) : 0;
            flush();
            lines.push("");
            headingLevel = 0;
          }
        }
        stack.length = idx;
      }
      continue;
    }

    // Opening tag
    if (tag === "a") {
      const hrefMatch = m[0].match(/href\s*=\s*["']([^"']+)["']/i);
      linkHref = hrefMatch ? hrefMatch[1] : "";
    }
    if (tag === "h1") headingLevel = 1;
    else if (tag === "h2") headingLevel = 2;
    else if (tag === "h3") headingLevel = 3;
    else if (tag === "h4") headingLevel = 4;
    if (tag === "ol") {
      olCounters.push(1); // start counting at 1
    }
    if (tag === "blockquote") {
      bqDepth++;
    }

    stack.push(tag);
    if (tag === "br") {
      flush();
    } else if (tag === "hr") {
      flush();
      lines.push("─".repeat(40));
    }
  }

  flush();

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  while (lines.length > 0 && lines[0] === "") lines.shift();

  return lines.join("\n");
}

function wrapText(
  text: string,
  width: number,
  indent: number,
  out: string[]
): void {
  const prefix = " ".repeat(indent);
  let line: string[] = [];
  let col = 0;
  for (const word of text.split(" ")) {
    if (col + word.length + (line.length ? 1 : 0) > width - indent) {
      out.push(prefix + line.join(" "));
      line = [word];
      col = word.length;
    } else {
      line.push(word);
      col += word.length + (line.length > 1 ? 1 : 0);
    }
  }
  if (line.length) out.push(prefix + line.join(" "));
}

// ---------------------------------------------------------------------------
//  Main conversion
// ---------------------------------------------------------------------------

export interface ConvertOptions {
  outPath?: string;
  width?: number;
  title?: string;
  url?: string;
  tags?: string[];
}

export function convert(htmlPath: string, options?: ConvertOptions): string {
  const raw = fs.readFileSync(htmlPath, "utf-8");
  const width = options?.width ?? 80;
  const outPath =
    options?.outPath ?? htmlPath.replace(/\.html$/i, "") + ".txt";

  // Phase 1: extract readable content via Mozilla Readability
  const dom = new JSDOM(raw, { url: "https://example.com" });
  const reader = new Readability(dom.window.document, {
    charThreshold: 150,
  });
  const article = reader.parse();

  let contentHtml: string;
  if (article?.content) {
    contentHtml = article.content;
  } else {
    const body = dom.window.document.body;
    contentHtml = body ? body.innerHTML : raw;
  }

  // Strip remaining image/embed elements
  contentHtml = contentHtml
    .replace(/<img[^>]*>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, "")
    .replace(/<video[\s\S]*?<\/video>/gi, "")
    .replace(/<audio[\s\S]*?<\/audio>/gi, "");

  const text = htmlToText(contentHtml, width);

  // Prepend the article title as # heading (from options or Readability)
  const heading = options?.title || article?.title || "";
  const headingLine = heading ? `# ${heading}` : "";

  // Post-process: remove common boilerplate lines
  const boilerplate = [
    /^this site uses cookies/i,
    /^cookie policy/i,
    /^privacy policy/i,
    /^terms (of service|of use|conditions)/i,
    /^all rights reserved/i,
    /^©\s*\d{4}/i,
    /^subscribe now/i,
    /^sign up (for|to)/i,
    /^click to (read more|continue)/i,
    /^\x20{0,2}•\x20{0,2}$/,
  ];
  const cleanLines = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return !boilerplate.some((re) => re.test(trimmed));
  });

  let cleaned = cleanLines.join("\n");

  // Build leading content: frontmatter then # heading
  const leading: string[] = [];
  if (options?.title) leading.push(`Title: ${options.title}`);
  if (options?.url) leading.push(`URL: ${options.url}`);
  if (options?.tags && options.tags.length > 0) {
    leading.push(`Tags: ${options.tags.join(", ")}`);
  }
  if (headingLine) {
    if (leading.length > 0) leading.push(""); // blank line before heading
    leading.push(headingLine);
  }
  if (leading.length > 0) {
    cleaned = leading.join("\n") + "\n\n" + cleaned;
  }

  fs.writeFileSync(outPath, cleaned + "\n", "utf-8");
  return outPath;
}

// ---------------------------------------------------------------------------
//  CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  let htmlFile: string | undefined;
  let outFile: string | undefined;
  let width = 80;
  let title: string | undefined;
  let url: string | undefined;
  let tags: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && i + 1 < args.length) {
      outFile = args[++i];
    } else if (args[i] === "--width" && i + 1 < args.length) {
      width = parseInt(args[++i], 10) || 80;
    } else if (args[i] === "--title" && i + 1 < args.length) {
      title = args[++i];
    } else if (args[i] === "--url" && i + 1 < args.length) {
      url = args[++i];
    } else if (args[i] === "--tags" && i + 1 < args.length) {
      tags = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (!args[i].startsWith("--")) {
      htmlFile = args[i];
    }
  }

  if (!htmlFile) {
    console.error("Usage: npx tsx convert.ts file.html [--out FILE] [--width N] [--title TITLE] [--url URL] [--tags TAG1,TAG2]");
    process.exit(1);
  }

  if (!fs.existsSync(htmlFile)) {
    console.error(`Error: file not found: ${htmlFile}`);
    process.exit(1);
  }

  const out = convert(htmlFile, { outPath: outFile, width, title, url, tags });
  console.log(`Written: ${out}`);
}

if (process.argv[1]?.endsWith("convert.ts")) {
  main();
}
