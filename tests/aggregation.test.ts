import { describe, expect, it } from "vitest";
import { aggregateRequired } from "../src/evaluation/aggregate";
import type { AssessmentDefinition, FindingOutcome } from "../src/index";
import { definition } from "./fixtures/contracts";

const outcomes = ["pass", "fail", "inconclusive", "error"] as const;
const expected = [
  ["pass", "fail", "inconclusive", "evaluation_error"],
  ["fail", "fail", "fail", "fail"],
  ["inconclusive", "fail", "inconclusive", "evaluation_error"],
  ["evaluation_error", "fail", "evaluation_error", "evaluation_error"],
] as const;

const base = definition();
const rubric: AssessmentDefinition = {
  ...base,
  criteria: [
    { ...base.criteria[0], id: "first", mode: "required" },
    { ...base.criteria[0], id: "second", mode: "required" },
    { ...base.criteria[0], id: "advisory", mode: "advisory" },
  ],
};

describe("shared required aggregation", () => {
  it("preserves the full required precedence table regardless of advisory outcome", () => {
    for (const [i, first] of outcomes.entries()) {
      for (const [j, second] of outcomes.entries()) {
        for (const advisory of outcomes) {
          const findings = new Map<string, { outcome: FindingOutcome }>([
            ["first", { outcome: first }],
            ["second", { outcome: second }],
            ["advisory", { outcome: advisory }],
          ]);
          expect(aggregateRequired(rubric, findings)).toBe(expected[i][j]);
        }
      }
    }
  });

  it("preserves the evaluator's conservative treatment of absent required outcomes", () => {
    const passing = new Map<string, { outcome: FindingOutcome }>([
      ["first", { outcome: "pass" }],
    ]);
    const failing = new Map<string, { outcome: FindingOutcome }>([
      ["first", { outcome: "fail" }],
    ]);
    expect(aggregateRequired(rubric, passing)).toBe("inconclusive");
    expect(aggregateRequired(rubric, failing)).toBe("fail");
  });
});
