import { describe, expect, it } from "vitest";
import {
  ASSAY_SCHEMA_VERSION,
  CONTRACT_LIMITS,
  inspectEvidenceCoverage,
  parseAssessmentDefinition,
  parseEvaluationResult,
  parseEvidenceBundle,
} from "../src/index";
import { definition, digestB, evidence, result } from "./fixtures/contracts";

type JsonRecord = Record<string, unknown>;
const mutated = <T>(input: T): JsonRecord => structuredClone(input) as JsonRecord;

function errorCodes(input: ReturnType<typeof parseAssessmentDefinition>): string[] {
  return input.ok ? [] : input.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("AY-I01 versioned definition contracts", () => {
  it("has a stable schema and public bounds", () => {
    expect(ASSAY_SCHEMA_VERSION).toBe(1);
    expect(CONTRACT_LIMITS.maxCriteria).toBe(64);
  });

  it("validates all declared comparator shapes without evaluating them", () => {
    const validated = parseAssessmentDefinition(definition());
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.criteria.map((criterion) => criterion.kind)).toEqual([
      "exact_text",
      "normalized_text",
      "number_with_tolerance",
      "set_equivalence",
      "observed_execution",
      "manual_evidence",
    ]);
    expect(Object.isFrozen(validated.value)).toBe(true);
    expect(Object.isFrozen(validated.value.criteria)).toBe(true);
    expect(Object.isFrozen(validated.value.criteria[0])).toBe(true);
    expect(Object.isFrozen(validated.value.criteria[0].parameters)).toBe(true);
  });

  it("treats an empty required set as an invalid definition, never a pass", () => {
    const empty = mutated(definition());
    empty.criteria = [];
    expect(errorCodes(parseAssessmentDefinition(empty))).toContain("EMPTY_REQUIRED_CRITERIA");

    const advisory = mutated(definition());
    advisory.criteria = [
      {
        id: "help",
        kind: "manual_evidence",
        mode: "advisory",
        visibility: "public",
        parameters: { review: "required" },
      },
    ];
    expect(errorCodes(parseAssessmentDefinition(advisory))).toContain("EMPTY_REQUIRED_CRITERIA");
  });

  it("rejects duplicate criterion IDs and unsupported comparator kinds", () => {
    const duplicate = mutated(definition());
    duplicate.criteria = [definition().criteria[0], definition().criteria[0]];
    expect(errorCodes(parseAssessmentDefinition(duplicate))).toContain("DUPLICATE_ID");

    const unknown = mutated(definition());
    unknown.criteria = [{ ...definition().criteria[0], kind: "automatic_grade" }];
    expect(errorCodes(parseAssessmentDefinition(unknown))).toContain("INVALID_VALUE");
  });

  it("rejects unknown schema versions and ambiguous revisions", () => {
    const wrong = mutated(definition());
    wrong.schemaVersion = 3;
    wrong.revision = "latest";
    expect(errorCodes(parseAssessmentDefinition(wrong))).toEqual(
      expect.arrayContaining(["UNSUPPORTED_VERSION", "INVALID_VALUE"]),
    );
  });

  it("requires explicit normalization and numerical policy parameters", () => {
    const noTolerance = mutated(definition());
    noTolerance.criteria = [
      {
        id: "number",
        kind: "number_with_tolerance",
        mode: "required",
        visibility: "public",
        parameters: {
          expected: { type: "literal", value: 1 },
          tolerance: { absolute: 0 },
        },
      },
    ];
    expect(errorCodes(parseAssessmentDefinition(noTolerance))).toContain("MISSING_FIELD");

    const numericString = mutated(noTolerance);
    numericString.criteria = [
      {
        id: "number",
        kind: "number_with_tolerance",
        mode: "required",
        visibility: "public",
        parameters: {
          expected: { type: "literal", value: "1" },
          tolerance: { absolute: 0, relative: 0 },
        },
      },
    ];
    expect(errorCodes(parseAssessmentDefinition(numericString))).toContain("INVALID_VALUE");

    const hiddenTrim = mutated(definition());
    const criteria = structuredClone(definition().criteria);
    const normalized = criteria[1];
    if (normalized.kind !== "normalized_text") throw new Error("fixture");
    (normalized.parameters.normalization as { trim: string }).trim = "sneaky";
    hiddenTrim.criteria = criteria;
    expect(errorCodes(parseAssessmentDefinition(hiddenTrim))).toContain("INVALID_VALUE");
  });

  it("refuses restricted literal expected answers and secret-bearing fields", () => {
    const data = mutated(definition());
    data.criteria = [
      {
        id: "hidden",
        mode: "required",
        kind: "exact_text",
        visibility: "restricted",
        parameters: { expected: { type: "literal", value: "TOPSECRET" } },
      },
    ];
    const checked = parseAssessmentDefinition(data);
    expect(errorCodes(checked)).toContain("RESTRICTED_LITERAL");
    expect(JSON.stringify(checked)).not.toContain("TOPSECRET");
  });

  it("uses explicit digest identities without pretending to authenticate them", () => {
    const a = parseAssessmentDefinition(definition());
    const changed = definition();
    const b = parseAssessmentDefinition({ ...changed, revision: "rev2", revisionDigest: digestB });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.revision).not.toBe(b.value.revision);
      expect(a.value.revisionDigest).not.toBe(b.value.revisionDigest);
    }
    const badDigest = mutated(definition());
    badDigest.revisionDigest = "sha256:bogus";
    expect(errorCodes(parseAssessmentDefinition(badDigest))).toContain("INVALID_VALUE");
  });
});

describe("AY-I01 bounded, safe structural validation", () => {
  it("rejects non-finite values, functions, symbols and unsupported prototypes", () => {
    const values = [Number.NaN, Infinity, -Infinity, () => 1, Symbol("bad"), new Date()];
    for (const value of values) {
      expect(parseEvidenceBundle(value).ok).toBe(false);
    }
    const numeric = evidence();
    const corrupted = {
      ...numeric,
      observations: [{ ...numeric.observations[1], value: Number.NaN }],
    };
    const checked = parseEvidenceBundle(corrupted);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.diagnostics.some((d) => d.code === "UNSAFE_NUMBER")).toBe(true);
  });

  it("rejects dense oversized arrays and large objects before allocating descriptor maps", () => {
    const dense = Array.from({ length: 200_000 }, (_, index) => index);
    const manyFields = Object.fromEntries(
      Array.from({ length: 50_000 }, (_, index) => [`field${index}`, index]),
    );
    const original = Object.getOwnPropertyDescriptors;
    const inputs = new Set<object>([dense, manyFields]);
    const descriptorTargets: object[] = [];

    Object.getOwnPropertyDescriptors = ((value: object) => {
      if (inputs.has(value)) descriptorTargets.push(value);
      return original(value);
    }) as typeof Object.getOwnPropertyDescriptors;

    let oversizedArray: ReturnType<typeof parseEvidenceBundle>;
    let oversizedObject: ReturnType<typeof parseAssessmentDefinition>;
    try {
      oversizedArray = parseEvidenceBundle({ ...evidence(), observations: dense });
      oversizedObject = parseAssessmentDefinition(manyFields);
    } finally {
      Object.getOwnPropertyDescriptors = original;
    }

    expect(oversizedArray.ok).toBe(false);
    if (!oversizedArray.ok) {
      expect(oversizedArray.diagnostics).toContainEqual({
        path: "$.observations",
        code: "TOO_MANY_ITEMS",
      });
    }
    expect(oversizedObject.ok).toBe(false);
    if (!oversizedObject.ok) {
      expect(oversizedObject.diagnostics).toContainEqual({ path: "$", code: "TOO_MANY_ITEMS" });
    }
    expect(descriptorTargets).toEqual([]);
  });

  it("reports schema-known leaf paths but never discloses unknown keys", () => {
    const root = mutated(definition());
    root.revisionDigest = Number.NaN;
    const invalidRoot = parseAssessmentDefinition(root);
    expect(invalidRoot.ok).toBe(false);
    if (!invalidRoot.ok) {
      expect(invalidRoot.diagnostics).toContainEqual({
        path: "$.revisionDigest",
        code: "UNSAFE_NUMBER",
      });
    }

    const nested = mutated(definition());
    const criteria = nested.criteria as JsonRecord[];
    const parameters = criteria[0].parameters as JsonRecord;
    const expected = parameters.expected as JsonRecord;
    expected.value = Number.NaN;
    const invalidNested = parseAssessmentDefinition(nested);
    expect(invalidNested.ok).toBe(false);
    if (!invalidNested.ok) {
      expect(invalidNested.diagnostics).toContainEqual({
        path: "$.criteria[0].parameters.expected.value",
        code: "UNSAFE_NUMBER",
      });
    }

    const unknown = mutated(definition());
    unknown.SECRET_CUSTOM_FIELD = { NEVER_ECHO_THIS_NESTED_KEY: Number.NaN };
    const invalidUnknown = parseAssessmentDefinition(unknown);
    expect(invalidUnknown.ok).toBe(false);
    expect(JSON.stringify(invalidUnknown)).not.toContain("SECRET_CUSTOM_FIELD");
    expect(JSON.stringify(invalidUnknown)).not.toContain("NEVER_ECHO_THIS_NESTED_KEY");
    if (!invalidUnknown.ok) {
      expect(invalidUnknown.diagnostics).toContainEqual({ path: "$", code: "UNSAFE_NUMBER" });
    }
  });

  it("rejects getters without executing them", () => {
    let calls = 0;
    const object = definition() as unknown as JsonRecord;
    Object.defineProperty(object, "unsafe", {
      enumerable: true,
      get: () => {
        calls++;
        return "secret";
      },
    });
    const r = parseAssessmentDefinition(object);
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
    if (!r.ok) expect(r.diagnostics.some((d) => d.code === "UNSAFE_OBJECT")).toBe(true);
  });

  it("rejects cycles, sparse arrays and prototype pollution", () => {
    const cyc: JsonRecord = Object.create(null) as JsonRecord;
    cyc.loop = cyc;
    expect(parseAssessmentDefinition(cyc).ok).toBe(false);

    const sparse = mutated(definition());
    sparse.criteria = new Array(3);
    expect(parseAssessmentDefinition(sparse).ok).toBe(false);

    const polluted = JSON.parse('{"schemaVersion":1,"constructor":{"x":1}}') as unknown;
    const x = parseAssessmentDefinition(polluted);
    expect(x.ok).toBe(false);
    if (!x.ok) expect(x.diagnostics[0].code).toBe("UNSAFE_KEY");
  });

  it("caps deep nesting, oversized text, arrays and diagnostic count", () => {
    const huge = mutated(definition());
    huge.assessmentId = "A".repeat(CONTRACT_LIMITS.maxStringLength + 1);
    expect(errorCodes(parseAssessmentDefinition(huge))).toContain("INPUT_TOO_LARGE");

    const tooMany = mutated(definition());
    tooMany.criteria = Array.from({ length: CONTRACT_LIMITS.maxCriteria + 1 }, (_, i) => ({
      ...definition().criteria[0],
      id: `criterion${i}`,
    }));
    expect(errorCodes(parseAssessmentDefinition(tooMany))).toContain("TOO_MANY_ITEMS");

    let deep: unknown = "end";
    for (let i = 0; i < CONTRACT_LIMITS.maxDepth + 2; i++) deep = { next: deep };
    expect(errorCodes(parseAssessmentDefinition(deep))).toContain("INPUT_TOO_DEEP");
  });

  it("produces deterministic bounded paths without echoing arbitrary field names", () => {
    const invalid = mutated(definition());
    invalid.CONFIDENTIAL_REFERENCE_DO_NOT_LOG = "value";
    const a = parseAssessmentDefinition(invalid);
    const b = parseAssessmentDefinition(invalid);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toContain("CONFIDENTIAL_REFERENCE_DO_NOT_LOG");
    expect(errorCodes(a)).toContain("UNEXPECTED_FIELD");
  });
});

describe("AY-I01 evidence structure and coverage", () => {
  it("accepts missing and truncated evidence as structurally valid but unresolved", () => {
    const parsed = parseEvidenceBundle(evidence());
    expect(parsed.ok).toBe(true);

    const coverage = inspectEvidenceCoverage(definition(), evidence());
    expect(coverage.ok).toBe(true);
    if (coverage.ok) {
      expect(coverage.value.missingRequired).toEqual([]);
      expect(coverage.value.incompleteRequired).toEqual(["quantity"]);
    }

    const missing = inspectEvidenceCoverage(definition(), { ...evidence(), observations: [] });
    expect(missing.ok).toBe(true);
    if (missing.ok) {
      expect(missing.value.missingRequired).toEqual(["output", "quantity"]);
      expect(missing.value.incompleteRequired).toEqual([]);
    }
  });

  it("marks incomplete execution assertions and missing manual artifacts unresolved", () => {
    const withRequiredReview = {
      ...definition(),
      criteria: definition().criteria.map((criterion) =>
        criterion.kind === "observed_execution" || criterion.kind === "manual_evidence"
          ? { ...criterion, mode: "required" as const }
          : criterion,
      ),
    };
    const incomplete = {
      ...evidence(),
      observations: [
        ...evidence().observations,
        {
          criterionId: "report",
          evidenceRef: "manual-empty",
          kind: "manual",
          completeness: "complete",
          artifactRefs: [],
        },
      ],
    };
    const coverage = inspectEvidenceCoverage(withRequiredReview, incomplete);
    expect(coverage.ok).toBe(true);
    if (coverage.ok) {
      expect(coverage.value.missingRequired).toEqual([]);
      expect(coverage.value.incompleteRequired).toEqual(["quantity", "program", "report"]);
    }
  });

  it("rejects forged trusted flags, extra answer keys and inconsistent observations", () => {
    const input = mutated(evidence());
    input.observations = [
      {
        criterionId: "output",
        evidenceRef: "ev1",
        kind: "text",
        completeness: "complete",
        value: "42",
        trusted: true,
        expectedOutput: "TOPSECRET",
      },
    ];
    const r = parseEvidenceBundle(input);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("TOPSECRET");

    const bad = inspectEvidenceCoverage(definition(), {
      ...evidence(),
      observations: [
        {
          criterionId: "output",
          evidenceRef: "e",
          completeness: "complete",
          kind: "number",
          value: 42,
        },
      ],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.diagnostics.some((d) => d.code === "MISMATCHED_OBSERVATION")).toBe(true);
  });

  it("rejects wrong definition lineage, unknown criteria and duplicate observations", () => {
    const wrong = inspectEvidenceCoverage(definition(), {
      ...evidence(),
      definition: { ...evidence().definition, revisionDigest: digestB },
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok)
      expect(wrong.diagnostics.some((d) => d.code === "MISMATCHED_DEFINITION")).toBe(true);

    const unknown = inspectEvidenceCoverage(definition(), {
      ...evidence(),
      observations: [
        {
          kind: "text",
          criterionId: "bogus",
          evidenceRef: "e1",
          completeness: "complete",
          value: "x",
        },
      ],
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok)
      expect(unknown.diagnostics.some((d) => d.code === "UNKNOWN_CRITERION")).toBe(true);

    const ev = evidence();
    expect(
      parseEvidenceBundle({
        ...ev,
        observations: [ev.observations[0], ev.observations[0]],
      }).ok,
    ).toBe(false);
  });

  it("does not treat a completed execution or submitted manual artifact as correctness", () => {
    const ex = evidence().observations.find((o) => o.kind === "execution");
    expect(ex?.kind).toBe("execution");
    const r = parseEvidenceBundle({
      ...evidence(),
      observations: [
        {
          kind: "manual",
          criterionId: "report",
          evidenceRef: "ev-artifact",
          completeness: "complete",
          artifactRefs: ["written-report"],
        },
        ex,
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect("outcome" in r.value).toBe(false);
  });
});

describe("AY-I01 typed findings", () => {
  it("validates versioned technical finding records without granting grades", () => {
    const r = parseEvaluationResult(result());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.outcome).toBe("inconclusive");
      expect("grade" in r.value).toBe(false);
      expect(Object.isFrozen(r.value.findings)).toBe(true);
    }

    const forged = mutated(result());
    forged.grade = "100%";
    expect(parseEvaluationResult(forged).ok).toBe(false);
    const unknown = mutated(result());
    unknown.outcome = "certified";
    expect(parseEvaluationResult(unknown).ok).toBe(false);
  });

  it("rejects unstructured reason codes and secret-bearing findings", () => {
    const invalid = mutated(result());
    invalid.findings = [
      {
        criterionId: "output",
        outcome: "pass",
        reasonCode: "TOP_SECRET-please-output",
        evidenceRefs: [],
        evaluatorId: "assay",
        evaluatorVersion: "v1",
        explanation: "secret expectation",
      },
    ];
    const r = parseEvaluationResult(invalid);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret expectation");
  });
});
