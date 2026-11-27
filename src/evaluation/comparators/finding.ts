import type { FindingDecision } from "../../contracts/result";

export type Comparison = FindingDecision;

export function finding(decision: Comparison): Comparison {
  return Object.freeze(decision);
}

export const PASSED = finding({ outcome: "pass", reasonCode: "MATCH" });
export const FAILED = finding({ outcome: "fail", reasonCode: "VALUE_MISMATCH" });
export const REFERENCE_UNAVAILABLE = finding({
  outcome: "inconclusive",
  reasonCode: "REFERENCE_UNAVAILABLE",
});
export const MISSING_EVIDENCE = finding({
  outcome: "inconclusive",
  reasonCode: "EVIDENCE_MISSING",
});
export const TRUNCATED_EVIDENCE = finding({
  outcome: "inconclusive",
  reasonCode: "EVIDENCE_TRUNCATED",
});
