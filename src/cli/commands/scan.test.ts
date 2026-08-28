import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseMaxCandidates, DEFAULT_MAX_CANDIDATES } from "./scan.js";

describe("parseMaxCandidates", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // out.warn goes through console.log; silence it so test output stays clean.
    warn = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("defaults when the flag is absent", () => {
    expect(parseMaxCandidates(undefined)).toBe(DEFAULT_MAX_CANDIDATES);
    expect(parseMaxCandidates("")).toBe(DEFAULT_MAX_CANDIDATES);
    expect(parseMaxCandidates(null)).toBe(DEFAULT_MAX_CANDIDATES);
  });

  it("accepts a positive count", () => {
    expect(parseMaxCandidates("3")).toBe(3);
    expect(parseMaxCandidates("20")).toBe(20);
  });

  it("treats 0 as no cap", () => {
    expect(parseMaxCandidates("0")).toBeUndefined();
  });

  it("floors a fractional value", () => {
    expect(parseMaxCandidates("2.9")).toBe(2);
  });

  it("falls back to the default on nonsense, rather than capping at zero", () => {
    // Returning undefined here would silently remove the cap; returning 0
    // would apply nothing at all. Neither is what a typo meant.
    expect(parseMaxCandidates("abc")).toBe(DEFAULT_MAX_CANDIDATES);
    expect(parseMaxCandidates("-5")).toBe(DEFAULT_MAX_CANDIDATES);
    expect(parseMaxCandidates("Infinity")).toBe(DEFAULT_MAX_CANDIDATES);
  });

  it("says so when it rejects a value", () => {
    parseMaxCandidates("abc");

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain("--max-candidates");
  });
});
