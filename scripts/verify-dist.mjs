import assert from "node:assert/strict";
import { stat } from "node:fs/promises";

for (const output of ["dist/index.js", "dist/index.d.ts"]) {
  assert.ok((await stat(new URL(`../${output}`, import.meta.url))).isFile(), `Missing ${output}`);
}

const entry = await import("@0xbuff/assay");
assert.deepEqual(
  Object.keys(entry).sort(),
  [
    "ASSAY_EVALUATOR_VERSION",
    "ASSAY_SCHEMA_VERSION",
    "collectObservations",
    "CONTRACT_LIMITS",
    "evaluate",
    "inspectEvidenceCoverage",
    "parseAssessmentDefinition",
    "parseEvaluationResult",
    "parseEvidenceBundle",
    "parseObservationPortReport",
  ].sort(),
);
assert.equal(entry.ASSAY_SCHEMA_VERSION, 1);
assert.equal(typeof entry.parseAssessmentDefinition, "function");
assert.equal(typeof entry.parseEvidenceBundle, "function");
assert.equal(typeof entry.inspectEvidenceCoverage, "function");
assert.equal(typeof entry.parseEvaluationResult, "function");
assert.equal(typeof entry.evaluate, "function", "AY-I02 must expose pure evaluation");
assert.equal(typeof entry.collectObservations, "function", "AY-I03 must expose optional collection");
assert.equal(typeof entry.parseObservationPortReport, "function", "AY-I03 must validate port reports");

const digest = `sha256:${"a".repeat(64)}`;
const inspected = entry.parseAssessmentDefinition({
  schemaVersion: 1,
  assessmentId: "pack-test",
  revision: "rev1",
  revisionDigest: digest,
  policyVersion: "policy1",
  criteria: [
    {
      id: "objective",
      mode: "required",
      visibility: "public",
      kind: "exact_text",
      parameters: { expected: { type: "literal", value: "ok" } },
    },
  ],
});
assert.equal(inspected.ok, true, "The emitted ESM entry must validate a real definition");
const observed = entry.evaluate(
  {
    schemaVersion: 1,
    assessmentId: "pack-test",
    revision: "rev1",
    revisionDigest: digest,
    policyVersion: "policy1",
    criteria: [
      {
        id: "objective",
        mode: "required",
        visibility: "public",
        kind: "exact_text",
        parameters: { expected: { type: "literal", value: "ok" } },
      },
    ],
  },
  {
    schemaVersion: 1,
    definition: { assessmentId: "pack-test", revision: "rev1", revisionDigest: digest },
    observations: [
      {
        criterionId: "objective",
        evidenceRef: "obs1",
        completeness: "complete",
        kind: "text",
        value: "ok",
      },
    ],
  },
);
assert.equal(observed.outcome, "pass", "Emitted ESM evaluator must compare a valid rubric");
assert.equal(observed.findings[0].reasonCode, "MATCH");
assert.equal(
  entry.parseEvaluationResult(observed).ok,
  true,
  "Output must match its public contract",
);
const pending = entry.collectObservations(
  {
    schemaVersion: 1,
    assessmentId: "pack-test",
    revision: "rev1",
    revisionDigest: digest,
    policyVersion: "policy1",
    criteria: [
      {
        id: "objective",
        mode: "required",
        visibility: "public",
        kind: "exact_text",
        parameters: { expected: { type: "literal", value: "ok" } },
      },
    ],
  },
  {
    schemaVersion: 1,
    definition: { assessmentId: "pack-test", revision: "rev1", revisionDigest: digest },
    observations: [],
  },
  {
    observe: async () => ({
      schemaVersion: 1,
      definition: { assessmentId: "pack-test", revision: "rev1", revisionDigest: digest },
      provenance: {
        adapterId: "fixture",
        adapterVersion: "v1",
        runRef: "local-run",
        toolchainId: "node",
        toolchainVersion: "v24",
        capturedStdoutBytes: 2,
        capturedStderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
      observations: [
        {
          criterionId: "objective",
          evidenceRef: "from-port",
          completeness: "complete",
          kind: "text",
          value: "ok",
        },
      ],
    }),
  },
);
const collected = await pending;
assert.equal(collected.ok, true, "Emitted ESM must accept the optional port");
assert.equal(entry.evaluate({
  schemaVersion: 1,
  assessmentId: "pack-test",
  revision: "rev1",
  revisionDigest: digest,
  policyVersion: "policy1",
  criteria: [
    {
      id: "objective",
      mode: "required",
      visibility: "public",
      kind: "exact_text",
      parameters: { expected: { type: "literal", value: "ok" } },
    },
  ],
}, collected.evidence).outcome, "pass", "Optional port must supply bounded evidence to pure evaluation");
console.log("Built ESM entry, declarations, comparisons and optional observation port verified");
