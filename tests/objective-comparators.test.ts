import { describe, expect, it } from "vitest";
import {
  CONTRACT_LIMITS,
  collectObservations,
  createEvidenceBundle,
  createReferenceRecord,
  evaluate,
  parseAssessmentDefinition,
  parseEvidenceBundle,
  projectPublicResult,
  verifyReferenceBundle,
} from "../src/index";
import { authorAll, createAllDefinition } from "./fixtures/contracts";

const base = { id: "check", mode: "required", visibility: "public" } as const;
const literal = (value: unknown) => ({ type: "literal", value });
const draft = (kind: string, parameters: unknown, visibility = "public") => ({
  schemaVersion: 4,
  assessmentId: "objective",
  revision: "rev1",
  policyVersion: "composed-required-v1",
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
  const definition = createAllDefinition(draft(kind, parameters));
  if (!definition.ok) return definition.domain;
  const evidence = createEvidenceBundle(definition.value, { schemaVersion: 4, observations });
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
    expect(createAllDefinition(legacy).ok).toBe(false);
  });

  it("compares sealed restricted references without disclosing their values", () => {
    const cases = [
      {
        kind: "boolean_equality",
        refKind: "boolean",
        expected: false,
        factKind: "boolean",
        actual: false,
      },
      {
        kind: "number_range",
        refKind: "range",
        expected: interval(-1, 1),
        factKind: "number",
        actual: 0,
      },
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
        schemaVersion: 4,
        referenceId: "secret-ref",
        kind: test.refKind,
        value: test.expected,
      });
      if (!reference.ok) throw new Error("Invalid reference fixture");
      const definition = createAllDefinition(
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
        schemaVersion: 4,
        observations: [fact(test.factKind, test.actual)],
      });
      if (!evidence.ok) throw new Error("Invalid evidence fixture");
      const bundle = {
        schemaVersion: 4,
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
      expect(evaluate(definition.value, evidence.value, tampered).outcome).toBe(
        "invalid_reference",
      );
      expect(projectPublicResult(definition.value, result)).toEqual({
        ok: true,
        value: { schemaVersion: 4, outcome: "withheld", findings: [] },
      });
      expect(JSON.stringify(result)).not.toContain("private-canary");
    }
  });
});

describe("AY-I17 integration regressions", () => {
  it("applies the key-length limit to all own structured properties", () => {
    const reference = createReferenceRecord({
      schemaVersion: 4,
      referenceId: "json-ref",
      kind: "json",
      value: null,
    });
    if (!reference.ok) throw new Error("Invalid reference fixture");
    const definition = createAllDefinition(
      draft("json_equality", {
        expected: {
          type: "reference",
          referenceId: reference.value.referenceId,
          referenceDigest: reference.value.referenceDigest,
        },
      }),
    );
    if (!definition.ok) throw new Error("Invalid definition fixture");
    const evidence = createEvidenceBundle(definition.value, {
      schemaVersion: 4,
      observations: [fact("json", null)],
    });
    if (!evidence.ok) throw new Error("Invalid evidence fixture");

    for (const enumerable of [true, false]) {
      for (const extra of [0, 1]) {
        const name = "k".repeat(CONTRACT_LIMITS.maxStringLength + extra);
        const value = Object.defineProperty({}, name, { value: true, enumerable });
        const authored = draft("json_equality", { expected: literal(value) });
        const parsed = parseAssessmentDefinition({
          ...authorAll(authored),
          revisionDigest: definition.value.revisionDigest,
        });
        const sealed = createAllDefinition(authored);
        const referenceDraft = {
          schemaVersion: 4,
          referenceId: "json-ref",
          kind: "json",
          value,
        };
        const prepared = createEvidenceBundle(definition.value, {
          schemaVersion: 4,
          observations: [fact("json", value)],
        });
        const parsedEvidence = parseEvidenceBundle({
          ...evidence.value,
          observations: [fact("json", value)],
        });
        const createdReference = createReferenceRecord(referenceDraft);
        for (const result of [parsed, sealed, prepared, parsedEvidence, createdReference]) {
          expect(result.ok).toBe(extra === 0);
          if (!result.ok) {
            expect(result.diagnostics).toEqual([
              expect.objectContaining({ code: "INPUT_TOO_LARGE" }),
            ]);
            expect(JSON.stringify(result)).not.toContain(name);
          }
        }
        if (extra === 0) {
          if (!createdReference.ok) throw new Error("Expected accepted boundary key");
          const bound = createAllDefinition(
            draft("json_equality", {
              expected: {
                type: "reference",
                referenceId: createdReference.value.referenceId,
                referenceDigest: createdReference.value.referenceDigest,
              },
            }),
          );
          if (!bound.ok) throw new Error("Invalid bound fixture");
          const bundle = {
            schemaVersion: 4,
            definition: {
              assessmentId: bound.value.assessmentId,
              revision: bound.value.revision,
              revisionDigest: bound.value.revisionDigest,
            },
            references: [createdReference.value],
          };
          expect(verifyReferenceBundle(bound.value, bundle).ok).toBe(true);
        } else {
          const bundle = {
            schemaVersion: 4,
            definition: evidence.value.definition,
            references: [{ ...reference.value, value }],
          };
          expect(verifyReferenceBundle(definition.value, bundle)).toMatchObject({
            ok: false,
            domain: "invalid_reference",
            diagnostics: [{ code: "INPUT_TOO_LARGE" }],
          });
        }
      }
    }
  });

  it("rejects content-bound references with the wrong kind or range unit", () => {
    const records = [
      { kind: "range", value: interval(0, 2), unit: "ft" },
      { kind: "range", value: interval(0, 2) },
      { kind: "number", value: 1, unit: "m" },
    ];
    for (const record of records) {
      const reference = createReferenceRecord({
        schemaVersion: 4,
        referenceId: "quantity",
        ...record,
      });
      if (!reference.ok) throw new Error("Invalid reference fixture");
      const definition = createAllDefinition(
        draft(
          "number_range",
          {
            expected: {
              type: "reference",
              referenceId: reference.value.referenceId,
              referenceDigest: reference.value.referenceDigest,
            },
            unit: "m",
          },
          "restricted",
        ),
      );
      if (!definition.ok) throw new Error("Invalid definition fixture");
      const evidence = createEvidenceBundle(definition.value, {
        schemaVersion: 4,
        observations: [{ ...fact("number", 1), unit: "m" }],
      });
      if (!evidence.ok) throw new Error("Invalid evidence fixture");
      const bundle = {
        schemaVersion: 4,
        definition: evidence.value.definition,
        references: [reference.value],
      };
      const diagnostics = [{ path: "$.references[0]", code: "MISMATCHED_REFERENCE" }];
      expect(verifyReferenceBundle(definition.value, bundle)).toEqual({
        ok: false,
        domain: "invalid_reference",
        diagnostics,
      });
      expect(evaluate(definition.value, evidence.value, bundle)).toEqual({
        outcome: "invalid_reference",
        diagnostics,
      });
    }
  });

  it("collects only public typed facts and rejects invalid or incomplete reports", async () => {
    const reference = createReferenceRecord({
      schemaVersion: 4,
      referenceId: "private-ref",
      kind: "json",
      value: { answer: "private-canary" },
    });
    if (!reference.ok) throw new Error("Invalid reference fixture");
    const definition = createAllDefinition({
      ...draft("boolean_equality", { expected: literal(false) }),
      criteria: [
        {
          ...base,
          id: "flag",
          kind: "boolean_equality",
          parameters: { expected: literal(false) },
        },
        {
          ...base,
          id: "quantity",
          kind: "number_range",
          parameters: { expected: literal(interval(0, 2)), unit: "m" },
        },
        {
          ...base,
          id: "structure",
          kind: "json_equality",
          parameters: { expected: literal({ output: "public-canary" }) },
        },
        {
          ...base,
          id: "hidden",
          mode: "advisory",
          visibility: "restricted",
          kind: "json_equality",
          parameters: {
            expected: {
              type: "reference",
              referenceId: reference.value.referenceId,
              referenceDigest: reference.value.referenceDigest,
            },
          },
        },
      ],
    });
    if (!definition.ok) throw new Error("Invalid definition fixture");
    const evidence = createEvidenceBundle(definition.value, {
      schemaVersion: 4,
      observations: [],
    });
    if (!evidence.ok) throw new Error("Invalid evidence fixture");
    const facts = [
      { ...fact("boolean", false), criterionId: "flag", evidenceRef: "flag-fact" },
      {
        ...fact("number", 1),
        criterionId: "quantity",
        evidenceRef: "range-fact",
        unit: "m",
      },
      {
        ...fact("json", { output: "public-canary" }),
        criterionId: "structure",
        evidenceRef: "json-fact",
      },
    ];
    const provenance = {
      adapterId: "fixture",
      adapterVersion: "v1",
      runRef: "run1",
      toolchainId: "fixture",
      toolchainVersion: "v1",
      capturedStdoutBytes: 0,
      capturedStderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
    };
    const report = {
      schemaVersion: 4,
      definition: evidence.value.definition,
      provenance,
      observations: facts,
    };
    const collected = await collectObservations(definition.value, evidence.value, {
      async observe(request) {
        expect(request).toEqual({
          schemaVersion: 4,
          definition: report.definition,
          criteria: [
            { criterionId: "flag", kind: "boolean" },
            { criterionId: "quantity", kind: "number", unit: "m" },
            { criterionId: "structure", kind: "json" },
          ],
          limits: { maxCapturedBytes: CONTRACT_LIMITS.maxCapturedBytes },
        });
        expect(Object.isFrozen(request)).toBe(true);
        return report;
      },
    });
    if (!collected.ok) throw new Error("Expected valid collection");
    expect(collected.receipt?.evidenceRefs).toEqual(["flag-fact", "range-fact", "json-fact"]);
    expect(evaluate(definition.value, collected.evidence)).toMatchObject({
      outcome: "pass",
      findings: [
        { criterionId: "flag", outcome: "pass" },
        { criterionId: "quantity", outcome: "pass" },
        { criterionId: "structure", outcome: "pass" },
        { criterionId: "hidden", outcome: "inconclusive" },
      ],
    });

    const invalidReports = [
      { ...report, observations: [{ ...facts[0], kind: "text", value: "false" }] },
      { ...report, observations: [{ ...facts[1], unit: "ft" }] },
      { ...report, observations: [{ ...facts[2], criterionId: "hidden" }] },
    ];
    for (const invalid of invalidReports) {
      const rejected = await collectObservations(definition.value, evidence.value, {
        observe: async () => invalid,
      });
      expect(rejected).toMatchObject({ ok: false, outcome: "invalid_evidence" });
    }
    const truncated = await collectObservations(definition.value, evidence.value, {
      observe: async () => ({
        ...report,
        provenance: { ...provenance, stdoutTruncated: true },
      }),
    });
    if (!truncated.ok) throw new Error("Expected bounded truncated collection");
    expect(truncated.evidence.observations.map((item) => item.completeness)).toEqual([
      "truncated",
      "truncated",
      "truncated",
    ]);
    expect(evaluate(definition.value, truncated.evidence)).toMatchObject({
      outcome: "inconclusive",
      findings: [
        { outcome: "inconclusive", reasonCode: "EVIDENCE_TRUNCATED" },
        { outcome: "inconclusive", reasonCode: "EVIDENCE_TRUNCATED" },
        { outcome: "inconclusive", reasonCode: "EVIDENCE_TRUNCATED" },
        { outcome: "inconclusive", reasonCode: "EVIDENCE_MISSING" },
      ],
    });
  });
});
