import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as assay from "@0xbuff/assay";

// Authored bytes and fixed digests are independent of the source canonicalizer.
// Semantics v0.0.3, policy all-required-v1. All fixtures are synthetic.
const definitionV1 =
  '{"assessmentId":"vector","criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"type":"literal","value":"café\\n"}},"visibility":"public"}],"policyVersion":"all-required-v1","revision":"rev1","schemaVersion":1}';
const definitionV2 =
  '{"assessmentId":"execution","criteria":[{"executionFact":"stdout","id":"out","kind":"exact_text","mode":"required","parameters":{"expected":{"type":"literal","value":"ok"}},"visibility":"public"}],"policyVersion":"all-required-v1","revision":"rev1","schemaVersion":2}';
const referenceV2 = '{"kind":"text","referenceId":"secret","schemaVersion":2,"value":"café\\n"}';
const evidenceV2 =
  '{"definition":{"assessmentId":"execution","revision":"rev1","revisionDigest":"sha256:198b7fa36aafa00a8bfc98768d81673d38d1decbfcf1a65e8162235f868368a3"},"observations":[{"completeness":"complete","criterionId":"out","evidenceRef":"fact-out","executionFact":"stdout","kind":"text","origin":{"kind":"independent","runRef":"run1","sourceRef":"fixture","termination":"exited"},"value":"ok"}],"schemaVersion":2}';

function independent(domain, bytes, expected) {
  const hash = createHash("sha256").update(`${domain}\n${bytes}`, "utf8").digest("hex");
  assert.equal(`sha256:${hash}`, expected);
  return expected;
}

function unwrap(result) {
  assert.equal(result.ok, true);
  return result.value;
}

function unsupported(result) {
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "UNSUPPORTED_VERSION"));
}

assert.equal(assay.ASSAY_EVALUATOR_VERSION, "v0.0.3");
assert.equal(assay.ASSAY_SCHEMA_VERSION, 1);
assert.equal(assay.ASSAY_DEFINITION_DIGEST_VERSION, "v1");

const v1Digest = independent(
  "assay:definition:v1",
  definitionV1,
  "sha256:7be081910e17919c0b08bcff0543d80c7b8c540541b58bcb70630f5d561cfc2f",
);
const v1 = unwrap(assay.createAssessmentDefinition(JSON.parse(definitionV1)));
assert.equal(v1.revisionDigest, v1Digest);
const v2Digest = independent(
  "assay:definition:v2",
  definitionV2,
  "sha256:198b7fa36aafa00a8bfc98768d81673d38d1decbfcf1a65e8162235f868368a3",
);
const v2 = unwrap(assay.createAssessmentDefinition(JSON.parse(definitionV2)));
assert.equal(v2.revisionDigest, v2Digest);
const referenceDigest = independent(
  "assay:reference:v2",
  referenceV2,
  "sha256:b76df28194a4dc2b9afda31ff4dd8061e358f17bfd2a41c7ce5b7ad80046ecf5",
);
const reference = unwrap(assay.createReferenceRecord(JSON.parse(referenceV2)));
assert.equal(reference.referenceDigest, referenceDigest);
const evidenceDigest = independent(
  "assay:evidence:v2",
  evidenceV2,
  "sha256:c23760b6496a44fc6d185165ab7f8015f60b47a15b7a6c78bc8358ddb1bb9d27",
);
const content = JSON.parse(evidenceV2);
const evidence = unwrap(
  assay.createEvidenceBundle(v2, { schemaVersion: 2, observations: content.observations }),
);
assert.equal(evidence.evidenceDigest, evidenceDigest);
assert.deepEqual(unwrap(assay.verifyEvidenceBundle(v2, evidence)), evidence);
const result = assay.evaluate(v2, evidence);
assert.equal(result.outcome, "pass");
assert.equal(result.schemaVersion, 2);
assert.equal(result.policyVersion, "all-required-v1");
assert.deepEqual(result.evaluator, { id: "assay", version: "v0.0.3" });
assert.equal(result.findings[0].reasonCode, "MATCH");
assert.equal(result.findings[0].evaluatorVersion, "v0.0.3");
assert.equal(result.evidenceDigest, evidenceDigest);
assert.equal(result.definition.revisionDigest, v2Digest);
assert.deepEqual(assay.evaluate(v2, evidence), result);
assert.equal(assay.parseEvaluationResult(result).ok, true);

for (const schemaVersion of [0, 3, "2"]) {
  unsupported(assay.createAssessmentDefinition({ ...JSON.parse(definitionV1), schemaVersion }));
}
for (const schemaVersion of [1, 3, "2"]) {
  unsupported(assay.createReferenceRecord({ ...JSON.parse(referenceV2), schemaVersion }));
  unsupported(assay.parseEvidenceBundle({ ...evidence, schemaVersion }));
  unsupported(assay.parseEvaluationResult({ ...result, schemaVersion }));
  unsupported(
    assay.verifyReferenceBundle(v2, {
      schemaVersion,
      definition: content.definition,
      references: [],
    }),
  );
}
assert.equal(assay.verifyAssessmentDefinition({ ...v1, schemaVersion: 2 }).ok, false);
assert.equal(
  assay.parseEvaluationResult({ ...result, evaluator: { id: "assay", version: "v0.0.2" } }).ok,
  false,
);
assert.equal(
  assay.parseEvaluationResult({
    ...result,
    findings: result.findings.map((finding) => ({ ...finding, evaluatorVersion: "v0.0.2" })),
  }).ok,
  false,
);
assert.equal(
  assay.createAssessmentDefinition({ ...JSON.parse(definitionV2), policyVersion: "future" }).ok,
  false,
);
console.log(
  "AY-I22 independent canonical profiles, version rejection and exact semantics verified",
);
