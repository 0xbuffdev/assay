import { describe, expect, it } from "vitest";
import {
  type AssessmentDefinition,
  collectObservations,
  type EvidenceBundle,
  evaluate,
  inspectEvidenceCoverage,
  type ObservationPort,
  parseEvidenceBundle,
} from "../src/index";
import { referenceOf, sealDefinition, sealEvidenceFixture } from "./fixtures/contracts";

function definition(unit?: string): AssessmentDefinition {
  return sealDefinition({
    schemaVersion: 4,
    assessmentId: "unit-integrity",
    revision: "rev1",
    policyVersion: "composed-required-v1",
    criteria: [
      {
        id: "distance",
        kind: "number_with_tolerance",
        mode: "required",
        visibility: "public",
        parameters: {
          expected: { type: "literal", value: 2 },
          tolerance: { absolute: 0, relative: 0 },
          ...(unit === undefined ? {} : { unit }),
        },
      },
    ],
  });
}

function evidence(unit?: string, rubric = definition(unit)): EvidenceBundle {
  return sealEvidenceFixture({
    schemaVersion: 4,
    definition: referenceOf(rubric),
    observations: [
      {
        criterionId: "distance",
        evidenceRef: "distance1",
        completeness: "complete",
        kind: "number",
        value: 2,
        ...(unit === undefined ? {} : { unit }),
      },
    ],
  });
}

describe("AY-I05 numeric evidence unit integrity", () => {
  it("permits explicitly matching units and unchanged dimensionless comparisons", () => {
    expect(evaluate(definition("m"), evidence("m")).outcome).toBe("pass");
    expect(evaluate(definition(), evidence()).outcome).toBe("pass");
    const inspected = inspectEvidenceCoverage(definition("m"), evidence("m"));
    expect(inspected.ok).toBe(true);
    const parsed = parseEvidenceBundle(evidence("m"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.observations[0]).toMatchObject({
        kind: "number",
        value: 2,
        unit: "m",
      });
      expect(Object.isFrozen(parsed.value.observations[0])).toBe(true);
    }
  });

  it.each([
    ["m", "ft"],
    ["m", undefined],
    [undefined, "m"],
  ])("rejects mismatched/missing units: criterion %s and observation %s", (expected, actual) => {
    const rubric = definition(expected);
    const result = evaluate(rubric, evidence(actual, rubric));
    expect(result.outcome).toBe("invalid_evidence");
    if ("diagnostics" in result) {
      expect(result.diagnostics).toContainEqual({
        path: "$.observations[0].unit",
        code: "MISMATCHED_OBSERVATION",
      });
    }
  });

  it("rejects malformed units in observations and definitions", () => {
    for (const unit of ["", "m/s", "a".repeat(97), "meter\nprivate", 2, null]) {
      const invalidEvidence = parseEvidenceBundle({
        ...evidence(),
        observations: [{ ...evidence().observations[0], unit }],
      });
      expect(invalidEvidence.ok).toBe(false);
      const invalidDefinition = evaluate(
        {
          ...definition(),
          criteria: [
            {
              ...definition().criteria[0],
              parameters: {
                expected: { type: "literal", value: 2 },
                tolerance: { absolute: 0, relative: 0 },
                unit,
              },
            },
          ],
        },
        evidence(),
      );
      expect(invalidDefinition.outcome).toBe("invalid_definition");
    }
  });

  it("rejects a claimed provider observation with the wrong unit without trusting provenance", async () => {
    const port: ObservationPort = {
      observe: async (request) => {
        expect(request.criteria).toEqual([{ criterionId: "distance", kind: "number", unit: "m" }]);
        return {
          schemaVersion: 4,
          definition: request.definition,
          provenance: {
            adapterId: "simulated",
            adapterVersion: "v1",
            runRef: "run1",
            toolchainId: "node",
            toolchainVersion: "v24",
            capturedStdoutBytes: 0,
            capturedStderrBytes: 0,
            stdoutTruncated: false,
            stderrTruncated: false,
          },
          observations: [
            {
              criterionId: "distance",
              evidenceRef: "remoteNumber",
              completeness: "complete",
              kind: "number",
              value: 2,
              unit: "ft",
            },
          ],
        };
      },
    };
    const empty = sealEvidenceFixture({ ...evidence("m"), observations: [] });
    const result = await collectObservations(definition("m"), empty, port);
    expect(result.ok).toBe(false);
    if (!result.ok && "diagnostics" in result) {
      expect(result.diagnostics).toContainEqual({
        path: "$.observations[0].unit",
        code: "MISMATCHED_OBSERVATION",
      });
    }
  });

  it("does not normalize or automatically convert units", () => {
    expect(evaluate(definition("cm"), evidence("m", definition("cm"))).outcome).toBe(
      "invalid_evidence",
    );
    expect(evaluate(definition("m"), evidence("M", definition("m"))).outcome).toBe(
      "invalid_evidence",
    );
  });
});
