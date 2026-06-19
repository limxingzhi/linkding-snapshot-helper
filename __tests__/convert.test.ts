import fs from "fs";
import path from "path";
import { convert } from "../.agents/skills/html-to-txt/convert";
import { describe, it, expect } from "vitest";

const TMP = path.join(__dirname, "__fixtures__", "convert_tmp");

function html(content: string): string {
  return `<!DOCTYPE html><html><head><title>Article Title</title></head><body><article>${content}</article></body></html>`;
}

describe("html-to-txt converter", () => {
  it("preserves headings with markdown-style markers", () => {
    const file = path.join(TMP, "headings.html");
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(file, html(`
      <h1>Top Heading</h1>
      <p>Intro text.</p>
      <h2>Section One</h2>
      <p>Body text.</p>
      <h3>Sub-section</h3>
      <p>Detail text.</p>
    `));

    const out = convert(file, { title: "Article Title" });
    const text = fs.readFileSync(out, "utf-8");

    expect(text).toContain("# Article Title");
    expect(text).toMatch(/\n## Section One\n/);
    expect(text).toMatch(/\n### Sub-section\n/);

    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("preserves links with URLs", () => {
    const file = path.join(TMP, "links.html");
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(file, html(`
      <p>Visit <a href="https://example.com">Example</a> for more.</p>
      <p>Also check <a href="https://github.com">GitHub</a>.</p>
    `));

    const out = convert(file, { title: "Links", url: "https://example.org/a" });
    const text = fs.readFileSync(out, "utf-8");

    expect(text).toContain("Example [https://example.com/]");
    expect(text).toContain("GitHub [https://github.com/]");

    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("includes frontmatter from options", () => {
    const file = path.join(TMP, "frontmatter.html");
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(file, html(`<p>Content.</p>`));

    const out = convert(file, {
      title: "My Article",
      url: "https://example.com/article",
      tags: ["tag1", "tag2"],
    });
    const text = fs.readFileSync(out, "utf-8");

    expect(text).toMatch(/^Title: My Article\nURL: https:\/\/example\.com\/article\nTags: tag1, tag2\n\n/m);

    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("uses Readability article title as # heading", () => {
    const file = path.join(TMP, "readability-title.html");
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(file, `<!DOCTYPE html><html><head><title>Readability Extracted Title</title></head><body><article><p>Content.</p></article></body></html>`);

    const out = convert(file);
    const text = fs.readFileSync(out, "utf-8");

    expect(text).toMatch(/^# .+/m);

    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("preserves blockquotes with > prefix", () => {
    const file = path.join(TMP, "quotes.html");
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(file, html(`
      <p>Before quote.</p>
      <blockquote><p>A wise saying.</p></blockquote>
      <p>After quote.</p>
    `));

    const out = convert(file, { title: "Quotes" });
    const text = fs.readFileSync(out, "utf-8");

    expect(text).toContain("> A wise saying.");

    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("preserves code blocks with indentation", () => {
    const file = path.join(TMP, "code.html");
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(file, html(`
      <p>Some text.</p>
      <pre><code>const x = 1;
const y = 2;
console.log(x + y);</code></pre>
      <p>More text.</p>
    `));

    const out = convert(file, { title: "Code" });
    const text = fs.readFileSync(out, "utf-8");

    expect(text).toContain("const x = 1;");
    expect(text).toContain("  const y = 2;");

    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("preserves ordered and unordered lists", () => {
    const file = path.join(TMP, "lists.html");
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(file, html(`
      <ul>
        <li>First item</li>
        <li>Second item</li>
      </ul>
      <ol>
        <li>Alpha</li>
        <li>Beta</li>
      </ol>
    `));

    const out = convert(file, { title: "List Test" });
    const text = fs.readFileSync(out, "utf-8");

    expect(text).toContain("• First item");
    expect(text).toContain("• Second item");
    expect(text).toContain("1. Alpha");
    expect(text).toContain("2. Beta");

    fs.rmSync(TMP, { recursive: true, force: true });
  });
});
