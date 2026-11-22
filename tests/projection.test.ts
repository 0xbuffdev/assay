import { describe, expect, it } from "vitest";
import {
  type AssessmentDefinition,
  type Criterion,
  createAssessmentDefinition,
  type EvaluationResult,
  type EvidenceBundle,
  evaluateVerified,
  projectPublicResult,
} from "../src/index";

const visible: Criterion = {
  id: "visible",
  kind: "exact_text",
  mode: "required",
  visibility: "public",
  parameters: { expected: { type: "literal", value: "ok" } },
};

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
    policyVersion: "policy1",
    criteria,
  });
  if (!result.ok) throw new Error("Invalid test definition");
  return result.value;
}

function evidence(definition: AssessmentDefinition, output = "ok"): EvidenceBundle {
  return {
    schemaVersion: 1,
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
  };
}

function technical(definition: AssessmentDefinition, output = "ok"): EvaluationResult {
  const result = evaluateVerified(definition, evidence(definition, output));
  if (!("findings" in result)) throw new Error("Expected full technical result");
  return result;
}

function rejected(input: unknown) {
  const response = projectPublicResult(sealed([visible]), input);
  expect(response).toEqual({ ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" });
  expect(Object.isFrozen(response)).toBe(true);
  expect(JSON.stringify(response)).not.toContain("SECRET");
}

describe("AY-I07 restricted technical finding projection", () => {
  it("keeps all-public outcomes and public criterion outcomes interpretable", () => {
    const definition = sealed([visible]);
    for (const [output, outcome] of [
      ["ok", "pass"],
      ["wrong", "fail"],
    ] as const) {
      const response = projectPublicResult(definition, technical(definition, output));
      expect(response).toEqual({
        ok: true,
        value: {
          schemaVersion: 1,
          outcome,
          findings: [{ criterionId: "visible", outcome }],
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
    const noEvidence = { ...evidence(definition), observations: [] };
    const pending = evaluateVerified(definition, noEvidence);
    expect(projectPublicResult(definition, pending)).toMatchObject({
      ok: true,
      value: {
        outcome: "inconclusive",
        findings: [{ criterionId: "visible", outcome: "inconclusive" }],
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
    const measured: EvidenceBundle = {
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
    };
    const error = evaluateVerified(numerics, measured);
    expect(projectPublicResult(numerics, error)).toMatchObject({
      ok: true,
      value: {
        outcome: "evaluation_error",
        findings: [{ criterionId: "visible", outcome: "error" }],
      },
    });
  });

  it("does not reveal any restricted identifier, evidence reference, reason or aggregate verdict", () => {
    const definition = sealed([visible, restricted]);
    const full = technical(definition);
    const hidden = { ...full, findings: [...full.findings] };
    hidden.findings[1] = {
      ...hidden.findings[1],
      evidenceRefs: ["SECRET_EVIDENCE_CANARY"],
      reasonCode: "SECRET_REASON_CANARY",
    };
    const view = projectPublicResult(definition, hidden);
    expect(view).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        outcome: "withheld",
        findings: [{ criterionId: "visible", outcome: "pass" }],
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

  it("returns indistinguishable public responses for any restricted outcome or error", () => {
    const definition = sealed([visible, restricted]);
    const base = technical(definition);
    let first: string | undefined;
    for (const [hiddenOutcome, total] of [
      ["pass", "pass"],
      ["fail", "fail"],
      ["error", "evaluation_error"],
      ["inconclusive", "inconclusive"],
    ] as const) {
      const forged = {
        ...base,
        findings: [...base.findings],
        outcome: total as EvaluationResult["outcome"],
      };
      forged.findings[1] = {
        ...forged.findings[1],
        outcome: hiddenOutcome,
        reasonCode: "SECRET_REASON_CANARY",
        evidenceRefs: ["SECRET_EVIDENCE_CANARY"],
      };
      forged.outcome = total;
      const response = projectPublicResult(definition, forged);
      expect(response.ok).toBe(true);
      const text = JSON.stringify(response);
      first ??= text;
      expect(text).toBe(first);
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain("fail");
      expect(text).not.toContain("evaluation_error");
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
      value: { outcome: "withheld", findings: [{ criterionId: "visible", outcome: "pass" }] },
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
        findings: [{ criterionId: "visible", outcome: "pass" }],
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
