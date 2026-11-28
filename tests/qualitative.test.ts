import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type AssessmentDefinition,
  collectObservations,
  createAssessmentDefinition,
  createEvidenceBundle,
  createReferenceRecord,
  evaluate,
  type Observation,
  parseObservationPortReport,
  projectPublicResult,
  type QualitativeObservation,
  verifyEvidenceBundle,
} from "../src/index";
import { digestA, digestB, referenceOf, sealEvidenceFixture } from "./fixtures/contracts";

const objective = {
  id: "output",
  mode: "required",
  visibility: "public",
  kind: "exact_text",
  parameters: { expected: { type: "literal", value: "ok" } },
} as const;
const review = {
  id: "review",
  mode: "advisory",
  visibility: "public",
  kind: "qualitative_review",
  parameters: { reviewPolicyId: "design", reviewPolicyVersion: "rev1" },
} as const;
const authored = {
  schemaVersion: 4,
  assessmentId: "review-fixture",
  revision: "rev1",
  policyVersion: "composed-required-v1",
  criteria: [objective, review],
  composition: {
    rootGroupId: "root",
    groups: [{ id: "root", operator: "all", children: [{ kind: "criterion", id: "output" }] }],
  },
};
const human = { kind: "human", reviewerId: "human-canary", reviewerVersion: "rev1" } as const;
const model = {
  kind: "model",
  providerId: "provider-canary",
  modelId: "model-canary",
  modelVersion: "rev1",
  promptId: "prompt-canary",
  promptVersion: "rev2",
} as const;
const observation: QualitativeObservation = {
  criterionId: "review",
  evidenceRef: "review-ref-canary",
  completeness: "complete",
  kind: "qualitative_review",
  origin: { kind: "artifact", artifactDigest: digestA, sourceRef: "source-canary" },
  reviewPolicyId: "design",
  reviewPolicyVersion: "rev1",
  reviewer: human,
  uncertainty: "unknown",
  feedback: "feedback-canary\n\t<review> café",
  citations: [{ artifactRef: "citation-canary", startByte: 0, endByte: 8 }],
};
const fact = {
  criterionId: "output",
  evidenceRef: "output-ref",
  completeness: "complete",
  kind: "text",
  origin: { kind: "independent", sourceRef: "fixture" },
  value: "ok",
} as const;
function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  return result.value;
}

function definition(visibility = "public"): AssessmentDefinition {
  return unwrap(
    createAssessmentDefinition({
      ...authored,
      criteria: [objective, { ...review, visibility }],
    }),
  );
}

function bundle(def: AssessmentDefinition, observations: readonly unknown[]) {
  return createEvidenceBundle(def, { schemaVersion: 4, artifactDigest: digestA, observations });
}

function independent(domain: string, value: unknown): string {
  const bytes = JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
  return `sha256:${createHash("sha256").update(`assay:${domain}:v4\n${bytes}`).digest("hex")}`;
}

describe("AY-I08 qualitative observations", () => {
  it("admits only advisory review criteria with exact versioned policy parameters", () => {
    expect(definition().criteria[1]).toEqual(review);
    expect(definition("restricted").criteria[1].visibility).toBe("restricted");
    for (const malformed of [
      { ...review, mode: "required" },
      { ...review, executionFact: "stdout" },
      { ...review, authoritative: true },
      { ...review, parameters: { ...review.parameters, score: 1 } },
      {
        ...review,
        parameters: { ...review.parameters, expected: { type: "literal", value: true } },
      },
      { ...review, parameters: { reviewPolicyId: "design", reviewPolicyVersion: "LATEST" } },
      { ...review, parameters: { reviewPolicyId: "invalid id", reviewPolicyVersion: "rev1" } },
      { ...review, parameters: { reviewPolicyId: "design" } },
    ]) {
      expect(createAssessmentDefinition({ ...authored, criteria: [objective, malformed] }).ok).toBe(
        false,
      );
    }
    const onlyReview = {
      ...authored,
      criteria: [review],
      composition: {
        rootGroupId: "root",
        groups: [{ id: "root", operator: "all", children: [{ kind: "criterion", id: "review" }] }],
      },
    };
    expect(createAssessmentDefinition(onlyReview).ok).toBe(false);
  });

  it("never grants binding credit from either reviewer variant or any uncertainty", () => {
    const def = definition();
    for (const reviewer of [human, model]) {
      for (const uncertainty of ["low", "medium", "high", "unknown"] as const) {
        for (const completeness of ["complete", "truncated"] as const) {
          const observed = { ...observation, reviewer, uncertainty, completeness };
          for (const value of ["ok", "wrong"]) {
            const evidence = unwrap(bundle(def, [{ ...fact, value }, observed]));
            const result = evaluate(def, evidence);
            expect(result).toMatchObject({
              outcome: value === "ok" ? "pass" : "fail",
              warnings: ["ADVISORY_UNRESOLVED"],
              findings: [
                { criterionId: "output", outcome: value === "ok" ? "pass" : "fail" },
                {
                  criterionId: "review",
                  outcome: "inconclusive",
                  reasonCode:
                    completeness === "complete" ? "REVIEW_REQUIRED" : "EVIDENCE_TRUNCATED",
                  evidenceRefs: [observation.evidenceRef],
                },
              ],
            });
            expect(evaluate(def, evidence)).toEqual(result);
            expect(verifyEvidenceBundle(def, evidence).ok).toBe(true);
            expect(projectPublicResult(def, result).ok).toBe(true);
            expect(JSON.stringify(result)).not.toContain("feedback-canary");
          }
        }
      }
    }
    const missing = evaluate(def, unwrap(bundle(def, [fact])));
    expect(missing).toMatchObject({
      outcome: "pass",
      warnings: ["ADVISORY_UNRESOLVED"],
      findings: [
        { outcome: "pass" },
        { outcome: "inconclusive", reasonCode: "EVIDENCE_MISSING", evidenceRefs: [] },
      ],
    });
    const manual = unwrap(
      createAssessmentDefinition({
        ...authored,
        criteria: [
          { ...objective, kind: "manual_evidence", parameters: { review: "required" } },
          review,
        ],
      }),
    );
    expect(evaluate(manual, unwrap(bundle(manual, [observation]))).outcome).toBe("inconclusive");
  });

  it("binds all review fields and authored citation order to current canonical bytes", () => {
    const def = definition();
    expect(def.revisionDigest).toBe(independent("definition", authored));
    const evidence = unwrap(bundle(def, [fact, observation]));
    const content = {
      schemaVersion: 4,
      definition: referenceOf(def),
      artifactDigest: digestA,
      observations: [fact, observation],
    };
    expect(evidence.evidenceDigest).toBe(independent("evidence", content));
    const changed = unwrap(bundle(def, [fact, { ...observation, reviewer: model }]));
    expect(changed.evidenceDigest).not.toBe(evidence.evidenceDigest);
    const citations = [
      ...observation.citations,
      { artifactRef: "second", startByte: 8, endByte: 9 },
    ];
    const forward = unwrap(bundle(def, [{ ...observation, citations }]));
    const reversed = unwrap(bundle(def, [{ ...observation, citations: [...citations].reverse() }]));
    expect(forward.evidenceDigest).not.toBe(reversed.evidenceDigest);
    expect(verifyEvidenceBundle(def, { ...evidence, observations: changed.observations }).ok).toBe(
      false,
    );
  });

  it("enforces UTF-16, UTF-8 and citation limits including exact boundaries", () => {
    const def = definition();
    for (const feedback of ["a".repeat(4096), "é".repeat(2048), "😀".repeat(1024), "\t\n"]) {
      expect(bundle(def, [{ ...observation, feedback }]).ok).toBe(true);
    }
    for (const feedback of [
      "",
      "a".repeat(4097),
      "é".repeat(2049),
      "😀".repeat(1025),
      "\u0000",
      "\u000d",
      "\u007f",
      "\u0080",
      "\u009f",
      "\ud800",
      "\udc00",
    ]) {
      expect(bundle(def, [{ ...observation, feedback }]).ok).toBe(false);
    }
    const citations = Array.from({ length: 8 }, (_, i) => ({
      artifactRef: "file",
      startByte: i,
      endByte: i + 1,
    }));
    expect(bundle(def, [{ ...observation, citations }]).ok).toBe(true);
    expect(
      bundle(def, [
        {
          ...observation,
          citations: [{ artifactRef: "file", startByte: 0, endByte: Number.MAX_SAFE_INTEGER }],
        },
      ]).ok,
    ).toBe(true);
    for (const invalid of [
      [],
      [...citations, { artifactRef: "file", startByte: 8, endByte: 9 }],
      [citations[0], citations[0]],
      [{ ...citations[0], startByte: -1 }],
      [{ ...citations[0], endByte: 0 }],
      [{ ...citations[0], endByte: 1.5 }],
      [{ ...citations[0], endByte: Number.MAX_SAFE_INTEGER + 1 }],
      [{ ...citations[0], artifactRef: "https://example.test/file" }],
      [{ ...citations[0], quote: "secret-canary" }],
    ]) {
      expect(bundle(def, [{ ...observation, citations: invalid }]).ok).toBe(false);
    }
  });

  it("rejects malformed review claims even when a required objective already passes", () => {
    const def = definition();
    for (const malformed of [
      { ...observation, reviewer: { ...human, trusted: true } },
      { ...observation, reviewer: { ...human, reviewerVersion: "Latest" } },
      { ...observation, reviewer: { ...model, promptVersion: "latest" } },
      { ...observation, reviewer: { ...model, modelVersion: "latest" } },
      { ...observation, reviewer: { ...model, providerId: "a".repeat(97) } },
      { ...observation, reviewer: { kind: "unknown" } },
      { ...observation, reviewer: { kind: "human", reviewerId: "x" } },
      { ...observation, uncertainty: "certain" },
      { ...observation, reviewPolicyId: "other" },
      { ...observation, reviewPolicyVersion: "rev2" },
      { ...observation, origin: { ...observation.origin, artifactDigest: digestB } },
      { ...observation, origin: { ...observation.origin, runRef: "run1" } },
      { ...observation, origin: { kind: "independent", sourceRef: "fixture" } },
      { ...observation, executionFact: "stdout" },
      { ...observation, verdict: "pass" },
      { ...observation, score: 100 },
      { ...observation, completeness: "truncated", citations: [] },
      { ...observation, criterionId: "output", evidenceRef: "other" },
      { ...observation, evidenceRef: fact.evidenceRef },
    ]) {
      const evidence = sealEvidenceFixture({
        schemaVersion: 4,
        definition: referenceOf(def),
        artifactDigest: digestA,
        observations: [fact, malformed],
      });
      const rejected = evaluate(def, evidence);
      expect(rejected.outcome).toBe("invalid_evidence");
      expect(JSON.stringify(rejected)).not.toContain("canary");
    }
    expect(createEvidenceBundle(def, { schemaVersion: 4, observations: [observation] }).ok).toBe(
      false,
    );
    const evidence = unwrap(bundle(def, [fact, observation]));
    const reference = unwrap(
      createReferenceRecord({ schemaVersion: 4, referenceId: "review", kind: "text", value: "ok" }),
    );
    expect(
      evaluate(def, evidence, {
        schemaVersion: 4,
        definition: referenceOf(def),
        references: [reference],
      }).outcome,
    ).toBe("invalid_reference");
  });

  it("excludes qualitative material from acquisition and preserves supplied review bytes", async () => {
    const def = definition();
    const starting = unwrap(bundle(def, [observation]));
    const report = {
      schemaVersion: 4,
      definition: referenceOf(def),
      artifactDigest: digestA,
      provenance: {
        adapterId: "fixture",
        adapterVersion: "rev1",
        runRef: "run1",
        toolchainId: "node",
        toolchainVersion: "v24",
        capturedStdoutBytes: 2,
        capturedStderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
      observations: [
        {
          criterionId: "output",
          evidenceRef: "collected",
          completeness: "complete",
          kind: "text",
          value: "ok",
        },
      ],
    };
    const observe = vi.fn(async (request: unknown) => {
      expect(request).toEqual({
        schemaVersion: 4,
        definition: referenceOf(def),
        artifactDigest: digestA,
        criteria: [{ criterionId: "output", kind: "text" }],
        limits: { maxCapturedBytes: 65536 },
      });
      expect(JSON.stringify(request)).not.toContain("canary");
      return report;
    });
    const collected = await collectObservations(def, starting, { observe });
    if (!collected.ok) throw new Error("Expected bounded acquisition");
    expect(observe).toHaveBeenCalledTimes(1);
    expect(collected.evidence.observations[0]).toEqual(observation);
    expect(collected.receipt?.evidenceRefs).toEqual(["collected"]);
    expect(collected.receipt?.evidenceDigest).toBe(collected.evidence.evidenceDigest);
    expect(collected.evidence.evidenceDigest).not.toBe(starting.evidenceDigest);
    expect(verifyEvidenceBundle(def, collected.evidence).ok).toBe(true);
    const absent = unwrap(bundle(def, [fact]));
    observe.mockClear();
    expect(await collectObservations(def, absent, { observe })).toEqual({
      ok: true,
      evidence: absent,
      receipt: null,
    });
    expect(observe).not.toHaveBeenCalled();
    const { origin: _origin, ...reviewFact } = observation;
    const badReport = { ...report, observations: [...report.observations, reviewFact] };
    expect(parseObservationPortReport(badReport).ok).toBe(false);
    expect(
      await collectObservations(def, unwrap(bundle(def, [])), { observe: async () => badReport }),
    ).toMatchObject({ ok: false, outcome: "invalid_evidence" });
  });

  it("discloses only allowed public reasons and rejects forged qualitative outcomes", () => {
    for (const visibility of ["public", "restricted"]) {
      const def = definition(visibility);
      const bytes = new Set<string>();
      for (const reviewInput of [
        null,
        observation,
        { ...observation, reviewer: model },
        { ...observation, completeness: "truncated" as const },
      ]) {
        const observations: readonly Observation[] = reviewInput ? [fact, reviewInput] : [fact];
        const result = evaluate(def, unwrap(bundle(def, observations)));
        if (!("findings" in result)) throw new Error("Expected technical result");
        const projection = projectPublicResult(def, result);
        expect(projection).toMatchObject({
          ok: true,
          value: { outcome: visibility === "restricted" ? "withheld" : "pass" },
        });
        expect(JSON.stringify(projection)).not.toContain("canary");
        bytes.add(JSON.stringify(projection));
        const rejected = { ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" };
        const original = result.findings[1];
        for (const change of [
          { outcome: "pass", reasonCode: "MATCH" },
          { outcome: "fail", reasonCode: "VALUE_MISMATCH" },
          { outcome: "error", reasonCode: "COMPARATOR_ERROR" },
          { outcome: "inconclusive", reasonCode: "REFERENCE_UNAVAILABLE" },
          { outcome: "inconclusive", reasonCode: "EXECUTION_INCOMPLETE" },
          { outcome: "inconclusive", reasonCode: "ARTIFACT_MISSING" },
          { outcome: "inconclusive", reasonCode: "REVIEW_REQUIRED", evidenceRefs: [] },
          { outcome: "inconclusive", reasonCode: "EVIDENCE_MISSING", evidenceRefs: ["other"] },
          { outcome: "inconclusive", reasonCode: "REVIEW_REQUIRED", evidenceRefs: ["output-ref"] },
        ]) {
          expect(
            projectPublicResult(def, {
              ...result,
              findings: [result.findings[0], { ...original, ...change }],
            }),
          ).toEqual(rejected);
        }
        if (reviewInput) {
          const { artifactDigest: _digest, ...unbound } = result;
          expect(projectPublicResult(def, unbound)).toEqual(rejected);
        }
      }
      expect(bytes.size).toBe(visibility === "restricted" ? 1 : 3);
    }
  });
});
