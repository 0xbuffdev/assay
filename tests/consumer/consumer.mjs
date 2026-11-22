import assert from "node:assert/strict";
import * as assay from "@0xbuff/assay";

const digest = (letter) => "sha256:" + letter.repeat(64);
const lineage = (revision = "rev1", revisionDigest = digest("a")) => ({
  assessmentId: "external-consumer",
  revision,
  revisionDigest,
});
const required = (id, kind, parameters, visibility = "public") => ({
  id,
  mode: "required",
  visibility,
  kind,
  parameters,
});
const advisory = (id, kind, parameters) => ({
  ...required(id, kind, parameters),
  mode: "advisory",
});
const text = (criterionId, value, evidenceRef = criterionId) => ({
  criterionId,
  evidenceRef,
  completeness: "complete",
  kind: "text",
  value,
});
const define = (criteria, revision = "rev1", revisionDigest = digest("a")) => ({
  schemaVersion: 1,
  ...lineage(revision, revisionDigest),
  policyVersion: "policy1",
  criteria,
});
const evidence = (observations, revision = "rev1", revisionDigest = digest("a")) => ({
  schemaVersion: 1,
  definition: lineage(revision, revisionDigest),
  observations,
});
function checked(criteria, observations, revision, revisionDigest) {
  return assay.evaluate(
    define(criteria, revision, revisionDigest),
    evidence(observations, revision, revisionDigest),
  );
}
function valid(result, outcome) {
  assert.equal(result.outcome, outcome);
  assert.ok("findings" in result, "Valid assessments must return typed findings");
  assert.equal(result.findings.length > 0, true);
  assert.equal(assay.parseEvaluationResult(result).ok, true);
  assert.equal("grade" in result, false);
  assert.equal("credential" in result, false);
  assert.equal("learnerId" in result, false);
  return result;
}

assert.deepEqual(
  Object.keys(assay).sort(),
  [
    "ASSAY_EVALUATOR_VERSION",
    "ASSAY_SCHEMA_VERSION",
    "CONTRACT_LIMITS",
    "collectObservations",
    "evaluate",
    "inspectEvidenceCoverage",
    "parseAssessmentDefinition",
    "parseEvaluationResult",
    "parseEvidenceBundle",
    "parseObservationPortReport",
  ].sort(),
);
assert.equal(assay.ASSAY_SCHEMA_VERSION, 1);

const exact = required("stdout", "exact_text", {
  expected: { type: "literal", value: "ok\n" },
});
const perfect = valid(checked([exact], [text("stdout", "ok\n")]), "pass");
assert.equal(perfect.findings[0].reasonCode, "MATCH");
assert.ok(Object.isFrozen(perfect));
assert.ok(Object.isFrozen(perfect.findings));
assert.deepEqual(
  perfect,
  valid(checked([exact], [text("stdout", "ok\n")]), "pass"),
  "Same inputs must replay deterministically",
);
valid(checked([exact], [text("stdout", "wrong")]), "fail");
valid(checked([exact], [{ ...text("stdout", "ok\n"), completeness: "truncated" }]), "inconclusive");
valid(checked([exact], []), "inconclusive");

const normalization = {
  lineEndings: "lf",
  unicode: "NFC",
  case: "fold",
  whitespace: "collapse",
  trim: "both",
};
const normalized = required("unicode", "normalized_text", {
  expected: { type: "literal", value: " CAFÉ\r\n" },
  normalization,
});
valid(checked([normalized], [text("unicode", "cafe\u0301")]), "pass");
valid(checked([exact], [text("stdout", "ok\r\n")]), "fail");

const number = required("value", "number_with_tolerance", {
  expected: { type: "literal", value: 100 },
  tolerance: { absolute: 0.1, relative: 0.02 },
});
const numeric = (value) => ({
  criterionId: "value",
  kind: "number",
  evidenceRef: "measurement",
  completeness: "complete",
  value,
});
valid(checked([number], [numeric(102)]), "pass");
valid(checked([number], [numeric(103)]), "fail");
assert.equal(checked([number], [numeric(Number.NaN)]).outcome, "invalid_evidence");
assert.equal(checked([number], [numeric(Infinity)]).outcome, "invalid_evidence");

const setCriterion = required("members", "set_equivalence", {
  expected: { type: "literal", value: ["a", "b", "a"] },
  itemType: "string",
  order: "ignore",
  duplicates: "respect",
});
const setObserved = (items) => ({
  criterionId: "members",
  kind: "set",
  itemType: "string",
  evidenceRef: "set-evidence",
  completeness: "complete",
  items,
});
valid(checked([setCriterion], [setObserved(["b", "a", "a"])]), "pass");
valid(checked([setCriterion], [setObserved(["a", "b"])]), "fail");

const positiveAdvice = advisory("hint", "exact_text", {
  expected: { type: "literal", value: "nice" },
});
valid(
  checked(
    [exact, positiveAdvice],
    [text("stdout", "incorrect"), text("hint", "nice")],
  ),
  "fail",
);
assert.equal(checked([], []).outcome, "invalid_definition");
assert.equal(checked([positiveAdvice], [text("hint", "nice")]).outcome, "invalid_definition");
const changed = checked([exact], [text("stdout", "ok\n")], "rev2", digest("b"));
assert.notEqual(changed.definition.revisionDigest, perfect.definition.revisionDigest);
assert.equal(checked([exact], [text("stdout", "ok\n")], "latest").outcome, "invalid_definition");
assert.equal(
  assay.evaluate(define([exact]), { ...evidence([]), extraGrade: "100%" }).outcome,
  "invalid_evidence",
);
assert.equal(
  assay.evaluate(define([exact]), evidence([], "rev2", digest("b"))).outcome,
  "invalid_evidence",
);

const hidden = required("hidden-output", "exact_text", {
  expected: { type: "reference", referenceId: "private-ref" },
}, "restricted");
const unresolved = valid(checked([hidden], [text("hidden-output", "guessed")]), "inconclusive");
assert.equal(unresolved.findings[0].reasonCode, "REFERENCE_UNAVAILABLE");
assert.ok(!JSON.stringify(unresolved).includes("private-ref"));
assert.ok(!JSON.stringify(unresolved).includes("guessed"));

const manual = required("report", "manual_evidence", { review: "required" });
const submittedReport = {
  criterionId: "report",
  evidenceRef: "report-1",
  kind: "manual",
  completeness: "complete",
  artifactRefs: ["pdf-submitted"],
};
valid(checked([manual], [submittedReport]), "inconclusive");
const asserted = required("executed", "observed_execution", {
  assertions: [{ id: "smoke", referenceId: "private-check" }],
});
const fakeExecution = {
  criterionId: "executed",
  evidenceRef: "run",
  kind: "execution",
  completeness: "complete",
  runRef: "fake-run",
  assertions: [{ assertionId: "smoke", state: "confirmed" }],
};
valid(checked([asserted], [fakeExecution]), "inconclusive");
assert.equal(checked([asserted], [{ ...fakeExecution, trusted: true }]).outcome, "invalid_evidence");
assert.equal(
  checked([exact], [{ ...text("stdout", "ok\n"), expected: "ok\n" }]).outcome,
  "invalid_evidence",
);

let getterCalled = false;
const getter = { ...evidence([]) };
Object.defineProperty(getter, "observations", {
  enumerable: true,
  get: () => {
    getterCalled = true;
    throw new Error("PRIVATE_CANARY_MUST_NOT_ECHO");
  },
});
const malformed = assay.evaluate(define([exact]), getter);
assert.equal(malformed.outcome, "invalid_evidence");
assert.equal(getterCalled, false);
assert.ok(!JSON.stringify(malformed).includes("PRIVATE_CANARY"));

const hostile = '<script>alert("x")</script><img src=x onerror=alert(1)>';
const hostileResult = valid(checked([exact], [text("stdout", hostile)]), "fail");
assert.ok(!JSON.stringify(hostileResult).includes("<script>"));
assert.ok(!JSON.stringify(hostileResult).includes("onerror"));

const portDefinition = define([exact, hidden]);
let requested = false;
const collected = await assay.collectObservations(portDefinition, evidence([]), {
  observe: async (request) => {
    requested = true;
    assert.deepEqual(request.criteria, [{ criterionId: "stdout", kind: "text" }]);
    const serialized = JSON.stringify(request);
    assert.ok(!serialized.includes("private-ref"));
    assert.ok(!serialized.includes("hidden-output"));
    assert.ok(!serialized.includes("expected"));
    return {
      schemaVersion: 1,
      definition: request.definition,
      provenance: {
        adapterId: "fixture-runner",
        adapterVersion: "v1",
        runRef: "mock-run",
        toolchainId: "none",
        toolchainVersion: "v1",
        capturedStdoutBytes: 3,
        capturedStderrBytes: 0,
        stdoutTruncated: true,
        stderrTruncated: false,
      },
      observations: [text("stdout", "ok\n")],
    };
  },
});
assert.equal(requested, true);
assert.equal(collected.ok, true);
if (collected.ok) {
  assert.equal(collected.evidence.observations[0].completeness, "truncated");
  valid(assay.evaluate(portDefinition, collected.evidence), "inconclusive");
  assert.equal("trusted" in collected.receipt, false);
}
const portRejected = await assay.collectObservations(define([exact]), evidence([]), {
  observe: async (request) => ({
    schemaVersion: 1,
    definition: request.definition,
    provenance: {
      adapterId: "mock",
      adapterVersion: "v1",
      runRef: "fake",
      toolchainId: "none",
      toolchainVersion: "v1",
      capturedStdoutBytes: 0,
      capturedStderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      trusted: true,
    },
    observations: [text("stdout", "ok\n")],
  }),
});
assert.equal(portRejected.outcome, "invalid_evidence");
assert.ok(!JSON.stringify(portRejected).includes("trusted"));

console.log("Independent packed ESM consumer: acceptance and hostile-input cases passed");
