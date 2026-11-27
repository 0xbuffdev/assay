import type { AssessmentDefinition, Criterion } from "../contracts/definition";
import type { EvidenceBundle, Observation } from "../contracts/evidence";
import type { EvidenceCoverage, ValidationResult } from "../contracts/validation";
import { parseAssessmentDefinition } from "./definition";
import { parseEvidenceBundle } from "./evidence";
import { Diagnostics } from "./shared";

/**
 * Inspect required evidence coverage only. This does not compare values,
 * declare correctness, or treat an unverified source as trusted.
 */
export function inspectEvidenceCoverage(
  definitionInput: unknown,
  evidenceInput: unknown,
): ValidationResult<EvidenceCoverage> {
  const definition = parseAssessmentDefinition(definitionInput);
  if (!definition.ok) return definition;
  const evidence = parseEvidenceBundle(evidenceInput);
  if (!evidence.ok) return evidence;
  return inspectValidatedCoverage(definition.value, evidence.value);
}

/** Shared coverage checks on bounded structural snapshots. */
export function inspectValidatedCoverage(
  expected: AssessmentDefinition,
  actual: EvidenceBundle,
): ValidationResult<EvidenceCoverage> {
  const issues = new Diagnostics();

  if (
    actual.definition.assessmentId !== expected.assessmentId ||
    actual.definition.revision !== expected.revision ||
    actual.definition.revisionDigest !== expected.revisionDigest
  ) {
    issues.add("$.definition", "MISMATCHED_DEFINITION");
  }
  const criteria = new Map<string, Criterion>(
    expected.criteria.map((criterion) => [criterion.id, criterion]),
  );
  const evidenceByCriterion = new Map<string, Observation>();
  for (const [i, observation] of actual.observations.entries()) {
    const criterion = criteria.get(observation.criterionId);
    const path = `$.observations[${i}]`;
    if (!criterion) {
      issues.add(`${path}.criterionId`, "UNKNOWN_CRITERION");
      continue;
    }
    const matchingKind =
      ((criterion.kind === "exact_text" || criterion.kind === "normalized_text") &&
        observation.kind === "text") ||
      (criterion.kind === "number_with_tolerance" &&
        observation.kind === "number" &&
        // Absent units are valid only when both sides deliberately omit them.
        criterion.parameters.unit === observation.unit) ||
      (criterion.kind === "set_equivalence" &&
        observation.kind === "set" &&
        criterion.parameters.itemType === observation.itemType) ||
      (criterion.kind === "observed_execution" && observation.kind === "execution") ||
      (criterion.kind === "manual_evidence" && observation.kind === "manual");
    if (!matchingKind) {
      if (
        criterion.kind === "number_with_tolerance" &&
        observation.kind === "number" &&
        criterion.parameters.unit !== observation.unit
      ) {
        issues.add(`${path}.unit`, "MISMATCHED_OBSERVATION");
      } else {
        issues.add(`${path}.kind`, "MISMATCHED_OBSERVATION");
      }
    }

    if (criterion.kind === "observed_execution" && observation.kind === "execution") {
      const known = new Set(criterion.parameters.assertions.map((assertion) => assertion.id));
      for (const [j, assertion] of observation.assertions.entries()) {
        if (!known.has(assertion.assertionId)) {
          issues.add(`${path}.assertions[${j}].assertionId`, "UNKNOWN_CRITERION");
        }
      }
    }
    evidenceByCriterion.set(criterion.id, observation);
  }
  const missingRequired: string[] = [];
  const incompleteRequired: string[] = [];
  for (const criterion of expected.criteria) {
    if (criterion.mode !== "required") continue;
    const obs = evidenceByCriterion.get(criterion.id);
    if (!obs) missingRequired.push(criterion.id);
    else {
      const missingExecutionAssertion =
        criterion.kind === "observed_execution" &&
        obs.kind === "execution" &&
        criterion.parameters.assertions.some(
          (expectedAssertion) =>
            !obs.assertions.some(
              (observedAssertion) =>
                observedAssertion.assertionId === expectedAssertion.id &&
                observedAssertion.state !== "unknown",
            ),
        );
      const missingManualArtifact =
        criterion.kind === "manual_evidence" &&
        obs.kind === "manual" &&
        obs.artifactRefs.length === 0;

      if (obs.completeness === "truncated" || missingExecutionAssertion || missingManualArtifact) {
        incompleteRequired.push(criterion.id);
      }
    }
  }
  return issues.result(
    "invalid_evidence",
    Object.freeze({
      missingRequired: Object.freeze(missingRequired),
      incompleteRequired: Object.freeze(incompleteRequired),
    }),
  );
}
