import { describe, expect, it } from "vitest";
import {
  type AssessmentDefinition,
  type Criterion,
  createAssessmentDefinition,
  createEvidenceBundle,
  createReferenceRecord,
  type EvaluationResult,
  type EvidenceBundle,
  evaluate,
  type PublicReason,
  projectPublicResult,
} from "../src/index";
import { sealEvidenceFixture } from "./fixtures/contracts";

const visible = {
  id: "visible",
  kind: "exact_text",
  mode: "required",
  visibility: "public",
  parameters: { expected: { type: "literal", value: "ok" } },
} as const satisfies Criterion;

const restricted: Criterion = {
  id: "SECRET_CRITERION_CANARY",
  kind: "exact_text",
  mode: "required",
  visibility: "restricted",
  parameters: {
    expected: { type: "reference", referenceId: "SECRET_REFERENCE_CANARY" },
  },
};

function sealed(criteria: readonly Criterion[]): AssessmentDefinition {
  const result = createAssessmentDefinition({
    schemaVersion: 1,
    assessmentId: "projection",
    revision: "rev1",
    policyVersion: "all-required-v1",
    criteria,
  });
  if (!result.ok) throw new Error("Invalid test definition");
  return result.value;
}

function evidence(definition: AssessmentDefinition, output = "ok"): EvidenceBundle {
  return sealEvidenceFixture({
    schemaVersion: 2,
    definition: {
      assessmentId: definition.assessmentId,
      revision: definition.revision,
      revisionDigest: definition.revisionDigest,
    },
    observations: [
      {
        criterionId: "visible",
        evidenceRef: "publicObservation",
        kind: "text",
        completeness: "complete",
        value: output,
      },
    ],
  });
}

function technical(definition: AssessmentDefinition, output = "ok"): EvaluationResult {
  const result = evaluate(definition, evidence(definition, output));
  if (!("findings" in result)) throw new Error("Expected full technical result");
  return result;
}

function rejected(input: unknown) {
  const response = projectPublicResult(sealed([visible]), input);
  expect(response).toEqual({ ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" });
  expect(Object.isFrozen(response)).toBe(true);
  expect(JSON.stringify(response)).not.toContain("SECRET");
}

describe("AY-I20 safe technical feedback", () => {
  it("keeps all-public outcomes and public criterion outcomes interpretable", () => {
    const definition = sealed([visible]);
    for (const [output, outcome, reason] of [
      ["ok", "pass", "match"],
      ["wrong", "fail", "mismatch"],
    ] as const) {
      const response = projectPublicResult(definition, technical(definition, output));
      expect(response).toEqual({
        ok: true,
        value: {
          schemaVersion: 1,
          outcome,
          findings: [{ criterionId: "visible", outcome, reason }],
        },
      });
      if (response.ok) {
        expect(Object.isFrozen(response)).toBe(true);
        expect(Object.isFrozen(response.value)).toBe(true);
        expect(Object.isFrozen(response.value.findings)).toBe(true);
        expect(Object.isFrozen(response.value.findings[0])).toBe(true);
      }
    }
  });

  it("supports inconclusive and evaluation_error without disclosing diagnostics", () => {
    const definition = sealed([visible]);
    const noEvidence = sealEvidenceFixture({ ...evidence(definition), observations: [] });
    const pending = evaluate(definition, noEvidence);
    expect(projectPublicResult(definition, pending)).toMatchObject({
      ok: true,
      value: {
        outcome: "inconclusive",
        findings: [{ criterionId: "visible", outcome: "inconclusive", reason: "missing_evidence" }],
      },
    });

    const overflow: Criterion = {
      id: "visible",
      kind: "number_with_tolerance",
      mode: "required",
      visibility: "public",
      parameters: {
        expected: { type: "literal", value: 1e308 },
        tolerance: { absolute: 0, relative: 1e308 },
      },
    };
    const numerics = sealed([overflow]);
    const measured = sealEvidenceFixture({
      ...evidence(numerics),
      observations: [
        {
          criterionId: "visible",
          evidenceRef: "publicObservation",
          kind: "number",
          completeness: "complete",
          value: 1e308,
        },
      ],
    });
    const error = evaluate(numerics, measured);
    expect(projectPublicResult(numerics, error)).toMatchObject({
      ok: true,
      value: {
        outcome: "evaluation_error",
        findings: [{ criterionId: "visible", outcome: "error", reason: "evaluation_error" }],
      },
    });
  });

  it("rejects numeric decisions that contradict known literal tolerance bounds", () => {
    for (const [expected, relative, outcome, reasonCode] of [
      [1e308, 1e308, "evaluation_error", "NUMERIC_OVERFLOW"],
      [10, 0.1, "pass", "MATCH"],
    ] as const) {
      const criterion: Criterion = {
        ...visible,
        kind: "number_with_tolerance",
        parameters: {
          expected: { type: "literal", value: expected },
          tolerance: { absolute: 0, relative },
        },
      };
      const definition = sealed([criterion]);
      const observation = {
        criterionId: criterion.id,
        evidenceRef: "numeric-observation",
        kind: "number",
        completeness: "complete",
        value: expected,
      } as const;
      const prepared = createEvidenceBundle(definition, {
        schemaVersion: 2,
        observations: [observation],
      });
      if (!prepared.ok) throw new Error("Invalid numeric evidence");
      const result = evaluate(definition, prepared.value);
      if (!("findings" in result)) throw new Error("Expected full result");
      expect(result.outcome).toBe(outcome);
      expect(result.findings[0].reasonCode).toBe(reasonCode);
      expect(projectPublicResult(definition, result).ok).toBe(true);

      const forged =
        reasonCode === "NUMERIC_OVERFLOW"
          ? [
              ["pass", "MATCH", "pass"],
              ["fail", "VALUE_MISMATCH", "fail"],
            ]
          : [["error", "NUMERIC_OVERFLOW", "evaluation_error"]];
      for (const [decision, reason, total] of forged) {
        expect(
          projectPublicResult(definition, {
            ...result,
            outcome: total,
            findings: [{ ...result.findings[0], outcome: decision, reasonCode: reason }],
          }),
        ).toEqual({ ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" });
      }

      for (const observations of [[], [{ ...observation, completeness: "truncated" }]]) {
        const partial = createEvidenceBundle(definition, { schemaVersion: 2, observations });
        if (!partial.ok) throw new Error("Invalid partial evidence");
        const unresolved = evaluate(definition, partial.value);
        expect(unresolved.outcome).toBe("inconclusive");
        expect(projectPublicResult(definition, unresolved).ok).toBe(true);
      }
      expect(
        projectPublicResult(definition, {
          ...result,
          outcome: "evaluation_error",
          findings: [{ ...result.findings[0], outcome: "error", reasonCode: "COMPARATOR_ERROR" }],
        }).ok,
      ).toBe(true);
    }
  });

  it("checks overflow feasibility without assuming unknown reference values", () => {
    for (const [value, relative, overflowPossible, overflow] of [
      [10, 0, false, false],
      [Number.MAX_VALUE, 1, false, false],
      [10, 2, true, false],
      [Number.MAX_VALUE, 2, true, true],
    ] as const) {
      const record = createReferenceRecord({
        schemaVersion: 2,
        referenceId: "numeric-reference",
        kind: "number",
        value,
      });
      if (!record.ok) throw new Error("Invalid numeric reference");
      const created = createAssessmentDefinition({
        schemaVersion: 2,
        assessmentId: "projection",
        revision: "rev1",
        policyVersion: "all-required-v1",
        criteria: [
          {
            ...visible,
            kind: "number_with_tolerance",
            parameters: {
              expected: {
                type: "reference",
                referenceId: record.value.referenceId,
                referenceDigest: record.value.referenceDigest,
              },
              tolerance: { absolute: 0, relative },
            },
          },
        ],
      });
      if (!created.ok) throw new Error("Invalid numeric definition");
      const definition = created.value;
      const prepared = createEvidenceBundle(definition, {
        schemaVersion: 2,
        observations: [
          {
            criterionId: "visible",
            evidenceRef: "numeric-observation",
            kind: "number",
            completeness: "complete",
            value,
          },
        ],
      });
      if (!prepared.ok) throw new Error("Invalid numeric evidence");
      const result = evaluate(definition, prepared.value, {
        schemaVersion: 2,
        definition: prepared.value.definition,
        references: [record.value],
      });
      if (!("findings" in result)) throw new Error("Expected full result");
      expect(result.findings[0].reasonCode).toBe(overflow ? "NUMERIC_OVERFLOW" : "MATCH");
      expect(projectPublicResult(definition, result).ok).toBe(true);
      const candidate = {
        ...result,
        outcome: "evaluation_error",
        findings: [{ ...result.findings[0], outcome: "error", reasonCode: "NUMERIC_OVERFLOW" }],
      };
      const response = projectPublicResult(definition, candidate);
      if (overflowPossible) expect(response.ok).toBe(true);
      else expect(response).toEqual({ ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" });
      expect(
        projectPublicResult(definition, {
          ...result,
          outcome: "pass",
          findings: [{ ...result.findings[0], outcome: "pass", reasonCode: "MATCH" }],
        }).ok,
      ).toBe(true);
      const unavailable = evaluate(definition, prepared.value);
      expect(unavailable.outcome).toBe("inconclusive");
      expect(projectPublicResult(definition, unavailable).ok).toBe(true);
    }
  });

  it("does not reveal any restricted identifier, evidence reference, reason or aggregate verdict", () => {
    const definition = sealed([visible, restricted]);
    const full = technical(definition);
    const hiddenFinding = full.findings[1];
    if (hiddenFinding.outcome !== "inconclusive") throw new Error("Expected unresolved finding");
    const hidden = { ...full, findings: [...full.findings] };
    hidden.findings[1] = {
      ...hiddenFinding,
      evidenceRefs: ["SECRET_EVIDENCE_CANARY"],
      reasonCode: "REFERENCE_UNAVAILABLE",
    };
    const view = projectPublicResult(definition, hidden);
    expect(view).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        outcome: "withheld",
        findings: [{ criterionId: "visible", outcome: "pass", reason: "match" }],
      },
    });
    const serialized = JSON.stringify(view);
    for (const canary of [
      "SECRET_CRITERION_CANARY",
      "SECRET_REFERENCE_CANARY",
      "SECRET_EVIDENCE_CANARY",
      "SECRET_REASON_CANARY",
      "REFERENCE_UNAVAILABLE",
      "revisionDigest",
      "evidenceDigest",
      "artifactDigest",
      "warnings",
      "evidenceRefs",
    ]) {
      expect(serialized).not.toContain(canary);
    }
    // The authorized technical record is neither changed nor promoted to a
    // learner response. Its full evidence and private findings remain intact.
    expect(full.findings[1].criterionId).toBe("SECRET_CRITERION_CANARY");
    expect(full.findings[1].reasonCode).toBe("EVIDENCE_MISSING");
  });

  it("returns identical public bytes for protected passes, failures, missing facts and errors", () => {
    const record = createReferenceRecord({
      schemaVersion: 2,
      referenceId: "SECRET_REFERENCE_CANARY",
      kind: "text",
      value: "SECRET_EXPECTED_CANARY",
    });
    if (!record.ok) throw new Error("Invalid reference fixture");
    const hidden = {
      ...restricted,
      parameters: {
        expected: {
          type: "reference",
          referenceId: record.value.referenceId,
          referenceDigest: record.value.referenceDigest,
        },
      },
    };
    const created = createAssessmentDefinition({
      schemaVersion: 2,
      assessmentId: "projection",
      revision: "rev1",
      policyVersion: "all-required-v1",
      criteria: [visible, hidden],
    });
    if (!created.ok) throw new Error("Invalid definition fixture");
    const definition = created.value;
    const reference = {
      schemaVersion: 2,
      definition: evidence(definition).definition,
      references: [record.value],
    };
    let first: string | undefined;
    for (const [value, outcome] of [
      ["SECRET_EXPECTED_CANARY", "pass"],
      ["SECRET_OBSERVED_CANARY", "fail"],
      [undefined, "inconclusive"],
    ] as const) {
      const prepared = createEvidenceBundle(definition, {
        schemaVersion: 2,
        observations: [
          ...evidence(definition).observations,
          ...(value === undefined
            ? []
            : [
                {
                  criterionId: hidden.id,
                  evidenceRef: "SECRET_EVIDENCE_CANARY",
                  kind: "text",
                  completeness: "complete",
                  value,
                },
              ]),
        ],
      });
      if (!prepared.ok) throw new Error("Invalid evidence fixture");
      const result = evaluate(definition, prepared.value, reference);
      if (!("findings" in result)) throw new Error("Expected full result");
      expect(result.outcome).toBe(outcome);
      const variants: EvaluationResult[] = [result];
      if (outcome === "pass") {
        variants.push({
          ...result,
          outcome: "evaluation_error",
          findings: [
            result.findings[0],
            { ...result.findings[1], outcome: "error", reasonCode: "COMPARATOR_ERROR" },
          ],
        });
      }
      for (const variant of variants) {
        const response = projectPublicResult(definition, variant);
        expect(response.ok).toBe(true);
        const bytes = JSON.stringify(response);
        first ??= bytes;
        expect(bytes).toBe(first);
        expect(bytes).not.toContain("SECRET");
        expect(bytes).not.toContain("fail");
        expect(bytes).not.toContain("evaluation_error");
      }
    }
  });

  it("withholds the aggregate even when a restricted criterion is only advisory", () => {
    const advisory: Criterion = { ...restricted, mode: "advisory" };
    const definition = sealed([visible, advisory]);
    const full = technical(definition);
    expect(full.outcome).toBe("pass");
    expect(full.warnings).toContain("ADVISORY_UNRESOLVED");
    const publicView = projectPublicResult(definition, full);
    expect(publicView).toMatchObject({
      ok: true,
      value: {
        outcome: "withheld",
        findings: [{ criterionId: "visible", outcome: "pass", reason: "match" }],
      },
    });
    expect(JSON.stringify(publicView)).not.toContain("ADVISORY_UNRESOLVED");
  });

  it("does not leak private findings when the only public criteria are advisory", () => {
    const advisory: Criterion = { ...visible, mode: "advisory" };
    const definition = sealed([restricted, advisory]);
    const response = projectPublicResult(definition, technical(definition));
    expect(response).toMatchObject({
      ok: true,
      value: {
        outcome: "withheld",
        findings: [{ criterionId: "visible", outcome: "pass", reason: "match" }],
      },
    });
  });

  it("rejects missing, duplicated, reordered, extra, and unrelated findings identically", () => {
    const definition = sealed([visible, restricted]);
    const full = technical(definition);
    const variants: unknown[] = [
      { ...full, findings: full.findings.slice(0, 1) },
      { ...full, findings: [full.findings[0], full.findings[0]] },
      { ...full, findings: [...full.findings].reverse() },
      { ...full, findings: [...full.findings, full.findings[1]] },
      {
        ...full,
        findings: [{ ...full.findings[0], criterionId: "UNAUTHORISED_CANARY" }, full.findings[1]],
      },
      { ...full, policyVersion: "unrelated" },
      { ...full, definition: { ...full.definition, revision: "rev2" } },
      { ...full, definition: { ...full.definition, revisionDigest: `sha256:${"a".repeat(64)}` } },
      { ...full, evaluator: { ...full.evaluator, id: "other" } },
      { ...full, outcome: "pass" },
      { ...full, warnings: ["ADVISORY_UNRESOLVED"] },
      {
        ...full,
        findings: [{ ...full.findings[0], reasonCode: "SECRET_REASON_CANARY" }, full.findings[1]],
      },
      { ...full, grade: "SECRET_GRADE_CANARY" },
      { ...full, arbitrary: "SECRET_UNKNOWN_CANARY" },
      { ...full, findings: [{ ...full.findings[0], evidenceRefs: ["BAD REF"] }, full.findings[1]] },
    ];
    for (const variant of variants) {
      const response = projectPublicResult(definition, variant);
      expect(response).toEqual({ ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" });
      expect(JSON.stringify(response)).not.toContain("CANARY");
    }
  });

  it("refuses unsigned, altered, or forged visibility definitions before inspecting a result", () => {
    const def = sealed([visible, restricted]);
    const full = technical(def);
    const turnedPublic = {
      ...def,
      criteria: [visible, { ...restricted, visibility: "public" }],
    };
    const variants: unknown[] = [
      turnedPublic,
      { ...def, criteria: [visible] },
      { ...def, revisionDigest: `sha256:${"0".repeat(64)}` },
      { ...def, schemaVersion: 2 },
      { ...def, additionalPrivateField: "SECRET_PRIVATE_CANARY" },
    ];
    for (const invalidDefinition of variants) {
      const result = projectPublicResult(invalidDefinition, full);
      expect(result).toEqual({ ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" });
      expect(JSON.stringify(result)).not.toContain("SECRET");
    }
  });

  it("maps every supported technical reason to the finite public vocabulary", () => {
    const numeric: Criterion = {
      ...visible,
      kind: "number_with_tolerance",
      parameters: {
        expected: { type: "literal", value: 1e308 },
        tolerance: { absolute: 0, relative: 1e308 },
      },
    };
    const manual: Criterion = {
      ...visible,
      kind: "manual_evidence",
      parameters: { review: "required" },
    };
    const execution: Criterion = {
      ...visible,
      kind: "observed_execution",
      parameters: { assertions: [{ id: "assertion", referenceId: "SECRET_ASSERTION_CANARY" }] },
    };
    const referenced: Criterion = {
      ...restricted,
      id: "visible",
      visibility: "public",
    };
    const cases = [
      [visible, "pass", "MATCH", "pass", "match"],
      [visible, "fail", "VALUE_MISMATCH", "fail", "mismatch"],
      [referenced, "inconclusive", "REFERENCE_UNAVAILABLE", "inconclusive", "unavailable"],
      [visible, "inconclusive", "EVIDENCE_MISSING", "inconclusive", "missing_evidence"],
      [visible, "inconclusive", "EVIDENCE_TRUNCATED", "inconclusive", "incomplete_evidence"],
      [execution, "inconclusive", "ASSERTION_INCOMPLETE", "inconclusive", "incomplete_evidence"],
      [execution, "inconclusive", "EXECUTION_UNVERIFIED", "inconclusive", "unavailable"],
      [visible, "inconclusive", "EXECUTION_INCOMPLETE", "inconclusive", "incomplete_evidence"],
      [manual, "inconclusive", "ARTIFACT_MISSING", "inconclusive", "missing_evidence"],
      [manual, "inconclusive", "REVIEW_REQUIRED", "inconclusive", "review_needed"],
      [visible, "error", "COMPARATOR_ERROR", "evaluation_error", "evaluation_error"],
      [numeric, "error", "NUMERIC_OVERFLOW", "evaluation_error", "evaluation_error"],
    ] as const;
    for (const [criterion, outcome, reasonCode, overall, reason] of cases) {
      const definition = sealed([criterion]);
      const base = evaluate(
        definition,
        sealEvidenceFixture({ ...evidence(definition), observations: [] }),
      );
      if (!("findings" in base)) throw new Error("Expected full result");
      const result = {
        ...base,
        outcome: overall,
        findings: [
          {
            ...base.findings[0],
            outcome,
            reasonCode,
            evidenceRefs: reasonCode === "EVIDENCE_MISSING" ? [] : ["SECRET_EVIDENCE_CANARY"],
          },
        ],
      };
      const feedback: PublicReason = reason;
      const response = projectPublicResult(definition, result);
      expect(response).toEqual({
        ok: true,
        value: {
          schemaVersion: 1,
          outcome: overall,
          findings: [{ criterionId: "visible", outcome, reason: feedback }],
        },
      });
      expect(JSON.stringify(response)).not.toContain(reasonCode);
      expect(JSON.stringify(response)).not.toContain("SECRET");
    }
  });

  it("rejects forged reason semantics and impossible evidence correspondence", () => {
    const definition = sealed([visible]);
    const base = technical(definition);
    const first = base.findings[0];
    for (const [outcome, reasonCode, evidenceRefs, total] of [
      ["pass", "MATCH", [], "pass"],
      ["pass", "MATCH", ["one", "two"], "pass"],
      ["inconclusive", "EVIDENCE_MISSING", ["one"], "inconclusive"],
      ["inconclusive", "REFERENCE_UNAVAILABLE", ["one"], "inconclusive"],
      ["inconclusive", "REVIEW_REQUIRED", ["one"], "inconclusive"],
      ["inconclusive", "ASSERTION_INCOMPLETE", ["one"], "inconclusive"],
      ["error", "NUMERIC_OVERFLOW", ["one"], "evaluation_error"],
      ["pass", "VALUE_MISMATCH", ["one"], "pass"],
      ["pass", "match", ["one"], "pass"],
    ] as const) {
      rejected({
        ...base,
        outcome: total,
        findings: [{ ...first, outcome, reasonCode, evidenceRefs }],
      });
    }

    const two = sealed([visible, { ...visible, id: "second" }]);
    const result = technical(two);
    expect(
      projectPublicResult(two, {
        ...result,
        outcome: "pass",
        findings: [result.findings[0], { ...result.findings[0], criterionId: "second" }],
      }),
    ).toEqual({ ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" });

    const manual = sealed([
      { ...visible, kind: "manual_evidence", parameters: { review: "required" } },
    ]);
    expect(
      projectPublicResult(manual, {
        ...base,
        definition: evidence(manual).definition,
      }),
    ).toEqual({ ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" });
  });

  it("fails closed for hostile source objects and never executes getters", () => {
    const definition = sealed([visible]);
    const full = technical(definition);
    let called = 0;
    const trap = { ...full };
    Object.defineProperty(trap, "findings", {
      enumerable: true,
      get() {
        called++;
        throw new Error("SECRET_EXCEPTION_CANARY");
      },
    });
    rejected(trap);
    expect(called).toBe(0);
    const cycle: Record<string, unknown> = {};
    cycle.recurse = cycle;
    rejected(cycle);
    rejected(null);
    rejected({ outcome: "pass", credential: "SECRET_CREDENTIAL_CANARY" });
  });
});
