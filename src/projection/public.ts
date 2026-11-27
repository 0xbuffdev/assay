import { ASSAY_SCHEMA_VERSION } from "../contracts/common";
import type { PublicCriterionFinding, PublicProjectionResponse } from "../contracts/projection";
import { aggregateRequired, advisoryWarnings } from "../evaluation/aggregate";
import { verifyAssessmentDefinition } from "../integrity/definition";
import { parseEvaluationResult } from "../validation/result";

const REJECTED: PublicProjectionResponse = Object.freeze({
  ok: false,
  reasonCode: "PUBLIC_PROJECTION_REJECTED",
});

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

  // Require complete ordered correspondence with the supplied content-verified
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
