import { CONTRACT_LIMITS } from "../contracts/common";
import type { EvaluationResult } from "../contracts/result";
import type { ValidationResult } from "../contracts/validation";
import {
  choice,
  type Diagnostics,
  definitionRef,
  digest,
  finish,
  identifier,
  list,
  object,
  revision,
  unique,
} from "./shared";

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
    if (data.schemaVersion !== 2) issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    choice(
      data.outcome,
      [
        "pass",
        "fail",
        "inconclusive",
        "invalid_definition",
        "invalid_evidence",
        "evaluation_error",
      ],
      "$.outcome",
      issues,
    );
    definitionRef(data.definition, "$.definition", issues);
    digest(data.evidenceDigest, "$.evidenceDigest", issues);
    if (Object.hasOwn(data, "artifactDigest"))
      digest(data.artifactDigest, "$.artifactDigest", issues);
    revision(data.policyVersion, "$.policyVersion", issues);
    if (object(data.evaluator, "$.evaluator", ["id", "version"], ["id", "version"], issues)) {
      identifier(data.evaluator.id, "$.evaluator.id", issues);
      revision(data.evaluator.version, "$.evaluator.version", issues);
    }
    if (list(data.warnings, "$.warnings", issues, CONTRACT_LIMITS.maxEvidenceRefs)) {
      for (const [i, warning] of data.warnings.entries())
        reason(warning, `$.warnings[${i}]`, issues);
    }
    if (!list(data.findings, "$.findings", issues, CONTRACT_LIMITS.maxCriteria)) return;
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
      choice(finding.outcome, ["pass", "fail", "inconclusive", "error"], `${p}.outcome`, issues);
      reason(finding.reasonCode, `${p}.reasonCode`, issues);
      identifier(finding.evaluatorId, `${p}.evaluatorId`, issues);
      revision(finding.evaluatorVersion, `${p}.evaluatorVersion`, issues);
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

function reason(value: unknown, path: string, issues: Diagnostics): void {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) {
    issues.add(path, "INVALID_VALUE");
  }
}
