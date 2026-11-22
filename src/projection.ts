import {
  ASSAY_SCHEMA_VERSION,
  type AssessmentDefinition,
  type CriterionFinding,
  type FindingOutcome,
  type PublicCriterionFinding,
  type PublicProjectionResponse,
  type PublicTechnicalOutcome,
} from "./contracts";
import { verifyAssessmentDefinition } from "./integrity";
import { parseEvaluationResult } from "./validation";

const REJECTED: PublicProjectionResponse = Object.freeze({
  ok: false,
  reasonCode: "PUBLIC_PROJECTION_REJECTED",
});

/**
 * Recalculate the technical conjunction from its per-criterion outcomes.
 * This is not a new grading policy: it mirrors the evaluator's required
 * precedence and rules out a caller-forged aggregate in a supplied result.
 */
function aggregate(
  definition: AssessmentDefinition,
  findings: readonly CriterionFinding[],
): Exclude<PublicTechnicalOutcome, "withheld"> {
  const required: FindingOutcome[] = [];
  for (const [index, criterion] of definition.criteria.entries()) {
    if (criterion.mode === "required") required.push(findings[index].outcome);
  }
  if (required.includes("fail")) return "fail";
  if (required.includes("error")) return "evaluation_error";
  if (required.some((outcome) => outcome !== "pass")) return "inconclusive";
  return "pass";
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

  // Require complete ordered correspondence with the authenticated-by-host
  // rubric, rejecting missing, reordered, extra, or inconsistent findings.
  // Structural validation alone does not establish authorship of a result.
  for (const [index, criterion] of definition.criteria.entries()) {
    const finding = result.findings[index];
    if (
      finding.criterionId !== criterion.id ||
      finding.evaluatorId !== result.evaluator.id ||
      finding.evaluatorVersion !== result.evaluator.version
    ) {
      return REJECTED;
    }
  }
  const expectedOutcome = aggregate(definition, result.findings);
  if (result.outcome !== expectedOutcome) return REJECTED;

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
