import { createHash } from "node:crypto";

export type BranchInput = {
  candidateIds: string[];
  date?: Date;
};

export function buildBranchName({ candidateIds, date = new Date() }: BranchInput): string {
  const isoDate = date.toISOString().split("T")[0];
  const sorted = [...candidateIds].sort();
  const hash = createHash("sha1").update(sorted.join("\n")).digest("hex").slice(0, 6);
  return `promote/${isoDate}-${hash}`;
}

export function buildSingleBranchName(candidateId: string, date: Date = new Date()): string {
  const isoDate = date.toISOString().split("T")[0];
  const hash = createHash("sha1").update(candidateId).digest("hex").slice(0, 6);
  return `promote/${candidateId}-${isoDate}-${hash}`;
}
