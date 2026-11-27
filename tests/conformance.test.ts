import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ASSAY_EVALUATOR_VERSION,
  createAssessmentDefinition,
  createEvidenceBundle,
  createReferenceRecord,
  evaluate,
  parseEvaluationResult,
  projectPublicResult,
  type ValidationResult,
} from "../src/index";

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error("Invalid conformance fixture");
  return result.value;
}

const base = { id: "fact", mode: "required", visibility: "public" } as const;
const observation = {
  criterionId: "fact",
  evidenceRef: "observation",
  completeness: "complete",
} as const;

function draft(criteria: readonly unknown[], schemaVersion = 2) {
  return {
    schemaVersion,
    assessmentId: "conformance",
    revision: "v1",
    policyVersion: "all-required-v1",
    criteria,
  };
}

// Independent implementation: ECMAScript's property-list serializer orders
// object names according to the sorted global union, even for integer keys.
// Arrays retain their original order. Node crypto owns the hash computation.
function independentBytes(value: unknown): string {
  const keys = new Set<string>();
  JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      for (const key of Object.keys(item)) keys.add(key);
    }
    return item;
  });
  return JSON.stringify(value, [...keys].sort());
}

function independentDigest(domain: string, value: unknown): string {
  const hash = createHash("sha256").update(domain).update("\n");
  return `sha256:${hash.update(independentBytes(value), "utf8").digest("hex")}`;
}

function compare(criterion: unknown, fact: unknown, matches: boolean): void {
  const definition = unwrap(createAssessmentDefinition(draft([criterion])));
  const evidence = unwrap(
    createEvidenceBundle(definition, {
      schemaVersion: 2,
      observations: [fact],
    }),
  );
  const result = evaluate(definition, evidence);
  const outcome = matches ? "pass" : "fail";
  expect(result).toMatchObject({
    outcome,
    findings: [{ criterionId: "fact", outcome, reasonCode: matches ? "MATCH" : "VALUE_MISMATCH" }],
  });
  expect(parseEvaluationResult(result).ok).toBe(true);
  expect(projectPublicResult(definition, result)).toEqual({
    ok: true,
    value: {
      schemaVersion: 1,
      outcome,
      findings: [{ criterionId: "fact", outcome, reason: matches ? "match" : "mismatch" }],
    },
  });
}

describe("AY-I24 independent conformance, evaluator v0.0.3", () => {
  it("checks the independent serializer's byte ordering before checking generated hashes", () => {
    expect(ASSAY_EVALUATOR_VERSION).toBe("v0.0.3");
    expect(independentBytes({ 2: "two", 10: "ten", z: [-0, "é"], a: { y: 1 } })).toBe(
      '{"10":"ten","2":"two","a":{"y":1},"z":[0,"é"]}',
    );
  });

  it("checks all canonical domains, key permutations and replay with generated values", () => {
    for (let i = 0; i < 24; i++) {
      const text = `é\r\n😀\t"${i}\\`;
      const criterion = {
        ...base,
        kind: "exact_text",
        parameters: { expected: { type: "literal", value: text } },
      };
      for (const schema of [1, 2]) {
        const input = draft([criterion], schema);
        const definition = unwrap(createAssessmentDefinition(input));
        expect(definition.revisionDigest).toBe(
          independentDigest(`assay:definition:v${schema}`, input),
        );
      }

      const value = { 2: i, 10: text, z: [null, -0, i % 2 === 0], a: { é: "e\u0301" } };
      const reordered = { a: value.a, z: value.z, 10: value[10], 2: value[2] };
      const recordDraft = {
        schemaVersion: 2,
        referenceId: "fixture",
        kind: "json",
        value,
      };
      const record = unwrap(createReferenceRecord(recordDraft));
      expect(record.referenceDigest).toBe(independentDigest("assay:reference:v2", recordDraft));
      expect(unwrap(createReferenceRecord({ ...recordDraft, value: reordered }))).toEqual(record);
      const definitionDraft = draft([
        {
          ...base,
          visibility: "restricted",
          kind: "json_equality",
          parameters: {
            expected: {
              type: "reference",
              referenceId: record.referenceId,
              referenceDigest: record.referenceDigest,
            },
          },
        },
      ]);
      const definition = unwrap(createAssessmentDefinition(definitionDraft));
      expect(definition.revisionDigest).toBe(
        independentDigest("assay:definition:v2", definitionDraft),
      );
      const evidenceDraft = {
        schemaVersion: 2,
        observations: [{ ...observation, kind: "json", value: reordered }],
      };
      const evidence = unwrap(createEvidenceBundle(definition, evidenceDraft));
      expect(evidence.evidenceDigest).toBe(
        independentDigest("assay:evidence:v2", {
          ...evidenceDraft,
          definition: {
            assessmentId: definition.assessmentId,
            revision: definition.revision,
            revisionDigest: definition.revisionDigest,
          },
        }),
      );
      const references = {
        schemaVersion: 2,
        definition: evidence.definition,
        references: [record],
      };
      const result = evaluate(definition, evidence, references);
      expect(result).toMatchObject({
        outcome: "pass",
        evidenceDigest: evidence.evidenceDigest,
        evaluator: { id: "assay", version: "v0.0.3" },
        findings: [{ criterionId: "fact", outcome: "pass", reasonCode: "MATCH" }],
      });
      expect(
        JSON.stringify(
          evaluate(
            structuredClone(definition),
            structuredClone(evidence),
            structuredClone(references),
          ),
        ),
      ).toBe(JSON.stringify(result));
      const changed = unwrap(
        createEvidenceBundle(definition, {
          ...evidenceDraft,
          observations: [
            { ...observation, kind: "json", value: { ...value, z: [...value.z].reverse() } },
          ],
        }),
      );
      expect(changed.evidenceDigest).not.toBe(evidence.evidenceDigest);
      expect(evaluate(definition, changed, references).outcome).toBe("fail");
      expect(evaluate(definition, evidence).outcome).toBe("inconclusive");
      expect(
        evaluate(definition, { ...evidence, evidenceDigest: changed.evidenceDigest }).outcome,
      ).toBe("invalid_evidence");
    }
  });

  it("checks integer tolerance boundaries with exactly representable arithmetic", () => {
    for (let expected = -16; expected <= 16; expected += 2) {
      const bound = Math.max(2, Math.abs(expected) / 2);
      const criterion = {
        ...base,
        kind: "number_with_tolerance",
        parameters: {
          expected: { type: "literal", value: expected },
          tolerance: { absolute: 2, relative: 0.5 },
          unit: "ms",
        },
      };
      for (const delta of [-bound - 1, -bound, 0, bound, bound + 1]) {
        compare(
          criterion,
          { ...observation, kind: "number", unit: "ms", value: expected + delta },
          delta >= -bound && delta <= bound,
        );
      }
    }
  });

  it("checks every endpoint policy on generated nonempty integer ranges", () => {
    for (const min of [-10, 0, 10]) {
      for (const minInclusive of [true, false]) {
        for (const maxInclusive of [true, false]) {
          const max = min + 2;
          const criterion = {
            ...base,
            kind: "number_range",
            parameters: {
              expected: { type: "literal", value: { min, max, minInclusive, maxInclusive } },
            },
          };
          const outcomes = [false, minInclusive, true, maxInclusive, false];
          for (const [index, value] of [min - 1, min, min + 1, max, max + 1].entries()) {
            compare(criterion, { ...observation, kind: "number", value }, outcomes[index]);
          }
        }
      }
    }
  });

  it("checks all set order and duplicate policies over a finite two-symbol corpus", () => {
    const corpus = [["a"], ["b"], ["a", "a"], ["a", "b"], ["b", "a"], ["b", "b"]];
    for (const order of ["ignore", "preserve"]) {
      for (const duplicates of ["ignore", "respect"]) {
        const signature = (items: readonly string[]) => {
          let sequence = items.filter(
            (item, index) => duplicates === "respect" || items.indexOf(item) === index,
          );
          if (order === "ignore") sequence = sequence.sort();
          return sequence.join(":");
        };
        for (const expected of corpus) {
          const criterion = {
            ...base,
            kind: "set_equivalence",
            parameters: {
              expected: { type: "literal", value: expected },
              itemType: "string",
              order,
              duplicates,
            },
          };
          for (const items of corpus) {
            compare(
              criterion,
              { ...observation, kind: "set", itemType: "string", items },
              signature(items) === signature(expected),
            );
          }
        }
      }
    }
  });

  it("checks boolean truth tables and explicit text normalization transformations", () => {
    for (const expected of [true, false]) {
      for (const value of [true, false]) {
        compare(
          {
            ...base,
            kind: "boolean_equality",
            parameters: { expected: { type: "literal", value: expected } },
          },
          { ...observation, kind: "boolean", value },
          expected === value,
        );
      }
    }
    for (const word of ["CAFÉ", "ÉTÉ", "ÅNGSTRÖM"]) {
      const expected = word.toLowerCase();
      const value = `  ${word.normalize("NFD")}\r\n `;
      compare(
        {
          ...base,
          kind: "normalized_text",
          parameters: {
            expected: { type: "literal", value: expected },
            normalization: {
              lineEndings: "lf",
              unicode: "NFC",
              case: "fold",
              whitespace: "collapse",
              trim: "both",
            },
          },
        },
        { ...observation, kind: "text", value },
        true,
      );
      compare(
        {
          ...base,
          kind: "exact_text",
          parameters: { expected: { type: "literal", value: expected } },
        },
        { ...observation, kind: "text", value },
        false,
      );
    }
  });

  it("checks the binding outcome and advisory isolation against an authored truth table", () => {
    const states = ["pass", "fail", "inconclusive", "error"] as const;
    const table = [
      ["pass", "fail", "inconclusive", "evaluation_error"],
      ["fail", "fail", "fail", "fail"],
      ["inconclusive", "fail", "inconclusive", "evaluation_error"],
      ["evaluation_error", "fail", "evaluation_error", "evaluation_error"],
    ];
    for (const [row, first] of states.entries()) {
      for (const [column, second] of states.entries()) {
        for (const advisory of states) {
          const decisions = [first, second, advisory];
          const criteria = decisions.map((state, i) => ({
            id: `fact-${i}`,
            mode: i === 2 ? "advisory" : "required",
            visibility: "public",
            ...(state === "error"
              ? {
                  kind: "number_with_tolerance",
                  parameters: {
                    expected: { type: "literal", value: Number.MAX_VALUE },
                    tolerance: { absolute: 0, relative: 2 },
                  },
                }
              : {
                  kind: "exact_text",
                  parameters: { expected: { type: "literal", value: "ok" } },
                }),
          }));
          const observations = decisions.flatMap((state, i) => {
            if (state === "inconclusive") return [];
            return [
              {
                criterionId: `fact-${i}`,
                evidenceRef: `obs-${i}`,
                completeness: "complete",
                ...(state === "error"
                  ? { kind: "number", value: Number.MAX_VALUE }
                  : { kind: "text", value: state === "pass" ? "ok" : "wrong" }),
              },
            ];
          });
          const definition = unwrap(createAssessmentDefinition(draft(criteria)));
          const evidence = unwrap(
            createEvidenceBundle(definition, { schemaVersion: 2, observations }),
          );
          const result = evaluate(definition, evidence);
          expect(result).toMatchObject({
            outcome: table[row][column],
            findings: decisions.map((outcome, i) => ({ criterionId: `fact-${i}`, outcome })),
            warnings:
              advisory === "error" || advisory === "inconclusive" ? ["ADVISORY_UNRESOLVED"] : [],
          });
          expect(projectPublicResult(definition, result)).toMatchObject({
            ok: true,
            value: { outcome: table[row][column] },
          });
        }
      }
    }
  });
});
