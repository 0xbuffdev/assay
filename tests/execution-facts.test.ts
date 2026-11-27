import { describe, expect, it } from "vitest";
import {
  collectObservations,
  createEvidenceBundle,
  createReferenceRecord,
  evaluate,
  inspectEvidenceCoverage,
  parseObservationPortReport,
  projectPublicResult,
} from "../src/index";
import { createAllDefinition } from "./fixtures/contracts";

const literal = (value: unknown) => ({ type: "literal", value });
const criterion = <P>(id: string, kind: string, executionFact: string, parameters: P) => ({
  id,
  kind,
  executionFact,
  parameters,
  mode: "required",
  visibility: "public",
});
const stdout = criterion("out", "exact_text", "stdout", { expected: literal("ok") });
const stderr = criterion("err", "exact_text", "stderr", { expected: literal("") });
const exit = criterion("exit", "number_with_tolerance", "exit_status", {
  expected: literal(0),
  tolerance: { absolute: 0, relative: 0 },
});
const property = criterion("property", "boolean_equality", "boolean_property", {
  expected: literal(false),
});
const json = criterion("json", "json_equality", "structured_stdout", {
  expected: literal({ result: [null, false] }),
});
const draft = (criteria: unknown[], schemaVersion = 3) => ({
  schemaVersion,
  assessmentId: "execution",
  revision: "rev1",
  policyVersion: "composed-required-v1",
  criteria,
});
const origin = {
  kind: "independent",
  sourceRef: "fixture",
  runRef: "run1",
  termination: "exited",
} as const;
const provenance = {
  adapterId: "fixture",
  adapterVersion: "v1",
  runRef: "run1",
  toolchainId: "fixture",
  toolchainVersion: "v1",
  capturedStdoutBytes: 2,
  capturedStderrBytes: 0,
  stdoutTruncated: true,
  stderrTruncated: false,
};
const fact = (id: string, kind: string, executionFact: string, value: unknown) => ({
  criterionId: id,
  evidenceRef: `fact-${id}`,
  completeness: "complete",
  kind,
  executionFact,
  value,
  origin,
});
const out = fact("out", "text", "stdout", "ok");
const err = fact("err", "text", "stderr", "");
const status = fact("exit", "number", "exit_status", 0);
const prop = fact("property", "boolean", "boolean_property", false);
const structured = fact("json", "json", "structured_stdout", { result: [null, false] });

function definition(criteria: unknown[]) {
  const sealed = createAllDefinition(draft(criteria));
  if (!sealed.ok) throw new Error("Invalid definition fixture");
  return sealed.value;
}

function run(criteria: unknown[], observations: unknown[]) {
  const rubric = definition(criteria);
  const evidence = createEvidenceBundle(rubric, { schemaVersion: 3, observations });
  if (!evidence.ok) return { outcome: evidence.domain };
  return evaluate(rubric, evidence.value);
}

describe("typed execution facts", () => {
  it("compares selected typed values, not execution assertions", () => {
    const cases = [
      [stdout, out, "wrong"],
      [stderr, err, "unexpected"],
      [exit, status, 1],
      [property, prop, true],
      [json, structured, { result: [false, null] }],
    ] as const;
    for (const [check, observation, mismatch] of cases) {
      expect(run([check], [observation]).outcome).toBe("pass");
      expect(run([check], [{ ...observation, value: mismatch }]).outcome).toBe("fail");
      expect(run([check], []).outcome).toBe("inconclusive");
      expect(run([check], [{ ...observation, completeness: "truncated" }]).outcome).toBe(
        "inconclusive",
      );
    }
    expect(run([stdout, exit], [status]).outcome).toBe("inconclusive");
    expect(run([stdout], [{ ...out, trusted: true }]).outcome).toBe("invalid_evidence");
    expect(
      run(
        [stdout],
        [
          {
            criterionId: "out",
            evidenceRef: "assertion",
            completeness: "complete",
            kind: "execution",
            runRef: "run1",
            assertions: [{ assertionId: "out", state: "confirmed" }],
          },
        ],
      ).outcome,
    ).toBe("invalid_evidence");
  });

  it("rejects wrong selectors, origins, versions and malformed exit status", () => {
    for (const observation of [
      { ...out, executionFact: "stderr" },
      { ...out, executionFact: "exit_status" },
      { ...out, executionFact: "unknown" },
      { ...out, origin: { kind: "independent", sourceRef: "fixture" } },
      { ...out, origin: { ...origin, termination: "unknown" } },
      { ...out, origin: undefined },
      { ...out, executionFact: undefined },
    ]) {
      expect(run([stdout], [observation]).outcome).toBe("invalid_evidence");
    }
    for (const value of [0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "0"]) {
      expect(run([exit], [{ ...status, value }]).outcome).toBe("invalid_evidence");
    }
    expect(run([exit], [{ ...status, unit: "m" }]).outcome).toBe("invalid_evidence");
    expect(createAllDefinition(draft([stdout], 1)).ok).toBe(false);
    expect(
      createAllDefinition(draft([{ ...stdout, executionFact: "exit_status" }])).ok,
    ).toBe(false);
    expect(
      createAllDefinition(
        draft([{ ...exit, parameters: { ...exit.parameters, unit: "m" } }]),
      ).ok,
    ).toBe(false);
  });

  it("does not interpret timeouts or crashes as matches or mismatches", () => {
    const rubric = definition([stdout]);
    for (const termination of ["timeout", "crash"]) {
      for (const value of ["ok", "wrong"]) {
        const sealed = createEvidenceBundle(rubric, {
          schemaVersion: 3,
          observations: [{ ...out, value, origin: { ...origin, termination } }],
        });
        if (!sealed.ok) throw new Error("Invalid evidence fixture");
        const result = evaluate(rubric, sealed.value);
        expect(result.outcome).toBe("inconclusive");
        if (!("findings" in result)) throw new Error("Expected findings");
        expect(result.findings[0].reasonCode).toBe("EXECUTION_INCOMPLETE");
        const coverage = inspectEvidenceCoverage(rubric, sealed.value);
        expect(coverage).toMatchObject({ ok: true, value: { incompleteRequired: ["out"] } });
      }
    }
    expect(
      run([stdout, stderr], [out, { ...err, origin: { ...origin, termination: "timeout" } }])
        .outcome,
    ).toBe("invalid_evidence");
  });

  it("uses relevant stream truncation over the whole run, independent of order", () => {
    const truncatedOut = {
      ...out,
      completeness: "truncated",
      origin: { ...origin, provenance },
    };
    expect(run([stdout, stderr, exit], [truncatedOut, err, status]).outcome).toBe("inconclusive");
    expect(run([stderr], [{ ...err, origin: { ...origin, provenance } }]).outcome).toBe("pass");
    expect(run([exit], [{ ...status, origin: { ...origin, provenance } }]).outcome).toBe("pass");
    expect(run([stdout], [{ ...out, origin: { ...origin, provenance } }]).outcome).toBe(
      "invalid_evidence",
    );
    for (const observations of [
      [truncatedOut, structured],
      [structured, truncatedOut],
      [truncatedOut, prop],
      [prop, truncatedOut],
    ]) {
      const checks = observations.some((observation) => observation.criterionId === "json")
        ? [stdout, json]
        : [stdout, property];
      expect(run(checks, observations).outcome).toBe("invalid_evidence");
    }
    expect(
      run(
        [stdout, property],
        [truncatedOut, { ...prop, origin: { ...origin, runRef: "other-run" } }],
      ).outcome,
    ).toBe("inconclusive");
    const stderrCapture = { ...provenance, stdoutTruncated: false, stderrTruncated: true };
    expect(
      run([stdout], [{ ...out, origin: { ...origin, provenance: stderrCapture } }]).outcome,
    ).toBe("pass");
    expect(
      run([stderr], [{ ...err, origin: { ...origin, provenance: stderrCapture } }]).outcome,
    ).toBe("invalid_evidence");
    expect(run([stdout, json], [{ ...out, completeness: "truncated" }, structured]).outcome).toBe(
      "invalid_evidence",
    );
  });

  it("binds selection and origin into content digests and preserves protected comparisons", () => {
    const reference = createReferenceRecord({
      schemaVersion: 3,
      referenceId: "hidden",
      kind: "text",
      value: "secret-output-canary",
    });
    if (!reference.ok) throw new Error("Invalid reference fixture");
    const rubric = definition([
      {
        ...stdout,
        visibility: "restricted",
        parameters: {
          expected: {
            type: "reference",
            referenceId: reference.value.referenceId,
            referenceDigest: reference.value.referenceDigest,
          },
        },
      },
    ]);
    const evidence = createEvidenceBundle(rubric, {
      schemaVersion: 3,
      observations: [{ ...out, value: "secret-output-canary" }],
    });
    if (!evidence.ok) throw new Error("Invalid evidence fixture");
    const refs = {
      schemaVersion: 3,
      definition: evidence.value.definition,
      references: [reference.value],
    };
    expect(evaluate(rubric, evidence.value).outcome).toBe("inconclusive");
    const result = evaluate(rubric, evidence.value, refs);
    expect(result.outcome).toBe("pass");
    expect(evaluate(rubric, evidence.value, refs)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("secret-output-canary");
    expect(projectPublicResult(rubric, result)).toMatchObject({
      ok: true,
      value: { outcome: "withheld", findings: [] },
    });
    expect(
      evaluate(
        rubric,
        {
          ...evidence.value,
          observations: [
            {
              ...out,
              value: "secret-output-canary",
              origin: { ...origin, termination: "timeout" },
            },
          ],
        },
        refs,
      ).outcome,
    ).toBe("invalid_evidence");
    expect(definition([stdout]).revisionDigest).not.toBe(
      definition([{ ...stdout, executionFact: "stderr" }]).revisionDigest,
    );
  });

  it("rejects conflicting complete singleton facts for the same run in either order", () => {
    const cases = [
      [exit, status, 1],
      [stdout, out, "different-output"],
      [stderr, err, "different-error"],
      [json, structured, { result: [false, null] }],
      [
        { ...json, executionFact: "structured_stderr" },
        { ...structured, executionFact: "structured_stderr" },
        { result: [false, null] },
      ],
    ] as const;
    for (const [check, observation, otherValue] of cases) {
      const second = {
        ...check,
        id: "second",
        parameters: { ...check.parameters, expected: literal(otherValue) },
      };
      const other = {
        ...observation,
        criterionId: "second",
        evidenceRef: "fact-second",
        value: otherValue,
      };
      for (const observations of [
        [observation, other],
        [other, observation],
      ]) {
        expect(run([check, second], observations).outcome).toBe("invalid_evidence");
      }
      expect(
        run([check, second], [observation, { ...other, origin: { ...origin, runRef: "run2" } }])
          .outcome,
      ).toBe("pass");
      expect(
        run(
          [check, { ...check, id: "second" }],
          [observation, { ...other, value: observation.value }],
        ).outcome,
      ).toBe("pass");
    }
  });

  it("uses exact raw equality and shared JSON semantics for repeated run facts", () => {
    const value = { a: [null, -0], b: false };
    const reordered = { b: false, a: [null, 0] };
    const check = { ...json, parameters: { expected: literal(value) } };
    const other = { ...check, id: "second" };
    expect(
      run(
        [check, other],
        [
          { ...structured, value },
          { ...structured, criterionId: "second", evidenceRef: "fact-second", value: reordered },
        ],
      ).outcome,
    ).toBe("pass");
    const normalized = {
      ...stdout,
      id: "second",
      kind: "normalized_text",
      parameters: {
        expected: literal("ok"),
        normalization: {
          lineEndings: "preserve",
          unicode: "none",
          case: "sensitive",
          whitespace: "preserve",
          trim: "both",
        },
      },
    };
    expect(
      run(
        [stdout, normalized],
        [out, { ...out, criterionId: "second", evidenceRef: "fact-second", value: " ok " }],
      ).outcome,
    ).toBe("invalid_evidence");
    expect(
      run(
        [property, { ...property, id: "second", parameters: { expected: literal(true) } }],
        [prop, { ...prop, criterionId: "second", evidenceRef: "fact-second", value: true }],
      ).outcome,
    ).toBe("pass");
    expect(
      run(
        [exit, { ...exit, id: "second" }],
        [
          status,
          {
            ...status,
            criterionId: "second",
            evidenceRef: "fact-second",
            completeness: "truncated",
            value: 1,
          },
        ],
      ).outcome,
    ).toBe("inconclusive");
  });

  it("matches independent canonical definition and evidence vectors", () => {
    const rubric = definition([stdout]);
    expect(rubric.revisionDigest).toBe(
      "sha256:198b7fa36aafa00a8bfc98768d81673d38d1decbfcf1a65e8162235f868368a3",
    );
    const evidence = createEvidenceBundle(rubric, {
      schemaVersion: 3,
      observations: [out],
    });
    if (!evidence.ok) throw new Error("Invalid evidence fixture");
    expect(evidence.value.evidenceDigest).toBe(
      "sha256:c23760b6496a44fc6d185165ab7f8015f60b47a15b7a6c78bc8358ddb1bb9d27",
    );
  });

  it("acquires selected facts through a scoped provider report", async () => {
    const rubric = definition([stdout]);
    const evidence = createEvidenceBundle(rubric, { schemaVersion: 3, observations: [] });
    if (!evidence.ok) throw new Error("Invalid evidence fixture");
    const collected = await collectObservations(rubric, evidence.value, {
      async observe(request) {
        expect(request.criteria).toEqual([
          { criterionId: stdout.id, kind: "text", executionFact: "stdout" },
        ]);
        return {
          schemaVersion: 3,
          definition: request.definition,
          termination: "exited",
          provenance: {
            adapterId: "fixture",
            adapterVersion: "v1",
            runRef: "run1",
            toolchainId: "node",
            toolchainVersion: "v24",
            capturedStdoutBytes: 2,
            capturedStderrBytes: 0,
            stdoutTruncated: false,
            stderrTruncated: true,
          },
          observations: [
            {
              criterionId: stdout.id,
              evidenceRef: "acquired",
              kind: "text",
              executionFact: "stdout",
              completeness: "complete",
              value: "ok",
            },
          ],
        };
      },
    });
    if (!collected.ok) throw new Error("Invalid collection");
    expect(collected.receipt?.termination).toBe("exited");
    expect(evaluate(rubric, collected.evidence).outcome).toBe("pass");
  });
});

describe("AY-I19 scoped selected reports", () => {
  it("acquires every selected kind and applies relevant completeness", async () => {
    const cases = [
      [stdout, out, "inconclusive"],
      [stderr, err, "pass"],
      [exit, status, "pass"],
      [property, prop, "inconclusive"],
      [json, structured, "inconclusive"],
    ] as const;
    for (const [check, observation, expected] of cases) {
      const rubric = definition([check]);
      const empty = createEvidenceBundle(rubric, { schemaVersion: 3, observations: [] });
      if (!empty.ok) throw new Error("Invalid evidence fixture");
      const { origin: _origin, ...returned } = observation;
      const report = {
        schemaVersion: 3,
        definition: empty.value.definition,
        termination: "exited",
        provenance,
        observations: [returned],
      };
      const collected = await collectObservations(rubric, empty.value, {
        async observe(request) {
          expect(request.criteria).toEqual([
            { criterionId: check.id, kind: observation.kind, executionFact: check.executionFact },
          ]);
          return report;
        },
      });
      if (!collected.ok) throw new Error("Invalid collection");
      expect(evaluate(rubric, collected.evidence).outcome).toBe(expected);
      const interrupted = await collectObservations(rubric, empty.value, {
        observe: async () => ({
          ...report,
          termination: "timeout",
          provenance: { ...provenance, stdoutTruncated: false },
        }),
      });
      if (!interrupted.ok) throw new Error("Invalid collection");
      expect(evaluate(rubric, interrupted.evidence).outcome).toBe("inconclusive");
    }
  });

  it("rejects missing termination, wrong selectors and report-level origin spoofing", async () => {
    const rubric = definition([stdout]);
    const empty = createEvidenceBundle(rubric, { schemaVersion: 3, observations: [] });
    if (!empty.ok) throw new Error("Invalid evidence fixture");
    const { origin: _origin, ...returned } = out;
    const report = {
      schemaVersion: 3,
      definition: empty.value.definition,
      provenance,
      observations: [returned],
    };
    expect(parseObservationPortReport(report).ok).toBe(false);
    for (const response of [
      report,
      { ...report, termination: "unknown" },
      { ...report, termination: "exited", observations: [out] },
      {
        ...report,
        termination: "exited",
        observations: [{ ...returned, executionFact: "stderr" }],
      },
      {
        ...report,
        termination: "exited",
        observations: [{ ...returned, executionFact: "exit_status" }],
      },
    ]) {
      const collected = await collectObservations(rubric, empty.value, {
        observe: async () => response,
      });
      expect(collected).toMatchObject({ ok: false, outcome: "invalid_evidence" });
    }
  });
});

describe("AY-I19 empty report run claims", () => {
  it("rejects conflicting same-run termination and relevant truncation without changing evidence", async () => {
    const rubric = definition([stdout, { ...stderr, mode: "advisory" }]);
    const initial = createEvidenceBundle(rubric, { schemaVersion: 3, observations: [out] });
    if (!initial.ok) throw new Error("Invalid evidence fixture");
    const baseReport = {
      schemaVersion: 3,
      definition: initial.value.definition,
      termination: "exited",
      provenance: { ...provenance, stdoutTruncated: false },
      observations: [],
    };
    for (const response of [
      { ...baseReport, termination: "timeout" },
      { ...baseReport, termination: "crash" },
      { ...baseReport, provenance },
    ]) {
      const collected = await collectObservations(rubric, initial.value, {
        observe: async () => response,
      });
      expect(collected).toMatchObject({ ok: false, outcome: "invalid_evidence" });
    }
    for (const response of [
      baseReport,
      {
        ...baseReport,
        provenance: { ...baseReport.provenance, stderrTruncated: true },
      },
      {
        ...baseReport,
        termination: "timeout",
        provenance: { ...provenance, runRef: "unrelated" },
      },
    ]) {
      const collected = await collectObservations(rubric, initial.value, {
        observe: async () => response,
      });
      if (!collected.ok) throw new Error("Invalid collection");
      expect(collected.evidence).toEqual(initial.value);
      expect(collected.receipt?.evidenceRefs).toEqual([]);
      expect(evaluate(rubric, collected.evidence).outcome).toBe("pass");
    }
  });
});
