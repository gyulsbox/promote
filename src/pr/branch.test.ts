import { describe, expect, it } from "vitest";
import { buildBranchName, buildSingleBranchName } from "./branch.js";

describe("buildBranchName", () => {
  const fixedDate = new Date("2026-05-23T09:00:00Z");

  it("is deterministic for the same candidate set", () => {
    const a = buildBranchName({ candidateIds: ["candidate_001", "candidate_007"], date: fixedDate });
    const b = buildBranchName({ candidateIds: ["candidate_001", "candidate_007"], date: fixedDate });
    expect(a).toBe(b);
  });

  it("is order-independent", () => {
    const a = buildBranchName({ candidateIds: ["candidate_007", "candidate_001"], date: fixedDate });
    const b = buildBranchName({ candidateIds: ["candidate_001", "candidate_007"], date: fixedDate });
    expect(a).toBe(b);
  });

  it("differs when candidate set differs", () => {
    const a = buildBranchName({ candidateIds: ["candidate_001"], date: fixedDate });
    const b = buildBranchName({ candidateIds: ["candidate_002"], date: fixedDate });
    expect(a).not.toBe(b);
  });

  it("matches expected format", () => {
    const branch = buildBranchName({ candidateIds: ["candidate_001"], date: fixedDate });
    expect(branch).toMatch(/^promote\/2026-05-23-[0-9a-f]{6}$/);
  });
});

describe("buildSingleBranchName", () => {
  const fixedDate = new Date("2026-05-23T09:00:00Z");

  it("includes the candidate id and date", () => {
    const branch = buildSingleBranchName("candidate_042", fixedDate);
    expect(branch).toMatch(/^promote\/candidate_042-2026-05-23-[0-9a-f]{6}$/);
  });

  it("is deterministic", () => {
    const a = buildSingleBranchName("candidate_042", fixedDate);
    const b = buildSingleBranchName("candidate_042", fixedDate);
    expect(a).toBe(b);
  });
});
