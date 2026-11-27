import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as assay from "@0xbuff/assay";

const digest = (letter) => `sha256:${letter.repeat(64)}`;
const lineage = (definition) => ({
  assessmentId: definition.assessmentId,
  revision: definition.revision,
  revisionDigest: definition.revisionDigest,
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
const draft = (criteria, revision = "rev1") => ({
  schemaVersion: 1,
  assessmentId: "external-consumer",
  revision,
  policyVersion: "all-required-v1",
  criteria,
});
function define(criteria, revision) {
  const sealed = assay.createAssessmentDefinition(draft(criteria, revision));
  assert.equal(sealed.ok, true, "Valid authored fixture must seal");
  return sealed.value;
}
// Independently seal synthetic inputs, including malformed negative fixtures.
function evidence(observations, definition) {
  const content = { schemaVersion: 2, definition: lineage(definition), observations };
  const bytes = JSON.stringify(content, (_key, value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]]),
    );
  });
  return {
    ...content,
    evidenceDigest: `sha256:${createHash("sha256").update(`assay:evidence:v2\n${bytes}`, "utf8").digest("hex")}`,
  };
}
function checked(criteria, observations, revision) {
  const definition = define(criteria, revision);
  return assay.evaluate(definition, evidence(observations, definition));
}
function invalidDefinition(criteria, revision) {
  const definition = { ...draft(criteria, revision), revisionDigest: digest("a") };
  return assay.evaluate(definition, evidence([], definition));
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
    "CONTRACT_LIMITS",
    "collectObservations",
    "evaluate",
    "inspectEvidenceCoverage",
    "parseAssessmentDefinition",
    "parseEvaluationResult",
    "parseEvidenceBundle",
    "parseObservationPortReport",
    "projectPublicResult",
  ].sort(),
);
assert.equal(assay.ASSAY_SCHEMA_VERSION, 1);

assert.equal(assay.ASSAY_DEFINITION_DIGEST_VERSION, "v1");
const unsigned = {
  schemaVersion: 1,
  assessmentId: "packed-integrity",
  revision: "rev1",
  policyVersion: "all-required-v1",
  criteria: [
    required("output", "exact_text", {
      expected: { type: "literal", value: "ok" },
    }),
  ],
};
const created = assay.createAssessmentDefinition(unsigned);
assert.equal(created.ok, true);
const sealed = created.value;
const separatelyComputed = assay.computeDefinitionDigest(unsigned);
assert.equal(separatelyComputed.ok, true);
assert.equal(sealed.revisionDigest, separatelyComputed.value);
assert.equal(assay.verifyAssessmentDefinition(sealed).ok, true);
const sealedInput = assay.createEvidenceBundle(sealed, {
  schemaVersion: 2,
  observations: [text("output", "ok")],
});
assert.equal(sealedInput.ok, true);
const sealedEvidence = sealedInput.value;
assert.equal(
  sealedEvidence.evidenceDigest,
  evidence([text("output", "ok")], sealed).evidenceDigest,
);
assert.equal(assay.verifyEvidenceBundle(sealed, sealedEvidence).ok, true);
assert.equal(assay.evaluate(sealed, sealedEvidence).outcome, "pass");

const visibleProjection = assay.projectPublicResult(sealed, assay.evaluate(sealed, sealedEvidence));
assert.deepEqual(visibleProjection, {
  ok: true,
  value: {
    schemaVersion: 1,
    outcome: "pass",
    findings: [{ criterionId: "output", outcome: "pass" }],
  },
});

const privateSealed = assay.createAssessmentDefinition({
  ...unsigned,
  criteria: [
    ...unsigned.criteria,
    required(
      "PRIVATE_CRITERION_CANARY",
      "exact_text",
      {
        expected: { type: "reference", referenceId: "PRIVATE_REFERENCE_CANARY" },
      },
      "restricted",
    ),
  ],
});
assert.equal(privateSealed.ok, true);
const privateEvidence = evidence(sealedEvidence.observations, privateSealed.value);
const privateTechnical = assay.evaluate(privateSealed.value, privateEvidence);
assert.equal(privateTechnical.outcome, "inconclusive");
const privateProjection = assay.projectPublicResult(privateSealed.value, privateTechnical);
assert.deepEqual(privateProjection, {
  ok: true,
  value: {
    schemaVersion: 1,
    outcome: "withheld",
    findings: [{ criterionId: "output", outcome: "pass" }],
  },
});
assert.equal(JSON.stringify(privateProjection).includes("PRIVATE_"), false);
assert.deepEqual(
  assay.projectPublicResult(
    {
      ...privateSealed.value,
      criteria: privateSealed.value.criteria.map((c) => ({
        ...c,
        visibility: "public",
      })),
    },
    privateTechnical,
  ),
  { ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" },
);
assert.deepEqual(
  assay.projectPublicResult(privateSealed.value, { ...privateTechnical, outcome: "pass" }),
  { ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" },
);

const changedBody = {
  ...sealed,
  criteria: [
    {
      ...sealed.criteria[0],
      parameters: { expected: { type: "literal", value: "forged" } },
    },
  ],
};
assert.deepEqual(assay.verifyAssessmentDefinition(changedBody).diagnostics, [
  { path: "$.revisionDigest", code: "DEFINITION_DIGEST_MISMATCH" },
]);
assert.deepEqual(assay.evaluate(changedBody, sealedEvidence), {
  outcome: "invalid_definition",
  diagnostics: [{ path: "$.revisionDigest", code: "DEFINITION_DIGEST_MISMATCH" }],
});
let tamperedProviderCalled = false;
const tamperedCollection = await assay.collectObservations(changedBody, evidence([], sealed), {
  observe: async () => {
    tamperedProviderCalled = true;
    return {};
  },
});
assert.deepEqual(tamperedCollection, {
  ok: false,
  outcome: "invalid_definition",
  diagnostics: [{ path: "$.revisionDigest", code: "DEFINITION_DIGEST_MISMATCH" }],
});
assert.equal(tamperedProviderCalled, false);
assert.equal(
  assay.createAssessmentDefinition({ ...unsigned, revisionDigest: sealed.revisionDigest }).ok,
  false,
);

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
const metered = {
  ...number,
  parameters: { ...number.parameters, unit: "m" },
};
valid(checked([metered], [{ ...numeric(100), unit: "m" }]), "pass");
assert.equal(checked([metered], [numeric(100)]).outcome, "invalid_evidence");
assert.equal(checked([metered], [{ ...numeric(100), unit: "ft" }]).outcome, "invalid_evidence");
assert.equal(checked([number], [{ ...numeric(100), unit: "m" }]).outcome, "invalid_evidence");
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
  checked([exact, positiveAdvice], [text("stdout", "incorrect"), text("hint", "nice")]),
  "fail",
);
assert.equal(invalidDefinition([]).outcome, "invalid_definition");
assert.equal(invalidDefinition([positiveAdvice]).outcome, "invalid_definition");
const changed = checked([exact], [text("stdout", "ok\n")], "rev2");
assert.notEqual(changed.definition.revisionDigest, perfect.definition.revisionDigest);
assert.equal(invalidDefinition([exact], "latest").outcome, "invalid_definition");
assert.equal(
  assay.evaluate(define([exact]), { ...evidence([], define([exact])), extraGrade: "100%" }).outcome,
  "invalid_evidence",
);
assert.equal(
  assay.evaluate(define([exact]), evidence([], define([exact], "rev2"))).outcome,
  "invalid_evidence",
);

const hidden = required(
  "hidden-output",
  "exact_text",
  {
    expected: { type: "reference", referenceId: "private-ref" },
  },
  "restricted",
);
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
assert.equal(
  checked([asserted], [{ ...fakeExecution, trusted: true }]).outcome,
  "invalid_evidence",
);
assert.equal(
  checked([exact], [{ ...text("stdout", "ok\n"), expected: "ok\n" }]).outcome,
  "invalid_evidence",
);

let getterCalled = false;
const getter = { ...evidence([], define([exact])) };
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
const collected = await assay.collectObservations(portDefinition, evidence([], portDefinition), {
  observe: async (request) => {
    requested = true;
    assert.deepEqual(request.criteria, [{ criterionId: "stdout", kind: "text" }]);
    const serialized = JSON.stringify(request);
    assert.ok(!serialized.includes("private-ref"));
    assert.ok(!serialized.includes("hidden-output"));
    assert.ok(!serialized.includes("expected"));
    return {
      schemaVersion: 2,
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
const publicDefinition = define([exact]);
const portRejected = await assay.collectObservations(
  publicDefinition,
  evidence([], publicDefinition),
  {
    observe: async (request) => ({
      schemaVersion: 2,
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
  },
);
assert.equal(portRejected.outcome, "invalid_evidence");
assert.ok(!JSON.stringify(portRejected).includes("trusted"));

console.log("Independent packed ESM consumer: acceptance and hostile-input cases passed");

// AY-I13: independently pinned schema-2 content and definition lineage.
const reference = assay.createReferenceRecord({
  schemaVersion: 2,
  referenceId: "secret",
  kind: "text",
  value: "café\n",
});
assert.equal(reference.ok, true);
assert.equal(
  reference.value.referenceDigest,
  "sha256:b76df28194a4dc2b9afda31ff4dd8061e358f17bfd2a41c7ce5b7ad80046ecf5",
);
const bound = assay.createAssessmentDefinition({
  schemaVersion: 2,
  assessmentId: "vector",
  revision: "rev1",
  policyVersion: "all-required-v1",
  criteria: [
    {
      id: "output",
      kind: "exact_text",
      mode: "required",
      visibility: "restricted",
      parameters: {
        expected: {
          type: "reference",
          referenceId: reference.value.referenceId,
          referenceDigest: reference.value.referenceDigest,
        },
      },
    },
  ],
});
assert.equal(bound.ok, true);
assert.equal(
  bound.value.revisionDigest,
  "sha256:eb3dcfbc24c13e625e95f0d86b75da3f652805aed29c34c2bcc7cc42b0f5a321",
);
const bundle = {
  schemaVersion: 2,
  definition: {
    assessmentId: bound.value.assessmentId,
    revision: bound.value.revision,
    revisionDigest: bound.value.revisionDigest,
  },
  references: [reference.value],
};
assert.equal(assay.verifyReferenceBundle(bound.value, bundle).ok, true);
assert.equal(assay.verifyReferenceBundle(bound.value, { ...bundle, references: [] }).ok, true);
const changedReference = assay.verifyReferenceBundle(bound.value, {
  ...bundle,
  references: [{ ...reference.value, value: "PRIVATE_REFERENCE_CONTENT_CANARY" }],
});
assert.equal(changedReference.ok, false);
assert.equal(changedReference.domain, "invalid_reference");
assert.ok(!JSON.stringify(changedReference).includes("PRIVATE_REFERENCE_CONTENT_CANARY"));
const boundEvidence = evidence([text("output", "café\n", "reference-observation")], bound.value);
assert.equal(
  assay.evaluate(bound.value, boundEvidence).outcome,
  "inconclusive",
  "Omitted reference bundles remain inconclusive",
);

const protectedPass = valid(assay.evaluate(bound.value, boundEvidence, bundle), "pass");
const protectedFail = valid(
  assay.evaluate(
    bound.value,
    evidence([{ ...boundEvidence.observations[0], value: "wrong" }], bound.value),
    bundle,
  ),
  "fail",
);
assert.equal(protectedPass.findings[0].reasonCode, "MATCH");
assert.equal(protectedFail.findings[0].reasonCode, "VALUE_MISMATCH");
const projectedPass = assay.projectPublicResult(bound.value, protectedPass);
assert.deepEqual(projectedPass, assay.projectPublicResult(bound.value, protectedFail));
assert.deepEqual(projectedPass, {
  ok: true,
  value: { schemaVersion: 1, outcome: "withheld", findings: [] },
});
assert.ok(!JSON.stringify(protectedPass).includes(reference.value.referenceDigest));
assert.ok(!JSON.stringify(protectedPass).includes("café"));
const invalidReference = assay.evaluate(bound.value, boundEvidence, {
  ...bundle,
  references: [{ ...reference.value, value: "PRIVATE_REFERENCE_CONTENT_CANARY" }],
});
assert.equal(invalidReference.outcome, "invalid_reference");
assert.deepEqual(Object.keys(invalidReference).sort(), ["diagnostics", "outcome"]);
assert.ok(!JSON.stringify(invalidReference).includes("PRIVATE_REFERENCE_CONTENT_CANARY"));
assert.equal(
  assay.evaluate(bound.value, boundEvidence, { ...bundle, references: [] }).outcome,
  "inconclusive",
);

assert.equal(protectedPass.evidenceDigest, boundEvidence.evidenceDigest);
assert.notEqual(protectedPass.evidenceDigest, protectedFail.evidenceDigest);
assert.ok(!JSON.stringify(projectedPass).includes(boundEvidence.evidenceDigest));
const rejectedEvidence = assay.evaluate(
  bound.value,
  {
    ...boundEvidence,
    observations: [{ ...boundEvidence.observations[0], value: "PRIVATE_EVIDENCE_CANARY" }],
  },
  bundle,
);
assert.equal(rejectedEvidence.outcome, "invalid_evidence");
assert.ok(!JSON.stringify(rejectedEvidence).includes("PRIVATE_EVIDENCE_CANARY"));
const scoped = assay.createEvidenceBundle(sealed, {
  schemaVersion: 2,
  artifactDigest: digest("a"),
  observations: [
    {
      ...text("output", "ok"),
      origin: {
        kind: "artifact",
        sourceRef: "fixture",
        runRef: "run1",
        artifactDigest: digest("a"),
      },
    },
  ],
});
assert.equal(scoped.ok, true);
const scopedResult = valid(assay.evaluate(sealed, scoped.value), "pass");
assert.equal(scopedResult.artifactDigest, digest("a"));
assert.equal(scopedResult.evidenceDigest, scoped.value.evidenceDigest);
assert.equal(
  assay.createEvidenceBundle(sealed, {
    schemaVersion: 2,
    artifactDigest: digest("b"),
    observations: scoped.value.observations,
  }).ok,
  false,
);
assert.equal(
  assay.evaluate(sealed, {
    schemaVersion: 1,
    definition: lineage(sealed),
    observations: [text("output", "ok")],
  }).outcome,
  "invalid_evidence",
);
assert.equal(collected.receipt.evidenceDigest, collected.evidence.evidenceDigest);
assert.deepEqual(collected.receipt.evidenceRefs, ["stdout"]);
assert.equal(collected.evidence.observations[0].origin.provenance.runRef, "mock-run");

// AY-I16: the independent installed consumer rejects unsupported policies and results.
assert.equal(
  assay.createAssessmentDefinition({ ...draft([exact]), policyVersion: "policy1" }).ok,
  false,
);
for (const outcome of ["invalid_definition", "invalid_evidence", "invalid_reference"]) {
  assert.equal(assay.parseEvaluationResult({ ...perfect, outcome }).ok, false);
}
assert.equal(assay.parseEvaluationResult({ ...perfect, warnings: ["UNKNOWN_WARNING"] }).ok, false);
assert.equal(
  assay.parseEvaluationResult({
    ...perfect,
    findings: [{ ...perfect.findings[0], reasonCode: "VALUE_MISMATCH" }],
  }).ok,
  false,
);
