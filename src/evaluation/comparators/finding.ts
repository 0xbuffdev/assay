import type { FindingOutcome } from "../../contracts/result";

export type Comparison = Readonly<{
  outcome: FindingOutcome;
  reasonCode: string;
}>;

export function finding(outcome: FindingOutcome, reasonCode: string): Comparison {
  return { outcome, reasonCode };
}

export const PASSED = finding("pass", "MATCH");
export const FAILED = finding("fail", "VALUE_MISMATCH");
export const REFERENCE_UNAVAILABLE = finding("inconclusive", "REFERENCE_UNAVAILABLE");
export const MISSING_EVIDENCE = finding("inconclusive", "EVIDENCE_MISSING");
export const TRUNCATED_EVIDENCE = finding("inconclusive", "EVIDENCE_TRUNCATED");
