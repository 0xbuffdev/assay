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

function allComposition(criteria) {
  return {
    rootGroupId: "fixture-root",
    groups: [
      {
        id: "fixture-root",
        operator: "all",
        children: criteria
          .filter((criterion) => criterion.mode === "required")
          .map((criterion) => ({
            kind: "criterion",
            id: criterion.id,
          })),
      },
    ],
  };
}

function seal(assessmentId, criteria) {
  return unwrap(
    createAssessmentDefinition({
      schemaVersion: 4,
      assessmentId,
      revision: "rev1",
      policyVersion: "composed-required-v1",
      criteria,
      composition: allComposition(criteria),
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
      schemaVersion: 4,
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
  assert.equal(result.schemaVersion, 4);
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
    value: { schemaVersion: 4, outcome, findings },
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
  schemaVersion: 4,
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
const protectedExpected = {
  groups: [
    { sku: hiddenValue, count: 2 },
    { sku: "B", count: 1 },
  ],
};
const reference = unwrap(
  createReferenceRecord({
    schemaVersion: 4,
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
  schemaVersion: 4,
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

function mockReport(
  request,
  { truncated = false, unavailable = false, output = publicOutput } = {},
) {
  assert.deepEqual(request.criteria, requested);
  assert.deepEqual(request.definition, { ...starting.definition });
  assert.equal(request.artifactDigest, artifactDigest);
  // Definition/artifact identity is deliberately present in the scoped
  // request. No hidden criterion, expected content or reference digest is.
  const requestBytes = JSON.stringify(request);
  for (const secret of [
    hiddenId,
    hiddenRef,
    hiddenValue,
    reference.referenceDigest,
    hiddenFactRef,
  ]) {
    assert.ok(!requestBytes.includes(secret));
  }
  assert.ok(!requestBytes.includes("expected"));
  assert.ok(!requestBytes.includes(JSON.stringify(publicOutput)));
  return {
    schemaVersion: 4,
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
for (const secret of [
  ...canaries,
  collected.evidenceDigest,
  "obs-summary",
  "obs-exit",
  "public-run",
]) {
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

// AY-I28: an offline design-check exercise requires correct output AND one
// of two explicitly sufficient demonstrations. The private reference is
// supplied by the host, never acquired from a reviewer or public fact port.
const expandedHidden = "AYI28_PRIVATE_BRANCH";
const expandedReview = "AYI28_PRIVATE_REVIEW";
const expandedReference = unwrap(
  createReferenceRecord({
    schemaVersion: 4,
    referenceId: "AYI28_PRIVATE_REFERENCE",
    kind: "number",
    value: 50,
  }),
);
const expandedArtifact = `sha256:${createHash("sha256").update("synthetic-design-artifact").digest("hex")}`;
const common = criterion("output", "exact_text", { expected: literal("ok") });
const alternative = criterion("measurement", "number_range", {
  expected: literal({ min: 10, max: 20, minInclusive: true, maxInclusive: true }),
  unit: "ms",
});
const protectedAlternative = criterion(
  expandedHidden,
  "number_with_tolerance",
  {
    expected: {
      type: "reference",
      referenceId: expandedReference.referenceId,
      referenceDigest: expandedReference.referenceDigest,
    },
    tolerance: { absolute: 0, relative: 0 },
  },
  { visibility: "restricted" },
);
const reviewPolicy = { reviewPolicyId: "design-review", reviewPolicyVersion: "rev1" };
const publicAdvice = criterion("explanation", "qualitative_review", reviewPolicy, {
  mode: "advisory",
});
const hiddenAdvice = { ...publicAdvice, id: expandedReview, visibility: "restricted" };
const requiredManual = criterion("design-defense", "manual_evidence", { review: "required" });
const composedDraft = {
  schemaVersion: 4,
  assessmentId: "design-check",
  revision: "rev1",
  policyVersion: "composed-required-v1",
  criteria: [common, alternative, protectedAlternative, publicAdvice, hiddenAdvice],
  composition: {
    rootGroupId: "root",
    groups: [
      {
        id: "AYI28_PRIVATE_GROUP",
        operator: "any",
        children: [
          { kind: "criterion", id: expandedHidden },
          { kind: "criterion", id: "measurement" },
        ],
      },
      {
        id: "root",
        operator: "all",
        children: [
          { kind: "criterion", id: "output" },
          { kind: "group", id: "AYI28_PRIVATE_GROUP" },
        ],
      },
    ],
  },
};
const composed = unwrap(createAssessmentDefinition(composedDraft));
const independentOrigin = { kind: "independent", sourceRef: "fixture" };
const expandedOrigin = {
  kind: "artifact",
  artifactDigest: expandedArtifact,
  sourceRef: "AYI28_PRIVATE_SOURCE",
};
const outputFact = fact("output", "text", "ok", { origin: independentOrigin });
const measurementFact = fact("measurement", "number", 15, {
  unit: "ms",
  origin: independentOrigin,
});
const protectedFact = fact(expandedHidden, "number", 50, {
  evidenceRef: "AYI28_PRIVATE_FACT",
  origin: expandedOrigin,
});
const humanReview = {
  criterionId: "explanation",
  evidenceRef: "AYI28_PRIVATE_PUBLIC_REVIEW_REF",
  kind: "qualitative_review",
  completeness: "complete",
  origin: expandedOrigin,
  ...reviewPolicy,
  reviewer: { kind: "human", reviewerId: "AYI28_PRIVATE_HUMAN", reviewerVersion: "rev1" },
  uncertainty: "unknown",
  feedback: "AYI28_PRIVATE_FEEDBACK: explanation requires independent review.",
  citations: [{ artifactRef: "AYI28_PRIVATE_CITATION", startByte: 0, endByte: 10 }],
};
const modelReview = {
  ...humanReview,
  criterionId: expandedReview,
  evidenceRef: "AYI28_PRIVATE_MODEL_REVIEW_REF",
  reviewer: {
    kind: "model",
    providerId: "AYI28_PRIVATE_PROVIDER",
    modelId: "AYI28_PRIVATE_MODEL",
    modelVersion: "rev1",
    promptId: "AYI28_PRIVATE_PROMPT",
    promptVersion: "rev2",
  },
  uncertainty: "low",
  feedback: "AYI28_PRIVATE_MODEL_FEEDBACK: favorable explanation.",
};
function expandedEvidence(definition, observations) {
  return evidence(definition, observations, expandedArtifact);
}
const composedEvidence = expandedEvidence(composed, [
  outputFact,
  measurementFact,
  protectedFact,
  humanReview,
  modelReview,
]);
const composedReferences = {
  schemaVersion: 4,
  definition: composedEvidence.definition,
  references: [expandedReference],
};
const expandedCanaries = [
  "AYI28_PRIVATE_",
  expandedArtifact,
  composed.revisionDigest,
  composedEvidence.evidenceDigest,
  expandedReference.referenceDigest,
  outputFact.evidenceRef,
  measurementFact.evidenceRef,
];
const outputPass = finding("output", "pass", "MATCH");
const measurementPass = finding("measurement", "pass", "MATCH");
const measurementFail = finding("measurement", "fail", "VALUE_MISMATCH");
const hiddenPass = finding(expandedHidden, "pass", "MATCH");
const hiddenFail = finding(expandedHidden, "fail", "VALUE_MISMATCH");
const hiddenMissing = finding(expandedHidden, "inconclusive", "EVIDENCE_MISSING");
const reviewNeeded = finding("explanation", "inconclusive", "REVIEW_REQUIRED");
const hiddenNeeded = finding(expandedReview, "inconclusive", "REVIEW_REQUIRED");
const hiddenAbsent = finding(expandedReview, "inconclusive", "EVIDENCE_MISSING");
const hiddenTruncated = finding(expandedReview, "inconclusive", "EVIDENCE_TRUNCATED");
const publicExpanded = [
  publicFinding("output", "pass", "match"),
  publicFinding("measurement", "pass", "match"),
  publicFinding("explanation", "inconclusive", "review_needed"),
];
const expandedPass = complete(
  decoded(composed),
  decoded(composedEvidence),
  decoded(composedReferences),
  "pass",
  [outputPass, measurementPass, hiddenPass, reviewNeeded, hiddenNeeded],
);
assert.deepEqual(expandedPass.warnings, ["ADVISORY_UNRESOLVED"]);
assert.equal(verifyEvidenceBundle(composed, composedEvidence).ok, true);
assert.equal(verifyReferenceBundle(composed, composedReferences).ok, true);
const expandedPublicBytes = publicView(composed, expandedPass, "withheld", publicExpanded);
for (const secret of expandedCanaries) assert.ok(!expandedPublicBytes.includes(secret));
for (const key of ["feedback", "reviewer", "citations"]) {
  assert.ok(!JSON.stringify(expandedPass).includes(key));
}

// Public alternative wins without a protected fact or available reference;
// every valid leaf retains its own outcome. Hidden review changes never leak.
for (const [privateFacts, privateFinding, reviewFacts, reviewFinding, suppliedReferences] of [
  [[{ ...protectedFact, value: 49 }], hiddenFail, [], hiddenAbsent, composedReferences],
  [[], hiddenMissing, [modelReview], hiddenNeeded, composedReferences],
  [
    [protectedFact],
    finding(expandedHidden, "inconclusive", "REFERENCE_UNAVAILABLE"),
    [{ ...modelReview, completeness: "truncated" }],
    hiddenTruncated,
    undefined,
  ],
]) {
  const record = expandedEvidence(composed, [
    outputFact,
    measurementFact,
    ...privateFacts,
    humanReview,
    ...reviewFacts,
  ]);
  const result = complete(composed, record, suppliedReferences, "pass", [
    outputPass,
    measurementPass,
    privateFinding,
    reviewNeeded,
    reviewFinding,
  ]);
  assert.equal(publicView(composed, result, "withheld", publicExpanded), expandedPublicBytes);
  assert.equal(
    JSON.stringify(evaluate(decoded(composed), decoded(record), suppliedReferences)),
    JSON.stringify(result),
  );
}

// Private alternative wins if the measurement fails. A common output
// failure cannot be bypassed by either alternative. Both alternatives fail
// when both are observed but wrong; no usable alternative stays unresolved.
const failedMeasurement = { ...measurementFact, value: 21 };
const privateWinnerEvidence = expandedEvidence(composed, [
  outputFact,
  failedMeasurement,
  protectedFact,
  humanReview,
  modelReview,
]);
const privateWinner = complete(composed, privateWinnerEvidence, composedReferences, "pass", [
  outputPass,
  measurementFail,
  hiddenPass,
  reviewNeeded,
  hiddenNeeded,
]);
const failedAlternatives = complete(
  composed,
  expandedEvidence(composed, [
    outputFact,
    failedMeasurement,
    { ...protectedFact, value: 49 },
    humanReview,
    modelReview,
  ]),
  composedReferences,
  "fail",
  [outputPass, measurementFail, hiddenFail, reviewNeeded, hiddenNeeded],
);
const missingAlternative = complete(
  composed,
  expandedEvidence(composed, [outputFact, failedMeasurement, humanReview, modelReview]),
  composedReferences,
  "inconclusive",
  [outputPass, measurementFail, hiddenMissing, reviewNeeded, hiddenNeeded],
);
const publicFailedMeasurement = [
  publicExpanded[0],
  publicFinding("measurement", "fail", "mismatch"),
  publicExpanded[2],
];
const privateWinnerBytes = publicView(composed, privateWinner, "withheld", publicFailedMeasurement);
for (const result of [failedAlternatives, missingAlternative]) {
  assert.equal(
    publicView(composed, result, "withheld", publicFailedMeasurement),
    privateWinnerBytes,
  );
}
complete(
  composed,
  expandedEvidence(composed, [
    { ...outputFact, value: "wrong" },
    measurementFact,
    protectedFact,
    humanReview,
    modelReview,
  ]),
  composedReferences,
  "fail",
  [
    finding("output", "fail", "VALUE_MISMATCH"),
    measurementPass,
    hiddenPass,
    reviewNeeded,
    hiddenNeeded,
  ],
);
assert.deepEqual(projectPublicResult(composed, { ...expandedPass, outcome: "fail" }), opaque);
assert.deepEqual(
  projectPublicResult(composed, {
    ...expandedPass,
    findings: expandedPass.findings.map((item) =>
      item.criterionId === "explanation" ? { ...item, outcome: "pass", reasonCode: "MATCH" } : item,
    ),
  }),
  opaque,
);

// Malformed material is invalid even in a nondecisive branch. Independent
// canonical resealing removes digest mismatch as an alternative explanation.
function resealExpanded(record, observations) {
  const { evidenceDigest: _digest, ...content } = record;
  const changed = { ...content, observations };
  const keys = new Set();
  JSON.stringify(changed, (_key, item) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      for (const key of Object.keys(item)) keys.add(key);
    }
    return item;
  });
  const bytes = JSON.stringify(changed, [...keys].sort());
  return {
    ...changed,
    evidenceDigest: `sha256:${createHash("sha256").update("assay:evidence:v4\n").update(bytes).digest("hex")}`,
  };
}
for (const [mutation, code] of [
  [{ ...humanReview, verdict: "pass" }, "UNKNOWN_FIELD"],
  [{ ...humanReview, reviewer: { ...humanReview.reviewer, trusted: true } }, "UNKNOWN_FIELD"],
  [{ ...humanReview, reviewPolicyVersion: "rev2" }, "MISMATCHED_OBSERVATION"],
  [{ ...humanReview, citations: [] }, "INVALID_VALUE"],
  [{ ...humanReview, feedback: "é".repeat(2049) }, "INPUT_TOO_LARGE"],
  [
    { ...humanReview, origin: { ...expandedOrigin, artifactDigest: `sha256:${"f".repeat(64)}` } },
    "MISMATCHED_ORIGIN",
  ],
]) {
  const observations = [outputFact, measurementFact, protectedFact, mutation, modelReview];
  assert.equal(
    createEvidenceBundle(composed, {
      schemaVersion: 4,
      artifactDigest: expandedArtifact,
      observations,
    }).ok,
    false,
  );
  invalid(
    composed,
    evaluate(composed, resealExpanded(composedEvidence, observations), composedReferences),
    "invalid_evidence",
    code,
    expandedCanaries,
  );
}
invalid(
  composed,
  evaluate(
    composed,
    resealExpanded(composedEvidence, [
      outputFact,
      measurementFact,
      { ...protectedFact, unit: "ms" },
      humanReview,
      modelReview,
    ]),
    composedReferences,
  ),
  "invalid_evidence",
  "MISMATCHED_OBSERVATION",
  expandedCanaries,
);
invalid(
  composed,
  evaluate(composed, composedEvidence, {
    ...composedReferences,
    references: [{ ...expandedReference, value: 51 }],
  }),
  "invalid_reference",
  "REFERENCE_DIGEST_MISMATCH",
  expandedCanaries,
);

// Material subjective work is a separate required manual leaf, not an
// authoritative model verdict. A submitted artifact and favorable advisory
// feedback cannot satisfy that leaf. No observation provider is required.
const defense = unwrap(
  createAssessmentDefinition({
    ...composedDraft,
    assessmentId: "design-defense",
    criteria: [common, alternative, publicAdvice, requiredManual],
    composition: {
      rootGroupId: "root",
      groups: [
        {
          id: "root",
          operator: "all",
          children: [
            { kind: "criterion", id: "output" },
            { kind: "criterion", id: "measurement" },
            { kind: "criterion", id: "design-defense" },
          ],
        },
      ],
    },
  }),
);
const manualFact = {
  criterionId: "design-defense",
  evidenceRef: "AYI28_PRIVATE_MANUAL_REF",
  kind: "manual",
  completeness: "complete",
  artifactRefs: ["AYI28_PRIVATE_DESIGN"],
  origin: expandedOrigin,
};
const manualNeeded = finding("design-defense", "inconclusive", "REVIEW_REQUIRED");
for (const [reviews, reviewFinding, publicReason] of [
  [[humanReview], reviewNeeded, "review_needed"],
  [
    [{ ...humanReview, completeness: "truncated" }],
    finding("explanation", "inconclusive", "EVIDENCE_TRUNCATED"),
    "incomplete_evidence",
  ],
  [[], finding("explanation", "inconclusive", "EVIDENCE_MISSING"), "missing_evidence"],
]) {
  const record = expandedEvidence(defense, [outputFact, measurementFact, ...reviews, manualFact]);
  const result = complete(defense, record, undefined, "inconclusive", [
    outputPass,
    measurementPass,
    reviewFinding,
    manualNeeded,
  ]);
  const publicBytes = publicView(defense, result, "inconclusive", [
    publicExpanded[0],
    publicExpanded[1],
    publicFinding("explanation", "inconclusive", publicReason),
    publicFinding("design-defense", "inconclusive", "review_needed"),
  ]);
  assert.ok(!publicBytes.includes("AYI28_PRIVATE_"));
}
const manualAbsent = complete(
  defense,
  expandedEvidence(defense, [outputFact, measurementFact, humanReview]),
  undefined,
  "inconclusive",
  [
    outputPass,
    measurementPass,
    reviewNeeded,
    finding("design-defense", "inconclusive", "EVIDENCE_MISSING"),
  ],
);
assert.equal(unwrap(projectPublicResult(defense, manualAbsent)).outcome, "inconclusive");

// No eligible public objective is missing: absent protected/manual/review
// material does not trigger a port request. An injected port is optional.
let expandedCalls = 0;
const noEligible = expandedEvidence(defense, [outputFact, measurementFact]);
const noAcquisition = await collectObservations(defense, noEligible, {
  async observe() {
    expandedCalls++;
    throw new Error("Unexpected port request");
  },
});
assert.equal(expandedCalls, 0);
assert.equal(noAcquisition.ok, true);
assert.equal(noAcquisition.receipt, null);
assert.equal(JSON.stringify(decoded(noAcquisition.evidence)), JSON.stringify(decoded(noEligible)));
console.log("AY-I28 installed expanded assessment scenarios passed (synthetic facts only)");
