import { describe, expect, it, vi } from "vitest";
import {
  ASSAY_EVALUATOR_VERSION,
  type AssessmentDefinition,
  type Criterion,
  type EvaluationResponse,
  type EvaluationResult,
  type EvidenceBundle,
  evaluate,
  type Observation,
  parseEvaluationResult,
  type SetScalar,
  type TextNormalization,
} from "../src/index";
import {
  digestB,
  definition as fixtureDefinition,
  evidence as fixtureEvidence,
  referenceOf,
  sealDefinition,
  sealEvidenceFixture,
} from "./fixtures/contracts";

function caseOf(
  criterion: Criterion<1>,
  observation?: Observation,
): [AssessmentDefinition<1>, EvidenceBundle] {
  const definition = sealDefinition({ ...fixtureDefinition(), criteria: [criterion] });
  return [
    definition,
    sealEvidenceFixture({
      ...fixtureEvidence(),
      definition: referenceOf(definition),
      observations: observation ? [observation] : [],
    }),
  ];
}

function complete(criterionId: string, kind: "text", value: string): Observation;
function complete(criterionId: string, kind: "number", value: number): Observation;
function complete(
  criterionId: string,
  kind: "text" | "number",
  value: string | number,
): Observation {
  if (kind === "text") {
    return {
      criterionId,
      evidenceRef: "obs1",
      completeness: "complete",
      kind,
      value: value as string,
    };
  }
  return {
    criterionId,
    evidenceRef: "obs1",
    completeness: "complete",
    kind,
    value: value as number,
  };
}

function textCriterion(
  kind: "exact_text" | "normalized_text",
  expected: string,
  normalization?: TextNormalization,
): Criterion<1> {
  const base = { id: "check", mode: "required" as const, visibility: "public" as const };
  if (kind === "exact_text")
    return { ...base, kind, parameters: { expected: { type: "literal", value: expected } } };
  if (!normalization) throw new Error("normalization must be explicit");
  return {
    ...base,
    kind,
    parameters: { expected: { type: "literal", value: expected }, normalization },
  };
}

function numberCriterion(expected: number, absolute: number, relative: number): Criterion<1> {
  return {
    id: "check",
    mode: "required",
    visibility: "public",
    kind: "number_with_tolerance",
    parameters: {
      expected: { type: "literal", value: expected },
      tolerance: { absolute, relative },
    },
  };
}

function setCriterion(
  expected: readonly SetScalar[],
  order: "ignore" | "preserve",
  duplicates: "ignore" | "respect",
  itemType: "string" | "number" | "boolean" = "string",
): Criterion<1> {
  return {
    id: "check",
    mode: "required",
    visibility: "public",
    kind: "set_equivalence",
    parameters: { expected: { type: "literal", value: expected }, itemType, order, duplicates },
  };
}

function setObservation(
  items: readonly SetScalar[],
  itemType: "string" | "number" | "boolean" = "string",
): Observation {
  return {
    criterionId: "check",
    evidenceRef: "obs1",
    completeness: "complete",
    kind: "set",
    itemType,
    items,
  };
}

function resolved(result: EvaluationResponse): EvaluationResult {
  if ("diagnostics" in result)
    throw new Error(`Unexpected invalid input: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

function testCase(criterion: Criterion<1>, observation?: Observation): EvaluationResponse {
  const [definition, evidence] = caseOf(criterion, observation);
  return evaluate(definition, evidence);
}

const preservation: TextNormalization = {
  lineEndings: "preserve",
  unicode: "none",
  case: "sensitive",
  whitespace: "preserve",
  trim: "none",
};

describe("AY-I02 exact and explicit normalized text", () => {
  it("does exact UTF-16 code-unit comparison without trimming or canonicalization", () => {
    const c = textCriterion("exact_text", "café\n");
    expect(resolved(testCase(c, complete("check", "text", "café\n"))).outcome).toBe("pass");
    for (const observed of ["café", "café\r\n", "cafe\u0301\n", "CAFÉ\n", " café\n"]) {
      const result = resolved(testCase(c, complete("check", "text", observed)));
      expect(result.outcome).toBe("fail");
      expect(result.findings[0].reasonCode).toBe("VALUE_MISMATCH");
    }
  });

  it("normalizes only explicitly declared line endings, Unicode, case and whitespace", () => {
    const policy: TextNormalization = {
      lineEndings: "lf",
      unicode: "NFC",
      case: "fold",
      whitespace: "collapse",
      trim: "both",
    };
    const criterion = textCriterion("normalized_text", "  CAFÉ\r\n\t42  ", policy);
    expect(resolved(testCase(criterion, complete("check", "text", "cafe\u0301 42"))).outcome).toBe(
      "pass",
    );
    expect(
      resolved(
        testCase(
          textCriterion("normalized_text", "CAFE\u0301", preservation),
          complete("check", "text", "café"),
        ),
      ).outcome,
    ).toBe("fail");
  });

  it("uses the explicitly declared NFKC compatibility normalization", () => {
    const normal = { ...preservation, unicode: "NFKC" as const };
    expect(
      resolved(
        testCase(textCriterion("normalized_text", "①", normal), complete("check", "text", "1")),
      ).outcome,
    ).toBe("pass");
    expect(
      resolved(
        testCase(
          textCriterion("normalized_text", "①", { ...normal, unicode: "NFC" }),
          complete("check", "text", "1"),
        ),
      ).outcome,
    ).toBe("fail");
  });

  it("defines fold as locale-independent JavaScript lowercasing, not full Unicode case folding", () => {
    const policy = { ...preservation, case: "fold" as const };
    expect(
      resolved(
        testCase(textCriterion("normalized_text", "ABC", policy), complete("check", "text", "abc")),
      ).outcome,
    ).toBe("pass");
    expect(
      resolved(
        testCase(
          textCriterion("normalized_text", "straße", policy),
          complete("check", "text", "STRASSE"),
        ),
      ).outcome,
    ).toBe("fail");
  });
});

describe("AY-I02 explicit finite numerical tolerance", () => {
  it("compares inclusive tolerance at the absolute boundary", () => {
    const c = numberCriterion(42, 1, 0);
    expect(resolved(testCase(c, complete("check", "number", 43))).outcome).toBe("pass");
    expect(resolved(testCase(c, complete("check", "number", 44))).outcome).toBe("fail");
    expect(resolved(testCase(c, complete("check", "number", 41))).outcome).toBe("pass");
  });

  it("uses max(absolute, relative * abs(reference)) including negative references", () => {
    const c = numberCriterion(-100, 0.2, 0.02);
    expect(resolved(testCase(c, complete("check", "number", -102))).outcome).toBe("pass");
    expect(resolved(testCase(c, complete("check", "number", -103))).outcome).toBe("fail");
    expect(
      resolved(testCase(numberCriterion(0, 0.001, 0.9), complete("check", "number", 0.001)))
        .outcome,
    ).toBe("pass");
    expect(
      resolved(testCase(numberCriterion(0, 0, 0.9), complete("check", "number", 0.001))).outcome,
    ).toBe("fail");
  });

  it("never treats NaN, infinity, string numbers or negative tolerances as valid evidence", () => {
    const c = numberCriterion(3, 0, 0);
    for (const value of [NaN, Infinity, -Infinity, "3", null]) {
      const result = testCase(c, { ...complete("check", "number", 3), value } as Observation);
      expect(result.outcome).toBe("invalid_evidence");
      expect("findings" in result).toBe(false);
    }
    const [definition, evidence] = caseOf(c, complete("check", "number", 3));
    const bad = structuredClone(definition);
    const criterion = bad.criteria[0];
    if (criterion.kind !== "number_with_tolerance") throw new Error("fixture");
    const mutated = {
      ...criterion,
      parameters: { ...criterion.parameters, tolerance: { absolute: -1, relative: 0 } },
    };
    expect(evaluate({ ...bad, criteria: [mutated] }, evidence).outcome).toBe("invalid_definition");
  });

  it("returns evaluation_error instead of allowing an overflowed tolerance to pass", () => {
    const r = resolved(
      testCase(numberCriterion(1e308, 0, 1e308), complete("check", "number", 1e308)),
    );
    expect(r.outcome).toBe("evaluation_error");
    expect(r.findings[0]).toMatchObject({ outcome: "error", reasonCode: "NUMERIC_OVERFLOW" });
  });

  it("handles overflowed differences as actual mismatches under finite tolerance", () => {
    const r = resolved(testCase(numberCriterion(-1e308, 0, 0), complete("check", "number", 1e308)));
    expect(r.outcome).toBe("fail");
  });
});

describe("AY-I02 set equivalence policies", () => {
  it("ignores order and duplicates only when configured", () => {
    const expected = ["a", "b", "a"];
    const actual = setObservation(["b", "a"]);
    expect(resolved(testCase(setCriterion(expected, "ignore", "ignore"), actual)).outcome).toBe(
      "pass",
    );
    expect(resolved(testCase(setCriterion(expected, "ignore", "respect"), actual)).outcome).toBe(
      "fail",
    );
    expect(resolved(testCase(setCriterion(expected, "preserve", "ignore"), actual)).outcome).toBe(
      "fail",
    );
    expect(resolved(testCase(setCriterion(expected, "preserve", "respect"), actual)).outcome).toBe(
      "fail",
    );
  });

  it("supports exact ordered sequences and unordered multisets", () => {
    const expected = ["a", "b", "a"];
    expect(
      resolved(testCase(setCriterion(expected, "preserve", "respect"), setObservation(expected)))
        .outcome,
    ).toBe("pass");
    expect(
      resolved(
        testCase(setCriterion(expected, "ignore", "respect"), setObservation(["a", "a", "b"])),
      ).outcome,
    ).toBe("pass");
    expect(
      resolved(
        testCase(setCriterion(expected, "preserve", "ignore"), setObservation(["a", "a", "b"])),
      ).outcome,
    ).toBe("pass");
    expect(
      resolved(
        testCase(setCriterion(expected, "preserve", "respect"), setObservation(["a", "a", "b"])),
      ).outcome,
    ).toBe("fail");
  });

  it("compares boolean and numeric scalars without string coercion", () => {
    expect(
      resolved(
        testCase(
          setCriterion([true, false], "ignore", "respect", "boolean"),
          setObservation([false, true], "boolean"),
        ),
      ).outcome,
    ).toBe("pass");
    expect(
      resolved(
        testCase(
          setCriterion([-0, 1], "ignore", "respect", "number"),
          setObservation([0, 1], "number"),
        ),
      ).outcome,
    ).toBe("pass");
    expect(
      testCase(setCriterion([1], "ignore", "ignore", "number"), setObservation(["1"], "string"))
        .outcome,
    ).toBe("invalid_evidence");
    expect(
      testCase(setCriterion([1], "ignore", "ignore", "number"), setObservation([NaN], "number"))
        .outcome,
    ).toBe("invalid_evidence");
  });
});

describe("AY-I02 fail-closed aggregation and authority", () => {
  it("passes exactly when every required criterion passes", () => {
    const [definition, evidence] = caseOf(
      textCriterion("exact_text", "ok"),
      complete("check", "text", "ok"),
    );
    const result = resolved(evaluate(definition, evidence));
    expect(result.outcome).toBe("pass");
    expect(result.findings).toEqual([
      {
        criterionId: "check",
        outcome: "pass",
        reasonCode: "MATCH",
        evidenceRefs: ["obs1"],
        evaluatorId: "assay",
        evaluatorVersion: ASSAY_EVALUATOR_VERSION,
      },
    ]);
    expect(parseEvaluationResult(result).ok).toBe(true);
    expect("grade" in result).toBe(false);
    expect("credential" in result).toBe(false);
  });

  it("fails conclusively for a required mismatch even with missing evidence and advisory praise", () => {
    const base = fixtureDefinition();
    const criteria: readonly Criterion<1>[] = [
      textCriterion("exact_text", "expected"),
      { ...numberCriterion(10, 0, 0), id: "missing" },
      { ...textCriterion("exact_text", "great"), id: "advice", mode: "advisory" },
    ];
    const definition = sealDefinition({ ...base, criteria });
    const evidence = sealEvidenceFixture({
      ...fixtureEvidence(),
      definition: referenceOf(definition),
      observations: [
        complete("check", "text", "wrong"),
        { ...complete("advice", "text", "great"), evidenceRef: "obs2" },
      ],
    });
    const r = resolved(evaluate(definition, evidence));
    expect(r.outcome).toBe("fail");
    expect(r.findings.map((f) => [f.criterionId, f.outcome, f.reasonCode])).toEqual([
      ["check", "fail", "VALUE_MISMATCH"],
      ["missing", "inconclusive", "EVIDENCE_MISSING"],
      ["advice", "pass", "MATCH"],
    ]);
  });

  it("does not convert missing or truncated required evidence to wrong answers", () => {
    const c = textCriterion("exact_text", "ok");
    expect(resolved(testCase(c)).outcome).toBe("inconclusive");
    const incomplete = {
      ...complete("check", "text", "wrong"),
      completeness: "truncated" as const,
    };
    const result = resolved(testCase(c, incomplete));
    expect(result.outcome).toBe("inconclusive");
    expect(result.findings[0].reasonCode).toBe("EVIDENCE_TRUNCATED");
  });

  it("requires resolved references; missing reference data is not a pass or a failure", () => {
    const criterion: Criterion<1> = {
      id: "check",
      mode: "required",
      visibility: "restricted",
      kind: "exact_text",
      parameters: { expected: { type: "reference", referenceId: "hidden-ref" } },
    };
    const r = resolved(testCase(criterion, complete("check", "text", "guessed answer")));
    expect(r.outcome).toBe("inconclusive");
    expect(r.findings[0].reasonCode).toBe("REFERENCE_UNAVAILABLE");
    expect(JSON.stringify(r)).not.toContain("hidden-ref");
    expect(JSON.stringify(r)).not.toContain("guessed answer");
  });

  it("keeps execution assertion claims and manual artifacts unverified", () => {
    const base = fixtureDefinition();
    const execution = base.criteria.find((c) => c.kind === "observed_execution");
    const manual = base.criteria.find((c) => c.kind === "manual_evidence");
    if (!execution || !manual) throw new Error("fixture");
    const requested = sealDefinition({
      ...base,
      criteria: [
        { ...execution, mode: "required" as const },
        { ...manual, mode: "required" as const },
      ],
    });
    const payload = sealEvidenceFixture({
      ...fixtureEvidence(),
      definition: referenceOf(requested),
      observations: [
        {
          criterionId: "program",
          evidenceRef: "ex1",
          completeness: "complete",
          kind: "execution",
          runRef: "run1",
          assertions: [{ assertionId: "unit1", state: "confirmed" }],
        },
        {
          criterionId: "report",
          evidenceRef: "doc1",
          completeness: "complete",
          kind: "manual",
          artifactRefs: ["report1"],
        },
      ],
    });
    const r = resolved(evaluate(requested, payload));
    expect(r.outcome).toBe("inconclusive");
    expect(r.findings.map((f) => f.reasonCode)).toEqual([
      "EXECUTION_UNVERIFIED",
      "REVIEW_REQUIRED",
    ]);
  });

  it("distinguishes unknown or incomplete execution assertions", () => {
    const c = fixtureDefinition().criteria.find((item) => item.kind === "observed_execution");
    if (!c) throw new Error("fixture");
    const req: Criterion<1> = { ...c, mode: "required" };
    const observed: Observation = {
      criterionId: req.id,
      evidenceRef: "ex1",
      completeness: "complete",
      kind: "execution",
      runRef: "run1",
      assertions: [{ assertionId: "unit1", state: "unknown" }],
    };
    const r = resolved(testCase(req, observed));
    expect(r.outcome).toBe("inconclusive");
    expect(r.findings[0].reasonCode).toBe("ASSERTION_INCOMPLETE");
    const invalid = testCase(req, {
      ...observed,
      assertions: [{ assertionId: "bad", state: "confirmed" }],
    });
    expect(invalid.outcome).toBe("invalid_evidence");
  });

  it("requires manual review even with a file, and marks no file explicitly", () => {
    const c: Criterion<1> = {
      id: "check",
      mode: "required",
      visibility: "public",
      kind: "manual_evidence",
      parameters: { review: "required" },
    };
    const base: Observation = {
      criterionId: "check",
      evidenceRef: "doc1",
      kind: "manual",
      completeness: "complete",
      artifactRefs: ["doc"],
    };
    expect(resolved(testCase(c, base)).findings[0].reasonCode).toBe("REVIEW_REQUIRED");
    expect(resolved(testCase(c, { ...base, artifactRefs: [] })).findings[0].reasonCode).toBe(
      "ARTIFACT_MISSING",
    );
  });

  it("does not let advisory errors or missing advisory data invalidate a required pass", () => {
    const required = textCriterion("exact_text", "ok");
    const advisory: Criterion<1> = {
      ...textCriterion("exact_text", "hint"),
      id: "hint",
      mode: "advisory",
    };
    const [def, ev] = caseOf(required, complete("check", "text", "ok"));
    const configured = sealDefinition({ ...def, criteria: [required, advisory] });
    const r = resolved(evaluate(configured, sealEvidenceFixture({ ...ev, definition: referenceOf(configured) })));
    expect(r.outcome).toBe("pass");
    expect(r.warnings).toEqual(["ADVISORY_UNRESOLVED"]);
    expect(r.findings[1].outcome).toBe("inconclusive");
  });

  it("distinguishes invalid input envelopes without manufacturing definition identity", () => {
    const invalidDef = evaluate({ ...fixtureDefinition(), criteria: [] }, fixtureEvidence());
    expect(invalidDef.outcome).toBe("invalid_definition");
    expect("definition" in invalidDef).toBe(false);
    expect("findings" in invalidDef).toBe(false);
    const invalidEvidence = evaluate(
      sealDefinition(fixtureDefinition()),
      sealEvidenceFixture({
        ...fixtureEvidence(),
        definition: { ...fixtureEvidence().definition, revisionDigest: digestB },
      }),
    );
    expect(invalidEvidence.outcome).toBe("invalid_evidence");
    expect("definition" in invalidEvidence).toBe(false);
    expect(JSON.stringify(invalidEvidence)).not.toContain("secret");
  });

  it("rejects unsupported client-controlled grading fields without executing them", () => {
    const c = textCriterion("exact_text", "ok");
    const [def, ev] = caseOf(c, complete("check", "text", "ok"));
    const forged = {
      ...ev,
      observations: [{ ...ev.observations[0], expected: "ok", trusted: true, result: "pass" }],
    };
    expect(evaluate(def, forged).outcome).toBe("invalid_evidence");
    expect(evaluate({ ...def, grade: "A+" }, ev).outcome).toBe("invalid_definition");
  });

  it("maps internal comparator errors to evaluation_error without leaking exception messages", () => {
    const c = textCriterion("normalized_text", "ABC", { ...preservation, unicode: "NFC" });
    const spy = vi.spyOn(String.prototype, "normalize").mockImplementation(() => {
      throw new Error("SENSITIVE_EXCEPTION");
    });
    try {
      const r = resolved(testCase(c, complete("check", "text", "ABC")));
      expect(r.outcome).toBe("evaluation_error");
      expect(r.findings[0].reasonCode).toBe("COMPARATOR_ERROR");
      expect(JSON.stringify(r)).not.toContain("SENSITIVE_EXCEPTION");
    } finally {
      spy.mockRestore();
    }
  });

  it("replays byte-for-byte-equivalent decisions with immutable versioned provenance", () => {
    const c = textCriterion("exact_text", "ok");
    const [def, ev] = caseOf(c, complete("check", "text", "ok"));
    const a = resolved(evaluate(def, ev));
    const b = resolved(evaluate(structuredClone(def), structuredClone(ev)));
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.findings)).toBe(true);
    expect(Object.isFrozen(a.findings[0])).toBe(true);
    expect(Object.isFrozen(a.findings[0].evidenceRefs)).toBe(true);
    expect(Object.isFrozen(a.warnings)).toBe(true);
    const revised = sealDefinition({ ...def, revision: "rev2" });
    const changed = evaluate(revised, sealEvidenceFixture({ ...ev, definition: referenceOf(revised) }));
    expect(resolved(changed).definition.revisionDigest).not.toBe(a.definition.revisionDigest);
    expect(a.definition.revisionDigest).toBe(def.revisionDigest);
    expect(a.evaluator.version).toBe(ASSAY_EVALUATOR_VERSION);
  });
});
