import { ASSAY_SCHEMA_VERSION } from "../contracts/common";
import type { Criterion } from "../contracts/definition";
import type {
  PublicCriterionFinding,
  PublicProjectionResponse,
  PublicReason,
} from "../contracts/projection";
import type { CriterionFinding, ReasonCode } from "../contracts/result";
import { advisoryWarnings, aggregateRequired } from "../evaluation/aggregate";
import { relativeToleranceBound } from "../evaluation/comparators/number";
import { verifyAssessmentDefinition } from "../integrity/definition";
import { parseEvaluationResult } from "../validation/result";

const REJECTED: PublicProjectionResponse = Object.freeze({
  ok: false,
  reasonCode: "PUBLIC_PROJECTION_REJECTED",
});

// Exhaustive, explicit translation: no privileged reason string is copied.
const PUBLIC_REASONS = Object.freeze({
  MATCH: "match",
  VALUE_MISMATCH: "mismatch",
  REFERENCE_UNAVAILABLE: "unavailable",
  EVIDENCE_MISSING: "missing_evidence",
  EVIDENCE_TRUNCATED: "incomplete_evidence",
  ASSERTION_INCOMPLETE: "incomplete_evidence",
  EXECUTION_UNVERIFIED: "unavailable",
  EXECUTION_INCOMPLETE: "incomplete_evidence",
  ARTIFACT_MISSING: "missing_evidence",
  REVIEW_REQUIRED: "review_needed",
  COMPARATOR_ERROR: "evaluation_error",
  NUMERIC_OVERFLOW: "evaluation_error",
} satisfies Record<ReasonCode, PublicReason>);

// A literal bound has a known overflow state. For references, a finite bound
// at the maximum finite magnitude rules out overflow for every possible value;
// otherwise the actual overflow state is unknown without the reference.
function numericOverflow(
  criterion: Extract<Criterion, { kind: "number_with_tolerance" }>,
): boolean | undefined {
  const { expected, tolerance } = criterion.parameters;
  if (expected.type === "literal") {
    return !Number.isFinite(relativeToleranceBound(expected.value, tolerance.relative));
  }
  return Number.isFinite(relativeToleranceBound(Number.MAX_VALUE, tolerance.relative))
    ? false
    : undefined;
}

// Check facts about the record that are knowable without replaying evidence.
// The current evaluator emits one evidence ref per observed criterion.
function coherentFinding(criterion: Criterion, finding: CriterionFinding): boolean {
  if (finding.reasonCode === "EVIDENCE_MISSING") return finding.evidenceRefs.length === 0;
  if (finding.evidenceRefs.length !== 1) return false;

  const expected = "expected" in criterion.parameters ? criterion.parameters.expected : undefined;
  const comparable = expected !== undefined;
  switch (finding.reasonCode) {
    case "MATCH":
    case "VALUE_MISMATCH":
      return (
        comparable &&
        (criterion.kind !== "number_with_tolerance" || numericOverflow(criterion) !== true)
      );
    case "NUMERIC_OVERFLOW":
      return (
        criterion.kind === "number_with_tolerance" &&
        comparable &&
        numericOverflow(criterion) !== false
      );
    case "REFERENCE_UNAVAILABLE":
      return expected?.type === "reference";
    case "ASSERTION_INCOMPLETE":
    case "EXECUTION_UNVERIFIED":
      return criterion.kind === "observed_execution";
    case "ARTIFACT_MISSING":
    case "REVIEW_REQUIRED":
      return criterion.kind === "manual_evidence";
    case "EVIDENCE_TRUNCATED":
    case "EXECUTION_INCOMPLETE":
    case "COMPARATOR_ERROR":
      return true;
  }
}

/**
 * Produce a narrowly scoped learner-safe view of an authorized technical
 * result. This function checks *content integrity* and consistency but never
 * authenticates a publisher, executor, or the origin of the result itself.
 *
 * Full technical results belong to an authorized host; do not serialize them
 * or the restricted definition to the learner as part of this projection.
 *
 * For ANY restricted criterion, return no aggregate technical outcome, even
 * when the private result is a pass/fail/error. Never copy warnings, reason
 * codes, evidence refs, evaluation metadata or source lineage to this view.
 * Public reasons are explicitly mapped from the validated built-in taxonomy.
 * On ANY rejected input emit the SAME opaque error without diagnostic paths.
 */
export function projectPublicResult(
  definitionInput: unknown,
  resultInput: unknown,
): PublicProjectionResponse {
  const checkedDefinition = verifyAssessmentDefinition(definitionInput);
  if (!checkedDefinition.ok) return REJECTED;
  const checkedResult = parseEvaluationResult(resultInput);
  if (!checkedResult.ok) return REJECTED;

  const definition = checkedDefinition.value;
  const result = checkedResult.value;
  if (
    result.definition.assessmentId !== definition.assessmentId ||
    result.definition.revision !== definition.revision ||
    result.definition.revisionDigest !== definition.revisionDigest ||
    result.policyVersion !== definition.policyVersion ||
    result.findings.length !== definition.criteria.length
  ) {
    return REJECTED;
  }

  // Require complete ordered correspondence with the supplied content-verified
  // rubric, rejecting missing, reordered, extra, or inconsistent findings.
  // Structural validation alone does not establish authorship of a result.
  const evidenceRefs = new Set<string>();
  for (const [index, criterion] of definition.criteria.entries()) {
    const finding = result.findings[index];
    if (
      finding.criterionId !== criterion.id ||
      finding.evaluatorId !== result.evaluator.id ||
      finding.evaluatorVersion !== result.evaluator.version ||
      !coherentFinding(criterion, finding)
    ) {
      return REJECTED;
    }
    for (const ref of finding.evidenceRefs) {
      if (evidenceRefs.has(ref)) return REJECTED;
      evidenceRefs.add(ref);
    }
  }
  const findingsByCriterion = new Map(
    result.findings.map((finding) => [finding.criterionId, finding]),
  );
  const expectedOutcome = aggregateRequired(definition, findingsByCriterion);
  const expectedWarnings = advisoryWarnings(definition, findingsByCriterion);
  if (
    result.outcome !== expectedOutcome ||
    result.warnings.length !== expectedWarnings.length ||
    result.warnings.some((warning, index) => warning !== expectedWarnings[index])
  ) {
    return REJECTED;
  }

  const publicFindings: PublicCriterionFinding[] = [];
  let hasRestricted = false;
  for (const [index, criterion] of definition.criteria.entries()) {
    if (criterion.visibility === "restricted") {
      hasRestricted = true;
      continue;
    }
    publicFindings.push(
      Object.freeze({
        criterionId: criterion.id,
        outcome: result.findings[index].outcome,
        reason: PUBLIC_REASONS[result.findings[index].reasonCode],
      }),
    );
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      schemaVersion: ASSAY_SCHEMA_VERSION,
      outcome: hasRestricted ? "withheld" : expectedOutcome,
      findings: Object.freeze(publicFindings),
    }),
  });
}
