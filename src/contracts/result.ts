import type { DefinitionReference, PolicyVersion } from "./definition";
import type { ValidationDiagnostic } from "./validation";

/** Evaluator semantics identifier, independent of the unpublished package version. */
export const ASSAY_EVALUATOR_VERSION = "v0.0.1" as const;
export const ASSAY_EVALUATOR_ID = "assay" as const;

export type TechnicalOutcome = "pass" | "fail" | "inconclusive" | "evaluation_error";

/** One internal, immutable owner of the supported finding taxonomy. */
export const FINDING_REASONS = Object.freeze({
  pass: Object.freeze(["MATCH"] as const),
  fail: Object.freeze(["VALUE_MISMATCH"] as const),
  inconclusive: Object.freeze([
    "REFERENCE_UNAVAILABLE",
    "EVIDENCE_MISSING",
    "EVIDENCE_TRUNCATED",
    "ASSERTION_INCOMPLETE",
    "EXECUTION_UNVERIFIED",
    "ARTIFACT_MISSING",
    "REVIEW_REQUIRED",
  ] as const),
  error: Object.freeze(["COMPARATOR_ERROR", "NUMERIC_OVERFLOW"] as const),
});

type FindingReasons = typeof FINDING_REASONS;
export type FindingOutcome = keyof FindingReasons;
export type ReasonCode = FindingReasons[FindingOutcome][number];

/** Distribute by outcome so a reason cannot be paired with an unrelated outcome. */
export type FindingDecision = {
  [Outcome in FindingOutcome]: Readonly<{
    outcome: Outcome;
    reasonCode: FindingReasons[Outcome][number];
  }>;
}[FindingOutcome];

export type WarningCode = "ADVISORY_UNRESOLVED";

/** Technical diagnostics and findings never echo submitted values or secret references. */
export type CriterionFinding = FindingDecision &
  Readonly<{
    criterionId: string;
    evidenceRefs: readonly string[];
    evaluatorId: typeof ASSAY_EVALUATOR_ID;
    evaluatorVersion: typeof ASSAY_EVALUATOR_VERSION;
  }>;

export interface EvaluationResult {
  readonly schemaVersion: 2;
  readonly evidenceDigest: string;
  readonly artifactDigest?: string;
  readonly outcome: TechnicalOutcome;
  readonly definition: DefinitionReference;
  readonly policyVersion: PolicyVersion;
  readonly findings: readonly CriterionFinding[];
  readonly evaluator: Readonly<{
    id: typeof ASSAY_EVALUATOR_ID;
    version: typeof ASSAY_EVALUATOR_VERSION;
  }>;
  readonly warnings: readonly WarningCode[];
}

/**
 * Invalid inputs have no reliable assessment identity. Return structured
 * diagnostics instead of manufacturing an EvaluationResult's lineage.
 */
export interface EvaluationFailure {
  readonly outcome: "invalid_definition" | "invalid_evidence" | "invalid_reference";
  readonly diagnostics: readonly ValidationDiagnostic[];
}

/** A complete technical result or an invalid-input diagnostic envelope. */
export type EvaluationResponse = EvaluationResult | EvaluationFailure;
