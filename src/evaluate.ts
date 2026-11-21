import {
  ASSAY_SCHEMA_VERSION,
  type AssessmentDefinition,
  type Criterion,
  type CriterionFinding,
  type EvaluationFailure,
  type EvaluationResponse,
  type EvaluationResult,
  type EvidenceBundle,
  type FindingOutcome,
  type Observation,
  type SetScalar,
  type TextNormalization,
} from "./contracts";
import {
  inspectEvidenceCoverage,
  parseAssessmentDefinition,
  parseEvidenceBundle,
} from "./validation";

/** A source revision identifier, not a credential or attestation. */
export const ASSAY_EVALUATOR_VERSION = "v0.0.0" as const;
const EVALUATOR_ID = "assay";

type Comparison = Readonly<{
  outcome: FindingOutcome;
  reasonCode: string;
}>;

function finding(outcome: FindingOutcome, reasonCode: string): Comparison {
  return { outcome, reasonCode };
}

const PASSED = finding("pass", "MATCH");
const FAILED = finding("fail", "VALUE_MISMATCH");
const REFERENCE_UNAVAILABLE = finding("inconclusive", "REFERENCE_UNAVAILABLE");
const MISSING_EVIDENCE = finding("inconclusive", "EVIDENCE_MISSING");
const TRUNCATED_EVIDENCE = finding("inconclusive", "EVIDENCE_TRUNCATED");

/**
 * All transformations are opt-in, in this fixed order: line endings,
 * locale-independent Unicode lowercasing, Unicode normalization, whitespace
 * collapsing, then trimming. "fold" is ECMAScript lowercasing rather than
 * the full Unicode CaseFolding mapping.
 */
function normalizeText(value: string, policy: TextNormalization): string {
  let output = value;
  if (policy.lineEndings === "lf") output = output.replace(/\r\n?/g, "\n");
  if (policy.case === "fold") output = output.toLowerCase();
  if (policy.unicode !== "none") output = output.normalize(policy.unicode);
  if (policy.whitespace === "collapse") output = output.replace(/\s+/gu, " ");
  if (policy.trim === "both") output = output.trim();
  return output;
}

function identical(a: SetScalar, b: SetScalar): boolean {
  // NaN and Infinity cannot reach this point through contract validation.
  // SameValueZero, including +0/-0 equivalence, matches Map/Set semantics.
  return a === b;
}

function matchesSet(
  observed: readonly SetScalar[],
  expected: readonly SetScalar[],
  order: "ignore" | "preserve",
  duplicates: "ignore" | "respect",
): boolean {
  if (order === "preserve") {
    const left = duplicates === "ignore" ? [...new Set(observed)] : observed;
    const right = duplicates === "ignore" ? [...new Set(expected)] : expected;
    return left.length === right.length && left.every((item, index) => identical(item, right[index]));
  }

  if (duplicates === "ignore") {
    const left = new Set(observed);
    const right = new Set(expected);
    return left.size === right.size && [...left].every((item) => right.has(item));
  }

  if (observed.length !== expected.length) return false;
  const counts = new Map<SetScalar, number>();
  for (const item of expected) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of observed) {
    const remaining = counts.get(item);
    if (remaining === undefined || remaining === 0) return false;
    counts.set(item, remaining - 1);
  }
  return true;
}

/**
 * Evaluate one structurally validated criterion and observation.
 * Reference IDs are never resolved from submitted evidence, and execution
 * claims are never accepted as authenticated proof by this milestone.
 */
function compare(criterion: Criterion, observation: Observation): Comparison {
  switch (criterion.kind) {
    case "exact_text": {
      if (observation.kind !== "text") return finding("error", "COMPARATOR_ERROR");
      const { expected } = criterion.parameters;
      if (expected.type === "reference") return REFERENCE_UNAVAILABLE;
      // Exact equality is UTF-16 code-unit equality, without normalization.
      return observation.value === expected.value ? PASSED : FAILED;
    }
    case "normalized_text": {
      if (observation.kind !== "text") return finding("error", "COMPARATOR_ERROR");
      const { expected, normalization } = criterion.parameters;
      if (expected.type === "reference") return REFERENCE_UNAVAILABLE;
      return normalizeText(observation.value, normalization) ===
        normalizeText(expected.value, normalization)
        ? PASSED
        : FAILED;
    }
    case "number_with_tolerance": {
      if (observation.kind !== "number") return finding("error", "COMPARATOR_ERROR");
      const { expected, tolerance } = criterion.parameters;
      if (expected.type === "reference") return REFERENCE_UNAVAILABLE;

      // Keep arithmetic overflows distinct from both a match and a wrong answer.
      const relativeBound = tolerance.relative * Math.abs(expected.value);
      if (!Number.isFinite(relativeBound)) return finding("error", "NUMERIC_OVERFLOW");
      const bound = Math.max(tolerance.absolute, relativeBound);
      const difference = Math.abs(observation.value - expected.value);
      if (!Number.isFinite(difference)) return FAILED;
      return difference <= bound ? PASSED : FAILED;
    }
    case "set_equivalence": {
      if (observation.kind !== "set") return finding("error", "COMPARATOR_ERROR");
      const { expected, order, duplicates } = criterion.parameters;
      if (expected.type === "reference") return REFERENCE_UNAVAILABLE;
      return matchesSet(observation.items, expected.value, order, duplicates) ? PASSED : FAILED;
    }
    case "observed_execution": {
      if (observation.kind !== "execution") return finding("error", "COMPARATOR_ERROR");
      // The observation records assertion states, not their authenticity.
      // Until AY-I03 establishes an injected verified port, even all
      // "confirmed" assertions are insufficient for a technical pass.
      const incomplete = criterion.parameters.assertions.some(
        ({ id }) =>
          !observation.assertions.some(
            (assertion) => assertion.assertionId === id && assertion.state !== "unknown",
          ),
      );
      return finding("inconclusive", incomplete ? "ASSERTION_INCOMPLETE" : "EXECUTION_UNVERIFIED");
    }
    case "manual_evidence": {
      if (observation.kind !== "manual") return finding("error", "COMPARATOR_ERROR");
      return finding(
        "inconclusive",
        observation.artifactRefs.length === 0 ? "ARTIFACT_MISSING" : "REVIEW_REQUIRED",
      );
    }
  }
}

function invalid(outcome: EvaluationFailure["outcome"], diagnostics: EvaluationFailure["diagnostics"]): EvaluationFailure {
  return Object.freeze({ outcome, diagnostics });
}

function aggregate(
  definition: AssessmentDefinition,
  comparisons: ReadonlyMap<string, Comparison>,
): EvaluationResult["outcome"] {
  const mandatory = definition.criteria
    .filter((criterion) => criterion.mode === "required")
    .map((criterion) => comparisons.get(criterion.id)?.outcome);
  // Conjunction: one definite required failure is conclusive even if other
  // required observations are missing. Advisory outcomes cannot compensate.
  if (mandatory.includes("fail")) return "fail";
  if (mandatory.includes("error")) return "evaluation_error";
  if (mandatory.some((outcome) => outcome !== "pass")) return "inconclusive";
  return "pass";
}

/**
 * Pure deterministic technical comparison against a caller-authorized rubric.
 *
 * Malformed definition/evidence returns a bounded, value-free failure envelope,
 * not a forged revision identifier. Valid inputs return a full EvaluationResult.
 * This function does not attest origins, resolve hidden references, execute
 * code, grade a learner or issue formal credit.
 */
export function evaluate(definitionInput: unknown, evidenceInput: unknown): EvaluationResponse {
  const validatedDefinition = parseAssessmentDefinition(definitionInput);
  if (!validatedDefinition.ok) {
    return invalid("invalid_definition", validatedDefinition.diagnostics);
  }
  const validatedEvidence = parseEvidenceBundle(evidenceInput);
  if (!validatedEvidence.ok) {
    return invalid("invalid_evidence", validatedEvidence.diagnostics);
  }

  const definition = validatedDefinition.value;
  const evidence = validatedEvidence.value;
  const coverage = inspectEvidenceCoverage(definition, evidence);
  if (!coverage.ok) {
    return invalid("invalid_evidence", coverage.diagnostics);
  }

  const observations = new Map(evidence.observations.map((observation) => [observation.criterionId, observation]));
  const comparisons = new Map<string, Comparison>();
  const findings: CriterionFinding[] = [];

  for (const criterion of definition.criteria) {
    const observation = observations.get(criterion.id);
    let comparison: Comparison;
    if (!observation) comparison = MISSING_EVIDENCE;
    else if (observation.completeness === "truncated") comparison = TRUNCATED_EVIDENCE;
    else {
      try {
        comparison = compare(criterion, observation);
      } catch {
        // Never leak runtime exception text, submitted evidence or references.
        comparison = finding("error", "COMPARATOR_ERROR");
      }
    }
    comparisons.set(criterion.id, comparison);
    findings.push(Object.freeze({
      criterionId: criterion.id,
      outcome: comparison.outcome,
      reasonCode: comparison.reasonCode,
      evidenceRefs: Object.freeze(observation ? [observation.evidenceRef] : []),
      evaluatorId: EVALUATOR_ID,
      evaluatorVersion: ASSAY_EVALUATOR_VERSION,
    }));
  }

  const warnings: string[] = [];
  if (definition.criteria.some((criterion) =>
    criterion.mode === "advisory" &&
    (comparisons.get(criterion.id)?.outcome === "inconclusive" ||
     comparisons.get(criterion.id)?.outcome === "error")
  )) {
    warnings.push("ADVISORY_UNRESOLVED");
  }

  return Object.freeze({
    schemaVersion: ASSAY_SCHEMA_VERSION,
    outcome: aggregate(definition, comparisons),
    definition: Object.freeze({
      assessmentId: definition.assessmentId,
      revision: definition.revision,
      revisionDigest: definition.revisionDigest,
    }),
    policyVersion: definition.policyVersion,
    findings: Object.freeze(findings),
    evaluator: Object.freeze({ id: EVALUATOR_ID, version: ASSAY_EVALUATOR_VERSION }),
    warnings: Object.freeze(warnings),
  });
}
