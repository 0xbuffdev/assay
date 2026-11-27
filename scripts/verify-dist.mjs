import assert from "node:assert/strict";
import { stat } from "node:fs/promises";

for (const output of ["dist/index.js", "dist/index.d.ts"]) {
  assert.ok((await stat(new URL(`../${output}`, import.meta.url))).isFile(), `Missing ${output}`);
}

const entry = await import("@0xbuff/assay");
assert.deepEqual(
  Object.keys(entry).sort(),
  [
    "ASSAY_DEFINITION_DIGEST_VERSION",
    "ASSAY_EVALUATOR_VERSION",
    "computeDefinitionDigest",
    "createAssessmentDefinition",
    "verifyAssessmentDefinition",
    "parseAssessmentDefinitionDraft",
    "ASSAY_SCHEMA_VERSION",
    "collectObservations",
    "CONTRACT_LIMITS",
    "evaluate",
    "inspectEvidenceCoverage",
    "parseAssessmentDefinition",
    "parseEvaluationResult",
    "parseEvidenceBundle",
    "parseObservationPortReport",
    "projectPublicResult",
  ].sort(),
);
assert.equal(entry.ASSAY_SCHEMA_VERSION, 1);

const golden = entry.createAssessmentDefinition({
  schemaVersion: 1,
  assessmentId: "vector",
  revision: "rev1",
  policyVersion: "policy1",
  criteria: [
    {
      id: "output",
      mode: "required",
      visibility: "public",
      kind: "exact_text",
      parameters: { expected: { type: "literal", value: "café\n" } },
    },
  ],
});
assert.equal(golden.ok, true);
assert.equal(
  golden.value.revisionDigest,
  "sha256:e6382f984b711c58df762bcff7eba872246638a30a60ab07d807f6b7a9e35e8b",
);
assert.equal(entry.verifyAssessmentDefinition(golden.value).ok, true);
const modified = {
  ...golden.value,
  policyVersion: "newPolicy",
};
assert.equal(entry.verifyAssessmentDefinition(modified).ok, false);

assert.equal(typeof entry.parseAssessmentDefinition, "function");
assert.equal(typeof entry.parseEvidenceBundle, "function");
assert.equal(typeof entry.inspectEvidenceCoverage, "function");
assert.equal(typeof entry.parseEvaluationResult, "function");
assert.equal(typeof entry.evaluate, "function", "AY-I02 must expose pure evaluation");
assert.equal(
  typeof entry.collectObservations,
  "function",
  "AY-I03 must expose optional collection",
);
assert.equal(
  typeof entry.parseObservationPortReport,
  "function",
  "AY-I03 must validate port reports",
);

const sealed = entry.createAssessmentDefinition({
  schemaVersion: 1,
  assessmentId: "pack-test",
  revision: "rev1",
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
assert.equal(sealed.ok, true, "The emitted ESM entry must seal a real definition");
const definition = sealed.value;
const digest = definition.revisionDigest;
assert.equal(entry.parseAssessmentDefinition(definition).ok, true);
const observed = entry.evaluate(
  definition,
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
const tampered = { ...definition, policyVersion: "changed" };
assert.deepEqual(entry.evaluate(tampered, {}), {
  outcome: "invalid_definition",
  diagnostics: [{ path: "$.revisionDigest", code: "DEFINITION_DIGEST_MISMATCH" }],
});
assert.equal(
  entry.parseEvaluationResult(observed).ok,
  true,
  "Output must match its public contract",
);
const pending = entry.collectObservations(
  definition,
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
assert.equal(
  entry.evaluate(
    definition,
    collected.evidence,
  ).outcome,
  "pass",
  "Optional port must supply bounded evidence to pure evaluation",
);
console.log("Built ESM entry, declarations, comparisons and optional observation port verified");
