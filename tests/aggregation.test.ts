import { describe, expect, it } from "vitest";
import { aggregateRequired } from "../src/evaluation/aggregate";
import {
  type AssessmentDefinition,
  createEvidenceBundle,
  evaluate,
  type FindingOutcome,
  parseEvaluationResult,
  projectPublicResult,
} from "../src/index";
import { authorAll, createAllDefinition, definition } from "./fixtures/contracts";

const outcomes = ["pass", "fail", "inconclusive", "error"] as const;
const expected = [
  ["pass", "fail", "inconclusive", "evaluation_error"],
  ["fail", "fail", "fail", "fail"],
  ["inconclusive", "fail", "inconclusive", "evaluation_error"],
  ["evaluation_error", "fail", "evaluation_error", "evaluation_error"],
] as const;

const base = definition();
const rubric: AssessmentDefinition = authorAll({
  ...base,
  criteria: [
    { ...base.criteria[0], id: "first", mode: "required" },
    { ...base.criteria[0], id: "second", mode: "required" },
    { ...base.criteria[0], id: "advisory", mode: "advisory" },
  ],
});

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
    const passing = new Map<string, { outcome: FindingOutcome }>([["first", { outcome: "pass" }]]);
    const failing = new Map<string, { outcome: FindingOutcome }>([["first", { outcome: "fail" }]]);
    expect(aggregateRequired(rubric, passing)).toBe("inconclusive");
    expect(aggregateRequired(rubric, failing)).toBe("fail");
  });
});

// Independent end-to-end truth table. Use concrete comparator inputs rather
// than manufacturing a result from the aggregation function under test.
describe("AY-I16 evaluator and projection policy agreement", () => {
  function input(outcome: FindingOutcome, id: string, mode: "required" | "advisory") {
    const error = outcome === "error";
    return {
      criterion: {
        id,
        mode,
        visibility: "public",
        kind: "number_with_tolerance",
        parameters: {
          expected: { type: "literal", value: error ? 1e308 : 42 },
          tolerance: { absolute: 0, relative: error ? 1e308 : 0 },
        },
      },
      observation: {
        criterionId: id,
        evidenceRef: id,
        kind: "number",
        completeness: outcome === "inconclusive" ? "truncated" : "complete",
        value: outcome === "fail" ? 41 : 42,
      },
    };
  }

  it("agrees for all 64 required/advisory combinations", () => {
    for (const [i, first] of outcomes.entries()) {
      for (const [j, second] of outcomes.entries()) {
        for (const advisory of outcomes) {
          const entries = [
            input(first, "first", "required"),
            input(second, "second", "required"),
            input(advisory, "advisory", "advisory"),
          ];
          const created = createAllDefinition({
            schemaVersion: 4,
            assessmentId: "truth-table",
            revision: "rev1",
            policyVersion: "composed-required-v1",
            criteria: entries.map((entry) => entry.criterion),
          });
          if (!created.ok) throw new Error("Invalid truth table definition");
          const prepared = createEvidenceBundle(created.value, {
            schemaVersion: 4,
            observations: entries.map((entry) => entry.observation),
          });
          if (!prepared.ok) throw new Error("Invalid truth table evidence");
          const result = evaluate(created.value, prepared.value);
          if (!("findings" in result)) throw new Error("Expected complete result");
          expect(result.outcome).toBe(expected[i][j]);
          expect(result.findings.map((finding) => finding.outcome)).toEqual([
            first,
            second,
            advisory,
          ]);
          expect(result.warnings).toEqual(
            advisory === "error" || advisory === "inconclusive" ? ["ADVISORY_UNRESOLVED"] : [],
          );
          expect(parseEvaluationResult(result).ok).toBe(true);
          expect(projectPublicResult(created.value, result)).toMatchObject({
            ok: true,
            value: { outcome: expected[i][j] },
          });
          expect(evaluate(created.value, prepared.value)).toEqual(result);
        }
      }
    }
  });
});
