#!/usr/bin/env npx tsx
/**
 * Convert a SingleFile HTML snapshot to clean .txt for e-readers.
 *
 * Uses Mozilla's Readability (Firefox Reader Mode) to extract the main
 * article content, then renders it as plain text — stripping all images,
 * navigation, sidebars, ads, and other boilerplate.
 *
 * Usage:  npx tsx convert.ts file.html [--out FILE] [--width N]
 */

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
//  HTML → Plain text (preserves paragraphs, headings, lists, blockquotes)
// ---------------------------------------------------------------------------

function htmlToText(html: string, width: number): string {
  const lines: string[] = [];
  const stack: string[] = [];
  let buf = "";

  function flush() {
    let t = buf.trim();
    // Clean up spaces before punctuation (artifacts from stripped inline tags)
    t = t.replace(/\s+([.,;:!?])/g, "$1");
    if (t) lines.push(t);
    buf = "";
  }

  // Tokenize via regex: opening tags, closing tags, text
  const re = /<(\/?)(\w+)[^>]*>|([^<]+)/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (m[3] !== undefined) {
      // Text content
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
      if (text) buf += (buf ? " " : "") + text;
      continue;
    }

    const isEnd = m[1] === "/";
    const tag = m[2].toLowerCase();

    if (isEnd) {
      const idx = stack.lastIndexOf(tag);
      if (idx !== -1) {
        // Pop the tag and process block-level formatting
        for (let i = stack.length - 1; i >= idx; i--) {
          const t = stack[i];
          if (t === "li") {
            flush();
            const text = buf.trim();
            buf = "";
            if (text) {
              const line = `• ${text}`;
              if (width > 0 && line.length > width) {
                wrapText(line, width, 2, lines);
              } else {
                lines.push(line);
              }
            }
          } else if (t === "p" || t.startsWith("h") || t === "blockquote") {
            flush();
            lines.push("");
          }
          // else inline tags: just pop, text stays in buf
        }
        stack.length = idx;
      }
    } else {
      stack.push(tag);
      if (tag === "br") {
        flush();
      } else if (tag === "hr") {
        flush();
        lines.push("─".repeat(40));
      }
    }
  }

  flush();

  // Trim trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  // Trim leading blank lines
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

export function convert(
  htmlPath: string,
  options?: { outPath?: string; width?: number }
): string {
  const raw = fs.readFileSync(htmlPath, "utf-8");
  const width = options?.width ?? 80;
  const outPath =
    options?.outPath ?? htmlPath.replace(/\.html$/i, "") + ".txt";

  // Phase 1: extract readable content via Mozilla Readability
  // Use a strict threshold to minimise boilerplate bleeding through
  const dom = new JSDOM(raw, { url: "https://example.com" });
  const reader = new Readability(dom.window.document, {
    charThreshold: 150,
  });
  const article = reader.parse();

  let contentHtml: string;
  if (article?.content) {
    contentHtml = article.content;
  } else {
    // Fallback: use body content
    const body = dom.window.document.body;
    contentHtml = body ? body.innerHTML : raw;
  }

  // Strip remaining image/embed elements readability may leave
  contentHtml = contentHtml
    .replace(/<img[^>]*>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, "")
    .replace(/<video[\s\S]*?<\/video>/gi, "")
    .replace(/<audio[\s\S]*?<\/audio>/gi, "");

  const text = htmlToText(contentHtml, width);

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
    /^\x20{0,2}•\x20{0,2}$/,  // lone bullet point
  ];
  const cleanLines = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines
    return !boilerplate.some((re) => re.test(trimmed));
  });

  const cleaned = cleanLines.join("\n");

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

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && i + 1 < args.length) {
      outFile = args[++i];
    } else if (args[i] === "--width" && i + 1 < args.length) {
      width = parseInt(args[++i], 10) || 80;
    } else if (!args[i].startsWith("--")) {
      htmlFile = args[i];
    }
  }

  if (!htmlFile) {
    console.error("Usage: npx tsx convert.ts file.html [--out FILE] [--width N]");
    process.exit(1);
  }

  if (!fs.existsSync(htmlFile)) {
    console.error(`Error: file not found: ${htmlFile}`);
    process.exit(1);
  }

  const out = convert(htmlFile, { outPath: outFile, width });
  console.log(`Written: ${out}`);
}

if (process.argv[1]?.endsWith("convert.ts")) {
  main();
}
