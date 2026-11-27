import { describe, expect, it } from "vitest";
import {
  CONTRACT_LIMITS,
  createAssessmentDefinition,
  createEvidenceBundle,
  createReferenceRecord,
  evaluate,
  projectPublicResult,
} from "../src/index";

const base = { id: "check", mode: "required", visibility: "public" } as const;
const literal = (value: unknown) => ({ type: "literal", value });
const draft = (kind: string, parameters: unknown, visibility = "public") => ({
  schemaVersion: 2,
  assessmentId: "objective",
  revision: "rev1",
  policyVersion: "all-required-v1",
  criteria: [{ ...base, visibility, kind, parameters }],
});
const fact = (kind: string, value: unknown, completeness = "complete") => ({
  criterionId: "check",
  evidenceRef: "fact",
  completeness,
  kind,
  value,
});
const interval = (min: number, max: number, minInclusive = true, maxInclusive = true) => ({
  min,
  max,
  minInclusive,
  maxInclusive,
});

function compare(kind: string, parameters: unknown, observations: unknown[]) {
  const definition = createAssessmentDefinition(draft(kind, parameters));
  if (!definition.ok) return definition.domain;
  const evidence = createEvidenceBundle(definition.value, { schemaVersion: 2, observations });
  if (!evidence.ok) return evidence.domain;
  return evaluate(definition.value, evidence.value).outcome;
}

describe("schema-2 objective comparators", () => {
  it("compares strict booleans, including false", () => {
    for (const expected of [false, true]) {
      for (const actual of [false, true]) {
        expect(
          compare("boolean_equality", { expected: literal(expected) }, [fact("boolean", actual)]),
        ).toBe(expected === actual ? "pass" : "fail");
      }
    }
    expect(
      compare("boolean_equality", { expected: literal(false) }, [fact("boolean", "false")]),
    ).toBe("invalid_evidence");
  });

  it("checks all endpoint policies without overflow or unit coercion", () => {
    for (const lower of [false, true]) {
      for (const upper of [false, true]) {
        const parameters = { expected: literal(interval(-2, 2, lower, upper)) };
        for (const n of [-3, -2, -1, 0, 1, 2, 3]) {
          const inside = (n > -2 && n < 2) || (n === -2 && lower) || (n === 2 && upper);
          expect(compare("number_range", parameters, [fact("number", n)])).toBe(
            inside ? "pass" : "fail",
          );
        }
      }
    }
    const extremes = { expected: literal(interval(-Number.MAX_VALUE, Number.MAX_VALUE)) };
    expect(compare("number_range", extremes, [fact("number", Number.MAX_VALUE)])).toBe("pass");
    for (const range of [
      interval(2, 1),
      interval(1, 1, false),
      interval(1, 1, true, false),
      interval(0, Infinity),
    ]) {
      expect(compare("number_range", { expected: literal(range) }, [])).toBe("invalid_definition");
    }
    expect(
      compare("number_range", { expected: literal(interval(0, 0)) }, [fact("number", -0)]),
    ).toBe("pass");
    const parameters = { expected: literal(interval(0, 2)), unit: "m" };
    expect(compare("number_range", parameters, [fact("number", 1)])).toBe("invalid_evidence");
    expect(compare("number_range", parameters, [{ ...fact("number", 1), unit: "ft" }])).toBe(
      "invalid_evidence",
    );
    expect(compare("number_range", parameters, [{ ...fact("number", 1), unit: "m" }])).toBe("pass");
  });

  it("compares structured values with exact keys, array order and primitive types", () => {
    const expected = { a: [null, false, -0], b: { x: "é" } };
    const parameters = { expected: literal(expected) };
    expect(
      compare("json_equality", parameters, [fact("json", { b: { x: "é" }, a: [null, false, 0] })]),
    ).toBe("pass");
    for (const value of [
      { a: [false, null, 0], b: { x: "é" } },
      { a: [null, false, 0], b: { x: "e\u0301" } },
      { a: [null, false, "0"], b: { x: "é" } },
      { a: [null, false, 0], B: { x: "é" } },
    ]) {
      expect(compare("json_equality", parameters, [fact("json", value)])).toBe("fail");
    }
    for (const value of [null, false, 0, "", [], {}]) {
      expect(compare("json_equality", { expected: literal(value) }, [fact("json", value)])).toBe(
        "pass",
      );
    }
  });

  it("rejects unsafe and oversized values and never passes incomplete evidence", () => {
    const parameters = { expected: literal(null) };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const oversized = Array.from({ length: CONTRACT_LIMITS.maxArrayLength + 1 }, () => null);
    for (const value of [
      undefined,
      NaN,
      Infinity,
      cycle,
      oversized,
      new Date(),
      JSON.parse('{"__proto__":1}'),
    ]) {
      expect(compare("json_equality", parameters, [fact("json", value)])).toBe("invalid_evidence");
      expect(compare("json_equality", { expected: literal(value) }, [])).toBe("invalid_definition");
    }
    expect(compare("json_equality", parameters, [])).toBe("inconclusive");
    expect(compare("json_equality", parameters, [fact("json", null, "truncated")])).toBe(
      "inconclusive",
    );
    expect(compare("json_equality", parameters, [fact("text", "null")])).toBe("invalid_evidence");
    const legacy = { ...draft("json_equality", parameters), schemaVersion: 1 };
    expect(createAssessmentDefinition(legacy).ok).toBe(false);
  });

  it("compares sealed restricted references without disclosing their values", () => {
    const cases = [
      { kind: "boolean_equality", refKind: "boolean", expected: false, factKind: "boolean", actual: false },
      { kind: "number_range", refKind: "range", expected: interval(-1, 1), factKind: "number", actual: 0 },
      { kind: "json_equality", refKind: "json", expected: null, factKind: "json", actual: null },
      {
        kind: "json_equality",
        refKind: "json",
        expected: { secret: "private-canary" },
        factKind: "json",
        actual: { secret: "private-canary" },
      },
    ];
    for (const test of cases) {
      const reference = createReferenceRecord({
        schemaVersion: 2,
        referenceId: "secret-ref",
        kind: test.refKind,
        value: test.expected,
      });
      if (!reference.ok) throw new Error("Invalid reference fixture");
      const definition = createAssessmentDefinition(
        draft(
          test.kind,
          {
            expected: {
              type: "reference",
              referenceId: reference.value.referenceId,
              referenceDigest: reference.value.referenceDigest,
            },
          },
          "restricted",
        ),
      );
      if (!definition.ok) throw new Error("Invalid definition fixture");
      const evidence = createEvidenceBundle(definition.value, {
        schemaVersion: 2,
        observations: [fact(test.factKind, test.actual)],
      });
      if (!evidence.ok) throw new Error("Invalid evidence fixture");
      const bundle = {
        schemaVersion: 2,
        definition: evidence.value.definition,
        references: [reference.value],
      };
      const result = evaluate(definition.value, evidence.value, bundle);
      expect(result.outcome).toBe("pass");
      expect(evaluate(definition.value, evidence.value)).toMatchObject({ outcome: "inconclusive" });
      const tampered = {
        ...bundle,
        references: [{ ...reference.value, referenceDigest: `sha256:${"0".repeat(64)}` }],
      };
      expect(evaluate(definition.value, evidence.value, tampered).outcome).toBe("invalid_reference");
      expect(projectPublicResult(definition.value, result)).toEqual({
        ok: true,
        value: { schemaVersion: 1, outcome: "withheld", findings: [] },
      });
      expect(JSON.stringify(result)).not.toContain("private-canary");
    }
  });
});
