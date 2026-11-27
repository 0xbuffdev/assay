import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  collectObservations,
  createAssessmentDefinition,
  createEvidenceBundle,
  evaluate,
  parseEvaluationResult,
  parseEvidenceBundle,
  projectPublicResult,
  type ValidationResult,
  verifyEvidenceBundle,
} from "../src/index";
import { digestA, digestB, referenceOf, sealEvidenceFixture } from "./fixtures/contracts";

const expectedDigest = "sha256:af87dee83e1f9f559206a33d8251796767f001dd743676ae54ac7efe1b6128e3";
const bytes =
  '{"artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","definition":{"assessmentId":"vector","revision":"rev1","revisionDigest":"sha256:e6382f984b711c58df762bcff7eba872246638a30a60ab07d807f6b7a9e35e8b"},"observations":[{"completeness":"complete","criterionId":"output","evidenceRef":"obs1","kind":"text","origin":{"artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"artifact","runRef":"run1","sourceRef":"fixture"},"value":"café\\n"}],"schemaVersion":2}';

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error("Invalid synthetic fixture");
  return result.value;
}

const criterion = {
  id: "output",
  kind: "exact_text",
  mode: "required",
  visibility: "public",
  parameters: { expected: { type: "literal", value: "café\n" } },
} as const;

function definition(two = false) {
  return unwrap(
    createAssessmentDefinition({
      schemaVersion: 1,
      assessmentId: "vector",
      revision: "rev1",
      policyVersion: "policy1",
      criteria: two ? [criterion, { ...criterion, id: "second" }] : [criterion],
    }),
  );
}

const fact = {
  criterionId: "output",
  evidenceRef: "obs1",
  completeness: "complete",
  kind: "text",
  value: "café\n",
} as const;
const artifactOrigin = {
  kind: "artifact",
  artifactDigest: digestA,
  sourceRef: "fixture",
  runRef: "run1",
} as const;
const draft = {
  schemaVersion: 2,
  artifactDigest: digestA,
  observations: [{ ...fact, origin: artifactOrigin }],
} as const;
const provenance = {
  adapterId: "runner",
  adapterVersion: "v1",
  runRef: "run2",
  toolchainId: "node",
  toolchainVersion: "v24",
  capturedStdoutBytes: 6,
  capturedStderrBytes: 0,
  stdoutTruncated: false,
  stderrTruncated: false,
} as const;

describe("AY-I15 evidence identity and scoped claims", () => {
  it("pins an independently calculated canonical UTF-8 evidence digest", () => {
    const rubric = definition();
    const evidence = unwrap(createEvidenceBundle(rubric, draft));
    const independent = createHash("sha256").update(`assay:evidence:v2\n${bytes}`, "utf8");
    expect(`sha256:${independent.digest("hex")}`).toBe(expectedDigest);
    expect(evidence.evidenceDigest).toBe(expectedDigest);
    expect(unwrap(verifyEvidenceBundle(rubric, evidence))).toEqual(evidence);
    expect(Object.isFrozen(evidence.observations[0].origin)).toBe(true);
    const result = evaluate(rubric, evidence);
    expect(result).toMatchObject({
      schemaVersion: 2,
      outcome: "pass",
      definition: referenceOf(rubric),
      evidenceDigest: expectedDigest,
      artifactDigest: digestA,
    });
    expect(parseEvaluationResult(result).ok).toBe(true);
    const publicView = projectPublicResult(rubric, result);
    expect(JSON.stringify(publicView)).not.toContain(expectedDigest);
    expect(JSON.stringify(publicView)).not.toContain(digestA);
    expect(JSON.stringify(publicView)).not.toContain("fixture");
    expect(evaluate(rubric, structuredClone(evidence))).toEqual(result);
    const reordered = unwrap(
      createEvidenceBundle(rubric, {
        observations: draft.observations,
        artifactDigest: digestA,
        schemaVersion: 2,
      }),
    );
    expect(reordered.evidenceDigest).toBe(expectedDigest);
  });

  it("rejects modified evidence before comparison or provider invocation", async () => {
    const rubric = definition();
    const evidence = unwrap(createEvidenceBundle(rubric, draft));
    const changed = {
      ...evidence,
      observations: [{ ...evidence.observations[0], value: "PRIVATE_EVIDENCE_CANARY" }],
    };
    expect(parseEvidenceBundle(changed).ok).toBe(true);
    const invalid = evaluate(rubric, changed);
    expect(invalid).toEqual({
      outcome: "invalid_evidence",
      diagnostics: [{ path: "$.evidenceDigest", code: "EVIDENCE_DIGEST_MISMATCH" }],
    });
    expect(JSON.stringify(invalid)).not.toContain("PRIVATE_EVIDENCE_CANARY");
    const observe = vi.fn(async () => ({}));
    expect(await collectObservations(rubric, changed, { observe })).toMatchObject({
      ok: false,
      outcome: "invalid_evidence",
    });
    expect(observe).not.toHaveBeenCalled();
    const corrected = unwrap(
      createEvidenceBundle(rubric, { ...draft, observations: changed.observations }),
    );
    expect(corrected.evidenceDigest).not.toBe(evidence.evidenceDigest);
    expect(evaluate(rubric, corrected).outcome).toBe("fail");
    expect(createEvidenceBundle(rubric, { ...draft, definition: evidence.definition }).ok).toBe(
      false,
    );
    expect(createEvidenceBundle(rubric, { ...draft, evidenceDigest: expectedDigest }).ok).toBe(
      false,
    );
    expect(evaluate(rubric, { ...evidence, schemaVersion: 1 }).outcome).toBe("invalid_evidence");
    const { evidenceDigest: _digest, ...unsealed } = evidence;
    expect(evaluate(rubric, unsealed).outcome).toBe("invalid_evidence");
  });

  it("binds order, definition lineage, artifact scope and origin metadata", () => {
    const rubric = definition(true);
    const observations = [
      ...draft.observations,
      { ...fact, criterionId: "second", evidenceRef: "obs2", origin: artifactOrigin },
    ];
    const evidence = unwrap(createEvidenceBundle(rubric, { ...draft, observations }));
    const reverse = unwrap(
      createEvidenceBundle(rubric, { ...draft, observations: [...observations].reverse() }),
    );
    expect(reverse.evidenceDigest).not.toBe(evidence.evidenceDigest);
    const otherRun = unwrap(
      createEvidenceBundle(rubric, {
        ...draft,
        observations: [
          observations[0],
          { ...observations[1], origin: { ...artifactOrigin, runRef: "different" } },
        ],
      }),
    );
    expect(otherRun.evidenceDigest).not.toBe(evidence.evidenceDigest);
    expect(verifyEvidenceBundle(definition(), evidence).ok).toBe(false);
    for (const bad of [
      { ...draft, artifactDigest: digestB },
      { ...draft, observations: [fact] },
      { schemaVersion: 2, observations: draft.observations },
      {
        ...draft,
        observations: [
          observations[0],
          {
            ...observations[1],
            origin: { kind: "independent", sourceRef: "fixture", runRef: "run1" },
          },
        ],
      },
      { ...draft, observations: [observations[0], { ...observations[1], evidenceRef: "obs1" }] },
      { ...draft, observations: [observations[0], observations[0]] },
    ]) {
      expect(createEvidenceBundle(rubric, bad).ok).toBe(false);
    }
    const wrongLineage = sealEvidenceFixture({
      ...evidence,
      definition: { ...evidence.definition, revisionDigest: digestB },
    });
    expect(verifyEvidenceBundle(rubric, wrongLineage)).toMatchObject({
      ok: false,
      diagnostics: [{ path: "$.definition", code: "MISMATCHED_DEFINITION" }],
    });
  });

  it("prevents retroactive scope binding and attaches claims only to returned facts", async () => {
    const rubric = definition(true);
    const initial = unwrap(
      createEvidenceBundle(rubric, { schemaVersion: 2, observations: [fact] }),
    );
    const report = {
      schemaVersion: 2,
      definition: referenceOf(rubric),
      artifactDigest: digestA,
      provenance,
      observations: [{ ...fact, criterionId: "second", evidenceRef: "obs2" }],
    };
    const late = await collectObservations(rubric, initial, { observe: async () => report });
    expect(late).toMatchObject({ ok: false, outcome: "invalid_evidence" });
    const scoped = unwrap(
      createEvidenceBundle(rubric, {
        schemaVersion: 2,
        artifactDigest: digestA,
        observations: [{ ...fact, origin: { kind: "independent", sourceRef: "local" } }],
      }),
    );
    const collected = await collectObservations(rubric, scoped, {
      observe: async () => ({
        ...report,
        provenance: { ...provenance, stdoutTruncated: true },
      }),
    });
    if (!collected.ok) throw new Error("Expected scoped collection");
    expect(collected.evidence.observations[0]).toEqual(scoped.observations[0]);
    expect(collected.evidence.observations[1]).toMatchObject({
      completeness: "truncated",
      origin: {
        kind: "artifact",
        artifactDigest: digestA,
        sourceRef: "runner",
        runRef: "run2",
        provenance: { ...provenance, stdoutTruncated: true },
      },
    });
    expect(collected.receipt).toMatchObject({
      evidenceDigest: collected.evidence.evidenceDigest,
      artifactDigest: digestA,
      evidenceRefs: ["obs2"],
    });
    expect(Object.isFrozen(collected.receipt?.evidenceRefs)).toBe(true);
    expect(verifyEvidenceBundle(rubric, collected.evidence).ok).toBe(true);
    expect(evaluate(rubric, collected.evidence).outcome).toBe("inconclusive");

    const empty = unwrap(createEvidenceBundle(rubric, { schemaVersion: 2, observations: [] }));
    const introduced = await collectObservations(rubric, empty, { observe: async () => report });
    expect(introduced).toMatchObject({
      ok: true,
      evidence: { artifactDigest: digestA },
      receipt: { evidenceRefs: ["obs2"] },
    });
    const forgedOrigin = await collectObservations(rubric, scoped, {
      observe: async () => ({
        ...report,
        observations: [{ ...report.observations[0], origin: artifactOrigin }],
      }),
    });
    expect(forgedOrigin).toMatchObject({ ok: false, outcome: "invalid_evidence" });
  });

  it("does not accept inconsistent or complete truncated origin claims", () => {
    const rubric = definition();
    const origin = {
      kind: "artifact",
      artifactDigest: digestA,
      sourceRef: "runner",
      runRef: "run2",
      provenance: { ...provenance, stderrTruncated: true },
    };
    expect(createEvidenceBundle(rubric, { ...draft, observations: [{ ...fact, origin }] }).ok).toBe(
      false,
    );
    const truncated = [{ ...fact, completeness: "truncated", origin }];
    expect(createEvidenceBundle(rubric, { ...draft, observations: truncated }).ok).toBe(true);
    expect(
      createEvidenceBundle(rubric, {
        ...draft,
        observations: [{ ...truncated[0], origin: { ...origin, runRef: "conflict" } }],
      }).ok,
    ).toBe(false);
  });
});
