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
    "createEvidenceBundle",
    "verifyEvidenceBundle",
    "createReferenceRecord",
    "verifyReferenceBundle",
    "verifyAssessmentDefinition",
    "parseAssessmentDefinitionDraft",
    "ASSAY_SCHEMA_VERSION",
    "collectObservations",
    "CONTRACT_LIMITS",
    "decodeSerializedRecord",
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
assert.equal(typeof entry.decodeSerializedRecord, "function");
assert.deepEqual(entry.decodeSerializedRecord('{"x":1,"x":2}'), {
  ok: false,
  diagnostics: [{ path: "$", code: "DUPLICATE_KEY" }],
});

const golden = entry.createAssessmentDefinition({
  schemaVersion: 1,
  assessmentId: "vector",
  revision: "rev1",
  policyVersion: "all-required-v1",
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
  "sha256:7be081910e17919c0b08bcff0543d80c7b8c540541b58bcb70630f5d561cfc2f",
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
  policyVersion: "all-required-v1",
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
const decodedDefinition = entry.decodeSerializedRecord(JSON.stringify(definition));
assert.equal(decodedDefinition.ok, true);
assert.equal(entry.verifyAssessmentDefinition(decodedDefinition.value).ok, true);
const prepared = entry.createEvidenceBundle(definition, {
  schemaVersion: 2,
  observations: [
    {
      criterionId: "objective",
      evidenceRef: "obs1",
      completeness: "complete",
      kind: "text",
      value: "ok",
    },
  ],
});
assert.equal(prepared.ok, true);
const observed = entry.evaluate(definition, prepared.value);
assert.equal(observed.evidenceDigest, prepared.value.evidenceDigest);
assert.equal(observed.outcome, "pass", "Emitted ESM evaluator must compare a valid rubric");
assert.equal(observed.findings[0].reasonCode, "MATCH");
assert.deepEqual(entry.projectPublicResult(definition, observed), {
  ok: true,
  value: {
    schemaVersion: 1,
    outcome: "pass",
    findings: [{ criterionId: observed.findings[0].criterionId, outcome: "pass", reason: "match" }],
  },
});
const unsupportedPolicy = { ...definition, policyVersion: "changed" };
assert.deepEqual(entry.evaluate(unsupportedPolicy, {}), {
  outcome: "invalid_definition",
  diagnostics: [{ path: "$.policyVersion", code: "INVALID_VALUE" }],
});
const tampered = { ...definition, revision: "rev2" };
assert.deepEqual(entry.evaluate(tampered, {}), {
  outcome: "invalid_definition",
  diagnostics: [{ path: "$.revisionDigest", code: "DEFINITION_DIGEST_MISMATCH" }],
});
assert.equal(
  entry.parseEvaluationResult(observed).ok,
  true,
  "Output must match its public contract",
);
const empty = entry.createEvidenceBundle(definition, { schemaVersion: 2, observations: [] });
assert.equal(empty.ok, true);
const pending = entry.collectObservations(definition, empty.value, {
  observe: async () => ({
    schemaVersion: 2,
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
});
const collected = await pending;
assert.equal(collected.ok, true, "Emitted ESM must accept the optional port");
assert.equal(
  entry.evaluate(definition, collected.evidence).outcome,
  "pass",
  "Optional port must supply bounded evidence to pure evaluation",
);
console.log("Built ESM entry, declarations, comparisons and optional observation port verified");
