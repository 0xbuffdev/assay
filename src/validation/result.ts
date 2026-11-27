import { SCHEMA_VERSION } from "../contracts/version";
import { CONTRACT_LIMITS } from "../contracts/common";
import {
  ASSAY_EVALUATOR_ID,
  ASSAY_EVALUATOR_VERSION,
  type EvaluationResult,
  FINDING_REASONS,
  type FindingOutcome,
} from "../contracts/result";
import type { ValidationResult } from "../contracts/validation";
import { choice, definitionRef, digest, finish, identifier, list, object, unique } from "./shared";

/** Validate a technical finding record without granting authority to its claim. */
export function parseEvaluationResult(input: unknown): ValidationResult<EvaluationResult> {
  return finish(input, "invalid_result", (data, issues) => {
    if (
      !object(
        data,
        "$",
        [
          "schemaVersion",
          "outcome",
          "definition",
          "evidenceDigest",
          "artifactDigest",
          "policyVersion",
          "findings",
          "evaluator",
          "warnings",
        ],
        [
          "schemaVersion",
          "outcome",
          "definition",
          "evidenceDigest",
          "policyVersion",
          "findings",
          "evaluator",
          "warnings",
        ],
        issues,
      )
    )
      return;
    if (data.schemaVersion !== SCHEMA_VERSION) issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    choice(data.outcome, ["pass", "fail", "inconclusive", "evaluation_error"], "$.outcome", issues);
    definitionRef(data.definition, "$.definition", issues);
    digest(data.evidenceDigest, "$.evidenceDigest", issues);
    if (Object.hasOwn(data, "artifactDigest"))
      digest(data.artifactDigest, "$.artifactDigest", issues);
    choice(data.policyVersion, ["composed-required-v1"], "$.policyVersion", issues);
    if (object(data.evaluator, "$.evaluator", ["id", "version"], ["id", "version"], issues)) {
      choice(data.evaluator.id, [ASSAY_EVALUATOR_ID], "$.evaluator.id", issues);
      choice(data.evaluator.version, [ASSAY_EVALUATOR_VERSION], "$.evaluator.version", issues);
    }
    if (list(data.warnings, "$.warnings", issues, CONTRACT_LIMITS.maxEvidenceRefs)) {
      for (const [i, warning] of data.warnings.entries())
        choice(warning, ["ADVISORY_UNRESOLVED"], `$.warnings[${i}]`, issues);
      unique(data.warnings, "$.warnings", issues);
    }
    if (!list(data.findings, "$.findings", issues, CONTRACT_LIMITS.maxCriteria)) return;
    if (data.findings.length === 0) issues.add("$.findings", "INVALID_VALUE");
    const ids: unknown[] = [];
    for (const [i, finding] of data.findings.entries()) {
      const p = `$.findings[${i}]`;
      if (
        !object(
          finding,
          p,
          [
            "criterionId",
            "outcome",
            "reasonCode",
            "evidenceRefs",
            "evaluatorId",
            "evaluatorVersion",
          ],
          [
            "criterionId",
            "outcome",
            "reasonCode",
            "evidenceRefs",
            "evaluatorId",
            "evaluatorVersion",
          ],
          issues,
        )
      )
        continue;
      identifier(finding.criterionId, `${p}.criterionId`, issues);
      if (choice(finding.outcome, Object.keys(FINDING_REASONS), `${p}.outcome`, issues)) {
        choice(
          finding.reasonCode,
          FINDING_REASONS[finding.outcome as FindingOutcome],
          `${p}.reasonCode`,
          issues,
        );
      }
      choice(finding.evaluatorId, [ASSAY_EVALUATOR_ID], `${p}.evaluatorId`, issues);
      choice(finding.evaluatorVersion, [ASSAY_EVALUATOR_VERSION], `${p}.evaluatorVersion`, issues);
      if (
        list(finding.evidenceRefs, `${p}.evidenceRefs`, issues, CONTRACT_LIMITS.maxEvidenceRefs)
      ) {
        for (const [j, id] of finding.evidenceRefs.entries())
          identifier(id, `${p}.evidenceRefs[${j}]`, issues);
        unique(finding.evidenceRefs, `${p}.evidenceRefs`, issues);
      }
      ids.push(finding.criterionId);
    }
    unique(ids, "$.findings", issues);
  });
}
