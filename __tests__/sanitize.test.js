const { sanitize } = require("../sanitize");

describe("sanitize", () => {
  it("returns the title unchanged when already safe", () => {
    expect(sanitize("Hello World")).toBe("Hello World");
  });

  it("strips illegal filename characters", () => {
    expect(sanitize('a<b>c:d"e/f\\g|h?i*j')).toBe("abcdefghij");
  });

  it("collapses whitespace into single spaces", () => {
    expect(sanitize("hello   world\t\nnow")).toBe("hello world now");
  });

  it("strips leading/trailing dots and spaces", () => {
    expect(sanitize(" . hello . ")).toBe("hello");
  });

  it("truncates to 200 characters", () => {
    const long = "a".repeat(300);
    expect(sanitize(long)).toHaveLength(200);
  });

  it("returns 'untitled' for empty/whitespace-only titles", () => {
    expect(sanitize("")).toBe("untitled");
    expect(sanitize("   ")).toBe("untitled");
  });

  it("returns 'untitled' when result is only dots and spaces", () => {
    expect(sanitize("...")).toBe("untitled");
  });
});
