import { describe, expect, it } from "vitest";
import {
  collectObservations,
  createAssessmentDefinition,
  createEvidenceBundle,
  createReferenceRecord,
  decodeSerializedRecord,
  evaluate,
  type ObservationPortRequest,
  parseEvaluationResult,
  projectPublicResult,
  type ValidationResult,
} from "../src/index";

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error("Invalid adversarial fixture");
  return result.value;
}

const publicCriterion = {
  id: "public",
  mode: "required",
  visibility: "public",
  kind: "exact_text",
  parameters: { expected: { type: "literal", value: "public-answer" } },
} as const;

const publicFact = {
  criterionId: "public",
  evidenceRef: "public-observation",
  kind: "text",
  completeness: "complete",
  value: "public-answer",
} as const;

function definition(criteria: readonly unknown[]) {
  return unwrap(
    createAssessmentDefinition({
      schemaVersion: 2,
      assessmentId: "adversarial",
      revision: "v1",
      policyVersion: "all-required-v1",
      criteria,
    }),
  );
}

const opaque = { ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" };

describe("AY-I24 generated adversarial boundary cases", () => {
  it("rejects deterministic malformed JSON mutations and escaped duplicate names", () => {
    for (let i = 0; i < 32; i++) {
      const key = `canary-${i}`;
      const valid = JSON.stringify({ [key]: [i, "😀", { nested: true }] });
      expect(decodeSerializedRecord(valid).ok).toBe(true);
      const mutations = [
        valid.slice(0, -1),
        valid.replace(":", ";"),
        `${valid}null`,
        `{"${key}":01}`,
        `{"${key}":1e+}`,
        `{"${key}":true false}`,
      ];
      for (const input of mutations) {
        expect(() => JSON.parse(input)).toThrow();
        const rejected = decodeSerializedRecord(input);
        expect(rejected).toEqual({
          ok: false,
          diagnostics: [{ path: "$", code: "INVALID_JSON" }],
        });
        expect(JSON.stringify(rejected)).not.toContain(key);
      }
      // Different raw encodings of the same decoded name must not collapse.
      const duplicate = `{"${key}":1,"\\u0063${key.slice(1)}":2}`;
      expect(JSON.parse(duplicate)).toEqual({ [key]: 2 });
      expect(decodeSerializedRecord(duplicate)).toEqual({
        ok: false,
        diagnostics: [{ path: "$", code: "DUPLICATE_KEY" }],
      });
    }
  });

  it("rejects unknown fields, accessors, cycles and unsafe keys without executing getters", () => {
    const rubric = definition([publicCriterion]);
    const evidence = unwrap(
      createEvidenceBundle(rubric, { schemaVersion: 2, observations: [publicFact] }),
    );
    let calls = 0;
    const accessor = Object.defineProperty({ ...rubric }, "PRIVATE_CANARY", {
      enumerable: true,
      get() {
        calls++;
        throw new Error("PRIVATE_CANARY");
      },
    });
    const cycle: Record<string, unknown> = { ...rubric };
    cycle.PRIVATE_CANARY = cycle;
    const hostile = JSON.parse('{"__proto__":{"PRIVATE_CANARY":true}}') as unknown;
    for (const input of [
      accessor,
      cycle,
      hostile,
      { ...rubric, PRIVATE_CANARY: true },
      { ...rubric, schemaVersion: 99 },
      { ...rubric, policyVersion: "PRIVATE_CANARY" },
    ]) {
      const result = evaluate(input, evidence);
      expect(result.outcome).toBe("invalid_definition");
      expect(result).not.toHaveProperty("findings");
      expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
      expect(projectPublicResult(input, result)).toEqual(opaque);
    }
    expect(calls).toBe(0);
    expect(evaluate(rubric, evidence).outcome).toBe("pass");
  });

  it("keeps public bytes constant over repeated protected probes and all hidden outcomes", () => {
    const expectedPublic = {
      ok: true,
      value: {
        schemaVersion: 1,
        outcome: "withheld",
        findings: [{ criterionId: "public", outcome: "pass", reason: "match" }],
      },
    };
    const publicBytes = JSON.stringify(expectedPublic);
    for (const expected of [1, Number.MAX_VALUE]) {
      const reference = unwrap(
        createReferenceRecord({
          schemaVersion: 2,
          referenceId: "PRIVATE_REFERENCE_CANARY",
          kind: "number",
          value: expected,
        }),
      );
      for (const mode of ["required", "advisory"]) {
        const hidden = {
          id: "PRIVATE_CRITERION_CANARY",
          mode,
          visibility: "restricted",
          kind: "number_with_tolerance",
          parameters: {
            expected: {
              type: "reference",
              referenceId: reference.referenceId,
              referenceDigest: reference.referenceDigest,
            },
            tolerance: { absolute: 0, relative: 2 },
          },
        };
        for (const criteria of [
          [publicCriterion, hidden],
          [hidden, publicCriterion],
        ]) {
          const rubric = definition(criteria);
          const hiddenFact = {
            criterionId: hidden.id,
            evidenceRef: "PRIVATE_EVIDENCE_CANARY",
            kind: "number",
            completeness: "complete",
            value: expected,
          };
          const probes = [
            { facts: [hiddenFact], supply: true, outcome: expected === 1 ? "pass" : "error" },
            {
              facts: [{ ...hiddenFact, value: 10 }],
              supply: true,
              outcome: expected === 1 ? "fail" : "error",
            },
            { facts: [], supply: true, outcome: "inconclusive" },
            { facts: [hiddenFact], supply: false, outcome: "inconclusive" },
            {
              facts: [{ ...hiddenFact, completeness: "truncated" }],
              supply: true,
              outcome: "inconclusive",
            },
          ];
          for (const probe of probes) {
            const evidence = unwrap(
              createEvidenceBundle(rubric, {
                schemaVersion: 2,
                observations: [publicFact, ...probe.facts],
              }),
            );
            const references = {
              schemaVersion: 2,
              definition: evidence.definition,
              references: [reference],
            };
            const result = evaluate(rubric, evidence, probe.supply ? references : undefined);
            if (!("findings" in result)) throw new Error("Expected a complete technical result");
            expect(result.findings.find((item) => item.criterionId === hidden.id)?.outcome).toBe(
              probe.outcome,
            );
            expect(result.outcome).toBe(
              mode === "advisory"
                ? "pass"
                : probe.outcome === "error"
                  ? "evaluation_error"
                  : probe.outcome,
            );
            expect(JSON.stringify(projectPublicResult(rubric, result))).toBe(publicBytes);
            const forged = {
              ...result,
              findings: result.findings.map((finding) => ({
                ...finding,
                reasonCode: "PRIVATE_REASON_CANARY",
              })),
            };
            expect(parseEvaluationResult(forged).ok).toBe(false);
            expect(projectPublicResult(rubric, forged)).toEqual(opaque);
            expect(
              projectPublicResult(rubric, { ...result, findings: [...result.findings].reverse() }),
            ).toEqual(opaque);
          }
        }
      }
    }
  });

  it("checks stream-specific truncation and empty reports through acquisition", async () => {
    for (const executionFact of ["stdout", "stderr"] as const) {
      const rubric = definition([{ ...publicCriterion, executionFact }]);
      const existing = unwrap(createEvidenceBundle(rubric, { schemaVersion: 2, observations: [] }));
      for (const stdoutTruncated of [false, true]) {
        for (const stderrTruncated of [false, true]) {
          const provenance = {
            adapterId: "synthetic-adapter",
            adapterVersion: "v1",
            runRef: "run1",
            toolchainId: "node",
            toolchainVersion: "v24",
            capturedStdoutBytes: 16,
            capturedStderrBytes: 16,
            stdoutTruncated,
            stderrTruncated,
          };
          const report = {
            schemaVersion: 2,
            definition: existing.definition,
            provenance,
            termination: "exited",
            observations: [{ ...publicFact, executionFact }],
          };
          const observe = async (request: ObservationPortRequest) => {
            expect(request.criteria).toEqual([
              { criterionId: "public", kind: "text", executionFact },
            ]);
            expect(JSON.stringify(request)).not.toContain("public-answer");
            return report;
          };
          const collected = await collectObservations(rubric, existing, { observe });
          if (!collected.ok) throw new Error("Expected a bounded report");
          const truncated = executionFact === "stdout" ? stdoutTruncated : stderrTruncated;
          expect(collected.evidence.observations[0].completeness).toBe(
            truncated ? "truncated" : "complete",
          );
          expect(evaluate(rubric, collected.evidence).outcome).toBe(
            truncated ? "inconclusive" : "pass",
          );
          expect(collected.receipt?.evidenceDigest).toBe(collected.evidence.evidenceDigest);
          const empty = await collectObservations(rubric, existing, {
            observe: async () => ({ ...report, observations: [] }),
          });
          if (!empty.ok) throw new Error("Expected a valid empty report");
          expect(evaluate(rubric, empty.evidence).outcome).toBe("inconclusive");
          expect(existing.observations).toHaveLength(0);
          const unsolicited = await collectObservations(rubric, existing, {
            observe: async () => ({
              ...report,
              observations: [{ ...publicFact, executionFact, criterionId: "PRIVATE_CANARY" }],
            }),
          });
          expect(unsolicited).toMatchObject({ ok: false, outcome: "invalid_evidence" });
          expect(unsolicited).not.toHaveProperty("receipt");
          expect(JSON.stringify(unsolicited)).not.toContain("PRIVATE_CANARY");
        }
      }
    }
  });
});
