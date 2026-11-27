import type { DefinitionReference } from "./definition";
import type { ValidationDiagnostic } from "./validation";

export type TechnicalOutcome =
  | "pass"
  | "fail"
  | "inconclusive"
  | "invalid_definition"
  | "invalid_evidence"
  | "evaluation_error";

export type FindingOutcome = "pass" | "fail" | "inconclusive" | "error";

/** Technical diagnostics and findings never echo submitted values or secret references. */
export interface CriterionFinding {
  readonly criterionId: string;
  readonly outcome: FindingOutcome;
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
  readonly evaluatorId: string;
  readonly evaluatorVersion: string;
}

export interface EvaluationResult {
  readonly schemaVersion: 2;
  readonly evidenceDigest: string;
  readonly artifactDigest?: string;
  readonly outcome: TechnicalOutcome;
  readonly definition: DefinitionReference;
  readonly policyVersion: string;
  readonly findings: readonly CriterionFinding[];
  readonly evaluator: Readonly<{ id: string; version: string }>;
  readonly warnings: readonly string[];
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
