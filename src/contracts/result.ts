import type { DefinitionReference, PolicyVersion } from "./definition";
import type { ValidationDiagnostic } from "./validation";

/** Evaluator semantics identifier, independent of the unpublished package version. */
export const ASSAY_EVALUATOR_VERSION = "v0.0.1" as const;
export const ASSAY_EVALUATOR_ID = "assay" as const;

export type TechnicalOutcome = "pass" | "fail" | "inconclusive" | "evaluation_error";

export type FindingOutcome = "pass" | "fail" | "inconclusive" | "error";

export type ReasonCode =
  | "MATCH"
  | "VALUE_MISMATCH"
  | "REFERENCE_UNAVAILABLE"
  | "EVIDENCE_MISSING"
  | "EVIDENCE_TRUNCATED"
  | "ASSERTION_INCOMPLETE"
  | "EXECUTION_UNVERIFIED"
  | "ARTIFACT_MISSING"
  | "REVIEW_REQUIRED"
  | "COMPARATOR_ERROR"
  | "NUMERIC_OVERFLOW";

export type WarningCode = "ADVISORY_UNRESOLVED";

/** Technical diagnostics and findings never echo submitted values or secret references. */
export interface CriterionFinding {
  readonly criterionId: string;
  readonly outcome: FindingOutcome;
  readonly reasonCode: ReasonCode;
  readonly evidenceRefs: readonly string[];
  readonly evaluatorId: typeof ASSAY_EVALUATOR_ID;
  readonly evaluatorVersion: typeof ASSAY_EVALUATOR_VERSION;
}

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
