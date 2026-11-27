import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as assay from "@0xbuff/assay";

// Authored bytes and fixed digests are independent of the source canonicalizer.
// Semantics v0.0.5, policy composed-required-v1. All fixtures are synthetic.
const literalVector =
  '{"assessmentId":"vector","composition":{"groups":[{"children":[{"id":"output","kind":"criterion"}],"id":"fixture-root","operator":"all"}],"rootGroupId":"fixture-root"},"criteria":[{"id":"output","kind":"exact_text","mode":"required","parameters":{"expected":{"type":"literal","value":"café\\n"}},"visibility":"public"}],"policyVersion":"composed-required-v1","revision":"rev1","schemaVersion":4}';
const executionVector =
  '{"assessmentId":"execution","composition":{"groups":[{"children":[{"id":"out","kind":"criterion"}],"id":"fixture-root","operator":"all"}],"rootGroupId":"fixture-root"},"criteria":[{"executionFact":"stdout","id":"out","kind":"exact_text","mode":"required","parameters":{"expected":{"type":"literal","value":"ok"}},"visibility":"public"}],"policyVersion":"composed-required-v1","revision":"rev1","schemaVersion":4}';
const referenceVector =
  '{"kind":"text","referenceId":"secret","schemaVersion":4,"value":"café\\n"}';
const evidenceVector =
  '{"definition":{"assessmentId":"execution","revision":"rev1","revisionDigest":"sha256:544f401f9bf628c23dd0ef0fc1930beedc3a5df61eeb72b1ce03fe9ffd663609"},"observations":[{"completeness":"complete","criterionId":"out","evidenceRef":"fact-out","executionFact":"stdout","kind":"text","origin":{"kind":"independent","runRef":"run1","sourceRef":"fixture","termination":"exited"},"value":"ok"}],"schemaVersion":4}';

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

assert.equal(assay.ASSAY_EVALUATOR_VERSION, "v0.0.5");
assert.equal(assay.ASSAY_SCHEMA_VERSION, 4);

const literalDigest = independent(
  "assay:definition:v4",
  literalVector,
  "sha256:db53afe46dc26651f77a64613a6d059fdeefff1caeb0947c92c567db478f13a2",
);
const literal = unwrap(assay.createAssessmentDefinition(JSON.parse(literalVector)));
assert.equal(literal.revisionDigest, literalDigest);
const executionDigest = independent(
  "assay:definition:v4",
  executionVector,
  "sha256:544f401f9bf628c23dd0ef0fc1930beedc3a5df61eeb72b1ce03fe9ffd663609",
);
const execution = unwrap(assay.createAssessmentDefinition(JSON.parse(executionVector)));
assert.equal(execution.revisionDigest, executionDigest);
const referenceDigest = independent(
  "assay:reference:v4",
  referenceVector,
  "sha256:27702532f918730d005384ff402dd3a5eb3f7d6f442479a03580b4c4da01709c",
);
const reference = unwrap(assay.createReferenceRecord(JSON.parse(referenceVector)));
assert.equal(reference.referenceDigest, referenceDigest);
const evidenceDigest = independent(
  "assay:evidence:v4",
  evidenceVector,
  "sha256:36925ad1aca4eaca670da8a2058d8c87e91c59c3d683b6a46ed4425e91f49e97",
);
const content = JSON.parse(evidenceVector);
const evidence = unwrap(
  assay.createEvidenceBundle(execution, { schemaVersion: 4, observations: content.observations }),
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
assert.equal(result.schemaVersion, 4);
assert.equal(result.policyVersion, "composed-required-v1");
assert.deepEqual(result.evaluator, { id: "assay", version: "v0.0.5" });
assert.equal(result.findings[0].reasonCode, "MATCH");
assert.equal(result.findings[0].evaluatorVersion, "v0.0.5");
assert.equal(result.evidenceDigest, evidenceDigest);
assert.equal(result.definition.revisionDigest, executionDigest);
assert.deepEqual(assay.evaluate(execution, evidence), result);
assert.equal(assay.parseEvaluationResult(result).ok, true);

for (const schemaVersion of [0, 1, 2, 3, 5, "4"]) {
  unsupported(assay.createAssessmentDefinition({ ...JSON.parse(literalVector), schemaVersion }));
}
for (const schemaVersion of [1, 2, 3, 5, "4"]) {
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
// A current, otherwise-valid report must be accepted; only its version is mutated.
const report = {
  schemaVersion: 4,
  definition: content.definition,
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
    stderrTruncated: false,
  },
  observations: [
    {
      criterionId: "out",
      evidenceRef: "collected-out",
      kind: "text",
      executionFact: "stdout",
      completeness: "complete",
      value: "ok",
    },
  ],
};
assert.equal(assay.parseObservationPortReport(report).ok, true);
for (const schemaVersion of [1, 2, 3, 5, "4"]) {
  unsupported(assay.parseObservationPortReport({ ...report, schemaVersion }));
}
const starting = unwrap(
  assay.createEvidenceBundle(execution, { schemaVersion: 4, observations: [] }),
);
const collected = await assay.collectObservations(execution, starting, {
  observe: async () => report,
});
assert.equal(collected.ok, true);
assert.equal(assay.evaluate(execution, collected.evidence).outcome, "pass");
assert.equal(collected.receipt.evidenceDigest, collected.evidence.evidenceDigest);
for (const schemaVersion of [1, 2, 3]) {
  let calls = 0;
  const port = {
    async observe() {
      calls++;
      return { ...report, schemaVersion };
    },
  };
  const diagnostic = [{ path: "$.schemaVersion", code: "UNSUPPORTED_VERSION" }];
  assert.deepEqual(await assay.collectObservations(execution, starting, port), {
    ok: false,
    outcome: "invalid_evidence",
    diagnostics: diagnostic,
  });
  assert.equal(calls, 1);
  assert.deepEqual(
    await assay.collectObservations({ ...execution, schemaVersion }, starting, port),
    { ok: false, outcome: "invalid_definition", diagnostics: diagnostic },
  );
  assert.deepEqual(
    await assay.collectObservations(execution, { ...starting, schemaVersion }, port),
    { ok: false, outcome: "invalid_evidence", diagnostics: diagnostic },
  );
  assert.equal(calls, 1);
}
assert.equal(assay.projectPublicResult(execution, result).ok, true);
const retiredPolicy = { ...result, policyVersion: "all-required-v1" };
assert.equal(
  assay.createAssessmentDefinition({
    ...JSON.parse(executionVector),
    policyVersion: retiredPolicy.policyVersion,
  }).ok,
  false,
);
assert.equal(assay.parseEvaluationResult(retiredPolicy).ok, false);
assert.deepEqual(assay.projectPublicResult(execution, retiredPolicy), {
  ok: false,
  reasonCode: "PUBLIC_PROJECTION_REJECTED",
});
console.log(
  "AY-I22 independent canonical profiles, version rejection and exact semantics verified",
);
