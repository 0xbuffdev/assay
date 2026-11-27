import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ASSAY_EVALUATOR_VERSION,
  collectObservations,
  createAssessmentDefinition,
  createEvidenceBundle,
  createReferenceRecord,
  decodeSerializedRecord,
  evaluate,
  parseEvaluationResult,
  projectPublicResult,
  verifyEvidenceBundle,
  verifyReferenceBundle,
} from "@0xbuff/assay";

// This fixture runs only against the independently installed tarball. Every
// input, artifact, expected value and provider is synthetic; no program runs.
function unwrap(result) {
  assert.equal(result.ok, true);
  return result.value;
}

function seal(assessmentId, criteria) {
  return unwrap(
    createAssessmentDefinition({
      schemaVersion: 2,
      assessmentId,
      revision: "rev1",
      policyVersion: "all-required-v1",
      criteria,
    }),
  );
}

function criterion(id, kind, parameters, extra = {}) {
  return { id, kind, mode: "required", visibility: "public", parameters, ...extra };
}

function literal(value) {
  return { type: "literal", value };
}

function fact(criterionId, kind, value, extra = {}) {
  return {
    criterionId,
    evidenceRef: `obs-${criterionId}`,
    completeness: "complete",
    kind,
    value,
    ...extra,
  };
}

function evidence(definition, observations, artifactDigest) {
  return unwrap(
    createEvidenceBundle(definition, {
      schemaVersion: 2,
      observations,
      ...(artifactDigest === undefined ? {} : { artifactDigest }),
    }),
  );
}

function decoded(record) {
  return unwrap(decodeSerializedRecord(JSON.stringify(record)));
}

function complete(definition, observed, references, outcome, findings) {
  const result = evaluate(definition, observed, references);
  assert.equal(result.outcome, outcome);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.evaluator.version, ASSAY_EVALUATOR_VERSION);
  assert.equal(result.evidenceDigest, observed.evidenceDigest);
  assert.deepEqual(result.definition, { ...observed.definition });
  assert.equal(result.artifactDigest, observed.artifactDigest);
  assert.deepEqual(
    result.findings.map(({ criterionId, outcome, reasonCode }) => ({
      criterionId,
      outcome,
      reasonCode,
    })),
    findings,
  );
  assert.equal(parseEvaluationResult(result).ok, true);
  return result;
}

function finding(criterionId, outcome, reasonCode) {
  return { criterionId, outcome, reasonCode };
}

function publicFinding(criterionId, outcome, reason) {
  return { criterionId, outcome, reason };
}

function publicView(definition, result, outcome, findings) {
  const projection = projectPublicResult(definition, result);
  assert.deepEqual(projection, {
    ok: true,
    value: { schemaVersion: 1, outcome, findings },
  });
  return JSON.stringify(projection);
}

const opaque = { ok: false, reasonCode: "PUBLIC_PROJECTION_REJECTED" };
function invalid(definition, result, outcome, code, canaries) {
  assert.equal(result.outcome, outcome);
  assert.deepEqual(Object.keys(result).sort(), ["diagnostics", "outcome"]);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === code));
  for (const canary of canaries) assert.ok(!JSON.stringify(result).includes(canary));
  assert.deepEqual(projectPublicResult(definition, result), opaque);
}

// Scenario 1: an offline engineering tool validates an independently supplied
// sensor calibration record. Units and a closed tolerance are authored; no
// execution provider or protected material is necessary.
const calibration = seal("sensor-calibration", [
  criterion("offset", "number_with_tolerance", {
    expected: literal(100),
    tolerance: { absolute: 2, relative: 0 },
    unit: "mV",
  }),
  criterion("status", "boolean_equality", { expected: literal(true) }),
]);
const sensorFacts = [
  fact("offset", "number", 102, { unit: "mV" }),
  fact("status", "boolean", true),
];
const sensorEvidence = evidence(calibration, sensorFacts);
const calibrated = complete(decoded(calibration), decoded(sensorEvidence), undefined, "pass", [
  finding("offset", "pass", "MATCH"),
  finding("status", "pass", "MATCH"),
]);
publicView(calibration, calibrated, "pass", [
  publicFinding("offset", "pass", "match"),
  publicFinding("status", "pass", "match"),
]);
const outOfTolerance = complete(
  calibration,
  evidence(calibration, [{ ...sensorFacts[0], value: 103 }, sensorFacts[1]]),
  undefined,
  "fail",
  [finding("offset", "fail", "VALUE_MISMATCH"), finding("status", "pass", "MATCH")],
);
publicView(calibration, outOfTolerance, "fail", [
  publicFinding("offset", "fail", "mismatch"),
  publicFinding("status", "pass", "match"),
]);
const missingSensor = complete(calibration, evidence(calibration, []), undefined, "inconclusive", [
  finding("offset", "inconclusive", "EVIDENCE_MISSING"),
  finding("status", "inconclusive", "EVIDENCE_MISSING"),
]);
publicView(calibration, missingSensor, "inconclusive", [
  publicFinding("offset", "inconclusive", "missing_evidence"),
  publicFinding("status", "inconclusive", "missing_evidence"),
]);
const wrongUnit = createEvidenceBundle(calibration, {
  schemaVersion: 2,
  observations: [{ ...sensorFacts[0], unit: "V" }, sensorFacts[1]],
});
assert.equal(wrongUnit.ok, false);
assert.equal(wrongUnit.domain, "invalid_evidence");

// Scenario 2: a CLI inventory-summary assessment combines public selected
// stdout and exit-status facts from a mock adapter with a protected structured
// result supplied by a separate host-owned comparison environment.
const hiddenId = "AYI25_PRIVATE_CRITERION";
const hiddenRef = "AYI25_PRIVATE_REFERENCE";
const hiddenFactRef = "AYI25_PRIVATE_OBSERVATION";
const hiddenValue = "AYI25_PRIVATE_CONTENT";
const providerError = "AYI25_PRIVATE_PROVIDER_ERROR";
const publicOutput = "items=3\n";
const artifactDigest = `sha256:${createHash("sha256").update("synthetic-inventory-artifact").digest("hex")}`;
const protectedExpected = { groups: [{ sku: hiddenValue, count: 2 }, { sku: "B", count: 1 }] };
const reference = unwrap(
  createReferenceRecord({
    schemaVersion: 2,
    referenceId: hiddenRef,
    kind: "json",
    value: protectedExpected,
  }),
);
const inventory = seal("inventory-summary", [
  criterion(
    "summary",
    "exact_text",
    { expected: literal(publicOutput) },
    { executionFact: "stdout" },
  ),
  criterion(
    "exit",
    "number_with_tolerance",
    { expected: literal(0), tolerance: { absolute: 0, relative: 0 } },
    { executionFact: "exit_status" },
  ),
  criterion(
    hiddenId,
    "json_equality",
    {
      expected: {
        type: "reference",
        referenceId: hiddenRef,
        referenceDigest: reference.referenceDigest,
      },
    },
    { visibility: "restricted", executionFact: "structured_stdout" },
  ),
]);
const protectedOrigin = {
  kind: "artifact",
  artifactDigest,
  sourceRef: "protected-fixture",
  runRef: "protected-run",
  termination: "exited",
};
function initial(value = protectedExpected) {
  return evidence(
    inventory,
    [
      fact(hiddenId, "json", value, {
        evidenceRef: hiddenFactRef,
        executionFact: "structured_stdout",
        origin: protectedOrigin,
      }),
    ],
    artifactDigest,
  );
}

const starting = initial();
const references = {
  schemaVersion: 2,
  definition: starting.definition,
  references: [reference],
};
assert.equal(verifyReferenceBundle(inventory, decoded(references)).ok, true);
const canaries = [
  hiddenId,
  hiddenRef,
  hiddenFactRef,
  hiddenValue,
  providerError,
  reference.referenceDigest,
  starting.evidenceDigest,
  artifactDigest,
  inventory.revisionDigest,
  "protected-run",
  "protected-fixture",
];
const requested = [
  { criterionId: "summary", kind: "text", executionFact: "stdout" },
  { criterionId: "exit", kind: "number", executionFact: "exit_status" },
];

function mockReport(request, { truncated = false, unavailable = false, output = publicOutput } = {}) {
  assert.deepEqual(request.criteria, requested);
  assert.deepEqual(request.definition, { ...starting.definition });
  assert.equal(request.artifactDigest, artifactDigest);
  // Definition/artifact identity is deliberately present in the scoped
  // request. No hidden criterion, expected content or reference digest is.
  const requestBytes = JSON.stringify(request);
  for (const secret of [hiddenId, hiddenRef, hiddenValue, reference.referenceDigest, hiddenFactRef]) {
    assert.ok(!requestBytes.includes(secret));
  }
  assert.ok(!requestBytes.includes("expected"));
  assert.ok(!requestBytes.includes(JSON.stringify(publicOutput)));
  return {
    schemaVersion: 2,
    definition: request.definition,
    artifactDigest: request.artifactDigest,
    termination: "exited",
    provenance: {
      adapterId: "inventory-mock",
      adapterVersion: "v1",
      runRef: "public-run",
      toolchainId: "fixture",
      toolchainVersion: "v1",
      capturedStdoutBytes: unavailable ? 0 : Buffer.byteLength(output, "utf8"),
      capturedStderrBytes: 0,
      stdoutTruncated: truncated,
      stderrTruncated: false,
    },
    observations: unavailable
      ? []
      : [
          fact("summary", "text", output, { executionFact: "stdout" }),
          fact("exit", "number", 0, { executionFact: "exit_status" }),
        ],
  };
}

async function acquire(existing, options) {
  const original = JSON.stringify(existing);
  const collected = await collectObservations(inventory, existing, {
    observe: async (request) => mockReport(request, options),
  });
  assert.equal(collected.ok, true);
  assert.equal(JSON.stringify(existing), original);
  assert.equal(verifyEvidenceBundle(inventory, collected.evidence).ok, true);
  assert.deepEqual(collected.evidence.observations[0], existing.observations[0]);
  assert.equal(collected.receipt.evidenceDigest, collected.evidence.evidenceDigest);
  assert.equal(collected.receipt.artifactDigest, artifactDigest);
  assert.deepEqual(
    collected.receipt.evidenceRefs,
    options?.unavailable ? [] : ["obs-summary", "obs-exit"],
  );
  return collected.evidence;
}

const collected = await acquire(starting);
const publicMatches = [finding("summary", "pass", "MATCH"), finding("exit", "pass", "MATCH")];
const publicFeedback = [
  publicFinding("summary", "pass", "match"),
  publicFinding("exit", "pass", "match"),
];
const pass = complete(inventory, collected, references, "pass", [
  ...publicMatches,
  finding(hiddenId, "pass", "MATCH"),
]);
const passBytes = publicView(inventory, pass, "withheld", publicFeedback);
assert.equal(
  JSON.stringify(evaluate(decoded(inventory), decoded(collected), decoded(references))),
  JSON.stringify(pass),
);
assert.equal("grade" in pass, false);
assert.equal("certificate" in pass, false);
assert.equal("trusted" in pass, false);

const wrongProtected = await acquire(initial({ groups: [{ sku: hiddenValue, count: 3 }] }));
const privateFail = complete(inventory, wrongProtected, references, "fail", [
  ...publicMatches,
  finding(hiddenId, "fail", "VALUE_MISMATCH"),
]);
const absent = complete(inventory, collected, undefined, "inconclusive", [
  ...publicMatches,
  finding(hiddenId, "inconclusive", "REFERENCE_UNAVAILABLE"),
]);
const emptyReference = complete(
  inventory,
  collected,
  { ...references, references: [] },
  "inconclusive",
  [...publicMatches, finding(hiddenId, "inconclusive", "REFERENCE_UNAVAILABLE")],
);
for (const result of [privateFail, absent, emptyReference]) {
  assert.equal(publicView(inventory, result, "withheld", publicFeedback), passBytes);
}
for (const secret of [...canaries, collected.evidenceDigest, "obs-summary", "obs-exit", "public-run"]) {
  assert.ok(!passBytes.includes(secret));
}

const malformedReference = {
  ...references,
  references: [{ ...reference, value: { payload: "AYI25_PRIVATE_MUTATION" } }],
};
invalid(
  inventory,
  evaluate(inventory, collected, malformedReference),
  "invalid_reference",
  "REFERENCE_DIGEST_MISMATCH",
  [...canaries, "AYI25_PRIVATE_MUTATION"],
);
invalid(
  inventory,
  evaluate(inventory, collected, {
    ...references,
    definition: { ...references.definition, revision: "rev2" },
  }),
  "invalid_reference",
  "MISMATCHED_DEFINITION",
  canaries,
);
const tampered = {
  ...collected,
  observations: collected.observations.map((item) =>
    item.criterionId === hiddenId ? { ...item, value: { secret: hiddenValue } } : item,
  ),
};
invalid(
  inventory,
  evaluate(inventory, tampered, references),
  "invalid_evidence",
  "EVIDENCE_DIGEST_MISMATCH",
  canaries,
);
invalid(
  inventory,
  evaluate(inventory, sensorEvidence),
  "invalid_evidence",
  "MISMATCHED_DEFINITION",
  canaries,
);

const truncated = await acquire(starting, { truncated: true });
const partial = complete(inventory, truncated, references, "inconclusive", [
  finding("summary", "inconclusive", "EVIDENCE_TRUNCATED"),
  finding("exit", "pass", "MATCH"),
  finding(hiddenId, "pass", "MATCH"),
]);
publicView(inventory, partial, "withheld", [
  publicFinding("summary", "inconclusive", "incomplete_evidence"),
  publicFinding("exit", "pass", "match"),
]);
const unavailable = await acquire(starting, { unavailable: true });
const pending = complete(inventory, unavailable, references, "inconclusive", [
  finding("summary", "inconclusive", "EVIDENCE_MISSING"),
  finding("exit", "inconclusive", "EVIDENCE_MISSING"),
  finding(hiddenId, "pass", "MATCH"),
]);
publicView(inventory, pending, "withheld", [
  publicFinding("summary", "inconclusive", "missing_evidence"),
  publicFinding("exit", "inconclusive", "missing_evidence"),
]);
const providerFailure = await collectObservations(inventory, starting, {
  observe: async () => {
    throw new Error(providerError);
  },
});
assert.deepEqual(providerFailure, {
  ok: false,
  outcome: "evaluation_error",
  reasonCode: "OBSERVATION_PORT_ERROR",
});
assert.equal("receipt" in providerFailure, false);
assert.ok(!JSON.stringify(providerFailure).includes(providerError));
assert.deepEqual(projectPublicResult(inventory, providerFailure), opaque);

const wrongPublic = await acquire(starting, { output: "items=4\n" });
const publicFail = complete(inventory, wrongPublic, undefined, "fail", [
  finding("summary", "fail", "VALUE_MISMATCH"),
  finding("exit", "pass", "MATCH"),
  finding(hiddenId, "inconclusive", "REFERENCE_UNAVAILABLE"),
]);
publicView(inventory, publicFail, "withheld", [
  publicFinding("summary", "fail", "mismatch"),
  publicFinding("exit", "pass", "match"),
]);
assert.deepEqual(projectPublicResult(inventory, { ...pass, outcome: "fail" }), opaque);
console.log("AY-I25 installed standalone assessment scenarios passed (synthetic facts only)");
