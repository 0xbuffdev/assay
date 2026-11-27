import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  collectObservations,
  createEvidenceBundle,
  evaluate,
  parseEvaluationResult,
  parseEvidenceBundle,
  projectPublicResult,
  type ValidationResult,
  verifyEvidenceBundle,
} from "../src/index";
import {
  createAllDefinition,
  digestA,
  digestB,
  referenceOf,
  sealEvidenceFixture,
} from "./fixtures/contracts";

const expectedDigest = "sha256:508c376f6f33fc3b9ae6c34d362d26ea208b4d96578a8c7524d0f7d7daedc2f0";
const bytes =
  '{"artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","definition":{"assessmentId":"vector","revision":"rev1","revisionDigest":"sha256:db53afe46dc26651f77a64613a6d059fdeefff1caeb0947c92c567db478f13a2"},"observations":[{"completeness":"complete","criterionId":"output","evidenceRef":"obs1","kind":"text","origin":{"artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"artifact","runRef":"run1","sourceRef":"fixture"},"value":"café\\n"}],"schemaVersion":4}';

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

function definition(two = false, secondMode: "required" | "advisory" = "required") {
  return unwrap(
    createAllDefinition({
      schemaVersion: 4,
      assessmentId: "vector",
      revision: "rev1",
      policyVersion: "composed-required-v1",
      criteria: two ? [criterion, { ...criterion, id: "second", mode: secondMode }] : [criterion],
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
  schemaVersion: 4,
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
    const independent = createHash("sha256").update(`assay:evidence:v4\n${bytes}`, "utf8");
    expect(`sha256:${independent.digest("hex")}`).toBe(expectedDigest);
    expect(evidence.evidenceDigest).toBe(expectedDigest);
    expect(unwrap(verifyEvidenceBundle(rubric, evidence))).toEqual(evidence);
    expect(Object.isFrozen(evidence.observations[0].origin)).toBe(true);
    const result = evaluate(rubric, evidence);
    expect(result).toMatchObject({
      schemaVersion: 4,
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
        schemaVersion: 4,
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
      { schemaVersion: 4, observations: draft.observations },
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
      createEvidenceBundle(rubric, { schemaVersion: 4, observations: [fact] }),
    );
    const report = {
      schemaVersion: 4,
      definition: referenceOf(rubric),
      artifactDigest: digestA,
      provenance,
      observations: [{ ...fact, criterionId: "second", evidenceRef: "obs2" }],
    };
    const late = await collectObservations(rubric, initial, { observe: async () => report });
    expect(late).toMatchObject({ ok: false, outcome: "invalid_evidence" });
    const scoped = unwrap(
      createEvidenceBundle(rubric, {
        schemaVersion: 4,
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

    const empty = unwrap(createEvidenceBundle(rubric, { schemaVersion: 4, observations: [] }));
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

  it("rejects a complete same-run fact without provenance in either observation order", () => {
    const rubric = definition(true, "advisory");
    for (const flag of ["stdoutTruncated", "stderrTruncated"] as const) {
      const origin = { ...artifactOrigin, sourceRef: "runner", runRef: "run2" };
      const required = { ...fact, origin };
      const advisory = {
        ...fact,
        criterionId: "second",
        evidenceRef: "obs2",
        completeness: "truncated",
        origin: { ...origin, provenance: { ...provenance, [flag]: true } },
      };
      for (const observations of [
        [required, advisory],
        [advisory, required],
      ]) {
        const input = { ...draft, observations };
        const diagnostic = {
          path: `$.observations[${observations.indexOf(required)}].completeness`,
          code: "MISMATCHED_ORIGIN",
        };
        const sealed = sealEvidenceFixture({ ...input, definition: referenceOf(rubric) });
        expect(createEvidenceBundle(rubric, input)).toMatchObject({
          ok: false,
          diagnostics: [diagnostic],
        });
        expect(verifyEvidenceBundle(rubric, sealed)).toMatchObject({
          ok: false,
          diagnostics: [diagnostic],
        });
        expect(evaluate(rubric, sealed)).toEqual({
          outcome: "invalid_evidence",
          diagnostics: [diagnostic],
        });
      }

      // Distinct source/run pairs must not inherit one another's truncation.
      for (const independentOrigin of [
        { ...origin, sourceRef: "another-source" },
        { ...origin, runRef: "another-run" },
        { kind: "independent", sourceRef: "local" },
      ]) {
        const sealed = unwrap(
          createEvidenceBundle(rubric, {
            ...draft,
            observations: [{ ...required, origin: independentOrigin }, advisory],
          }),
        );
        expect(evaluate(rubric, sealed).outcome).toBe("pass");
      }

      const completeRun = unwrap(
        createEvidenceBundle(rubric, {
          ...draft,
          observations: [required, { ...advisory, origin: { ...origin, provenance } }],
        }),
      );
      expect(evaluate(rubric, completeRun).outcome).toBe("pass");
      const truncatedRun = unwrap(
        createEvidenceBundle(rubric, {
          ...draft,
          observations: [{ ...required, completeness: "truncated" }, advisory],
        }),
      );
      expect(evaluate(rubric, truncatedRun).outcome).toBe("inconclusive");
    }
  });

  it("rejects a merge revealing truncation of an existing complete same-run fact", async () => {
    const rubric = definition(true, "advisory");
    const origin = { ...artifactOrigin, sourceRef: "runner", runRef: "run2" };
    const initial = unwrap(
      createEvidenceBundle(rubric, { ...draft, observations: [{ ...fact, origin }] }),
    );
    expect(evaluate(rubric, initial).outcome).toBe("pass");
    const snapshot = structuredClone(initial);
    for (const flag of ["stdoutTruncated", "stderrTruncated"] as const) {
      const observe = vi.fn(async () => ({
        schemaVersion: 4,
        definition: referenceOf(rubric),
        artifactDigest: digestA,
        provenance: { ...provenance, [flag]: true },
        observations: [{ ...fact, criterionId: "second", evidenceRef: "obs2" }],
      }));
      const collected = await collectObservations(rubric, initial, { observe });
      expect(observe).toHaveBeenCalledOnce();
      expect(collected).toEqual({
        ok: false,
        outcome: "invalid_evidence",
        diagnostics: [{ path: "$.observations[0].completeness", code: "MISMATCHED_ORIGIN" }],
      });
      expect(initial).toEqual(snapshot);
      expect(initial.observations[0].completeness).toBe("complete");
    }
  });
});
