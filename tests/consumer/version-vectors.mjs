import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as assay from "@0xbuff/assay";

// Authored bytes and fixed digests are independent of the source canonicalizer.
// Semantics v0.0.4, policy composed-required-v1. All fixtures are synthetic.
const literalVector =
  '{"assessmentId":"vector","composition":{"groups":[{"children":[{"id":"output","kind":"criterion"}],"id":"fixture-root","operator":"all"}],"rootGroupId":"fixture-root"},"criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"type":"literal","value":"café\\n"}},"visibility":"public"}],"policyVersion":"composed-required-v1","revision":"rev1","schemaVersion":3}';
const executionVector =
  '{"assessmentId":"execution","composition":{"groups":[{"children":[{"id":"out","kind":"criterion"}],"id":"fixture-root","operator":"all"}],"rootGroupId":"fixture-root"},"criteria":[{"executionFact":"stdout","id":"out","kind":"exact_text","mode":"required","parameters":{"expected":{"type":"literal","value":"ok"}},"visibility":"public"}],"policyVersion":"composed-required-v1","revision":"rev1","schemaVersion":3}';
const referenceVector = '{"kind":"text","referenceId":"secret","schemaVersion":3,"value":"café\\n"}';
const evidenceVector =
  '{"definition":{"assessmentId":"execution","revision":"rev1","revisionDigest":"sha256:4a14c1d05f85cfb9e78a1f0779702dc0cef28a1d084c0e475b21963b6764dc78"},"observations":[{"completeness":"complete","criterionId":"out","evidenceRef":"fact-out","executionFact":"stdout","kind":"text","origin":{"kind":"independent","runRef":"run1","sourceRef":"fixture","termination":"exited"},"value":"ok"}],"schemaVersion":3}';

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

assert.equal(assay.ASSAY_EVALUATOR_VERSION, "v0.0.4");
assert.equal(assay.ASSAY_SCHEMA_VERSION, 3);

const literalDigest = independent(
  "assay:definition:v3",
  literalVector,
  "sha256:dfa86e4d4bd5fd5b9d1753eebdaca7ce2cc61c3843e5417e297d31d71f806798",
);
const literal = unwrap(assay.createAssessmentDefinition(JSON.parse(literalVector)));
assert.equal(literal.revisionDigest, literalDigest);
const executionDigest = independent(
  "assay:definition:v3",
  executionVector,
  "sha256:4a14c1d05f85cfb9e78a1f0779702dc0cef28a1d084c0e475b21963b6764dc78",
);
const execution = unwrap(assay.createAssessmentDefinition(JSON.parse(executionVector)));
assert.equal(execution.revisionDigest, executionDigest);
const referenceDigest = independent(
  "assay:reference:v3",
  referenceVector,
  "sha256:e28e007acf7ef464608360a68f53c40b2e949954d2dedff20448e68f52d0d18f",
);
const reference = unwrap(assay.createReferenceRecord(JSON.parse(referenceVector)));
assert.equal(reference.referenceDigest, referenceDigest);
const evidenceDigest = independent(
  "assay:evidence:v3",
  evidenceVector,
  "sha256:16625d5433f8726c15a707050e098eede00a82f99d0403f26480e5cac9535591",
);
const content = JSON.parse(evidenceVector);
const evidence = unwrap(
  assay.createEvidenceBundle(execution, { schemaVersion: 3, observations: content.observations }),
);
assert.equal(evidence.evidenceDigest, evidenceDigest);
// Compare the complete JSON data contract, not the prototype of the sealed wrapper.
const expectedEvidence = { ...content, evidenceDigest };
assert.deepEqual(JSON.parse(JSON.stringify(evidence)), expectedEvidence);
const verified = unwrap(assay.verifyEvidenceBundle(execution, evidence));
assert.deepEqual(JSON.parse(JSON.stringify(verified)), expectedEvidence);
assert.equal(Object.getPrototypeOf(verified), null);
const result = assay.evaluate(execution, evidence);
assert.equal(result.outcome, "pass");
assert.equal(result.schemaVersion, 3);
assert.equal(result.policyVersion, "composed-required-v1");
assert.deepEqual(result.evaluator, { id: "assay", version: "v0.0.4" });
assert.equal(result.findings[0].reasonCode, "MATCH");
assert.equal(result.findings[0].evaluatorVersion, "v0.0.4");
assert.equal(result.evidenceDigest, evidenceDigest);
assert.equal(result.definition.revisionDigest, executionDigest);
assert.deepEqual(assay.evaluate(execution, evidence), result);
assert.equal(assay.parseEvaluationResult(result).ok, true);

for (const schemaVersion of [0, 1, 2, 4, "3"]) {
  unsupported(assay.createAssessmentDefinition({ ...JSON.parse(literalVector), schemaVersion }));
}
for (const schemaVersion of [1, 2, 4, "3"]) {
  unsupported(assay.createReferenceRecord({ ...JSON.parse(referenceVector), schemaVersion }));
  unsupported(assay.parseEvidenceBundle({ ...evidence, schemaVersion }));
  unsupported(assay.parseEvaluationResult({ ...result, schemaVersion }));
  unsupported(
    assay.verifyReferenceBundle(execution, {
      schemaVersion,
      definition: content.definition,
      references: [],
    }),
  );
}
assert.equal(assay.verifyAssessmentDefinition({ ...literal, schemaVersion: 2 }).ok, false);
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
  assay.createAssessmentDefinition({ ...JSON.parse(executionVector), policyVersion: "future" }).ok,
  false,
);
console.log(
  "AY-I22 independent canonical profiles, version rejection and exact semantics verified",
);
