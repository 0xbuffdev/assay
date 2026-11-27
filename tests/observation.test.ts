import { describe, expect, it, vi } from "vitest";
import {
  type AssessmentDefinition,
  CONTRACT_LIMITS,
  collectObservations,
  type EvidenceBundle,
  evaluate,
  type ObservationCollectionResult,
  type ObservationPort,
  type ObservationPortReport,
  type ObservationPortRequest,
  parseObservationPortReport,
} from "../src/index";
import {
  digestA,
  digestB,
  definition as exampleDefinition,
  evidence as exampleEvidence,
  referenceOf,
  sealDefinition,
  sealEvidenceFixture,
} from "./fixtures/contracts";

const outputCriterion = {
  id: "output",
  mode: "required",
  visibility: "public",
  kind: "exact_text",
  parameters: { expected: { type: "literal", value: "ok" } },
} as const;

function definition(): AssessmentDefinition<1> {
  const original = exampleDefinition();
  return sealDefinition({ ...original, criteria: [outputCriterion] });
}

function evidence(rubric = definition()): EvidenceBundle {
  const original = exampleEvidence();
  return sealEvidenceFixture({
    ...original,
    definition: referenceOf(rubric),
    observations: [],
    artifactDigest: digestA,
  });
}

type UnselectedReport = ObservationPortReport & { termination?: never };

function report(overrides: Partial<UnselectedReport> = {}): UnselectedReport {
  return {
    schemaVersion: 2,
    definition: referenceOf(definition()),
    artifactDigest: digestA,
    provenance: {
      adapterId: "mock-runner",
      adapterVersion: "v1",
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
        evidenceRef: "stdout1",
        kind: "text",
        completeness: "complete",
        value: "ok",
      },
    ],
    ...overrides,
  };
}

function successful(
  value: ObservationCollectionResult,
): Extract<ObservationCollectionResult, { ok: true }> {
  if (!value.ok) throw new Error("Expected successful bounded collection");
  return value;
}

function failed(
  value: ObservationCollectionResult,
): Exclude<ObservationCollectionResult, { ok: true }> {
  if (value.ok) throw new Error("Expected invalid input or port error");
  return value;
}

function provider(value: unknown): ObservationPort {
  return { observe: async () => value };
}

describe("AY-I03 optional injected observation port", () => {
  it("passes only public requested facts to a mock port without references or expected answers", async () => {
    const original = exampleDefinition();
    const input = sealDefinition({
      ...original,
      criteria: [
        ...original.criteria,
        {
          id: "hiddenUnit",
          mode: "advisory",
          kind: "observed_execution",
          visibility: "restricted",
          parameters: { assertions: [{ id: "secretAssertion", referenceId: "PRIVATE_TEST_REF" }] },
        },
      ],
    });
    const observed = sealEvidenceFixture({
      ...exampleEvidence(),
      definition: referenceOf(input),
      artifactDigest: digestA,
      observations: exampleEvidence().observations.map((observation) => ({
        ...observation,
        origin: {
          kind: "independent",
          sourceRef: "local",
          ...(observation.kind === "execution" ? { runRef: observation.runRef } : {}),
        },
      })),
    });
    const callback = vi.fn(async (request: unknown) => {
      const serialized = JSON.stringify(request);
      expect(serialized).not.toContain("PRIVATE_TEST_REF");
      expect(serialized).not.toContain("secretAssertion");
      expect(serialized).not.toContain("reviewer-reference");
      expect(serialized).not.toContain("42\\n");
      expect(serialized).not.toContain("hiddenUnit");
      expect(serialized).not.toContain("expected");
      expect(serialized).not.toContain("trusted");
      expect(request).toMatchObject({
        schemaVersion: 2,
        definition: referenceOf(input),
        artifactDigest: digestA,
        criteria: [{ criterionId: "members", kind: "set", itemType: "string" }],
        limits: { maxCapturedBytes: CONTRACT_LIMITS.maxCapturedBytes },
      });
      expect(Object.isFrozen(request)).toBe(true);
      return report({
        definition: referenceOf(input),
        observations: [
          {
            criterionId: "members",
            evidenceRef: "members-from-runner",
            kind: "set",
            itemType: "string",
            items: ["a", "b"],
            completeness: "complete",
          },
        ],
      });
    });
    const result = successful(await collectObservations(input, observed, { observe: callback }));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(result.evidence.observations).toHaveLength(4);
    expect(result.receipt?.definition.revisionDigest).toBe(input.revisionDigest);
    expect(result.receipt?.provenance).toMatchObject({ adapterId: "mock-runner", runRef: "run1" });
    expect("trusted" in (result.receipt?.provenance ?? {})).toBe(false);
  });

  it("supports an independently authorized local literal comparison without formal credit", async () => {
    const collected = successful(
      await collectObservations(definition(), evidence(), provider(report())),
    );
    const result = evaluate(definition(), collected.evidence);
    expect(result.outcome).toBe("pass");
    expect("grade" in result).toBe(false);
    expect("certificate" in result).toBe(false);
    expect(Object.isFrozen(collected.evidence)).toBe(true);
    expect(Object.isFrozen(collected.receipt)).toBe(true);
  });

  it("never upgrades observed execution assertions to trusted correctness", async () => {
    const selected = exampleDefinition().criteria.find(
      (item) => item.kind === "observed_execution",
    );
    if (selected?.kind !== "observed_execution") throw new Error("fixture");
    const chosen = { ...selected, mode: "required" as const, visibility: "public" as const };
    const requestedDefinition = sealDefinition({ ...definition(), criteria: [chosen] });
    const seen = vi.fn(async (request: unknown) => {
      expect(request).toMatchObject({
        criteria: [{ criterionId: "program", kind: "execution", assertionIds: ["unit1"] }],
      });
      expect(JSON.stringify(request)).not.toContain("verified-unit1");
      return report({
        definition: referenceOf(requestedDefinition),
        observations: [
          {
            criterionId: "program",
            evidenceRef: "run-observation",
            kind: "execution",
            completeness: "complete",
            runRef: "run1",
            assertions: [{ assertionId: "unit1", state: "confirmed" }],
          },
        ],
      });
    });
    const collected = successful(
      await collectObservations(requestedDefinition, evidence(requestedDefinition), {
        observe: seen,
      }),
    );
    const outcome = evaluate(requestedDefinition, collected.evidence);
    expect(outcome.outcome).toBe("inconclusive");
    if ("findings" in outcome) expect(outcome.findings[0].reasonCode).toBe("EXECUTION_UNVERIFIED");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("never invokes the port for solely restricted or manual criteria", async () => {
    const root = exampleDefinition();
    const restricted = root.criteria.find((item) => item.kind === "normalized_text");
    const manual = root.criteria.find((item) => item.kind === "manual_evidence");
    if (!restricted || !manual) throw new Error("fixture");
    const configured = sealDefinition({
      ...root,
      criteria: [{ ...restricted, mode: "required" }, manual],
    });
    const observe = vi.fn(async () => {
      throw new Error("SHOULD_NOT_RUN");
    });
    const response = successful(
      await collectObservations(configured, evidence(configured), { observe }),
    );
    expect(observe).not.toHaveBeenCalled();
    expect(response.receipt).toBeNull();
    expect(response.evidence.observations).toEqual([]);
    expect(evaluate(configured, response.evidence).outcome).toBe("inconclusive");
  });

  it("does not overwrite caller-supplied observations and avoids redundant provider calls", async () => {
    const observe = vi.fn(async () => {
      throw new Error("SHOULD_NOT_RUN");
    });
    const starting = sealEvidenceFixture({
      ...evidence(),
      observations: [
        {
          criterionId: "output",
          evidenceRef: "existing",
          origin: { kind: "independent", sourceRef: "local" },
          kind: "text",
          value: "wrong",
          completeness: "complete",
        },
      ],
    });
    const response = successful(await collectObservations(definition(), starting, { observe }));
    expect(response.receipt).toBeNull();
    expect(observe).not.toHaveBeenCalled();
    expect(evaluate(definition(), response.evidence).outcome).toBe("fail");
  });

  it("downgrades captured observations when stdout or stderr is truncated", async () => {
    for (const name of ["stdoutTruncated", "stderrTruncated"] as const) {
      const provenance = { ...report().provenance, [name]: true };
      const response = successful(
        await collectObservations(definition(), evidence(), provider(report({ provenance }))),
      );
      expect(response.evidence.observations[0].completeness).toBe("truncated");
      const result = evaluate(definition(), response.evidence);
      expect(result.outcome).toBe("inconclusive");
      if ("findings" in result) expect(result.findings[0].reasonCode).toBe("EVIDENCE_TRUNCATED");
    }
  });

  it("rejects forged trusted markers, grades and unsolicited restricted observations", async () => {
    const base = report();
    for (const data of [
      { ...base, provenance: { ...base.provenance, trusted: true } },
      { ...base, credited: true },
      { ...base, observations: [{ ...base.observations[0], result: "pass", trusted: true }] },
    ]) {
      const value = await collectObservations(definition(), evidence(), provider(data));
      expect(value.ok).toBe(false);
      expect(failed(value).outcome).toBe("invalid_evidence");
    }

    const invalid = await collectObservations(
      definition(),
      evidence(),
      provider(
        report({
          observations: [
            {
              criterionId: "restrictedPrivate",
              evidenceRef: "leak",
              kind: "text",
              value: "private",
              completeness: "complete",
            },
          ],
        }),
      ),
    );
    expect(failed(invalid).outcome).toBe("invalid_evidence");
    expect(JSON.stringify(invalid)).not.toContain("private");
  });

  it("rejects mismatched provenance lineage and artifact digest claims", async () => {
    const wrongDefinition = await collectObservations(
      definition(),
      evidence(),
      provider(
        report({
          definition: { ...report().definition, revisionDigest: digestB },
        }),
      ),
    );
    expect(failed(wrongDefinition).outcome).toBe("invalid_evidence");

    const wrongArtifact = await collectObservations(
      definition(),
      evidence(),
      provider(
        report({
          artifactDigest: digestB,
        }),
      ),
    );
    expect(failed(wrongArtifact).outcome).toBe("invalid_evidence");
    expect(JSON.stringify(wrongArtifact)).not.toContain(digestB);
  });

  it("rejects mismatched run refs and undeclared execution assertions", async () => {
    const selected = exampleDefinition().criteria.find(
      (item) => item.kind === "observed_execution",
    );
    if (selected?.kind !== "observed_execution") throw new Error("fixture");
    const configured = sealDefinition({
      ...definition(),
      criteria: [{ ...selected, visibility: "public", mode: "required" }],
    });
    const observation = {
      criterionId: "program",
      evidenceRef: "exec1",
      kind: "execution" as const,
      completeness: "complete" as const,
      runRef: "another-run",
      assertions: [{ assertionId: "unit1", state: "confirmed" as const }],
    };
    const wrongRun = await collectObservations(
      configured,
      evidence(configured),
      provider(report({ definition: referenceOf(configured), observations: [observation] })),
    );
    expect(failed(wrongRun).outcome).toBe("invalid_evidence");
    const wrongAssertion = await collectObservations(
      configured,
      evidence(configured),
      provider(
        report({
          definition: referenceOf(configured),
          observations: [
            {
              ...observation,
              runRef: "run1",
              assertions: [{ assertionId: "unlisted", state: "confirmed" }],
            },
          ],
        }),
      ),
    );
    expect(failed(wrongAssertion).outcome).toBe("invalid_evidence");
  });

  it("rejects duplicate evidence references, wrong kinds and provider attempts to replace evidence", async () => {
    const incompatible = await collectObservations(
      definition(),
      evidence(),
      provider(
        report({
          observations: [
            {
              criterionId: "output",
              evidenceRef: "numeric",
              kind: "number",
              value: 42,
              completeness: "complete",
            },
          ],
        }),
      ),
    );
    expect(failed(incompatible).outcome).toBe("invalid_evidence");

    const root = sealDefinition(exampleDefinition());
    const base = sealEvidenceFixture({
      ...exampleEvidence(),
      definition: referenceOf(root),
      artifactDigest: digestA,
      observations: exampleEvidence().observations.map((observation) => ({
        ...observation,
        origin: {
          kind: "independent",
          sourceRef: "local",
          ...(observation.kind === "execution" ? { runRef: observation.runRef } : {}),
        },
      })),
    });
    // "members" is missing, while ev-output is already used by the base bundle.
    const reused = await collectObservations(
      root,
      base,
      provider(
        report({
          definition: referenceOf(root),
          observations: [
            {
              criterionId: "members",
              evidenceRef: "ev-output",
              kind: "set",
              itemType: "string",
              completeness: "complete",
              items: ["a", "b"],
            },
          ],
        }),
      ),
    );
    expect(failed(reused).outcome).toBe("invalid_evidence");
  });

  it("accepts an empty report without treating a completed run as passing evidence", async () => {
    const collected = successful(
      await collectObservations(definition(), evidence(), provider(report({ observations: [] }))),
    );
    expect(collected.evidence.observations).toHaveLength(0);
    expect(evaluate(definition(), collected.evidence).outcome).toBe("inconclusive");
    expect(collected.receipt?.provenance.runRef).toBe("run1");
  });

  it("reports port exceptions without leaking exception messages or stack details", async () => {
    const r = await collectObservations(definition(), evidence(), {
      observe: async () => {
        throw new Error("SECRET_ACCESS_TOKEN_IN_RUNNER_ERROR");
      },
    });
    expect(r).toEqual({
      ok: false,
      outcome: "evaluation_error",
      reasonCode: "OBSERVATION_PORT_ERROR",
    });
    expect(JSON.stringify(r)).not.toContain("SECRET_ACCESS_TOKEN");
  });

  it("rejects invalid provider provenance, output bounds and extra fields", () => {
    const base = report();
    const invalid = [
      {
        ...base,
        provenance: {
          ...base.provenance,
          capturedStdoutBytes: CONTRACT_LIMITS.maxCapturedBytes + 1,
        },
      },
      { ...base, provenance: { ...base.provenance, capturedStderrBytes: -1 } },
      {
        ...base,
        provenance: {
          ...base.provenance,
          capturedStdoutBytes: 40_000,
          capturedStderrBytes: 40_000,
        },
      },
      { ...base, provenance: { ...base.provenance, capturedStdoutBytes: 0.5 } },
      { ...base, provenance: { ...base.provenance, stdoutTruncated: "false" } },
      { ...base, provenance: { ...base.provenance, toolchainVersion: "latest" } },
    ];
    for (const input of invalid) {
      const result = parseObservationPortReport(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.domain).toBe("invalid_evidence");
    }
  });

  it("rejects accessor-based reports without invoking getters", async () => {
    let count = 0;
    const malicious: Record<string, unknown> = { ...report() };
    Object.defineProperty(malicious, "observations", {
      enumerable: true,
      get: () => {
        count++;
        return [];
      },
    });
    const result = await collectObservations(definition(), evidence(), provider(malicious));
    expect(failed(result).outcome).toBe("invalid_evidence");
    expect(count).toBe(0);
  });

  it("treats script markup as inert comparison data and never reflects it in a finding", async () => {
    const hostile = "<script>globalThis.__HACKED=1</script><img onerror=alert(1)>";
    const response = successful(
      await collectObservations(
        definition(),
        evidence(),
        provider(
          report({
            observations: [
              {
                criterionId: "output",
                evidenceRef: "safe-ref",
                kind: "text",
                value: hostile,
                completeness: "complete",
              },
            ],
          }),
        ),
      ),
    );
    const decision = evaluate(definition(), response.evidence);
    expect(decision.outcome).toBe("fail");
    expect(JSON.stringify(decision)).not.toContain("<script>");
    expect(JSON.stringify(decision)).not.toContain("onerror");
  });

  it("returns invalid inputs before invoking the runner and does not mint credit", async () => {
    const observe = vi.fn(async () => report());
    const bad = await collectObservations({ ...definition(), criteria: [] }, evidence(), {
      observe,
    });
    expect(failed(bad).outcome).toBe("invalid_definition");
    const forged = await collectObservations(
      definition(),
      { ...evidence(), trusted: true },
      { observe },
    );
    expect(failed(forged).outcome).toBe("invalid_evidence");
    expect(observe).not.toHaveBeenCalled();
    const valid = successful(
      await collectObservations(definition(), evidence(), provider(report())),
    );
    expect("credential" in valid).toBe(false);
    expect("grade" in valid).toBe(false);
    expect("trusted" in (valid.receipt ?? {})).toBe(false);
  });
});

describe("AY-I19 cooperative cancellation", () => {
  const cancelled = {
    ok: false,
    outcome: "evaluation_error",
    reasonCode: "OBSERVATION_CANCELLED",
  };

  it("does not invoke the provider with a pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort("PRIVATE_ABORT_REASON");
    const observe = vi.fn(async () => report());
    const result = await collectObservations(
      definition(),
      evidence(),
      { observe },
      {
        signal: controller.signal,
      },
    );
    expect(result).toEqual(cancelled);
    expect(observe).not.toHaveBeenCalled();
  });

  it("settles while a noncooperative provider is pending and ignores late resolution", async () => {
    const controller = new AbortController();
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>((done) => {
      resolve = done;
    });
    const observe = vi.fn((_request: ObservationPortRequest, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      return pending;
    });
    const nativePort: ObservationPort<AbortSignal> = { observe };
    const before = evidence();
    const remove = vi.spyOn(AbortSignal.prototype, "removeEventListener");
    const collection = collectObservations(definition(), before, nativePort, {
      signal: controller.signal,
    });
    expect(observe).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(await collection).toEqual(cancelled);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(remove.mock.contexts[0]).not.toBe(controller.signal);
    remove.mockRestore();
    resolve(report());
    await pending;
    expect(before.observations).toEqual([]);
    expect(await collection).toEqual(cancelled);
  });

  it("ignores synthetic native events and handles late rejection", async () => {
    const controller = new AbortController();
    let reject!: (reason: unknown) => void;
    const pending = new Promise<unknown>((_resolve, fail) => {
      reject = fail;
    });
    const observe = vi.fn(async () => pending);
    const remove = vi.spyOn(AbortSignal.prototype, "removeEventListener");
    const collection = collectObservations(
      definition(),
      evidence(),
      { observe },
      { signal: controller.signal },
    );
    controller.signal.dispatchEvent(new Event("abort"));
    expect(controller.signal.aborted).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    controller.abort();
    expect(await collection).toEqual(cancelled);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.contexts[0]).not.toBe(controller.signal);
    remove.mockRestore();
    reject(new Error("PRIVATE_LATE_REJECTION"));
    await Promise.resolve();
  });

  it("settles native abort despite a previously registered stopping listener", async () => {
    const controller = new AbortController();
    controller.signal.addEventListener("abort", (event) => event.stopImmediatePropagation());
    const collection = collectObservations(
      definition(),
      evidence(),
      { observe: () => new Promise(() => {}) },
      { signal: controller.signal },
    );
    controller.abort();
    expect(await collection).toEqual(cancelled);
  });

  it("ignores structural synthetic notifications and removes the subscription", async () => {
    let listener: (() => void) | undefined;
    const signal = {
      aborted: false,
      addEventListener(_type: "abort", callback: () => void) {
        listener = callback;
      },
      removeEventListener: vi.fn(() => {
        listener = undefined;
      }),
    };
    const collection = collectObservations(
      definition(),
      evidence(),
      { observe: () => new Promise(() => {}) },
      { signal },
    );
    listener?.();
    expect(signal.removeEventListener).not.toHaveBeenCalled();
    signal.aborted = true;
    listener?.();
    expect(await collection).toEqual(cancelled);
    expect(signal.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("handles synchronous abort and a late provider rejection", async () => {
    const controller = new AbortController();
    let reject!: (reason: unknown) => void;
    const pending = new Promise<unknown>((_resolve, fail) => {
      reject = fail;
    });
    const result = await collectObservations(
      definition(),
      evidence(),
      {
        observe() {
          controller.abort();
          return pending;
        },
      },
      { signal: controller.signal },
    );
    expect(result).toEqual(cancelled);
    reject(new Error("PRIVATE_LATE_REJECTION"));
    await Promise.resolve();
  });

  it("reports synchronous exceptions and removes listeners on success", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(AbortSignal.prototype, "removeEventListener");
    const result = await collectObservations(
      definition(),
      evidence(),
      {
        observe() {
          throw new Error("PRIVATE_PROVIDER_ERROR");
        },
      },
      { signal: controller.signal },
    );
    expect(result).toEqual({
      ok: false,
      outcome: "evaluation_error",
      reasonCode: "OBSERVATION_PORT_ERROR",
    });
    const success = await collectObservations(definition(), evidence(), provider(report()), {
      signal: controller.signal,
    });
    expect(success.ok).toBe(true);
    expect(remove).toHaveBeenCalledTimes(2);
    remove.mockRestore();
    controller.abort();
    expect(success.ok).toBe(true);
  });
});

describe("AY-I19 closed report metadata", () => {
  it("rejects a set with the wrong item type and duplicate reports", async () => {
    const rubric = sealDefinition({
      ...definition(),
      criteria: [
        {
          id: "members",
          mode: "required",
          visibility: "public",
          kind: "set_equivalence",
          parameters: {
            expected: { type: "literal", value: ["a"] },
            itemType: "string",
            order: "ignore",
            duplicates: "ignore",
          },
        },
      ],
    });
    const wrong = {
      criterionId: "members",
      evidenceRef: "set",
      kind: "set",
      itemType: "number",
      items: [1],
      completeness: "complete",
    } as const;
    const valid = { ...wrong, itemType: "string", items: ["a"] } as const;
    for (const observations of [[wrong], [valid, valid]]) {
      const collected = await collectObservations(rubric, evidence(rubric), {
        async observe(request) {
          expect(request.criteria).toEqual([
            { criterionId: "members", kind: "set", itemType: "string" },
          ]);
          return report({ definition: request.definition, observations });
        },
      });
      expect(failed(collected).outcome).toBe("invalid_evidence");
    }
  });
});
