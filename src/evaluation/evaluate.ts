import type { ReferenceRecord } from "../contracts/reference";
import type { CriterionFinding, EvaluationFailure, EvaluationResponse } from "../contracts/result";
import { verifyAssessmentDefinition } from "../integrity/definition";
import { verifyEvidenceForDefinition } from "../integrity/evidence";
import { verifyReferencesForDefinition } from "../integrity/reference";
import { aggregateRequired } from "./aggregate";
import {
  type Comparison,
  finding,
  MISSING_EVIDENCE,
  TRUNCATED_EVIDENCE,
} from "./comparators/finding";
import { compare } from "./compare";

/** A source revision identifier, not a credential or attestation. */
export const ASSAY_EVALUATOR_VERSION = "v0.0.0" as const;
const EVALUATOR_ID = "assay";

function invalid(
  outcome: EvaluationFailure["outcome"],
  diagnostics: EvaluationFailure["diagnostics"],
): EvaluationFailure {
  return Object.freeze({ outcome, diagnostics });
}

/**
 * Pure deterministic technical comparison against a content-verified rubric.
 *
 * Definition integrity is checked before inspecting evidence or comparing values.
 * Malformed definition, reference or evidence returns a bounded, value-free failure envelope,
 * not a forged revision identifier. Valid inputs return a full EvaluationResult.
 * Only caller-supplied, content-bound references may supply expected values.
 * This function does not attest origins, fetch references, execute code,
 * grade a learner or issue formal credit.
 */
export function evaluate(
  definitionInput: unknown,
  evidenceInput: unknown,
  referenceInput?: unknown,
): EvaluationResponse {
  const validatedDefinition = verifyAssessmentDefinition(definitionInput);
  if (!validatedDefinition.ok) {
    return invalid("invalid_definition", validatedDefinition.diagnostics);
  }
  const definition = validatedDefinition.value;
  const references = new Map<string, ReferenceRecord>();
  if (referenceInput !== undefined) {
    const checked = verifyReferencesForDefinition(definition, referenceInput);
    if (!checked.ok) {
      return invalid(
        checked.domain === "invalid_definition" ? "invalid_definition" : "invalid_reference",
        checked.diagnostics,
      );
    }
    for (const record of checked.value.references) references.set(record.referenceId, record);
  }
  const validatedEvidence = verifyEvidenceForDefinition(definition, evidenceInput);
  if (!validatedEvidence.ok) {
    return invalid("invalid_evidence", validatedEvidence.diagnostics);
  }

  const evidence = validatedEvidence.value;

  const observations = new Map(
    evidence.observations.map((observation) => [observation.criterionId, observation]),
  );
  const comparisons = new Map<string, Comparison>();
  const findings: CriterionFinding[] = [];

  for (const criterion of definition.criteria) {
    const observation = observations.get(criterion.id);
    let comparison: Comparison;
    if (!observation) comparison = MISSING_EVIDENCE;
    else if (observation.completeness === "truncated") comparison = TRUNCATED_EVIDENCE;
    else {
      try {
        comparison = compare(criterion, observation, references);
      } catch {
        // Never leak runtime exception text, submitted evidence or references.
        comparison = finding("error", "COMPARATOR_ERROR");
      }
    }
    comparisons.set(criterion.id, comparison);
    findings.push(
      Object.freeze({
        criterionId: criterion.id,
        outcome: comparison.outcome,
        reasonCode: comparison.reasonCode,
        evidenceRefs: Object.freeze(observation ? [observation.evidenceRef] : []),
        evaluatorId: EVALUATOR_ID,
        evaluatorVersion: ASSAY_EVALUATOR_VERSION,
      }),
    );
  }

  const warnings: string[] = [];
  if (
    definition.criteria.some(
      (criterion) =>
        criterion.mode === "advisory" &&
        (comparisons.get(criterion.id)?.outcome === "inconclusive" ||
          comparisons.get(criterion.id)?.outcome === "error"),
    )
  ) {
    warnings.push("ADVISORY_UNRESOLVED");
  }

  return Object.freeze({
    schemaVersion: 2,
    evidenceDigest: evidence.evidenceDigest,
    ...(evidence.artifactDigest === undefined ? {} : { artifactDigest: evidence.artifactDigest }),
    outcome: aggregateRequired(definition, comparisons),
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
