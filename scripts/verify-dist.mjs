import assert from "node:assert/strict";
import { stat } from "node:fs/promises";

for (const output of ["dist/index.js", "dist/index.d.ts"]) {
  assert.ok((await stat(new URL(`../${output}`, import.meta.url))).isFile(), `Missing ${output}`);
}

const entry = await import("@0xbuff/assay");
assert.deepEqual(Object.keys(entry).sort(), [
  "ASSAY_SCHEMA_VERSION",
  "CONTRACT_LIMITS",
  "inspectEvidenceCoverage",
  "parseAssessmentDefinition",
  "parseEvaluationResult",
  "parseEvidenceBundle",
].sort());
assert.equal(entry.ASSAY_SCHEMA_VERSION, 1);
assert.equal(typeof entry.parseAssessmentDefinition, "function");
assert.equal(typeof entry.parseEvidenceBundle, "function");
assert.equal(typeof entry.inspectEvidenceCoverage, "function");
assert.equal(typeof entry.parseEvaluationResult, "function");
assert.equal("evaluate" in entry, false, "AY-I02 must implement actual evaluation");

const digest = "sha256:" + "a".repeat(64);
const inspected = entry.parseAssessmentDefinition({
  schemaVersion: 1,
  assessmentId: "pack-test",
  revision: "rev1",
  revisionDigest: digest,
  policyVersion: "policy1",
  criteria: [{
    id: "objective",
    mode: "required",
    visibility: "public",
    kind: "exact_text",
    parameters: { expected: { type: "literal", value: "ok" } },
  }],
});
assert.equal(inspected.ok, true, "The emitted ESM entry must validate a real definition");
console.log("Built ESM entry, declarations and contract validation verified");
